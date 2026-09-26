import { gcm } from "@noble/ciphers/aes.js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type {
  Manuscript,
  ManuscriptEncryptionPasswordMetadata
} from "./types";

export const MANUSCRIPT_ENCRYPTION_VERSION = 1;
export const MANUSCRIPT_ENCRYPTION_KDF = "PBKDF2-SHA-256";
export const MANUSCRIPT_ENCRYPTION_ITERATIONS = 600_000;

const BODY_PREFIX = "pae1";
const WRAPPED_KEY_PREFIX = "pak1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type ManuscriptWorkKey = Uint8Array<ArrayBuffer>;

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("This browser cannot generate secure random encryption keys.");
  }
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("The encrypted data is malformed.");
  }
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
  return output;
}

async function derivePasswordKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number
): Promise<Uint8Array<ArrayBuffer>> {
  return pbkdf2Async(sha256, encoder.encode(password), salt, {
    c: iterations,
    dkLen: 32,
    asyncTick: 8
  });
}

function wrapRawKey(
  workKeyBytes: ManuscriptWorkKey,
  wrappingKey: Uint8Array<ArrayBuffer>,
  aad: string
): string {
  const iv = randomBytes(12);
  const ciphertext = gcm(wrappingKey, iv, encoder.encode(aad)).encrypt(workKeyBytes);
  return `${WRAPPED_KEY_PREFIX}.${bytesToBase64Url(iv)}.${bytesToBase64Url(ciphertext)}`;
}

function unwrapRawKey(
  envelope: string,
  wrappingKey: Uint8Array<ArrayBuffer>,
  aad: string
): ManuscriptWorkKey {
  const [prefix, ivValue, ciphertextValue, extra] = envelope.split(".");
  if (prefix !== WRAPPED_KEY_PREFIX || !ivValue || !ciphertextValue || extra) {
    throw new Error("The encrypted key is malformed.");
  }
  try {
    return Uint8Array.from(gcm(
      wrappingKey,
      base64UrlToBytes(ivValue),
      encoder.encode(aad)
    ).decrypt(base64UrlToBytes(ciphertextValue)));
  } catch {
    throw new Error("The encryption password is incorrect.");
  }
}

function passwordAad(version: number) {
  return `personal-archive:manuscript-key:password:v${version}`;
}

function requireEncryptionMetadata(manuscript: Manuscript) {
  if (!manuscript.encryptionEnabled
    || manuscript.encryptionVersion !== MANUSCRIPT_ENCRYPTION_VERSION
    || manuscript.encryptionKdf !== MANUSCRIPT_ENCRYPTION_KDF
    || manuscript.encryptionIterations !== MANUSCRIPT_ENCRYPTION_ITERATIONS
    || !manuscript.encryptionSalt
    || !manuscript.encryptedWorkKey) {
    throw new Error("This work has incomplete or unsupported encryption metadata.");
  }
  return {
    version: manuscript.encryptionVersion,
    iterations: manuscript.encryptionIterations,
    salt: manuscript.encryptionSalt,
    passwordEnvelope: manuscript.encryptedWorkKey
  };
}

export function isEncryptedManuscriptBody(value: string): boolean {
  return /^pae1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,12000000}$/.test(value);
}

export function exportManuscriptWorkKey(workKey: ManuscriptWorkKey): string {
  if (workKey.byteLength !== 32) throw new Error("The manuscript work key is invalid.");
  return bytesToBase64Url(workKey);
}

