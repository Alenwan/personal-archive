import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import test, { after, before } from "node:test";
import postgres from "postgres";
import { PostgresRepository } from "../src/server/repositories/postgres";
import { hashPassword, verifyPassword } from "../src/server/auth/password";
import type { CreateAuthSessionInput, CreateDocumentInput } from "../src/server/repositories/types";
import { checkSchema, migrateDatabase, readMigrations, MIGRATION_LOCK, type MigrationSource } from "../src/server/services/schemaMigrations";
import { runRecoveryExercise } from "./helpers/recoveryExercise";
import { exerciseMigrationCli, exerciseSelfhost } from "./helpers/selfhostExercise";
import { cleanupDocumentInput, storageCleanupContract } from "./helpers/storageCleanupContract";
import { archiveFolderContract } from "./helpers/archiveFolderContract";
import { keyOwnershipContract } from "./helpers/keyOwnershipContract";
import { exerciseKeyOwnershipCli } from "./helpers/keyOwnershipCliExercise";
import { vaultScopeContract } from "./helpers/vaultScopeContract";
import { archiveManagementContract, forbidden } from "./helpers/archiveManagementContract";
import { withArchiveManagementAccess } from "../src/server/auth/archiveManagement";
import { archiveContentContract } from "./helpers/archiveContentContract";
import { exerciseAdminInitialization } from "./helpers/adminInitializationExercise";

const configPath = process.env.PA_PG_TEST_CONFIG;
if (!configPath || !process.env.PA_PG_TEST_NONCE) throw new Error("Run only through scripts/test-postgres.mjs; arbitrary database targets are not accepted.");
for (const name of ["DATABASE_URL", "POSTGRES_URL", "PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSERVICE", "PGOPTIONS"]) {
  if (process.env[name] !== undefined) throw new Error(`Refusing inherited ${name}.`);
}
const config = JSON.parse(await readFile(configPath, "utf8"));
const root = await realpath(process.cwd());
assert.equal(config.root, root);
assert.equal(config.nonce, process.env.PA_PG_TEST_NONCE);
assert.equal(dirname(config.runDir), join(root, ".tools"));
assert.match(basename(config.runDir), /^postgres-test-[A-Za-z0-9]+$/);
assert.equal(configPath, join(config.runDir, "connection.json"));
assert.equal((await lstat(configPath)).mode & 0o777, 0o600);
assert.equal(config.dataDir, join(config.runDir, "data"));
assert.match(basename(config.socketDir), /^pa-pg-socket-[A-Za-z0-9]+$/);
for (const directory of [config.runDir, config.socketDir]) {
  assert.equal(await realpath(directory), directory);
  assert.equal((await lstat(directory)).mode & 0o777, 0o700);
  assert.deepEqual(JSON.parse(await readFile(join(directory, "personal-archive-test-owner.json"), "utf8")), { runId: config.runId, nonce: config.nonce });
}
const sql = postgres({ host: config.socketDir, port: config.port, database: config.database, username: config.username, password: config.password, ssl: false, max: 8, connect_timeout: 2, onnotice: () => {} });
const repo = new PostgresRepository(sql);
let migrationFiles: string[] = [];
let migrationSources: MigrationSource[] = [];
const legacyOwnershipIds = [randomUUID(), randomUUID()];
const legacyArchive = { owner: randomUUID(), other: randomUUID(), original: randomUUID(), next: randomUUID(), unknown: randomUUID(), folder: randomUUID() };

before(async () => {
  const [identity] = await sql`select current_setting('data_directory') as data_dir, current_setting('listen_addresses') as addresses, current_user as username, inet_server_addr() as network_address`;
  assert.equal(identity.data_dir, config.dataDir);
  assert.equal(identity.addresses, "");
  assert.equal(identity.network_address, null);
  assert.equal(identity.username, config.username);
  migrationSources = await readMigrations(join(root, "migrations"));
  migrationFiles = migrationSources.map((item) => item.name);
  assert.ok(migrationFiles.length > 0);
  const beforeOwnership = migrationSources.filter((item) => Number(item.name.slice(0, 4)) < 52);
  assert.equal(await migrateDatabase(sql, beforeOwnership), beforeOwnership.length);
  const oldAuthor = randomUUID();
  await sql`insert into users (user_id, name, email, role) values (${oldAuthor}, 'Synthetic old author', ${`${oldAuthor}@example.invalid`}, 'Admin')`;
  await sql`insert into manuscripts (manuscript_id, title, created_by) values (${legacyOwnershipIds[0]}, 'Synthetic authored legacy work', ${oldAuthor})`;
  await sql`insert into manuscripts (manuscript_id, title, created_by, encryption_enabled, encryption_version, encryption_kdf,
    encryption_iterations, encryption_salt, encrypted_work_key, recovery_encrypted_work_key)
    values (${legacyOwnershipIds[1]}, 'Synthetic authored encrypted legacy work', ${oldAuthor}, true, 1, 'PBKDF2-SHA-256',
      600000, 'synthetic-old-salt', 'synthetic-old-password-envelope', 'synthetic-old-recovery-envelope')`;
  for (const id of [legacyArchive.owner, legacyArchive.other]) {
    await sql`insert into users (user_id, name, email, role) values (${id}, 'Synthetic legacy file author', ${`${id}@example.invalid`}, 'Manager')`;
  }
  // Model the pre-upgrade process with its own connection. Prepared SELECT *
  // plans from the old schema must not survive into the post-upgrade process.
  const legacySql = postgres({ host: config.socketDir, port: config.port, database: config.database,
    username: config.username, password: config.password, ssl: false, max: 1, onnotice: () => {} });
  try {
    const legacyRepo = new PostgresRepository(legacySql);
    await legacyRepo.createArchiveFolder({ folderId: legacyArchive.folder, name: "Synthetic legacy owned folder", createdBy: legacyArchive.owner });
    await legacyRepo.createDocument({ ...cleanupDocumentInput(legacyArchive.owner), documentId: legacyArchive.original, folderId: legacyArchive.folder });
    await legacyRepo.createDocumentVersion(legacyArchive.original, { ...cleanupDocumentInput(legacyArchive.other), documentId: legacyArchive.next });
    await legacyRepo.createDocument({ ...cleanupDocumentInput(legacyArchive.owner), documentId: legacyArchive.unknown, documentGroupId: randomUUID(), versionNumber: 2 });
  } finally { await legacySql.end({ timeout: 2 }); }
  await sql`insert into manuscript_chapters (manuscript_id, title, body)
    values (${legacyOwnershipIds[0]}, 'Synthetic legacy image chapter', ${`<img src="/api/documents/${legacyArchive.original}/preview">`})`;
  assert.equal(await migrateDatabase(sql, migrationSources), migrationSources.length - beforeOwnership.length);
  await checkSchema(sql, migrationSources);
}, { timeout: 60000 });
after(async () => { await sql.end({ timeout: 2 }); });

