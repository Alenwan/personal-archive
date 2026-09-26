import assert from "node:assert/strict";
import { HTTPException } from "hono/http-exception";
import { hashPassword } from "../../src/server/auth/password";
import { withArchiveManagementAccess, type ArchiveAccess } from "../../src/server/auth/archiveManagement";
import type { AppRepository } from "../../src/server/repositories/types";
import { cleanupDocumentInput } from "./storageCleanupContract";

export const forbidden = (cause: unknown) => cause instanceof HTTPException && cause.status === 403;
export async function archiveManagementContract(repo: AppRepository, ids: { owner: string; other: string; admin: string; staff: string; readonly: string }) {
  const credential = await hashPassword("SyntheticArchiveManagement2026");
  const session = async (userId: string) => {
    const access = { userId, sessionTokenHash: crypto.randomUUID() };
    await repo.createAuthSession({ userId, tokenHash: access.sessionTokenHash, expiresAt: new Date(Date.now() + 600000).toISOString() });
    return { access, scoped: withArchiveManagementAccess(repo, access) };
  };
  for (const userId of Object.values(ids)) await repo.updateUserPassword(userId, credential);
  const owner = await session(ids.owner), other = await session(ids.other), admin = await session(ids.admin);
  const secondAdmin = await session(ids.admin), staff = await session(ids.staff), readonly = await session(ids.readonly);
  const folder = await owner.scoped.createArchiveFolder({ folderId: crypto.randomUUID(), name: crypto.randomUUID(), createdBy: ids.owner });
  assert.equal(folder.managementOwnerUserId, ids.owner);
  const original = await owner.scoped.createDocument({ ...cleanupDocumentInput(ids.owner), folderId: folder.folderId });
  assert.equal(original.managementOwnerUserId, ids.owner);
  for (const member of [other, admin, staff, readonly]) {
    await assert.rejects(member.scoped.createDocumentVersion(original.documentId, cleanupDocumentInput(member.access.userId)), forbidden);
    await assert.rejects(member.scoped.updateDocument(original.documentId, { notes: "Denied" }), forbidden);
    await assert.rejects(member.scoped.softDeleteDocument(original.documentId, { retainObject: true, entireGroup: true }), forbidden);
  }
  await assert.rejects(other.scoped.createDocument({ ...cleanupDocumentInput(ids.other), folderId: folder.folderId }), forbidden);
  await assert.rejects(other.scoped.createArchiveFolder({ folderId: crypto.randomUUID(), name: crypto.randomUUID(), parentFolderId: folder.folderId, createdBy: ids.other }), forbidden);
  assert.equal(await repo.setArchiveManagementVerification(admin.access, "stale-hash"), null);
  assert.equal(await repo.setArchiveManagementVerification(owner.access, credential.passwordHash), null);
  const until = await repo.setArchiveManagementVerification(admin.access, credential.passwordHash);
  assert.ok(until && Date.parse(until) > Date.now() && Date.parse(until) <= Date.now() + 300000);
  await assert.rejects(secondAdmin.scoped.updateDocument(original.documentId, { notes: "Denied other session" }), forbidden);
  const next = await admin.scoped.createDocumentVersion(original.documentId, cleanupDocumentInput(ids.admin));
  assert.ok(next);
  assert.equal(next.current.uploadedBy, ids.admin);
  assert.equal(next.current.managementOwnerUserId, ids.owner, "a delegated upload never transfers management ownership");
  await owner.scoped.updateDocument(next.current.documentId, { notes: "Original owner still manages the latest version" });
  const versions = await repo.listDocumentVersions(original.documentId);
  assert.deepEqual(versions.map((d) => d.managementOwnerUserId), [ids.owner, ids.owner]);
  await assert.rejects(owner.scoped.createDocument({ ...cleanupDocumentInput(ids.owner), documentGroupId: original.documentGroupId, versionNumber: 9 }), forbidden);
  const staffFile = await staff.scoped.createDocument(cleanupDocumentInput(ids.staff));
  assert.ok(await staff.scoped.createDocumentVersion(staffFile.documentId, cleanupDocumentInput(ids.staff)));
  await assert.rejects(staff.scoped.updateDocument(staffFile.documentId, { notes: "No role upgrade" }), forbidden);

  // Trusted fixture insertion creates an existing mixed-owner tree.
  const child = await repo.createArchiveFolder({ folderId: crypto.randomUUID(), name: crypto.randomUUID(), parentFolderId: folder.folderId, createdBy: ids.other });
  const childFile = await repo.createDocument({ ...cleanupDocumentInput(ids.other), folderId: child.folderId });
  for (const action of [
    () => owner.scoped.deleteArchiveFolder(folder.folderId),
    () => owner.scoped.updateArchiveFolder(folder.folderId, { name: "Denied rename" }),
    () => owner.scoped.updateArchiveFolder(folder.folderId, { parentFolderId: null }),
    () => owner.scoped.updateArchiveFolderDocumentsMetadata(folder.folderId, { includeSubfolders: true, notes: "Denied recursive update" }, ids.owner)
  ]) await assert.rejects(action(), forbidden);
  assert.equal((await repo.getArchiveFolder(folder.folderId))?.name, folder.name);
  assert.equal((await repo.getDocument(childFile.documentId))?.notes, childFile.notes);
  assert.ok(await owner.scoped.updateArchiveFolderDocumentsMetadata(folder.folderId, { includeSubfolders: false, notes: "Own directory only" }, ids.owner));
  await admin.scoped.deleteArchiveFolder(folder.folderId);
  await assert.rejects(owner.scoped.restoreArchiveFolder(folder.folderId), forbidden);
  await assert.rejects(other.scoped.restoreDocument(original.documentId), forbidden);
  await assert.rejects(other.scoped.purgeDocument(original.documentId), forbidden);
  await admin.scoped.restoreArchiveFolder(folder.folderId);
  assert.ok(await repo.getDocument(childFile.documentId));
  const destination = await other.scoped.createArchiveFolder({ folderId: crypto.randomUUID(), name: crypto.randomUUID(), createdBy: ids.other });
  await assert.rejects(owner.scoped.updateDocument(original.documentId, { folderId: destination.folderId }), forbidden);

  const message = await repo.createServiceDiscussionMessage({ createdBy: ids.other, title: "Synthetic owned attachment", bodyText: "Retained content" });
  const deniedAttachment = cleanupDocumentInput(ids.owner);
  await assert.rejects(owner.scoped.createDocumentWithDiscussionAttachment(deniedAttachment, { messageId: message.messageId }), forbidden);
  assert.equal(await repo.getDocument(deniedAttachment.documentId, { includeDeleted: true }), null);
  const staffNote = await repo.createServiceDiscussionMessage({ createdBy: ids.staff, bodyText: "Synthetic staff-owned note" });
  const staffAttachment = await staff.scoped.createDocumentWithDiscussionAttachment(cleanupDocumentInput(ids.staff), { messageId: staffNote.messageId });
  assert.equal(staffAttachment.document.managementOwnerUserId, ids.staff);
  await assert.rejects(owner.scoped.createServiceDiscussionAttachment({ messageId: message.messageId, documentId: original.documentId }), forbidden);
  await admin.scoped.createServiceDiscussionAttachment({ messageId: message.messageId, documentId: original.documentId });
  await assert.rejects(owner.scoped.softDeleteDocument(original.documentId, { retainObject: true, entireGroup: true }), forbidden, "uploader cannot remove another content owner's attachment");
  await admin.scoped.softDeleteDocument(original.documentId, { retainObject: true, entireGroup: true });
  await repo.softDeleteServiceDiscussionMessage(message.messageId);
  await assert.rejects(admin.scoped.purgeDocument(original.documentId), /Referenced files/);
  await assert.rejects(repo.purgeDocument(original.documentId), /Referenced files/);
  assert.ok(!(await repo.listPendingStorageCleanupJobs(1000)).some((j) => j.objectKey === original.r2ObjectKey));
  await admin.scoped.restoreDocument(original.documentId);

  const unresolved = await repo.createArchiveFolder({ folderId: crypto.randomUUID(), name: crypto.randomUUID() });
  assert.equal(unresolved.managementOwnerUserId, null);
  await assert.rejects(owner.scoped.updateArchiveFolder(unresolved.folderId, { name: "Denied claim" }), forbidden);
  await admin.scoped.updateArchiveFolder(unresolved.folderId, { name: crypto.randomUUID() });
  assert.equal((await repo.getArchiveFolder(unresolved.folderId))?.managementOwnerUserId, null);
  const audit = (await repo.exportDatabaseTables()).tables.find((t) => t.tableName === "archive_management_audit");
  assert.ok(audit && audit.rows.length >= 5);
  assert.ok(!JSON.stringify(audit.rows).includes("SyntheticArchiveManagement2026"));
  await repo.setArchiveManagementVerification(admin.access, null);
  await assert.rejects(admin.scoped.updateDocument(original.documentId, { notes: "Grant ended" }), forbidden);
  await repo.setArchiveManagementVerification(admin.access, credential.passwordHash);
  await repo.revokeAuthSession(admin.access.sessionTokenHash);
  await assert.rejects(admin.scoped.createDocument(cleanupDocumentInput(ids.admin)), forbidden);
  await repo.setArchiveManagementVerification(secondAdmin.access, credential.passwordHash);
  await repo.updateUserPassword(ids.admin, await hashPassword("SyntheticArchiveChanged2026"));
  await assert.rejects(secondAdmin.scoped.updateArchiveFolder(unresolved.folderId, { name: "Revoked by password reset" }), forbidden);
  const expired: ArchiveAccess = { userId: ids.admin, sessionTokenHash: crypto.randomUUID() };
  await repo.createAuthSession({ userId: ids.admin, tokenHash: expired.sessionTokenHash, expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(await repo.setArchiveManagementVerification(expired, credential.passwordHash), null);
  await assert.rejects(withArchiveManagementAccess(repo, expired).createDocument(cleanupDocumentInput(ids.admin)), forbidden);
}
