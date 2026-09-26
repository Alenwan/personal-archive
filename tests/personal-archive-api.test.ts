import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { app } from "../functions/api/[[path]]";
import { createRepository } from "../src/server/repositories/factory";
import { createDocumentStorage, createBackupStorage } from "../src/server/storage/documentStorage";
import { hashPassword } from "../src/server/auth/password";
import { createManuscriptEncryption, encryptManuscriptBody, decryptManuscriptBody, unlockManuscriptWithPassword } from "../src/shared/manuscriptEncryption";
import { wrapManuscriptRecoveryKey } from "../src/server/services/manuscriptRecoveryCrypto";
import type { AppEnv } from "../src/server/env";
import type { BackupItem, BackupRun, PublicUser } from "../src/shared/types";
import type { BackupSnapshot } from "../src/server/repositories/types";
import { cleanupDocumentInput } from "./helpers/storageCleanupContract";

// In-process Hono requests only: no listening socket, inherited environment,
// external database, or object-store connection is used by this suite.
const env: AppEnv = {
  APP_ENV: "test",
  BUSINESS_TEMPLATE: "personal-archive", DEMO_MODE: "false", PUBLIC_DEMO_READONLY: "false",
  MANUSCRIPT_RECOVERY_KEY: `synthetic-test-${crypto.randomUUID()}-${crypto.randomUUID()}`
};
const repo = createRepository(env);
const password = "SyntheticAccount2026";

async function request(path: string, method = "GET", body?: unknown, cookie?: string, bindings = env) {
  return app.request(`/api${path}`, {
    method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }, bindings);
}

async function signIn(user: PublicUser, value = password) {
  const response = await request("/auth/login", "POST", { email: user.email, password: value });
  assert.equal(response.status, 200, await response.clone().text());
  return response.headers.get("set-cookie")!.split(";")[0];
}

async function prepare(role: PublicUser["role"]) {
  const user = (await repo.listUsers()).find((item) => item.role === role)!;
  assert.ok(user);
  await repo.updateUserPassword(user.userId, await hashPassword(password));
  return { user, cookie: await signIn(user) };
}

test("retired repository integration refuses every operation before database or external access", async () => {
  const calls = mock.method(globalThis, "fetch", async () => { throw new Error("Retired integration attempted network access"); });
  try {
    const bindings: AppEnv = { APP_ENV: "production", BUSINESS_TEMPLATE: "personal-archive",
      FORGEJO_BASE_URL: "https://forgejo.example.invalid", FORGEJO_API_TOKEN: "synthetic-retired-token", FORGEJO_OWNER: "synthetic" };
    for (const path of ["/code-repositories", "/code-repositories/", "/code-repositories/import", "/code-repositories/owner/name/detail",
      "/code-repositories/owner/name/branches/main", "/code-repositories/owner/name/tags/v1", "/code-repositories/owner/name/snapshots/id/download"]) {
      for (const method of ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]) {
        assert.equal((await request(path, method, undefined, undefined, bindings)).status, 404);
      }
    }
    assert.equal(calls.mock.callCount(), 0);
  } finally { calls.mock.restore(); }
});

test("real login endpoint rejects a credential-less account in production even with a configured demo password", async () => {
  const user = (await repo.listUsers()).find((item) => item.role === "Staff")!;
  assert.equal(await repo.getUserCredential(user.userId), null);
  const bindings = { ...env, DEMO_PASSWORD: "SyntheticDemo2026" };
  const denied = await request("/auth/login", "POST", { email: user.email, password: bindings.DEMO_PASSWORD }, undefined, bindings);
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get("set-cookie"), null);
});

