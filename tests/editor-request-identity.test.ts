import assert from "node:assert/strict";
import test from "node:test";
import { client } from "../src/api/client";
import { setRequestUserId } from "../src/shared/sessionIdentity";

test("editor saves and uploads retain their original account guard after the active account changes", async () => {
  const original = globalThis.fetch;
  const requests: RequestInit[] = [];
  globalThis.fetch = async (_url, init) => { requests.push(init!); return Response.json({}); };
  try {
    setRequestUserId("synthetic-new-account");
    await client.updateManuscriptChapter("synthetic-work", "synthetic-chapter", { body: "Unsaved original-account draft", expectedRevision: 1 }, "synthetic-editor-account");
    const form = new FormData();
    form.append("file", new Blob(["synthetic image"]), "synthetic.txt");
    await client.uploadArchiveDocument(form, "synthetic-editor-account");
    assert.equal(new Headers(requests[0].headers).get("x-archive-user-id"), "synthetic-editor-account");
    assert.equal(new Headers(requests[0].headers).get("content-type"), "application/json");
    assert.equal(new Headers(requests[1].headers).get("x-archive-user-id"), "synthetic-editor-account");
    assert.equal(new Headers(requests[1].headers).get("content-type"), null, "browser must create the multipart boundary");
  } finally { globalThis.fetch = original; setRequestUserId(null); }
});
