import { gcm } from "@noble/ciphers/aes.js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type {
  PrivateVault,
  PrivateVaultFolder,
  PrivateVaultFolderMetadata,
  PrivateVaultItem,
  PrivateVaultItemMetadata,
  PrivateVaultPasswordMetadata
} from "./types";

export const PRIVATE_VAULT_ENCRYPTION_VERSION = 1;
export const PRIVATE_VAULT_ENCRYPTION_KDF = "PBKDF2-SHA-256";
export const PRIVATE_VAULT_ENCRYPTION_ITERATIONS = 600_000;
export const PRIVATE_VAULT_BLOB_CONTENT_TYPE = "application/x-personal-archive-vault";

const PASSWORD_KEY_PREFIX = "pavk1";
const FILE_KEY_PREFIX = "pavf1";
const METADATA_PREFIX = "pavm1";
const FOLDER_METADATA_PREFIX = "pavd1";
const BLOB_MAGIC = new TextEncoder().encode("PAVB1");
const BLOB_HEADER_BYTES = 30;
const BLOB_CHUNK_BYTES = 4 * 1024 * 1024;
const GCM_TAG_BYTES = 16;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type PrivateVaultKey = Uint8Array<ArrayBuffer>;

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("This browser cannot generate secure random encryption keys.");
  }
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("The encrypted data is malformed.");
  }
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
  return output;
}

function passwordAad(version: number): Uint8Array<ArrayBuffer> {
  return encoder.encode(`personal-archive:private-vault-key:password:v${version}`);
}

function fileKeyAad(vaultId: string, itemId: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`personal-archive:private-vault:file-key:${vaultId}:${itemId}:v1`);
}

function metadataAad(vaultId: string, itemId: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`personal-archive:private-vault:metadata:${vaultId}:${itemId}:v1`);
}

function folderMetadataAad(vaultId: string, folderId: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`personal-archive:private-vault:folder:${vaultId}:${folderId}:v1`);
}

function blobChunkAad(vaultId: string, itemId: string, index: number, plaintextSize: number): Uint8Array<ArrayBuffer> {
  return encoder.encode(`personal-archive:private-vault:blob:${vaultId}:${itemId}:${index}:${plaintextSize}:v1`);
}

async function derivePasswordKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number
): Promise<Uint8Array<ArrayBuffer>> {
  return pbkdf2Async(sha256, encoder.encode(password), salt, {
    c: iterations,
    dkLen: 32,
    asyncTick: 8
  });
}

function encryptEnvelope(prefix: string, value: Uint8Array, key: Uint8Array, aad: Uint8Array): string {
  const iv = randomBytes(12);
  const ciphertext = gcm(key, iv, aad).encrypt(value);
  return `${prefix}.${bytesToBase64Url(iv)}.${bytesToBase64Url(ciphertext)}`;
}

function decryptEnvelope(prefix: string, envelope: string, key: Uint8Array, aad: Uint8Array): PrivateVaultKey {
  const [actualPrefix, ivValue, ciphertextValue, extra] = envelope.split(".");
  if (actualPrefix !== prefix || !ivValue || !ciphertextValue || extra) {
    throw new Error("The encrypted data is malformed.");
  }
  try {
    return Uint8Array.from(gcm(key, base64UrlToBytes(ivValue), aad).decrypt(base64UrlToBytes(ciphertextValue)));
  } catch {
    throw new Error("The private vault password is incorrect or the encrypted data is damaged.");
  }
}

function requireVaultMetadata(vault: PrivateVault) {
  if (vault.encryptionVersion !== PRIVATE_VAULT_ENCRYPTION_VERSION
    || vault.encryptionKdf !== PRIVATE_VAULT_ENCRYPTION_KDF
    || vault.encryptionIterations !== PRIVATE_VAULT_ENCRYPTION_ITERATIONS
    || !vault.encryptionSalt
    || !vault.encryptedVaultKey) {
    throw new Error("This private vault has incomplete or unsupported encryption metadata.");
  }
  return vault;
}

export function exportPrivateVaultKey(vaultKey: PrivateVaultKey): string {
  if (vaultKey.byteLength !== 32) throw new Error("The private vault key is invalid.");
  return bytesToBase64Url(vaultKey);
}

