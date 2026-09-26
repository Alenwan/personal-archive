import assert from "node:assert/strict";
import test from "node:test";
import { DemoRepository } from "../src/server/repositories/memory";
import { withArchiveManagementAccess } from "../src/server/auth/archiveManagement";
import { archiveContentContract } from "./helpers/archiveContentContract";
import { cleanupDocumentInput } from "./helpers/storageCleanupContract";
import { hashPassword } from "../src/server/auth/password";
import { forbidden } from "./helpers/archiveManagementContract";

test("memory content management preserves independent owners, histories, references and atomic chapter deletion", async () => {
  const repo = new DemoRepository();
  const users = await repo.listUsers();
  const owner = users.find((u) => u.role === "Manager")!;
  const other = { ...owner, userId: crypto.randomUUID(), email: "synthetic-body-member@example.invalid" };
  (repo as unknown as { users: unknown[] }).users.push(other);
  await archiveContentContract(repo, { owner: owner.userId, other: other.userId, admin: users.find((u) => u.role === "Admin")!.userId,
    staff: users.find((u) => u.role === "Staff")!.userId, readonly: users.find((u) => u.role === "ReadOnly")!.userId });
});

test("opaque writing conservatively pauses file purge, including trashed chapters; body representation is rechecked", async () => {
  const repo = new DemoRepository();
  const user = (await repo.listUsers()).find((u) => u.role === "Manager")!;
  const access = { userId: user.userId, sessionTokenHash: crypto.randomUUID() };
  await repo.createAuthSession({ userId: user.userId, tokenHash: access.sessionTokenHash, expiresAt: new Date(Date.now() + 600000).toISOString() });
  const scoped = withArchiveManagementAccess(repo, access);
  const work = await scoped.createManuscript({ title: "Synthetic opaque history", kind: "Novel", status: "Draft", createdBy: user.userId });
  const chapterId = work.chapters[0].chapterId;
  const file = await scoped.createDocument(cleanupDocumentInput(user.userId));
  await scoped.softDeleteDocument(file.documentId, { retainObject: true });
  const state = repo as unknown as { manuscripts: typeof work[]; manuscriptChapters: Array<{ chapterId: string; body: string; deletedAt?: string }> };
  const cipher = `pae1.${"A".repeat(16)}.${"B".repeat(22)}`;
  await assert.rejects(scoped.updateManuscriptChapter(work.manuscriptId, chapterId, { body: cipher }), /encryption changed/);
  state.manuscripts.find((m) => m.manuscriptId === work.manuscriptId)!.encryptionEnabled = true;
  await assert.rejects(scoped.updateManuscriptChapter(work.manuscriptId, chapterId, { body: "Stale plaintext" }), /encryption changed/);
  await assert.rejects(scoped.purgeDocument(file.documentId), /encrypted writing references/);
  state.manuscripts.find((m) => m.manuscriptId === work.manuscriptId)!.encryptionEnabled = false;
  const chapter = state.manuscriptChapters.find((c) => c.chapterId === chapterId)!;
  chapter.body = cipher;
  chapter.deletedAt = new Date().toISOString();
  await assert.rejects(scoped.purgeDocument(file.documentId), /encrypted writing references/);
  chapter.body = "Synthetic reviewed plaintext fixture";
  assert.equal(await repo.hasOpaqueArchiveContent(), false);
  assert.equal((await scoped.purgeDocument(file.documentId)).length, 1);
});

test("memory delegated body changes and reference capture roll back on audit failure or concurrent session revocation", async () => {
  const repo = new DemoRepository();
  const users = await repo.listUsers(), admin = users.find((u) => u.role === "Admin")!, owner = users.find((u) => u.role === "Manager")!;
  const credential = await hashPassword("SyntheticBodyRollback2026");
  await repo.updateUserPassword(admin.userId, credential);
  const access = { userId: admin.userId, sessionTokenHash: crypto.randomUUID() };
  await repo.createAuthSession({ userId: admin.userId, tokenHash: access.sessionTokenHash, expiresAt: new Date(Date.now() + 600000).toISOString() });
  await repo.setArchiveManagementVerification(access, credential.passwordHash);
  const scoped = withArchiveManagementAccess(repo, access);
  const work = await repo.createManuscript({ title: "Synthetic rollback", kind: "Novel", status: "Draft", createdBy: owner.userId });
  const file = await repo.createDocument(cleanupDocumentInput(admin.userId));
  const audit = repo.recordArchiveManagementAudit;
  repo.recordArchiveManagementAudit = async () => { throw new Error("Synthetic body audit failure"); };
  await assert.rejects(scoped.updateManuscriptChapter(work.manuscriptId, work.chapters[0].chapterId, { body: `/api/documents/${file.documentId}/preview` }), /Synthetic body audit failure/);
  assert.equal((await repo.getManuscriptChapter(work.manuscriptId, work.chapters[0].chapterId))?.body, "");
  assert.deepEqual(await repo.readArchiveContentDocumentIds("manuscript", work.manuscriptId), []);
  assert.deepEqual(await repo.listManuscriptChapterVersions(work.manuscriptId, work.chapters[0].chapterId), []);
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>((resolve) => { entered = resolve; }), gate = new Promise<void>((resolve) => { release = resolve; });
  repo.recordArchiveManagementAudit = async function (...args) { entered(); await gate; return audit.apply(this, args); };
  const pending = scoped.updateManuscriptChapter(work.manuscriptId, work.chapters[0].chapterId, { body: "Never committed" });
  await reached;
  await repo.revokeAuthSession(access.sessionTokenHash);
  release();
  await assert.rejects(pending, forbidden);
  assert.equal((await repo.getManuscriptChapter(work.manuscriptId, work.chapters[0].chapterId))?.body, "");
});