test("Archive HTTP writes require ownership; Admin delegation is password-verified, scoped to one session and explicitly ended", async () => {
  const owner = await prepare("Manager"), admin = await prepare("Admin"), staff = await prepare("Staff");
  const secondAdmin = await signIn(admin.user);
  const folder = await repo.createArchiveFolder({ folderId: crypto.randomUUID(), name: crypto.randomUUID(), createdBy: owner.user.userId });
  const doc = await repo.createDocument({ ...cleanupDocumentInput(owner.user.userId), folderId: folder.folderId });
  const staffDoc = await repo.createDocument(cleanupDocumentInput(staff.user.userId));
  for (const item of [doc, staffDoc]) await createDocumentStorage(env).put(item.r2ObjectKey, new TextEncoder().encode("Synthetic source bytes").buffer, "text/plain");
  assert.equal((await request(`/documents/${doc.documentId}`, "PATCH", { notes: "Denied" }, admin.cookie)).status, 403);
  assert.equal((await request("/archive/management-access", "POST", { currentPassword: password }, owner.cookie)).status, 403);
  assert.equal((await request("/archive/management-access", "POST", { currentPassword: "SyntheticWrongPassword" }, admin.cookie)).status, 400);
  const verified = await request("/archive/management-access", "POST", { currentPassword: password }, admin.cookie);
  assert.equal(verified.status, 200);
  assert.ok((await verified.json() as { verifiedUntil: string }).verifiedUntil);
  assert.equal((await request("/archive/management-access", "GET", undefined, secondAdmin)).status, 200);
  assert.equal((await request(`/documents/${doc.documentId}`, "PATCH", { notes: "Other session denied" }, secondAdmin)).status, 403);
  assert.equal((await request(`/documents/${doc.documentId}`, "PATCH", { notes: "Delegated edit", managementOwnerUserId: admin.user.userId }, admin.cookie)).status, 200);
  assert.equal((await repo.getDocument(doc.documentId))?.managementOwnerUserId, owner.user.userId);
  assert.equal((await request(`/archive/folders/${folder.folderId}`, "DELETE", undefined, secondAdmin)).status, 403);
  const bulk = await request("/documents/bulk", "POST", {
    action: "set-review-status", documentIds: [doc.documentId, staffDoc.documentId], reviewStatus: "approved"
  }, owner.cookie);
  assert.equal(bulk.status, 200);
  const result = await bulk.json() as { succeeded: number; failed: unknown[] };
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed.length, 1);
  assert.equal((await repo.getDocument(staffDoc.documentId))?.reviewStatus, "needs-review");
  assert.equal((await request(`/archive/folders/${folder.folderId}`, "DELETE", undefined, admin.cookie)).status, 200);
  assert.equal((await request(`/documents/${doc.documentId}/restore`, "POST", undefined, secondAdmin)).status, 403);
  assert.equal((await request(`/archive/folders/${folder.folderId}/restore`, "POST", {}, secondAdmin)).status, 403);
  assert.equal((await request(`/archive/folders/${folder.folderId}/restore`, "POST", {}, admin.cookie)).status, 200);
  assert.equal((await request("/archive/management-access", "DELETE", undefined, admin.cookie)).status, 200);
  assert.equal((await request(`/documents/${doc.documentId}`, "PATCH", { notes: "Ended access" }, admin.cookie)).status, 403);
});

test("multipart version and attachment routes reject foreign ownership without retaining partial metadata or changing existing bytes", async () => {
  const owner = await prepare("Manager"), staff = await prepare("Staff"), admin = await prepare("Admin");
  const doc = await repo.createDocument(cleanupDocumentInput(owner.user.userId));
  const storage = createDocumentStorage(env);
  await storage.put(doc.r2ObjectKey, new TextEncoder().encode("Original synthetic content").buffer, "text/plain");
  const message = await repo.createServiceDiscussionMessage({ createdBy: owner.user.userId, bodyText: "Synthetic protected note" });
  const upload = (path: string, cookie: string) => {
    const form = new FormData();
    form.set("file", new File(["Synthetic upload"], "fixture.txt", { type: "text/plain" }));
    return app.request(`/api${path}`, { method: "POST", headers: { cookie }, body: form }, env);
  };
  const before = (await repo.exportDatabaseTables()).tables.find((t) => t.tableName === "documents")!.rowCount;
  for (const cookie of [staff.cookie, admin.cookie]) {
    assert.equal((await upload(`/documents/${doc.documentId}/versions`, cookie)).status, 403);
    assert.equal((await upload(`/discussion/messages/${message.messageId}/attachments`, cookie)).status, 403);
  }
  assert.equal((await repo.exportDatabaseTables()).tables.find((t) => t.tableName === "documents")!.rowCount, before);
  assert.equal((await repo.listDocumentVersions(doc.documentId)).length, 1);
  assert.equal((await repo.getServiceDiscussionMessage(message.messageId))?.attachments.length, 0);
  const uploaded = await upload(`/discussion/messages/${message.messageId}/attachments`, owner.cookie);
  assert.equal(uploaded.status, 201, await uploaded.clone().text());
  assert.equal((await repo.getServiceDiscussionMessage(message.messageId))?.attachments.length, 1);
  const attached = await uploaded.json() as { documentId: string };
  assert.equal((await request(`/documents/${attached.documentId}`, "DELETE", undefined, owner.cookie)).status, 200);
  assert.equal((await request(`/documents/${attached.documentId}/permanent`, "DELETE", undefined, owner.cookie)).status, 409);
  assert.ok(await repo.getDocument(attached.documentId, { includeDeleted: true }));
});

