import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import postgres from "postgres";
import { DemoRepository } from "../src/server/repositories/memory";
import { PostgresRepository } from "../src/server/repositories/postgres";
import type { AppRepository } from "../src/server/repositories/types";
import { bookmarkInputSchema, type ManuscriptBookmarkInput } from "../src/shared/manuscriptBookmarks";
import { app } from "../functions/api/[[path]]";
import { createRepository } from "../src/server/repositories/factory";
import { hashPassword } from "../src/server/auth/password";

async function exercise(repo: AppRepository, owner: string, other: string) {
  const work = await repo.createManuscript({ title: "Synthetic bookmark novel", kind: "Novel", status: "Draft", createdBy: owner });
  const chapter = work.chapters[0];
  const input: ManuscriptBookmarkInput = { chapterId: chapter.chapterId, name: "Synthetic location", anchor: {
    version: 1, revision: chapter.revision, format: chapter.contentFormat, block: 2, offset: 4, kind: "text", exact: "Synthetic text", prefix: "before", suffix: "after"
  } };
  const saved = await repo.createManuscriptBookmark(owner, work.manuscriptId, input); assert.ok(saved);
  assert.equal((await repo.createManuscriptBookmark(owner, work.manuscriptId, input))?.bookmarkId, saved.bookmarkId);
  assert.equal((await repo.listManuscriptBookmarks(other, work.manuscriptId)).length, 0);
  assert.equal(await repo.renameManuscriptBookmark(other, work.manuscriptId, saved.bookmarkId, "Wrong owner"), null);
  assert.equal(await repo.deleteManuscriptBookmark(other, work.manuscriptId, saved.bookmarkId), false);
  assert.equal((await repo.renameManuscriptBookmark(owner, work.manuscriptId, saved.bookmarkId, "Renamed"))?.name, "Renamed");
  await assert.rejects(repo.createManuscriptBookmark(owner, work.manuscriptId, { ...input, anchor: { ...input.anchor, revision: 99 } }));
  const differentWork = await repo.createManuscript({ title: "Different work", kind: "Novel", status: "Draft", createdBy: owner });
  assert.equal(await repo.createManuscriptBookmark(owner, differentWork.manuscriptId, input), null);
  const concurrent = await Promise.all([1, 2, 3].map(() => repo.createManuscriptBookmark(other, work.manuscriptId, input)));
  assert.equal(new Set(concurrent.map((b) => b?.bookmarkId)).size, 1);
  const metadata = { encryptionVersion: 1, encryptionKdf: "PBKDF2-SHA-256", encryptionIterations: 600000, encryptionSalt: "synthetic", encryptedWorkKey: "synthetic", recoveryEncryptedWorkKey: "synthetic" };
  const replacement = { chapters: [{ chapterId: chapter.chapterId, expectedRevision: chapter.revision, body: "synthetic ciphertext" }], versions: [], metadata };
  await assert.rejects(repo.replaceManuscriptBodyEncryption(work.manuscriptId, { ...replacement, chapters: [] }, true, owner));
  assert.equal((await repo.listManuscriptBookmarks(owner, work.manuscriptId))[0].name, "Renamed");
  await Promise.all([
    repo.replaceManuscriptBodyEncryption(work.manuscriptId, replacement, true, owner),
    repo.createManuscriptBookmark(owner, work.manuscriptId, { ...input, anchor: { ...input.anchor, block: 9 } })
  ]);
  for (const user of [owner, other]) {
    for (const scrubbed of await repo.listManuscriptBookmarks(user, work.manuscriptId)) {
      assert.equal(scrubbed.name, ""); assert.equal(scrubbed.positionOnly, true); assert.equal(scrubbed.anchor.exact + scrubbed.anchor.prefix + scrubbed.anchor.suffix, "");
    }
  }
  await assert.rejects(repo.renameManuscriptBookmark(owner, work.manuscriptId, saved.bookmarkId, "Must not store this"));
  const encrypted = await repo.createManuscriptBookmark(owner, work.manuscriptId, { ...input, anchor: { ...input.anchor, block: 5 } });
  assert.equal(encrypted?.name, ""); assert.equal(encrypted?.anchor.exact, "");
  const snapshot = await repo.buildBackupSnapshot("all-cases");
  assert.ok(snapshot.manuscriptBookmarks.some((b) => b.bookmarkId === saved.bookmarkId));
  const dump = await repo.exportDatabaseTables();
  assert.ok(dump.tables.some((t) => t.tableName === "manuscript_bookmarks"));
  await repo.deleteManuscriptChapter(work.manuscriptId, chapter.chapterId);
  assert.equal(await repo.createManuscriptBookmark(owner, work.manuscriptId, input), null);
  assert.equal((await repo.listManuscriptBookmarks(owner, work.manuscriptId)).length, 3);
  await repo.softDeleteManuscript(work.manuscriptId);
  assert.equal((await repo.listManuscriptBookmarks(owner, work.manuscriptId)).length, 0);
  return { work, saved };
}

test("memory bookmarks isolate owners, retain positions, scrub encryption transitions, and enter backups", async () => {
  const repo = new DemoRepository(); const users = await repo.listUsers();
  await exercise(repo, users[0].userId, users[1].userId);
});

