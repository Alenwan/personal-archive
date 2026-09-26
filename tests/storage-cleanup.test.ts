import assert from "node:assert/strict";
import test from "node:test";
import { DemoRepository } from "../src/server/repositories/memory";
import { storageCleanupContract } from "./helpers/storageCleanupContract";
import { cleanupStoredDocuments } from "../src/server/services/storageCleanup";
import { storageCleanupRetryDelay } from "../src/server/services/storageCleanupPolicy";
import type { DocumentStorage } from "../src/server/storage/documentStorage";

test("memory cleanup retains all references, retries failures, fences leases and retires keys", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const repo = new DemoRepository();
  await storageCleanupContract(repo, (await repo.listUsers())[0].userId, async (ms) => { context.mock.timers.tick(ms); });
});

test("a repository/claim failure never calls object DELETE and retry delay is bounded", async () => {
  const repo = new DemoRepository();
  await repo.enqueueStorageCleanup(`synthetic/${crypto.randomUUID()}`);
  repo.claimStorageCleanupJob = async () => { throw new Error("Synthetic database unavailable"); };
  let calls = 0;
  const storage = { delete: async () => { calls++; } } as unknown as DocumentStorage;
  await assert.rejects(cleanupStoredDocuments(repo, storage), /unavailable/);
  assert.equal(calls, 0);
  assert.equal(storageCleanupRetryDelay(1), 60_000);
  assert.equal(storageCleanupRetryDelay(2), 120_000);
  assert.equal(storageCleanupRetryDelay(999), 3_600_000);
});
