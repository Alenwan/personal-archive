import type { AppEnv } from "../env";
import { ephemeralMode } from "../runtimeConfig";

export interface StoredObject {
  body: ReadableStream;
  contentType?: string;
  contentLength?: number;
  contentRange?: string;
  status?: 200 | 206;
}

export class StorageRangeNotSatisfiableError extends Error {
  constructor(readonly size?: number) {
    super("Requested storage range is not satisfiable");
    this.name = "StorageRangeNotSatisfiableError";
  }
}

export interface StorageUsage {
  bytes: number;
  objectCount: number;
}

export interface DocumentStorage {
  list?(): Promise<Array<{ key: string; size: number }>>;
  put(key: string, value: ArrayBuffer, contentType: string, signal?: AbortSignal): Promise<void>;
  get(key: string, rangeOrSignal?: string | AbortSignal): Promise<StoredObject | null>;
  delete(key: string, signal?: AbortSignal): Promise<void>;
  usage(): Promise<StorageUsage>;
}

class R2DocumentStorage implements DocumentStorage {
  constructor(private readonly bucket: R2Bucket) {}

  async put(key: string, value: ArrayBuffer, contentType: string): Promise<void> {
    await this.bucket.put(key, value, { httpMetadata: { contentType } });
  }

  async get(key: string, rangeOrSignal?: string | AbortSignal): Promise<StoredObject | null> {
    const rangeHeader = typeof rangeOrSignal === "string" ? rangeOrSignal : undefined;
    const object = await this.bucket.get(key, rangeHeader ? { range: new Headers({ range: rangeHeader }) } : undefined);
    if (!object) {
      if (rangeHeader) {
        const metadata = await this.bucket.head(key);
        if (metadata) throw new StorageRangeNotSatisfiableError(metadata.size);
      }
      return null;
    }
    const range = object.range;
    let offset = 0;
    let length = object.size;
    if (range) {
      if ("suffix" in range) {
        length = Math.min(range.suffix, object.size);
        offset = object.size - length;
      } else {
        offset = range.offset ?? 0;
        length = range.length ?? Math.max(0, object.size - offset);
      }
    }
    return {
      body: object.body,
      contentType: object.httpMetadata?.contentType,
      contentLength: length,
      contentRange: range ? `bytes ${offset}-${offset + length - 1}/${object.size}` : undefined,
      status: range ? 206 : 200
    };
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }

  async usage(): Promise<StorageUsage> {
    let bytes = 0;
    let objectCount = 0;
    let cursor: string | undefined;
    do {
      const page = await this.bucket.list({ cursor });
      bytes += page.objects.reduce((total, object) => total + object.size, 0);
      objectCount += page.objects.length;
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return { bytes, objectCount };
  }

  async list(): Promise<Array<{ key: string; size: number }>> {
    const objects: Array<{ key: string; size: number }> = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await this.bucket.list({ cursor });
      objects.push(...page.objects.map(({ key, size }) => ({ key, size })));
      if (page.truncated && (!page.cursor || cursors.has(page.cursor))) throw new Error("Object inventory pagination is incomplete.");
      cursor = page.truncated ? page.cursor : undefined;
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return objects;
  }
}

type S3Method = "GET" | "PUT" | "DELETE";

interface S3StorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  forcePathStyle: boolean;
}

const encoder = new TextEncoder();
const emptyPayloadHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string | ArrayBuffer): Promise<string> {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  return bytesToHex(await crypto.subtle.digest("SHA-256", bytes));
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, value: string): Promise<ArrayBuffer> {
  const rawKey =
    key instanceof Uint8Array ? (key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer) : key;
  const cryptoKey = await crypto.subtle.importKey("raw", rawKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));
}

function amzDateParts(date = new Date()): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function encodeS3PathPart(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeS3Key(key: string): string {
  return key.split("/").map(encodeS3PathPart).join("/");
}

function canonicalQuery(url: URL): string {
  return [...url.searchParams.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey)
    )
    .map(([key, value]) => `${encodeS3PathPart(key)}=${encodeS3PathPart(value)}`)
    .join("&");
}

function decodeXmlText(value: string): string {
  const named: Record<string, string> = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };
  return value.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (_match, entity: string) => {
    if (entity[0] !== "#") return named[entity.toLowerCase()];
    const code = entity[1].toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (code > 0x10ffff || code < 1 || (code >= 0xd800 && code <= 0xdfff)) throw new Error("Object inventory XML character is invalid.");
    return String.fromCodePoint(code);
  });
}

function xmlValues(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "g"))].map((match) => decodeXmlText(match[1] ?? ""));
}

class S3DocumentStorage implements DocumentStorage {
  private readonly endpoint: URL;

  constructor(private readonly config: S3StorageConfig) {
    this.endpoint = new URL(config.endpoint);
  }