test("HTTP content management keeps shared reading, requires delegated verification, and binds inline uploads before a body save", async () => {
  const owner = await prepare("Manager"), staff = await prepare("Staff"), admin = await prepare("Admin");
  const noteResponse = await request("/discussion/messages", "POST", { bodyText: "Synthetic owned HTTP note", managementOwnerUserId: admin.user.userId }, owner.cookie);
  assert.equal(noteResponse.status, 201, await noteResponse.clone().text());
  const note = await noteResponse.json() as { messageId: string; managementOwnerUserId: string };
  assert.equal(note.managementOwnerUserId, owner.user.userId);
  for (const cookie of [staff.cookie, admin.cookie]) {
    assert.equal((await request(`/discussion/messages/${note.messageId}`, "PATCH", { isPinned: true }, cookie)).status, 403);
    assert.equal((await request(`/discussion/messages/${note.messageId}`, "DELETE", undefined, cookie)).status, 403);
  }
  const knowledgeResponse = await request("/knowledge", "POST", { title: "Synthetic HTTP Knowledge", type: "Reference", status: "Draft", component: "", summary: "", body: "Shared reading", managementOwnerUserId: admin.user.userId }, owner.cookie);
  assert.equal(knowledgeResponse.status, 201, await knowledgeResponse.clone().text());
  const knowledge = await knowledgeResponse.json() as { knowledgeId: string; managementOwnerUserId: string };
  assert.equal(knowledge.managementOwnerUserId, owner.user.userId);
  assert.equal((await request(`/knowledge/${knowledge.knowledgeId}`, "GET", undefined, staff.cookie)).status, 200);
  assert.equal((await request(`/knowledge/${knowledge.knowledgeId}`, "PATCH", { body: "Denied" }, admin.cookie)).status, 403);
  const work = await repo.createManuscript({ title: "Synthetic HTTP image work", kind: "Novel", status: "Draft", createdBy: owner.user.userId });
  const upload = (cookie: string) => {
    const form = new FormData();
    form.set("file", new File(["Synthetic inline upload"], "synthetic.txt", { type: "text/plain" }));
    form.set("manuscriptId", work.manuscriptId);
    return app.request("/api/documents", { method: "POST", headers: { cookie }, body: form }, env);
  };
  const count = (await repo.exportDatabaseTables()).tables.find((t) => t.tableName === "documents")!.rowCount;
  assert.equal((await upload(admin.cookie)).status, 403);
  assert.equal((await repo.exportDatabaseTables()).tables.find((t) => t.tableName === "documents")!.rowCount, count);
  const uploaded = await upload(owner.cookie);
  assert.equal(uploaded.status, 201, await uploaded.clone().text());
  const image = await uploaded.json() as { documentId: string };
  assert.ok((await repo.readArchiveContentDocumentIds("manuscript", work.manuscriptId)).includes(image.documentId));
  const chapterPath = `/manuscripts/${work.manuscriptId}/chapters/${work.chapters[0].chapterId}`;
  assert.equal((await request(chapterPath, "GET", undefined, staff.cookie)).status, 200);
  assert.equal((await request(chapterPath, "PATCH", { body: "Denied", expectedRevision: 1 }, admin.cookie)).status, 403);
  assert.equal((await request("/archive/management-access", "POST", { currentPassword: password }, admin.cookie)).status, 200);
  assert.equal((await request(chapterPath, "PATCH", { body: "Delegated body", expectedRevision: 1 }, admin.cookie)).status, 200);
  assert.equal((await request(`/knowledge/${knowledge.knowledgeId}`, "PATCH", { body: "Delegated Knowledge", managementOwnerUserId: admin.user.userId }, admin.cookie)).status, 200);
  assert.equal((await repo.getKnowledge(knowledge.knowledgeId))?.managementOwnerUserId, owner.user.userId);
  assert.equal((await request("/archive/management-access", "DELETE", undefined, admin.cookie)).status, 200);
  assert.equal((await request(chapterPath, "PATCH", { body: "Grant ended", expectedRevision: 2 }, admin.cookie)).status, 403);
  assert.equal((await repo.getManuscriptChapter(work.manuscriptId, work.chapters[0].chapterId))?.body, "Delegated body");
  assert.equal((await request(`/documents/${image.documentId}`, "DELETE", undefined, owner.cookie)).status, 200);
  assert.equal((await request(`/documents/${image.documentId}/permanent`, "DELETE", undefined, owner.cookie)).status, 409);
});

