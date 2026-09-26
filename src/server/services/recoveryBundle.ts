import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DocumentStorage } from "../storage/documentStorage";

type Namespace = "documents" | "backups";
type Stores = Record<Namespace, DocumentStorage>;
interface Entry { file: string; sha256: string; bytes: number; key?: string; namespace?: Namespace; contentType?: string }
interface Manifest { format: "personal-archive-offline-recovery-v1"; entries: Entry[]; generatedAt: string }
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function requireKey(key: Uint8Array) { if (key.byteLength !== 32) throw new Error("An independently retained 32-byte recovery bundle key is required."); }
function seal(bytes: Uint8Array, key: Uint8Array, name: string): Buffer {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(name));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}
function open(bytes: Buffer, key: Uint8Array, name: string): Buffer {
  if (bytes.length < 28) throw new Error("Truncated recovery entry.");
  const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  cipher.setAAD(Buffer.from(name));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]);
}
async function inventory(storage: DocumentStorage) {
  if (!storage.list) throw new Error("Storage cannot enumerate a complete recovery inventory.");
  const items = await storage.list();
  if (new Set(items.map((item) => item.key)).size !== items.length) throw new Error("Duplicate object keys in recovery inventory.");
  return items.sort((a, b) => a.key.localeCompare(b.key, "en"));
}

/** Caller must stop ALL source writers/workers for the entire operation. This
 * offline primitive intentionally does not claim that an online UI backup is
 * consistent. assertQuiescent must verify that caller-owned maintenance state. */
export async function createRecoveryBundle(options: {
  directory: string; bundleKey: Uint8Array; stores: Stores; configuration: Record<string, string>;
  assertQuiescent: () => Promise<void>; dumpDatabase: () => Promise<Uint8Array>;
}): Promise<void> {
  requireKey(options.bundleKey);
  await options.assertQuiescent();
  // Exclusive directory creation prevents overwriting the last good bundle.
  await mkdir(options.directory, { mode: 0o700 });
  const entries: Entry[] = [];
  const put = async (file: string, bytes: Uint8Array, metadata: Partial<Entry> = {}) => {
    const encrypted = seal(bytes, options.bundleKey, file);
    await writeFile(join(options.directory, file), encrypted, { flag: "wx", mode: 0o600 });
    entries.push({ ...metadata, file, sha256: digest(encrypted), bytes: encrypted.length });
  };
  await put("database.bin", await options.dumpDatabase());
  await put("configuration.bin", Buffer.from(JSON.stringify(options.configuration)));
  for (const namespace of ["documents", "backups"] as const) {
    const storage = options.stores[namespace];
    const before = await inventory(storage);
    for (const item of before) {
      await options.assertQuiescent();
      const object = await storage.get(item.key);
      if (!object) throw new Error("An object is missing from the recovery inventory.");
      const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
      if (bytes.length !== item.size) throw new Error("An object changed during offline recovery collection.");
      await put(`${namespace}-${digest(Buffer.from(item.key))}.bin`, bytes, { key: item.key, namespace, contentType: object.contentType });
    }
    if (JSON.stringify(before) !== JSON.stringify(await inventory(storage))) throw new Error("Object inventory changed during offline recovery collection.");
  }
  await options.assertQuiescent();
  const manifest: Manifest = { format: "personal-archive-offline-recovery-v1", entries, generatedAt: new Date().toISOString() };
  const payload = JSON.stringify(manifest);
  const signature = createHmac("sha256", options.bundleKey).update(payload).digest("hex");
  await writeFile(join(options.directory, "manifest.pending"), JSON.stringify({ payload, signature }), { flag: "wx", mode: 0o600 });
  await rename(join(options.directory, "manifest.pending"), join(options.directory, "manifest.json"));
}