  async put(key: string, value: ArrayBuffer, contentType: string, signal?: AbortSignal): Promise<void> {
    const response = await this.request("PUT", key, value, contentType, signal);
    if (!response.ok) throw new Error(`S3 put failed for ${key}: ${response.status} ${await response.text()}`);
  }

  async get(key: string, rangeOrSignal?: string | AbortSignal): Promise<StoredObject | null> {
    const rangeHeader = typeof rangeOrSignal === "string" ? rangeOrSignal : undefined;
    const signal = typeof rangeOrSignal === "string" ? undefined : rangeOrSignal;
    const response = await this.request("GET", key, undefined, undefined, signal, rangeHeader);
    if (response.status === 404) return null;
    if (response.status === 416) {
      const size = Number.parseInt(response.headers.get("content-range")?.match(/\*\/(\d+)$/)?.[1] ?? "", 10);
      throw new StorageRangeNotSatisfiableError(Number.isFinite(size) ? size : undefined);
    }
    if (!response.ok) throw new Error(`S3 get failed for ${key}: ${response.status} ${await response.text()}`);
    if (!response.body) return null;
    const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
    return {
      body: response.body,
      contentType: response.headers.get("content-type") ?? undefined,
      contentLength: Number.isFinite(contentLength) ? contentLength : undefined,
      contentRange: response.headers.get("content-range") ?? undefined,
      status: response.status === 206 ? 206 : 200
    };
  }

  async delete(key: string, signal?: AbortSignal): Promise<void> {
    const response = await this.request("DELETE", key, undefined, undefined, signal);
    if (!response.ok && response.status !== 404) {
      throw new Error(`S3 delete failed for ${key}: ${response.status} ${await response.text()}`);
    }
  }

  async usage(): Promise<StorageUsage> {
    let bytes = 0;
    let objectCount = 0;
    let continuationToken = "";
    do {
      const url = this.bucketUrl();
      url.searchParams.set("list-type", "2");
      if (continuationToken) url.searchParams.set("continuation-token", continuationToken);
      const response = await this.signedRequest("GET", url);
      if (!response.ok) throw new Error(`S3 usage query failed: ${response.status}`);
      const xml = await response.text();
      bytes += xmlValues(xml, "Size").reduce((total, value) => total + (Number(value) || 0), 0);
      objectCount += xmlValues(xml, "Key").length;
      continuationToken = xmlValues(xml, "NextContinuationToken")[0] ?? "";
    } while (continuationToken);
    return { bytes, objectCount };
  }

  async list(): Promise<Array<{ key: string; size: number }>> {
    const objects: Array<{ key: string; size: number }> = [];
    const cursors = new Set<string>();
    let cursor = "";
    do {
      const url = this.bucketUrl();
      url.searchParams.set("list-type", "2");
      if (cursor) url.searchParams.set("continuation-token", cursor);
      const response = await this.signedRequest("GET", url);
      if (!response.ok) throw new Error("Object inventory request failed.");
      const xml = await response.text();
      if (!/<ListBucketResult(?:\s[^>]*)?>/.test(xml)) throw new Error("Object inventory is malformed.");
      // Decode only leaf values: decoding Contents first corrupts keys that
      // contain literal XML entities or angle brackets.
      for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const item = match[1];
        const key = xmlValues(item, "Key")[0];
        const size = Number(xmlValues(item, "Size")[0]);
        if (!key || !Number.isSafeInteger(size) || size < 0) throw new Error("Object inventory is malformed.");
        objects.push({ key, size });
      }
      const next = xmlValues(xml, "NextContinuationToken")[0] || "";
      const truncated = xmlValues(xml, "IsTruncated")[0];
      if (!["true", "false"].includes(truncated) || (truncated === "true" && (!next || cursors.has(next)))) throw new Error("Object inventory pagination is incomplete.");
      cursor = truncated === "true" ? next : "";
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return objects;
  }

  private bucketUrl(): URL {
    const endpointPath = this.endpoint.pathname.replace(/\/$/, "");
    if (this.config.forcePathStyle) {
      return new URL(`${endpointPath}/${encodeS3PathPart(this.config.bucketName)}`, this.endpoint);
    }
    const url = new URL(endpointPath || "/", this.endpoint);
    url.hostname = `${this.config.bucketName}.${url.hostname}`;
    return url;
  }

  private objectUrl(key: string): URL {
    const encodedKey = encodeS3Key(key);
    const url = this.bucketUrl();
    url.pathname = `${url.pathname.replace(/\/$/, "")}/${encodedKey}`;
    return url;
  }

  private async request(method: S3Method, key: string, body?: ArrayBuffer, contentType?: string, signal?: AbortSignal, rangeHeader?: string): Promise<Response> {
    const url = this.objectUrl(key);
    return this.signedRequest(method, url, body, contentType, signal, rangeHeader);
  }