test("first-admin CLI initializes only an empty migrated instance, atomically and without printing passwords", { timeout: 60000 }, async () => {
  await exerciseAdminInitialization(sql, config, migrationSources);
});

test("bundled migration CLI verifies the owned database without reapplying SQL", { timeout: 20000 }, async () => {
  await exerciseMigrationCli(config);
});

test("real selfhost refuses unsafe startup and reports schema drift through readiness", { timeout: 60000 }, async () => {
  await exerciseSelfhost(sql, config);
});

test("migration lock excludes another migrator and readiness; legacy adoption is deliberate", async () => {
  const holder = await sql.reserve();
  await holder`select pg_advisory_lock(${MIGRATION_LOCK[0]}, ${MIGRATION_LOCK[1]})`;
  try {
    await assert.rejects(migrateDatabase(sql, migrationSources), /lock/);
    await assert.rejects(checkSchema(sql, migrationSources), /progress/);
  } finally {
    await holder`select pg_advisory_unlock(${MIGRATION_LOCK[0]}, ${MIGRATION_LOCK[1]})`;
    holder.release();
  }
  await sql`update schema_migrations set sha256 = null where file_name = ${migrationSources[0].name}`;
  await assert.rejects(migrateDatabase(sql, migrationSources), /adoption/);
  await assert.rejects(checkSchema(sql, migrationSources), /adoption/);
  assert.equal(await migrateDatabase(sql, migrationSources, true), 0);
  await checkSchema(sql, migrationSources);
  const changed = migrationSources.map((item, index) => index ? item : { ...item, sha256: "changed" });
  await assert.rejects(migrateDatabase(sql, changed, true), /checksum/);
  await checkSchema(sql, migrationSources);
});

test("failed migration rolls back its DDL and ledger row, preserving earlier committed work", async () => {
  const source = (name: string, body: string) => ({ name, body, sha256: createHash("sha256").update(body).digest("hex") });
  const next = Math.max(...migrationSources.map((item) => Number(item.name.slice(0, 4)))) + 1;
  const good = source(`${String(next).padStart(4, "0")}_synthetic_good.sql`, "create table pa_synthetic_before_failure (id integer primary key)");
  const bad = source(`${String(next + 1).padStart(4, "0")}_synthetic_bad.sql`, "create table pa_synthetic_failed (id integer); select pa_missing_synthetic_function();");
  try {
    await assert.rejects(migrateDatabase(sql, [...migrationSources, good, bad]));
    assert.equal((await sql`select to_regclass('pa_synthetic_before_failure') as name`)[0].name, "pa_synthetic_before_failure");
    assert.equal((await sql`select to_regclass('pa_synthetic_failed') as name`)[0].name, null);
    assert.equal((await sql`select count(*)::int as count from schema_migrations where file_name = ${good.name}`)[0].count, 1);
    assert.equal((await sql`select count(*)::int as count from schema_migrations where file_name = ${bad.name}`)[0].count, 0);
    await assert.rejects(checkSchema(sql, migrationSources), /newer/);
  } finally {
    await sql`drop table if exists pa_synthetic_before_failure`;
    await sql`delete from schema_migrations where file_name = ${good.name}`;
  }
  await checkSchema(sql, migrationSources);
});

async function userFixture() {
  const userId = randomUUID();
  await sql`insert into users (user_id, name, email, role) values (${userId}, 'Synthetic account', ${`${userId}@example.invalid`}, 'Admin')`;
  const credential = await hashPassword(`Synthetic initial ${randomUUID()}`);
  assert.ok(await repo.updateUserPassword(userId, credential, { expectedPasswordHash: null }));
  return { userId, credential };
}

function session(userId: string): CreateAuthSessionInput {
  return { userId, tokenHash: randomBytes(32).toString("base64url"), expiresAt: new Date(Date.now() + 3600000).toISOString() };
}

test("non-seed migration ledger is complete and creates no cases or sessions", async () => {
  const applied = await sql`select file_name from schema_migrations order by file_name`;
  assert.deepEqual(applied.map((row) => row.file_name), migrationFiles);
  assert.equal((await sql`select count(*)::int as count from cases`)[0].count, 0);
  assert.equal((await sql`select count(*)::int as count from auth_sessions`)[0].count, 0);
  console.log(`Applied ${migrationFiles.length} non-seed migrations from an empty cluster with explicit legacy ownership fixtures; no cases or sessions seeded.`);
});

test("0052 leaves authored legacy works unresolved and preserves existing encryption fields", async () => {
  for (const id of legacyOwnershipIds) assert.equal((await repo.getManuscript(id))?.keyOwnerUserId, null);
  const work = (await repo.getManuscript(legacyOwnershipIds[1]))!;
  assert.ok(work.createdBy);
  assert.equal(work.encryptedWorkKey, "synthetic-old-password-envelope");
  assert.equal(work.recoveryEncryptedWorkKey, "synthetic-old-recovery-envelope");
  // The migration-only schema fixtures use inert marker strings, not decryptable bodies.
  // Real password/key continuity is covered by the shared contract below.
});

test("password change revokes two sessions and retains only the replacement session", async () => {
  const { userId, credential } = await userFixture();
  const first = session(userId), second = session(userId), replacement = session(userId);
  assert.equal(await repo.createAuthSession(first, credential.passwordHash), true);
  assert.equal(await repo.createAuthSession(second, credential.passwordHash), true);
  const next = await hashPassword(`Synthetic replacement ${randomUUID()}`);
  assert.ok(await repo.updateUserPassword(userId, next, { expectedPasswordHash: credential.passwordHash, replacementSession: replacement }));
  assert.equal(await repo.getUserBySessionTokenHash(first.tokenHash), null);
  assert.equal(await repo.getUserBySessionTokenHash(second.tokenHash), null);
  assert.equal((await repo.getUserBySessionTokenHash(replacement.tokenHash))?.userId, userId);
  assert.equal((await repo.getUserCredential(userId))?.passwordHash, next.passwordHash);
});

