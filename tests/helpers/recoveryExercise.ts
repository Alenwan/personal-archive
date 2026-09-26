import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, lstat } from "node:fs/promises";
import { join, dirname } from "node:path";
import postgres from "postgres";
import { createRecoveryBundle, restoreRecoveryBundle, verifyRecoveryBundle } from "../../src/server/services/recoveryBundle";
import { PostgresRepository } from "../../src/server/repositories/postgres";
import type { DocumentStorage } from "../../src/server/storage/documentStorage";
import { hashPassword } from "../../src/server/auth/password";
import { createPrivateVaultEncryption, encryptPrivateVaultFile, unlockPrivateVault, decryptPrivateVaultBlob, decryptPrivateVaultItemMetadata, encryptPrivateVaultFolderMetadata, decryptPrivateVaultFolderMetadata } from "../../src/shared/privateVaultEncryption";
import { wrapPrivateVaultRecoveryKey, unwrapPrivateVaultRecoveryKey } from "../../src/server/services/privateVaultRecoveryCrypto";
import { createManuscriptEncryption, encryptManuscriptBody, decryptManuscriptBody, unlockManuscriptWithPassword } from "../../src/shared/manuscriptEncryption";
import { wrapManuscriptRecoveryKey, unwrapManuscriptRecoveryKey } from "../../src/server/services/manuscriptRecoveryCrypto";
import { checkSchema, readMigrations } from "../../src/server/services/schemaMigrations";

interface OwnedConfig { runDir: string; socketDir: string; port: number; username: string; password: string; clientBinDir: string; root: string }
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

// A filesystem test double for the DocumentStorage contract. Metadata is kept
// in a separate fixture index, and every payload is read back from an owned
// temporary file. This is not a new production attachment backend.
class FixtureObjects implements DocumentStorage {
  readonly entries = new Map<string, { size: number; contentType: string }>();
  constructor(private directory: string) {}
  async put(key: string, bytes: ArrayBuffer, contentType: string) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(join(this.directory, hash(key)), new Uint8Array(bytes), { mode: 0o600 });
    this.entries.set(key, { size: bytes.byteLength, contentType });
  }
  async get(key: string) {
    const item = this.entries.get(key);
    if (!item) return null;
    const bytes = await readFile(join(this.directory, hash(key)));
    return { body: new Blob([bytes]).stream(), contentType: item.contentType };
  }
  async delete(key: string) { this.entries.delete(key); }
  async list() { return [...this.entries].map(([key, { size }]) => ({ key, size })); }
  async usage() { return { bytes: [...this.entries.values()].reduce((total, item) => total + item.size, 0), objectCount: this.entries.size }; }
}

