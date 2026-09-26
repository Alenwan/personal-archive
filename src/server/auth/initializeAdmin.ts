import type postgres from "postgres";
import { hashPassword, validateNewPassword } from "./password";
import { MIGRATION_LOCK, verifyMigrationHistory, type MigrationSignature } from "../services/schemaMigrations";

export class AdminInitializationError extends Error {}

// Maintenance entry point, deliberately unavailable through the HTTP API.
export async function initializeAdmin(sql: postgres.Sql, input: { email: string; name: string; password: string }, migrations: MigrationSignature[]): Promise<string> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email === "system@md3-platform.local") {
    throw new AdminInitializationError("Provide a valid, non-system email address.");
  }
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name + email)) {
    throw new AdminInitializationError("Provide a name of 1–100 characters without control characters.");
  }
  if (input.password.length > 1024 || /[\r\n\u0000]/.test(input.password)) throw new AdminInitializationError("Invalid password input.");
  const invalid = validateNewPassword(input.password);
  if (invalid) throw new AdminInitializationError(invalid);
  const credential = await hashPassword(input.password);
  return sql.begin(async (tx) => {
    await tx`set local lock_timeout = '5s'`;
    const [lock] = await tx`select pg_try_advisory_xact_lock_shared(${MIGRATION_LOCK[0]}, ${MIGRATION_LOCK[1]}) as locked`;
    if (!lock.locked) throw new AdminInitializationError("A migration is running; retry after it completes.");
    const history = await tx<Array<{ file_name: string; sha256: string | null }>>`select file_name, sha256 from public.schema_migrations order by file_name`;
    verifyMigrationHistory(history, migrations);
    // Serializes initializers, including ordinary user inserts. The migration's
    // exact uncredentialed audit identity is the only permitted pre-existing user.
    await tx`lock table users, user_credentials in share row exclusive mode`;
    const [existing] = await tx`select
      exists(select 1 from users where not (
        user_id = '90000000-0000-4000-8000-000000000099'::uuid
        and email = 'system@md3-platform.local' and role = 'ReadOnly'
      )) or exists(select 1 from user_credentials) as populated`;
    if (existing.populated) throw new AdminInitializationError("This instance already has an account. Initialization cannot reset or replace it.");
    const [user] = await tx`insert into users (name, email, role) values (${name}, ${email}, 'Admin') returning user_id`;
    await tx`insert into user_credentials (
      user_id, password_hash, password_salt, password_algorithm, password_iterations,
      must_change_password, password_changed_at, failed_login_count, updated_at
    ) values (${user.user_id}, ${credential.passwordHash}, ${credential.passwordSalt},
      ${credential.passwordAlgorithm}, ${credential.passwordIterations}, false, now(), 0, now())`;
    await tx`insert into audit_logs (action, entity_type, entity_id, user_id, metadata)
      values ('InitializeAdmin', 'User', ${user.user_id}, ${user.user_id}, '{"source":"init-admin-cli"}'::jsonb)`;
    return user.user_id as string;
  });
}