  private async signedRequest(method: S3Method, url: URL, body?: ArrayBuffer, contentType?: string, signal?: AbortSignal, rangeHeader?: string): Promise<Response> {
    const { amzDate, dateStamp } = amzDateParts();
    const payloadHash = body ? await sha256Hex(body) : emptyPayloadHash;
    const headers = new Headers({
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate
    });
    if (contentType) headers.set("content-type", contentType);
    if (rangeHeader) headers.set("range", rangeHeader);

    const signedHeaders = [...headers.keys()].sort().join(";");
    const canonicalHeaders = [...headers.keys()]
      .sort()
      .map((header) => `${header}:${headers.get(header)?.trim() ?? ""}\n`)
      .join("");
    const canonicalRequest = [
      method,
      url.pathname,
      canonicalQuery(url),
      canonicalHeaders,
      signedHeaders,
      payloadHash
    ].join("\n");
    const credentialScope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, await sha256Hex(canonicalRequest)].join("\n");
    const dateKey = await hmacSha256(encoder.encode(`AWS4${this.config.secretAccessKey}`), dateStamp);
    const dateRegionKey = await hmacSha256(dateKey, this.config.region);
    const dateRegionServiceKey = await hmacSha256(dateRegionKey, "s3");
    const signingKey = await hmacSha256(dateRegionServiceKey, "aws4_request");
    const signature = bytesToHex(await hmacSha256(signingKey, stringToSign));

    headers.set(
      "authorization",
      `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    );

    return fetch(url, { method, headers, body: body ? new Uint8Array(body) : undefined, signal });
  }
}

function parseByteRange(rangeHeader: string, total: number): { offset: number; length: number } | null {
  const match = rangeHeader.trim().match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || (!match[1] && !match[2]) || total <= 0) return null;
  if (!match[1]) {
    const suffixLength = Number.parseInt(match[2] ?? "", 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    const length = Math.min(suffixLength, total);
    return { offset: total - length, length };
  }
  const offset = Number.parseInt(match[1], 10);
  const requestedEnd = match[2] ? Number.parseInt(match[2], 10) : total - 1;
  if (!Number.isFinite(offset) || !Number.isFinite(requestedEnd) || offset < 0 || offset >= total || requestedEnd < offset) {
    return null;
  }
  const end = Math.min(requestedEnd, total - 1);
  return { offset, length: end - offset + 1 };
}

class MemoryDocumentStorage implements DocumentStorage {
  private objects = new Map<string, { value: ArrayBuffer; contentType: string }>();
  async list() { return [...this.objects].map(([key, object]) => ({ key, size: object.value.byteLength })); }

  async put(key: string, value: ArrayBuffer, contentType: string): Promise<void> {
    this.objects.set(key, { value, contentType });
  }

  async get(key: string, rangeOrSignal?: string | AbortSignal): Promise<StoredObject | null> {
    const rangeHeader = typeof rangeOrSignal === "string" ? rangeOrSignal : undefined;
    const object = this.objects.get(key);
    if (!object) return null;
    const total = object.value.byteLength;
    const range = rangeHeader ? parseByteRange(rangeHeader, total) : null;
    if (rangeHeader && !range) throw new StorageRangeNotSatisfiableError(total);
    const offset = range?.offset ?? 0;
    const length = range?.length ?? total;
    const value = object.value.slice(offset, offset + length);
    return {
      body: new Blob([value], { type: object.contentType }).stream(),
      contentType: object.contentType,
      contentLength: length,
      contentRange: range ? `bytes ${offset}-${offset + length - 1}/${total}` : undefined,
      status: range ? 206 : 200
    };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async usage(): Promise<StorageUsage> {
    let bytes = 0;
    for (const object of this.objects.values()) bytes += object.value.byteLength;
    return { bytes, objectCount: this.objects.size };
  }
}

let memoryStorage: MemoryDocumentStorage | null = null;

function createS3Storage(env: AppEnv, bucketName?: string): DocumentStorage | null {
  if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY || !bucketName) return null;
  return new S3DocumentStorage({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION || "us-east-1",
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    bucketName,
    forcePathStyle: env.S3_FORCE_PATH_STYLE !== "false"
  });
}

export function createDocumentStorage(env: AppEnv): DocumentStorage {
  if (env.DOCUMENT_BUCKET) return new R2DocumentStorage(env.DOCUMENT_BUCKET);
  const s3Storage = createS3Storage(env, env.DOCUMENT_BUCKET_NAME);
  if (s3Storage) return s3Storage;
  if (!ephemeralMode(env)) throw new Error("Document storage configuration is required; refusing in-memory fallback.");
  if (!memoryStorage) memoryStorage = new MemoryDocumentStorage();
  return memoryStorage;
}

export function createBackupStorage(env: AppEnv): DocumentStorage {
  if (env.BACKUP_BUCKET) return new R2DocumentStorage(env.BACKUP_BUCKET);
  const s3Storage = createS3Storage(env, env.BACKUP_BUCKET_NAME || env.DOCUMENT_BUCKET_NAME);
  if (s3Storage) return s3Storage;
  return createDocumentStorage(env);
}