test("cleanup diagnostics expose only counts to an authenticated Admin", async () => {
  assert.equal((await request("/archive/storage-cleanup/status")).status, 401);
  for (const role of ["Admin", "Manager", "Staff", "ReadOnly"] as const) {
    const { cookie } = await prepare(role);
    const result = await request("/archive/storage-cleanup/status", "GET", undefined, cookie);
    assert.equal(result.status, role === "Admin" ? 200 : 403);
    if (role === "Admin") {
      const data = await result.json() as Record<string, unknown>;
      assert.deepEqual(Object.keys(data).sort(), ["completed", "failed", "leased", "pending", "referenced"]);
      assert.ok(Object.values(data).every((value) => typeof value === "number"));
    }
  }
});

test("folder trash API reports restore conflicts, supports relocation and enforces ReadOnly", async () => {
  const { user, cookie } = await prepare("Admin");
  const name = `Synthetic API folder ${crypto.randomUUID()}`;
  const created = await request("/archive/folders", "POST", { name }, cookie);
  assert.equal(created.status, 201);
  const root = await created.json() as { folderId: string };
  const childResponse = await request("/archive/folders", "POST", { name: "Synthetic child", parentFolderId: root.folderId }, cookie);
  const child = await childResponse.json() as { folderId: string };
  const document = await repo.createDocument({ ...cleanupDocumentInput(user.userId), folderId: child.folderId });
  await createDocumentStorage(env).put(document.r2ObjectKey, new TextEncoder().encode("test").buffer, "text/plain");
  const { cookie: readonly } = await prepare("ReadOnly");
  for (const [path, method, body] of [["/archive/folders", "POST", { name: "Denied" }],
    [`/archive/folders/${root.folderId}`, "DELETE", undefined],
    [`/archive/folders/${root.folderId}/restore`, "POST", {}]] as const) {
    assert.equal((await request(path, method, body, readonly)).status, 403);
  }
  assert.equal((await request(`/archive/folders/${root.folderId}`, "DELETE", undefined, cookie)).status, 200);
  const trash = await request("/archive/folders?trashed=true", "GET", undefined, readonly);
  assert.equal(trash.status, 200);
  assert.ok((await trash.json() as Array<{ folderId: string }>).some((item) => item.folderId === root.folderId));
  assert.equal((await request(`/documents/${document.documentId}/restore`, "POST", undefined, cookie)).status, 409);
  assert.equal((await request("/archive/folders", "POST", { name }, cookie)).status, 201);
  assert.equal((await request(`/archive/folders/${root.folderId}/restore`, "POST", {}, cookie)).status, 409);
  assert.equal((await request(`/archive/folders/${root.folderId}/restore`, "POST", { name: `${name} recovered`, parentFolderId: null }, cookie)).status, 200);
  assert.equal((await repo.getDocument(document.documentId))?.folderId, child.folderId);
});

test("real password change rotates its cookie and rejects both old API sessions and the old password", async () => {
  const { user, cookie: first } = await prepare("Admin");
  const second = await signIn(user);
  const nextPassword = "SyntheticReplacement2026";
  const response = await request("/auth/change-password", "POST", {
    currentPassword: password, newPassword: nextPassword, confirmPassword: nextPassword
  }, first);
  assert.equal(response.status, 200);
  const replacement = response.headers.get("set-cookie")!.split(";")[0];
  assert.notEqual(replacement, first);
  for (const cookie of [first, second]) assert.equal((await request("/documents", "GET", undefined, cookie)).status, 401);
  assert.equal((await request("/documents", "GET", undefined, replacement)).status, 200);
  assert.equal((await request("/auth/login", "POST", { email: user.email, password })).status, 401);
  await signIn(user, nextPassword);
});

