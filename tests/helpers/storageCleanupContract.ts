import assert from "node:assert/strict";
import type { AppRepository, CreateDocumentInput } from "../../src/server/repositories/types";
import { cleanupStoredDocuments } from "../../src/server/services/storageCleanup";
import type { DocumentStorage } from "../../src/server/storage/documentStorage";

export function cleanupDocumentInput(userId: string, key = `synthetic-cleanup/${crypto.randomUUID()}`): CreateDocumentInput {
  return { documentId: crypto.randomUUID(), caseId: null, fileName: "synthetic.txt", originalFileName: "synthetic.txt",
    fileSize: 4, mimeType: "text/plain", category: "Other", r2ObjectKey: key, uploadedBy: userId, notes: "Synthetic cleanup fixture" };
}

// The same lifecycle runs against memory and a real owned PostgreSQL database.
// advance only moves the fixture's cleanup deadlines, never waits on wall time.
export async function storageCleanupContract(repo: AppRepository, userId: string, advance: (ms: number) => Promise<void>) {
  const deleted: string[] = [];
  let failKey = "";
  const storage: DocumentStorage = {
    put: async () => {}, get: async () => null, usage: async () => ({ bytes: 0, objectCount: 0 }),
    delete: async (key) => { if (key === failKey) throw new Error("Synthetic storage failure"); deleted.push(key); }
  };
  const original = await repo.createDocument(cleanupDocumentInput(userId));
  const version = await repo.createDocumentVersion(original.documentId, cleanupDocumentInput(userId));
  assert.ok(version);
  for (const record of [original, version.current]) await repo.enqueueStorageCleanup(record.r2ObjectKey);
  await cleanupStoredDocuments(repo, storage, 100);
  assert.ok(!deleted.includes(original.r2ObjectKey) && !deleted.includes(version.current.r2ObjectKey), "current and historical references protect objects");
  await repo.softDeleteDocument(version.current.documentId, { retainObject: true, entireGroup: true });
  await advance(61_000);
  await cleanupStoredDocuments(repo, storage, 100);
  assert.ok(!deleted.includes(original.r2ObjectKey) && !deleted.includes(version.current.r2ObjectKey), "trash retains every version");
  assert.ok((await repo.getStorageCleanupStatus()).referenced >= 2);
  assert.ok(await repo.restoreDocument(original.documentId));
  assert.equal((await repo.listDocumentVersions(original.documentId)).length, 2);
  assert.deepEqual(await repo.purgeDocument(original.documentId), [], "active content cannot be purged");
  await repo.softDeleteDocument(original.documentId, { retainObject: true, entireGroup: true });
  assert.equal((await repo.purgeDocument(original.documentId)).length, 2);
  let jobs = await repo.listPendingStorageCleanupJobs(100);
  assert.ok(jobs.some((job) => job.objectKey === original.r2ObjectKey));
  assert.ok(jobs.some((job) => job.objectKey === version.current.r2ObjectKey), "purge must enqueue without an API follow-up");

  failKey = original.r2ObjectKey;
  await cleanupStoredDocuments(repo, storage, 100);
  assert.ok(deleted.includes(version.current.r2ObjectKey));
  assert.ok(!deleted.includes(original.r2ObjectKey));
  assert.ok((await repo.getStorageCleanupStatus()).failed >= 1);
  assert.ok(!(await repo.listPendingStorageCleanupJobs(100)).some((job) => job.objectKey === failKey), "failure backs off");
  failKey = "";
  await advance(61_000);
  await cleanupStoredDocuments(repo, storage, 100);
  assert.ok(deleted.includes(original.r2ObjectKey));
  await assert.rejects(repo.createDocument(cleanupDocumentInput(userId, original.r2ObjectKey)), /retired/);

  const vault = await repo.createPrivateVault({ vaultId: crypto.randomUUID(), ownerUserId: userId, encryptionVersion: 1,
    encryptionKdf: "PBKDF2-SHA-256", encryptionIterations: 600000, encryptionSalt: "synthetic", encryptedVaultKey: "synthetic",
    recoveryEncryptedVaultKey: "synthetic" });
  const itemInput = { itemId: crypto.randomUUID(), vaultId: vault.vaultId, encryptionVersion: 1,
    encryptedMetadata: "synthetic", wrappedFileKey: "synthetic", objectKey: `synthetic-cleanup/${crypto.randomUUID()}`, ciphertextSize: 4 };
  const item = await repo.createPrivateVaultItem(itemInput);
  await repo.enqueueStorageCleanup(item.objectKey);
  await cleanupStoredDocuments(repo, storage, 100);
  assert.ok(!deleted.includes(item.objectKey));
  await repo.softDeletePrivateVaultItem(userId, item.itemId);
  await advance(61_000);
  await cleanupStoredDocuments(repo, storage, 100);
  assert.ok(!deleted.includes(item.objectKey), "private trash also retains its object");
  // A different metadata table may still reference a key; both must be gone.
  const shared = await repo.createDocument(cleanupDocumentInput(userId, item.objectKey));
  assert.ok(await repo.purgePrivateVaultItem(userId, item.itemId));
  await cleanupStoredDocuments(repo, storage, 100);
  assert.ok(!deleted.includes(item.objectKey));
  await repo.softDeleteDocument(shared.documentId, { retainObject: true });
  await repo.purgeDocument(shared.documentId);
  await cleanupStoredDocuments(repo, storage, 100);
  assert.ok(deleted.includes(item.objectKey));
  await assert.rejects(repo.createPrivateVaultItem({ ...itemInput, itemId: crypto.randomUUID() }), /retired/);

  // Claim and DELETE succeed, then the worker disappears before acknowledgement.
  const orphan = `synthetic-cleanup/${crypto.randomUUID()}`;
  await repo.enqueueStorageCleanup(orphan);
  jobs = await repo.listPendingStorageCleanupJobs(100);
  const pending = jobs.find((job) => job.objectKey === orphan)!;
  assert.ok(pending);
  const claims = await Promise.all([repo.claimStorageCleanupJob(pending.cleanupJobId), repo.claimStorageCleanupJob(pending.cleanupJobId)]);
  assert.equal(claims.filter(Boolean).length, 1, "only one worker receives the current lease");
  const first = claims.find(Boolean)!;
  await storage.delete(orphan);
  await assert.rejects(repo.createDocument(cleanupDocumentInput(userId, orphan)), /retired/);
  assert.equal(await repo.claimStorageCleanupJob(pending.cleanupJobId), null);
  await advance(301_000);
  const second = await repo.claimStorageCleanupJob(pending.cleanupJobId);
  assert.ok(second?.leaseToken && first.leaseToken);
  assert.notEqual(first.leaseToken, second.leaseToken);
  assert.equal(await repo.completeStorageCleanup(first.cleanupJobId, first.leaseToken), false);
  assert.equal(await repo.failStorageCleanup(first.cleanupJobId, first.leaseToken), false);
  await storage.delete(orphan); // Idempotent retry after an uncertain DELETE.
  assert.equal(await repo.completeStorageCleanup(second.cleanupJobId, second.leaseToken), true);
  await repo.enqueueStorageCleanup(orphan);
  assert.ok(!(await repo.listPendingStorageCleanupJobs(100)).some((job) => job.objectKey === orphan));
  await assert.rejects(repo.createDocument(cleanupDocumentInput(userId, orphan)), /retired/);
}
