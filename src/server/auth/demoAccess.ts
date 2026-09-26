import { HTTPException } from "hono/http-exception";
import type { DemoAccessMode, PublicUser } from "../../shared/types";
import type { AppEnv } from "../env";

const defaultReadonlyPassword = "Demo123!";
const internalAdminEmail = "admin@realtycase.demo";
const readonlyDemoEmail = "readonly@realtycase.demo";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isTruthy(value?: string): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

function emailList(value?: string): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => normalizeEmail(item))
    .filter(Boolean);
}

export function isPublicDemoReadonly(env: AppEnv): boolean {
  return isTruthy(env.PUBLIC_DEMO_READONLY);
}

export function isPublicMutationMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

export function isDemoEditorEmail(email: string, env: AppEnv): boolean {
  return emailList(env.PUBLIC_DEMO_EDITOR_EMAILS).includes(normalizeEmail(email));
}

function isInternalAdminEmail(email: string): boolean {
  return normalizeEmail(email) === internalAdminEmail;
}

function isReadonlyDemoEmail(email: string): boolean {
  return normalizeEmail(email) === readonlyDemoEmail;
}

export function expectedDemoPassword(email: string, env: AppEnv): string {
  if (!isTruthy(env.DEMO_MODE)) return "";
  if (!isPublicDemoReadonly(env)) return env.DEMO_PASSWORD?.trim() || defaultReadonlyPassword;
  if (isReadonlyDemoEmail(email)) return env.DEMO_PASSWORD?.trim() || defaultReadonlyPassword;
  if (isInternalAdminEmail(email)) return env.INTERNAL_ADMIN_PASSWORD?.trim() || "";
  if (isDemoEditorEmail(email, env)) return env.CLIENT_DEMO_PASSWORD?.trim() || "";
  return "";
}

export function accessModeForUser(user: PublicUser, env: AppEnv): DemoAccessMode {
  if (!isPublicDemoReadonly(env)) return "internal";
  if (isInternalAdminEmail(user.email) && env.INTERNAL_ADMIN_PASSWORD?.trim()) return "internal";
  return isDemoEditorEmail(user.email, env) ? "client-editor" : "public-readonly";
}

export function canMutateInCurrentDemo(user: PublicUser, env: AppEnv): boolean {
  return accessModeForUser(user, env) !== "public-readonly";
}

export function withDemoAccess(user: PublicUser, env: AppEnv): PublicUser {
  const accessMode = accessModeForUser(user, env);
  return {
    ...user,
    accessMode,
    mutationAllowed: accessMode !== "public-readonly"
  };
}

export function requirePublicDemoMutationAccess(user: PublicUser, env: AppEnv): void {
  if (isPublicDemoReadonly(env) && !canMutateInCurrentDemo(user, env)) {
    throw new HTTPException(403, {
      message:
        "This public demo is currently read-only. Please use an authorized client testing account for Manager or Staff workflow testing."
    });
  }
}