test("forced password change is enforced by protected API and clears only after successful change", async () => {
  const { user } = await prepare("Manager");
  await repo.updateUserPassword(user.userId, { ...await hashPassword(password), mustChangePassword: true });
  const cookie = await signIn(user);
  assert.equal((await request("/documents", "GET", undefined, cookie)).status, 403);
  const response = await request("/auth/change-password", "POST", {
    currentPassword: password, newPassword: "ForcedReplacement2026", confirmPassword: "ForcedReplacement2026"
  }, cookie);
  assert.equal(response.status, 200);
  assert.equal((await request("/documents", "GET", undefined, response.headers.get("set-cookie")!.split(";")[0])).status, 200);
});

test("an in-flight old request cannot overwrite a cookie rotated by password change", { timeout: 10000 }, async () => {
  for (const path of ["/documents", "/auth/session"]) {
    const { cookie } = await prepare("Admin");
    const originalRead = repo.getUserBySessionTokenHash.bind(repo);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const reached = new Promise<void>((resolve) => { entered = resolve; });
    let holdNext = true;
    repo.getUserBySessionTokenHash = async (...args) => {
      const user = await originalRead(...args);
      if (holdNext) {
        holdNext = false;
        assert.equal(args[1], undefined, "ordinary reads do not extend the token lifetime");
        entered();
        await gate;
      }
      return user;
    };
    const pending = request(path, "GET", undefined, cookie);
    try {
      await reached;
      const changed = await request("/auth/change-password", "POST", {
        currentPassword: password, newPassword: "ConcurrentRotation2026", confirmPassword: "ConcurrentRotation2026"
      }, cookie);
      assert.equal(changed.status, 200);
      const replacement = changed.headers.get("set-cookie")!.split(";")[0];
      assert.notEqual(replacement, cookie);
      release();
      assert.equal((await pending).headers.get("set-cookie"), null, path);
      assert.equal((await request("/documents", "GET", undefined, replacement)).status, 200);
      assert.equal((await request("/documents", "GET", undefined, cookie)).status, 401);
    } finally {
      release();
      repo.getUserBySessionTokenHash = originalRead;
      await pending;
    }
  }
});

