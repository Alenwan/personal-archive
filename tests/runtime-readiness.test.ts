import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { startPbxAmiListener } from "../server/pbxAmiListener";
import { validateSelfhostConfig } from "../src/server/runtimeConfig";
import { createRepository } from "../src/server/repositories/factory";
import { createDocumentStorage, type DocumentStorage } from "../src/server/storage/documentStorage";
import { createReadinessCheck, probeStorage } from "../src/server/services/readiness";
import { verifyMigrationHistory } from "../src/server/services/schemaMigrations";
import type { AppEnv } from "../src/server/env";

function settings(): AppEnv {
  return { APP_ENV: "production", BUSINESS_TEMPLATE: "personal-archive", DATABASE_URL: "postgres://synthetic.invalid/archive",
    S3_ENDPOINT: "https://synthetic.invalid", S3_ACCESS_KEY_ID: "synthetic", S3_SECRET_ACCESS_KEY: "synthetic",
    DOCUMENT_BUCKET_NAME: "documents", CREDENTIAL_ENCRYPTION_KEY: "x".repeat(32),
    MANUSCRIPT_RECOVERY_KEY: "y".repeat(32), PRIVATE_VAULT_RECOVERY_KEY: "z".repeat(32) };
}

test("production configuration cannot silently use memory or omit recovery material", () => {
  assert.doesNotThrow(() => validateSelfhostConfig(settings()));
  for (const field of ["DATABASE_URL", "S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "DOCUMENT_BUCKET_NAME", "CREDENTIAL_ENCRYPTION_KEY", "MANUSCRIPT_RECOVERY_KEY", "PRIVATE_VAULT_RECOVERY_KEY"] as const) {
    assert.throws(() => validateSelfhostConfig({ ...settings(), [field]: undefined }), field);
  }
  for (const env of [{}, { APP_ENV: "production" }, { APP_ENV: "development" }]) {
    assert.throws(() => createRepository(env));
    assert.throws(() => createDocumentStorage(env));
  }
  assert.throws(() => validateSelfhostConfig({ ...settings(), DEMO_MODE: "true" }));
  assert.doesNotThrow(() => createRepository({ APP_ENV: "test" }));
  assert.doesNotThrow(() => createDocumentStorage({ DEMO_MODE: "true" }));
});

test("an enabled legacy PBX listener without an explicit host never opens a connection", (t) => {
  const connection = t.mock.method(net, "createConnection", () => assert.fail("PBX must not choose a private default host"));
  const warning = t.mock.method(console, "warn", () => {});
  for (const host of [undefined, "", "   "]) {
    startPbxAmiListener({ APP_ENV: "test", PBX_AMI_ENABLED: "true", PBX_AMI_HOST: host,
      PBX_AMI_USERNAME: "synthetic", PBX_AMI_PASSWORD: ["synthetic", "fixture"].join("-") });
  }
  assert.equal(connection.mock.callCount(), 0);
  assert.equal(warning.mock.callCount(), 3);
});

test("schema check rejects missing, tampered, future, gapped and unreviewed history", () => {
  const expected = [{ name: "0001_one.sql", sha256: "a" }, { name: "0003_three.sql", sha256: "b" }];
  const rows = expected.map(({ name, sha256 }) => ({ file_name: name, sha256 }));
  assert.doesNotThrow(() => verifyMigrationHistory(rows, expected));
  assert.throws(() => verifyMigrationHistory(rows.slice(0, 1), expected));
  assert.throws(() => verifyMigrationHistory([{ ...rows[0], sha256: null }, rows[1]], expected));
  assert.throws(() => verifyMigrationHistory([{ ...rows[0], sha256: "changed" }, rows[1]], expected));
  assert.throws(() => verifyMigrationHistory([...rows, { file_name: "0099_future.sql", sha256: "z" }], expected));
  assert.throws(() => verifyMigrationHistory(rows.slice(1), expected, { allowPending: true }));
});

test("readiness verifies write/read/delete for both stores and does not cache a failure", async () => {
  const values = new Map<string, ArrayBuffer>();
  let writable = false, puts = 0, schemaCalls = 0, time = 0;
  const storage: DocumentStorage = {
    async put(key, bytes) { puts++; if (!writable) throw new Error("readonly"); values.set(key, bytes); },
    async get(key) { const bytes = values.get(key); return bytes ? { body: new Blob([bytes]).stream() } : null; },
    async delete(key) { values.delete(key); }, async usage() { return { bytes: 0, objectCount: values.size }; }
  };
  const ready = createReadinessCheck(async () => { schemaCalls++; }, [storage, storage], () => time);
  await assert.rejects(ready(), /readonly/);
  writable = true;
  await Promise.all([ready(), ready(), ready()]);
  assert.equal(values.size, 0);
  assert.equal(puts, 4);
  await ready();
  assert.equal(puts, 4);
  assert.equal(schemaCalls, 3);
  time = 60_001; writable = false;
  await assert.rejects(ready(), /readonly/);
  assert.equal(values.size, 0);
  await assert.rejects(probeStorage({ ...storage, async put() {}, async get() { return { body: new Blob(["corrupt"]).stream() }; } }), /match/);
});

test("a failed readiness probe waits for the other store to finish cleanup", async () => {
  let finishPut!: () => void;
  let deleted = false;
  const paused = new Promise<void>((resolve) => { finishPut = resolve; });
  const storage: DocumentStorage = { async put() { await paused; }, async get() { return null; }, async delete() { deleted = true; }, async usage() { return { bytes: 0, objectCount: 0 }; } };
  const ready = createReadinessCheck(async () => {}, [storage, { ...storage, async put() { throw new Error("Synthetic unavailable store"); }, async delete() {} }]);
  let settled = false;
  const pending = ready().finally(() => { settled = true; });
  const rejected = assert.rejects(pending);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(settled, false);
  finishPut();
  await rejected;
  assert.equal(deleted, true);
});

test("S3 recovery inventory decodes keys once and rejects incomplete pagination", async () => {
  const original = globalThis.fetch;
  const storage = createDocumentStorage({ ...settings(), S3_FORCE_PATH_STYLE: "true" });
  try {
    globalThis.fetch = async () => new Response('<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Contents><Key>folder/&amp;lt;&lt;Key&gt;&#13;</Key><Size>7</Size></Contents><IsTruncated>false</IsTruncated></ListBucketResult>');
    assert.deepEqual(await storage.list!(), [{ key: "folder/&lt;<Key>\r", size: 7 }]);
    globalThis.fetch = async () => new Response('<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>repeat</NextContinuationToken></ListBucketResult>');
    await assert.rejects(storage.list!(), /pagination/);
    globalThis.fetch = async () => new Response('<Error><Message>Invalid bucket</Message></Error>');
    await assert.rejects(storage.list!(), /malformed/);
  } finally { globalThis.fetch = original; }
});