export async function runRecoveryExercise(sql: postgres.Sql, repo: PostgresRepository, config: OwnedConfig) {
  const source = { documents: new FixtureObjects(join(config.runDir, "source-documents")), backups: new FixtureObjects(join(config.runDir, "source-backups")) };
  const secrets = { MANUSCRIPT_RECOVERY_KEY: randomBytes(32).toString("hex"), PRIVATE_VAULT_RECOVERY_KEY: randomBytes(32).toString("hex"), CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("hex") };
  const vaults = [];
  for (let index = 0; index < 2; index++) {
    const userId = randomUUID(), vaultId = randomUUID(), itemId = randomUUID(), folderId = randomUUID();
    const password = `Synthetic vault ${index} password 2026`;
    await sql`insert into users (user_id, name, email, role) values (${userId}, 'Recovery fixture', ${`${userId}@example.invalid`}, 'Admin')`;
    await repo.updateUserPassword(userId, await hashPassword(`Synthetic account ${index} password 2026`));
    const protectedVault = await createPrivateVaultEncryption(password);
    await repo.createPrivateVault({ vaultId, ownerUserId: userId, ...protectedVault.metadata, recoveryEncryptedVaultKey: await wrapPrivateVaultRecoveryKey(protectedVault.recoveryVaultKey, vaultId, userId, secrets) });
    await repo.createPrivateVaultFolder({ vaultId, folderId, encryptionVersion: 1, encryptedMetadata: encryptPrivateVaultFolderMetadata(protectedVault.vaultKey, vaultId, folderId, { name: `合成私密目录${index}`, parentFolderId: null, favorite: false }) });
    const plaintext = `Synthetic private file for owner ${index}`;
    const encrypted = await encryptPrivateVaultFile(protectedVault.vaultKey, vaultId, itemId, new File([plaintext], `私密资料${index}.txt`, { type: "text/plain" }), { folderId });
    const objectKey = `vault/${vaultId}/${itemId}`;
    await source.documents.put(objectKey, await encrypted.encryptedFile.arrayBuffer(), "application/octet-stream");
    await repo.createPrivateVaultItem({ vaultId, itemId, objectKey, encryptionVersion: 1, encryptedMetadata: encrypted.encryptedMetadata, wrappedFileKey: encrypted.wrappedFileKey, ciphertextSize: encrypted.encryptedFile.size });
    vaults.push({ userId, itemId, folderId, password, plaintext });
  }
  const owner = vaults[0].userId;
  const protectedWork = await repo.createManuscript({ title: "合成加密长文", kind: "Novel", status: "Draft", description: "", createdBy: owner });
  const encryption = await createManuscriptEncryption("Synthetic work password 2026");
  const chapter = await repo.getManuscriptChapter(protectedWork.manuscriptId, protectedWork.chapters[0].chapterId);
  assert.ok(chapter);
  const protectedBody = await encryptManuscriptBody(encryption.workKey, protectedWork.manuscriptId, chapter.chapterId, "Synthetic encrypted chapter");
  await repo.replaceManuscriptBodyEncryption(protectedWork.manuscriptId, { chapters: [{ chapterId: chapter.chapterId, expectedRevision: chapter.revision, body: protectedBody }], versions: [], metadata: { ...encryption.metadata, recoveryEncryptedWorkKey: await wrapManuscriptRecoveryKey(encryption.recoveryWorkKey, protectedWork.manuscriptId, secrets) } }, true, owner);
  const folders = await repo.listArchiveFolders();
  const child = folders.find((item) => item.parentFolderId);
  assert.ok(child);
  await repo.createArchiveFolder({ folderId: randomUUID(), name: "第三层合成目录", parentFolderId: child.folderId, createdBy: owner });
  // Fill every existing synthetic document reference, including the trashed
  // original and old versions produced by the earlier real repository tests.
  const documents = await sql`select document_id, r2_object_key, mime_type from documents`;
  for (const document of documents) {
    const bytes = document.mime_type === "image/png"
      ? Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1kAAAAASUVORK5CYII=", "base64")
      : Buffer.from(`合成原件 ${document.document_id}`);
    await source.documents.put(document.r2_object_key, Uint8Array.from(bytes).buffer, document.mime_type);
    await sql`update documents set file_size = ${bytes.length} where document_id = ${document.document_id}`;
  }
  await source.backups.put("forgejo/synthetic/index.json", new TextEncoder().encode('{"synthetic":true,"offline":true}').buffer, "application/json");
  const zip = Uint8Array.from([80, 75, 5, 6, ...Array(18).fill(0)]);
  await source.backups.put("forgejo/synthetic/snapshot.zip", zip.buffer, "application/zip");
  // No application or cleanup worker has been started for this owned source.
  let writesStopped = true;
  const assertQuiescent = async () => { assert.equal(writesStopped, true); };
  const runNative = async (name: string, args: string[]) => {
    const executable = join(config.clientBinDir, name);
    assert.ok((await lstat(executable)).isFile());
    const child = spawn(executable, args, { cwd: config.runDir, env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, PGHOST: config.socketDir, PGPORT: String(config.port), PGUSER: config.username, PGPASSWORD: config.password }, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.resume();
    const code = await new Promise<number>((resolve, reject) => { child.once("error", reject); child.once("exit", (code) => resolve(code ?? 1)); });
    assert.equal(code, 0, `${name} failed in the owned fixture`);
    return Buffer.concat(chunks);
  };
  const dumpDatabase = () => runNative("pg_dump", ["--format=custom", "--compress=0", "--no-owner", "--no-acl", "--dbname=postgres"]);
  const tableNames = (await sql`select tablename from pg_tables where schemaname = 'public' order by tablename`).map((row) => row.tablename as string);
  const tableRows = async (connection: postgres.Sql) => {
    const result = new Map<string, string[]>();
    for (const table of tableNames) {
      const rows = await connection`select row_to_json(t)::text as value from ${connection(table)} t`;
      result.set(table, rows.map((row) => row.value as string).sort());
    }
    return result;
  };
  const expectedRows = await tableRows(sql);
  const directory = join(config.runDir, "recovery-complete"), bundleKey = randomBytes(32);
  await createRecoveryBundle({ directory, bundleKey, stores: source, configuration: secrets, assertQuiescent, dumpDatabase });
  await assert.rejects(createRecoveryBundle({ directory, bundleKey, stores: source, configuration: secrets, assertQuiescent, dumpDatabase }), /exist/);
  const verified = await verifyRecoveryBundle(directory, bundleKey);
  assert.deepEqual(verified.configuration, secrets);
  assert.ok(!JSON.stringify(verified.manifest).includes(secrets.MANUSCRIPT_RECOVERY_KEY));
  const goodManifestHash = hash(await readFile(join(directory, "manifest.json")));
  // Failure after partial collection cannot create a completion manifest or
  // change the last valid bundle; there are no source cleanup operations.
  const failedDirectory = join(config.runDir, "recovery-interrupted");
  writesStopped = false;
  await assert.rejects(createRecoveryBundle({ directory: failedDirectory, bundleKey, stores: source, configuration: secrets, assertQuiescent, dumpDatabase }));
  writesStopped = true;
  const incomplete = { ...source, documents: { ...source.documents, list: () => source.documents.list(), get: async () => null, put: source.documents.put.bind(source.documents), delete: source.documents.delete.bind(source.documents), usage: source.documents.usage.bind(source.documents) } };
  await assert.rejects(createRecoveryBundle({ directory: failedDirectory, bundleKey, stores: incomplete, configuration: secrets, assertQuiescent, dumpDatabase }), /missing/);
  await assert.rejects(readFile(join(failedDirectory, "manifest.json")));
  assert.equal(hash(await readFile(join(directory, "manifest.json"))), goodManifestHash);
  const destination = { documents: new FixtureObjects(join(config.runDir, "restored-documents")), backups: new FixtureObjects(join(config.runDir, "restored-backups")) };
  const databaseName = `pa_recovery_${randomBytes(8).toString("hex")}`;
  await sql`create database ${sql(databaseName)}`;
  const restoredSql = postgres({ host: config.socketDir, port: config.port, username: config.username, password: config.password, database: databaseName, ssl: false, onnotice: () => {} });
  const restore = {
    directory, bundleKey, stores: destination,
    assertEmptyDatabase: async () => { assert.equal((await restoredSql`select count(*)::int as count from pg_tables where schemaname='public'`)[0].count, 0); },
    restoreDatabase: async (dump: Uint8Array) => { const path = join(config.runDir, "restore.dump"); await writeFile(path, dump, { mode: 0o600 }); await runNative("pg_restore", ["--exit-on-error", "--single-transaction", "--no-owner", "--no-acl", `--dbname=${databaseName}`, path]); },
    invalidateSessions: async () => { await restoredSql`update auth_sessions set revoked_at = now() where revoked_at is null`; }
  };
  try {
    await assert.rejects(restoreRecoveryBundle({ ...restore, bundleKey: randomBytes(32) }), /authentication/);
    assert.equal(destination.documents.entries.size, 0);
    const objectEntry = verified.manifest.entries.find((item) => item.namespace === "documents")!;
    const objectPath = join(directory, objectEntry.file), originalBytes = await readFile(objectPath);
    await writeFile(objectPath, Buffer.from("corrupted synthetic archive"));
    await assert.rejects(restoreRecoveryBundle(restore));
    assert.equal(destination.documents.entries.size, 0);
    await writeFile(objectPath, originalBytes);
    const recoveredSecrets = await restoreRecoveryBundle(restore);
    await checkSchema(restoredSql, await readMigrations(join(config.root, "migrations")));
    const actualRows = await tableRows(restoredSql);
    for (const name of tableNames) {
      if (name === "auth_sessions") assert.equal(actualRows.get(name)!.length, expectedRows.get(name)!.length);
      else assert.deepEqual(actualRows.get(name), expectedRows.get(name), `Restored rows differ: ${name}`);
    }
    assert.equal((await restoredSql`select count(*)::int as count from auth_sessions where revoked_at is null`)[0].count, 0);
    for (const namespace of ["documents", "backups"] as const) {
      const sort = (items: Array<{ key: string; size: number }>) => items.sort((a, b) => a.key.localeCompare(b.key));
      assert.deepEqual(sort(await destination[namespace].list()), sort(await source[namespace].list()));
      for (const { key } of await source[namespace].list()) {
        const left = await source[namespace].get(key), right = await destination[namespace].get(key);
        assert.equal(hash(new Uint8Array(await new Response(right!.body).arrayBuffer())), hash(new Uint8Array(await new Response(left!.body).arrayBuffer())));
      }
    }
    const restoredRepo = new PostgresRepository(restoredSql);
    for (const fixture of vaults) {
      const vault = await restoredRepo.getPrivateVaultByOwner(fixture.userId);
      assert.ok(vault);
      const key = await unlockPrivateVault(vault, fixture.password);
      const item = await restoredRepo.getPrivateVaultItem(fixture.userId, fixture.itemId);
      assert.ok(item);
      assert.equal(await restoredRepo.getPrivateVaultItem(vaults.find((value) => value.userId !== fixture.userId)!.userId, fixture.itemId), null);
      const metadata = decryptPrivateVaultItemMetadata(key, item);
      const object = await destination.documents.get(item.objectKey);
      assert.equal(await decryptPrivateVaultBlob(key, item, await new Response(object!.body).arrayBuffer(), metadata).text(), fixture.plaintext);
      const folder = await restoredRepo.getPrivateVaultFolder(fixture.userId, fixture.folderId);
      assert.match(decryptPrivateVaultFolderMetadata(key, folder!).name, /合成私密目录/);
      assert.deepEqual(await unwrapPrivateVaultRecoveryKey(vault.recoveryEncryptedVaultKey, vault.vaultId, fixture.userId, recoveredSecrets), key);
      await assert.rejects(unwrapPrivateVaultRecoveryKey(vault.recoveryEncryptedVaultKey, vault.vaultId, fixture.userId, { ...recoveredSecrets, PRIVATE_VAULT_RECOVERY_KEY: randomBytes(32).toString("hex") }));
    }
    const work = await restoredRepo.getManuscript(protectedWork.manuscriptId);
    assert.ok(work);
    const key = await unlockManuscriptWithPassword(work, "Synthetic work password 2026");
    const recoveredChapter = await restoredRepo.getManuscriptChapter(work.manuscriptId, chapter.chapterId);
    assert.equal(await decryptManuscriptBody(key, work.manuscriptId, chapter.chapterId, recoveredChapter!.body), "Synthetic encrypted chapter");
    assert.deepEqual(await unwrapManuscriptRecoveryKey(work.recoveryEncryptedWorkKey!, work.manuscriptId, recoveredSecrets), key);
    await assert.rejects(restoreRecoveryBundle(restore), "Nonempty destinations must never be overwritten");
    console.log(`Offline recovery verified: ${tableNames.length} tables; ${source.documents.entries.size} document objects; ${source.backups.entries.size} backup objects; two independent vaults; encrypted writing; wrong-key/corruption/missing-object gates.`);
  } finally { await restoredSql.end({ timeout: 2 }); }
}