test("all manuscript key routes deny another Manager/Admin; owner recovery retains the original work key", async () => {
  const owner = await prepare("Manager");
  const other = await prepare("Admin");
  const manuscript = await repo.createManuscript({ title: "Synthetic protected work", kind: "Novel", status: "Draft", description: "", createdBy: owner.user.userId });
  const encryption = await createManuscriptEncryption("SyntheticVaultPassword2026");
  const wrapped = await wrapManuscriptRecoveryKey(encryption.recoveryWorkKey, manuscript.manuscriptId, env);
  const chapter = await repo.getManuscriptChapter(manuscript.manuscriptId, manuscript.chapters[0].chapterId);
  assert.ok(chapter);
  const ciphertext = await encryptManuscriptBody(encryption.workKey, manuscript.manuscriptId, chapter.chapterId, "Synthetic protected chapter");
  await repo.replaceManuscriptBodyEncryption(manuscript.manuscriptId, {
    chapters: [{ chapterId: chapter.chapterId, expectedRevision: chapter.revision, body: ciphertext }],
    versions: [], metadata: { ...encryption.metadata, recoveryEncryptedWorkKey: wrapped }
  }, true, owner.user.userId);
  const routes = [
    ["enable", "POST", { chapters: [], versions: [], metadata: encryption.metadata, recoveryWorkKey: encryption.recoveryWorkKey }],
    ["disable", "POST", { chapters: [], versions: [] }],
    ["key", "PATCH", encryption.metadata],
    ["reset-password", "POST", { currentAccountPassword: password, newEncryptionPassword: "RecoveredSynthetic2026" }]
  ] as const;
  for (const [path, method, body] of routes) {
    const response = await request(`/manuscripts/${manuscript.manuscriptId}/encryption/${path}`, method, body, other.cookie);
    assert.equal(response.status, 403, path);
  }
  assert.equal((await repo.getManuscript(manuscript.manuscriptId))!.encryptedWorkKey, encryption.metadata.encryptedWorkKey);
  const recovered = await request(`/manuscripts/${manuscript.manuscriptId}/encryption/reset-password`, "POST", {
    currentAccountPassword: password, newEncryptionPassword: "RecoveredSynthetic2026"
  }, owner.cookie);
  assert.equal(recovered.status, 200, await recovered.clone().text());
  const saved = await repo.getManuscript(manuscript.manuscriptId);
  assert.ok(saved);
  const recoveredKey = await unlockManuscriptWithPassword(saved, "RecoveredSynthetic2026");
  assert.deepEqual(recoveredKey, encryption.workKey);
  assert.equal((await repo.getManuscriptChapter(manuscript.manuscriptId, chapter.chapterId))!.body, ciphertext);
  assert.equal(await decryptManuscriptBody(recoveredKey, manuscript.manuscriptId, chapter.chapterId, ciphertext), "Synthetic protected chapter");
  const adminOwned = await repo.createManuscript({ title: "Other synthetic owner", kind: "Novel", status: "Draft", description: "", createdBy: other.user.userId });
  assert.equal((await request(`/manuscripts/${adminOwned.manuscriptId}/encryption/reset-password`, "POST", { currentAccountPassword: password, newEncryptionPassword: "DeniedSynthetic2026" }, owner.cookie)).status, 403);
  const legacy = await repo.createManuscript({ title: "Synthetic unassigned work", kind: "Novel", status: "Draft", description: "" });
  assert.equal((await request(`/manuscripts/${legacy.manuscriptId}/encryption/disable`, "POST", { chapters: [], versions: [] }, other.cookie)).status, 403);
});