export async function verifyRecoveryBundle(directory: string, bundleKey: Uint8Array): Promise<{ manifest: Manifest; files: Map<string, Buffer>; configuration: Record<string, string> }> {
  requireKey(bundleKey);
  if (!(await lstat(directory)).isDirectory() || (await lstat(directory)).isSymbolicLink()) throw new Error("Recovery directory must not be a symlink.");
  if (!(await lstat(join(directory, "manifest.json"))).isFile()) throw new Error("Recovery manifest is not a regular file.");
  const envelope = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  if (typeof envelope?.payload !== "string" || typeof envelope.signature !== "string" || !/^[a-f0-9]{64}$/.test(envelope.signature)) throw new Error("Invalid recovery manifest envelope.");
  const expected = createHmac("sha256", bundleKey).update(envelope.payload).digest();
  const actual = Buffer.from(envelope.signature, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Recovery manifest authentication failed.");
  const manifest = JSON.parse(envelope.payload) as Manifest;
  if (manifest.format !== "personal-archive-offline-recovery-v1" || !Array.isArray(manifest.entries)) throw new Error("Unsupported recovery format.");
  const files = new Map<string, Buffer>();
  const objects = new Set<string>();
  for (const entry of manifest.entries) {
    if (!entry || typeof entry.file !== "string" || !/^(database|configuration|(?:documents|backups)-[a-f0-9]{64})\.bin$/.test(entry.file) || files.has(entry.file)) throw new Error("Invalid recovery entry path.");
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 28 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error("Invalid recovery entry integrity data.");
    if (!["database.bin", "configuration.bin"].includes(entry.file)) {
      if (!entry.namespace || !["documents", "backups"].includes(entry.namespace) || typeof entry.key !== "string" || !entry.key || entry.file !== `${entry.namespace}-${digest(Buffer.from(entry.key))}.bin` || objects.has(JSON.stringify([entry.namespace, entry.key]))) throw new Error("Invalid recovery object mapping.");
      if (entry.contentType !== undefined && typeof entry.contentType !== "string") throw new Error("Invalid recovery content type.");
      objects.add(JSON.stringify([entry.namespace, entry.key]));
    } else if (entry.namespace !== undefined || entry.key !== undefined) throw new Error("Invalid recovery special entry mapping.");
    const path = join(directory, entry.file), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== entry.bytes) throw new Error("Missing or invalid recovery entry.");
    const bytes = await readFile(path);
    if (digest(bytes) !== entry.sha256) throw new Error("Recovery entry checksum failed.");
    files.set(entry.file, open(bytes, bundleKey, entry.file));
  }
  if (!files.has("database.bin") || !files.has("configuration.bin")) throw new Error("Recovery bundle is incomplete.");
  const configuration = JSON.parse(files.get("configuration.bin")!.toString("utf8"));
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration) || Object.values(configuration).some((value) => typeof value !== "string")) throw new Error("Invalid recovery configuration.");
  return { manifest, files, configuration };
}

export async function restoreRecoveryBundle(options: {
  directory: string; bundleKey: Uint8Array; stores: Stores;
  assertEmptyDatabase: () => Promise<void>; restoreDatabase: (dump: Uint8Array) => Promise<void>;
  invalidateSessions: () => Promise<void>;
}): Promise<Record<string, string>> {
  // Authenticate every entry and decrypt it before any destination mutation.
  const verified = await verifyRecoveryBundle(options.directory, options.bundleKey);
  await options.assertEmptyDatabase();
  for (const namespace of ["documents", "backups"] as const) {
    if ((await inventory(options.stores[namespace])).length) throw new Error("Recovery destination object storage is not empty.");
  }
  for (const entry of verified.manifest.entries) {
    if (!entry.namespace || !entry.key) continue;
    const bytes = verified.files.get(entry.file)!;
    await options.stores[entry.namespace].put(entry.key, Uint8Array.from(bytes).buffer, entry.contentType || "application/octet-stream");
    const restored = await options.stores[entry.namespace].get(entry.key);
    if (!restored || digest(new Uint8Array(await new Response(restored.body).arrayBuffer())) !== digest(bytes)) throw new Error("Restored object verification failed.");
  }
  await options.restoreDatabase(verified.files.get("database.bin")!);
  await options.invalidateSessions();
  return verified.configuration;
}
