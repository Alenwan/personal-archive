import assert from "node:assert/strict";
import test from "node:test";
import { installLocalStorage } from "./helpers/browserStorage";
import { readManuscriptLocalDraft as read, writeManuscriptLocalDraft as write, deleteManuscriptLocalDraft as remove } from "../src/shared/manuscriptLocalDraft";
const storage = installLocalStorage();
const a = { instanceId: "https://archive.example.invalid", userId: "synthetic-fallback-a" };
const b = { ...a, userId: "synthetic-fallback-b" };
const draft = { manuscriptId: "fallback-work", chapterId: "chapter", title: "Synthetic", body: "Synthetic uncommitted paragraph", contentFormat: "markdown" as const, baseUpdatedAt: "baseline", savedAt: "2026-09-06T12:00:00Z" };

test("blocked IndexedDB uses only scoped fallback and leaves unassigned legacy copies untouched", async () => {
  const legacyKey = "personal-archive.manuscript-draft.fallback-work:chapter";
  storage.setItem(legacyKey, JSON.stringify({ ...draft, body: "Unassigned legacy text" }));
  assert.equal(await read(draft.manuscriptId, draft.chapterId, a), null);
  assert.equal(await write(draft, a), false);
  assert.equal(storage.length, 1);
  assert.equal(await write(draft, a, true), true);
  assert.equal(storage.length, 2);
  assert.equal(await read(draft.manuscriptId, draft.chapterId, b), null);
  await remove(draft.manuscriptId, draft.chapterId, b);
  assert.equal((await read(draft.manuscriptId, draft.chapterId, a))?.body, draft.body);
  await write(draft, a, false);
  assert.equal(storage.length, 1);
  assert.ok(storage.getItem(legacyKey));
  assert.equal((await read(draft.manuscriptId, draft.chapterId, a))?.body, draft.body);
});

test("encrypted copies can persist without consenting to plaintext storage", async () => {
  const protectedDraft = { ...draft, manuscriptId: "protected", body: "Synthetic ciphertext placeholder", encrypted: true };
  assert.equal(await write(protectedDraft, a), true);
  assert.equal((await read("protected", "chapter", a))?.encrypted, true);
  assert.equal(await read("protected", "chapter", b), null);
});

test("blocked device deletion reports uncertainty while retaining the tab copy", async () => {
  const removeItem = storage.removeItem;
  await write(draft, a, true);
  storage.removeItem = () => { throw new Error("Synthetic browser policy denial"); };
  try {
    await assert.rejects(write(draft, a, false), /Unable to confirm removal/);
    assert.equal((await read(draft.manuscriptId, draft.chapterId, a))?.body, draft.body);
  } finally { storage.removeItem = removeItem; }
});