test("real preview ignores malicious stored MIME while preserving original bytes and authorizing downloads", async () => {
  const { user, cookie } = await prepare("Admin");
  const text = '<html><script>globalThis.syntheticPreview=true</script></html>';
  const body = new TextEncoder().encode(text);
  const document = await repo.createDocument({
    documentId: crypto.randomUUID(), caseId: null, fileName: "伪装.pdf", originalFileName: "伪装.pdf",
    fileSize: body.byteLength, mimeType: "application/pdf", category: "Other", notes: "", r2ObjectKey: `synthetic/${crypto.randomUUID()}`, uploadedBy: user.userId
  });
  await createDocumentStorage(env).put(document.r2ObjectKey, body.buffer, "application/pdf");
  assert.equal((await request(`/documents/${document.documentId}/preview`)).status, 401);
  const response = await request(`/documents/${document.documentId}/preview`, "GET", undefined, cookie);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/octet-stream");
  assert.match(response.headers.get("content-disposition")!, /^attachment;/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy")!, /sandbox/);
  assert.equal(await response.text(), text);
  const rangedPreview = (range: string) => app.request(`/api/documents/${document.documentId}/preview`, {
    headers: { cookie, range }
  }, env);
  const middle = await rangedPreview("bytes=13-22");
  assert.equal(middle.status, 206);
  assert.equal(middle.headers.get("content-range"), `bytes 13-22/${body.byteLength}`);
  assert.equal(middle.headers.get("content-type"), "application/octet-stream");
  assert.equal(middle.headers.get("x-content-type-options"), "nosniff");
  assert.match(middle.headers.get("content-security-policy")!, /sandbox/);
  assert.equal(await middle.text(), text.slice(13, 23));
  const first = await rangedPreview("bytes=0-7");
  assert.equal(first.status, 206);
  assert.equal(await first.text(), text.slice(0, 8));
  const unsatisfiable = await rangedPreview(`bytes=${body.byteLength}-`);
  assert.equal(unsatisfiable.status, 416);
  assert.equal(unsatisfiable.headers.get("content-range"), `bytes */${body.byteLength}`);
});

test("HTTP creation and editing cannot forge or transfer manuscript key ownership", async () => {
  const owner = await prepare("Manager"), other = await prepare("Admin");
  const response = await request("/manuscripts", "POST", { title: "Synthetic key authority", kind: "Novel", status: "Draft",
    createdBy: other.user.userId, keyOwnerUserId: other.user.userId }, owner.cookie);
  assert.equal(response.status, 201);
  const created = await response.json() as { manuscriptId: string; keyOwnerUserId: string; createdBy: string };
  assert.equal(created.keyOwnerUserId, owner.user.userId);
  assert.equal(created.createdBy, owner.user.userId);
  assert.equal((await request(`/manuscripts/${created.manuscriptId}`, "PATCH", { title: "Denied without verification" }, other.cookie)).status, 403);
  assert.equal((await request("/archive/management-access", "POST", { currentPassword: password }, other.cookie)).status, 200);
  const changed = await request(`/manuscripts/${created.manuscriptId}`, "PATCH", {
    title: "Synthetic metadata edit", keyOwnerUserId: other.user.userId, createdBy: other.user.userId
  }, other.cookie);
  assert.equal(changed.status, 200);
  assert.equal((await repo.getManuscript(created.manuscriptId))?.keyOwnerUserId, owner.user.userId);
  assert.equal((await repo.getManuscript(created.manuscriptId))?.managementOwnerUserId, owner.user.userId);
});

test("unresolved encrypted work retains password unlock; audited claim enables only the confirmed account's recovery", async () => {
  const owner = await prepare("Manager"), other = await prepare("Admin");
  const work = await repo.createManuscript({ title: "Synthetic unresolved encrypted work", kind: "Novel", status: "Draft" });
  const chapter = await repo.getManuscriptChapter(work.manuscriptId, work.chapters[0].chapterId);
  assert.ok(chapter);
  const encryption = await createManuscriptEncryption("SyntheticOriginalWorkPassword");
  const body = await encryptManuscriptBody(encryption.workKey, work.manuscriptId, chapter.chapterId, "Synthetic legacy body");
  await repo.replaceManuscriptBodyEncryption(work.manuscriptId, { chapters: [{ chapterId: chapter.chapterId, expectedRevision: chapter.revision, body }], versions: [],
    metadata: { ...encryption.metadata, recoveryEncryptedWorkKey: await wrapManuscriptRecoveryKey(encryption.recoveryWorkKey, work.manuscriptId, env) } }, true);
  for (const cookie of [owner.cookie, other.cookie]) {
    for (const [path, method, payload] of [["enable", "POST", {}], ["disable", "POST", {}], ["key", "PATCH", encryption.metadata],
      ["reset-password", "POST", { currentAccountPassword: password, newEncryptionPassword: "SyntheticRecoveredPassword" }]] as const) {
      assert.equal((await request(`/manuscripts/${work.manuscriptId}/encryption/${path}`, method, payload, cookie)).status, 403, path);
    }
    const visible = await request(`/manuscripts/${work.manuscriptId}`, "GET", undefined, cookie);
    assert.equal(visible.status, 200);
    assert.deepEqual(await unlockManuscriptWithPassword(await visible.json(), "SyntheticOriginalWorkPassword"), encryption.workKey);
  }
  const review = (await repo.listUnresolvedManuscriptKeyOwnership()).find((item) => item.manuscriptId === work.manuscriptId)!;
  await repo.claimManuscriptKeyOwner({ manuscriptId: work.manuscriptId, ownerUserId: owner.user.userId,
    expectedUpdatedAt: review.expectedUpdatedAt, operatorReference: "synthetic-maintainer", evidenceReference: "synthetic-review/0002" });
  const path = `/manuscripts/${work.manuscriptId}/encryption/reset-password`;
  const reset = { currentAccountPassword: password, newEncryptionPassword: "SyntheticRecoveredPassword" };
  assert.equal((await request(path, "POST", reset, other.cookie)).status, 403);
  assert.equal((await request(path, "POST", reset, owner.cookie)).status, 200);
  const saved = (await repo.getManuscript(work.manuscriptId))!;
  assert.equal(saved.createdBy, null);
  assert.deepEqual(await unlockManuscriptWithPassword(saved, reset.newEncryptionPassword), encryption.workKey);
  assert.equal((await repo.getManuscriptChapter(work.manuscriptId, chapter.chapterId))?.body, body);
});

test("an old editor identity cannot submit a chapter under another signed-in account", async () => {
  const owner = await prepare("Manager"), other = await prepare("Admin");
  const manuscript = await repo.createManuscript({ title: "Synthetic account-bound editing", kind: "Novel", status: "Draft", description: "", createdBy: owner.user.userId });
  const chapter = await repo.getManuscriptChapter(manuscript.manuscriptId, manuscript.chapters[0].chapterId);
  assert.ok(chapter);
  const url = `/api/manuscripts/${manuscript.manuscriptId}/chapters/${chapter.chapterId}?summary=true`;
  const body = { title: chapter.title, body: "Unsaved text from the original account", characterCount: 36, contentFormat: "markdown", expectedRevision: chapter.revision, saveSource: "autosave" };
  const send = (cookie: string) => app.request(url, { method: "PATCH", headers: { cookie, "content-type": "application/json", "x-archive-user-id": owner.user.userId }, body: JSON.stringify(body) }, env);
  assert.equal((await send(other.cookie)).status, 403);
  assert.equal((await repo.getManuscriptChapter(manuscript.manuscriptId, chapter.chapterId))?.body, chapter.body);
  assert.equal((await send(owner.cookie)).status, 200);
});

test("backup API retains standalone folder/version metadata and copies identical filenames to distinct objects", async () => {
  const { user, cookie } = await prepare("Admin");
  const originalListCases = repo.listCases.bind(repo);
  repo.listCases = async () => [];
  try {
    const folder = await repo.createArchiveFolder({ folderId: crypto.randomUUID(), name: "Synthetic archive folder", createdBy: user.userId });
    const category = await repo.createArchiveCategory({ categoryId: crypto.randomUUID(), name: "Synthetic category", createdBy: user.userId });
    const documents = [];
    for (const [name, text] of [["相同名字.txt", "First original bytes"], ["相同名字.txt", "Second original bytes"], ["..", "First dot segment bytes"], ["..", "Second dot segment bytes"]]) {
      const bytes = new TextEncoder().encode(text);
      const document = await repo.createDocument({
        documentId: crypto.randomUUID(), caseId: null, fileName: name, originalFileName: name,
        fileSize: bytes.byteLength, mimeType: "text/plain", category: category.name, notes: "", folderId: folder.folderId,
        r2ObjectKey: `synthetic/${crypto.randomUUID()}`, uploadedBy: user.userId
      });
      await createDocumentStorage(env).put(document.r2ObjectKey, bytes.buffer, "text/plain");
      documents.push({ document, text });
    }
    const response = await request("/backups/runs", "POST", {
      dryRun: false, destination: "r2-manifest", scope: "all-cases", includeMetadata: true, includeDocuments: true,
      includeAuditLogs: true, includeRelationshipMap: true, folderByCaseAndCategory: true, checksumManifest: true
    }, cookie);
    assert.equal(response.status, 201, await response.clone().text());
    const run = await response.json() as BackupRun;
    assert.equal(run.failedItems, 0);
    const manifestResponse = await request(`/backups/runs/${run.backupRunId}/manifest`, "GET", undefined, cookie);
    assert.equal(manifestResponse.status, 200);
    const manifest = await manifestResponse.json() as {
      formatVersion: number;
      metadata: Pick<BackupSnapshot, "documents" | "archiveFolders" | "archiveCategories">;
      backupItems: BackupItem[];
    };
    assert.equal(manifest.formatVersion, 2);
    assert.ok(manifest.metadata.archiveFolders.some((item: { folderId: string }) => item.folderId === folder.folderId));
    assert.ok(manifest.metadata.archiveCategories.some((item: { categoryId: string }) => item.categoryId === category.categoryId));
    const destinations = [];
    for (const { document, text } of documents) {
      assert.equal(manifest.metadata.documents.find((item) => item.documentId === document.documentId)?.folderId, folder.folderId);
      const item = manifest.backupItems.find((value) => value.sourceId === document.documentId);
      assert.ok(item?.targetPath);
      const object = await createBackupStorage(env).get(item.targetPath);
      assert.ok(object);
      assert.equal(await new Response(object.body).text(), text);
      const normalizedPath = new URL(item.targetPath, "https://synthetic-backup.invalid/").pathname;
      assert.ok(normalizedPath.includes(`/${document.documentId}/`));
      destinations.push(normalizedPath);
    }
    assert.equal(new Set(destinations).size, documents.length);
  } finally {
    repo.listCases = originalListCases;
  }
});
