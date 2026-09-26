import type { AppEnv } from "../env";
import {
  MANUSCRIPT_ENCRYPTION_ITERATIONS,
  MANUSCRIPT_ENCRYPTION_KDF,
  MANUSCRIPT_ENCRYPTION_VERSION
} from "../../shared/manuscriptEncryption";
import type { ManuscriptEncryptionPasswordMetadata } from "../../shared/types";

const RECOVERY_ENVELOPE_PREFIX = "par1";
const PASSWORD_ENVELOPE_PREFIX = "pak1";
const RECOVERY_KEY_MIN_LENGTH = 32;
const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    const output = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
    return output;
  } catch {
    throw new Error("The manuscript recovery key is malformed.");
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function recoveryAad(manuscriptId: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`personal-archive:manuscript-recovery:${manuscriptId}:v1`);
}

async function importRecoveryKey(env: AppEnv): Promise<CryptoKey> {
  const keyMaterial = (env.MANUSCRIPT_RECOVERY_KEY ?? "").trim();
  if (keyMaterial.length < RECOVERY_KEY_MIN_LENGTH) {
    throw new Error("MANUSCRIPT_RECOVERY_KEY is not configured with at least 32 characters.");
  }
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(keyMaterial));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function createRecoveredManuscriptPasswordMetadata(
  workKey: Uint8Array<ArrayBuffer>,
  password: string
): Promise<ManuscriptEncryptionPasswordMetadata> {
  if (workKey.byteLength !== 32) throw new Error("The manuscript work key is invalid.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const passwordMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const passwordKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      iterations: MANUSCRIPT_ENCRYPTION_ITERATIONS
    },
    passwordMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(encoder.encode(
        `personal-archive:manuscript-key:password:v${MANUSCRIPT_ENCRYPTION_VERSION}`
      ))
    },
    passwordKey,
    toArrayBuffer(workKey)
  ));
  return {
    encryptionVersion: MANUSCRIPT_ENCRYPTION_VERSION,
    encryptionKdf: MANUSCRIPT_ENCRYPTION_KDF,
    encryptionIterations: MANUSCRIPT_ENCRYPTION_ITERATIONS,
    encryptionSalt: bytesToBase64Url(salt),
    encryptedWorkKey: `${PASSWORD_ENVELOPE_PREFIX}.${bytesToBase64Url(iv)}.${bytesToBase64Url(ciphertext)}`
  };
}

export async function wrapManuscriptRecoveryKey(
  workKeyValue: string,
  manuscriptId: string,
  env: AppEnv
): Promise<string> {
  const workKey = base64UrlToBytes(workKeyValue);
  if (workKey.byteLength !== 32) throw new Error("The manuscript work key is invalid.");
  const key = await importRecoveryKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  try {
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(recoveryAad(manuscriptId)) },
      key,
      toArrayBuffer(workKey)
    ));
    return `${RECOVERY_ENVELOPE_PREFIX}.${bytesToBase64Url(iv)}.${bytesToBase64Url(ciphertext)}`;
  } finally {
    workKey.fill(0);
  }
}

export async function unwrapManuscriptRecoveryKey(
  envelope: string,
  manuscriptId: string,
  env: AppEnv
): Promise<Uint8Array<ArrayBuffer>> {
  const [prefix, ivValue, ciphertextValue, extra] = envelope.split(".");
  if (prefix !== RECOVERY_ENVELOPE_PREFIX || !ivValue || !ciphertextValue || extra) {
    throw new Error("The manuscript recovery key is malformed.");
  }
  const key = await importRecoveryKey(env);
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(base64UrlToBytes(ivValue)),
        additionalData: toArrayBuffer(recoveryAad(manuscriptId))
      },
      key,
      toArrayBuffer(base64UrlToBytes(ciphertextValue))
    );
    const workKey = new Uint8Array(plaintext);
    if (workKey.byteLength !== 32) throw new Error("The recovered manuscript work key is invalid.");
    return workKey;
  } catch {
    throw new Error("The account recovery copy of this manuscript key could not be opened.");
  }
}
