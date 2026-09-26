import type { UserCredential } from "../repositories/types";

export const PASSWORD_ALGORITHM = "pbkdf2-sha256";
export const PASSWORD_ITERATIONS = 100_000;
const PASSWORD_KEY_LENGTH_BITS = 256;
const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return diff === 0;
}

async function derivePasswordHash(password: string, salt: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(fromBase64Url(salt)),
      iterations
    },
    key,
    PASSWORD_KEY_LENGTH_BITS
  );
  return base64Url(new Uint8Array(bits));
}

export function validateNewPassword(password: string): string | null {
  if (password.length < 10) return "New password must be at least 10 characters.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "New password must include both letters and numbers.";
  return null;
}

export async function hashPassword(password: string): Promise<UserCredential> {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const passwordSalt = base64Url(saltBytes);
  return {
    passwordHash: await derivePasswordHash(password, passwordSalt, PASSWORD_ITERATIONS),
    passwordSalt,
    passwordAlgorithm: PASSWORD_ALGORITHM,
    passwordIterations: PASSWORD_ITERATIONS,
    mustChangePassword: false
  };
}

export async function verifyPassword(password: string, credential: UserCredential): Promise<boolean> {
  if (credential.passwordAlgorithm !== PASSWORD_ALGORITHM) return false;
  const candidate = await derivePasswordHash(password, credential.passwordSalt, credential.passwordIterations);
  return timingSafeEqual(candidate, credential.passwordHash);
}