test("stale credential hashes cannot change a password or create a new session after reset", async () => {
  const { userId, credential } = await userFixture();
  const next = await hashPassword(`Synthetic reset ${randomUUID()}`);
  assert.ok(await repo.updateUserPassword(userId, next));
  const staleSession = session(userId);
  assert.equal(await repo.createAuthSession(staleSession, credential.passwordHash), false);
  assert.equal(await repo.updateUserPassword(userId, credential, { expectedPasswordHash: credential.passwordHash, replacementSession: session(userId) }), null);
  assert.equal(await repo.getUserBySessionTokenHash(staleSession.tokenHash), null);
  assert.equal((await repo.getUserCredential(userId))?.passwordHash, next.passwordHash);
});

test("concurrent compare-and-swap password changes admit exactly one winner", async () => {
  const { userId, credential } = await userFixture();
  const candidates = await Promise.all([hashPassword(`Synthetic candidate A ${randomUUID()}`), hashPassword(`Synthetic candidate B ${randomUUID()}`)]);
  const replacements = [session(userId), session(userId)];
  const results = await Promise.all(candidates.map((next, index) => repo.updateUserPassword(userId, next, { expectedPasswordHash: credential.passwordHash, replacementSession: replacements[index] })));
  assert.equal(results.filter(Boolean).length, 1);
  const winner = results.findIndex(Boolean);
  assert.equal((await repo.getUserCredential(userId))?.passwordHash, candidates[winner].passwordHash);
  assert.equal((await repo.getUserBySessionTokenHash(replacements[winner].tokenHash))?.userId, userId);
  assert.equal(await repo.getUserBySessionTokenHash(replacements[1 - winner].tokenHash), null);
});

test("racing login and password reset never leaves a session verified by the old hash active", async () => {
  const { userId, credential } = await userFixture();
  const pendingLogin = session(userId);
  const next = await hashPassword(`Synthetic racing reset ${randomUUID()}`);
  await Promise.all([
    repo.createAuthSession(pendingLogin, credential.passwordHash),
    repo.updateUserPassword(userId, next, { expectedPasswordHash: credential.passwordHash })
  ]);
  assert.equal(await repo.getUserBySessionTokenHash(pendingLogin.tokenHash), null);
  assert.equal((await repo.getUserCredential(userId))?.passwordHash, next.passwordHash);
});

test("a failing replacement session insert rolls back both password update and revocation", async () => {
  const { userId, credential } = await userFixture();
  const other = await userFixture();
  const first = session(userId), second = session(userId), collision = session(other.userId);
  await repo.createAuthSession(first, credential.passwordHash);
  await repo.createAuthSession(second, credential.passwordHash);
  await repo.createAuthSession(collision, other.credential.passwordHash);
  const next = await hashPassword(`Synthetic rollback ${randomUUID()}`);
  await assert.rejects(repo.updateUserPassword(userId, next, {
    expectedPasswordHash: credential.passwordHash,
    replacementSession: { ...session(userId), tokenHash: collision.tokenHash }
  }), (error: unknown) => (error as { code?: string }).code === "23505");
  assert.equal((await repo.getUserCredential(userId))?.passwordHash, credential.passwordHash);
  assert.equal((await repo.getUserBySessionTokenHash(first.tokenHash))?.userId, userId);
  assert.equal((await repo.getUserBySessionTokenHash(second.tokenHash))?.userId, userId);
  assert.equal((await repo.getUserBySessionTokenHash(collision.tokenHash))?.userId, other.userId);
});

