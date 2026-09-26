import assert from "node:assert/strict";
import test from "node:test";
import { createDocumentResponse } from "../src/server/security/documentResponsePolicy.ts";

const encode = (value: string) => new TextEncoder().encode(value);

function stream(bytes: Uint8Array, chunkSize = bytes.length || 1): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.subarray(offset, offset += chunkSize));
    }
  });
}

async function preview(bytes: Uint8Array, fileName: string, chunkSize?: number) {
  return createDocumentResponse({ body: stream(bytes, chunkSize), fileName, disposition: "inline" });
}

test("HTML and SVG are attachment downloads even when named like safe viewer files", async () => {
  for (const payload of ["<!doctype html><script>alert(1)</script>", '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>']) {
    for (const fileName of ["upload.html", "image.svg", "disguised.pdf", "disguised.png", "opaque.bin"]) {
      const response = await preview(encode(payload), fileName, 1);
      assert.equal(response.headers.get("content-type"), "application/octet-stream");
      assert.match(response.headers.get("content-disposition")!, /^attachment;/);
      assert.match(response.headers.get("content-security-policy")!, /^sandbox;/);
      assert.equal(await response.text(), payload);
    }
  }
});

test("text previews remain text/plain even if their bytes contain active markup", async () => {
  const payload = '<html><script>fetch("/api/documents")</script></html>';
  for (const fileName of ["note.txt", "note.md", "data.xml", "table.csv"]) {
    const response = await preview(encode(payload), fileName);
    assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.match(response.headers.get("content-disposition")!, /^inline;/);
    assert.match(response.headers.get("content-security-policy")!, /^sandbox;/);
    assert.equal(await response.text(), payload);
  }
});

test("PDF and common image signatures choose their own MIME, preserving every byte", async () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0]);
  const cases: [Uint8Array, string][] = [
    [encode("%PDF-1.7\n% Synthetic test bytes\n"), "application/pdf"],
    [png, "image/png"],
    [Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), "image/jpeg"],
    [encode("GIF89a\0\0\0\0\0\0"), "image/gif"],
    [encode("RIFF\0\0\0\0WEBPVP8 "), "image/webp"],
    [encode("\0\0\0\x18ftypavif\0\0\0\0avif"), "image/avif"]
  ];
  for (const [bytes, mime] of cases) {
    for (const chunkSize of [1, 3, 4096]) {
      const response = await preview(bytes, "unknown.bin", chunkSize);
      assert.equal(response.headers.get("content-type"), mime);
      assert.match(response.headers.get("content-disposition")!, /^inline;/);
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
    }
  }
});

test("an active filename never gains inline privilege from a binary-looking prefix", async () => {
  const bytes = encode("%PDF-1.7\n<html><script>alert(1)</script></html>");
  for (const name of ["polyglot.HTML", "polyglot.svg", "polyglot.xhtml"]) {
    const response = await preview(bytes, name);
    assert.equal(response.headers.get("content-type"), "application/octet-stream");
    assert.match(response.headers.get("content-disposition")!, /^attachment;/);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  }
});

test("supported media signatures remain media while malformed containers download", async () => {
  const cases: [Uint8Array, string][] = [
    [encode("RIFF\0\0\0\0WAVEfmt "), "audio/wav"],
    [encode("fLaC\0\0\0\0"), "audio/flac"],
    [encode("OggS\0\0\0\0"), "application/ogg"],
    [encode("\0\0\0\x18ftypisom\0\0\0\0isom"), "video/mp4"],
    [Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]), "video/webm"]
  ];
  for (const [bytes, mime] of cases) {
    const response = await preview(bytes, "media.bin", 1);
    assert.equal(response.headers.get("content-type"), mime);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  }
  const unknown = await preview(encode("\0\0\0\x18ftypevil\0\0\0\0"), "media.mp4");
  assert.match(unknown.headers.get("content-disposition")!, /^attachment;/);
});

test("download always preserves original bytes with defensive headers and safe Unicode filenames", async () => {
  const bytes = encode("%PDF-1.7\noriginal\0payload");
  const response = await createDocumentResponse({
    body: stream(bytes), fileName: '家庭 "资料"\r\nInjected: yes\ud800.pdf', disposition: "attachment"
  });
  assert.equal(response.headers.get("content-type"), "application/octet-stream");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cache-control"), "no-store, private");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.match(response.headers.get("content-security-policy")!, /script-src 'none'/);
  assert.match(response.headers.get("content-disposition")!, /^attachment; filename="[^"\r\n]*"; filename\*=UTF-8''/);
  assert.match(response.headers.get("content-disposition")!, /%E5%AE%B6%E5%BA%AD/);
  assert.equal(response.headers.get("Injected"), null);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});

test("empty and unrecognized binary files safely download", async () => {
  for (const bytes of [new Uint8Array(), encode("%PDF-not-a-version"), Uint8Array.from([0, 1, 2, 3])]) {
    const response = await preview(bytes, "fake.pdf");
    assert.equal(response.headers.get("content-type"), "application/octet-stream");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  }
});

test("signature inspection does not consume a complete large file and cancellation reaches storage", async () => {
  let pulls = 0;
  let cancelled: unknown;
  const chunk = new Uint8Array(128 * 1024);
  chunk.set(encode("%PDF-1.7\n"));
  const source = new ReadableStream<Uint8Array>({
    pull(controller) { pulls += 1; controller.enqueue(chunk); },
    cancel(reason) { cancelled = reason; }
  }, { highWaterMark: 0 });
  const response = await createDocumentResponse({ body: source, fileName: "large.pdf", disposition: "inline" });
  assert.equal(pulls, 1);
  await response.body!.cancel("viewer closed");
  assert.equal(cancelled, "viewer closed");
});

test("stream read errors are propagated rather than returned as a successful truncated object", async () => {
  const failure = new Error("synthetic storage read failure");
  const failing = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(failure); } });
  await assert.rejects(createDocumentResponse({ body: failing, fileName: "document.pdf", disposition: "inline" }), failure);
});

test("storage failure after the inspected prefix still errors the response body", async () => {
  const failure = new Error("synthetic storage failure after headers");
  let sentPrefix = false;
  const source = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sentPrefix) return controller.error(failure);
      sentPrefix = true;
      controller.enqueue(encode("%PDF-1.7\n".padEnd(64, " ")));
    }
  }, { highWaterMark: 0 });
  const response = await createDocumentResponse({ body: source, fileName: "document.pdf", disposition: "inline" });
  await assert.rejects(response.arrayBuffer(), failure);
});
