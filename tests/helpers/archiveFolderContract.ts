import assert from "node:assert/strict";
import type { AppRepository } from "../../src/server/repositories/types";
import { cleanupDocumentInput } from "./storageCleanupContract";

export async function archiveFolderContract(repo: AppRepository, userId: string) {
  const prefix = `Synthetic ${crypto.randomUUID()}`;
  const folder = (name: string, parentFolderId: string | null = null) =>
    repo.createArchiveFolder({ folderId: crypto.randomUUID(), name, parentFolderId, createdBy: userId });
  const root = await folder(prefix);
  const child = await folder("资料", root.folderId);
  const grandchild = await folder("阅读", child.folderId);
  const empty = await folder("空目录", child.folderId);
  const priorChild = await folder("以前删除的目录", child.folderId);
  const document = await repo.createDocument({ ...cleanupDocumentInput(userId), folderId: grandchild.folderId });
  const version = await repo.createDocumentVersion(document.documentId, cleanupDocumentInput(userId));
  assert.ok(version);
  const priorTrash = await repo.createDocument({ ...cleanupDocumentInput(userId), folderId: grandchild.folderId });
  await repo.softDeleteDocument(priorTrash.documentId, { retainObject: true });
  const priorDeletedAt = (await repo.getDocument(priorTrash.documentId, { includeDeleted: true }))!.deletedAt;
  await repo.deleteArchiveFolder(priorChild.folderId);
  const priorBatch = (await repo.getArchiveFolder(priorChild.folderId, { includeDeleted: true }))!.deletionBatchId;
  const topic = await repo.createServiceDiscussionMessage({ createdBy: userId, title: prefix, bodyText: "Synthetic retained attachment" });
  const attachment = await repo.createServiceDiscussionAttachment({ messageId: topic.messageId, documentId: document.documentId, inlineImage: true });
  assert.ok(attachment);

  assert.deepEqual(await repo.deleteArchiveFolder(root.folderId), { deletedFolders: 4, trashedDocuments: 1 });
  assert.equal(await repo.getArchiveFolder(root.folderId), null);
  assert.equal(await repo.getDocument(version.current.documentId), null);
  const deletedRoot = await repo.getArchiveFolder(root.folderId, { includeDeleted: true });
  assert.ok(deletedRoot?.deletionBatchId);
  for (const item of [root, child, grandchild, empty]) {
    const deleted = await repo.getArchiveFolder(item.folderId, { includeDeleted: true });
    assert.equal(deleted?.deletionBatchId, deletedRoot.deletionBatchId);
    assert.equal(deleted?.parentFolderId, item.parentFolderId);
  }
  for (const item of [document, version.current]) {
    const deleted = await repo.getDocument(item.documentId, { includeDeleted: true });
    assert.equal(deleted?.folderId, grandchild.folderId);
    assert.equal(deleted?.folderDeletionBatchId, deletedRoot.deletionBatchId);
    assert.equal(deleted?.r2ObjectKey, item.r2ObjectKey);
    assert.ok(!(await repo.listPendingStorageCleanupJobs(100)).some((job) => job.objectKey === item.r2ObjectKey));
  }
  assert.equal((await repo.getArchiveFolder(priorChild.folderId, { includeDeleted: true }))?.deletionBatchId, priorBatch);
  assert.equal(await repo.restoreArchiveFolder(child.folderId), null, "restore begins at the deletion batch root");
  await assert.rejects(repo.restoreArchiveFolder(priorChild.folderId), /parent folder/);
  await assert.rejects(repo.restoreDocument(document.documentId), /containing folder/);
  await assert.rejects(repo.createDocument({ ...cleanupDocumentInput(userId), folderId: child.folderId }), /containing folder/);
  await assert.rejects(folder("Hidden upload", child.folderId), /[Pp]arent folder/);
  const conflict = await folder(prefix);
  await assert.rejects(repo.restoreArchiveFolder(root.folderId), /already exists/);
  assert.equal(await repo.getArchiveFolder(child.folderId), null, "conflict must not partially restore the tree");
  assert.equal(await repo.getDocument(document.documentId), null);
  const restored = await repo.restoreArchiveFolder(root.folderId, { name: `${prefix} recovered` });
  assert.ok(restored && !restored.deletedAt);
  assert.ok(await repo.getArchiveFolder(conflict.folderId));
  assert.equal((await repo.getArchiveFolder(grandchild.folderId))?.parentFolderId, child.folderId);
  assert.ok(await repo.getArchiveFolder(empty.folderId));
  assert.equal((await repo.listDocumentVersions(document.documentId)).length, 2);
  assert.equal((await repo.getDocument(priorTrash.documentId, { includeDeleted: true }))?.deletedAt, priorDeletedAt);
  assert.equal(await repo.getArchiveFolder(priorChild.folderId), null);
  const readTopic = await repo.getServiceDiscussionMessage(topic.messageId);
  assert.ok(readTopic?.attachments.some((item) => item.documentId === document.documentId), "attachment references survive trash and restoration");

  // Independently deleted children can recover elsewhere while their parent is still in trash.
  await repo.deleteArchiveFolder(root.folderId);
  const relocated = await repo.restoreArchiveFolder(priorChild.folderId, { parentFolderId: null, name: `${prefix} relocated` });
  assert.equal(relocated?.parentFolderId, null);
  await repo.restoreArchiveFolder(root.folderId);
  assert.equal((await repo.getArchiveFolder(priorChild.folderId))?.parentFolderId, null);
  const emptyRoot = await folder(`${prefix} empty`);
  assert.deepEqual(await repo.deleteArchiveFolder(emptyRoot.folderId), { deletedFolders: 1, trashedDocuments: 0 });
  assert.ok(await repo.restoreArchiveFolder(emptyRoot.folderId, { parentFolderId: root.folderId }));
  // Keep this empty tombstone in the full recovery fixture as well.
  await repo.deleteArchiveFolder(emptyRoot.folderId);
}
