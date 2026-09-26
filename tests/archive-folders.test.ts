import test from "node:test";
import assert from "node:assert/strict";
import { DemoRepository } from "../src/server/repositories/memory";
import { archiveFolderContract } from "./helpers/archiveFolderContract";
import { cleanupDocumentInput } from "./helpers/storageCleanupContract";

test("memory folder trash restores hierarchy, versions and references while preserving earlier deletions", async () => {
  const repo = new DemoRepository();
  await archiveFolderContract(repo, (await repo.listUsers())[0].userId);
});

test("memory allocates distinct concurrent version numbers and rejects duplicate keys before superseding", async () => {
  const repo = new DemoRepository();
  const userId = (await repo.listUsers())[0].userId;
  const source = await repo.createDocument(cleanupDocumentInput(userId));
  const inputs = [cleanupDocumentInput(userId), cleanupDocumentInput(userId)];
  await Promise.all(inputs.map((input) => repo.createDocumentVersion(source.documentId, input)));
  const versions = await repo.listDocumentVersions(source.documentId);
  assert.deepEqual(versions.map((version) => version.versionNumber), [3, 2, 1]);
  assert.equal(versions.filter((version) => version.isCurrentVersion).length, 1);
  await assert.rejects(repo.createDocumentVersion(source.documentId, { ...cleanupDocumentInput(userId), r2ObjectKey: inputs[0].r2ObjectKey }), /already exists/);
  assert.deepEqual(await repo.listDocumentVersions(source.documentId), versions);
});
