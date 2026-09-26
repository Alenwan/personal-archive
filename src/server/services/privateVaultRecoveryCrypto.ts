import type { AppEnv } from "../env";
import {
  PRIVATE_VAULT_ENCRYPTION_ITERATIONS,
  PRIVATE_VAULT_ENCRYPTION_KDF,
  PRIVATE_VAULT_ENCRYPTION_VERSION
} from "../../shared/privateVaultEncryption";
import type { PrivateVaultPasswordMetadata } from "../../shared/types";

const RECOVERY_ENVELOPE_PREFIX = "pavr1";
const PASSWORD_ENVELOPE_PREFIX = "pavk1";
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
    throw new Error("The private vault recovery key is malformed.");
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function recoveryAad(vaultId: string, ownerUserId: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`personal-archive:private-vault-recovery:${ownerUserId}:${vaultId}:v1`);
}

function passwordAad(): Uint8Array<ArrayBuffer> {
  return encoder.encode(`personal-archive:private-vault-key:password:v${PRIVATE_VAULT_ENCRYPTION_VERSION}`);
}

async function importRecoveryKey(env: AppEnv): Promise<CryptoKey> {
  const keyMaterial = (env.PRIVATE_VAULT_RECOVERY_KEY ?? "").trim();
  if (keyMaterial.length < RECOVERY_KEY_MIN_LENGTH) {
    throw new Error("PRIVATE_VAULT_RECOVERY_KEY is not configured with at least 32 characters.");
  }
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(keyMaterial));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function createRecoveredPrivateVaultPasswordMetadata(
  vaultKey: Uint8Array<ArrayBuffer>,
  password: string
): Promise<PrivateVaultPasswordMetadata> {
  if (vaultKey.byteLength !== 32) throw new Error("The private vault key is invalid.");
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
      iterations: PRIVATE_VAULT_ENCRYPTION_ITERATIONS
    },
    passwordMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(passwordAad()) },
    passwordKey,
    toArrayBuffer(vaultKey)
  ));
  return {
    encryptionVersion: PRIVATE_VAULT_ENCRYPTION_VERSION,
    encryptionKdf: PRIVATE_VAULT_ENCRYPTION_KDF,
    encryptionIterations: PRIVATE_VAULT_ENCRYPTION_ITERATIONS,
    encryptionSalt: bytesToBase64Url(salt),
    encryptedVaultKey: `${PASSWORD_ENVELOPE_PREFIX}.${bytesToBase64Url(iv)}.${bytesToBase64Url(ciphertext)}`
  };
}

export async function wrapPrivateVaultRecoveryKey(
  vaultKeyValue: string,
  vaultId: string,
  ownerUserId: string,
  env: AppEnv
): Promise<string> {
  const vaultKey = base64UrlToBytes(vaultKeyValue);
  if (vaultKey.byteLength !== 32) throw new Error("The private vault key is invalid.");
  const key = await importRecoveryKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  try {
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(recoveryAad(vaultId, ownerUserId))
      },
      key,
      toArrayBuffer(vaultKey)
    ));
    return `${RECOVERY_ENVELOPE_PREFIX}.${bytesToBase64Url(iv)}.${bytesToBase64Url(ciphertext)}`;
  } finally {
    vaultKey.fill(0);
  }
}

export async function unwrapPrivateVaultRecoveryKey(
  envelope: string,
  vaultId: string,
  ownerUserId: string,
  env: AppEnv
): Promise<Uint8Array<ArrayBuffer>> {
  const [prefix, ivValue, ciphertextValue, extra] = envelope.split(".");
  if (prefix !== RECOVERY_ENVELOPE_PREFIX || !ivValue || !ciphertextValue || extra) {
    throw new Error("The private vault recovery key is malformed.");
  }
  const key = await importRecoveryKey(env);
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(base64UrlToBytes(ivValue)),
        additionalData: toArrayBuffer(recoveryAad(vaultId, ownerUserId))
      },
      key,
      toArrayBuffer(base64UrlToBytes(ciphertextValue))
    );
    const vaultKey = new Uint8Array(plaintext);
    if (vaultKey.byteLength !== 32) throw new Error("The recovered private vault key is invalid.");
    return vaultKey;
  } catch {
    throw new Error("The account recovery copy of this private vault key could not be opened.");
  }
}
