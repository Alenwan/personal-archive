import assert from "node:assert/strict";
import { HTTPException } from "hono/http-exception";
import { hashPassword } from "../../src/server/auth/password";
import { withArchiveManagementAccess } from "../../src/server/auth/archiveManagement";
import type { AppRepository } from "../../src/server/repositories/types";
import { forbidden } from "./archiveManagementContract";
import { cleanupDocumentInput } from "./storageCleanupContract";

const conflict = (error: unknown) => error instanceof HTTPException && error.status === 409;
export async function archiveContentContract(repo: AppRepository, ids: { owner: string; other: string; admin: string; staff: string; readonly: string }) {
  const credential = await hashPassword("SyntheticContentManagement2026");
  const session = async (userId: string) => {
    await repo.updateUserPassword(userId, credential);
    const access = { userId, sessionTokenHash: crypto.randomUUID() };
    await repo.createAuthSession({ userId, tokenHash: access.sessionTokenHash, expiresAt: new Date(Date.now() + 600000).toISOString() });
    return { access, scoped: withArchiveManagementAccess(repo, access) };
  };
  const owner = await session(ids.owner), other = await session(ids.other), admin = await session(ids.admin);
  const staff = await session(ids.staff), readonly = await session(ids.readonly);
  const note = await owner.scoped.createServiceDiscussionMessage({ createdBy: ids.owner, bodyText: "Synthetic note" });
  const knowledge = await owner.scoped.createKnowledge({ title: "Synthetic knowledge", type: "Reference", status: "Draft", component: "", summary: "", body: "Synthetic body", createdBy: ids.owner });
  const work = await owner.scoped.createManuscript({ title: "Synthetic writing", kind: "Novel", status: "Draft", createdBy: ids.owner });
  const chapterId = work.chapters[0].chapterId;
  for (const content of [note, knowledge, work]) assert.equal(content.managementOwnerUserId, ids.owner);
  for (const member of [other, admin, staff, readonly]) {
    await assert.rejects(member.scoped.updateServiceDiscussionMessage(note.messageId, { bodyText: "Denied" }), forbidden);
    await assert.rejects(member.scoped.updateServiceDiscussionMessage(note.messageId, { isPinned: true }), forbidden);
    await assert.rejects(member.scoped.softDeleteServiceDiscussionMessage(note.messageId), forbidden);
    await assert.rejects(member.scoped.updateKnowledge(knowledge.knowledgeId, { body: "Denied" }), forbidden);
    await assert.rejects(member.scoped.softDeleteKnowledge(knowledge.knowledgeId), forbidden);
    await assert.rejects(member.scoped.updateManuscript(work.manuscriptId, { title: "Denied" }), forbidden);
    await assert.rejects(member.scoped.updateManuscriptChapter(work.manuscriptId, chapterId, { body: "Denied", expectedRevision: 1 }), forbidden);
    await assert.rejects(member.scoped.createManuscriptChapter({ manuscriptId: work.manuscriptId, title: "Denied" }), forbidden);
    await assert.rejects(member.scoped.softDeleteManuscript(work.manuscriptId), forbidden);
  }
  await assert.rejects(other.scoped.createManuscript({ title: "Forged creator", kind: "Novel", status: "Draft", createdBy: ids.owner }), forbidden);
  const reply = await other.scoped.createServiceDiscussionMessage({ createdBy: ids.other, parentMessageId: note.messageId, bodyText: "Independent reply" });
  await assert.rejects(owner.scoped.updateServiceDiscussionMessage(note.messageId, { bodyText: "Must roll back", threadStatus: "resolved" }), forbidden);
  assert.equal((await repo.getServiceDiscussionMessage(note.messageId))?.bodyText, note.bodyText);
  assert.equal((await repo.getServiceDiscussionMessage(reply.messageId))?.threadStatus, "open");
  await owner.scoped.updateServiceDiscussionMessage(note.messageId, { bodyText: "Own note remains editable" });
  await other.scoped.updateServiceDiscussionMessage(reply.messageId, { bodyText: "Own reply remains editable" });
  await repo.setArchiveManagementVerification(admin.access, credential.passwordHash);
  await admin.scoped.updateServiceDiscussionMessage(note.messageId, { threadStatus: "resolved" });
  assert.equal((await repo.getServiceDiscussionMessage(reply.messageId))?.threadStatus, "resolved");
  await admin.scoped.updateKnowledge(knowledge.knowledgeId, { body: "Delegated edit", updatedBy: ids.admin });
  assert.equal((await repo.getKnowledge(knowledge.knowledgeId))?.managementOwnerUserId, ids.owner);
  await admin.scoped.updateManuscriptChapter(work.manuscriptId, chapterId, { body: "Delegated writing", updatedBy: ids.admin });
  await assert.rejects(admin.scoped.updateManuscriptEncryptionKey(work.manuscriptId, {} as never), forbidden, "management grant never conveys key authority");
  await owner.scoped.softDeleteKnowledge(knowledge.knowledgeId);
  await assert.rejects(other.scoped.restoreKnowledge(knowledge.knowledgeId), forbidden);
  await assert.rejects(other.scoped.purgeKnowledge(knowledge.knowledgeId), forbidden);
  await owner.scoped.restoreKnowledge(knowledge.knowledgeId);

  const ownStaffNote = await staff.scoped.createServiceDiscussionMessage({ createdBy: ids.staff, bodyText: "Staff note" });
  await staff.scoped.updateServiceDiscussionMessage(ownStaffNote.messageId, { bodyText: "Staff edits own note" });
  const ownStaffWork = await staff.scoped.createManuscript({ title: "Staff work", kind: "Novel", status: "Draft", createdBy: ids.staff });
  await staff.scoped.createManuscriptChapter({ manuscriptId: ownStaffWork.manuscriptId, title: "Staff may create" });
  await assert.rejects(staff.scoped.updateManuscriptChapter(ownStaffWork.manuscriptId, ownStaffWork.chapters[0].chapterId, { body: "No inherited role upgrade" }), forbidden);
  await assert.rejects(readonly.scoped.createServiceDiscussionMessage({ createdBy: ids.readonly, bodyText: "Denied" }), forbidden);

  const file = await owner.scoped.createDocument(cleanupDocumentInput(ids.owner));
  const inline = `<img src="/api/documents/${file.documentId}/preview">`;
  await owner.scoped.updateServiceDiscussionMessage(note.messageId, { bodyText: `pae1. is ordinary quoted text here. ${inline}` });
  assert.ok((await repo.readArchiveContentDocumentIds("discussion", note.messageId)).includes(file.documentId), "a plaintext encryption-prefix quote cannot suppress reference capture");
  await owner.scoped.updateServiceDiscussionMessage(note.messageId, { bodyText: "Inline image removed from this note" });
  assert.ok((await repo.readArchiveContentDocumentIds("discussion", note.messageId)).includes(file.documentId));
  await assert.rejects(other.scoped.createKnowledge({ title: "Denied binding", type: "Reference", status: "Draft", component: "", summary: "", body: inline, createdBy: ids.other }), forbidden);
  await assert.rejects(other.scoped.updateServiceDiscussionMessage(reply.messageId, { bodyText: inline }), forbidden);
  await owner.scoped.updateManuscriptChapter(work.manuscriptId, chapterId, { body: inline, saveSource: "manual" });
  const versionWithImage = (await repo.listManuscriptChapterVersions(work.manuscriptId, chapterId)).length;
  await owner.scoped.updateManuscriptChapter(work.manuscriptId, chapterId, { body: "Image removed from current body", saveSource: "manual" });
  assert.ok((await repo.listManuscriptChapterVersions(work.manuscriptId, chapterId)).length > versionWithImage);
  assert.ok((await repo.readArchiveContentDocumentIds("manuscript", work.manuscriptId)).includes(file.documentId));
  await owner.scoped.softDeleteDocument(file.documentId, { retainObject: true });
  await assert.rejects(owner.scoped.purgeDocument(file.documentId), /Referenced files/);
  assert.ok(!(await repo.listPendingStorageCleanupJobs(1000)).some((j) => j.objectKey === file.r2ObjectKey));
  await owner.scoped.restoreDocument(file.documentId);
  await owner.scoped.updateKnowledge(knowledge.knowledgeId, { links: [{ entityType: "document", entityId: file.documentId }] });
  await owner.scoped.updateKnowledge(knowledge.knowledgeId, { links: [] });
  await owner.scoped.softDeleteKnowledge(knowledge.knowledgeId);
  await owner.scoped.purgeKnowledge(knowledge.knowledgeId);
  assert.ok((await repo.readArchiveContentDocumentIds("knowledge", knowledge.knowledgeId)).includes(file.documentId), "deleting the body cannot release historic references");

  const upload = cleanupDocumentInput(ids.owner);
  await assert.rejects(other.scoped.createManuscriptDocument(work.manuscriptId, cleanupDocumentInput(ids.other)), forbidden);
  const image = await owner.scoped.createManuscriptDocument(work.manuscriptId, upload);
  assert.ok((await repo.readArchiveContentDocumentIds("manuscript", work.manuscriptId)).includes(image.documentId), "upload binds the image before autosave or encryption");
  await assert.rejects(owner.scoped.updateManuscriptChapter(work.manuscriptId, chapterId, { body: `/api/documents/${crypto.randomUUID()}/preview` }), conflict);
  const second = await owner.scoped.createManuscriptChapter({ manuscriptId: work.manuscriptId, title: "Second chapter" });
  const deletes = await Promise.allSettled([
    owner.scoped.deleteManuscriptChapter(work.manuscriptId, chapterId),
    owner.scoped.deleteManuscriptChapter(work.manuscriptId, second.chapterId)
  ]);
  assert.equal(deletes.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await repo.getManuscript(work.manuscriptId))?.chapterCount, 1);
  await owner.scoped.softDeleteManuscript(work.manuscriptId);
  await owner.scoped.softDeleteDocument(image.documentId, { retainObject: true });
  await assert.rejects(owner.scoped.purgeDocument(image.documentId), /Referenced files/);

  const audit = (await repo.exportDatabaseTables()).tables.find((t) => t.tableName === "archive_management_audit")!;
  assert.ok(JSON.stringify(audit.rows).includes("updateManuscriptChapter"));
  await repo.setArchiveManagementVerification(admin.access, null);
  await assert.rejects(admin.scoped.updateServiceDiscussionMessage(note.messageId, { bodyText: "Grant ended" }), forbidden);
  return { note, work, file };
}