export async function createManuscriptEncryption(password: string): Promise<{
  workKey: ManuscriptWorkKey;
  metadata: ManuscriptEncryptionPasswordMetadata;
  recoveryWorkKey: string;
}> {
  if (!password) throw new Error("Enter an encryption password.");
  const workKeyBytes = randomBytes(32);
  const workKey = Uint8Array.from(workKeyBytes);
  const salt = randomBytes(16);
  const passwordKey = await derivePasswordKey(password, salt, MANUSCRIPT_ENCRYPTION_ITERATIONS);
  const encryptedWorkKey = wrapRawKey(workKeyBytes, passwordKey, passwordAad(MANUSCRIPT_ENCRYPTION_VERSION));
  const recoveryWorkKey = exportManuscriptWorkKey(workKeyBytes);
  passwordKey.fill(0);
  workKeyBytes.fill(0);
  return {
    workKey,
    recoveryWorkKey,
    metadata: {
      encryptionVersion: MANUSCRIPT_ENCRYPTION_VERSION,
      encryptionKdf: MANUSCRIPT_ENCRYPTION_KDF,
      encryptionIterations: MANUSCRIPT_ENCRYPTION_ITERATIONS,
      encryptionSalt: bytesToBase64Url(salt),
      encryptedWorkKey
    }
  };
}

export async function unlockManuscriptWithPassword(
  manuscript: Manuscript,
  password: string
): Promise<ManuscriptWorkKey> {
  const metadata = requireEncryptionMetadata(manuscript);
  const salt = base64UrlToBytes(metadata.salt);
  const passwordKey = await derivePasswordKey(password, salt, metadata.iterations);
  try {
    return unwrapRawKey(metadata.passwordEnvelope, passwordKey, passwordAad(metadata.version));
  } finally {
    passwordKey.fill(0);
  }
}

export async function createManuscriptPasswordMetadata(
  workKey: ManuscriptWorkKey,
  password: string
): Promise<ManuscriptEncryptionPasswordMetadata> {
  if (!password) throw new Error("Enter an encryption password.");
  if (workKey.byteLength !== 32) throw new Error("The manuscript work key is invalid.");
  const salt = randomBytes(16);
  const passwordKey = await derivePasswordKey(password, salt, MANUSCRIPT_ENCRYPTION_ITERATIONS);
  try {
    return {
      encryptionVersion: MANUSCRIPT_ENCRYPTION_VERSION,
      encryptionKdf: MANUSCRIPT_ENCRYPTION_KDF,
      encryptionIterations: MANUSCRIPT_ENCRYPTION_ITERATIONS,
      encryptionSalt: bytesToBase64Url(salt),
      encryptedWorkKey: wrapRawKey(workKey, passwordKey, passwordAad(MANUSCRIPT_ENCRYPTION_VERSION))
    };
  } finally {
    passwordKey.fill(0);
  }
}

export async function rewrapManuscriptKeyWithPassword(
  workKey: ManuscriptWorkKey,
  password: string
): Promise<ManuscriptEncryptionPasswordMetadata> {
  return createManuscriptPasswordMetadata(workKey, password);
}

export async function encryptManuscriptBody(
  workKey: ManuscriptWorkKey,
  manuscriptId: string,
  chapterId: string,
  plaintext: string
): Promise<string> {
  const iv = randomBytes(12);
  const ciphertext = gcm(
    workKey,
    iv,
    encoder.encode(`${manuscriptId}:${chapterId}:body:v1`)
  ).encrypt(encoder.encode(plaintext));
  return `${BODY_PREFIX}.${bytesToBase64Url(iv)}.${bytesToBase64Url(ciphertext)}`;
}

export async function decryptManuscriptBody(
  workKey: ManuscriptWorkKey,
  manuscriptId: string,
  chapterId: string,
  envelope: string
): Promise<string> {
  const [prefix, ivValue, ciphertextValue, extra] = envelope.split(".");
  if (prefix !== BODY_PREFIX || !ivValue || !ciphertextValue || extra) {
    throw new Error("This encrypted body is malformed.");
  }
  try {
    return decoder.decode(gcm(
      workKey,
      base64UrlToBytes(ivValue),
      encoder.encode(`${manuscriptId}:${chapterId}:body:v1`)
    ).decrypt(base64UrlToBytes(ciphertextValue)));
  } catch {
    throw new Error("This body could not be decrypted. It may be damaged or use a different work key.");
  }
}
