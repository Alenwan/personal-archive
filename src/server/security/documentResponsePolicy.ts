/**
 * Raw uploads are untrusted, including their extension and stored Content-Type.
 * Recognize only binary formats with browser viewers; every other preview is
 * plain text or a download. This is format routing, not malware validation.
 */
export interface DocumentResponseInput {
  body: ReadableStream<Uint8Array>;
  fileName: string;
  disposition: "inline" | "attachment";
}

const SIGNATURE_BYTES = 64;
const TEXT_EXTENSIONS = new Set(["csv", "json", "log", "md", "markdown", "text", "tsv", "txt", "xml"]);
const ACTIVE_EXTENSIONS = new Set(["html", "htm", "xhtml", "xht", "svg", "svgz", "mhtml", "mht"]);

function matches(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes: Uint8Array, value: string, offset = 0): boolean {
  return matches(bytes, Array.from(value, (character) => character.charCodeAt(0)), offset);
}

function binaryContentType(bytes: Uint8Array): string | null {
  if (ascii(bytes, "%PDF-") && bytes.length >= 8 && /^\d\.\d$/.test(new TextDecoder().decode(bytes.subarray(5, 8)))) {
    return "application/pdf";
  }
  if (matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) && ascii(bytes, "IHDR", 12)) return "image/png";
  if (matches(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(bytes, "GIF87a") || ascii(bytes, "GIF89a")) return "image/gif";
  if (ascii(bytes, "RIFF") && ascii(bytes, "WEBP", 8)) return "image/webp";
  if (ascii(bytes, "BM") && bytes.length >= 26) return "image/bmp";
  if (matches(bytes, [0, 0, 1, 0]) && bytes.length >= 6) return "image/x-icon";
  if (matches(bytes, [0, 0, 2, 0]) && bytes.length >= 6) return "image/x-icon";
  if (matches(bytes, [0x49, 0x49, 0x2a, 0]) || matches(bytes, [0x4d, 0x4d, 0, 0x2a])) return "image/tiff";
  if (matches(bytes, [0, 0, 0, 12, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a])) return "image/jp2";
  if (matches(bytes, [0xff, 0x0a]) || matches(bytes, [0, 0, 0, 12, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a])) {
    return "image/jxl";
  }
  // ISO BMFF files share a container signature. Inspect the major brand rather
  // than guessing image/video from the uploader's MIME or filename.
  if (ascii(bytes, "ftyp", 4) && bytes.length >= 16) {
    const brand = new TextDecoder().decode(bytes.subarray(8, 12));
    if (["avif", "avis"].includes(brand)) return "image/avif";
    if (["heic", "heix", "hevc", "hevx"].includes(brand)) return "image/heic";
    if (["mif1", "msf1"].includes(brand)) return "image/heif";
    if (["M4A ", "M4B "].includes(brand)) return "audio/mp4";
    if (["isom", "iso2", "mp41", "mp42", "avc1", "M4V "].includes(brand)) return "video/mp4";
    if (brand === "qt  ") return "video/quicktime";
  }
  if (ascii(bytes, "RIFF") && ascii(bytes, "WAVE", 8)) return "audio/wav";
  if (ascii(bytes, "fLaC")) return "audio/flac";
  if (ascii(bytes, "OggS")) return "application/ogg";
  if (matches(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    for (let offset = 4; offset + 7 <= bytes.length; offset += 1) {
      if (matches(bytes, [0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d], offset)) return "video/webm";
    }
  }
  if (ascii(bytes, "ID3")) return "audio/mpeg";
  if (bytes.length >= 3 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0
    && (bytes[1] & 0x06) !== 0 && (bytes[2] & 0xf0) !== 0xf0) return "audio/mpeg";
  return null;
}

function dispositionHeader(disposition: "inline" | "attachment", fileName: string): string {
  // TextEncoder replaces lone surrogates so arbitrary stored names cannot make
  // encodeURIComponent throw. Header controls and quoted-string escapes are not
  // allowed to escape the filename parameter.
  const cleaned = new TextDecoder().decode(new TextEncoder().encode(fileName))
    .replace(/[\x00-\x1f\x7f]/g, "").trim() || "file";
  const fallback = cleaned.replace(/[^\x20-\x7e]/g, "_").replace(/[\\"]/g, "_");
  const encoded = encodeURIComponent(cleaned).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

async function inspectAndReplay(body: ReadableStream<Uint8Array>): Promise<{
  prefix: Uint8Array;
  body: ReadableStream<Uint8Array>;
}> {
  const reader = body.getReader();
  const buffered: Uint8Array[] = [];
  const prefix = new Uint8Array(SIGNATURE_BYTES);
  let prefixLength = 0;
  let ended = false;
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      reader.releaseLock();
    }
  };
  try {
    while (prefixLength < SIGNATURE_BYTES) {
      const result = await reader.read();
      if (result.done) {
        ended = true;
        release();
        break;
      }
      buffered.push(result.value);
      const part = result.value.subarray(0, SIGNATURE_BYTES - prefixLength);
      prefix.set(part, prefixLength);
      prefixLength += part.length;
    }
  } catch (error) {
    release();
    throw error;
  }

  let bufferedIndex = 0;
  return {
    prefix: prefix.subarray(0, prefixLength),
    body: new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (bufferedIndex < buffered.length) {
          controller.enqueue(buffered[bufferedIndex++]);
          return;
        }
        if (ended) {
          controller.close();
          return;
        }
        try {
          const result = await reader.read();
          if (result.done) {
            ended = true;
            release();
            controller.close();
          } else {
            controller.enqueue(result.value);
          }
        } catch (error) {
          release();
          controller.error(error);
        }
      },
      async cancel(reason) {
        if (!ended && !released) {
          try {
            await reader.cancel(reason);
          } finally {
            release();
          }
        }
      }
    })
  };
}

export async function createDocumentResponse(input: DocumentResponseInput): Promise<Response> {
  const extension = input.fileName.toLowerCase().split(".").pop() ?? "";
  const inspected = await inspectAndReplay(input.body);
  // Active extensions always download, including a binary/HTML polyglot. A
  // text extension never changes the response into HTML/XML/JavaScript.
  const binaryType = ACTIVE_EXTENSIONS.has(extension) ? null : binaryContentType(inspected.prefix);
  const textPreview = !ACTIVE_EXTENSIONS.has(extension) && !binaryType && TEXT_EXTENSIONS.has(extension);
  const inline = input.disposition === "inline" && Boolean(binaryType || textPreview);
  const contentType = inline ? binaryType ?? "text/plain; charset=utf-8" : "application/octet-stream";
  const headers = new Headers({
    "content-type": contentType,
    "content-disposition": dispositionHeader(inline ? "inline" : "attachment", input.fileName),
    "x-content-type-options": "nosniff",
    "cache-control": "no-store, private",
    "referrer-policy": "no-referrer",
    "cross-origin-resource-policy": "same-origin",
    "x-frame-options": "SAMEORIGIN"
  });
  // Sandboxing raw text/downloads is defense in depth against a browser treating
  // them as a document. Omit sandbox for native binary viewers because it can
  // disable built-in PDF plugins. Signatures do not validate embedded PDF actions
  // or codecs; actual browser viewer behavior needs separate regression checks.
  headers.set("content-security-policy", `${inline && binaryType ? "" : "sandbox; "}default-src 'none'; script-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`);
  return new Response(inspected.body, { headers });
}