export async function createPrivateVaultEncryption(password: string): Promise<{
  vaultKey: PrivateVaultKey;
  recoveryVaultKey: string;
  metadata: PrivateVaultPasswordMetadata;
}> {
  if (!password) throw new Error("Enter a private vault password.");
  const vaultKeyBytes = randomBytes(32);
  const vaultKey = Uint8Array.from(vaultKeyBytes);
  const salt = randomBytes(16);
  const passwordKey = await derivePasswordKey(password, salt, PRIVATE_VAULT_ENCRYPTION_ITERATIONS);
  try {
    return {
      vaultKey,
      recoveryVaultKey: exportPrivateVaultKey(vaultKeyBytes),
      metadata: {
        encryptionVersion: PRIVATE_VAULT_ENCRYPTION_VERSION,
        encryptionKdf: PRIVATE_VAULT_ENCRYPTION_KDF,
        encryptionIterations: PRIVATE_VAULT_ENCRYPTION_ITERATIONS,
        encryptionSalt: bytesToBase64Url(salt),
        encryptedVaultKey: encryptEnvelope(
          PASSWORD_KEY_PREFIX,
          vaultKeyBytes,
          passwordKey,
          passwordAad(PRIVATE_VAULT_ENCRYPTION_VERSION)
        )
      }
    };
  } finally {
    passwordKey.fill(0);
    vaultKeyBytes.fill(0);
  }
}

export async function unlockPrivateVault(vault: PrivateVault, password: string): Promise<PrivateVaultKey> {
  const metadata = requireVaultMetadata(vault);
  const salt = base64UrlToBytes(metadata.encryptionSalt);
  const passwordKey = await derivePasswordKey(password, salt, metadata.encryptionIterations);
  try {
    const key = decryptEnvelope(
      PASSWORD_KEY_PREFIX,
      metadata.encryptedVaultKey,
      passwordKey,
      passwordAad(metadata.encryptionVersion)
    );
    if (key.byteLength !== 32) throw new Error("The private vault key is invalid.");
    return key;
  } finally {
    passwordKey.fill(0);
  }
}

export async function createPrivateVaultPasswordMetadata(
  vaultKey: PrivateVaultKey,
  password: string
): Promise<PrivateVaultPasswordMetadata> {
  if (!password) throw new Error("Enter a private vault password.");
  if (vaultKey.byteLength !== 32) throw new Error("The private vault key is invalid.");
  const salt = randomBytes(16);
  const passwordKey = await derivePasswordKey(password, salt, PRIVATE_VAULT_ENCRYPTION_ITERATIONS);
  try {
    return {
      encryptionVersion: PRIVATE_VAULT_ENCRYPTION_VERSION,
      encryptionKdf: PRIVATE_VAULT_ENCRYPTION_KDF,
      encryptionIterations: PRIVATE_VAULT_ENCRYPTION_ITERATIONS,
      encryptionSalt: bytesToBase64Url(salt),
      encryptedVaultKey: encryptEnvelope(
        PASSWORD_KEY_PREFIX,
        vaultKey,
        passwordKey,
        passwordAad(PRIVATE_VAULT_ENCRYPTION_VERSION)
      )
    };
  } finally {
    passwordKey.fill(0);
  }
}

function wrapFileKey(vaultKey: PrivateVaultKey, vaultId: string, itemId: string, fileKey: PrivateVaultKey): string {
  return encryptEnvelope(FILE_KEY_PREFIX, fileKey, vaultKey, fileKeyAad(vaultId, itemId));
}

function unwrapFileKey(vaultKey: PrivateVaultKey, item: PrivateVaultItem): PrivateVaultKey {
  const key = decryptEnvelope(FILE_KEY_PREFIX, item.wrappedFileKey, vaultKey, fileKeyAad(item.vaultId, item.itemId));
  if (key.byteLength !== 32) throw new Error("The private file key is invalid.");
  return key;
}

function encryptItemMetadata(
  fileKey: PrivateVaultKey,
  vaultId: string,
  itemId: string,
  metadata: PrivateVaultItemMetadata
): string {
  return encryptEnvelope(
    METADATA_PREFIX,
    encoder.encode(JSON.stringify(metadata)),
    fileKey,
    metadataAad(vaultId, itemId)
  );
}

function decryptItemMetadataWithKey(fileKey: PrivateVaultKey, item: PrivateVaultItem): PrivateVaultItemMetadata {
  const bytes = decryptEnvelope(
    METADATA_PREFIX,
    item.encryptedMetadata,
    fileKey,
    metadataAad(item.vaultId, item.itemId)
  );
  try {
    const parsed = JSON.parse(decoder.decode(bytes)) as Partial<PrivateVaultItemMetadata>;
    if (!parsed || typeof parsed.fileName !== "string" || typeof parsed.mimeType !== "string"
      || typeof parsed.size !== "number" || typeof parsed.folder !== "string" || typeof parsed.note !== "string") {
      throw new Error("The private file metadata is incomplete.");
    }
    if (parsed.folderId !== undefined && parsed.folderId !== null && typeof parsed.folderId !== "string") {
      throw new Error("The private file folder reference is invalid.");
    }
    if (parsed.favorite !== undefined && typeof parsed.favorite !== "boolean") {
      throw new Error("The private file favorite state is invalid.");
    }
    if (parsed.lastOpenedAt !== undefined && parsed.lastOpenedAt !== null && typeof parsed.lastOpenedAt !== "string") {
      throw new Error("The private file recent-use value is invalid.");
    }
    if (parsed.tags !== undefined && (!Array.isArray(parsed.tags)
      || parsed.tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.length > 80))) {
      throw new Error("The private file tags are invalid.");
    }
    return {
      ...parsed,
      folderId: parsed.folderId ?? null,
      favorite: parsed.favorite === true,
      lastOpenedAt: parsed.lastOpenedAt ?? null,
      tags: [...new Set((parsed.tags ?? []).map((tag) => tag.trim()))].slice(0, 30)
    } as PrivateVaultItemMetadata;
  } finally {
    bytes.fill(0);
  }
}

