import type { PublicUser } from "../../shared/types";
import type { AppRepository } from "../repositories/types";

const encoder = new TextEncoder();
const cookieName = "rc_session";
const sessionTtlMs = 1000 * 60 * 60 * 8;

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of array) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function createSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return base64Url(digest);
}

export function createSessionExpiry(): string {
  return new Date(Date.now() + sessionTtlMs).toISOString();
}

export function createSessionCookie(token: string, secure: boolean): string {
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(secure = true): string {
  return `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

export function readSessionToken(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  return (
    cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1) ?? null
  );
}

export async function readSessionUser(request: Request, repo: AppRepository): Promise<PublicUser | null> {
  const token = readSessionToken(request);
  if (!token) return null;
  // Sessions and cookies share a fixed eight-hour lifetime. Ordinary requests
  // must not reissue an old token after a concurrent password change rotated it.
  return repo.getUserBySessionTokenHash(await hashSessionToken(token));
}

export async function revokeRequestSession(request: Request, repo: AppRepository): Promise<void> {
  const token = readSessionToken(request);
  if (!token) return;
  await repo.revokeAuthSession(await hashSessionToken(token));
}