test("bookmark API permits personal ReadOnly markers but rejects owner injection and cross-account edits", async () => {
  const env = { APP_ENV: "test", BUSINESS_TEMPLATE: "personal-archive", DEMO_MODE: "false", PUBLIC_DEMO_READONLY: "false" };
  const repo = createRepository(env);
  const users = await repo.listUsers(); const owner = users.find((u) => u.role === "ReadOnly")!; const other = users.find((u) => u.role === "Admin")!;
  const password = `synthetic-${crypto.randomUUID()}`;
  const request = (path: string, method = "GET", body?: unknown, cookie?: string) => app.request(`/api${path}`, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  async function login(user: typeof owner) {
    await repo.updateUserPassword(user.userId, await hashPassword(password));
    const response = await request("/auth/login", "POST", { email: user.email, password });
    assert.equal(response.status, 200); return response.headers.get("set-cookie")!.split(";")[0];
  }
  const cookie = await login(owner), otherCookie = await login(other);
  const work = await repo.createManuscript({ title: "Synthetic API", kind: "Novel", status: "Draft" });
  const input = { chapterId: work.chapters[0].chapterId, name: "Sample", anchor: { version: 1, revision: 1, format: "rich-text", block: 0, offset: 0, kind: "text" } };
  const path = `/manuscripts/${work.manuscriptId}/bookmarks`;
  assert.equal((await request(path)).status, 401);
  assert.equal((await request(path, "POST", { ...input, userId: other.userId }, cookie)).status, 400);
  const create = await request(path, "POST", input, cookie); assert.equal(create.status, 201, await create.clone().text());
  const saved = await create.json() as { bookmarkId: string; userId: string }; assert.equal(saved.userId, owner.userId);
  assert.deepEqual(await (await request(path, "GET", undefined, otherCookie)).json(), []);
  for (const method of ["PATCH", "DELETE"]) assert.equal((await request(`${path}/${saved.bookmarkId}`, method, method === "PATCH" ? { name: "Wrong owner" } : undefined, otherCookie)).status, 404);
  assert.equal((await request(path, "POST", { ...input, anchor: { ...input.anchor, revision: 99 } }, cookie)).status, 409);
  assert.equal((await request(`/manuscripts/not-a-uuid/bookmarks`, "GET", undefined, cookie)).status, 400);
  assert.equal((await request(`${path}/${saved.bookmarkId}`, "DELETE", undefined, cookie)).status, 200);
  await repo.softDeleteManuscript(work.manuscriptId);
  assert.equal((await request(path, "GET", undefined, cookie)).status, 404);
  assert.equal(bookmarkInputSchema.safeParse({ ...input, anchor: { ...input.anchor, block: -1 } }).success, false);
});

test("PostgreSQL bookmarks survive a real dump/restore with owners and encrypted-state cleanup", { skip: !process.env.PA_BOOKMARK_SOCKET }, async () => {
  const socket = process.env.PA_BOOKMARK_SOCKET;
  assert.ok(socket && basename(socket).startsWith("pa-bookmark-test-"), "Run through the owned-cluster launcher");
  const sql = postgres({ host: socket, port: 55439, username: "bookmark_test", database: "postgres", max: 5 });
  try {
    for (const file of (await readdir("migrations")).filter((f) => f.endsWith(".sql") && !f.includes("seed")).sort()) await sql.unsafe(await readFile(`migrations/${file}`, "utf8"));
    const owner = crypto.randomUUID(), other = crypto.randomUUID();
    for (const [id, role] of [[owner, "ReadOnly"], [other, "Admin"]]) await sql`insert into users(user_id,name,email,role) values (${id}, 'Synthetic', ${`${id}@example.invalid`}, ${role})`;
    const { work, saved } = await exercise(new PostgresRepository(sql), owner, other);
    const clients = process.env.PA_BOOKMARK_CLIENT_BIN!;
    const env = { PATH: "/usr/bin:/bin", PGHOST: socket, PGPORT: "55439", PGUSER: "bookmark_test" };
    execFileSync(`${clients}/pg_dump`, ["-Fc", "-f", `${socket}/backup.dump`, "postgres"], { env });
    await sql.unsafe('create database bookmark_restore');
    execFileSync(`${clients}/pg_restore`, ["--exit-on-error", "-d", "bookmark_restore", `${socket}/backup.dump`], { env });
    const restored = postgres({ host: socket, port: 55439, username: "bookmark_test", database: "bookmark_restore" });
    try {
      const before = await sql`select * from manuscript_bookmarks order by bookmark_id`;
      const after = await restored`select * from manuscript_bookmarks order by bookmark_id`;
      assert.deepEqual([...after], [...before]); assert.ok(after.some((r) => r.bookmark_id === saved.bookmarkId));
      await restored`delete from manuscripts where manuscript_id = ${work.manuscriptId}`;
      assert.equal((await restored`select * from manuscript_bookmarks where manuscript_id = ${work.manuscriptId}`).length, 0);
    } finally { await restored.end(); }
  } finally { await sql.end(); }
});
