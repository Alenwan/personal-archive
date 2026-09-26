import type { AppEnv } from "../env";
import type { EncryptedPayload } from "../repositories/types";

const ALGORITHM = "AES-256-GCM";
const GCM_TAG_BYTES = 16;
const GCM_IV_BYTES = 12;
const MIN_KEY_MATERIAL_CHARS = 32;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const output = new Uint8Array(left.length + right.length);
  output.set(left, 0);
  output.set(right, left.length);
  return output;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function importCredentialKey(env: AppEnv): Promise<CryptoKey> {
  const keyMaterial = (env.CREDENTIAL_ENCRYPTION_KEY ?? "").trim();
  if (!keyMaterial) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY is not configured.");
  }
  const encoded = new TextEncoder().encode(keyMaterial);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export function credentialEncryptionKeyWarning(env: AppEnv): string | null {
  const keyMaterial = (env.CREDENTIAL_ENCRYPTION_KEY ?? "").trim();
  if (!keyMaterial) {
    return "CREDENTIAL_ENCRYPTION_KEY is not configured. Stored credential secrets cannot be encrypted or revealed.";
  }
  if (keyMaterial.length < MIN_KEY_MATERIAL_CHARS) {
    return `CREDENTIAL_ENCRYPTION_KEY is short (${keyMaterial.length} chars). Use at least ${MIN_KEY_MATERIAL_CHARS} random characters and back it up separately from the database.`;
  }
  return null;
}

export async function encryptCredentialText(value: string, env: AppEnv): Promise<EncryptedPayload> {
  const key = await importCredentialKey(env);
  const iv = new Uint8Array(GCM_IV_BYTES);
  crypto.getRandomValues(iv);
  const encoded = new TextEncoder().encode(value);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(encoded)));
  const ciphertext = encrypted.slice(0, Math.max(0, encrypted.length - GCM_TAG_BYTES));
  const tag = encrypted.slice(Math.max(0, encrypted.length - GCM_TAG_BYTES));
  return {
    encryptedValue: bytesToBase64(ciphertext),
    iv: bytesToBase64(iv),
    tag: bytesToBase64(tag),
    algorithm: ALGORITHM
  };
}

export async function decryptCredentialText(
  payload: Pick<EncryptedPayload, "encryptedValue" | "iv" | "tag">,
  env: AppEnv
): Promise<string> {
  if (!payload.iv || !payload.tag) return "";
  const key = await importCredentialKey(env);
  const ciphertext = base64ToBytes(payload.encryptedValue);
  const tag = base64ToBytes(payload.tag);
  const iv = base64ToBytes(payload.iv);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(concatBytes(ciphertext, tag))
  );
  return new TextDecoder().decode(decrypted);
}
