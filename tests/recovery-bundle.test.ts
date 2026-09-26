import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rename, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { createRecoveryBundle, restoreRecoveryBundle, verifyRecoveryBundle } from "../src/server/services/recoveryBundle";
import type { DocumentStorage } from "../src/server/storage/documentStorage";

function objects(): DocumentStorage {
  const values = new Map<string, ArrayBuffer>();
  return {
    async put(key, value) { values.set(key, value); },
    async get(key) { const value = values.get(key); return value ? { body: new Blob([value]).stream() } : null; },
    async delete(key) { values.delete(key); },
    async list() { return [...values].map(([key, value]) => ({ key, size: value.byteLength })); },
    async usage() { return { bytes: [...values.values()].reduce((size, value) => size + value.byteLength, 0), objectCount: values.size }; }
  };
}
async function fixture(run: (directory: string, bundleKey: Buffer) => Promise<void>) {
  const parent = await mkdtemp(join(process.cwd(), ".tools", "recovery-unit-"));
  const directory = join(parent, "bundle"), bundleKey = randomBytes(32);
  try {
    const stores = { documents: objects(), backups: objects() };
    await stores.documents.put("documents/../../合成原件.txt", new TextEncoder().encode("Synthetic bytes").buffer, "text/plain");
    await createRecoveryBundle({ directory, bundleKey, stores, configuration: { SYNTHETIC_KEY: randomBytes(32).toString("hex") }, assertQuiescent: async () => {}, dumpDatabase: async () => Buffer.from("Synthetic dump placeholder; real dumps tested separately") });
    await run(directory, bundleKey);
  } finally { await rm(parent, { recursive: true }); }
}

test("recovery preflight rejects missing files and symlinks before writing a destination", async () => {
  await fixture(async (directory, bundleKey) => {
    const path = join(directory, "database.bin"), temporary = join(directory, "held.bin");
    await rename(path, temporary);
    await assert.rejects(verifyRecoveryBundle(directory, bundleKey));
    await symlink(temporary, path);
    await assert.rejects(verifyRecoveryBundle(directory, bundleKey), /invalid recovery entry/);
    await rm(path);
    await rename(temporary, path);
    assert.ok((await verifyRecoveryBundle(directory, bundleKey)).files.has("database.bin"));
  });
});

test("failed destination writes or SQL restore never report success or alter the last good bundle", async () => {
  await fixture(async (directory, bundleKey) => {
    const originalManifest = await readFile(join(directory, "manifest.json"));
    let databaseWrites = 0, revoked = 0;
    const options = { directory, bundleKey, stores: { documents: objects(), backups: objects() }, assertEmptyDatabase: async () => {},
      restoreDatabase: async () => { databaseWrites++; throw new Error("Synthetic SQL restore failure"); }, invalidateSessions: async () => { revoked++; } };
    await assert.rejects(restoreRecoveryBundle({ ...options, stores: { ...options.stores, documents: { ...objects(), async put() { throw new Error("Synthetic disk full"); } } } }), /disk full/);
    assert.equal(databaseWrites, 0);
    await assert.rejects(restoreRecoveryBundle(options), /SQL restore failure/);
    assert.equal(databaseWrites, 1);
    assert.equal(revoked, 0);
    await assert.rejects(restoreRecoveryBundle(options), /not empty/);
    assert.deepEqual(await readFile(join(directory, "manifest.json")), originalManifest);
    await verifyRecoveryBundle(directory, bundleKey);
  });
});