function chunkIv(prefix: Uint8Array<ArrayBuffer>, index: number): Uint8Array<ArrayBuffer> {
  const iv = new Uint8Array(12);
  iv.set(prefix, 0);
  new DataView(iv.buffer).setUint32(8, index, false);
  return iv;
}

function buildBlobHeader(plaintextSize: number, noncePrefix: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(BLOB_HEADER_BYTES);
  header.set(BLOB_MAGIC, 0);
  header[5] = PRIVATE_VAULT_ENCRYPTION_VERSION;
  const view = new DataView(header.buffer);
  view.setUint32(6, BLOB_CHUNK_BYTES, false);
  view.setBigUint64(10, BigInt(plaintextSize), false);
  header.set(noncePrefix, 18);
  return header;
}

function readBlobHeader(value: ArrayBuffer): {
  chunkSize: number;
  plaintextSize: number;
  noncePrefix: Uint8Array<ArrayBuffer>;
} {
  if (value.byteLength < BLOB_HEADER_BYTES) throw new Error("The private file is incomplete.");
  const header = new Uint8Array(value, 0, BLOB_HEADER_BYTES);
  if (BLOB_MAGIC.some((byte, index) => header[index] !== byte) || header[5] !== PRIVATE_VAULT_ENCRYPTION_VERSION) {
    throw new Error("This is not a supported private vault file.");
  }
  const view = new DataView(value, 0, BLOB_HEADER_BYTES);
  const chunkSize = view.getUint32(6, false);
  const plaintextSizeBig = view.getBigUint64(10, false);
  if (chunkSize <= 0 || chunkSize > 16 * 1024 * 1024 || plaintextSizeBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("The private file header is invalid.");
  }
  return {
    chunkSize,
    plaintextSize: Number(plaintextSizeBig),
    noncePrefix: Uint8Array.from(header.subarray(18, 26))
  };
}

export async function encryptPrivateVaultFile(
  vaultKey: PrivateVaultKey,
  vaultId: string,
  itemId: string,
  file: File,
  options: {
    folder?: string;
    folderId?: string | null;
    note?: string;
    onProgress?: (progress: number) => void;
  } = {}
): Promise<{ encryptedFile: File; encryptedMetadata: string; wrappedFileKey: string }> {
  if (vaultKey.byteLength !== 32) throw new Error("The private vault key is invalid.");
  const fileKey = randomBytes(32);
  const noncePrefix = randomBytes(8);
  const parts: BlobPart[] = [buildBlobHeader(file.size, noncePrefix)];
  const chunkCount = Math.max(1, Math.ceil(file.size / BLOB_CHUNK_BYTES));
  try {
    for (let index = 0; index < chunkCount; index += 1) {
      const start = index * BLOB_CHUNK_BYTES;
      const end = Math.min(file.size, start + BLOB_CHUNK_BYTES);
      const plaintext = new Uint8Array(await file.slice(start, end).arrayBuffer());
      try {
        parts.push(gcm(
          fileKey,
          chunkIv(noncePrefix, index),
          blobChunkAad(vaultId, itemId, index, file.size)
        ).encrypt(plaintext));
      } finally {
        plaintext.fill(0);
      }
      options.onProgress?.((index + 1) / chunkCount);
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    }
    const metadata: PrivateVaultItemMetadata = {
      fileName: file.name || "private-file",
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      folder: options.folder?.trim() ?? "",
      folderId: options.folderId ?? null,
      favorite: false,
      lastOpenedAt: null,
      tags: [],
      note: options.note?.trim() ?? ""
    };
    return {
      encryptedFile: new File(parts, `${itemId}.pav`, { type: PRIVATE_VAULT_BLOB_CONTENT_TYPE }),
      encryptedMetadata: encryptItemMetadata(fileKey, vaultId, itemId, metadata),
      wrappedFileKey: wrapFileKey(vaultKey, vaultId, itemId, fileKey)
    };
  } finally {
    fileKey.fill(0);
    noncePrefix.fill(0);
  }
}

