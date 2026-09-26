import type { AppEnv } from "./env";

export function ephemeralMode(env: AppEnv): boolean {
  return env.APP_ENV === "test" || (env.APP_ENV !== "production" && env.DEMO_MODE === "true");
}

export function requirePersistentDatabase(env: AppEnv): void {
  if (!env.HYPERDRIVE?.connectionString && !env.DATABASE_URL && !env.POSTGRES_URL && !ephemeralMode(env)) {
    throw new Error("Database configuration is required; in-memory storage requires explicit test/demo mode.");
  }
}

export function validateSelfhostConfig(env: AppEnv): void {
  if (env.APP_ENV && !["production", "development", "test"].includes(env.APP_ENV)) throw new Error("APP_ENV is invalid.");
  if (env.DEMO_MODE && !["true", "false"].includes(env.DEMO_MODE)) throw new Error("DEMO_MODE must be true or false.");
  if (env.DATABASE_SSL && !["false", "disable", "require"].includes(env.DATABASE_SSL)) throw new Error("DATABASE_SSL must be false, disable or require.");
  if (env.APP_ENV === "production" && env.DEMO_MODE === "true") throw new Error("Production cannot enable demo mode.");
  requirePersistentDatabase(env);
  if (ephemeralMode(env)) return;
  const connection = env.DATABASE_URL || env.POSTGRES_URL;
  try {
    if (!connection || !["postgres:", "postgresql:"].includes(new URL(connection).protocol)) throw new Error();
  } catch { throw new Error("A valid PostgreSQL URL is required for self-hosting."); }
  try {
    const endpoint = new URL(env.S3_ENDPOINT || "");
    if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error();
  } catch { throw new Error("S3_ENDPOINT must be an HTTP(S) endpoint without embedded credentials, query or fragment."); }
  for (const name of ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "DOCUMENT_BUCKET_NAME"] as const) {
    if (!env[name]?.trim()) throw new Error(`${name} is required.`);
  }
  for (const name of ["DOCUMENT_BUCKET_NAME", "BACKUP_BUCKET_NAME"] as const) {
    if (env[name] && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env[name]!)) throw new Error(`${name} is invalid.`);
  }
  if (env.BUSINESS_TEMPLATE === "personal-archive") {
    for (const name of ["CREDENTIAL_ENCRYPTION_KEY", "MANUSCRIPT_RECOVERY_KEY", "PRIVATE_VAULT_RECOVERY_KEY"] as const) {
      if ((env[name]?.trim().length ?? 0) < 32) throw new Error(`${name} requires at least 32 characters; preserve the existing key when upgrading.`);
    }
  }
}
