import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { installLocalStorage } from "./helpers/browserStorage";
import { readManuscriptLocalDraft as read, writeManuscriptLocalDraft as write, deleteManuscriptLocalDraft as remove, listManuscriptLocalDrafts as list } from "../src/shared/manuscriptLocalDraft";
const storage = installLocalStorage();
Object.defineProperty(globalThis, "indexedDB", { value: new IDBFactory(), configurable: true });
const a = { instanceId: "https://archive.example.invalid", userId: "synthetic-a" };
const b = { ...a, userId: "synthetic-b" };
const otherInstance = { ...a, instanceId: "https://other.example.invalid" };
const draft = { manuscriptId: "work", chapterId: "chapter", title: "Synthetic", body: "Unsaved synthetic words", contentFormat: "markdown" as const, baseUpdatedAt: "baseline", savedAt: "2026-09-06T12:00:00Z" };

test("IndexedDB drafts require an explicit account and never cross accounts or instances", async () => {
  assert.equal(await write(draft, a, true), true);
  assert.equal((await read("work", "chapter", a))?.body, draft.body);
  assert.equal(await read("work", "chapter", b), null);
  assert.deepEqual(await list("work", otherInstance), []);
  await remove("work", "chapter", b);
  assert.ok(await read("work", "chapter", a));
  await assert.rejects(write(draft, { ...a, userId: "" }, true));
  assert.equal(storage.length, 0, "successful IndexedDB writes do not also retain a fallback copy");
});

test("plaintext persistence is opt-in; disabling it retains this tab's draft", async () => {
  const account = { ...a, userId: "synthetic-consent" };
  assert.equal(await write(draft, account), false);
  assert.equal((await read("work", "chapter", account))?.body, draft.body);
  assert.equal(await write(draft, account, true), true);
  assert.equal(await write(draft, account, false), false);
  const database = await new Promise<IDBDatabase>((resolve) => {
    const request = indexedDB.open("personal-archive-writing", 2);
    request.onsuccess = () => resolve(request.result);
  });
  const rows = await new Promise<unknown[]>((resolve) => {
    const request = database.transaction("account-manuscript-drafts-v2").objectStore("account-manuscript-drafts-v2").index("scope").getAll(JSON.stringify([account.instanceId, account.userId]));
    request.onsuccess = () => resolve(request.result);
  });
  database.close();
  assert.deepEqual(rows, []);
  assert.ok(await read("work", "chapter", account));
});