export function decryptPrivateVaultItemMetadata(
  vaultKey: PrivateVaultKey,
  item: PrivateVaultItem
): PrivateVaultItemMetadata {
  const fileKey = unwrapFileKey(vaultKey, item);
  try {
    return decryptItemMetadataWithKey(fileKey, item);
  } finally {
    fileKey.fill(0);
  }
}

export function updatePrivateVaultItemMetadata(
  vaultKey: PrivateVaultKey,
  item: PrivateVaultItem,
  metadata: PrivateVaultItemMetadata
): string {
  const fileKey = unwrapFileKey(vaultKey, item);
  try {
    return encryptItemMetadata(fileKey, item.vaultId, item.itemId, metadata);
  } finally {
    fileKey.fill(0);
  }
}

export function encryptPrivateVaultFolderMetadata(
  vaultKey: PrivateVaultKey,
  vaultId: string,
  folderId: string,
  metadata: PrivateVaultFolderMetadata
): string {
  if (vaultKey.byteLength !== 32) throw new Error("The private vault key is invalid.");
  const name = metadata.name.trim();
  if (!name) throw new Error("Folder name is required.");
  return encryptEnvelope(
    FOLDER_METADATA_PREFIX,
    encoder.encode(JSON.stringify({ ...metadata, name })),
    vaultKey,
    folderMetadataAad(vaultId, folderId)
  );
}

export function decryptPrivateVaultFolderMetadata(
  vaultKey: PrivateVaultKey,
  folder: PrivateVaultFolder
): PrivateVaultFolderMetadata {
  if (vaultKey.byteLength !== 32) throw new Error("The private vault key is invalid.");
  const bytes = decryptEnvelope(
    FOLDER_METADATA_PREFIX,
    folder.encryptedMetadata,
    vaultKey,
    folderMetadataAad(folder.vaultId, folder.folderId)
  );
  try {
    const parsed = JSON.parse(decoder.decode(bytes)) as Partial<PrivateVaultFolderMetadata>;
    if (!parsed || typeof parsed.name !== "string" || !parsed.name.trim()
      || (parsed.parentFolderId !== null && typeof parsed.parentFolderId !== "string")
      || typeof parsed.favorite !== "boolean") {
      throw new Error("The private folder metadata is incomplete.");
    }
    return { name: parsed.name.trim(), parentFolderId: parsed.parentFolderId, favorite: parsed.favorite };
  } finally {
    bytes.fill(0);
  }
}

export function decryptPrivateVaultBlob(
  vaultKey: PrivateVaultKey,
  item: PrivateVaultItem,
  encrypted: ArrayBuffer,
  metadata: PrivateVaultItemMetadata
): Blob {
  const fileKey = unwrapFileKey(vaultKey, item);
  const { chunkSize, plaintextSize, noncePrefix } = readBlobHeader(encrypted);
  if (plaintextSize !== metadata.size) {
    fileKey.fill(0);
    noncePrefix.fill(0);
    throw new Error("The private file size does not match its encrypted metadata.");
  }
  const chunkCount = Math.max(1, Math.ceil(plaintextSize / chunkSize));
  const parts: BlobPart[] = [];
  let offset = BLOB_HEADER_BYTES;
  try {
    for (let index = 0; index < chunkCount; index += 1) {
      const plaintextLength = index === chunkCount - 1 ? plaintextSize - index * chunkSize : chunkSize;
      const ciphertextLength = plaintextLength + GCM_TAG_BYTES;
      if (offset + ciphertextLength > encrypted.byteLength) throw new Error("The private file is incomplete.");
      const ciphertext = new Uint8Array(encrypted, offset, ciphertextLength);
      const plaintext = gcm(
        fileKey,
        chunkIv(noncePrefix, index),
        blobChunkAad(item.vaultId, item.itemId, index, plaintextSize)
      ).decrypt(ciphertext);
      parts.push(plaintext);
      offset += ciphertextLength;
    }
    if (offset !== encrypted.byteLength) throw new Error("The private file contains unexpected trailing data.");
    return new Blob(parts, { type: metadata.mimeType || "application/octet-stream" });
  } catch {
    for (const part of parts) {
      if (part instanceof Uint8Array) part.fill(0);
    }
    throw new Error("The private file could not be decrypted. It may be damaged or belong to another item.");
  } finally {
    fileKey.fill(0);
    noncePrefix.fill(0);
  }
}

export function isPrivateVaultBlob(value: ArrayBuffer): boolean {
  if (value.byteLength < BLOB_HEADER_BYTES) return false;
  const header = new Uint8Array(value, 0, BLOB_MAGIC.length);
  return BLOB_MAGIC.every((byte, index) => header[index] === byte);
}