test("the maintenance CLI validates a password and atomically revokes existing sessions on the owned database", async () => {
  const { userId, credential } = await userFixture();
  const first = session(userId), second = session(userId);
  await repo.createAuthSession(first, credential.passwordHash);
  await repo.createAuthSession(second, credential.passwordHash);
  const runCli = async (password: string) => {
    // Postgres.js accepts an empty URL host and takes this launcher's private
    // socket/port from PGHOST/PGPORT. These values are generated, never inherited.
    const child = spawn(process.execPath, [join(root, "scripts", "set-user-password.mjs")], {
      cwd: root,
      env: {
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, NODE_ENV: "test",
        DATABASE_URL: "postgres:///postgres", DATABASE_SSL: "false",
        PGHOST: config.socketDir, PGPORT: String(config.port), PGUSER: config.username, PGPASSWORD: config.password,
        USER_EMAIL: `${userId}@example.invalid`, PASSWORD: password
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const code = await new Promise<number>((done, reject) => {
      child.once("error", reject);
      child.once("exit", (value) => done(value ?? 1));
    });
    assert.equal(output.includes(password), false, "CLI output must not include its supplied password");
    return code;
  };
  assert.equal(await runCli("too-short"), 1);
  assert.equal((await repo.getUserCredential(userId))?.passwordHash, credential.passwordHash);
  assert.equal((await repo.getUserBySessionTokenHash(first.tokenHash))?.userId, userId);
  const password = `Synthetic maintenance password 7 ${randomUUID()}`;
  // This trigger exists only inside the owned disposable database. Fail after
  // the CLI writes the new hash, proving its transaction rolls that write back.
  await sql.unsafe(`
    create function pa_test_fail_cli_revocation() returns trigger language plpgsql as $$
      begin raise exception 'synthetic revocation failure'; end;
    $$;
    create trigger pa_test_fail_cli_revocation before update of revoked_at on auth_sessions
      for each row execute function pa_test_fail_cli_revocation();
  `);
  try {
    assert.equal(await runCli(password), 1);
    assert.equal((await repo.getUserCredential(userId))?.passwordHash, credential.passwordHash);
    assert.equal((await repo.getUserBySessionTokenHash(first.tokenHash))?.userId, userId);
    assert.equal((await repo.getUserBySessionTokenHash(second.tokenHash))?.userId, userId);
  } finally {
    await sql.unsafe("drop trigger pa_test_fail_cli_revocation on auth_sessions; drop function pa_test_fail_cli_revocation()");
  }
  assert.equal(await runCli(password), 0);
  const updated = await repo.getUserCredential(userId);
  assert.ok(updated);
  assert.equal(await verifyPassword(password, updated), true);
  assert.equal(updated.mustChangePassword, true);
  assert.equal(await repo.getUserBySessionTokenHash(first.tokenHash), null);
  assert.equal(await repo.getUserBySessionTokenHash(second.tokenHash), null);
  assert.equal((await repo.getUserById(userId))?.role, "Admin");
});

test("the account CLI creates a temporary-password user and resets credentials without echoing secrets", async () => {
  const email = `household-${randomUUID()}@example.invalid`;
  const firstPassword = `Synthetic household 7 ${randomUUID()}`;
  const nextPassword = `Synthetic changed 8 ${randomUUID()}`;
  const runCli = async (args: string[], password?: string) => {
    const child = spawn(process.execPath, [join(root, "scripts", "manage-users.mjs"), ...args], {
      cwd: root,
      env: {
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, NODE_ENV: "test",
        BUSINESS_TEMPLATE: "personal-archive", DATABASE_URL: "postgres:///postgres", DATABASE_SSL: "false",
        PGHOST: config.socketDir, PGPORT: String(config.port), PGUSER: config.username, PGPASSWORD: config.password
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    child.stdin.end(password ? `${password}\n` : "");
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const code = await new Promise<number>((done, reject) => {
      child.once("error", reject);
      child.once("exit", (value) => done(value ?? 1));
    });
    assert.equal(output.includes(firstPassword) || output.includes(nextPassword), false);
    return { code, output };
  };
  assert.equal((await runCli(["create", "--email", email, "--name", "Household member", "--password-stdin"], firstPassword)).code, 0);
  const [user] = await sql`select user_id, role from users where email = ${email}`;
  assert.equal(user.role, "Staff");
  const first = await repo.getUserCredential(user.user_id);
  assert.equal(first?.mustChangePassword, true);
  assert.equal(await verifyPassword(firstPassword, first!), true);
  const active = session(user.user_id);
  await repo.createAuthSession(active, first!.passwordHash);
  assert.equal((await repo.getUserBySessionTokenHash(active.tokenHash))?.userId, user.user_id);
  assert.equal((await runCli(["create", "--email", email, "--name", "Duplicate", "--password-stdin"], nextPassword)).code, 1);
  assert.equal((await runCli(["reset-password", "--email", email, "--password-stdin"], nextPassword)).code, 0);
  const reset = await repo.getUserCredential(user.user_id);
  assert.equal(reset?.mustChangePassword, true);
  assert.equal(await verifyPassword(firstPassword, reset!), false);
  assert.equal(await verifyPassword(nextPassword, reset!), true);
  assert.equal(await repo.getUserBySessionTokenHash(active.tokenHash), null);
});

test("independent Archive, global Reading & Notes and Knowledge enter real SQL backup snapshots without cases", async () => {
  const { userId } = await userFixture();
  const category = await repo.createArchiveCategory({ categoryId: randomUUID(), name: "合成家庭资料", createdBy: userId });
  const parent = await repo.createArchiveFolder({ folderId: randomUUID(), name: "合成档案", createdBy: userId });
  const child = await repo.createArchiveFolder({ folderId: randomUUID(), name: "阅读", parentFolderId: parent.folderId, createdBy: userId });
  const document = (name: string): CreateDocumentInput => ({ documentId: randomUUID(), caseId: null, fileName: name, originalFileName: name, fileSize: 12, mimeType: "text/plain", category: category.name, folderId: child.folderId, r2ObjectKey: `synthetic/${randomUUID()}/${name}`, uploadedBy: userId, notes: "Synthetic fixture; no object service is accessed." });
  const original = await repo.createDocument(document("章节一.txt"));
  const version = await repo.createDocumentVersion(original.documentId, document("章节一修订.txt"));
  assert.ok(version);
  const image = await repo.createDocument({ ...document("插图.png"), mimeType: "image/png" });
  const trashed = await repo.createDocument(document("回收站.txt"));
  await repo.softDeleteDocument(trashed.documentId, { retainObject: true });
  const topic = await repo.createServiceDiscussionMessage({ createdBy: userId, title: "合成阅读", bodyText: "Global topic" });
  const reply = await repo.createServiceDiscussionMessage({ createdBy: userId, parentMessageId: topic.messageId, bodyText: "Global reply" });
  await repo.createServiceDiscussionAttachment({ messageId: reply.messageId, documentId: image.documentId, inlineImage: true });
  // Exceed a usual UI page so a paginated list cannot silently stand in for a backup query.
  for (let index = 0; index < 101; index += 1) await repo.createServiceDiscussionMessage({ createdBy: userId, bodyText: `Synthetic global note ${index}` });
  const knowledge = await repo.createKnowledge({ title: "独立合成知识", type: "Reference", status: "Verified", component: "", summary: "", body: "Knowledge body", createdBy: userId });
  for (const scope of ["all-cases", "updated-since-last-run"] as const) {
    const snapshot = await repo.buildBackupSnapshot(scope);
    assert.equal(snapshot.cases.length, 0);
    assert.deepEqual(snapshot.documents.map((item) => item.documentId).sort(),
      [original.documentId, version.current.documentId, image.documentId, legacyArchive.original, legacyArchive.next, legacyArchive.unknown].sort());
    assert.equal(snapshot.documents.find((item) => item.documentId === original.documentId)?.isCurrentVersion, false);
    assert.equal(snapshot.archiveFolders.find((item) => item.folderId === child.folderId)?.parentFolderId, parent.folderId);
    assert.ok(snapshot.archiveCategories.some((item) => item.categoryId === category.categoryId));
    assert.equal(snapshot.discussion.length, 103);
    assert.equal(snapshot.discussion.find((item) => item.messageId === reply.messageId)?.attachments[0]?.documentId, image.documentId);
    assert.equal(snapshot.knowledge.find((item) => item.knowledgeId === knowledge.knowledgeId)?.body, "Knowledge body");
    assert.equal(snapshot.metadataRows, Object.values(snapshot).reduce((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0));
  }
  const closed = await repo.buildBackupSnapshot("closed-cases");
  assert.deepEqual(closed.documents, []);
  assert.deepEqual(closed.discussion, []);
  assert.deepEqual(closed.knowledge, []);
  assert.deepEqual(closed.archiveFolders, []);
  assert.deepEqual(closed.archiveCategories, []);
  const tables = await repo.exportDatabaseTables();
  assert.equal(tables.tables.find((table) => table.tableName === "archive_folders")?.rowCount, 3);
  assert.ok(tables.tables.find((table) => table.tableName === "archive_categories")?.rows.some((row) => row.category_id === category.categoryId));
});

test("real SQL backup includes current long-writing chapter bodies and historical versions", async () => {
  const { userId } = await userFixture();
  const manuscript = await repo.createManuscript({ title: "合成长文", kind: "Long document", status: "Draft", description: "Synthetic work", createdBy: userId });
  const chapter = await repo.createManuscriptChapter({ manuscriptId: manuscript.manuscriptId, title: "第一章", body: "Synthetic original chapter body", contentFormat: "markdown" });
  assert.ok(await repo.updateManuscriptChapter(manuscript.manuscriptId, chapter.chapterId, { body: "Synthetic revised chapter body", expectedRevision: chapter.revision, updatedBy: userId, saveSource: "manual" }));
  for (const scope of ["all-cases", "updated-since-last-run", "closed-cases"] as const) {
    const snapshot = await repo.buildBackupSnapshot(scope);
    assert.equal(snapshot.manuscriptChapters.find((item) => item.chapterId === chapter.chapterId)?.body, "Synthetic revised chapter body");
    assert.ok(snapshot.manuscriptChapterVersions.some((item) => item.chapterId === chapter.chapterId && item.body === "Synthetic original chapter body"));
    assert.ok(snapshot.manuscripts.find((item) => item.manuscriptId === manuscript.manuscriptId)?.chapters.some((item) => item.chapterId === chapter.chapterId));
  }
});

test("PostgreSQL cleanup lifecycle matches memory across retained references, retries and worker crashes", async () => {
  const { userId } = await userFixture();
  await storageCleanupContract(repo, userId, async (ms) => {
    await sql`update storage_cleanup_jobs set next_attempt_at = next_attempt_at - ${ms} * interval '1 millisecond',
      lease_expires_at = lease_expires_at - ${ms} * interval '1 millisecond'`;
  });
});

test("outbox failure rolls back a complete version-group purge; SQL cascades enqueue Vault objects", async () => {
  const { userId } = await userFixture();
  const original = await repo.createDocument(cleanupDocumentInput(userId));
  const version = await repo.createDocumentVersion(original.documentId, cleanupDocumentInput(userId));
  assert.ok(version);
  await repo.softDeleteDocument(original.documentId, { retainObject: true, entireGroup: true });
  await sql`create function pa_test_reject_cleanup() returns trigger language plpgsql as $$
    begin raise exception 'Synthetic outbox failure'; end; $$`;
  await sql`create trigger pa_test_reject_cleanup before insert on storage_cleanup_jobs
    for each row execute function pa_test_reject_cleanup()`;
  try {
    await assert.rejects(repo.purgeDocument(original.documentId), /Synthetic outbox failure/);
    for (const item of [original, version.current]) {
      assert.ok((await repo.getDocument(item.documentId, { includeDeleted: true }))?.deletedAt);
      assert.equal((await sql`select count(*)::int as count from storage_cleanup_jobs where object_key = ${item.r2ObjectKey}`)[0].count, 0);
    }
  } finally {
    await sql`drop trigger pa_test_reject_cleanup on storage_cleanup_jobs`;
    await sql`drop function pa_test_reject_cleanup()`;
  }
  assert.equal((await repo.purgeDocument(original.documentId)).length, 2);
  const vault = await repo.createPrivateVault({ vaultId: randomUUID(), ownerUserId: userId, encryptionVersion: 1,
    encryptionKdf: 'PBKDF2-SHA-256', encryptionIterations: 600000, encryptionSalt: 'synthetic',
    encryptedVaultKey: 'synthetic', recoveryEncryptedVaultKey: 'synthetic' });
  const key = `synthetic-cleanup/${randomUUID()}`;
  await repo.createPrivateVaultItem({ itemId: randomUUID(), vaultId: vault.vaultId, encryptionVersion: 1,
    encryptedMetadata: 'synthetic', wrappedFileKey: 'synthetic', objectKey: key, ciphertextSize: 0 });
  await sql`delete from private_vaults where vault_id = ${vault.vaultId}`;
  assert.ok((await repo.listPendingStorageCleanupJobs(100)).some((job) => job.objectKey === key));
});

test("a reference waiting on deletion intent rechecks the committed retirement; stale snapshots are refused", async () => {
  const { userId } = await userFixture();
  const key = `synthetic-cleanup/${randomUUID()}`;
  await repo.enqueueStorageCleanup(key);
  const holder = await sql.reserve();
  let pending: Promise<unknown> | undefined;
  try {
    await holder`begin`;
    await holder`select pg_advisory_xact_lock(hashtextextended(${key}, 1885430630))`;
    await holder`update storage_cleanup_jobs set started_at = now() where object_key = ${key}`;
    pending = assert.rejects(repo.createDocument(cleanupDocumentInput(userId, key)), /retired/);
    const deadline = Date.now() + 5000;
    while (!(await sql`select count(*)::int as count from pg_locks where locktype = 'advisory' and not granted`)[0].count) {
      assert.ok(Date.now() < deadline, "reference INSERT must actually wait on the worker lock");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await holder`commit`;
    await pending;
    assert.equal((await sql`select count(*)::int as count from documents where r2_object_key = ${key}`)[0].count, 0);
    await assert.rejects(sql.begin('isolation level repeatable read', async (tx) => {
      const input = cleanupDocumentInput(userId);
      await tx`insert into documents (document_id, file_name, original_file_name, file_size, mime_type, category, r2_object_key, uploaded_by)
        values (${input.documentId}, 'synthetic', 'synthetic', 0, 'text/plain', 'Other', ${input.r2ObjectKey}, ${userId})`;
    }), /READ COMMITTED/);
  } finally {
    await holder`rollback`;
    holder.release();
    await pending;
  }
});

test("PostgreSQL folder recovery matches memory for hierarchy, versions, conflicts and prior trash", async () => {
  const { userId } = await userFixture();
  await archiveFolderContract(repo, userId);
});

test("concurrent folder moves cannot create a cycle and uploads cannot remain active inside deleted folders", async () => {
  const { userId } = await userFixture();
  const create = (name: string) => repo.createArchiveFolder({ folderId: randomUUID(), name, createdBy: userId });
  const left = await create(`Synthetic left ${randomUUID()}`), right = await create(`Synthetic right ${randomUUID()}`);
  const results = await Promise.allSettled([
    repo.updateArchiveFolder(left.folderId, { parentFolderId: right.folderId }),
    repo.updateArchiveFolder(right.folderId, { parentFolderId: left.folderId })
  ]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(results.filter((item) => item.status === 'rejected').length, 1);
  const target = await create(`Synthetic upload race ${randomUUID()}`);
  const retainedChild = await repo.createArchiveFolder({ folderId: randomUUID(), name: 'Synthetic retained child', parentFolderId: target.folderId, createdBy: userId });
  await assert.rejects(sql`update archive_folders set deleted_at = now() where folder_id = ${target.folderId}`, /complete folder tree/);
  assert.ok(await repo.getArchiveFolder(retainedChild.folderId));
  const input = { ...cleanupDocumentInput(userId), folderId: target.folderId };
  const race = await Promise.allSettled([repo.createDocument(input), repo.deleteArchiveFolder(target.folderId)]);
  assert.equal(race[1].status, 'fulfilled');
  const doc = await repo.getDocument(input.documentId, { includeDeleted: true });
  assert.ok(!doc || doc.deletedAt);
  assert.equal((await sql`select count(*)::int as count from documents d join archive_folders af on af.folder_id = d.folder_id
    where af.deleted_at is not null and d.deleted_at is null`)[0].count, 0);
});

test("a failed subtree restore rolls back the root and already restored children", async () => {
  const { userId } = await userFixture();
  const parent = await repo.createArchiveFolder({ folderId: randomUUID(), name: `Synthetic rollback ${randomUUID()}`, createdBy: userId });
  const child = await repo.createArchiveFolder({ folderId: randomUUID(), name: 'Synthetic blocked child', parentFolderId: parent.folderId, createdBy: userId });
  await repo.deleteArchiveFolder(parent.folderId);
  await sql`create function pa_test_reject_folder_restore() returns trigger language plpgsql as $$ begin
    if new.name = 'Synthetic blocked child' and new.deleted_at is null then raise exception 'Synthetic restore failure'; end if;
    return new; end; $$`;
  await sql`create trigger pa_test_reject_folder_restore before update on archive_folders for each row execute function pa_test_reject_folder_restore()`;
  try {
    await assert.rejects(repo.restoreArchiveFolder(parent.folderId), /Synthetic restore failure/);
    assert.equal(await repo.getArchiveFolder(parent.folderId), null);
    assert.equal(await repo.getArchiveFolder(child.folderId), null);
  } finally {
    await sql`drop trigger pa_test_reject_folder_restore on archive_folders`;
    await sql`drop function pa_test_reject_folder_restore()`;
  }
  assert.ok(await repo.restoreArchiveFolder(parent.folderId));
});

test("purge rechecks trash after a concurrent restore commits", async () => {
  const { userId } = await userFixture();
  const document = await repo.createDocument(cleanupDocumentInput(userId));
  await repo.softDeleteDocument(document.documentId, { retainObject: true });
  const holder = await sql.reserve();
  let pending: Promise<unknown> | undefined;
  try {
    await holder`begin`;
    await holder`select pg_advisory_xact_lock(1885430627, 1885430631)`;
    await holder`update documents set deleted_at = null where document_id = ${document.documentId}`;
    pending = repo.purgeDocument(document.documentId);
    const deadline = Date.now() + 5000;
    while (!(await sql`select count(*)::int as count from pg_locks where locktype = 'advisory' and not granted`)[0].count) {
      assert.ok(Date.now() < deadline, 'purge must actually wait for the concurrent restore');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await holder`commit`;
    assert.deepEqual(await pending, []);
    assert.ok(await repo.getDocument(document.documentId));
    assert.ok(!(await repo.listPendingStorageCleanupJobs(100)).some((job) => job.objectKey === document.r2ObjectKey));
  } finally {
    await holder`rollback`;
    holder.release();
    await pending;
  }
});

test("PostgreSQL ownership contract matches memory with exact timestamps and concurrent claims", async () => {
  const owner = await userFixture(), other = await userFixture();
  await keyOwnershipContract(repo, owner.userId, other.userId);
});

test("PostgreSQL Vault ownership and mixed-account batch rollback match memory", async () => {
  const owner = await userFixture(), other = await userFixture();
  await vaultScopeContract(repo, owner.userId, other.userId);
});

test("SQL ownership guards forbid silent transfer, unaudited claims and partial audit commits", async () => {
  const owner = await userFixture(), other = await userFixture();
  const owned = await repo.createManuscript({ title: "Synthetic immutable ownership", kind: "Novel", status: "Draft", createdBy: owner.userId });
  await sql`update manuscripts set created_by = ${other.userId} where manuscript_id = ${owned.manuscriptId}`;
  assert.equal((await repo.getManuscript(owned.manuscriptId))?.keyOwnerUserId, owner.userId);
  await assert.rejects(sql`update manuscripts set key_owner_user_id = ${other.userId} where manuscript_id = ${owned.manuscriptId}`, /immutable/);
  await assert.rejects(sql`update manuscripts set key_owner_user_id = null where manuscript_id = ${owned.manuscriptId}`, /immutable/);
  await assert.rejects(sql`delete from users where user_id = ${owner.userId}`, /foreign key/);
  const unresolved = await repo.createManuscript({ title: "Synthetic rollback claim", kind: "Novel", status: "Draft" });
  await assert.rejects(sql`update manuscripts set key_owner_user_id = ${owner.userId} where manuscript_id = ${unresolved.manuscriptId}`, /audited/);
  const review = (await repo.listUnresolvedManuscriptKeyOwnership()).find((item) => item.manuscriptId === unresolved.manuscriptId)!;
  const claim = { manuscriptId: unresolved.manuscriptId, ownerUserId: owner.userId, expectedUpdatedAt: review.expectedUpdatedAt,
    evidenceReference: "synthetic-review/rollback", operatorReference: "synthetic-maintainer" };
  await sql.unsafe("create function pa_reject_synthetic_claim() returns trigger language plpgsql as $$ begin raise exception 'Synthetic audit failure'; end; $$");
  await sql.unsafe("create trigger pa_reject_synthetic_claim before insert on manuscript_key_owner_claims for each row execute function pa_reject_synthetic_claim()");
  try { await assert.rejects(repo.claimManuscriptKeyOwner(claim), /Synthetic audit failure/); }
  finally {
    await sql.unsafe("drop trigger pa_reject_synthetic_claim on manuscript_key_owner_claims");
    await sql.unsafe("drop function pa_reject_synthetic_claim()");
  }
  assert.equal((await repo.getManuscript(unresolved.manuscriptId))?.keyOwnerUserId, null);
  assert.equal((await sql`select count(*)::int as count from manuscript_key_owner_claims where manuscript_id = ${unresolved.manuscriptId}`)[0].count, 0);
  await assert.rejects(sql`insert into manuscript_key_owner_claims
    (claim_id, manuscript_id, owner_user_id, previous_updated_at, evidence_reference, operator_reference)
    values (${randomUUID()}, ${unresolved.manuscriptId}, ${owner.userId}, ${review.expectedUpdatedAt}::text::timestamptz, 'synthetic-review/unpaired', 'synthetic-maintainer')`, /commit with its owner/);
  await repo.claimManuscriptKeyOwner(claim);
  await assert.rejects(sql`delete from manuscript_key_owner_claims where manuscript_id = ${unresolved.manuscriptId}`, /immutable/);
  await assert.rejects(sql`update manuscript_key_owner_claims set evidence_reference = 'rewritten' where manuscript_id = ${unresolved.manuscriptId}`, /immutable/);
});

test("bundled maintenance CLI previews without mutation and requires an explicit stopped-writers apply", { timeout: 30000 }, async () => {
  const { userId } = await userFixture();
  await exerciseKeyOwnershipCli(repo, userId, config);
});

test("0053 backfills only first-version evidence and makes file/folder management ownership immutable", async () => {
  for (const id of [legacyArchive.original, legacyArchive.next]) assert.equal((await repo.getDocument(id))?.managementOwnerUserId, legacyArchive.owner);
  assert.equal((await repo.getDocument(legacyArchive.unknown))?.managementOwnerUserId, null);
  assert.equal((await repo.getArchiveFolder(legacyArchive.folder))?.managementOwnerUserId, legacyArchive.owner);
  await assert.rejects(sql`update documents set management_owner_user_id = ${legacyArchive.other} where document_id = ${legacyArchive.original}`, /immutable/);
  await assert.rejects(sql`update documents set document_group_id = ${randomUUID()} where document_id = ${legacyArchive.original}`, /immutable/);
  await assert.rejects(sql`update archive_folders set management_owner_user_id = null where folder_id = ${legacyArchive.folder}`, /immutable/);
  await sql`update documents set uploaded_by = ${legacyArchive.other} where document_id = ${legacyArchive.original}`;
  assert.equal((await repo.getDocument(legacyArchive.original))?.managementOwnerUserId, legacyArchive.owner);
});

test("PostgreSQL file/folder authorization and session-bound management match memory", async () => {
  const ids = { owner: randomUUID(), other: randomUUID(), admin: randomUUID(), staff: randomUUID(), readonly: randomUUID() };
  for (const [key, id] of Object.entries(ids)) {
    const role = key === "admin" ? "Admin" : key === "staff" ? "Staff" : key === "readonly" ? "ReadOnly" : "Manager";
    await sql`insert into users (user_id, name, email, role) values (${id}, 'Synthetic archive member', ${`${id}@example.invalid`}, ${role})`;
  }
  await archiveManagementContract(repo, ids);
});

test("PostgreSQL rejects stale reauthentication and rolls back a delegated version on audit failure", async () => {
  const { userId, credential } = await userFixture();
  const record = await repo.createDocument(cleanupDocumentInput(legacyArchive.owner));
  const token = session(userId);
  await repo.createAuthSession(token);
  const access = { userId, sessionTokenHash: token.tokenHash };
  const scoped = withArchiveManagementAccess(repo, access);
  await repo.setArchiveManagementVerification(access, credential.passwordHash);
  await sql`update auth_sessions set archive_management_verified_until = clock_timestamp() - interval '1 second' where token_hash = ${token.tokenHash}`;
  await assert.rejects(scoped.updateDocument(record.documentId, { notes: "Expired grant" }), forbidden);
  assert.ok(await scoped.createDocument(cleanupDocumentInput(userId)), "expired management grant does not block own uploads");
  await repo.setArchiveManagementVerification(access, credential.passwordHash);
  await sql.unsafe("create function pa_fail_archive_audit() returns trigger language plpgsql as $$ begin raise exception 'Synthetic management audit failure'; end; $$");
  await sql.unsafe("create trigger pa_fail_archive_audit before insert on archive_management_audit for each row execute function pa_fail_archive_audit()");
  try {
    await assert.rejects(scoped.createDocumentVersion(record.documentId, cleanupDocumentInput(userId)), /Synthetic management audit failure/);
    assert.equal((await repo.listDocumentVersions(record.documentId)).length, 1);
    assert.equal((await repo.getDocument(record.documentId))?.isCurrentVersion, true);
  } finally {
    await sql.unsafe("drop trigger pa_fail_archive_audit on archive_management_audit");
    await sql.unsafe("drop function pa_fail_archive_audit()");
  }
  await scoped.updateDocument(record.documentId, { notes: "Audited management" });
  await assert.rejects(sql`delete from archive_management_audit where actor_user_id = ${userId}`, /immutable/);
  const oldHash = credential.passwordHash;
  await repo.updateUserPassword(userId, await hashPassword("SyntheticNewArchiveCredential2026"));
  assert.equal(await repo.setArchiveManagementVerification(access, oldHash), null);
});

test("waiting directory authorization sees a concurrent foreign child and rolls back the whole request", async () => {
  const { userId } = await userFixture();
  await sql`update users set role = 'Manager' where user_id = ${userId}`;
  const rootFolder = await repo.createArchiveFolder({ folderId: randomUUID(), name: randomUUID(), createdBy: userId });
  const token = session(userId);
  await repo.createAuthSession(token);
  const scoped = withArchiveManagementAccess(repo, { userId, sessionTokenHash: token.tokenHash });
  const holder = await sql.reserve();
  let pending: Promise<unknown> | undefined;
  try {
    await holder`begin`;
    await holder`select pg_advisory_xact_lock(1885430627, 1885430631)`;
    pending = scoped.deleteArchiveFolder(rootFolder.folderId);
    // Attach the rejection handler before yielding to concurrent SQL.
    const denied = assert.rejects(pending, forbidden);
    const childId = randomUUID();
    await holder`insert into archive_folders (folder_id, name, parent_folder_id, created_by)
      values (${childId}, 'Synthetic concurrent foreign child', ${rootFolder.folderId}, ${legacyArchive.owner})`;
    await holder`commit`;
    await denied;
    assert.ok(await repo.getArchiveFolder(rootFolder.folderId));
    assert.ok(await repo.getArchiveFolder(childId));
  } finally {
    await holder`rollback`;
    holder.release();
    await pending?.catch(() => undefined);
  }
});

test("0054 backfills ordinary authors without claiming keys, retains legacy image references and rejects ownership transfers", async () => {
  const work = (await repo.getManuscript(legacyOwnershipIds[0]))!;
  assert.equal(work.managementOwnerUserId, work.createdBy);
  assert.equal(work.keyOwnerUserId, null);
  assert.deepEqual(await repo.readArchiveContentDocumentIds("manuscript", work.manuscriptId), [legacyArchive.original]);
  await assert.rejects(sql`update manuscripts set management_owner_user_id = ${legacyArchive.other} where manuscript_id = ${work.manuscriptId}`, /immutable/);
  await sql`update manuscripts set created_by = ${legacyArchive.other} where manuscript_id = ${work.manuscriptId}`;
  assert.equal((await repo.getManuscript(work.manuscriptId))?.managementOwnerUserId, work.managementOwnerUserId);
  await assert.rejects(sql`delete from archive_content_document_references where content_id = ${work.manuscriptId}`, /immutable/);
  await assert.rejects(sql`delete from documents where document_id = ${legacyArchive.original}`, /foreign key|Referenced/);
});

test("PostgreSQL content ownership, retained body references and concurrent chapter deletion match memory", async () => {
  const ids = { owner: randomUUID(), other: randomUUID(), admin: randomUUID(), staff: randomUUID(), readonly: randomUUID() };
  for (const [key, id] of Object.entries(ids)) {
    const role = key === "admin" ? "Admin" : key === "staff" ? "Staff" : key === "readonly" ? "ReadOnly" : "Manager";
    await sql`insert into users (user_id, name, email, role) values (${id}, 'Synthetic content member', ${`${id}@example.invalid`}, ${role})`;
  }
  const { note } = await archiveContentContract(repo, ids);
  await assert.rejects(sql`update service_discussion_messages set management_owner_user_id = ${ids.other} where message_id = ${note.messageId}`, /immutable/);
  const knowledge = await repo.createKnowledge({ title: "Synthetic immutable Knowledge", type: "Reference", status: "Draft", component: "", summary: "", body: "", createdBy: ids.owner });
  await assert.rejects(sql`update knowledge_items set management_owner_user_id = ${ids.other} where knowledge_id = ${knowledge.knowledgeId}`, /immutable/);
});

test("waiting body save observes changed encryption before writing and delegated body audit failure rolls back references and history", async () => {
  const { userId, credential } = await userFixture();
  const token = session(userId);
  await repo.createAuthSession(token);
  const access = { userId, sessionTokenHash: token.tokenHash }, scoped = withArchiveManagementAccess(repo, access);
  const work = await repo.createManuscript({ title: "Synthetic transactional body", kind: "Novel", status: "Draft", createdBy: legacyArchive.owner });
  const chapterId = work.chapters[0].chapterId;
  const holder = await sql.reserve();
  let pending: Promise<unknown> | undefined;
  try {
    await holder`begin`;
    await holder`select pg_advisory_xact_lock(1885430627, 1885430631)`;
    pending = scoped.updateManuscriptChapter(work.manuscriptId, chapterId, { body: "Stale plaintext" });
    const denied = assert.rejects(pending, /encryption changed/);
    await holder`update manuscripts set encryption_enabled = true, encryption_version = 1, encryption_kdf = 'PBKDF2-SHA-256',
      encryption_iterations = 600000, encryption_salt = 'synthetic-race-salt', encrypted_work_key = 'synthetic-race-envelope',
      recovery_encrypted_work_key = 'synthetic-race-recovery' where manuscript_id = ${work.manuscriptId}`;
    await holder`commit`;
    await denied;
  } finally {
    await holder`rollback`;
    holder.release();
    await pending?.catch(() => undefined);
  }
  assert.equal((await repo.getManuscriptChapter(work.manuscriptId, chapterId))?.body, "");
  await sql`update manuscripts set encryption_enabled = false, encryption_version = null, encryption_kdf = null,
    encryption_iterations = null, encryption_salt = null, encrypted_work_key = null, recovery_encrypted_work_key = null
    where manuscript_id = ${work.manuscriptId}`;
  await repo.setArchiveManagementVerification(access, credential.passwordHash);
  const file = await repo.createDocument(cleanupDocumentInput(userId));
  await sql.unsafe("create function pa_fail_body_audit() returns trigger language plpgsql as $$ begin raise exception 'Synthetic body audit failure'; end; $$");
  await sql.unsafe("create trigger pa_fail_body_audit before insert on archive_management_audit for each row execute function pa_fail_body_audit()");
  try {
    await assert.rejects(scoped.updateManuscriptChapter(work.manuscriptId, chapterId, { body: `/api/documents/${file.documentId}/preview` }), /Synthetic body audit failure/);
    assert.equal((await repo.getManuscriptChapter(work.manuscriptId, chapterId))?.body, "");
    assert.deepEqual(await repo.readArchiveContentDocumentIds("manuscript", work.manuscriptId), []);
    assert.deepEqual(await repo.listManuscriptChapterVersions(work.manuscriptId, chapterId), []);
    await assert.rejects(scoped.createManuscriptDocument(work.manuscriptId, cleanupDocumentInput(userId)), /Synthetic body audit failure/);
  } finally {
    await sql.unsafe("drop trigger pa_fail_body_audit on archive_management_audit");
    await sql.unsafe("drop function pa_fail_body_audit()");
  }
  await scoped.softDeleteDocument(file.documentId, { retainObject: true });
  await assert.rejects(scoped.purgeDocument(file.documentId), /encrypted writing references/);
});

test("offline encrypted bundle restores synthetic SQL, all objects and recovery keys into an empty database", { timeout: 60000 }, async () => {
  await runRecoveryExercise(sql, repo, config);
});
