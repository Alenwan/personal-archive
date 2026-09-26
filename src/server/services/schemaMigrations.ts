import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type postgres from "postgres";

export interface MigrationSignature { name: string; sha256: string }
export interface MigrationSource extends MigrationSignature { body: string }
export const MIGRATION_LOCK = [1885430627, 1935894637] as const;

async function reservedTransaction(connection: postgres.ReservedSql, action: () => Promise<void>): Promise<void> {
  // Postgres.js reserved connections do not expose begin() at runtime. Keeping
  // BEGIN/COMMIT on this reserved connection also keeps the session lock alive.
  await connection`begin`;
  try {
    await action();
    await connection`commit`;
  } catch (error) {
    await connection`rollback`;
    throw error;
  }
}

export async function readMigrations(directory: string): Promise<MigrationSource[]> {
  const names = (await readdir(directory)).filter((name) => /^\d{4}_[a-z0-9][a-z0-9_-]*\.sql$/i.test(name) && !name.includes("seed")).sort();
  if (!names.length || new Set(names.map((name) => name.slice(0, 4))).size !== names.length) throw new Error("Migration inventory is empty or has duplicate sequence numbers.");
  return Promise.all(names.map(async (name) => {
    const path = join(directory, name);
    const entry = await lstat(path);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Migration source must be a regular file.");
    const bytes = await readFile(path);
    return { name, body: bytes.toString("utf8"), sha256: createHash("sha256").update(bytes).digest("hex") };
  }));
}

export function verifyMigrationHistory(
  rows: Array<{ file_name: string; sha256: string | null }>,
  expected: MigrationSignature[],
  { allowPending = false, allowLegacy = false } = {}
): void {
  const byName = new Map(expected.map((item) => [item.name, item]));
  const applied = new Map(rows.map((row) => [row.file_name, row.sha256]));
  for (const row of rows) {
    if (row.file_name === "0002_seed_demo.sql") continue;
    const item = byName.get(row.file_name);
    if (!item) throw new Error("Database migration history is newer than or different from this release.");
    if (!row.sha256 && !allowLegacy) throw new Error("Legacy migration checksums need explicit adoption after review.");
    if (row.sha256 && row.sha256 !== item.sha256) throw new Error("An applied migration checksum does not match this release.");
  }
  let pendingSeen = false;
  for (const item of expected) {
    if (!applied.has(item.name)) {
      pendingSeen = true;
      if (!allowPending) throw new Error("Database migrations are pending.");
    } else if (pendingSeen) throw new Error("Database migration history has a gap.");
  }
}

export async function checkSchema(sql: postgres.Sql, expected: MigrationSignature[]): Promise<void> {
  await sql.begin(async (tx) => {
    const [lock] = await tx`select pg_try_advisory_xact_lock_shared(${MIGRATION_LOCK[0]}, ${MIGRATION_LOCK[1]}) as locked`;
    if (!lock.locked) throw new Error("Database migration is in progress.");
    const rows = await tx<Array<{ file_name: string; sha256: string | null }>>`select file_name, sha256 from public.schema_migrations order by file_name`;
    verifyMigrationHistory(rows, expected);
  });
}

export async function migrateDatabase(sql: postgres.Sql, migrations: MigrationSource[], adoptLegacyChecksums = false): Promise<number> {
  const connection = await sql.reserve();
  let locked = false;
  try {
    locked = (await connection`select pg_try_advisory_lock(${MIGRATION_LOCK[0]}, ${MIGRATION_LOCK[1]}) as locked`)[0].locked;
    if (!locked) throw new Error("Another migration process holds the database lock.");
    await connection`create table if not exists public.schema_migrations (file_name text primary key, applied_at timestamptz not null default now(), sha256 text)`;
    await connection`alter table public.schema_migrations add column if not exists sha256 text`;
    const rows = await connection<Array<{ file_name: string; sha256: string | null }>>`select file_name, sha256 from public.schema_migrations order by file_name`;
    verifyMigrationHistory(rows, migrations, { allowPending: true, allowLegacy: adoptLegacyChecksums });
    if (adoptLegacyChecksums) {
      await reservedTransaction(connection, async () => {
        for (const item of migrations) {
          await connection`update public.schema_migrations set sha256 = ${item.sha256} where file_name = ${item.name} and sha256 is null`;
        }
      });
    }
    const applied = new Set(rows.map((row) => row.file_name));
    let count = 0;
    for (const item of migrations) {
      if (applied.has(item.name)) continue;
      await reservedTransaction(connection, async () => {
        await connection.unsafe(item.body);
        await connection`insert into public.schema_migrations (file_name, sha256) values (${item.name}, ${item.sha256})`;
      });
      count += 1;
    }
    return count;
  } finally {
    try {
      if (locked) await connection`select pg_advisory_unlock(${MIGRATION_LOCK[0]}, ${MIGRATION_LOCK[1]})`;
    } finally { connection.release(); }
  }
}
