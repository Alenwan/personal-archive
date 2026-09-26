import test from "node:test";
import assert from "node:assert/strict";
import { DemoRepository } from "../src/server/repositories/memory";
import { hashPassword } from "../src/server/auth/password";
import { withArchiveManagementAccess } from "../src/server/auth/archiveManagement";
import { archiveManagementContract, forbidden } from "./helpers/archiveManagementContract";
import { cleanupDocumentInput } from "./helpers/storageCleanupContract";

test("memory enforces stable file ownership, recursive authorization, attachment references and session-bound administration", async () => {
  const repo = new DemoRepository();
  const users = await repo.listUsers();
  const other = { ...users.find((u) => u.role === "Manager")!, userId: crypto.randomUUID(), email: "synthetic-other@example.invalid" };
  (repo as unknown as { users: unknown[] }).users.push(other);
  await archiveManagementContract(repo, {
    owner: users.find((u) => u.role === "Manager")!.userId, other: other.userId,
    admin: users.find((u) => u.role === "Admin")!.userId, staff: users.find((u) => u.role === "Staff")!.userId,
    readonly: users.find((u) => u.role === "ReadOnly")!.userId
  });
});

test("memory rolls back on audit failure and concurrent session revocation without overwriting another mutation", async () => {
  const repo = new DemoRepository();
  const users = await repo.listUsers();
  const admin = users.find((u) => u.role === "Admin")!, owner = users.find((u) => u.role === "Manager")!;
  const credential = await hashPassword("SyntheticArchiveRollback2026");
  await repo.updateUserPassword(admin.userId, credential);
  const access = { userId: admin.userId, sessionTokenHash: crypto.randomUUID() };
  await repo.createAuthSession({ userId: admin.userId, tokenHash: access.sessionTokenHash, expiresAt: new Date(Date.now() + 600000).toISOString() });
  await repo.setArchiveManagementVerification(access, credential.passwordHash);
  const scoped = withArchiveManagementAccess(repo, access);
  const doc = await repo.createDocument(cleanupDocumentInput(owner.userId));
  const audit = repo.recordArchiveManagementAudit;
  repo.recordArchiveManagementAudit = async () => { throw new Error("Synthetic audit failure"); };
  await assert.rejects(scoped.createDocumentVersion(doc.documentId, cleanupDocumentInput(admin.userId)), /Synthetic audit failure/);
  assert.equal((await repo.listDocumentVersions(doc.documentId)).length, 1);
  assert.equal((await repo.getDocument(doc.documentId))?.isCurrentVersion, true);
  let release!: () => void, entered!: () => void;
  const reached = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  repo.recordArchiveManagementAudit = async function (...args) { entered(); await gate; return audit.apply(this, args); };
  const pending = scoped.updateDocument(doc.documentId, { notes: "Never committed" });
  await reached;
  await repo.revokeAuthSession(access.sessionTokenHash);
  release();
  await assert.rejects(pending, forbidden);
  assert.equal((await repo.getDocument(doc.documentId))?.notes, doc.notes);
});
