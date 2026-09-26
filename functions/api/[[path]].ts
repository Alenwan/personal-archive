import { Hono } from "hono";
import { bookmarkInputSchema, BookmarkConflictError } from "../../src/shared/manuscriptBookmarks";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  DEFAULT_DEMO_MAX_FILES_PER_CASE,
  DEFAULT_MAX_UPLOAD_MB
} from "../../src/shared/demoLimits";
import { contactDisplayName, safeFileName } from "../../src/shared/format";
import { resolveDiscussionTitle } from "../../src/shared/discussionTitle";
import {
  ASSET_DOCUMENT_RELATIONSHIPS,
  ASSET_STATUSES,
  ASSET_TYPES,
  BACKUP_DESTINATIONS,
  BACKUP_SCOPES,
  BACKUP_SCHEDULES,
  CASE_STATUSES,
  CONTACT_ROLES,
  COMMUNICATION_DIRECTIONS,
  COMMUNICATION_SOURCES,
  COMMUNICATION_STATUSES,
  COMMUNICATION_TYPES,
  DOCUMENT_CATEGORIES,
  DOCUMENT_REVIEW_STATUSES,
  KNOWLEDGE_STATUSES,
  KNOWLEDGE_TYPES,
  MANUSCRIPT_CHAPTER_FORMATS,
  MANUSCRIPT_CHAPTER_SAVE_SOURCES,
  MANUSCRIPT_CHAPTER_VERSION_RETENTION,
  MANUSCRIPT_KINDS,
  MANUSCRIPT_STATUSES,
  MY_WORK_SOURCES,
  MY_WORK_STATES,
  PARTY_ORGANIZATION_TYPES,
  CREDENTIAL_TYPES,
  SERVICE_DISCUSSION_MESSAGE_TYPES,
  SERVICE_DISCUSSION_THREAD_STATUSES,
  SERVICE_DISCUSSION_VISIBILITIES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TAX_ID_TYPES
} from "../../src/shared/types";
import type {
  BackupRun,
  BackupSettings,
  BulkActionResult,
  CaseReadiness,
  CaseRecord,
  CaseWorkspacePayload,
  DatabaseTableExportResult,
  DocumentCategory,
  DocumentRecord,
  ManuscriptBodyEncryptionEnableInput,
  ManuscriptBodyEncryptionInput,
  ManuscriptChapter,
  PrivateVault,
  PrivateVaultFolder,
  PrivateVaultItem,
  PublicUser,
  ServiceDiscussionFilters,
  ServiceDiscussionMessage
} from "../../src/shared/types";
import {
  expectedDemoPassword,
  isPublicMutationMethod,
  requirePublicDemoMutationAccess,
  withDemoAccess
} from "../../src/server/auth/demoAccess";
import { buildCapabilities } from "../../src/server/auth/capabilities";
import { hashPassword, validateNewPassword, verifyPassword } from "../../src/server/auth/password";
import { can, requirePermission } from "../../src/server/auth/permissions";
import { cleanupStoredDocuments } from "../../src/server/services/storageCleanup";
import { requireManuscriptKeyOwner } from "../../src/server/auth/manuscriptPermissions";
import { createDocumentResponse } from "../../src/server/security/documentResponsePolicy";
import {
  clearSessionCookie,
  createSessionCookie,
  createSessionExpiry,
  createSessionToken,
  hashSessionToken,
  isSecureRequest,
  readSessionUser,
  readSessionToken,
  revokeRequestSession
} from "../../src/server/auth/session";
import type { AppEnv } from "../../src/server/env";
import { createRepository } from "../../src/server/repositories/factory";
import { withArchiveManagementAccess } from "../../src/server/auth/archiveManagement";
import { ManuscriptChapterConflictError, ManuscriptEncryptionConflictError, PrivateVaultItemAccessError } from "../../src/server/repositories/types";
import type {
  AppRepository,
  BackupSnapshot,
  CreateBackupItemInput,
  CreateContactInput,
  StoredPrivateVault,
  StoredPrivateVaultFolder,
  StoredPrivateVaultItem
} from "../../src/server/repositories/types";
import { buildCaseReadiness } from "../../src/server/services/caseReadiness";
import { buildCaseTimeline } from "../../src/server/services/caseTimeline";
import { createChecklistTasksForCase } from "../../src/server/services/caseWorkflow";
import { decryptCredentialText, encryptCredentialText } from "../../src/server/services/credentialCrypto";
import { buildMyWorkQueue } from "../../src/server/services/myWorkQueue";
import { buildManuscriptExport } from "../../src/server/services/manuscriptExport";
import { isEncryptedManuscriptBody } from "../../src/shared/manuscriptEncryption";
import {
  createRecoveredManuscriptPasswordMetadata,
  unwrapManuscriptRecoveryKey,
  wrapManuscriptRecoveryKey
} from "../../src/server/services/manuscriptRecoveryCrypto";
import {
  isPrivateVaultBlob,
  PRIVATE_VAULT_BLOB_CONTENT_TYPE,
  PRIVATE_VAULT_ENCRYPTION_ITERATIONS,
  PRIVATE_VAULT_ENCRYPTION_KDF
} from "../../src/shared/privateVaultEncryption";
import {
  createRecoveredPrivateVaultPasswordMetadata,
  unwrapPrivateVaultRecoveryKey,
  wrapPrivateVaultRecoveryKey
} from "../../src/server/services/privateVaultRecoveryCrypto";
import { registerCommunicationRoutes } from "./routes/communications";
import { registerGmailExtensionPublicRoutes, registerGmailExtensionTokenRoutes } from "./routes/gmailExtension";
import { registerPbxRoutes } from "./routes/pbx";
import {
  buildDatabaseRecoveryStatus,
  createDatabaseSnapshot,
  isNeonSnapshotLimitExceeded,
  listDatabaseSnapshots,
  NEON_SNAPSHOT_LIMIT_MESSAGE
} from "../../src/server/services/databaseRecovery";
import {
  createBackupStorage,
  createDocumentStorage,
  StorageRangeNotSatisfiableError,
  type StoredObject
} from "../../src/server/storage/documentStorage";

type Variables = {
  repo: AppRepository;
  user: PublicUser;
};

function userResponse(user: PublicUser, env: AppEnv): PublicUser {
  const publicUser = withDemoAccess(user, env);
  return { ...publicUser, capabilities: buildCapabilities(publicUser) };
}

function privateVaultResponse(vault: StoredPrivateVault): PrivateVault {
  const { recoveryEncryptedVaultKey: _recoveryEncryptedVaultKey, ...response } = vault;
  return response;
}

function privateVaultFolderResponse(folder: StoredPrivateVaultFolder): PrivateVaultFolder {
  return folder;
}

function privateVaultItemResponse(item: StoredPrivateVaultItem): PrivateVaultItem {
  const { objectKey: _objectKey, ...response } = item;
  return response;
}

export const app = new Hono<{ Bindings: AppEnv; Variables: Variables }>().basePath("/api");

function isPartyOrganizationNameConflict(error: unknown): boolean {
  const maybeError = error as { code?: unknown; constraint_name?: unknown };
  return (
    maybeError.code === "23505" &&
    (maybeError.constraint_name === "party_organizations_active_name_idx" ||
      maybeError.constraint_name === "party_organizations_active_tenant_name_idx")
  );
}

const contactRoleSchema = z.enum(CONTACT_ROLES);
const communicationTypeSchema = z.enum(COMMUNICATION_TYPES);
const communicationDirectionSchema = z.enum(COMMUNICATION_DIRECTIONS);
const communicationSourceSchema = z.enum(COMMUNICATION_SOURCES);
const communicationStatusSchema = z.enum(COMMUNICATION_STATUSES);
const assetTypeSchema = z.union([z.enum(ASSET_TYPES), z.string().trim().min(1)]);
const assetStatusSchema = z.union([z.enum(ASSET_STATUSES), z.string().trim().min(1)]);
const credentialTypeSchema = z.union([z.enum(CREDENTIAL_TYPES), z.string().trim().min(1)]);
const documentCategorySchema = z.enum(DOCUMENT_CATEGORIES);
const archiveCategoryNameSchema = z.string().trim().min(1).max(80);
const documentReviewStatusSchema = z.enum(DOCUMENT_REVIEW_STATUSES);
const knowledgeTypeSchema = z.enum(KNOWLEDGE_TYPES);
const knowledgeStatusSchema = z.enum(KNOWLEDGE_STATUSES);
const manuscriptKindSchema = z.enum(MANUSCRIPT_KINDS);
const manuscriptStatusSchema = z.enum(MANUSCRIPT_STATUSES);
const taskStatusSchema = z.enum(TASK_STATUSES);
const taskPrioritySchema = z.enum(TASK_PRIORITIES);
const backupDestinationSchema = z.enum(BACKUP_DESTINATIONS);
const backupScheduleSchema = z.enum(BACKUP_SCHEDULES);
const backupScopeSchema = z.enum(BACKUP_SCOPES);
const partyOrganizationTypeSchema = z.enum(PARTY_ORGANIZATION_TYPES);
const taxIdTypeSchema = z.union([z.literal(""), z.enum(TAX_ID_TYPES)]);
const optionalUuidSchema = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().uuid().nullable().optional()
);
const optionalDateSchema = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
);

const assetRelationshipFilter = (value: string | undefined) => (value === "linked" || value === "unlinked" ? value : "");
const assetCredentialFilter = (value: string | undefined) => (value === "has" || value === "none" ? value : "");
const assetIdentifierFilter = (value: string | undefined) =>
  value === "missing-network" || value === "missing-hardware" || value === "missing-phone" ? value : "";
const caseStatusSchema = z.enum(CASE_STATUSES);
const assetSortFilter = (value: string | undefined) =>
  value === "name" ||
  value === "type" ||
  value === "organization" ||
  value === "service" ||
  value === "installedAt" ||
  value === "lastServiceAt"
    ? value
    : "updated";
const knowledgeSortFilter = (value: string | undefined) =>
  value === "title" || value === "type" || value === "status" || value === "component" || value === "verified"
    ? value
    : "updated";
const sortDirectionFilter = (value: string | undefined) => (value === "asc" || value === "desc" ? value : "desc");
const TEXTUAL_RESPONSE_CONTENT_TYPES = new Set([
  "application/csv",
  "application/ecmascript",
  "application/javascript",
  "application/json",
  "application/manifest+json",
  "application/rss+xml",
  "application/x-javascript",
  "application/xhtml+xml",
  "application/xml"
]);

const BROWSER_CONTENT_TYPES_BY_EXTENSION: Record<string, string> = {
  aac: "audio/aac",
  apng: "image/apng",
  avif: "image/avif",
  bmp: "image/bmp",
  cur: "image/x-icon",
  dib: "image/bmp",
  flac: "audio/flac",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  ico: "image/x-icon",
  j2c: "image/jp2",
  j2k: "image/jp2",
  jfif: "image/jpeg",
  jpe: "image/jpeg",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  jp2: "image/jp2",
  jpx: "image/jp2",
  jxl: "image/jxl",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  opus: "audio/ogg; codecs=opus",
  pjp: "image/jpeg",
  pjpeg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  wav: "audio/wav",
  wave: "audio/wav",
  weba: "audio/webm",
  webp: "image/webp",
  pdf: "application/pdf",
  csv: "text/csv",
  json: "application/json",
  md: "text/markdown",
  txt: "text/plain"
};

function contentTypeFromFileName(fileName: string, fallback = "application/octet-stream"): string {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  return BROWSER_CONTENT_TYPES_BY_EXTENSION[extension] ?? fallback;
}

function uploadContentType(file: File): string {
  const supplied = file.type.trim().toLowerCase();
  if (supplied && supplied !== "application/octet-stream") return supplied;
  return contentTypeFromFileName(file.name, supplied || "application/octet-stream");
}

function isInlineImageFile(mimeType: string, fileName: string): boolean {
  return mimeType.toLowerCase().startsWith("image/") ||
    /\.(?:apng|avif|bmp|cur|dib|gif|heic|heif|ico|j2[ck]|jpe?g|jfif|jp2|jpx|jxl|pjp|pjpeg|png|svg|tiff?|webp)$/i.test(fileName);
}

function contentDisposition(disposition: "attachment" | "inline", fileName: string): string {
  const cleaned = fileName.replace(/[\r\n]/g, "").trim() || "file";
  const asciiFallback = cleaned.replace(/[^\x20-\x7E]/g, "_").replace(/[\\"]/g, "_") || "file";
  const encoded = encodeURIComponent(cleaned).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

function contentTypeForBrowser(contentType: string | undefined, fallback = "application/octet-stream"): string {
  const rawContentType = contentType?.trim();
  const rawFallback = fallback.trim();
  const preferredContentType =
    rawContentType && rawContentType.split(";")[0].trim().toLowerCase() !== "application/octet-stream"
      ? rawContentType
      : rawFallback || rawContentType || "application/octet-stream";
  if (/\bcharset\s*=/i.test(preferredContentType)) return preferredContentType;
  const mediaType = preferredContentType.split(";")[0].trim().toLowerCase();
  if (
    mediaType.startsWith("text/") ||
    mediaType.endsWith("+json") ||
    mediaType.endsWith("+xml") ||
    TEXTUAL_RESPONSE_CONTENT_TYPES.has(mediaType)
  ) {
    return `${preferredContentType}; charset=utf-8`;
  }
  return preferredContentType;
}

function validSingleByteRange(rangeHeader: string | undefined): string | undefined {
  const value = rangeHeader?.trim();
  if (!value) return undefined;
  return /^bytes=(?:\d+-\d*|-\d+)$/i.test(value) ? value : undefined;
}

async function secureDocumentObjectResponse(
  storage: ReturnType<typeof createDocumentStorage>, key: string, object: StoredObject, rangeHeader: string | undefined,
  fileName: string, disposition: "attachment" | "inline"
): Promise<Response> {
  // A range starting mid-file cannot be identified from its own bytes. Verify
  // the first bytes separately and retain the response policy's safe headers.
  const headerSource = rangeHeader && !/^bytes=0-/i.test(rangeHeader)
    ? await storage.get(key, "bytes=0-63") : object;
  if (!headerSource) throw new Error("Stored object disappeared during range verification.");
  const safe = await createDocumentResponse({ body: headerSource.body, fileName, disposition });
  if (!rangeHeader) return safe;
  const headers = new Headers(safe.headers);
  headers.set("accept-ranges", "bytes");
  if (object.contentLength !== undefined) headers.set("content-length", String(object.contentLength));
  if (object.contentRange) headers.set("content-range", object.contentRange);
  if (headerSource !== object) await safe.body?.cancel();
  return new Response(headerSource === object ? safe.body : object.body, { status: object.status ?? 206, headers });
}

function rangeNotSatisfiableResponse(error: StorageRangeNotSatisfiableError): Response {
  const headers = new Headers({ "accept-ranges": "bytes", "cache-control": "private, no-store" });
  if (error.size !== undefined) headers.set("content-range", `bytes */${error.size}`);
  return new Response(null, { status: 416, headers });
}

const documentUpdateSchema = z.object({
  category: archiveCategoryNameSchema.optional(),
  folderId: optionalUuidSchema,
  notes: z.string().default("").optional(),
  reviewStatus: documentReviewStatusSchema.optional(),
  reviewNotes: z.string().default("").optional(),
  tagIds: z.array(z.string()).optional()
});
const knowledgeLinkSchema = z.object({
  entityType: z.enum(["service", "asset", "document", "credential", "discussion"]),
  entityId: z.string().uuid(),
  relationship: z.string().trim().optional().default("related")
});
const knowledgeInputSchema = z.object({
  title: z.string().trim().min(2),
  type: knowledgeTypeSchema,
  status: knowledgeStatusSchema.optional().default("Draft"),
  component: z.string().trim().default(""),
  summary: z.string().trim().default(""),
  body: z.string().trim().default(""),
  keywords: z.array(z.string().trim()).optional().default([]),
  credentialReference: z.string().trim().default(""),
  sourceServiceId: optionalUuidSchema,
  lastVerifiedAt: optionalDateSchema,
  links: z.array(knowledgeLinkSchema).optional().default([])
});
const knowledgeUpdateSchema = knowledgeInputSchema.partial();
const manuscriptInputSchema = z.object({
  title: z.string().trim().min(1).max(240),
  kind: manuscriptKindSchema.optional().default("Long document"),
  status: manuscriptStatusSchema.optional().default("Draft"),
  description: z.string().trim().max(5000).optional().default("")
});
const manuscriptUpdateSchema = manuscriptInputSchema.partial().refine((input) => Object.keys(input).length > 0, "No manuscript updates supplied.");
const manuscriptChapterInputSchema = z.object({
  chapterId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(240),
  body: z.string().max(12000000).optional().default(""),
  contentFormat: z.enum(MANUSCRIPT_CHAPTER_FORMATS).optional().default("rich-text"),
  sortOrder: z.number().int().min(0).optional(),
  characterCount: z.number().int().min(0).max(2000000).optional()
});
const manuscriptChapterUpdateSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  body: z.string().max(12000000).optional(),
  contentFormat: z.enum(MANUSCRIPT_CHAPTER_FORMATS).optional(),
  sortOrder: z.number().int().min(0).optional(),
  expectedRevision: z.number().int().positive().optional(),
  saveSource: z.enum(MANUSCRIPT_CHAPTER_SAVE_SOURCES).optional(),
  characterCount: z.number().int().min(0).max(2000000).optional()
}).refine(
  (input) => Object.keys(input).length > 0,
  "No chapter updates supplied."
);
const manuscriptChapterRestoreSchema = z.object({
  expectedRevision: z.number().int().positive()
});
const manuscriptEncryptionPasswordMetadataSchema = z.object({
  encryptionVersion: z.literal(1),
  encryptionKdf: z.literal("PBKDF2-SHA-256"),
  encryptionIterations: z.literal(600000),
  encryptionSalt: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  encryptedWorkKey: z.string().regex(/^pak1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{64}$/)
});
const manuscriptEncryptionMetadataSchema = manuscriptEncryptionPasswordMetadataSchema.extend({
  recoveryEncryptedWorkKey: z.string().regex(/^par1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{64}$/)
});
const manuscriptBodyEncryptionFields = {
  chapters: z.array(z.object({
    chapterId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    body: z.string().min(1).max(12000000)
  })).max(1000),
  versions: z.array(z.object({
    versionId: z.string().uuid(),
    chapterId: z.string().uuid(),
    body: z.string().min(1).max(12000000)
  })).max(200000)
};
const manuscriptBodyEncryptionSchema = z.object({
  ...manuscriptBodyEncryptionFields,
  metadata: manuscriptEncryptionMetadataSchema.optional()
});
const manuscriptBodyEncryptionEnableSchema = z.object({
  ...manuscriptBodyEncryptionFields,
  metadata: manuscriptEncryptionPasswordMetadataSchema,
  recoveryWorkKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/)
});
const manuscriptEncryptionPasswordResetSchema = z.object({
  currentAccountPassword: z.string().min(1).max(1000),
  newEncryptionPassword: z.string().min(1).max(1000)
});
const privateVaultPasswordMetadataSchema = z.object({
  encryptionVersion: z.literal(1),
  encryptionKdf: z.literal(PRIVATE_VAULT_ENCRYPTION_KDF),
  encryptionIterations: z.literal(PRIVATE_VAULT_ENCRYPTION_ITERATIONS),
  encryptionSalt: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  encryptedVaultKey: z.string().regex(/^pavk1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{64}$/)
});
const privateVaultCreateSchema = z.object({
  metadata: privateVaultPasswordMetadataSchema,
  recoveryVaultKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/)
});
const privateVaultPasswordResetSchema = z.object({
  currentAccountPassword: z.string().min(1).max(1000),
  newVaultPassword: z.string().min(1).max(1000)
});
const privateVaultAutoLockSchema = z.object({
  autoLockMinutes: z.union([z.literal(5), z.literal(10), z.literal(30)])
});
const privateVaultItemMetadataUpdateSchema = z.object({
  encryptedMetadata: z.string().min(24).max(32_000).regex(/^pavm1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/)
});
const privateVaultFolderInputSchema = z.object({
  folderId: z.string().uuid(),
  encryptionVersion: z.literal(1),
  encryptedMetadata: z.string().min(24).max(32_000).regex(/^pavd1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/)
});
const privateVaultFolderMetadataUpdateSchema = privateVaultFolderInputSchema.pick({ encryptedMetadata: true });
const privateVaultItemMetadataBatchSchema = z.object({
  updates: z.array(z.object({
    itemId: z.string().uuid(),
    encryptedMetadata: privateVaultItemMetadataUpdateSchema.shape.encryptedMetadata
  })).min(1).max(500)
});
const serviceDiscussionMessageTypeSchema = z.enum(SERVICE_DISCUSSION_MESSAGE_TYPES);
const serviceDiscussionVisibilitySchema = z.enum(SERVICE_DISCUSSION_VISIBILITIES);
const serviceDiscussionThreadStatusSchema = z.enum(SERVICE_DISCUSSION_THREAD_STATUSES);
const serviceDiscussionMessageSchema = z.object({
  title: z.string().trim().min(1).max(200).nullable().optional(),
  bodyText: z.string().trim().min(1).max(250000),
  caseId: optionalUuidSchema,
  parentMessageId: optionalUuidSchema,
  messageType: serviceDiscussionMessageTypeSchema.optional().default("message"),
  visibility: serviceDiscussionVisibilitySchema.optional().default("team"),
  threadStatus: serviceDiscussionThreadStatusSchema.optional(),
  threadOwnerUserId: optionalUuidSchema,
  isPinned: z.boolean().optional().default(false),
  mentionedUserIds: z.array(z.string().uuid()).optional().default([])
});
const serviceDiscussionMessageUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).nullable().optional(),
    bodyText: z.string().trim().min(1).max(250000).optional(),
    messageType: serviceDiscussionMessageTypeSchema.optional(),
    threadStatus: serviceDiscussionThreadStatusSchema.optional(),
    threadOwnerUserId: optionalUuidSchema,
    isPinned: z.boolean().optional(),
    mentionedUserIds: z.array(z.string().uuid()).optional()
  })
  .refine((input) => Object.keys(input).length > 0, "No discussion updates supplied.");
const discussionLinkServiceSchema = z.object({ caseId: z.string().uuid() });
const discussionContextSchema = z.object({
  caseId: z.string().uuid().nullable(),
  assetIds: z.array(z.string().uuid()).max(100).default([])
});
const discussionAssetLinkSchema = z.object({
  assetId: z.string().uuid(),
  relationship: z.string().trim().min(1).max(80).optional().default("related")
});
const discussionTaskSchema = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  description: z.string().trim().max(5000).optional(),
  priority: taskPrioritySchema.optional().default("Normal"),
  dueDate: z.string().optional(),
  assignedTo: optionalUuidSchema
});
const discussionAttachmentPromoteSchema = z.object({
  assetId: z.string().uuid(),
  relationship: z.union([z.enum(ASSET_DOCUMENT_RELATIONSHIPS), z.string().trim().min(1).max(80)]).optional().default("Runbook"),
  note: z.string().trim().max(1000).optional().default("Promoted from service discussion attachment."),
  isPinned: z.boolean().optional().default(true)
});
const discussionKnowledgeSchema = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  type: knowledgeTypeSchema.optional().default("Service lesson"),
  status: knowledgeStatusSchema.optional().default("Draft"),
  summary: z.string().trim().max(500).optional(),
  body: z.string().trim().max(12000).optional(),
  attachmentId: optionalUuidSchema,
  assetId: optionalUuidSchema
});
const discussionNoteSchema = z.object({
  body: z.string().trim().max(12000).optional(),
  attachmentId: optionalUuidSchema
});
const directoryViewScopeSchema = z.enum(["contacts", "organizations", "documents", "communications", "assets", "services", "discussions"]);
const savedDirectoryViewSchema = z.object({
  scope: directoryViewScopeSchema,
  name: z.string().trim().min(2),
  filters: z.record(z.string(), z.unknown()).optional().default({}),
  sort: z.string().trim().optional().default(""),
  pageSize: z.coerce.number().int().min(10).max(100).optional().default(25),
  isDefault: z.boolean().optional().default(false)
});
const contactBulkActionSchema = z.object({
  action: z.enum(["set-organization", "clear-organization", "delete"]),
  contactIds: z.array(z.string().uuid()).min(1).max(100),
  partyOrganizationId: optionalUuidSchema
});
const organizationBulkActionSchema = z.object({
  action: z.enum(["delete"]),
  partyOrganizationIds: z.array(z.string().uuid()).min(1).max(100)
});
const documentBulkActionSchema = z.object({
  action: z.enum(["set-category", "set-review-status", "move-folder", "delete"]),
  documentIds: z.array(z.string().uuid()).min(1).max(100),
  category: archiveCategoryNameSchema.optional(),
  folderId: optionalUuidSchema,
  reviewStatus: documentReviewStatusSchema.optional()
});
const archiveFolderInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentFolderId: optionalUuidSchema,
  sortOrder: z.coerce.number().int().min(0).max(1000000).optional()
});
const archiveFolderUpdateSchema = archiveFolderInputSchema.partial().refine(
  (input) => Object.keys(input).length > 0,
  "No folder updates supplied."
);
const archiveFolderMetadataUpdateSchema = z.object({
  includeSubfolders: z.boolean().optional().default(true),
  category: archiveCategoryNameSchema.optional(),
  reviewStatus: documentReviewStatusSchema.optional(),
  notes: z.string().max(12000).optional(),
  reviewNotes: z.string().max(12000).optional(),
  tagIds: z.array(z.string().uuid()).max(100).optional()
}).refine(
  (input) => ["category", "reviewStatus", "notes", "reviewNotes", "tagIds"].some((field) => Object.prototype.hasOwnProperty.call(input, field)),
  "Select at least one metadata field to update."
);
const archiveCategoryInputSchema = z.object({
  name: archiveCategoryNameSchema,
  sortOrder: z.coerce.number().int().min(0).max(1000000).optional()
});
const archiveCategoryUpdateSchema = archiveCategoryInputSchema.partial().refine(
  (input) => Object.keys(input).length > 0,
  "No category updates supplied."
);
const assetBulkActionSchema = z.object({
  action: z.enum(["set-status", "set-type"]),
  assetIds: z.array(z.string().uuid()).min(1).max(100),
  status: assetStatusSchema.optional(),
  assetType: assetTypeSchema.optional()
});
const caseBulkActionSchema = z.object({
  action: z.enum(["set-status", "add-tag", "remove-tag"]),
  caseIds: z.array(z.string().uuid()).min(1).max(100),
  status: caseStatusSchema.optional(),
  tagId: z.string().uuid().optional()
});
const communicationInputSchema = z.object({
  caseId: optionalUuidSchema,
  partyOrganizationId: optionalUuidSchema,
  contactId: optionalUuidSchema,
  assetId: optionalUuidSchema,
  supportingDocumentId: optionalUuidSchema,
  communicationType: communicationTypeSchema,
  direction: communicationDirectionSchema,
  source: communicationSourceSchema.optional().default("Manual"),
  status: communicationStatusSchema.optional(),
  followUpAssignedTo: optionalUuidSchema,
  followUpDueDate: optionalDateSchema,
  externalProvider: z.string().trim().default(""),
  externalReference: z.string().trim().default(""),
  externalUrl: z
    .string()
    .trim()
    .default("")
    .refine((value) => !value || /^https?:\/\//i.test(value), "External link must start with http:// or https://."),
  sourceMetadata: z.record(z.string(), z.unknown()).optional().default({}),
  subject: z.string().trim().min(2),
  body: z.string().trim().default(""),
  occurredAt: z.string().trim().min(10)
});
const tagInputSchema = z.object({
  name: z.string().min(2),
  color: z.string().min(4)
});

function enumQuery<T extends readonly string[]>(value: string | undefined, values: T): T[number] | undefined {
  return value && (values as readonly string[]).includes(value) ? (value as T[number]) : undefined;
}

const closeCaseSchema = z.object({
  force: z.boolean().default(false),
  reason: z.string().trim().default("")
});
const archiveCaseSchema = z.object({
  reason: z.string().trim().default("")
});
const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string(),
  confirmPassword: z.string()
});
const backupSettingsSchema = z.object({
  destination: backupDestinationSchema,
  schedule: backupScheduleSchema,
  scope: backupScopeSchema,
  includeMetadata: z.boolean(),
  includeDocuments: z.boolean(),
  includeAuditLogs: z.boolean(),
  includeRelationshipMap: z.boolean(),
  folderByCaseAndCategory: z.boolean(),
  checksumManifest: z.boolean(),
  isEnabled: z.boolean()
});
const backupRunRequestSchema = z
  .object({
    dryRun: z.boolean().optional().default(false),
    destination: backupDestinationSchema,
    scope: backupScopeSchema,
    includeMetadata: z.boolean(),
    includeDocuments: z.boolean(),
    includeAuditLogs: z.boolean(),
    includeRelationshipMap: z.boolean(),
    folderByCaseAndCategory: z.boolean(),
    checksumManifest: z.boolean()
  })
  .refine(
    (input) => input.includeMetadata || input.includeDocuments || input.includeAuditLogs || input.includeRelationshipMap,
    "Select at least one backup content type."
  );

const caseInputSchema = z.object({
  caseNumber: z.string().min(2).optional(),
  caseTypeCode: z.string().min(2).optional(),
  createChecklistTasks: z.boolean().optional().default(false),
  customerOrganizationId: optionalUuidSchema,
  propertyAddress: z.string().min(2),
  city: z.string().trim().default(""),
  state: z.string().trim().default(""),
  zipCode: z.string().trim().default(""),
  propertyType: z.string(),
  salePriceCents: z.coerce.number().int().nonnegative(),
  status: z.string(),
  closingDate: z.string(),
  notes: z.string().default(""),
  tagIds: z.array(z.string()).optional()
});

const optionalEmailSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : value),
  z.union([z.string().email(), z.literal("")]).default("")
);

const contactInputSchema = z.object({
  displayName: z.string().trim().optional(),
  firstName: z.string().trim().default(""),
  lastName: z.string().trim().default(""),
  partyOrganizationId: z.string().uuid().nullable().optional(),
  jobTitle: z.string().default(""),
  email: optionalEmailSchema,
  phone: z.string().default(""),
  address: z.string().default(""),
  notes: z.string().default("")
});

type ContactPayload = z.infer<typeof contactInputSchema>;

function normalizeContactInput(input: ContactPayload, requireName: true): CreateContactInput;
function normalizeContactInput(input: Partial<ContactPayload>, requireName: false): Partial<CreateContactInput>;
function normalizeContactInput(
  input: ContactPayload | Partial<ContactPayload>,
  requireName: boolean
): CreateContactInput | Partial<CreateContactInput> {
  const hasNameInput = input.displayName !== undefined || input.firstName !== undefined || input.lastName !== undefined;
  const displayName =
    input.displayName?.trim() || [input.firstName, input.lastName].filter(Boolean).join(" ").trim();
  if ((requireName || hasNameInput) && !displayName) {
    throw new HTTPException(400, { message: "Contact name is required" });
  }
  if (!displayName) return input;
  return {
    ...input,
    displayName,
    firstName: input.firstName?.trim() || displayName,
    lastName: input.lastName?.trim() ?? ""
  };
}

const partyOrganizationInputSchema = z.object({
  name: z.string().trim().min(2),
  type: partyOrganizationTypeSchema.default("Company"),
  taxIdType: taxIdTypeSchema.default(""),
  taxIdValue: z.string().trim().default(""),
  website: z.string().trim().default(""),
  email: z.string().trim().default(""),
  phone: z.string().trim().default(""),
  fax: z.string().trim().default(""),
  addressLine1: z.string().trim().default(""),
  addressLine2: z.string().trim().default(""),
  city: z.string().trim().default(""),
  state: z.string().trim().default(""),
  zipCode: z.string().trim().default(""),
  country: z.string().trim().default("United States"),
  notes: z.string().trim().default("")
});

const assetInputSchema = z.object({
  partyOrganizationId: optionalUuidSchema,
  caseId: optionalUuidSchema,
  parentAssetId: optionalUuidSchema,
  name: z.string().trim().min(1),
  assetType: assetTypeSchema.default("Other"),
  status: assetStatusSchema.default("Active"),
  manufacturer: z.string().trim().default(""),
  model: z.string().trim().default(""),
  serialNumber: z.string().trim().default(""),
  macAddress: z.string().trim().default(""),
  imei: z.string().trim().default(""),
  iccid: z.string().trim().default(""),
  phoneNumber: z.string().trim().default(""),
  extension: z.string().trim().default(""),
  hostname: z.string().trim().default(""),
  lanIp: z.string().trim().default(""),
  wanIp: z.string().trim().default(""),
  installedLocation: z.string().trim().default(""),
  installedAt: optionalDateSchema,
  lastServiceAt: optionalDateSchema,
  notes: z.string().trim().default("")
});

const assetUpdateSchema = z.object({
  partyOrganizationId: optionalUuidSchema,
  caseId: optionalUuidSchema,
  parentAssetId: optionalUuidSchema,
  name: z.string().trim().min(1).optional(),
  assetType: assetTypeSchema.optional(),
  status: assetStatusSchema.optional(),
  manufacturer: z.string().trim().optional(),
  model: z.string().trim().optional(),
  serialNumber: z.string().trim().optional(),
  macAddress: z.string().trim().optional(),
  imei: z.string().trim().optional(),
  iccid: z.string().trim().optional(),
  phoneNumber: z.string().trim().optional(),
  extension: z.string().trim().optional(),
  hostname: z.string().trim().optional(),
  lanIp: z.string().trim().optional(),
  wanIp: z.string().trim().optional(),
  installedLocation: z.string().trim().optional(),
  installedAt: optionalDateSchema,
  lastServiceAt: optionalDateSchema,
  notes: z.string().trim().optional()
});

const assetDocumentRelationshipSchema = z.union([
  z.enum(ASSET_DOCUMENT_RELATIONSHIPS),
  z.string().trim().min(1).max(80)
]);
const assetDocumentLinkSchema = z.object({
  documentId: z.string().uuid(),
  relationship: assetDocumentRelationshipSchema.optional().default("Other"),
  note: z.string().trim().max(1000).optional().default(""),
  isPinned: z.boolean().optional().default(false),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional().default(0)
});
const assetDocumentLinkUpdateSchema = z
  .object({
    relationship: assetDocumentRelationshipSchema.optional(),
    note: z.string().trim().max(1000).optional(),
    isPinned: z.boolean().optional(),
    sortOrder: z.coerce.number().int().min(0).max(10000).optional()
  })
  .refine((input) => Object.keys(input).length > 0, "No asset document updates supplied.");

const credentialInputSchema = z.object({
  label: z.string().trim().min(1),
  credentialType: credentialTypeSchema.default("Other"),
  username: z.string().trim().default(""),
  loginUrl: z.string().trim().default(""),
  host: z.string().trim().default(""),
  notes: z.string().trim().default(""),
  secret: z.string().default(""),
  privateNotes: z.string().default(""),
  lastVerifiedAt: optionalDateSchema,
  rotationDueAt: optionalDateSchema
});

const credentialUpdateSchema = z.object({
  label: z.string().trim().min(1).optional(),
  credentialType: credentialTypeSchema.optional(),
  username: z.string().trim().optional(),
  loginUrl: z.string().trim().optional(),
  host: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  secret: z.string().optional(),
  privateNotes: z.string().optional(),
  lastVerifiedAt: optionalDateSchema,
  rotationDueAt: optionalDateSchema
});

function requireCredentialRevealPermission(user: PublicUser): void {
  if (user.role !== "Admin" && user.role !== "Manager") {
    throw new HTTPException(403, { message: `Role ${user.role} cannot reveal credentials.` });
  }
}

function closeBlockers(readiness: CaseReadiness): string[] {
  return [
    ...readiness.missingDocumentCategories.map((category) => `Missing required document category: ${category}`),
    ...readiness.openTasks.map((task) => `Open task: ${task.title}`)
  ];
}

async function requireActiveCase(repo: AppRepository, caseId: string) {
  const record = await repo.getCase(caseId);
  if (!record) {
    throw new HTTPException(404, {
      message: "Case not found or archived. Restore the case before making changes."
    });
  }
  return record;
}

async function requireActiveDiscussionService(repo: AppRepository, message: ServiceDiscussionMessage) {
  if (!message.caseId) return null;
  return requireActiveCase(repo, message.caseId);
}

function canManageDiscussionMessage(user: PublicUser, message: ServiceDiscussionMessage): boolean {
  return message.createdBy === user.userId || can(user, "edit", "case");
}

function ensureDiscussionMessageMutationAllowed(user: PublicUser, message: ServiceDiscussionMessage): void {
  if (!canManageDiscussionMessage(user, message)) {
    throw new HTTPException(403, { message: "You can only edit or remove your own discussion messages." });
  }
}

function discussionKnowledgeTitle(message: ServiceDiscussionMessage): string {
  if (message.title?.trim()) return message.title.trim();
  const firstLine = message.bodyText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "Service discussion note";
  return firstLine.length > 90 ? `${firstLine.slice(0, 87)}...` : firstLine;
}

function discussionSourceLine(message: ServiceDiscussionMessage): string {
  const serviceLabel = message.caseNumber ? `${message.caseNumber}${message.caseTitle ? ` - ${message.caseTitle}` : ""}` : "Unlinked discussion";
  return `Source discussion: ${serviceLabel} · ${message.createdByName} · ${message.createdAt} · message ${message.messageId}`;
}

function discussionAttachmentLine(message: ServiceDiscussionMessage, attachmentId?: string | null): string {
  const attachment = attachmentId ? message.attachments.find((item) => item.attachmentId === attachmentId) : null;
  if (!attachment) return "";
  return `Source attachment: ${attachment.document.originalFileName} · document ${attachment.documentId}`;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function uploadLimitMb(env: AppEnv): number | null {
  const parsed = Number.parseInt(env.MAX_UPLOAD_MB ?? "", 10);
  const fallback = DEFAULT_MAX_UPLOAD_MB > 0 ? DEFAULT_MAX_UPLOAD_MB : null;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function fileSizeLimitError(file: File, env: AppEnv): { error: string } | null {
  const maxMb = uploadLimitMb(env);
  if (!maxMb) return null;
  return file.size > maxMb * 1024 * 1024 ? { error: `File exceeds ${maxMb} MB limit` } : null;
}

function isPersonalArchive(env: AppEnv): boolean {
  return env.BUSINESS_TEMPLATE === "personal-archive";
}

function requirePersonalArchive(env: AppEnv): void {
  if (!isPersonalArchive(env)) throw new HTTPException(404, { message: "Not found" });
}

async function validatedDocumentCategory(repo: AppRepository, env: AppEnv, value: unknown): Promise<DocumentCategory> {
  if (!isPersonalArchive(env)) return documentCategorySchema.parse(value);
  const requested = archiveCategoryNameSchema.parse(value);
  const category = (await repo.listArchiveCategories()).find(
    (item) => item.name.toLocaleLowerCase() === requested.toLocaleLowerCase()
  );
  if (!category) throw new HTTPException(400, { message: "Choose a configured Archive category." });
  return category.name;
}

async function validatedArchiveFolderId(repo: AppRepository, folderId: string | null | undefined): Promise<string | null> {
  if (!folderId) return null;
  if (!(await repo.getArchiveFolder(folderId))) {
    throw new HTTPException(400, { message: "Archive folder not found." });
  }
  return folderId;
}

async function createAuditLogBestEffort(
  repo: AppRepository,
  input: Parameters<AppRepository["createAuditLog"]>[0]
): Promise<void> {
  try {
    await repo.createAuditLog(input);
  } catch (error) {
    console.error(`Audit log write failed for ${input.action}.`, error);
  }
}

async function cleanupDocumentObject(repo: AppRepository, env: AppEnv, objectKey: string): Promise<void> {
  try {
    await repo.enqueueStorageCleanup(objectKey);
    await cleanupStoredDocuments(repo, createDocumentStorage(env));
  } catch {
    // An unacknowledged enqueue must never be followed by an object DELETE.
    console.error("Document cleanup requires retry.", { code: "cleanup_repository_unavailable" });
  }
}

function paginationFromQuery(query: Record<string, string | undefined>) {
  return {
    page: Math.max(1, positiveInteger(query.page, 1)),
    pageSize: Math.min(100, Math.max(10, positiveInteger(query.pageSize, 25)))
  };
}

function discussionFiltersFromQuery(query: Record<string, string | undefined>): ServiceDiscussionFilters {
  const view =
    query.view === "unread" ||
    query.view === "my-attention" ||
    query.view === "mentions" ||
    query.view === "pinned" ||
    query.view === "decisions" ||
    query.view === "attachments" ||
    query.view === "unlinked" ||
    query.view === "needs-action" ||
    query.view === "resolved"
      ? query.view
      : "all";
  const sort = query.sort === "oldest" || query.sort === "recent" ? query.sort : "newest";
  return {
    q: query.q ?? "",
    view,
    caseId: query.caseId,
    assetId: query.assetId,
    sort
  };
}

async function demoFileLimitResponse(repo: AppRepository, env: AppEnv, user: PublicUser, caseId: string) {
  if (user.role === "Admin") return null;
  if ((env.DEMO_MAX_FILES_PER_CASE ?? "").trim() === "0") return null;
  const limit = positiveInteger(env.DEMO_MAX_FILES_PER_CASE, DEFAULT_DEMO_MAX_FILES_PER_CASE);
  const existingDocuments = await repo.listDocuments(caseId);
  if (existingDocuments.length < limit) return null;
  return {
    error: "Case file limit reached",
    detail: `This case already has ${limit} active files. Ask the project administrator to raise the upload limit if this workspace needs more files per case.`
  };
}

function previewErrorPage(title: string, detail: string): Response {
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #f7f7f4; color: #20201d; }
      main { min-height: 100vh; display: grid; place-items: center; padding: 32px; box-sizing: border-box; }
      section { max-width: 520px; border: 1px solid #d8d6ca; border-radius: 8px; background: #fff; padding: 24px; box-shadow: 0 20px 60px rgba(32, 32, 29, 0.08); }
      h1 { margin: 0 0 8px; font-size: 20px; }
      p { margin: 0; color: #747160; line-height: 1.6; }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>${title}</h1>
        <p>${detail}</p>
      </section>
    </main>
  </body>
</html>`,
    { status: 404, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

function textToArrayBuffer(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function concatArrayBuffers(parts: ArrayBuffer[]): ArrayBuffer {
  const totalLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    output.set(new Uint8Array(part), offset);
    offset += part.byteLength;
  }
  return output.buffer;
}

function jsonSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function backupDateKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function backupManifestFileName(runId: string): string {
  return `realtycase-backup-manifest-${backupDateKey()}-${runId.slice(0, 8)}.json`;
}

function backupRunObjectBase(runId: string, date = new Date()): string {
  return `backups/runs/${backupDateKey(date)}/${runId}`;
}

function databaseTableExportFileName(exportId: string, date = new Date()): string {
  return `realtycase-database-tables-${backupDateKey(date)}-${exportId.slice(0, 8)}.json`;
}

function databaseTableExportObjectKey(exportId: string, fileName: string, date = new Date()): string {
  return `database/table-exports/${backupDateKey(date)}/${exportId}/${fileName}`;
}

function backupObjectKey(baseObjectKey: string, relativePath: string): string {
  return `${baseObjectKey}/${relativePath}`.replace(/\/+/g, "/");
}

function backupScopeLabel(scope: BackupSettings["scope"]): string {
  if (scope === "all-cases") return "All cases";
  if (scope === "closed-cases") return "Closed cases";
  return "Updated since last run";
}

function backupDestinationLabel(destination: BackupSettings["destination"]): string {
  if (destination === "google-drive") return "Google Drive archive";
  if (destination === "r2-manifest") return "Secure backup package";
  return "Manual export package";
}

function caseFolderName(caseRecord: CaseRecord): string {
  return safeFileName(`${caseRecord.caseNumber}-${caseRecord.propertyAddress}`) || caseRecord.caseId;
}

function backupPathSegment(value: string, fallback: string): string {
  const segment = safeFileName(value);
  return !segment || segment === "." || segment === ".." ? fallback : segment;
}

function backupDocumentTargetPath(
  caseById: Map<string, CaseRecord>,
  document: DocumentRecord,
  folderByCaseAndCategory: boolean
): string {
  const caseRecord = document.caseId ? caseById.get(document.caseId) : null;
  const folder = caseRecord ? caseFolderName(caseRecord) : document.caseId ?? "archive";
  const fileName = backupPathSegment(document.originalFileName || document.fileName, `${document.documentId}.bin`);
  if (!folderByCaseAndCategory) return `documents/${document.documentId}/${fileName}`;
  return `cases/${folder}/${backupPathSegment(document.category, "uncategorized")}/${document.documentId}/${fileName}`;
}

function backupMode(settings: BackupSettings, dryRun: boolean): BackupRun["mode"] {
  if (dryRun) return "dry-run";
  return settings.destination === "r2-manifest" ? "r2-manifest" : "planned-integration";
}

function isWritableBackupDestination(destination: BackupSettings["destination"]): boolean {
  return destination === "r2-manifest" || destination === "google-drive";
}

function backupStatus(settings: BackupSettings, dryRun: boolean, failedItems = 0, itemCount = 0): BackupRun["status"] {
  if (dryRun) return "dry-run";
  if (!isWritableBackupDestination(settings.destination)) return "attention";
  if (failedItems > 0 && failedItems >= itemCount) return "failed";
  if (failedItems > 0) return "attention";
  return "completed";
}

function backupMessage(settings: BackupSettings, dryRun: boolean, failedItems = 0): string {
  if (dryRun) return "Dry run completed. No backup files were written.";
  if (settings.destination === "r2-manifest" && failedItems > 0) {
    return `Secure backup package completed with ${failedItems} item(s) needing attention.`;
  }
  if (settings.destination === "r2-manifest") {
    return "Secure backup package completed. Records, manifest, and selected file copies were written to the private backup area.";
  }
  if (settings.destination === "google-drive" && failedItems > 0) {
    return `Google Drive backup package completed with ${failedItems} item(s) needing attention.`;
  }
  if (settings.destination === "google-drive") {
    return "Google Drive backup package completed. Metadata exports, manifest, and selected file copies were written to the configured Drive folder.";
  }
  return `${backupDestinationLabel(settings.destination)} is planned; this run records a manifest for review.`;
}

function buildBackupManifest(
  settings: BackupSettings,
  snapshot: BackupSnapshot,
  runId: string,
  user: PublicUser,
  manifestObjectKey: string | null
): Record<string, unknown> {
  const caseById = new Map(snapshot.cases.map((caseRecord) => [caseRecord.caseId, caseRecord]));
  return {
    formatVersion: 2,
    runId,
    generatedAt: snapshot.generatedAt,
    generatedBy: { userId: user.userId, name: user.name, email: user.email, role: user.role },
    sourceOfTruth: {
      metadata: "Application database",
      files: "Private file storage",
      manifestObjectKey
    },
    configuration: {
      destination: settings.destination,
      destinationLabel: backupDestinationLabel(settings.destination),
      schedule: settings.schedule,
      scope: settings.scope,
      scopeLabel: backupScopeLabel(settings.scope),
      includeMetadata: settings.includeMetadata,
      includeDocuments: settings.includeDocuments,
      includeAuditLogs: settings.includeAuditLogs,
      includeRelationshipMap: settings.includeRelationshipMap,
      folderByCaseAndCategory: settings.folderByCaseAndCategory,
      checksumManifest: settings.checksumManifest
    },
    counts: {
      cases: snapshot.cases.length,
      documents: snapshot.documents.length,
      archiveFolders: snapshot.archiveFolders.length,
      archiveCategories: snapshot.archiveCategories.length,
      contacts: snapshot.contacts.length,
      partyOrganizations: snapshot.partyOrganizations.length,
      caseContacts: snapshot.caseContacts.length,
      tags: snapshot.tags.length,
      tasks: snapshot.tasks.length,
      notes: snapshot.notes.length,
      discussion: snapshot.discussion.length,
      knowledge: snapshot.knowledge.length,
      manuscripts: snapshot.manuscripts.length,
      manuscriptChapters: snapshot.manuscriptChapters.length,
      manuscriptChapterVersions: snapshot.manuscriptChapterVersions.length,
      manuscriptBookmarks: snapshot.manuscriptBookmarks.length,
      privateVaults: snapshot.privateVaults.length,
      privateVaultFolders: snapshot.privateVaultFolders.length,
      privateVaultItems: snapshot.privateVaultItems.length,
      communications: snapshot.communications.length,
      auditLogs: snapshot.auditLogs.length,
      metadataRows: snapshot.metadataRows
    },
    metadata: settings.includeMetadata
      ? {
          cases: snapshot.cases,
          documents: snapshot.documents,
          archiveFolders: snapshot.archiveFolders,
          archiveCategories: snapshot.archiveCategories,
          partyOrganizations: snapshot.partyOrganizations,
          tags: snapshot.tags,
          tasks: snapshot.tasks,
          notes: snapshot.notes,
          discussion: snapshot.discussion,
          knowledge: snapshot.knowledge,
          manuscripts: snapshot.manuscripts,
          manuscriptChapters: snapshot.manuscriptChapters,
          manuscriptChapterVersions: snapshot.manuscriptChapterVersions,
          manuscriptBookmarks: snapshot.manuscriptBookmarks,
          privateVaults: snapshot.privateVaults,
          privateVaultFolders: snapshot.privateVaultFolders,
          privateVaultItems: snapshot.privateVaultItems,
          communications: snapshot.communications
        }
      : null,
    relationships: settings.includeRelationshipMap
      ? {
          partyOrganizations: snapshot.partyOrganizations,
          contacts: snapshot.contacts,
          caseContacts: snapshot.caseContacts
        }
      : null,
    documents: settings.includeDocuments
      ? snapshot.documents.map((document) => ({
          documentId: document.documentId,
          caseId: document.caseId,
          caseNumber: document.caseId ? caseById.get(document.caseId)?.caseNumber ?? null : null,
          originalFileName: document.originalFileName,
          category: document.category,
          sizeBytes: document.fileSize,
          mimeType: document.mimeType,
          uploadedAt: document.uploadedAt,
          sourceObjectKey: document.r2ObjectKey,
          targetArchivePath: backupDocumentTargetPath(caseById, document, settings.folderByCaseAndCategory),
          tags: document.tags
        }))
      : [],
    privateVaultItems: settings.includeDocuments
      ? snapshot.privateVaultItems.map((item) => ({
          itemId: item.itemId,
          vaultId: item.vaultId,
          encryptionVersion: item.encryptionVersion,
          encryptedMetadata: item.encryptedMetadata,
          wrappedFileKey: item.wrappedFileKey,
          sizeBytes: item.ciphertextSize,
          deletedAt: item.deletedAt ?? null,
          sourceObjectKey: item.objectKey,
          targetArchivePath: `private-vault/${item.vaultId}/${item.itemId}.pav`
        }))
      : [],
    auditLogs: settings.includeAuditLogs ? snapshot.auditLogs : []
  };
}

function backupItemsFromManifest(
  settings: BackupSettings,
  snapshot: BackupSnapshot,
  manifest: Record<string, unknown>,
  backupBaseObjectKey: string,
  manifestObjectKey: string | null,
  manifestFileName: string
): CreateBackupItemInput[] {
  const caseById = new Map(snapshot.cases.map((caseRecord) => [caseRecord.caseId, caseRecord]));
  const items: CreateBackupItemInput[] = [
    {
      backupItemId: crypto.randomUUID(),
      backupRunId: String(manifest.runId),
      itemType: "manifest",
      sourceId: String(manifest.runId),
      sourcePath: "generated://backup-manifest",
      targetPath: manifestObjectKey ?? backupObjectKey(backupBaseObjectKey, `manifest/${manifestFileName}`),
      status: "included",
      sizeBytes: jsonSize(manifest),
      metadata: { destination: settings.destination }
    }
  ];

  if (settings.includeMetadata) {
    const metadata = manifest.metadata ?? {};
    items.push({
      backupItemId: crypto.randomUUID(),
      backupRunId: String(manifest.runId),
      itemType: "metadata",
      sourceId: null,
      sourcePath: "database://metadata",
      targetPath: backupObjectKey(backupBaseObjectKey, "metadata/realtycase-metadata.json"),
      status: "included",
      sizeBytes: jsonSize(metadata),
      metadata: { rows: snapshot.metadataRows }
    });
  }

  if (settings.includeRelationshipMap) {
    const relationships = manifest.relationships ?? {};
    items.push({
      backupItemId: crypto.randomUUID(),
      backupRunId: String(manifest.runId),
      itemType: "relationship",
      sourceId: null,
      sourcePath: "database://relationships",
      targetPath: backupObjectKey(backupBaseObjectKey, "metadata/realtycase-relationship-map.json"),
      status: "included",
      sizeBytes: jsonSize(relationships),
      metadata: {
        contacts: snapshot.contacts.length,
        partyOrganizations: snapshot.partyOrganizations.length,
        caseContacts: snapshot.caseContacts.length,
        communications: snapshot.communications.length
      }
    });
  }

  if (settings.includeAuditLogs) {
    items.push({
      backupItemId: crypto.randomUUID(),
      backupRunId: String(manifest.runId),
      itemType: "audit-log",
      sourceId: null,
      sourcePath: "database://audit_logs",
      targetPath: backupObjectKey(backupBaseObjectKey, "metadata/realtycase-audit-logs.json"),
      status: "included",
      sizeBytes: jsonSize(snapshot.auditLogs),
      metadata: { auditLogs: snapshot.auditLogs.length }
    });
  }

  if (settings.includeDocuments) {
    snapshot.documents.forEach((document) => {
      items.push({
        backupItemId: crypto.randomUUID(),
        backupRunId: String(manifest.runId),
        itemType: "document",
        sourceId: document.documentId,
        sourcePath: document.r2ObjectKey,
        targetPath: backupObjectKey(
          backupBaseObjectKey,
          backupDocumentTargetPath(caseById, document, settings.folderByCaseAndCategory)
        ),
        status: "included",
        sizeBytes: document.fileSize,
        metadata: {
          caseId: document.caseId ?? null,
          category: document.category,
          mimeType: document.mimeType,
          originalFileName: document.originalFileName
        }
      });
    });
    snapshot.privateVaultItems.forEach((item) => {
      items.push({
        backupItemId: crypto.randomUUID(),
        backupRunId: String(manifest.runId),
        itemType: "private-vault-item",
        sourceId: item.itemId,
        sourcePath: item.objectKey,
        targetPath: backupObjectKey(backupBaseObjectKey, `private-vault/${item.vaultId}/${item.itemId}.pav`),
        status: "included",
        sizeBytes: item.ciphertextSize,
        metadata: {
          vaultId: item.vaultId,
          encryptionVersion: item.encryptionVersion,
          deletedAt: item.deletedAt ?? null
        }
      });
    });
  }

  return items;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sha256Hex(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function markBackupItemFailed(item: CreateBackupItemInput, error: unknown) {
  item.status = "failed";
  item.metadata = {
    ...(item.metadata ?? {}),
    error: errorMessage(error)
  };
}

async function writeBackupJsonObject(
  storage: ReturnType<typeof createDocumentStorage>,
  item: CreateBackupItemInput,
  value: unknown,
  checksumManifest: boolean,
  writtenObjectKeys: string[]
) {
  const payload = textToArrayBuffer(JSON.stringify(value, null, 2));
  item.sizeBytes = payload.byteLength;
  if (checksumManifest) item.checksum = await sha256Hex(payload);
  await storage.put(item.targetPath, payload, "application/json");
  writtenObjectKeys.push(item.targetPath);
}

async function copyBackupDocumentObject(
  sourceStorage: ReturnType<typeof createDocumentStorage>,
  targetStorage: ReturnType<typeof createBackupStorage>,
  item: CreateBackupItemInput,
  checksumManifest: boolean,
  writtenObjectKeys: string[]
) {
  const source = await sourceStorage.get(item.sourcePath);
  if (!source) throw new Error("Source file object not found");
  const payload = await new Response(source.body).arrayBuffer();
  item.sizeBytes = payload.byteLength;
  if (checksumManifest) item.checksum = await sha256Hex(payload);
  const contentType = typeof item.metadata?.mimeType === "string" ? item.metadata.mimeType : source.contentType ?? "application/octet-stream";
  await targetStorage.put(item.targetPath, payload, contentType);
  writtenObjectKeys.push(item.targetPath);
}

interface GoogleDriveConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  folderId: string;
}

interface GoogleDriveFile {
  id: string;
  name: string;
  webViewLink?: string;
}

const GOOGLE_DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";

function googleDriveConfig(env: AppEnv): GoogleDriveConfig {
  const missing = [
    ["GOOGLE_CLIENT_ID", env.GOOGLE_CLIENT_ID],
    ["GOOGLE_CLIENT_SECRET", env.GOOGLE_CLIENT_SECRET],
    ["GOOGLE_REFRESH_TOKEN", env.GOOGLE_REFRESH_TOKEN],
    ["GOOGLE_DRIVE_BACKUP_FOLDER_ID", env.GOOGLE_DRIVE_BACKUP_FOLDER_ID]
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new HTTPException(400, {
      message: `Google Drive backup is not configured. Missing ${missing.join(", ")}.`
    });
  }

  return {
    clientId: env.GOOGLE_CLIENT_ID!,
    clientSecret: env.GOOGLE_CLIENT_SECRET!,
    refreshToken: env.GOOGLE_REFRESH_TOKEN!,
    folderId: env.GOOGLE_DRIVE_BACKUP_FOLDER_ID!
  };
}

async function googleDriveAccessToken(config: GoogleDriveConfig): Promise<string> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token"
    })
  });

  const payload = (await response.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || `Google token request failed with status ${response.status}`);
  }
  return payload.access_token;
}

async function createGoogleDriveFolder(accessToken: string, parentId: string, name: string): Promise<GoogleDriveFile> {
  const response = await fetch(`${GOOGLE_DRIVE_FILES_URL}?fields=id,name,webViewLink`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      name,
      mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
      parents: [parentId]
    })
  });

  const payload = (await response.json().catch(() => ({}))) as GoogleDriveFile & { error?: { message?: string } };
  if (!response.ok || !payload.id) {
    throw new Error(payload.error?.message || `Google Drive folder creation failed with status ${response.status}`);
  }
  return payload;
}

function multipartRelatedBody(metadata: Record<string, unknown>, payload: ArrayBuffer, mimeType: string) {
  const boundary = `realtycase_${crypto.randomUUID().replace(/-/g, "")}`;
  const head = textToArrayBuffer(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
  );
  const tail = textToArrayBuffer(`\r\n--${boundary}--`);
  return {
    boundary,
    body: concatArrayBuffers([head, payload, tail])
  };
}

async function uploadGoogleDriveFile(
  accessToken: string,
  parentId: string,
  name: string,
  mimeType: string,
  payload: ArrayBuffer
): Promise<GoogleDriveFile> {
  const multipart = multipartRelatedBody({ name, parents: [parentId] }, payload, mimeType);
  const response = await fetch(`${GOOGLE_DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,name,webViewLink`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": `multipart/related; boundary=${multipart.boundary}`
    },
    body: multipart.body
  });

  const result = (await response.json().catch(() => ({}))) as GoogleDriveFile & { error?: { message?: string } };
  if (!response.ok || !result.id) {
    throw new Error(result.error?.message || `Google Drive upload failed with status ${response.status}`);
  }
  return result;
}

async function ensureGoogleDriveFolderPath(
  accessToken: string,
  rootFolderId: string,
  parts: string[],
  folderCache: Map<string, string>
): Promise<string> {
  let parentId = rootFolderId;
  let cacheKey = "";
  for (const part of parts) {
    cacheKey = cacheKey ? `${cacheKey}/${part}` : part;
    const cached = folderCache.get(cacheKey);
    if (cached) {
      parentId = cached;
      continue;
    }
    const folder = await createGoogleDriveFolder(accessToken, parentId, part);
    folderCache.set(cacheKey, folder.id);
    parentId = folder.id;
  }
  return parentId;
}

function relativeBackupPath(targetPath: string, backupBaseObjectKey: string): string {
  const prefix = `${backupBaseObjectKey}/`;
  return targetPath.startsWith(prefix) ? targetPath.slice(prefix.length) : targetPath;
}

async function uploadBackupPayloadToDrive(
  accessToken: string,
  rootFolderId: string,
  folderCache: Map<string, string>,
  item: CreateBackupItemInput,
  archivePath: string,
  mimeType: string,
  payload: ArrayBuffer
) {
  const pathParts = archivePath.split("/").filter(Boolean);
  const fileName = pathParts.pop() || safeFileName(item.sourceId ?? item.itemType) || "backup-item";
  const parentId = await ensureGoogleDriveFolderPath(accessToken, rootFolderId, pathParts, folderCache);
  const driveFile = await uploadGoogleDriveFile(accessToken, parentId, fileName, mimeType, payload);
  item.targetPath = `google-drive://${driveFile.id}/${archivePath}`;
  item.metadata = {
    ...(item.metadata ?? {}),
    googleDriveFileId: driveFile.id,
    googleDriveWebViewLink: driveFile.webViewLink ?? null,
    googleDriveArchivePath: archivePath
  };
}

async function writeBackupManifestCopyToR2(
  storage: ReturnType<typeof createDocumentStorage>,
  objectKey: string | null,
  manifest: Record<string, unknown>,
  writtenObjectKeys: string[]
) {
  if (!objectKey) return;
  await storage.put(objectKey, textToArrayBuffer(JSON.stringify(manifest, null, 2)), "application/json");
  writtenObjectKeys.push(objectKey);
}

async function writeGoogleDriveBackupPackage(
  env: AppEnv,
  documentStorage: ReturnType<typeof createDocumentStorage>,
  backupStorage: ReturnType<typeof createBackupStorage>,
  settings: BackupSettings,
  manifest: Record<string, unknown>,
  items: CreateBackupItemInput[],
  backupBaseObjectKey: string,
  manifestObjectKey: string | null
): Promise<{ manifest: Record<string, unknown>; writtenObjectKeys: string[] }> {
  const config = googleDriveConfig(env);
  const accessToken = await googleDriveAccessToken(config);
  const runFolder = await createGoogleDriveFolder(
    accessToken,
    config.folderId,
    `MD3 Platform Backup ${backupDateKey()} ${String(manifest.runId).slice(0, 8)}`
  );
  const folderCache = new Map<string, string>();
  const writtenObjectKeys: string[] = [];

  for (const item of items) {
    if (item.itemType === "manifest") continue;
    const archivePath = relativeBackupPath(item.targetPath, backupBaseObjectKey);
    try {
      if (item.itemType === "metadata") {
        const payload = textToArrayBuffer(JSON.stringify(manifest.metadata ?? {}, null, 2));
        item.sizeBytes = payload.byteLength;
        if (settings.checksumManifest) item.checksum = await sha256Hex(payload);
        await uploadBackupPayloadToDrive(accessToken, runFolder.id, folderCache, item, archivePath, "application/json", payload);
      } else if (item.itemType === "relationship") {
        const payload = textToArrayBuffer(JSON.stringify(manifest.relationships ?? {}, null, 2));
        item.sizeBytes = payload.byteLength;
        if (settings.checksumManifest) item.checksum = await sha256Hex(payload);
        await uploadBackupPayloadToDrive(accessToken, runFolder.id, folderCache, item, archivePath, "application/json", payload);
      } else if (item.itemType === "audit-log") {
        const payload = textToArrayBuffer(JSON.stringify(manifest.auditLogs ?? [], null, 2));
        item.sizeBytes = payload.byteLength;
        if (settings.checksumManifest) item.checksum = await sha256Hex(payload);
        await uploadBackupPayloadToDrive(accessToken, runFolder.id, folderCache, item, archivePath, "application/json", payload);
      } else if (item.itemType === "document" || item.itemType === "private-vault-item") {
        const source = await documentStorage.get(item.sourcePath);
        if (!source) throw new Error("Source file object not found");
        const payload = await new Response(source.body).arrayBuffer();
        const mimeType = typeof item.metadata?.mimeType === "string" ? item.metadata.mimeType : source.contentType ?? "application/octet-stream";
        item.sizeBytes = payload.byteLength;
        if (settings.checksumManifest) item.checksum = await sha256Hex(payload);
        await uploadBackupPayloadToDrive(accessToken, runFolder.id, folderCache, item, archivePath, mimeType, payload);
      }
    } catch (error) {
      markBackupItemFailed(item, error);
    }
  }

  const failedItems = items.filter((item) => item.status === "failed").length;
  const finalizedManifest = {
    ...manifest,
    backupPackage: {
      finalizedAt: new Date().toISOString(),
      destination: "google-drive",
      googleDriveFolderId: runFolder.id,
      googleDriveFolderLink: runFolder.webViewLink ?? null,
      r2ManifestObjectKey: manifestObjectKey,
      itemCount: items.length,
      failedItems,
      copiedDocuments: items.filter((item) => item.itemType === "document" && item.status === "included").length,
      copiedPrivateVaultItems: items.filter((item) => item.itemType === "private-vault-item" && item.status === "included").length,
      checksumManifest: settings.checksumManifest
    },
    backupItems: items.map((item) => ({
      itemType: item.itemType,
      sourceId: item.sourceId ?? null,
      sourcePath: item.sourcePath,
      targetPath: item.targetPath,
      status: item.status,
      sizeBytes: item.sizeBytes,
      checksum: item.checksum ?? null,
      metadata: item.metadata ?? {}
    }))
  };

  const manifestItem = items.find((item) => item.itemType === "manifest");
  if (manifestItem) {
    try {
      const archivePath = `manifest/${backupManifestFileName(String(manifest.runId))}`;
      const payload = textToArrayBuffer(JSON.stringify(finalizedManifest, null, 2));
      manifestItem.sizeBytes = payload.byteLength;
      if (settings.checksumManifest) manifestItem.checksum = await sha256Hex(payload);
      await uploadBackupPayloadToDrive(accessToken, runFolder.id, folderCache, manifestItem, archivePath, "application/json", payload);
    } catch (error) {
      markBackupItemFailed(manifestItem, error);
    }
  }

  await writeBackupManifestCopyToR2(backupStorage, manifestObjectKey, finalizedManifest, writtenObjectKeys);
  return { manifest: finalizedManifest, writtenObjectKeys };
}

async function writeR2BackupPackage(
  documentStorage: ReturnType<typeof createDocumentStorage>,
  backupStorage: ReturnType<typeof createBackupStorage>,
  settings: BackupSettings,
  manifest: Record<string, unknown>,
  items: CreateBackupItemInput[]
): Promise<{ manifest: Record<string, unknown>; writtenObjectKeys: string[] }> {
  const writtenObjectKeys: string[] = [];

  for (const item of items) {
    if (item.itemType === "manifest") continue;
    try {
      if (item.itemType === "metadata") {
        await writeBackupJsonObject(backupStorage, item, manifest.metadata ?? {}, settings.checksumManifest, writtenObjectKeys);
      } else if (item.itemType === "relationship") {
        await writeBackupJsonObject(backupStorage, item, manifest.relationships ?? {}, settings.checksumManifest, writtenObjectKeys);
      } else if (item.itemType === "audit-log") {
        await writeBackupJsonObject(backupStorage, item, manifest.auditLogs ?? [], settings.checksumManifest, writtenObjectKeys);
      } else if (item.itemType === "document" || item.itemType === "private-vault-item") {
        await copyBackupDocumentObject(documentStorage, backupStorage, item, settings.checksumManifest, writtenObjectKeys);
      }
    } catch (error) {
      markBackupItemFailed(item, error);
    }
  }

  const failedItems = items.filter((item) => item.status === "failed").length;
  const finalizedManifest = {
    ...manifest,
    backupPackage: {
      finalizedAt: new Date().toISOString(),
      itemCount: items.length,
      failedItems,
      copiedDocuments: items.filter((item) => item.itemType === "document" && item.status === "included").length,
      copiedPrivateVaultItems: items.filter((item) => item.itemType === "private-vault-item" && item.status === "included").length,
      checksumManifest: settings.checksumManifest
    },
    backupItems: items.map((item) => ({
      itemType: item.itemType,
      sourceId: item.sourceId ?? null,
      sourcePath: item.sourcePath,
      targetPath: item.targetPath,
      status: item.status,
      sizeBytes: item.sizeBytes,
      checksum: item.checksum ?? null,
      metadata: item.metadata ?? {}
    }))
  };

  const manifestItem = items.find((item) => item.itemType === "manifest");
  if (manifestItem) {
    try {
      await writeBackupJsonObject(backupStorage, manifestItem, finalizedManifest, settings.checksumManifest, writtenObjectKeys);
    } catch (error) {
      markBackupItemFailed(manifestItem, error);
    }
  }

  return { manifest: finalizedManifest, writtenObjectKeys };
}

app.onError((error, context) => {
  if (error instanceof PrivateVaultItemAccessError) return context.json({ error: "Private vault item not found" }, 404);
  if (error instanceof BookmarkConflictError) return context.json({ error: error.message }, 409);
  if (error instanceof Response) return error;
  if (error instanceof HTTPException) {
    return context.json({ error: error.status === 403 ? "Forbidden" : "Request failed", detail: error.message }, error.status);
  }
  console.error(error);
  return context.json({ error: "Internal Server Error", detail: error.message }, 500);
});

app.use("*", async (context, next) => {
  // Retired integration: fail before repository creation, authentication or any
  // network calls, even when an upgraded instance retains its old configuration.
  if (isPersonalArchive(context.env) && /^\/api\/code-repositories(?:\/|$)/.test(context.req.path)) {
    return context.json({ error: "Not found" }, 404);
  }
  context.set("repo", createRepository(context.env));
  await next();
});

app.post("/auth/login", async (context) => {
  const body = await context.req.json<{ email: string; password: string }>();
  const repo = context.get("repo");
  const user = await repo.getUserByEmail(body.email);
  const credential = user ? await repo.getUserCredential(user.userId) : null;
  const expectedPassword = credential ? "" : expectedDemoPassword(body.email, context.env);
  const passwordMatches = credential
    ? await verifyPassword(body.password, credential)
    : Boolean(expectedPassword && body.password === expectedPassword);
  if (!user || !passwordMatches) {
    return context.json({ error: "Invalid credentials" }, 401);
  }
  const currentTenantId = await repo.getDefaultTenantForUser(user.userId);
  const token = createSessionToken();
  const expiresAt = createSessionExpiry();
  const created = await repo.createAuthSession({
    userId: user.userId,
    currentTenantId,
    tokenHash: await hashSessionToken(token),
    expiresAt
  }, credential?.passwordHash ?? null);
  if (!created) return context.json({ error: "Invalid credentials" }, 401);
  const sessionUser = {
    ...user,
    tenantId: currentTenantId ?? user.tenantId ?? null,
    mustChangePassword: credential?.mustChangePassword ?? false
  };
  context.header("Set-Cookie", createSessionCookie(token, isSecureRequest(context.req.raw)));
  await repo.createAuditLog({ action: "auth.login", entityType: "user", entityId: user.userId, user: sessionUser });
  return context.json({ user: userResponse(sessionUser, context.env) });
});

app.post("/auth/logout", async (context) => {
  await revokeRequestSession(context.req.raw, context.get("repo"));
  context.header("Set-Cookie", clearSessionCookie(isSecureRequest(context.req.raw)));
  return context.json({ ok: true });
});

app.post("/auth/change-password", async (context) => {
  const repo = context.get("repo");
  const user = await readSessionUser(context.req.raw, repo);
  if (!user) return context.json({ error: "Unauthorized" }, 401);
  const input = changePasswordSchema.parse(await context.req.json());
  if (input.newPassword !== input.confirmPassword) {
    return context.json({ error: "Passwords do not match" }, 400);
  }
  if (input.currentPassword === input.newPassword) {
    return context.json({ error: "New password must be different from the temporary password." }, 400);
  }
  const validationError = validateNewPassword(input.newPassword);
  if (validationError) return context.json({ error: validationError }, 400);

  const credential = await repo.getUserCredential(user.userId);
  const expectedPassword = credential ? "" : expectedDemoPassword(user.email, context.env);
  const currentPasswordMatches = credential
    ? await verifyPassword(input.currentPassword, credential)
    : Boolean(expectedPassword && input.currentPassword === expectedPassword);
  if (!currentPasswordMatches) return context.json({ error: "Current password is incorrect." }, 400);

  const newToken = createSessionToken();
  const updated = await repo.updateUserPassword(user.userId, await hashPassword(input.newPassword), {
    expectedPasswordHash: credential?.passwordHash ?? null,
    replacementSession: {
      userId: user.userId,
      currentTenantId: user.tenantId,
      tokenHash: await hashSessionToken(newToken),
      expiresAt: createSessionExpiry()
    }
  });
  if (!updated) return context.json({ error: "Credentials changed. Please sign in again." }, 409);
  context.header("Set-Cookie", createSessionCookie(newToken, isSecureRequest(context.req.raw)));
  const updatedUser = userResponse({ ...updated, mustChangePassword: false }, context.env);
  await repo.createAuditLog({ action: "auth.change_password", entityType: "user", entityId: user.userId, user: updatedUser });
  return context.json({ user: updatedUser });
});

app.get("/auth/session", async (context) => {
  const repo = context.get("repo");
  const user = await readSessionUser(context.req.raw, repo);
  return context.json({ user: user ? userResponse(user, context.env) : null });
});

registerGmailExtensionPublicRoutes(app);

app.use("*", async (context, next) => {
  const repo = context.get("repo");
  const user = await readSessionUser(context.req.raw, repo);
  if (!user) return context.json({ error: "Unauthorized" }, 401);
  context.set("user", withDemoAccess(user, context.env));
  const expectedUserId = context.req.header("x-archive-user-id");
  if (expectedUserId && expectedUserId !== user.userId) {
    return context.json({ error: "session_identity_changed", detail: "Sign in with the account that opened this editor before saving." }, 403);
  }
  if (user.mustChangePassword) {
    return context.json(
      {
        error: "password_change_required",
        detail: "Please change your temporary password before using this workspace."
      },
      403
    );
  }
  if (isPersonalArchive(context.env)) {
    context.set("repo", withArchiveManagementAccess(repo, {
      userId: user.userId, sessionTokenHash: await hashSessionToken(readSessionToken(context.req.raw)!)
    }));
  }
  await next();
});

app.use("*", async (context, next) => {
  if (isPublicMutationMethod(context.req.method)) {
    requirePublicDemoMutationAccess(context.get("user"), context.env);
  }
  // One boundary covers existing and future Vault mutation routes, including
  // root creation, key recovery, multipart uploads and bulk metadata changes.
  if (isPersonalArchive(context.env) && /^\/api\/private-vault(?:\/|$)/.test(context.req.path)
    && !["GET", "HEAD", "OPTIONS"].includes(context.req.method) && context.get("user").role === "ReadOnly") {
    throw new HTTPException(403, { message: "ReadOnly accounts can read their existing vault but cannot change it." });
  }
  await next();
});

app.get("/archive/management-access", async (context) => {
  requirePersonalArchive(context.env);
  const user = context.get("user");
  requirePermission(user, "settings", "settings");
  const session = await context.get("repo").getArchiveManagementSession({
    userId: user.userId, sessionTokenHash: await hashSessionToken(readSessionToken(context.req.raw)!)
  });
  return context.json({ verifiedUntil: session?.verifiedUntil && Date.parse(session.verifiedUntil) > Date.now() ? session.verifiedUntil : null });
});

app.post("/archive/management-access", async (context) => {
  requirePersonalArchive(context.env);
  const user = context.get("user");
  requirePermission(user, "settings", "settings");
  const { currentPassword } = z.object({ currentPassword: z.string().min(1).max(1024) }).parse(await context.req.json());
  const repo = context.get("repo");
  const access = { userId: user.userId, sessionTokenHash: await hashSessionToken(readSessionToken(context.req.raw)!) };
  const credential = await repo.getUserCredential(user.userId);
  if (!credential || !await verifyPassword(currentPassword, credential)) {
    await repo.setArchiveManagementVerification(access, null);
    return context.json({ error: "Current password is incorrect." }, 400);
  }
  const verifiedUntil = await repo.setArchiveManagementVerification(access, credential.passwordHash);
  if (!verifiedUntil) return context.json({ error: "Credentials or session changed. Sign in again." }, 409);
  return context.json({ verifiedUntil });
});

app.delete("/archive/management-access", async (context) => {
  requirePersonalArchive(context.env);
  const user = context.get("user");
  requirePermission(user, "settings", "settings");
  await context.get("repo").setArchiveManagementVerification({
    userId: user.userId, sessionTokenHash: await hashSessionToken(readSessionToken(context.req.raw)!)
  }, null);
  return context.json({ verifiedUntil: null });
});

app.get("/dashboard", async (context) => {
  requirePermission(context.get("user"), "view", "dashboard");
  return context.json(await context.get("repo").getDashboardStats());
});

app.get("/my-work", async (context) => {
  const user = context.get("user");
  requirePermission(user, "view", "dashboard");
  requirePermission(user, "view", "task");
  requirePermission(user, "view", "note");
  const query = context.req.query();
  const filters = z
    .object({
      source: z.enum(MY_WORK_SOURCES).optional(),
      owner: z.union([z.enum(["attention", "unassigned", "all"]), z.string().uuid()]).optional(),
      state: z.enum(MY_WORK_STATES).optional(),
      dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    })
    .parse({
      source: query.source || undefined,
      owner: query.owner || undefined,
      state: query.state || undefined,
      dateFrom: query.dateFrom || undefined,
      dateTo: query.dateTo || undefined
    });
  return context.json(await buildMyWorkQueue(context.get("repo"), user, filters));
});

app.get("/users", async (context) => {
  requirePermission(context.get("user"), "view", "user");
  return context.json(await context.get("repo").listUsers());
});

app.get("/archive/storage-cleanup/status", async (context) => {
  requirePersonalArchive(context.env);
  if (context.get("user").role !== "Admin") throw new HTTPException(403, { message: "Administrator access required." });
  return context.json(await context.get("repo").getStorageCleanupStatus());
});

function requireSavedDirectoryViewPermission(user: PublicUser, scope: z.infer<typeof directoryViewScopeSchema>) {
  if (scope === "documents") requirePermission(user, "view", "document");
  else if (scope === "assets") requirePermission(user, "view", "asset");
  else if (scope === "services") requirePermission(user, "view", "case");
  else if (scope === "communications") {
    requirePermission(user, "view", "case");
    requirePermission(user, "view", "note");
  } else {
    requirePermission(user, "view", "contact");
  }
}

app.get("/saved-directory-views", async (context) => {
  const user = context.get("user");
  const scope = directoryViewScopeSchema.optional().parse(context.req.query("scope"));
  if (scope) requireSavedDirectoryViewPermission(user, scope);
  return context.json(await context.get("repo").listSavedDirectoryViews(scope, user.userId));
});

app.post("/saved-directory-views", async (context) => {
  const user = context.get("user");
  const input = savedDirectoryViewSchema.parse(await context.req.json());
  requireSavedDirectoryViewPermission(user, input.scope);
  const record = await context.get("repo").createSavedDirectoryView(input, user);
  await context.get("repo").createAuditLog({
    action: "saved_directory_view.created",
    entityType: "saved_directory_view",
    entityId: record.savedViewId,
    user,
    metadata: { scope: record.scope, name: record.name }
  });
  return context.json(record, 201);
});

app.patch("/saved-directory-views/:id", async (context) => {
  const user = context.get("user");
  const input = savedDirectoryViewSchema.partial().parse(await context.req.json());
  const current = await context.get("repo").getSavedDirectoryView(context.req.param("id"));
  if (!current) return context.json({ error: "Saved view not found" }, 404);
  requireSavedDirectoryViewPermission(user, input.scope ?? current.scope);
  const record = await context.get("repo").updateSavedDirectoryView(context.req.param("id"), input, user);
  if (!record) return context.json({ error: "Saved view not found" }, 404);
  await context.get("repo").createAuditLog({
    action: "saved_directory_view.updated",
    entityType: "saved_directory_view",
    entityId: record.savedViewId,
    user,
    metadata: { scope: record.scope, name: record.name }
  });
  return context.json(record);
});

app.delete("/saved-directory-views/:id", async (context) => {
  const user = context.get("user");
  const current = await context.get("repo").getSavedDirectoryView(context.req.param("id"));
  if (!current) return context.json({ error: "Saved view not found" }, 404);
  requireSavedDirectoryViewPermission(user, current.scope);
  const deleted = await context.get("repo").deleteSavedDirectoryView(context.req.param("id"), user);
  if (!deleted) return context.json({ error: "Saved view not found" }, 404);
  await context.get("repo").createAuditLog({
    action: "saved_directory_view.deleted",
    entityType: "saved_directory_view",
    entityId: current.savedViewId,
    user,
    metadata: { scope: current.scope, name: current.name }
  });
  return context.json({ ok: true });
});

registerGmailExtensionTokenRoutes(app);
registerCommunicationRoutes(app);
registerPbxRoutes(app);

app.get("/case-types", async (context) => {
  requirePermission(context.get("user"), "view", "case");
  return context.json(await context.get("repo").listCaseTypeTemplates());
});

app.get("/cases", async (context) => {
  const user = context.get("user");
  requirePermission(user, "view", "case");
  const query = context.req.query();
  const archiveStatus = query.archiveStatus === "archived" || query.archiveStatus === "all" ? query.archiveStatus : "active";
  if (archiveStatus !== "active") requirePermission(user, "delete", "case");
  return context.json(
    await context.get("repo").listCases({
      q: query.q,
      status: query.status as never,
      tag: query.tag,
      contactRole: query.contactRole as never,
      caseTypeCode: query.caseTypeCode,
      customerOrganizationId: query.customerOrganizationId,
      assignedTo: query.assignedTo,
      assetId: query.assetId,
      closingFrom: query.closingFrom,
      closingTo: query.closingTo,
      archiveStatus
    })
  );
});

app.get("/cases/page", async (context) => {
  const user = context.get("user");
  requirePermission(user, "view", "case");
  const query = context.req.query();
  const archiveStatus = query.archiveStatus === "archived" || query.archiveStatus === "all" ? query.archiveStatus : "active";
  if (archiveStatus !== "active") requirePermission(user, "delete", "case");
  return context.json(
    await context.get("repo").listCasesPage(
      {
        q: query.q,
        status: enumQuery(query.status, CASE_STATUSES),
        tag: query.tag,
        contactRole: enumQuery(query.contactRole, CONTACT_ROLES),
        caseTypeCode: query.caseTypeCode,
        customerOrganizationId: query.customerOrganizationId,
        assignedTo: query.assignedTo,
        assetId: query.assetId,
        closingFrom: query.closingFrom,
        closingTo: query.closingTo,
        archiveStatus,
        sort: query.sort as never,
        direction: sortDirectionFilter(query.direction)
      },
      paginationFromQuery(query)
    )
  );
});

app.post("/cases/bulk", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "case");
  const repo = context.get("repo");
  const input = caseBulkActionSchema.parse(await context.req.json());
  if (input.action === "set-status" && !input.status) return context.json({ error: "Status is required" }, 400);
  if ((input.action === "add-tag" || input.action === "remove-tag") && !input.tagId) {
    return context.json({ error: "Tag is required" }, 400);
  }
  const result: BulkActionResult = { requested: input.caseIds.length, succeeded: 0, failed: [] };
  for (const caseId of input.caseIds) {
    try {
      const record = await repo.getCase(caseId, { includeArchived: true });
      if (!record) throw new Error("Service not found");
      if (input.action === "set-status") {
        await repo.updateCase(caseId, { status: input.status });
      } else {
        const tagIds = new Set(record.tags.map((tag) => tag.tagId));
        if (input.action === "add-tag" && input.tagId) tagIds.add(input.tagId);
        if (input.action === "remove-tag" && input.tagId) tagIds.delete(input.tagId);
        await repo.updateCase(caseId, { tagIds: Array.from(tagIds) });
      }
      result.succeeded += 1;
    } catch (error) {
      result.failed.push({ id: caseId, error: error instanceof Error ? error.message : "Bulk service action failed" });
    }
  }
  await repo.createAuditLog({
    action: "case.bulk_action",
    entityType: "case",
    entityId: input.caseIds[0] ?? "bulk",
    user,
    metadata: { action: input.action, requested: result.requested, succeeded: result.succeeded, failed: result.failed.length }
  });
  return context.json(result);
});

app.post("/cases", async (context) => {
  const user = context.get("user");
  requirePermission(user, "create", "case");
  const input = caseInputSchema.parse(await context.req.json());
  if (input.status === "Closed") {
    return context.json(
      {
        error: "Use close workflow",
        detail: "New cases cannot be created directly as Closed. Create the case first, then use the Close Case workflow."
      },
      400
    );
  }
  const repo = context.get("repo");
  const { createChecklistTasks, ...caseInput } = input;
  const record = await repo.createCase(caseInput as never);
  const checklistTasksCreated = createChecklistTasks ? await createChecklistTasksForCase(repo, record) : 0;
  await context.get("repo").createAuditLog({
    action: "case.created",
    entityType: "case",
    entityId: record.caseId,
    user,
    metadata: {
      caseNumber: record.caseNumber,
      caseTypeCode: record.caseTypeCode,
      customerOrganizationId: record.customerOrganizationId,
      checklistTasksCreated
    }
  });
  return context.json(record, 201);
});

app.get("/cases/next-number", async (context) => {
  requirePermission(context.get("user"), "view", "case");
  return context.json({ caseNumber: await context.get("repo").previewNextCaseNumber() });
});

app.get("/cases/:id/workspace", async (context) => {
  const user = context.get("user");
  requirePermission(user, "view", "case");
  const repo = context.get("repo");
  const caseId = context.req.param("id");
  const includeArchived = context.req.query("includeArchived") === "true";
  if (includeArchived) requirePermission(user, "delete", "case");
  const record = await repo.getCase(caseId, { includeArchived });
  if (!record) return context.json({ error: "Case not found" }, 404);

  const [
    caseContacts,
    documents,
    knowledge,
    discussion,
    readiness,
    timeline,
    communications,
    tasks,
    tags,
    contacts,
    partyOrganizations,
    users,
    caseTypes
  ] = await Promise.all([
    repo.listCaseContacts(caseId),
    repo.listDocuments(caseId, {
      q: context.req.query("q") ?? "",
      category: context.req.query("category") as never
    }),
    repo.listKnowledge({ caseId, sort: "updated", direction: "desc" }),
    repo.listServiceDiscussion(caseId),
    buildCaseReadiness(repo, caseId, { includeArchived }),
    buildCaseTimeline(repo, caseId),
    repo.listCommunications(caseId),
    repo.listTasks(caseId),
    repo.listTags(),
    repo.listContacts(""),
    repo.listPartyOrganizations(""),
    repo.listUsers(),
    repo.listCaseTypeTemplates()
  ]);

  const payload: CaseWorkspacePayload = {
    case: record,
    caseContacts,
    documents,
    knowledge,
    discussion,
    readiness,
    timeline,
    communications,
    tasks,
    tags,
    contacts,
    partyOrganizations,
    users,
    caseTypes
  };

  return context.json(payload);
});

app.get("/cases/:id", async (context) => {
  const user = context.get("user");
  requirePermission(user, "view", "case");
  const includeArchived = context.req.query("includeArchived") === "true";
  if (includeArchived) requirePermission(user, "delete", "case");
  const record = await context.get("repo").getCase(context.req.param("id"), { includeArchived });
  if (!record) return context.json({ error: "Case not found" }, 404);
  return context.json(record);
});

app.get("/cases/:id/readiness", async (context) => {
  const user = context.get("user");
  requirePermission(user, "view", "case");
  const caseId = context.req.param("id");
  const includeArchived = context.req.query("includeArchived") === "true";
  if (includeArchived) requirePermission(user, "delete", "case");
  const record = await context.get("repo").getCase(caseId, { includeArchived });
  if (!record) return context.json({ error: "Case not found" }, 404);
  return context.json(await buildCaseReadiness(context.get("repo"), caseId, { includeArchived }));
});

app.patch("/cases/:id", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "case");
  const repo = context.get("repo");
  const caseId = context.req.param("id");
  const input = caseInputSchema.partial().parse(await context.req.json());
  const current = await repo.getCase(caseId);
  if (!current) return context.json({ error: "Case not found" }, 404);
  if (input.status === "Closed" && current.status !== "Closed") {
    return context.json(
      {
        error: "Use close workflow",
        detail: "Closing a case requires the Close Case workflow so required documents, tasks, and audit logs are checked."
      },
      400
    );
  }
  const record = await repo.updateCase(caseId, input as never);
  if (!record) return context.json({ error: "Case not found" }, 404);
  await repo.createAuditLog({
    action: "case.updated",
    entityType: "case",
    entityId: record.caseId,
    user,
    metadata: {
      caseNumber: record.caseNumber,
      status: record.status,
      caseTypeCode: record.caseTypeCode,
      customerOrganizationId: record.customerOrganizationId
    }
  });
  return context.json(record);
});

app.post("/cases/:id/close", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "case");
  const repo = context.get("repo");
  const caseId = context.req.param("id");
  const input = closeCaseSchema.parse(await context.req.json());
  const current = await repo.getCase(caseId);
  if (!current) return context.json({ error: "Case not found" }, 404);
  const objectLabel = current.caseTypeCode.startsWith("md3_") ? "service" : "case";
  const completionVerb = objectLabel === "service" ? "complete" : "close";
  const completedAdjective = objectLabel === "service" ? "complete" : "closed";

  const readiness = await buildCaseReadiness(repo, caseId);
  const blockers = closeBlockers(readiness);

  if (current.status === "Closed") {
    return context.json({
      ok: true,
      case: current,
      readiness,
      blockers,
      forced: false,
      message: `This ${objectLabel} is already ${completedAdjective}.`
    });
  }

  if (!readiness.canClose && !input.force) {
    await createAuditLogBestEffort(repo, {
      action: "case.close_blocked",
      entityType: "case",
      entityId: current.caseId,
      user,
      metadata: {
        caseNumber: current.caseNumber,
        blockers
      }
    });
    return context.json({
      ok: false,
      case: current,
      readiness,
      blockers,
      forced: false,
      message: `Resolve the blockers before ${completionVerb === "complete" ? "completion" : "closing"}, or ${completionVerb} with an exception reason.`
    });
  }

  if (!readiness.canClose && input.force && input.reason.length < 8) {
    return context.json({
      ok: false,
      case: current,
      readiness,
      blockers,
      forced: true,
      message: `An exception reason is required to ${completionVerb} a ${objectLabel} with blockers.`
    });
  }

  const closed = await repo.updateCase(caseId, { status: "Closed" });
  if (!closed) return context.json({ error: "Case not found" }, 404);

  if (!readiness.canClose && input.force) {
    await repo.createNote({
      caseId,
      body: `${objectLabel === "service" ? "Forced completion" : "Forced close"} approved by ${user.name}: ${input.reason}`,
      createdBy: user.userId
    });
  }

  await repo.createAuditLog({
    action: "case.closed",
    entityType: "case",
    entityId: closed.caseId,
    user,
    metadata: {
      caseNumber: closed.caseNumber,
      forced: !readiness.canClose && input.force,
      reason: input.reason || undefined,
      missingDocumentCategories: readiness.missingDocumentCategories,
      openTaskIds: readiness.openTasks.map((task) => task.taskId)
    }
  });

  return context.json({
    ok: true,
    case: closed,
    readiness,
    blockers,
    forced: !readiness.canClose && input.force,
    message:
      !readiness.canClose && input.force
        ? `${objectLabel === "service" ? "Service completed" : "Case closed"} with an exception reason.`
        : `${objectLabel === "service" ? "Service completed" : "Case closed"} after readiness verification.`
  });
});

app.delete("/cases/:id", async (context) => {
  const user = context.get("user");
  requirePermission(user, "delete", "case");
  const repo = context.get("repo");
  const caseId = context.req.param("id");
  const input = archiveCaseSchema.parse(await context.req.json().catch(() => ({})));
  const current = await repo.getCase(caseId);
  if (!current) return context.json({ error: "Case not found" }, 404);
  const objectLabel = current.caseTypeCode.startsWith("md3_") ? "Service" : "Case";

  const archived = await repo.softDeleteCase(caseId);
  if (!archived) return context.json({ error: "Case not found" }, 404);

  await repo.createNote({
    caseId,
    body: input.reason ? `${objectLabel} archived by ${user.name}: ${input.reason}` : `${objectLabel} archived by ${user.name}.`,
    createdBy: user.userId
  });

  await repo.createAuditLog({
    action: "case.archived",
    entityType: "case",
    entityId: archived.caseId,
    user,
    metadata: {
      caseNumber: archived.caseNumber,
      propertyAddress: archived.propertyAddress,
      reason: input.reason || undefined
    }
  });

  return context.json(archived);
});

app.post("/cases/:id/restore", async (context) => {
  const user = context.get("user");
  requirePermission(user, "delete", "case");
  const repo = context.get("repo");
  const caseId = context.req.param("id");
  const input = archiveCaseSchema.parse(await context.req.json().catch(() => ({})));
  const current = await repo.getCase(caseId, { includeArchived: true });
  if (!current) return context.json({ error: "Case not found" }, 404);
  if (!current.deletedAt) return context.json(current);
  const objectLabel = current.caseTypeCode.startsWith("md3_") ? "Service" : "Case";

  const restored = await repo.restoreCase(caseId);
  if (!restored) return context.json({ error: "Case not found" }, 404);

  await repo.createNote({
    caseId,
    body: input.reason ? `${objectLabel} restored by ${user.name}: ${input.reason}` : `${objectLabel} restored by ${user.name}.`,
    createdBy: user.userId
  });

  await repo.createAuditLog({
    action: "case.restored",
    entityType: "case",
    entityId: restored.caseId,
    user,
    metadata: {
      caseNumber: restored.caseNumber,
      propertyAddress: restored.propertyAddress,
      archivedAt: current.deletedAt,
      reason: input.reason || undefined
    }
  });

  return context.json(restored);
});

app.get("/party-organizations", async (context) => {
  requirePermission(context.get("user"), "view", "contact");
  const query = context.req.query();
  return context.json(
    await context.get("repo").listPartyOrganizations({
      q: query.q,
      email: query.email as never,
      phone: query.phone as never,
      website: query.website as never,
      contacts: query.contacts as never,
      services: query.services as never,
      assets: query.assets as never,
      communications: query.communications as never,
      sort: query.sort as never,
      direction: query.direction as never
    })
  );
});

app.get("/party-organizations/page", async (context) => {
  requirePermission(context.get("user"), "view", "contact");
  const query = context.req.query();
  return context.json(
    await context.get("repo").listPartyOrganizationsPage(
      {
        q: query.q,
        email: query.email as never,
        phone: query.phone as never,
        website: query.website as never,
        contacts: query.contacts as never,
        services: query.services as never,
        assets: query.assets as never,
        communications: query.communications as never,
        sort: query.sort as never,
        direction: query.direction as never
      },
      paginationFromQuery(query)
    )
  );
});

app.post("/party-organizations/bulk", async (context) => {
  const user = context.get("user");
  requirePermission(user, "delete", "contact");
  const repo = context.get("repo");
  const input = organizationBulkActionSchema.parse(await context.req.json());
  const failed: Array<{ id: string; error: string }> = [];
  let succeeded = 0;
  for (const id of input.partyOrganizationIds) {
    try {
      const record = await repo.softDeletePartyOrganization(id);
      if (!record) failed.push({ id, error: "Organization not found" });
      else succeeded += 1;
    } catch (error) {
      failed.push({ id, error: error instanceof Error ? error.message : "Unable to delete organization" });
    }
  }
  await repo.createAuditLog({
    action: "party_organization.bulk_delete",
    entityType: "party_organization",
    entityId: input.partyOrganizationIds[0],
    user,
    metadata: { requested: input.partyOrganizationIds.length, succeeded, failed }
  });
  return context.json({ requested: input.partyOrganizationIds.length, succeeded, failed });
});

app.get("/party-organizations/:id/contacts", async (context) => {
  requirePermission(context.get("user"), "view", "contact");
  return context.json(await context.get("repo").listPartyOrganizationContacts(context.req.param("id")));
});

app.get("/party-organizations/:id/cases", async (context) => {
  requirePermission(context.get("user"), "view", "case");
  return context.json(await context.get("repo").listPartyOrganizationCases(context.req.param("id")));
});

app.get("/party-organizations/:id", async (context) => {
  requirePermission(context.get("user"), "view", "contact");
  const record = await context.get("repo").getPartyOrganization(context.req.param("id"));
  if (!record) return context.json({ error: "Organization not found" }, 404);
  return context.json(record);
});

app.post("/party-organizations", async (context) => {
  const user = context.get("user");
  requirePermission(user, "create", "contact");
  const repo = context.get("repo");
  let record;
  try {
    record = await repo.createPartyOrganization(partyOrganizationInputSchema.parse(await context.req.json()));
  } catch (error) {
    if (isPartyOrganizationNameConflict(error)) {
      return context.json(
        {
          error: "Organization already exists",
          detail: "An active organization with this name already exists."
        },
        409
      );
    }
    throw error;
  }
  await repo.createAuditLog({
    action: "party_organization.created",
    entityType: "party_organization",
    entityId: record.partyOrganizationId,
    user,
    metadata: { name: record.name, type: record.type }
  });
  return context.json(record, 201);
});

app.patch("/party-organizations/:id", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "contact");
  const repo = context.get("repo");
  let record;
  try {
    record = await repo.updatePartyOrganization(
      context.req.param("id"),
      partyOrganizationInputSchema.partial().parse(await context.req.json())
    );
  } catch (error) {
    if (isPartyOrganizationNameConflict(error)) {
      return context.json(
        {
          error: "Organization already exists",
          detail: "An active organization with this name already exists."
        },
        409
      );
    }
    throw error;
  }
  if (!record) return context.json({ error: "Organization not found" }, 404);
  await repo.createAuditLog({
    action: "party_organization.updated",
    entityType: "party_organization",
    entityId: record.partyOrganizationId,
    user,
    metadata: { name: record.name, type: record.type }
  });
  return context.json(record);
});

app.delete("/party-organizations/:id", async (context) => {
  const user = context.get("user");
  requirePermission(user, "delete", "contact");
  const repo = context.get("repo");
  const partyOrganizationId = context.req.param("id");
  const current = await repo.getPartyOrganization(partyOrganizationId);
  if (!current) return context.json({ error: "Organization not found" }, 404);
  const [contacts, cases] = await Promise.all([
    repo.listPartyOrganizationContacts(partyOrganizationId),
    repo.listPartyOrganizationCases(partyOrganizationId)
  ]);
  const deleted = await repo.softDeletePartyOrganization(partyOrganizationId);
  if (!deleted) return context.json({ error: "Organization not found" }, 404);
  await repo.createAuditLog({
    action: "party_organization.deleted",
    entityType: "party_organization",
    entityId: partyOrganizationId,
    user,
    metadata: {
      name: current.name,
      type: current.type,
      contactCount: contacts.length,
      relatedCaseCount: cases.length
    }
  });
  return context.json(deleted);
});

app.get("/assets", async (context) => {
  requirePermission(context.get("user"), "view", "asset");
  const query = context.req.query();
  return context.json(
    await context.get("repo").listAssets({
      q: query.q,
      type: query.type,
      status: query.status,
      partyOrganizationId: query.partyOrganizationId,
      caseId: query.caseId,
      parentAssetId: query.parentAssetId,
      organization: assetRelationshipFilter(query.organization),
      service: assetRelationshipFilter(query.service),
      parent: assetRelationshipFilter(query.parent),
      credentials: assetCredentialFilter(query.credentials),
      identifiers: assetIdentifierFilter(query.identifiers),
      sort: assetSortFilter(query.sort),
      direction: sortDirectionFilter(query.direction)
    })
  );
});

app.get("/assets/page", async (context) => {
  requirePermission(context.get("user"), "view", "asset");
  const query = context.req.query();
  return context.json(
    await context.get("repo").listAssetsPage(
      {
        q: query.q,
        type: query.type,
        status: query.status,
        partyOrganizationId: query.partyOrganizationId,
        caseId: query.caseId,
        parentAssetId: query.parentAssetId,
        organization: assetRelationshipFilter(query.organization),
        service: assetRelationshipFilter(query.service),
        parent: assetRelationshipFilter(query.parent),
        credentials: assetCredentialFilter(query.credentials),
        identifiers: assetIdentifierFilter(query.identifiers),
        sort: assetSortFilter(query.sort),
        direction: sortDirectionFilter(query.direction)
      },
      paginationFromQuery(query)
    )
  );
});

app.post("/assets/bulk", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "asset");
  const repo = context.get("repo");
  const input = assetBulkActionSchema.parse(await context.req.json());
  if (input.action === "set-status" && !input.status) return context.json({ error: "Status is required" }, 400);
  if (input.action === "set-type" && !input.assetType) return context.json({ error: "Asset type is required" }, 400);
  const result: BulkActionResult = { requested: input.assetIds.length, succeeded: 0, failed: [] };
  for (const assetId of input.assetIds) {
    try {
      const current = await repo.getAsset(assetId);
      if (!current) throw new Error("Asset not found");
      await repo.updateAsset(assetId, {
        status: input.action === "set-status" ? input.status : undefined,
        assetType: input.action === "set-type" ? input.assetType : undefined,
        updatedBy: user.userId
      });
      result.succeeded += 1;
    } catch (error) {
      result.failed.push({ id: assetId, error: error instanceof Error ? error.message : "Bulk asset action failed" });
    }
  }
  await repo.createAuditLog({
    action: "asset.bulk_action",
    entityType: "asset",
    entityId: input.assetIds[0] ?? "bulk",
    user,
    metadata: { action: input.action, requested: result.requested, succeeded: result.succeeded, failed: result.failed.length }
  });
  return context.json(result);
});

app.post("/assets", async (context) => {
  const user = context.get("user");
  requirePermission(user, "create", "asset");
  const repo = context.get("repo");
  const input = assetInputSchema.parse(await context.req.json());
  const record = await repo.createAsset({ ...input, createdBy: user.userId, updatedBy: user.userId });
  await repo.createAuditLog({
    action: "asset.created",
    entityType: "asset",
    entityId: record.assetId,
    user,
    metadata: {
      name: record.name,
      assetType: record.assetType,
      partyOrganizationId: record.partyOrganizationId,
      caseId: record.caseId,
      parentAssetId: record.parentAssetId
    }
  });
  return context.json(record, 201);
});

app.get("/assets/:id", async (context) => {
  requirePermission(context.get("user"), "view", "asset");
  const record = await context.get("repo").getAsset(context.req.param("id"));
  if (!record) return context.json({ error: "Asset not found" }, 404);
  return context.json(record);
});

app.get("/assets/:id/documents", async (context) => {
  const user = context.get("user");
  requirePermission(user, "view", "asset");
  requirePermission(user, "view", "document");
  const repo = context.get("repo");
  const assetId = context.req.param("id");
  const asset = await repo.getAsset(assetId);
  if (!asset) return context.json({ error: "Asset not found" }, 404);
  return context.json(await repo.listAssetDocumentLinks(assetId));
});

app.post("/assets/:id/documents", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "asset");
  requirePermission(user, "view", "document");
  const repo = context.get("repo");
  const assetId = context.req.param("id");
  const asset = await repo.getAsset(assetId);
  if (!asset) return context.json({ error: "Asset not found" }, 404);
  const input = assetDocumentLinkSchema.parse(await context.req.json());
  const document = await repo.getDocument(input.documentId);
  if (!document || document.deletedAt) return context.json({ error: "Document not found" }, 404);
  if (document.isCurrentVersion === false) {
    return context.json({ error: "Only the current version can be linked as an asset core document." }, 409);
  }
  if (asset.caseId && document.caseId && asset.caseId !== document.caseId) {
    return context.json({ error: "Document belongs to a different service than this asset." }, 409);
  }
  const record = await repo.linkAssetDocument({
    assetId,
    documentId: input.documentId,
    relationship: input.relationship,
    note: input.note,
    isPinned: input.isPinned,
    sortOrder: input.sortOrder,
    createdBy: user.userId,
    updatedBy: user.userId
  });
  await repo.createAuditLog({
    action: "asset_document.linked",
    entityType: "asset",
    entityId: assetId,
    user,
    metadata: {
      assetName: asset.name,
      documentId: document.documentId,
      fileName: document.originalFileName,
      relationship: record.relationship,
      isPinned: record.isPinned
    }
  });
  return context.json(record, 201);
});

app.patch("/assets/:id", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "asset");
  const repo = context.get("repo");
  const input = assetUpdateSchema.parse(await context.req.json());
  const record = await repo.updateAsset(context.req.param("id"), { ...input, updatedBy: user.userId });
  if (!record) return context.json({ error: "Asset not found" }, 404);
  await repo.createAuditLog({
    action: "asset.updated",
    entityType: "asset",
    entityId: record.assetId,
    user,
    metadata: {
      name: record.name,
      assetType: record.assetType,
      status: record.status,
      partyOrganizationId: record.partyOrganizationId,
      caseId: record.caseId,
      parentAssetId: record.parentAssetId
    }
  });
  return context.json(record);
});

app.delete("/assets/:id", async (context) => {
  const user = context.get("user");
  requirePermission(user, "delete", "asset");
  const repo = context.get("repo");
  const assetId = context.req.param("id");
  const current = await repo.getAsset(assetId);
  if (!current) return context.json({ error: "Asset not found" }, 404);
  const deleted = await repo.softDeleteAsset(assetId);
  if (!deleted) return context.json({ error: "Asset not found" }, 404);
  await repo.createAuditLog({
    action: "asset.deleted",
    entityType: "asset",
    entityId: assetId,
    user,
    metadata: {
      name: current.name,
      assetType: current.assetType,
      partyOrganizationId: current.partyOrganizationId,
      caseId: current.caseId,
      parentAssetId: current.parentAssetId,
      credentialCount: current.credentialCount
    }
  });
  return context.json(deleted);
});

app.patch("/asset-document-links/:id", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "asset");
  const repo = context.get("repo");
  const assetDocumentLinkId = context.req.param("id");
  const current = await repo.getAssetDocumentLink(assetDocumentLinkId);
  if (!current) return context.json({ error: "Asset document link not found" }, 404);
  const input = assetDocumentLinkUpdateSchema.parse(await context.req.json());
  const record = await repo.updateAssetDocumentLink(assetDocumentLinkId, { ...input, updatedBy: user.userId });
  if (!record) return context.json({ error: "Asset document link not found" }, 404);
  await repo.createAuditLog({
    action: "asset_document.updated",
    entityType: "asset",
    entityId: current.assetId,
    user,
    metadata: {
      documentId: current.documentId,
      fileName: current.document.originalFileName,
      relationship: record.relationship,
      isPinned: record.isPinned
    }
  });
  return context.json(record);
});

app.delete("/asset-document-links/:id", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "asset");
  const repo = context.get("repo");
  const assetDocumentLinkId = context.req.param("id");
  const current = await repo.getAssetDocumentLink(assetDocumentLinkId);
  if (!current) return context.json({ error: "Asset document link not found" }, 404);
  const deleted = await repo.deleteAssetDocumentLink(assetDocumentLinkId);
  if (!deleted) return context.json({ error: "Asset document link not found" }, 404);
  await repo.createAuditLog({
    action: "asset_document.deleted",
    entityType: "asset",
    entityId: current.assetId,
    user,
    metadata: {
      documentId: current.documentId,
      fileName: current.document.originalFileName,
      relationship: current.relationship
    }
  });
  return context.json(deleted);
});

app.get("/assets/:id/credentials", async (context) => {
  requirePermission(context.get("user"), "view", "credential");
  const repo = context.get("repo");
  const assetId = context.req.param("id");
  const asset = await repo.getAsset(assetId);
  if (!asset) return context.json({ error: "Asset not found" }, 404);
  return context.json(await repo.listAssetCredentials(assetId));
});

app.post("/assets/:id/credentials", async (context) => {
  const user = context.get("user");
  requirePermission(user, "create", "credential");
  const repo = context.get("repo");
  const assetId = context.req.param("id");
  const asset = await repo.getAsset(assetId);
  if (!asset) return context.json({ error: "Asset not found" }, 404);
  const input = credentialInputSchema.parse(await context.req.json());
  const record = await repo.createAssetCredential({
    assetId,
    label: input.label,
    credentialType: input.credentialType,
    username: input.username,
    loginUrl: input.loginUrl,
    host: input.host,
    notes: input.notes,
    encryptedSecret: await encryptCredentialText(input.secret, context.env),
    encryptedPrivateNotes: await encryptCredentialText(input.privateNotes, context.env),
    lastVerifiedAt: input.lastVerifiedAt,
    rotationDueAt: input.rotationDueAt,
    createdBy: user.userId,
    updatedBy: user.userId
  });
  await repo.createAuditLog({
    action: "credential.created",
    entityType: "credential",
    entityId: record.credentialId,
    user,
    metadata: {
      assetId,
      caseId: asset.caseId,
      assetName: asset.name,
      label: record.label,
      credentialType: record.credentialType
    }
  });
  return context.json(record, 201);
});

app.patch("/asset-credentials/:id", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "credential");
  const repo = context.get("repo");
  const credentialId = context.req.param("id");
  const current = await repo.getAssetCredential(credentialId);
  if (!current) return context.json({ error: "Credential not found" }, 404);
  const input = credentialUpdateSchema.parse(await context.req.json());
  const record = await repo.updateAssetCredential(credentialId, {
    ...input,
    encryptedSecret:
      Object.prototype.hasOwnProperty.call(input, "secret") && input.secret !== undefined
        ? await encryptCredentialText(input.secret, context.env)
        : undefined,
    encryptedPrivateNotes:
      Object.prototype.hasOwnProperty.call(input, "privateNotes") && input.privateNotes !== undefined
        ? await encryptCredentialText(input.privateNotes, context.env)
        : undefined,
    updatedBy: user.userId
  });
  if (!record) return context.json({ error: "Credential not found" }, 404);
  await repo.createAuditLog({
    action: "credential.updated",
    entityType: "credential",
    entityId: credentialId,
    user,
    metadata: {
      assetId: current.assetId,
      caseId: current.caseId,
      label: record.label,
      credentialType: record.credentialType,
      secretChanged: Object.prototype.hasOwnProperty.call(input, "secret"),
      privateNotesChanged: Object.prototype.hasOwnProperty.call(input, "privateNotes")
    }
  });
  return context.json(record);
});

app.delete("/asset-credentials/:id", async (context) => {
  const user = context.get("user");
  requirePermission(user, "delete", "credential");
  const repo = context.get("repo");
  const credentialId = context.req.param("id");
  const current = await repo.getAssetCredential(credentialId);
  if (!current) return context.json({ error: "Credential not found" }, 404);
  const deleted = await repo.softDeleteAssetCredential(credentialId);
  if (!deleted) return context.json({ error: "Credential not found" }, 404);
  await repo.createAuditLog({
    action: "credential.deleted",
    entityType: "credential",
    entityId: credentialId,
    user,
    metadata: {
      assetId: current.assetId,
      caseId: current.caseId,
      label: current.label,
      credentialType: current.credentialType
    }
  });
  return context.json(deleted);
});

async function revealCredential(
  repo: AppRepository,
  credentialId: string,
  env: AppEnv,
  user: PublicUser,
  action: "credential.revealed" | "credential.copied"
) {
  requireCredentialRevealPermission(user);
  const credential = await repo.getAssetCredential(credentialId);
  if (!credential) return null;
  const [secret, privateNotes] = await Promise.all([
    decryptCredentialText(
      {
        encryptedValue: credential.encryptedSecret,
        iv: credential.secretIv,
        tag: credential.secretTag
      },
      env
    ),
    decryptCredentialText(
      {
        encryptedValue: credential.encryptedPrivateNotes,
        iv: credential.privateNotesIv,
        tag: credential.privateNotesTag
      },
      env
    )
  ]);
  await repo.createAuditLog({
    action,
    entityType: "credential",
    entityId: credential.credentialId,
    user,
    metadata: {
      assetId: credential.assetId,
      caseId: credential.caseId,
      label: credential.label,
      credentialType: credential.credentialType
    }
  });
  return { credentialId: credential.credentialId, secret, privateNotes, revealedAt: new Date().toISOString() };
}

app.post("/asset-credentials/:id/reveal", async (context) => {
  const result = await revealCredential(
    context.get("repo"),
    context.req.param("id"),
    context.env,
    context.get("user"),
    "credential.revealed"
  );
  if (!result) return context.json({ error: "Credential not found" }, 404);
  return context.json(result);
});

app.post("/asset-credentials/:id/copy", async (context) => {
  const result = await revealCredential(
    context.get("repo"),
    context.req.param("id"),
    context.env,
    context.get("user"),
    "credential.copied"
  );
  if (!result) return context.json({ error: "Credential not found" }, 404);
  return context.json(result);
});

app.get("/contacts", async (context) => {
  requirePermission(context.get("user"), "view", "contact");
  const query = context.req.query();
  return context.json(
    await context.get("repo").listContacts({
      q: query.q,
      partyOrganizationId: query.partyOrganizationId,
      email: query.email as never,
      phone: query.phone as never,
      services: query.services as never,
      communications: query.communications as never,
      sort: query.sort as never,
      direction: query.direction as never
    })
  );
});

app.get("/contacts/page", async (context) => {
  requirePermission(context.get("user"), "view", "contact");
  const query = context.req.query();
  return context.json(
    await context.get("repo").listContactsPage(
      {
        q: query.q,
        partyOrganizationId: query.partyOrganizationId,
        email: query.email as never,
        phone: query.phone as never,
        services: query.services as never,
        communications: query.communications as never,
        sort: query.sort as never,
        direction: query.direction as never
      },
      paginationFromQuery(query)
    )
  );
});

app.post("/contacts/bulk", async (context) => {
  const user = context.get("user");
  const repo = context.get("repo");
  const input = contactBulkActionSchema.parse(await context.req.json());
  if (input.action === "delete") requirePermission(user, "delete", "contact");
  else requirePermission(user, "edit", "contact");
  if (input.action === "set-organization" && !input.partyOrganizationId) {
    return context.json({ error: "Organization is required" }, 400);
  }
  const failed: Array<{ id: string; error: string }> = [];
  let succeeded = 0;
  for (const id of input.contactIds) {
    try {
      const record =
        input.action === "delete"
          ? await repo.deleteContact(id)
          : await repo.updateContact(id, {
              partyOrganizationId: input.action === "clear-organization" ? null : input.partyOrganizationId ?? null
            });
      if (!record) failed.push({ id, error: "Contact not found" });
      else succeeded += 1;
    } catch (error) {
      failed.push({ id, error: error instanceof Error ? error.message : "Unable to update contact" });
    }
  }
  await repo.createAuditLog({
    action: `contact.bulk_${input.action.replace(/-/g, "_")}`,
    entityType: "contact",
    entityId: input.contactIds[0],
    user,
    metadata: {
      requested: input.contactIds.length,
      succeeded,
      failed,
      partyOrganizationId: input.partyOrganizationId ?? null
    }
  });
  return context.json({ requested: input.contactIds.length, succeeded, failed });
});

app.get("/contacts/:id/cases", async (context) => {
  requirePermission(context.get("user"), "view", "case");
  return context.json(await context.get("repo").listContactCases(context.req.param("id")));
});

app.get("/contacts/:id", async (context) => {
  requirePermission(context.get("user"), "view", "contact");
  const record = await context.get("repo").getContact(context.req.param("id"));
  if (!record) return context.json({ error: "Contact not found" }, 404);
  return context.json(record);
});

app.post("/contacts", async (context) => {
  const user = context.get("user");
  requirePermission(user, "create", "contact");
  const input = normalizeContactInput(contactInputSchema.parse(await context.req.json()), true);
  const record = await context.get("repo").createContact(input);
  await context.get("repo").createAuditLog({
    action: "contact.created",
    entityType: "contact",
    entityId: record.contactId,
    user,
    metadata: { name: contactDisplayName(record) }
  });
  return context.json(record, 201);
});

app.patch("/contacts/:id", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "contact");
  const input = normalizeContactInput(contactInputSchema.partial().parse(await context.req.json()), false);
  const record = await context
    .get("repo")
    .updateContact(context.req.param("id"), input);
  if (!record) return context.json({ error: "Contact not found" }, 404);
  await context.get("repo").createAuditLog({
    action: "contact.updated",
    entityType: "contact",
    entityId: record.contactId,
    user,
    metadata: { name: contactDisplayName(record) }
  });
  return context.json(record);
});

app.delete("/contacts/:id", async (context) => {
  const user = context.get("user");
  requirePermission(user, "delete", "contact");
  const repo = context.get("repo");
  const contactId = context.req.param("id");
  const record = await repo.getContact(contactId);
  if (!record) return context.json({ error: "Contact not found" }, 404);
  const relatedCases = await repo.listContactCases(contactId);
  const deleted = await repo.deleteContact(contactId);
  if (!deleted) return context.json({ error: "Contact not found" }, 404);
  await repo.createAuditLog({
    action: "contact.deleted",
    entityType: "contact",
    entityId: contactId,
    user,
    metadata: {
      name: contactDisplayName(record),
      relatedCaseCount: relatedCases.length
    }
  });
  return context.json(deleted);
});

app.get("/cases/:id/contacts", async (context) => {
  requirePermission(context.get("user"), "view", "contact");
  return context.json(await context.get("repo").listCaseContacts(context.req.param("id")));
});

app.post("/cases/:id/contacts", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "case");
  const input = z.object({ contactId: z.string(), role: contactRoleSchema }).parse(await context.req.json());
  await requireActiveCase(context.get("repo"), context.req.param("id"));
  const record = await context.get("repo").addCaseContact(context.req.param("id"), input.contactId, input.role);
  await context.get("repo").createAuditLog({
    action: "case_contact.added",
    entityType: "case",
    entityId: context.req.param("id"),
    user,
    metadata: { contactId: input.contactId, role: input.role }
  });
  return context.json(record, 201);
});

app.delete("/cases/:id/contacts/:contactId", async (context) => {
  const user = context.get("user");
  const repo = context.get("repo");
  const caseId = context.req.param("id");
  const contactId = context.req.param("contactId");
  const role = contactRoleSchema.safeParse(context.req.query("role"));
  if (!role.success) return context.json({ error: "A valid party role is required" }, 400);
  requirePermission(user, "edit", "case");
  await requireActiveCase(repo, caseId);
  const existing = (await repo.listCaseContacts(caseId)).find(
    (item) => item.contactId === contactId && item.role === role.data
  );
  const removed = await repo.removeCaseContact(caseId, contactId, role.data);
  if (!removed) return context.json({ error: "Party relationship not found" }, 404);
  await repo.createAuditLog({
    action: "case_contact.removed",
    entityType: "case",
    entityId: caseId,
    user,
    metadata: {
      contactId,
      role: role.data,
      contactName: existing ? contactDisplayName(existing.contact) : undefined
    }
  });
  return context.json({ ok: true });
});

app.get("/private-vault", async (context) => {
  const user = context.get("user");
  const vault = await context.get("repo").getPrivateVaultByOwner(user.userId);
  return context.json({ vault: vault ? privateVaultResponse(vault) : null });
});

app.post("/private-vault", async (context) => {
  const user = context.get("user");
  const repo = context.get("repo");
  if (await repo.getPrivateVaultByOwner(user.userId)) {
    return context.json({ error: "This account already has a private vault." }, 409);
  }
  const input = privateVaultCreateSchema.parse(await context.req.json());
  const vaultId = crypto.randomUUID();
  const recoveryEncryptedVaultKey = await wrapPrivateVaultRecoveryKey(
    input.recoveryVaultKey,
    vaultId,
    user.userId,
    context.env
  );
  const vault = await repo.createPrivateVault({
    vaultId,
    ownerUserId: user.userId,
    ...input.metadata,
    recoveryEncryptedVaultKey,
    autoLockMinutes: 10
  });
  await repo.createAuditLog({
    action: "private_vault.created",
    entityType: "private_vault",
    entityId: vault.vaultId,
    user,
    metadata: { encryptionVersion: vault.encryptionVersion }
  });
  return context.json({ vault: privateVaultResponse(vault) }, 201);
});

app.patch("/private-vault/key", async (context) => {
  const user = context.get("user");
  const metadata = privateVaultPasswordMetadataSchema.parse(await context.req.json());
  const vault = await context.get("repo").updatePrivateVaultPassword(user.userId, metadata);
  if (!vault) return context.json({ error: "Private vault not found" }, 404);
  await context.get("repo").createAuditLog({
    action: "private_vault.password_changed",
    entityType: "private_vault",
    entityId: vault.vaultId,
    user
  });
  return context.json({ vault: privateVaultResponse(vault) });
});

app.post("/private-vault/reset-password", async (context) => {
  const user = context.get("user");
  const repo = context.get("repo");
  const input = privateVaultPasswordResetSchema.parse(await context.req.json());
  const credential = await repo.getUserCredential(user.userId);
  const expectedPassword = credential ? "" : expectedDemoPassword(user.email, context.env);
  const accountPasswordMatches = credential
    ? await verifyPassword(input.currentAccountPassword, credential)
    : Boolean(expectedPassword && input.currentAccountPassword === expectedPassword);
  if (!accountPasswordMatches) {
    await repo.createAuditLog({
      action: "private_vault.password_reset_failed",
      entityType: "private_vault",
      entityId: user.userId,
      user,
      metadata: { reason: "account_password_mismatch" }
    });
    return context.json({ error: "Current account password is incorrect." }, 400);
  }
  const vault = await repo.getPrivateVaultByOwner(user.userId);
  if (!vault) return context.json({ error: "Private vault not found" }, 404);
  const vaultKey = await unwrapPrivateVaultRecoveryKey(
    vault.recoveryEncryptedVaultKey,
    vault.vaultId,
    user.userId,
    context.env
  );
  try {
    const metadata = await createRecoveredPrivateVaultPasswordMetadata(vaultKey, input.newVaultPassword);
    const updated = await repo.updatePrivateVaultPassword(user.userId, metadata);
    if (!updated) return context.json({ error: "Private vault not found" }, 404);
    await repo.createAuditLog({
      action: "private_vault.password_reset",
      entityType: "private_vault",
      entityId: updated.vaultId,
      user,
      metadata: { accountPasswordReverified: true }
    });
    return context.json({ vault: privateVaultResponse(updated) });
  } finally {
    vaultKey.fill(0);
  }
});

app.patch("/private-vault/settings", async (context) => {
  const user = context.get("user");
  const input = privateVaultAutoLockSchema.parse(await context.req.json());
  const vault = await context.get("repo").updatePrivateVaultAutoLock(user.userId, input.autoLockMinutes);
  if (!vault) return context.json({ error: "Private vault not found" }, 404);
  return context.json({ vault: privateVaultResponse(vault) });
});

app.get("/private-vault/folders", async (context) => {
  const user = context.get("user");
  const trash = context.req.query("trash") === "true";
  const folders = await context.get("repo").listPrivateVaultFolders(user.userId, trash);
  return context.json(folders.map(privateVaultFolderResponse));
});

app.post("/private-vault/folders", async (context) => {
  const user = context.get("user");
  const repo = context.get("repo");
  const vault = await repo.getPrivateVaultByOwner(user.userId);
  if (!vault) return context.json({ error: "Create and unlock the private vault before adding folders." }, 404);
  const input = privateVaultFolderInputSchema.parse(await context.req.json());
  const folder = await repo.createPrivateVaultFolder({ ...input, vaultId: vault.vaultId });
  await repo.createAuditLog({
    action: "private_vault.folder_created",
    entityType: "private_vault_folder",
    entityId: folder.folderId,
    user,
    metadata: { vaultId: vault.vaultId }
  });
  return context.json(privateVaultFolderResponse(folder), 201);
});

app.patch("/private-vault/folders/:id", async (context) => {
  const user = context.get("user");
  const input = privateVaultFolderMetadataUpdateSchema.parse(await context.req.json());
  const folder = await context.get("repo").updatePrivateVaultFolderMetadata(
    user.userId,
    context.req.param("id"),
    input.encryptedMetadata
  );
  if (!folder) return context.json({ error: "Private vault folder not found" }, 404);
  return context.json(privateVaultFolderResponse(folder));
});

app.delete("/private-vault/folders/:id", async (context) => {
  const user = context.get("user");
  const folder = await context.get("repo").softDeletePrivateVaultFolder(user.userId, context.req.param("id"));
  if (!folder) return context.json({ error: "Private vault folder not found" }, 404);
  await context.get("repo").createAuditLog({
    action: "private_vault.folder_trashed",
    entityType: "private_vault_folder",
    entityId: folder.folderId,
    user,
    metadata: { vaultId: folder.vaultId }
  });
  return context.json(privateVaultFolderResponse(folder));
});

app.post("/private-vault/folders/:id/restore", async (context) => {
  const user = context.get("user");
  const folder = await context.get("repo").restorePrivateVaultFolder(user.userId, context.req.param("id"));
  if (!folder) return context.json({ error: "Private vault folder not found in trash" }, 404);
  return context.json(privateVaultFolderResponse(folder));
});

app.delete("/private-vault/folders/:id/permanent", async (context) => {
  const user = context.get("user");
  const repo = context.get("repo");
  const existing = await repo.getPrivateVaultFolder(user.userId, context.req.param("id"), true);
  if (!existing?.deletedAt) return context.json({ error: "Move the folder to trash before deleting it permanently." }, 409);
  const folder = await repo.purgePrivateVaultFolder(user.userId, existing.folderId);
  if (!folder) return context.json({ error: "Private vault folder not found" }, 404);
  return context.json({ ok: true });
});

app.get("/private-vault/items", async (context) => {
  const user = context.get("user");
  const trash = context.req.query("trash") === "true";
  const items = await context.get("repo").listPrivateVaultItems(user.userId, trash);
  return context.json(items.map(privateVaultItemResponse));
});

app.post("/private-vault/items", async (context) => {
  const user = context.get("user");
  const repo = context.get("repo");
  const vault = await repo.getPrivateVaultByOwner(user.userId);
  if (!vault) return context.json({ error: "Create and unlock the private vault before uploading files." }, 404);
  const form = await context.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return context.json({ error: "Encrypted file is required" }, 400);
  const fileLimitError = fileSizeLimitError(file, context.env);
  if (fileLimitError) return context.json(fileLimitError, 413);
  const input = z.object({
    itemId: z.string().uuid(),
    encryptionVersion: z.literal(1),
    encryptedMetadata: z.string().min(24).max(32_000).regex(/^pavm1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/),
    wrappedFileKey: z.string().regex(/^pavf1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{64}$/)
  }).parse({
    itemId: String(form.get("itemId") || ""),
    encryptionVersion: Number(form.get("encryptionVersion")),
    encryptedMetadata: String(form.get("encryptedMetadata") || ""),
    wrappedFileKey: String(form.get("wrappedFileKey") || "")
  });
  const encryptedBytes = await file.arrayBuffer();
  if (!isPrivateVaultBlob(encryptedBytes)) {
    return context.json({ error: "The uploaded object is not a supported private vault file." }, 400);
  }
  const objectKey = `private-vault/${vault.vaultId}/${input.itemId}.pav`;
  const item = await repo.createPrivateVaultItem({
    ...input,
    vaultId: vault.vaultId,
    objectKey,
    ciphertextSize: encryptedBytes.byteLength
  });
  try {
    await createDocumentStorage(context.env).put(objectKey, encryptedBytes, PRIVATE_VAULT_BLOB_CONTENT_TYPE);
  } catch (error) {
    await repo.purgePrivateVaultItem(user.userId, item.itemId);
    await cleanupDocumentObject(repo, context.env, objectKey);
    throw error;
  }
  await repo.createAuditLog({
    action: "private_vault.item_uploaded",
    entityType: "private_vault_item",
    entityId: item.itemId,
    user,
    metadata: { vaultId: vault.vaultId, ciphertextSize: item.ciphertextSize }
  });
  return context.json(privateVaultItemResponse(item), 201);
});

app.patch("/private-vault/items", async (context) => {
  const user = context.get("user");
  const input = privateVaultItemMetadataBatchSchema.parse(await context.req.json());
  const items = await context.get("repo").updatePrivateVaultItemMetadataBatch(user.userId, input.updates);
  await context.get("repo").createAuditLog({
    action: "private_vault.items_organized",
    entityType: "private_vault",
    entityId: items[0]?.vaultId ?? user.userId,
    user,
    metadata: { itemCount: items.length }
  });
  return context.json(items.map(privateVaultItemResponse));
});

app.get("/private-vault/items/:id/blob", async (context) => {
  const user = context.get("user");
  const item = await context.get("repo").getPrivateVaultItem(user.userId, context.req.param("id"));
  if (!item) return context.json({ error: "Private vault item not found" }, 404);
  const object = await createDocumentStorage(context.env).get(item.objectKey);
  if (!object) return context.json({ error: "Encrypted file object not found" }, 404);
  await context.get("repo").createAuditLog({
    action: "private_vault.item_opened",
    entityType: "private_vault_item",
    entityId: item.itemId,
    user,
    metadata: { vaultId: item.vaultId }
  });
  return new Response(object.body, {
    headers: {
      "content-type": PRIVATE_VAULT_BLOB_CONTENT_TYPE,
      "cache-control": "no-store, private",
      "content-disposition": "inline; filename=private-vault-item.pav"
    }
  });
});

app.patch("/private-vault/items/:id", async (context) => {
  const user = context.get("user");
  const input = privateVaultItemMetadataUpdateSchema.parse(await context.req.json());
  const item = await context.get("repo").updatePrivateVaultItemMetadata(
    user.userId,
    context.req.param("id"),
    input.encryptedMetadata
  );
  if (!item) return context.json({ error: "Private vault item not found" }, 404);
  return context.json(privateVaultItemResponse(item));
});

app.delete("/private-vault/items/:id", async (context) => {
  const user = context.get("user");
  const item = await context.get("repo").softDeletePrivateVaultItem(user.userId, context.req.param("id"));
  if (!item) return context.json({ error: "Private vault item not found" }, 404);
  await context.get("repo").createAuditLog({
    action: "private_vault.item_trashed",
    entityType: "private_vault_item",
    entityId: item.itemId,
    user,
    metadata: { vaultId: item.vaultId }
  });
  return context.json(privateVaultItemResponse(item));
});

app.post("/private-vault/items/:id/restore", async (context) => {
  const user = context.get("user");
  const item = await context.get("repo").restorePrivateVaultItem(user.userId, context.req.param("id"));
  if (!item) return context.json({ error: "Private vault item not found in trash" }, 404);
  await context.get("repo").createAuditLog({
    action: "private_vault.item_restored",
    entityType: "private_vault_item",
    entityId: item.itemId,
    user,
    metadata: { vaultId: item.vaultId }
  });
  return context.json(privateVaultItemResponse(item));
});

app.delete("/private-vault/items/:id/permanent", async (context) => {
  const user = context.get("user");
  const repo = context.get("repo");
  const existing = await repo.getPrivateVaultItem(user.userId, context.req.param("id"), true);
  if (!existing?.deletedAt) return context.json({ error: "Move the item to trash before deleting it permanently." }, 409);
  const item = await repo.purgePrivateVaultItem(user.userId, existing.itemId);
  if (!item) return context.json({ error: "Private vault item not found" }, 404);
  await cleanupDocumentObject(repo, context.env, item.objectKey);
  await repo.createAuditLog({
    action: "private_vault.item_purged",
    entityType: "private_vault_item",
    entityId: item.itemId,
    user,
    metadata: { vaultId: item.vaultId }
  });
  return context.json({ ok: true });
});

app.get("/archive/folders", async (context) => {
  requirePersonalArchive(context.env);
  requirePermission(context.get("user"), "view", "document");
  const trashed = context.req.query("trashed") === "true";
  const folders = await context.get("repo").listArchiveFolders({ includeDeleted: trashed });
  return context.json(trashed ? folders.filter((folder) => folder.deletedAt) : folders);
});

app.post("/archive/folders", async (context) => {
  requirePersonalArchive(context.env);
  const user = context.get("user");
  requirePermission(user, "edit", "document");
  const input = archiveFolderInputSchema.parse(await context.req.json());
  const repo = context.get("repo");
  try {
    const folder = await repo.createArchiveFolder({
      folderId: crypto.randomUUID(),
      name: input.name,
      parentFolderId: await validatedArchiveFolderId(repo, input.parentFolderId),
      sortOrder: input.sortOrder,
      createdBy: user.userId
    });
    await createAuditLogBestEffort(repo, {
      action: "archive.folder_created",
      entityType: "archive_folder",
      entityId: folder.folderId,
      user,
      metadata: { name: folder.name, parentFolderId: folder.parentFolderId ?? null }
    });
    return context.json(folder, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    return context.json({ error: error instanceof Error ? error.message : "Unable to create folder" }, 409);
  }
});

app.patch("/archive/folders/:id", async (context) => {
  requirePersonalArchive(context.env);
  const user = context.get("user");
  requirePermission(user, "edit", "document");
  const input = archiveFolderUpdateSchema.parse(await context.req.json());
  const repo = context.get("repo");
  try {
    const folder = await repo.updateArchiveFolder(context.req.param("id"), {
      ...input,
      parentFolderId:
        input.parentFolderId === undefined
          ? undefined
          : await validatedArchiveFolderId(repo, input.parentFolderId)
    });
    if (!folder) return context.json({ error: "Archive folder not found" }, 404);
    await createAuditLogBestEffort(repo, {
      action: "archive.folder_updated",
      entityType: "archive_folder",
      entityId: folder.folderId,
      user,
      metadata: { name: folder.name, parentFolderId: folder.parentFolderId ?? null }
    });
    return context.json(folder);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    return context.json({ error: error instanceof Error ? error.message : "Unable to update folder" }, 409);
  }
});

app.post("/archive/folders/:id/restore", async (context) => {
  requirePersonalArchive(context.env);
  const user = context.get("user");
  requirePermission(user, "edit", "document");
  const input = archiveFolderInputSchema.pick({ name: true, parentFolderId: true }).partial().parse(await context.req.json());
  const repo = context.get("repo");
  try {
    const folder = await repo.restoreArchiveFolder(context.req.param("id"), input);
    if (!folder) return context.json({ error: "Restore the deleted folder tree from its root in Archive trash" }, 409);
    await createAuditLogBestEffort(repo, { action: "archive.folder_restored", entityType: "archive_folder", entityId: folder.folderId,
      user, metadata: { name: folder.name, parentFolderId: folder.parentFolderId ?? null } });
    return context.json(folder);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    return context.json({ error: error instanceof Error ? error.message : "Unable to restore folder" }, 409);
  }
});

app.post("/archive/folders/:id/documents/metadata", async (context) => {
  requirePersonalArchive(context.env);
  const user = context.get("user");
  requirePermission(user, "edit", "document");
  const repo = context.get("repo");
  const current = await repo.getArchiveFolder(context.req.param("id"));
  if (!current) return context.json({ error: "Archive folder not found" }, 404);
  const input = archiveFolderMetadataUpdateSchema.parse(await context.req.json());
  const category = input.category === undefined
    ? undefined
    : await validatedDocumentCategory(repo, context.env, input.category);
  if (input.tagIds !== undefined) {
    const existingTagIds = new Set((await repo.listTags()).map((tag) => tag.tagId));
    const unknownTag = input.tagIds.find((tagId) => !existingTagIds.has(tagId));
    if (unknownTag) return context.json({ error: "One or more selected tags no longer exist" }, 409);
  }
  const result = await repo.updateArchiveFolderDocumentsMetadata(
    current.folderId,
    { ...input, category },
    user.userId
  );
  if (!result) return context.json({ error: "Archive folder not found" }, 404);
  const fields = [
    input.category !== undefined ? "category" : null,
    input.reviewStatus !== undefined ? "reviewStatus" : null,
    input.notes !== undefined ? "notes" : null,
    input.reviewNotes !== undefined ? "reviewNotes" : null,
    input.tagIds !== undefined ? "tags" : null
  ].filter(Boolean);
  await createAuditLogBestEffort(repo, {
    action: "archive.folder_metadata_updated",
    entityType: "archive_folder",
    entityId: current.folderId,
    user,
    metadata: {
      name: current.name,
      includeSubfolders: input.includeSubfolders,
      fields,
      folderCount: result.folderCount,
      matched: result.matched,
      updated: result.updated
    }
  });
  return context.json({ ok: true, ...result });
});

app.delete("/archive/folders/:id", async (context) => {
  requirePersonalArchive(context.env);
  const user = context.get("user");
  requirePermission(user, "delete", "document");
  const repo = context.get("repo");
  const current = await repo.getArchiveFolder(context.req.param("id"));
  if (!current) return context.json({ error: "Archive folder not found" }, 404);
  try {
    const result = await repo.deleteArchiveFolder(current.folderId);
    if (!result) return context.json({ error: "Archive folder not found" }, 404);
    await createAuditLogBestEffort(repo, {
      action: "archive.folder_deleted",
      entityType: "archive_folder",
      entityId: current.folderId,
      user,
      metadata: {
        name: current.name,
        deletedFolders: result.deletedFolders,
        trashedDocuments: result.trashedDocuments
      }
    });
    return context.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    return context.json({ error: error instanceof Error ? error.message : "Unable to delete folder" }, 409);
  }
});

app.get("/archive/categories", async (context) => {
  requirePersonalArchive(context.env);
  requirePermission(context.get("user"), "view", "document");
  return context.json(await context.get("repo").listArchiveCategories());
});

app.post("/archive/categories", async (context) => {
  requirePersonalArchive(context.env);
  const user = context.get("user");
  requirePermission(user, "edit", "document");
  const input = archiveCategoryInputSchema.parse(await context.req.json());
  const repo = context.get("repo");
  try {
    const category = await repo.createArchiveCategory({
      categoryId: crypto.randomUUID(),
      name: input.name,
      sortOrder: input.sortOrder,
      createdBy: user.userId
    });
    await createAuditLogBestEffort(repo, {
      action: "archive.category_created",
      entityType: "archive_category",
      entityId: category.categoryId,
      user,
      metadata: { name: category.name }
    });
    return context.json(category, 201);
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message : "Unable to create category" }, 409);
  }
});

app.patch("/archive/categories/:id", async (context) => {
  requirePersonalArchive(context.env);
  const user = context.get("user");
  requirePermission(user, "edit", "document");
  const input = archiveCategoryUpdateSchema.parse(await context.req.json());
  const repo = context.get("repo");
  try {
    const category = await repo.updateArchiveCategory(context.req.param("id"), input);
    if (!category) return context.json({ error: "Archive category not found" }, 404);
    await createAuditLogBestEffort(repo, {
      action: "archive.category_updated",
      entityType: "archive_category",
      entityId: category.categoryId,
      user,
      metadata: { name: category.name }
    });
    return context.json(category);
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message : "Unable to update category" }, 409);
  }
});

app.delete("/archive/categories/:id", async (context) => {
  requirePersonalArchive(context.env);
  const user = context.get("user");
  requirePermission(user, "edit", "document");
  const repo = context.get("repo");
  const current = await repo.getArchiveCategory(context.req.param("id"));
  if (!current) return context.json({ error: "Archive category not found" }, 404);
  const replacementCategoryId = context.req.query("replacementCategoryId") || null;
  try {
    await repo.deleteArchiveCategory(current.categoryId, replacementCategoryId);
    await createAuditLogBestEffort(repo, {
      action: "archive.category_deleted",
      entityType: "archive_category",
      entityId: current.categoryId,
      user,
      metadata: { name: current.name, replacementCategoryId }
    });
    return context.json({ ok: true });
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message : "Unable to delete category" }, 409);
  }
});

app.get("/cases/:id/documents", async (context) => {
  requirePermission(context.get("user"), "view", "document");
  return context.json(
    await context.get("repo").listDocuments(context.req.param("id"), {
      q: context.req.query("q") ?? "",
      category: context.req.query("category") as never
    })
  );
});

app.post("/cases/:id/documents", async (context) => {
  const user = context.get("user");
  requirePermission(user, "upload", "document");
  const repo = context.get("repo");
  await requireActiveCase(repo, context.req.param("id"));
  const limitError = await demoFileLimitResponse(repo, context.env, user, context.req.param("id"));
  if (limitError) return context.json(limitError, 409);
  const form = await context.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return context.json({ error: "File is required" }, 400);
  const fileLimitError = fileSizeLimitError(file, context.env);
  if (fileLimitError) return context.json(fileLimitError, 413);
  const category = await validatedDocumentCategory(repo, context.env, String(form.get("category") || "Other"));
  const notes = String(form.get("notes") || "");
  const tagIds = form.getAll("tagIds").map((value) => String(value)).filter(Boolean);
  const documentId = crypto.randomUUID();
  const fileName = safeFileName(file.name) || `${documentId}.bin`;
  const r2ObjectKey = `cases/${context.req.param("id")}/documents/${documentId}/${fileName}`;
  const storage = createDocumentStorage(context.env);
  const mimeType = uploadContentType(file);
  await storage.put(r2ObjectKey, await file.arrayBuffer(), mimeType);
  try {
    const record = await repo.createDocument({
      documentId,
      caseId: context.req.param("id"),
      fileName,
      originalFileName: file.name,
      fileSize: file.size,
      mimeType,
      category,
      r2ObjectKey,
      uploadedBy: user.userId,
      notes,
      tagIds
    });
    await createAuditLogBestEffort(repo, {
      action: "document.uploaded",
      entityType: "document",
      entityId: record.documentId,
      user,
      metadata: { fileName: record.fileName, category: record.category, reviewStatus: record.reviewStatus }
    });
    return context.json(record, 201);
  } catch (error) {
    await cleanupDocumentObject(repo, context.env, r2ObjectKey);
    throw error;
  }
});

app.get("/documents", async (context) => {
  requirePermission(context.get("user"), "view", "document");
  const query = context.req.query();
  return context.json(
    await context.get("repo").listDocumentsPage(
      {
        caseId: query.caseId,
        assetId: query.assetId,
        partyOrganizationId: query.partyOrganizationId,
        q: query.q ?? "",
        category: query.category as never,
        folderId: query.folderId,
        unfiled: query.unfiled === "true" || query.unfiled === "1",
        trashed: query.trashed === "true" || query.trashed === "1",
        reviewStatus: query.reviewStatus as never,
        tagId: query.tagId,
        uploadedFrom: query.uploadedFrom,
        uploadedTo: query.uploadedTo,
        sort: query.sort as never,
        direction: query.direction as never
      },
      paginationFromQuery(query)
    )
  );
});

app.post("/documents", async (context) => {
  const user = context.get("user");
  requirePermission(user, "upload", "document");
  const repo = context.get("repo");
  const form = await context.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return context.json({ error: "File is required" }, 400);
  const fileLimitError = fileSizeLimitError(file, context.env);
  if (fileLimitError) return context.json(fileLimitError, 413);
  const category = await validatedDocumentCategory(repo, context.env, String(form.get("category") || "Other"));
  const folderId = isPersonalArchive(context.env)
    ? await validatedArchiveFolderId(repo, String(form.get("folderId") || "") || null)
    : null;
  const notes = String(form.get("notes") || "");
  const manuscriptId = isPersonalArchive(context.env) && form.get("manuscriptId")
    ? z.uuid().parse(form.get("manuscriptId")) : null;
  const tagIds = form.getAll("tagIds").map((value) => String(value)).filter(Boolean);
  const documentId = crypto.randomUUID();
  const fileName = safeFileName(file.name) || `${documentId}.bin`;
  const r2ObjectKey = `archive/documents/${documentId}/${fileName}`;
  const storage = createDocumentStorage(context.env);
  const mimeType = uploadContentType(file);
  await storage.put(r2ObjectKey, await file.arrayBuffer(), mimeType);
  try {
    const input = {
      documentId,
      caseId: null,
      fileName,
      originalFileName: file.name,
      fileSize: file.size,
      mimeType,
      category,
      folderId,
      r2ObjectKey,
      uploadedBy: user.userId,
      notes,
      tagIds
    };
    const record = manuscriptId ? await repo.createManuscriptDocument(manuscriptId, input) : await repo.createDocument(input);
    await createAuditLogBestEffort(repo, {
      action: "document.uploaded",
      entityType: "document",
      entityId: record.documentId,
      user,
      metadata: { fileName: record.fileName, category: record.category, archiveDocument: true }
    });
    return context.json(record, 201);
  } catch (error) {
    await cleanupDocumentObject(repo, context.env, r2ObjectKey);
    throw error;
  }
});

app.post("/documents/bulk", async (context) => {
  const user = context.get("user");
  const repo = context.get("repo");
  const input = documentBulkActionSchema.parse(await context.req.json());
  if (input.action === "delete") requirePermission(user, "delete", "document");
  else requirePermission(user, "edit", "document");
  if (input.action === "set-category" && !input.category) return context.json({ error: "Category is required" }, 400);
  if (input.action === "set-review-status" && !input.reviewStatus) {
    return context.json({ error: "Review status is required" }, 400);
  }
  if (input.action === "move-folder") requirePersonalArchive(context.env);
  const category = input.action === "set-category"
    ? await validatedDocumentCategory(repo, context.env, input.category)
    : undefined;
  const folderId = input.action === "move-folder"
    ? await validatedArchiveFolderId(repo, input.folderId)
    : undefined;
  const failed: Array<{ id: string; error: string }> = [];
  let succeeded = 0;
  for (const id of input.documentIds) {
    try {
      const current = input.action === "delete" ? await repo.getDocument(id) : null;
      const record =
        input.action === "delete"
          ? await repo.softDeleteDocument(id, isPersonalArchive(context.env) ? { retainObject: true, entireGroup: true } : {})
          : await repo.updateDocument(id, {
              ...(input.action === "set-category" ? { category } : {}),
              ...(input.action === "move-folder" ? { folderId } : {}),
              ...(input.action === "set-review-status" ? { reviewStatus: input.reviewStatus } : {}),
              reviewedBy: user.userId
            });
      if (!record) failed.push({ id, error: "Document not found" });
      else {
        succeeded += 1;
        if (current && !isPersonalArchive(context.env)) await cleanupDocumentObject(repo, context.env, current.r2ObjectKey);
      }
    } catch (error) {
      failed.push({ id, error: error instanceof Error ? error.message : "Unable to update document" });
    }
  }
  await createAuditLogBestEffort(repo, {
    action: `document.bulk_${input.action.replace(/-/g, "_")}`,
    entityType: "document",
    entityId: input.documentIds[0],
    user,
    metadata: {
      requested: input.documentIds.length,
      succeeded,
      failed,
      category: category ?? null,
      folderId: folderId ?? null,
      reviewStatus: input.reviewStatus ?? null
    }
  });
  return context.json({ requested: input.documentIds.length, succeeded, failed });
});

app.get("/documents/:id/versions", async (context) => {
  requirePermission(context.get("user"), "view", "document");
  const versions = await context.get("repo").listDocumentVersions(context.req.param("id"));
  if (!versions.length) return context.json({ error: "Document not found" }, 404);
  return context.json(versions);
});

app.post("/documents/:id/versions", async (context) => {
  const user = context.get("user");
  requirePermission(user, "upload", "document");
  const repo = context.get("repo");
  const source = await repo.getDocument(context.req.param("id"));
  if (!source) return context.json({ error: "Document not found" }, 404);
  if (source.caseId) await requireActiveCase(repo, source.caseId);

  const form = await context.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return context.json({ error: "File is required" }, 400);
  const fileLimitError = fileSizeLimitError(file, context.env);
  if (fileLimitError) return context.json(fileLimitError, 413);

  const category = await validatedDocumentCategory(repo, context.env, String(form.get("category") || source.category));
  const notes = String(form.get("notes") || "");
  const formTagIds = form.getAll("tagIds").map((value) => String(value)).filter(Boolean);
  const tagIds = formTagIds.length ? formTagIds : source.tags.map((tag) => tag.tagId);
  const documentId = crypto.randomUUID();
  const fileName = safeFileName(file.name) || `${documentId}.bin`;
  const r2ObjectKey = source.caseId
    ? `cases/${source.caseId}/documents/${documentId}/${fileName}`
    : `archive/documents/${documentId}/${fileName}`;
  const storage = createDocumentStorage(context.env);
  const mimeType = uploadContentType(file);
  await storage.put(r2ObjectKey, await file.arrayBuffer(), mimeType);

  try {
    const result = await repo.createDocumentVersion(source.documentId, {
      documentId,
      caseId: source.caseId ?? null,
      fileName,
      originalFileName: file.name,
      fileSize: file.size,
      mimeType,
      category,
      folderId: source.folderId ?? null,
      r2ObjectKey,
      uploadedBy: user.userId,
      notes,
      tagIds
    });
    if (!result) {
      await cleanupDocumentObject(repo, context.env, r2ObjectKey);
      return context.json({ error: "Document not found" }, 404);
    }
    await createAuditLogBestEffort(repo, {
      action: "document.version_uploaded",
      entityType: "document",
      entityId: result.current.documentId,
      user,
      metadata: {
        caseId: source.caseId,
        previousDocumentId: source.documentId,
        documentGroupId: result.current.documentGroupId,
        versionNumber: result.current.versionNumber,
        fileName: result.current.fileName,
        category: result.current.category,
        reviewStatus: result.current.reviewStatus
      }
    });
    return context.json(result, 201);
  } catch (error) {
    await cleanupDocumentObject(repo, context.env, r2ObjectKey);
    throw error;
  }
});

app.get("/documents/:id", async (context) => {
  requirePermission(context.get("user"), "view", "document");
  const document = await context.get("repo").getDocument(context.req.param("id"));
  if (!document) return context.json({ error: "Document not found" }, 404);
  return context.json(document);
});

app.get("/documents/:id/download", async (context) => {
  const user = context.get("user");
  requirePermission(user, "download", "document");
  const document = await context.get("repo").getDocument(context.req.param("id"));
  if (!document) return context.json({ error: "Document not found" }, 404);
  const requestedRange = context.req.header("range");
  const rangeHeader = validSingleByteRange(requestedRange);
  if (requestedRange && !rangeHeader) return rangeNotSatisfiableResponse(new StorageRangeNotSatisfiableError());
  const storage = createDocumentStorage(context.env);
  let object: StoredObject | null;
  try {
    object = await storage.get(document.r2ObjectKey, rangeHeader);
  } catch (error) {
    if (error instanceof StorageRangeNotSatisfiableError) return rangeNotSatisfiableResponse(error);
    throw error;
  }
  if (!object) {
    return context.json({ error: "Stored object not found", detail: "Metadata exists, but the private file object is missing." }, 404);
  }
  if (!rangeHeader || /^bytes=0-/i.test(rangeHeader)) {
    await context.get("repo").createAuditLog({
      action: "document.downloaded",
      entityType: "document",
      entityId: document.documentId,
      user,
      metadata: { fileName: document.fileName }
    });
  }
  return secureDocumentObjectResponse(storage, document.r2ObjectKey, object, rangeHeader, document.originalFileName || document.fileName, "attachment");
});

app.get("/documents/:id/preview", async (context) => {
  const user = context.get("user");
  requirePermission(user, "download", "document");
  const document = await context.get("repo").getDocument(context.req.param("id"));
  if (!document) return previewErrorPage("Document not found", "This document metadata record is no longer available.");
  const requestedRange = context.req.header("range");
  const rangeHeader = validSingleByteRange(requestedRange);
  if (requestedRange && !rangeHeader) return rangeNotSatisfiableResponse(new StorageRangeNotSatisfiableError());
  const storage = createDocumentStorage(context.env);
  let object: StoredObject | null;
  try {
    object = await storage.get(document.r2ObjectKey, rangeHeader);
  } catch (error) {
    if (error instanceof StorageRangeNotSatisfiableError) return rangeNotSatisfiableResponse(error);
    throw error;
  }
  if (!object) {
    return previewErrorPage(
      "Stored file not found",
      "The database metadata exists, but the private file object is missing. Upload a real file or replace this demo metadata before client review."
    );
  }
  if (!rangeHeader || /^bytes=0-/i.test(rangeHeader)) {
    await context.get("repo").createAuditLog({
      action: "document.previewed",
      entityType: "document",
      entityId: document.documentId,
      user,
      metadata: { fileName: document.fileName }
    });
  }
  return secureDocumentObjectResponse(storage, document.r2ObjectKey, object, rangeHeader, document.originalFileName || document.fileName, "inline");
});

app.patch("/documents/:id", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "document");
  const repo = context.get("repo");
  const current = await repo.getDocument(context.req.param("id"));
  if (!current) return context.json({ error: "Document not found" }, 404);
  if (current.caseId) await requireActiveCase(repo, current.caseId);
  const input = documentUpdateSchema.parse(await context.req.json());
  const category = input.category === undefined
    ? undefined
    : await validatedDocumentCategory(repo, context.env, input.category);
  if (input.folderId !== undefined) requirePersonalArchive(context.env);
  const folderId = input.folderId === undefined
    ? undefined
    : await validatedArchiveFolderId(repo, input.folderId);
  const record = await repo.updateDocument(context.req.param("id"), {
    ...input,
    category,
    folderId,
    reviewedBy: user.userId
  });
  if (!record) return context.json({ error: "Document not found" }, 404);
  await repo.createAuditLog({
    action: "document.updated",
    entityType: "document",
    entityId: record.documentId,
    user,
    metadata: {
      fileName: record.fileName,
      category: record.category,
      folderId: record.folderId ?? null,
      reviewStatus: record.reviewStatus
    }
  });
  return context.json(record);
});

app.delete("/documents/:id", async (context) => {
  const user = context.get("user");
  requirePermission(user, "delete", "document");
  const repo = context.get("repo");
  const document = await repo.getDocument(context.req.param("id"));
  if (!document) return context.json({ error: "Document not found" }, 404);
  if (document.caseId) await requireActiveCase(repo, document.caseId);
  const archiveTrash = isPersonalArchive(context.env);
  const deleted = await repo.softDeleteDocument(
    document.documentId,
    archiveTrash ? { retainObject: true, entireGroup: true } : {}
  );
  if (!archiveTrash) await cleanupDocumentObject(repo, context.env, document.r2ObjectKey);
  await createAuditLogBestEffort(repo, {
    action: archiveTrash ? "document.trashed" : "document.deleted",
    entityType: "document",
    entityId: document.documentId,
    user,
    metadata: { fileName: document.fileName }
  });
  return context.json(deleted);
});

app.post("/documents/:id/restore", async (context) => {
  requirePersonalArchive(context.env);
  const user = context.get("user");
  requirePermission(user, "edit", "document");
  const repo = context.get("repo");
  const current = await repo.getDocument(context.req.param("id"), { includeDeleted: true });
  if (!current?.deletedAt) return context.json({ error: "Document not found in Archive trash" }, 404);
  let restored: DocumentRecord | null;
  try {
    restored = await repo.restoreDocument(current.documentId);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    return context.json({ error: error instanceof Error ? error.message : "Unable to restore document" }, 409);
  }
  if (!restored) return context.json({ error: "Unable to restore document" }, 409);
  await createAuditLogBestEffort(repo, {
    action: "document.restored",
    entityType: "document",
    entityId: restored.documentId,
    user,
    metadata: { fileName: restored.fileName, folderId: restored.folderId ?? null }
  });
  return context.json(restored);
});

app.delete("/documents/:id/permanent", async (context) => {
  requirePersonalArchive(context.env);
  const user = context.get("user");
  requirePermission(user, "delete", "document");
  const repo = context.get("repo");
  const current = await repo.getDocument(context.req.param("id"), { includeDeleted: true });
  if (!current?.deletedAt) return context.json({ error: "Document not found in Archive trash" }, 404);
  const purged = await repo.purgeDocument(current.documentId);
  if (!purged.length) return context.json({ error: "Unable to permanently delete document" }, 409);
  for (const version of purged) await cleanupDocumentObject(repo, context.env, version.r2ObjectKey);
  await createAuditLogBestEffort(repo, {
    action: "document.permanently_deleted",
    entityType: "document",
    entityId: current.documentId,
    user,
    metadata: { fileName: current.fileName, versionsDeleted: purged.length }
  });
  return context.json({ ok: true, versionsDeleted: purged.length });
});

app.get("/knowledge", async (context) => {
  const user = context.get("user");
  requirePermission(user, "view", "note");
  const query = context.req.query();
  return context.json(
    await context.get("repo").listKnowledge({
      q: query.q ?? "",
      type: enumQuery(query.type, KNOWLEDGE_TYPES) ?? "",
      status: enumQuery(query.status, KNOWLEDGE_STATUSES) ?? "",
      component: query.component,
      caseId: query.caseId,
      assetId: query.assetId,
      documentId: query.documentId,
      trashed: query.trashed === "true" || query.trashed === "1",
      sort: knowledgeSortFilter(query.sort),
      direction: sortDirectionFilter(query.direction)
    })
  );
});

app.get("/knowledge/page", async (context) => {
  const user = context.get("user");
  requirePermission(user, "view", "note");
  const query = context.req.query();
  return context.json(
    await context.get("repo").listKnowledgePage(
      {
        q: query.q ?? "",
        type: enumQuery(query.type, KNOWLEDGE_TYPES) ?? "",
        status: enumQuery(query.status, KNOWLEDGE_STATUSES) ?? "",
        component: query.component,
        caseId: query.caseId,
        assetId: query.assetId,
        documentId: query.documentId,
        trashed: query.trashed === "true" || query.trashed === "1",
        sort: knowledgeSortFilter(query.sort),
        direction: sortDirectionFilter(query.direction)
      },
      paginationFromQuery(query)
    )
  );
});

app.post("/knowledge", async (context) => {
  const user = context.get("user");
  requirePermission(user, "create", "note");
  const input = knowledgeInputSchema.parse(await context.req.json());
  const record = await context.get("repo").createKnowledge({
    ...input,
    createdBy: user.userId,
    updatedBy: user.userId
  });
  await context.get("repo").createAuditLog({
    action: "knowledge.created",
    entityType: "knowledge",
    entityId: record.knowledgeId,
    user,
    metadata: {
      title: record.title,
      type: record.type,
      status: record.status,
      component: record.component,
      sourceServiceId: record.sourceServiceId
    }
  });
  return context.json(record, 201);
});

app.get("/knowledge/:id", async (context) => {
  const user = context.get("user");
  requirePermission(user, "view", "note");
  const record = await context.get("repo").getKnowledge(context.req.param("id"));
  if (!record) return context.json({ error: "Knowledge item not found" }, 404);
  return context.json(record);
});

app.patch("/knowledge/:id", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "note");
  const input = knowledgeUpdateSchema.parse(await context.req.json());
  const record = await context.get("repo").updateKnowledge(context.req.param("id"), {
    ...input,
    updatedBy: user.userId
  });
  if (!record) return context.json({ error: "Knowledge item not found" }, 404);
  await context.get("repo").createAuditLog({
    action: "knowledge.updated",
    entityType: "knowledge",
    entityId: record.knowledgeId,
    user,
    metadata: {
      title: record.title,
      type: record.type,
      status: record.status,
      component: record.component,
      sourceServiceId: record.sourceServiceId
    }
  });
  return context.json(record);
});

app.delete("/knowledge/:id", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "note");
  const repo = context.get("repo");
  const current = await repo.getKnowledge(context.req.param("id"));
  if (!current) return context.json({ error: "Knowledge item not found" }, 404);
  const deleted = await repo.softDeleteKnowledge(current.knowledgeId);
  await repo.createAuditLog({
    action: "knowledge.trashed",
    entityType: "knowledge",
    entityId: current.knowledgeId,
    user,
    metadata: { title: current.title, type: current.type, status: current.status, component: current.component }
  });
  return context.json(deleted);
});

app.post("/knowledge/:id/restore", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "note");
  const repo = context.get("repo");
  const current = await repo.getKnowledge(context.req.param("id"), { includeDeleted: true });
  if (!current?.deletedAt) return context.json({ error: "Knowledge item not found in trash" }, 404);
  const restored = await repo.restoreKnowledge(current.knowledgeId);
  if (!restored) return context.json({ error: "Unable to restore knowledge item" }, 409);
  await repo.createAuditLog({
    action: "knowledge.restored",
    entityType: "knowledge",
    entityId: current.knowledgeId,
    user,
    metadata: { title: current.title, type: current.type, status: current.status, component: current.component }
  });
  return context.json(restored);
});

app.delete("/knowledge/:id/permanent", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "note");
  const repo = context.get("repo");
  const current = await repo.getKnowledge(context.req.param("id"), { includeDeleted: true });
  if (!current?.deletedAt) return context.json({ error: "Knowledge item not found in trash" }, 404);
  const purged = await repo.purgeKnowledge(current.knowledgeId);
  if (!purged) return context.json({ error: "Unable to permanently delete knowledge item" }, 409);
  await createAuditLogBestEffort(repo, {
    action: "knowledge.permanently_deleted",
    entityType: "knowledge",
    entityId: current.knowledgeId,
    user,
    metadata: { title: current.title, type: current.type, status: current.status, component: current.component }
  });
  return context.json({ ok: true });
});

app.get("/manuscripts", async (context) => {
  requirePermission(context.get("user"), "view", "note");
  return context.json(await context.get("repo").listManuscripts(context.req.query("q") ?? ""));
});

app.post("/manuscripts", async (context) => {
  const user = context.get("user");
  requirePermission(user, "create", "note");
  const input = manuscriptInputSchema.parse(await context.req.json());
  const record = await context.get("repo").createManuscript({
    ...input,
    createdBy: user.userId,
    updatedBy: user.userId
  });
  await context.get("repo").createAuditLog({
    action: "manuscript.created",
    entityType: "manuscript",
    entityId: record.manuscriptId,
    user,
    metadata: { title: record.title, kind: record.kind, status: record.status }
  });
  return context.json(record, 201);
});

app.use("/manuscripts/:id/bookmarks/*", async (context, next) => {
  requirePermission(context.get("user"), "view", "note");
  if (!z.uuid().safeParse(context.req.param("id")).success) return context.json({ error: "Invalid work ID" }, 400);
  if (!(await context.get("repo").getManuscript(context.req.param("id")!))) return context.json({ error: "Work not found" }, 404);
  await next();
});
app.get("/manuscripts/:id/bookmarks", async (context) => {
  return context.json(await context.get("repo").listManuscriptBookmarks(context.get("user").userId, context.req.param("id")));
});
app.post("/manuscripts/:id/bookmarks", async (context) => {
  const parsed = bookmarkInputSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ error: "Invalid bookmark" }, 400);
  const bookmark = await context.get("repo").createManuscriptBookmark(context.get("user").userId, context.req.param("id"), parsed.data);
  return bookmark ? context.json(bookmark, 201) : context.json({ error: "Chapter not found" }, 404);
});
app.patch("/manuscripts/:id/bookmarks/:bookmarkId", async (context) => {
  if (!z.uuid().safeParse(context.req.param("bookmarkId")).success) return context.json({ error: "Invalid bookmark ID" }, 400);
  const parsed = z.object({ name: z.string().trim().max(120) }).strict().safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ error: "Invalid bookmark name" }, 400);
  const bookmark = await context.get("repo").renameManuscriptBookmark(context.get("user").userId, context.req.param("id"), context.req.param("bookmarkId"), parsed.data.name);
  return bookmark ? context.json(bookmark) : context.json({ error: "Bookmark not found" }, 404);
});
app.delete("/manuscripts/:id/bookmarks/:bookmarkId", async (context) => {
  if (!z.uuid().safeParse(context.req.param("bookmarkId")).success) return context.json({ error: "Invalid bookmark ID" }, 400);
  const removed = await context.get("repo").deleteManuscriptBookmark(context.get("user").userId, context.req.param("id"), context.req.param("bookmarkId"));
  return removed ? context.json({ ok: true }) : context.json({ error: "Bookmark not found" }, 404);
});

app.get("/manuscripts/:id", async (context) => {
  requirePermission(context.get("user"), "view", "note");
  const record = await context.get("repo").getManuscript(context.req.param("id"));
  if (!record) return context.json({ error: "Manuscript not found" }, 404);
  return context.json(record);
});

app.post("/manuscripts/:id/encryption/enable", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "note");
  requireManuscriptKeyOwner(user, await context.get("repo").getManuscript(context.req.param("id")), isPersonalArchive(context.env));
  const input = manuscriptBodyEncryptionEnableSchema.parse(
    await context.req.json()
  ) as ManuscriptBodyEncryptionEnableInput;
  if (input.chapters.some((chapter) => !isEncryptedManuscriptBody(chapter.body))
    || input.versions.some((version) => !isEncryptedManuscriptBody(version.body))) {
    return context.json({ error: "Every current and historical body must be encrypted before enabling protection." }, 400);
  }
  try {
    const recoveryEncryptedWorkKey = await wrapManuscriptRecoveryKey(
      input.recoveryWorkKey,
      context.req.param("id"),
      context.env
    );
    const repositoryInput: ManuscriptBodyEncryptionInput = {
      chapters: input.chapters,
      versions: input.versions,
      metadata: { ...input.metadata, recoveryEncryptedWorkKey }
    };
    const record = await context.get("repo").replaceManuscriptBodyEncryption(
      context.req.param("id"), repositoryInput, true, user.userId
    );
    if (!record) return context.json({ error: "Manuscript not found" }, 404);
    await context.get("repo").createAuditLog({
      action: "manuscript.encryption_enabled",
      entityType: "manuscript",
      entityId: record.manuscriptId,
      user,
      metadata: { title: record.title, chapterCount: input.chapters.length, versionCount: input.versions.length }
    });
    return context.json(record);
  } catch (encryptionError) {
    if (!(encryptionError instanceof ManuscriptEncryptionConflictError)) throw encryptionError;
    return context.json({ error: "Encryption update conflict", detail: encryptionError.message }, 409);
  }
});

app.post("/manuscripts/:id/encryption/disable", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "note");
  requireManuscriptKeyOwner(user, await context.get("repo").getManuscript(context.req.param("id")), isPersonalArchive(context.env));
  const input = manuscriptBodyEncryptionSchema.parse(await context.req.json()) as ManuscriptBodyEncryptionInput;
  if (input.metadata) return context.json({ error: "Encryption metadata must be omitted when disabling protection." }, 400);
  if (input.chapters.some((chapter) => isEncryptedManuscriptBody(chapter.body))
    || input.versions.some((version) => isEncryptedManuscriptBody(version.body))) {
    return context.json({ error: "Every current and historical body must be decrypted before disabling protection." }, 400);
  }
  try {
    const record = await context.get("repo").replaceManuscriptBodyEncryption(
      context.req.param("id"), input, false, user.userId
    );
    if (!record) return context.json({ error: "Manuscript not found" }, 404);
    await context.get("repo").createAuditLog({
      action: "manuscript.encryption_disabled",
      entityType: "manuscript",
      entityId: record.manuscriptId,
      user,
      metadata: { title: record.title, chapterCount: input.chapters.length, versionCount: input.versions.length }
    });
    return context.json(record);
  } catch (encryptionError) {
    if (!(encryptionError instanceof ManuscriptEncryptionConflictError)) throw encryptionError;
    return context.json({ error: "Encryption update conflict", detail: encryptionError.message }, 409);
  }
});

app.patch("/manuscripts/:id/encryption/key", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "note");
  const passwordMetadata = manuscriptEncryptionPasswordMetadataSchema.parse(await context.req.json());
  const repo = context.get("repo");
  const manuscript = await repo.getManuscript(context.req.param("id"));
  requireManuscriptKeyOwner(user, manuscript, isPersonalArchive(context.env));
  if (!manuscript?.encryptionEnabled || !manuscript.recoveryEncryptedWorkKey) {
    return context.json({ error: "Encrypted manuscript not found" }, 404);
  }
  const record = await repo.updateManuscriptEncryptionKey(context.req.param("id"), {
    ...passwordMetadata,
    recoveryEncryptedWorkKey: manuscript.recoveryEncryptedWorkKey
  }, user.userId);
  if (!record) return context.json({ error: "Encrypted manuscript not found" }, 404);
  await context.get("repo").createAuditLog({
    action: "manuscript.encryption_password_changed",
    entityType: "manuscript",
    entityId: record.manuscriptId,
    user,
    metadata: { title: record.title }
  });
  return context.json(record);
});

app.post("/manuscripts/:id/encryption/reset-password", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "note");
  const input = manuscriptEncryptionPasswordResetSchema.parse(await context.req.json());
  const repo = context.get("repo");
  const manuscript = await repo.getManuscript(context.req.param("id"));
  requireManuscriptKeyOwner(user, manuscript, isPersonalArchive(context.env));
  const credential = await repo.getUserCredential(user.userId);
  const expectedPassword = credential ? "" : expectedDemoPassword(user.email, context.env);
  const accountPasswordMatches = credential
    ? await verifyPassword(input.currentAccountPassword, credential)
    : Boolean(expectedPassword && input.currentAccountPassword === expectedPassword);
  if (!accountPasswordMatches) {
    await repo.createAuditLog({
      action: "manuscript.encryption_password_reset_failed",
      entityType: "manuscript",
      entityId: context.req.param("id"),
      user,
      metadata: { reason: "account_password_mismatch" }
    });
    return context.json({ error: "Current account password is incorrect." }, 400);
  }

  if (!manuscript?.encryptionEnabled || !manuscript.recoveryEncryptedWorkKey) {
    return context.json({ error: "Encrypted manuscript not found" }, 404);
  }

  const workKey = await unwrapManuscriptRecoveryKey(
    manuscript.recoveryEncryptedWorkKey,
    manuscript.manuscriptId,
    context.env
  );
  try {
    const passwordMetadata = await createRecoveredManuscriptPasswordMetadata(
      workKey,
      input.newEncryptionPassword
    );
    const record = await repo.updateManuscriptEncryptionKey(manuscript.manuscriptId, {
      ...passwordMetadata,
      recoveryEncryptedWorkKey: manuscript.recoveryEncryptedWorkKey
    }, user.userId);
    if (!record) return context.json({ error: "Encrypted manuscript not found" }, 404);
    await repo.createAuditLog({
      action: "manuscript.encryption_password_reset",
      entityType: "manuscript",
      entityId: record.manuscriptId,
      user,
      metadata: { title: record.title, accountPasswordReverified: true }
    });
    return context.json(record);
  } finally {
    workKey.fill(0);
  }
});

app.get("/manuscripts/:id/export", async (context) => {
  const user = context.get("user");
  requirePermission(user, "view", "note");
  requirePermission(user, "download", "document");
  const repo = context.get("repo");
  const manuscript = await repo.getManuscript(context.req.param("id"));
  if (!manuscript) return context.json({ error: "Manuscript not found" }, 404);
  if (manuscript.encryptionEnabled) {
    return context.json({
      error: "Encrypted works are exported in the unlocked browser.",
      detail: "Unlock the work, then export it from the writing workspace."
    }, 409);
  }

  const chapters: ManuscriptChapter[] = [];
  for (const chapterSummary of manuscript.chapters) {
    const chapter = await repo.getManuscriptChapter(manuscript.manuscriptId, chapterSummary.chapterId);
    if (!chapter) {
      return context.json({
        error: "Manuscript changed during export",
        detail: "A part was removed while the export was being prepared. Please retry."
      }, 409);
    }
    chapters.push(chapter);
  }

  const storage = createDocumentStorage(context.env);
  const result = await buildManuscriptExport({
    manuscript,
    chapters,
    loadAsset: async (documentId) => {
      const document = await repo.getDocument(documentId);
      if (!document || !isInlineImageFile(document.mimeType, document.originalFileName || document.fileName)) return null;
      const object = await storage.get(document.r2ObjectKey);
      if (!object) return null;
      return {
        document,
        body: new Uint8Array(await new Response(object.body).arrayBuffer())
      };
    }
  });
  await repo.createAuditLog({
    action: "manuscript.exported",
    entityType: "manuscript",
    entityId: manuscript.manuscriptId,
    user,
    metadata: {
      title: manuscript.title,
      format: "portable-zip",
      chapterCount: chapters.length,
      imageCount: result.includedImageCount,
      missingImageCount: result.missingImageIds.length,
      fileSize: result.body.byteLength
    }
  });
  return new Response(result.body, {
    headers: {
      "content-type": "application/zip",
      "content-length": String(result.body.byteLength),
      "content-disposition": contentDisposition("attachment", result.fileName),
      "cache-control": "private, no-store"
    }
  });
});

app.patch("/manuscripts/:id", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "note");
  const input = manuscriptUpdateSchema.parse(await context.req.json());
  const record = await context.get("repo").updateManuscript(context.req.param("id"), {
    ...input,
    updatedBy: user.userId
  });
  if (!record) return context.json({ error: "Manuscript not found" }, 404);
  await context.get("repo").createAuditLog({
    action: "manuscript.updated",
    entityType: "manuscript",
    entityId: record.manuscriptId,
    user,
    metadata: { title: record.title, kind: record.kind, status: record.status }
  });
  return context.json(record);
});

app.delete("/manuscripts/:id", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "note");
  const record = await context.get("repo").softDeleteManuscript(context.req.param("id"));
  if (!record) return context.json({ error: "Manuscript not found" }, 404);
  await context.get("repo").createAuditLog({
    action: "manuscript.archived",
    entityType: "manuscript",
    entityId: record.manuscriptId,
    user,
    metadata: { title: record.title }
  });
  return context.json(record);
});

app.get("/manuscripts/:id/chapters/:chapterId", async (context) => {
  requirePermission(context.get("user"), "view", "note");
  const chapter = await context.get("repo").getManuscriptChapter(
    context.req.param("id"),
    context.req.param("chapterId")
  );
  if (!chapter) return context.json({ error: "Chapter not found" }, 404);
  return context.json(chapter);
});

app.get("/manuscripts/:id/chapters/:chapterId/versions", async (context) => {
  requirePermission(context.get("user"), "view", "note");
  const chapter = await context.get("repo").getManuscriptChapter(
    context.req.param("id"),
    context.req.param("chapterId")
  );
  if (!chapter) return context.json({ error: "Chapter not found" }, 404);
  const limit = Math.min(MANUSCRIPT_CHAPTER_VERSION_RETENTION, positiveInteger(context.req.query("limit"), 50));
  return context.json(await context.get("repo").listManuscriptChapterVersions(
    context.req.param("id"),
    context.req.param("chapterId"),
    limit
  ));
});

app.get("/manuscripts/:id/chapters/:chapterId/versions/:versionId", async (context) => {
  requirePermission(context.get("user"), "view", "note");
  const version = await context.get("repo").getManuscriptChapterVersion(
    context.req.param("id"),
    context.req.param("chapterId"),
    context.req.param("versionId")
  );
  if (!version) return context.json({ error: "Chapter version not found" }, 404);
  return context.json(version);
});

app.post("/manuscripts/:id/chapters/:chapterId/versions/:versionId/restore", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "note");
  const input = manuscriptChapterRestoreSchema.parse(await context.req.json());
  const manuscriptId = context.req.param("id");
  const chapterId = context.req.param("chapterId");
  const version = await context.get("repo").getManuscriptChapterVersion(
    manuscriptId,
    chapterId,
    context.req.param("versionId")
  );
  if (!version) return context.json({ error: "Chapter version not found" }, 404);
  try {
    const chapter = await context.get("repo").updateManuscriptChapter(manuscriptId, chapterId, {
      title: version.title,
      body: version.body,
      characterCount: version.characterCount,
      contentFormat: version.contentFormat,
      expectedRevision: input.expectedRevision,
      saveSource: "restore",
      updatedBy: user.userId
    });
    if (!chapter) return context.json({ error: "Chapter not found" }, 404);
    await context.get("repo").createAuditLog({
      action: "manuscript.chapter_version_restored",
      entityType: "manuscript_chapter",
      entityId: chapter.chapterId,
      user,
      metadata: {
        manuscriptId,
        restoredVersionId: version.versionId,
        restoredRevision: version.revision,
        resultingRevision: chapter.revision
      }
    });
    return context.json(chapter);
  } catch (restoreError) {
    if (!(restoreError instanceof ManuscriptChapterConflictError)) throw restoreError;
    const { body: _body, ...current } = restoreError.current;
    return context.json({
      error: "Chapter save conflict",
      detail: restoreError.message,
      current
    }, 409);
  }
});

app.post("/manuscripts/:id/chapters", async (context) => {
  const user = context.get("user");
  requirePermission(user, "create", "note");
  const input = manuscriptChapterInputSchema.parse(await context.req.json());
  const manuscript = await context.get("repo").getManuscript(context.req.param("id"));
  if (!manuscript) return context.json({ error: "Manuscript not found" }, 404);
  if (manuscript.encryptionEnabled !== isEncryptedManuscriptBody(input.body)) {
    return context.json({ error: manuscript.encryptionEnabled ? "Encrypted body required." : "Encrypted body is not accepted for this work." }, 400);
  }
  if (manuscript.encryptionEnabled && input.characterCount === undefined) {
    return context.json({ error: "Plaintext character count is required for an encrypted body." }, 400);
  }
  const chapter = await context.get("repo").createManuscriptChapter({
    ...input,
    characterCount: manuscript.encryptionEnabled ? input.characterCount : undefined,
    manuscriptId: manuscript.manuscriptId
  });
  await context.get("repo").createAuditLog({
    action: "manuscript.chapter_created",
    entityType: "manuscript_chapter",
    entityId: chapter.chapterId,
    user,
    metadata: { manuscriptId: manuscript.manuscriptId, title: chapter.title }
  });
  return context.json(chapter, 201);
});

app.patch("/manuscripts/:id/chapters/:chapterId", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "note");
  const input = manuscriptChapterUpdateSchema.parse(await context.req.json());
  let normalizedInput = input;
  if (input.body !== undefined) {
    const manuscript = await context.get("repo").getManuscript(context.req.param("id"));
    if (!manuscript) return context.json({ error: "Manuscript not found" }, 404);
    if (manuscript.encryptionEnabled !== isEncryptedManuscriptBody(input.body)) {
      return context.json({ error: manuscript.encryptionEnabled ? "Encrypted body required." : "Encrypted body is not accepted for this work." }, 400);
    }
    if (manuscript.encryptionEnabled && input.characterCount === undefined) {
      return context.json({ error: "Plaintext character count is required for an encrypted body." }, 400);
    }
    normalizedInput = { ...input, characterCount: manuscript.encryptionEnabled ? input.characterCount : undefined };
  }
  try {
    const chapter = await context.get("repo").updateManuscriptChapter(
      context.req.param("id"),
      context.req.param("chapterId"),
      { ...normalizedInput, updatedBy: user.userId }
    );
    if (!chapter) return context.json({ error: "Chapter not found" }, 404);
    if (context.req.query("summary") !== "true") return context.json(chapter);
    const { body: _body, ...summary } = chapter;
    return context.json(summary);
  } catch (saveError) {
    if (!(saveError instanceof ManuscriptChapterConflictError)) throw saveError;
    const { body: _body, ...current } = saveError.current;
    return context.json({
      error: "Chapter save conflict",
      detail: saveError.message,
      current
    }, 409);
  }
});

app.delete("/manuscripts/:id/chapters/:chapterId", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "note");
  const manuscript = await context.get("repo").getManuscript(context.req.param("id"));
  if (!manuscript) return context.json({ error: "Manuscript not found" }, 404);
  if (manuscript.chapterCount <= 1) return context.json({ error: "A manuscript must keep at least one chapter." }, 409);
  const deleted = await context.get("repo").deleteManuscriptChapter(manuscript.manuscriptId, context.req.param("chapterId"));
  if (!deleted) return context.json({ error: "Chapter not found" }, 404);
  await context.get("repo").createAuditLog({
    action: "manuscript.chapter_archived",
    entityType: "manuscript_chapter",
    entityId: context.req.param("chapterId"),
    user,
    metadata: { manuscriptId: manuscript.manuscriptId }
  });
  return context.json({ ok: true });
});

app.get("/tags", async (context) => {
  requirePermission(context.get("user"), "view", "tag");
  return context.json(await context.get("repo").listTags());
});

app.post("/tags", async (context) => {
  const user = context.get("user");
  requirePermission(user, "create", "tag");
  const input = tagInputSchema.parse(await context.req.json());
  const tag = await context.get("repo").createTag(input.name, input.color);
  await context.get("repo").createAuditLog({
    action: "tag.created",
    entityType: "tag",
    entityId: tag.tagId,
    user,
    metadata: { name: tag.name }
  });
  return context.json(tag, 201);
});

app.patch("/tags/:id", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "tag");
  const input = tagInputSchema.parse(await context.req.json());
  const tag = await context.get("repo").updateTag(context.req.param("id"), input.name, input.color);
  if (!tag) return context.json({ error: "Tag not found" }, 404);
  await context.get("repo").createAuditLog({
    action: "tag.updated",
    entityType: "tag",
    entityId: tag.tagId,
    user,
    metadata: { name: tag.name, color: tag.color }
  });
  return context.json(tag);
});

app.delete("/tags/:id", async (context) => {
  const user = context.get("user");
  requirePermission(user, "delete", "tag");
  const tagId = context.req.param("id");
  const deleted = await context.get("repo").deleteTag(tagId);
  if (!deleted) return context.json({ error: "Tag not found" }, 404);
  await context.get("repo").createAuditLog({
    action: "tag.deleted",
    entityType: "tag",
    entityId: tagId,
    user,
    metadata: {}
  });
  return context.json({ ok: true });
});

app.get("/cases/:id/notes", async (context) => {
  requirePermission(context.get("user"), "view", "note");
  return context.json(await context.get("repo").listNotes(context.req.param("id")));
});

app.get("/cases/:id/communications", async (context) => {
  const user = context.get("user");
  requirePermission(user, "view", "case");
  requirePermission(user, "view", "note");
  const caseId = context.req.param("id");
  const record = await context.get("repo").getCase(caseId);
  if (!record) return context.json({ error: "Case not found" }, 404);
  return context.json(await context.get("repo").listCommunications(caseId));
});

app.get("/cases/:id/timeline", async (context) => {
  const user = context.get("user");
  requirePermission(user, "view", "case");
  requirePermission(user, "view", "note");
  const caseId = context.req.param("id");
  const includeArchived = context.req.query("includeArchived") === "true";
  if (includeArchived) requirePermission(user, "delete", "case");
  const record = await context.get("repo").getCase(caseId, { includeArchived });
  if (!record) return context.json({ error: "Case not found" }, 404);
  return context.json(await buildCaseTimeline(context.get("repo"), caseId));
});

app.post("/cases/:id/notes", async (context) => {
  const user = context.get("user");
  requirePermission(user, "create", "note");
  await requireActiveCase(context.get("repo"), context.req.param("id"));
  const input = z.object({ body: z.string().min(2) }).parse(await context.req.json());
  const note = await context.get("repo").createNote({
    caseId: context.req.param("id"),
    body: input.body,
    createdBy: user.userId
  });
  await context.get("repo").createAuditLog({
    action: "note.created",
    entityType: "note",
    entityId: note.noteId,
    user,
    metadata: { caseId: note.caseId }
  });
  return context.json(note, 201);
});

app.get("/discussion/summary", async (context) => {
  const user = context.get("user");
  requirePermission(user, "view", "case");
  requirePermission(user, "view", "note");
  const repo = context.get("repo");
  const query = context.req.query();
  const baseFilters = discussionFiltersFromQuery({ ...query, view: "all" });
  return context.json(await repo.getServiceDiscussionSummary(baseFilters, user.userId));
});

app.get("/discussion/messages", async (context) => {
  const user = context.get("user");
  requirePermission(user, "view", "case");
  requirePermission(user, "view", "note");
  const query = context.req.query();
  return context.json(
    await context.get("repo").listServiceDiscussionsPage(
      discussionFiltersFromQuery(query),
      paginationFromQuery(query),
      user.userId
    )
  );
});

app.post("/discussion/messages", async (context) => {
  const user = context.get("user");
  requirePermission(user, "create", "note");
  const repo = context.get("repo");
  const input = serviceDiscussionMessageSchema.parse(await context.req.json());
  let caseId = input.caseId ?? null;
  let threadStatus = input.threadStatus;
  let threadOwnerUserId = input.threadOwnerUserId ?? null;
  if (input.parentMessageId) {
    const parent = await repo.getServiceDiscussionMessage(input.parentMessageId);
    if (!parent) return context.json({ error: "Parent discussion message not found" }, 400);
    caseId = parent.caseId ?? null;
    threadStatus = input.threadStatus ?? parent.threadStatus;
    threadOwnerUserId = input.threadOwnerUserId ?? parent.threadOwnerUserId ?? null;
  }
  if (caseId) await requireActiveCase(repo, caseId);
  const message = await repo.createServiceDiscussionMessage({
    ...input,
    caseId,
    threadStatus,
    threadOwnerUserId,
    createdBy: user.userId,
    updatedBy: user.userId
  });
  await repo.createAuditLog({
    action: input.parentMessageId ? "service_discussion.reply_created" : "service_discussion.message_created",
    entityType: "service_discussion",
    entityId: message.messageId,
    user,
    metadata: {
      caseId: message.caseId ?? null,
      parentMessageId: message.parentMessageId,
      messageType: message.messageType,
      threadStatus: message.threadStatus,
      threadOwnerUserId: message.threadOwnerUserId ?? null,
      isPinned: message.isPinned,
      unlinked: !message.caseId,
      mentionedUserIds: message.mentions.map((mention) => mention.userId)
    }
  });
  return context.json(message, 201);
});

app.post("/discussion/messages/:id/link-service", async (context) => {
  const user = context.get("user");
  requirePermission(user, "create", "note");
  const repo = context.get("repo");
  const message = await repo.getServiceDiscussionMessage(context.req.param("id"));
  if (!message) return context.json({ error: "Discussion message not found" }, 404);
  const root = message.parentMessageId ? await repo.getServiceDiscussionMessage(message.parentMessageId) : message;
  if (!root) return context.json({ error: "Discussion thread not found" }, 404);
  if (root.caseId) return context.json({ error: "Discussion thread is already linked to a service." }, 409);
  const input = discussionLinkServiceSchema.parse(await context.req.json());
  const record = await requireActiveCase(repo, input.caseId);
  const linked = await repo.linkServiceDiscussionThread(root.messageId, record.caseId, user.userId);
  await repo.createAuditLog({
    action: "service_discussion.thread_linked",
    entityType: "service_discussion",
    entityId: root.messageId,
    user,
    metadata: { caseId: record.caseId, linkedMessages: linked.length }
  });
  return context.json({ linkedMessages: linked, caseId: record.caseId });
});

app.patch("/discussion/messages/:id/context", async (context) => {
  const user = context.get("user");
  requirePermission(user, "create", "note");
  requirePermission(user, "view", "asset");
  const repo = context.get("repo");
  const message = await repo.getServiceDiscussionMessage(context.req.param("id"));
  if (!message) return context.json({ error: "Discussion message not found" }, 404);
  const root = message.parentMessageId ? await repo.getServiceDiscussionMessage(message.parentMessageId) : message;
  if (!root) return context.json({ error: "Discussion thread not found" }, 404);
  const input = discussionContextSchema.parse(await context.req.json());
  const record = input.caseId ? await requireActiveCase(repo, input.caseId) : null;
  const assetIds = [...new Set(input.assetIds)];
  const assets = await Promise.all(assetIds.map((assetId) => repo.getAsset(assetId)));
  if (assets.some((asset) => !asset)) return context.json({ error: "One or more linked assets were not found." }, 404);
  const incompatibleAssets = assets.filter((asset) => asset && asset.caseId !== (record?.caseId ?? null));
  if (incompatibleAssets.length) {
    return context.json(
      {
        error: record
          ? "Every linked asset must belong to the selected service."
          : "Assets linked to a service cannot be added to an unlinked discussion.",
        detail: incompatibleAssets.map((asset) => asset?.name).filter(Boolean).join(", ")
      },
      409
    );
  }
  const previousCaseId = root.caseId ?? null;
  const previousAssetIds = [...new Set([root, ...(root.replies ?? [])].flatMap((item) => item.assetLinks.map((link) => link.assetId)))];
  const updated = await repo.updateServiceDiscussionThreadContext(root.messageId, record?.caseId ?? null, assetIds, user.userId);
  if (!updated.length) return context.json({ error: "Discussion thread not found" }, 404);
  await repo.createAuditLog({
    action: "service_discussion.context_updated",
    entityType: "service_discussion",
    entityId: root.messageId,
    user,
    metadata: {
      previousCaseId,
      caseId: record?.caseId ?? null,
      previousAssetIds,
      assetIds,
      updatedMessages: updated.length
    }
  });
  return context.json({
    linkedMessages: updated,
    caseId: record?.caseId ?? null,
    assetIds
  });
});

app.post("/discussion/messages/:id/task", async (context) => {
  const user = context.get("user");
  requirePermission(user, "create", "task");
  const repo = context.get("repo");
  const message = await repo.getServiceDiscussionMessage(context.req.param("id"));
  if (!message) return context.json({ error: "Discussion message not found" }, 404);
  if (!message.caseId) return context.json({ error: "Link this discussion thread to a service before creating a task." }, 409);
  await requireActiveCase(repo, message.caseId);
  const input = discussionTaskSchema.parse(await context.req.json().catch(() => ({})));
  const title = input.title?.trim() || discussionKnowledgeTitle(message);
  const description =
    input.description?.trim() ||
    [
      `Created from discussion by ${message.createdByName} on ${message.createdAt}.`,
      "",
      message.bodyText
    ].join("\n");
  const task = await repo.createTask({
    caseId: message.caseId,
    title,
    description,
    priority: input.priority,
    dueDate: input.dueDate || new Date().toISOString().slice(0, 10),
    assignedTo: input.assignedTo ?? null
  });
  await repo.createAuditLog({
    action: "service_discussion.task_created",
    entityType: "task",
    entityId: task.taskId,
    user,
    metadata: {
      caseId: message.caseId,
      discussionMessageId: message.messageId,
      title: task.title,
      priority: task.priority,
      dueDate: task.dueDate,
      assignedTo: task.assignedTo
    }
  });
  return context.json(task, 201);
});

app.post("/discussion/messages/:id/assets", async (context) => {
  const user = context.get("user");
  requirePermission(user, "create", "note");
  requirePermission(user, "view", "asset");
  const repo = context.get("repo");
  const message = await repo.getServiceDiscussionMessage(context.req.param("id"));
  if (!message) return context.json({ error: "Discussion message not found" }, 404);
  await requireActiveDiscussionService(repo, message);
  const input = discussionAssetLinkSchema.parse(await context.req.json());
  const asset = await repo.getAsset(input.assetId);
  if (!asset) return context.json({ error: "Asset not found" }, 404);
  if (message.caseId && asset.caseId !== message.caseId) {
    return context.json({ error: "Asset must belong to the same service as this discussion message." }, 409);
  }
  const link = await repo.linkServiceDiscussionAsset({
    messageId: message.messageId,
    assetId: asset.assetId,
    relationship: input.relationship,
    createdBy: user.userId
  });
  await repo.createAuditLog({
    action: "service_discussion.asset_linked",
    entityType: "service_discussion",
    entityId: message.messageId,
    user,
    metadata: {
      caseId: message.caseId ?? null,
      assetId: asset.assetId,
      assetName: asset.name,
      relationship: link.relationship
    }
  });
  return context.json(link, 201);
});

app.delete("/discussion/messages/:id/assets/:assetId", async (context) => {
  const user = context.get("user");
  requirePermission(user, "create", "note");
  requirePermission(user, "view", "asset");
  const repo = context.get("repo");
  const message = await repo.getServiceDiscussionMessage(context.req.param("id"));
  if (!message) return context.json({ error: "Discussion message not found" }, 404);
  const asset = await repo.getAsset(context.req.param("assetId"));
  if (!asset) return context.json({ error: "Asset not found" }, 404);
  const removed = await repo.unlinkServiceDiscussionAsset(message.messageId, asset.assetId);
  if (!removed) return context.json({ error: "Discussion asset link not found" }, 404);
  await repo.createAuditLog({
    action: "service_discussion.asset_unlinked",
    entityType: "service_discussion",
    entityId: message.messageId,
    user,
    metadata: {
      caseId: message.caseId ?? null,
      assetId: asset.assetId,
      assetName: asset.name
    }
  });
  return context.json({ ok: true });
});

app.post("/discussion/messages/:id/read", async (context) => {
  const user = context.get("user");
  requirePermission(user, "view", "note");
  const message = await context.get("repo").markServiceDiscussionRead(context.req.param("id"), user.userId);
  if (!message) return context.json({ error: "Discussion message not found" }, 404);
  return context.json(message);
});

app.post("/discussion/read", async (context) => {
  const user = context.get("user");
  requirePermission(user, "view", "note");
  const input = z.object({
    q: z.string().optional().default(""),
    view: z.string().optional().default("all"),
    caseId: optionalUuidSchema,
    sort: z.string().optional().default("newest")
  }).parse(await context.req.json().catch(() => ({})));
  const count = await context.get("repo").markServiceDiscussionsRead(
    discussionFiltersFromQuery({
      q: input.q,
      view: input.view,
      caseId: input.caseId ?? undefined,
      sort: input.sort
    }),
    user.userId
  );
  return context.json({ ok: true, count });
});

app.get("/cases/:id/discussion", async (context) => {
  const user = context.get("user");
  requirePermission(user, "view", "case");
  requirePermission(user, "view", "note");
  const repo = context.get("repo");
  const caseId = context.req.param("id");
  const record = await repo.getCase(caseId);
  if (!record) return context.json({ error: "Case not found" }, 404);
  return context.json(await repo.listServiceDiscussion(caseId, user.userId));
});

app.post("/cases/:id/discussion", async (context) => {
  const user = context.get("user");
  requirePermission(user, "create", "note");
  const repo = context.get("repo");
  const caseId = context.req.param("id");
  await requireActiveCase(repo, caseId);
  const input = serviceDiscussionMessageSchema.parse(await context.req.json());
  if (input.parentMessageId) {
    const parent = await repo.getServiceDiscussionMessage(input.parentMessageId);
    if (!parent || parent.caseId !== caseId) return context.json({ error: "Parent discussion message not found" }, 400);
    input.threadStatus = input.threadStatus ?? parent.threadStatus;
    input.threadOwnerUserId = input.threadOwnerUserId ?? parent.threadOwnerUserId ?? null;
  }
  const message = await repo.createServiceDiscussionMessage({
    ...input,
    caseId,
    createdBy: user.userId,
    updatedBy: user.userId
  });
  await repo.createAuditLog({
    action: input.parentMessageId ? "service_discussion.reply_created" : "service_discussion.message_created",
    entityType: "service_discussion",
    entityId: message.messageId,
    user,
    metadata: {
      caseId,
      parentMessageId: message.parentMessageId,
      messageType: message.messageType,
      threadStatus: message.threadStatus,
      threadOwnerUserId: message.threadOwnerUserId ?? null,
      isPinned: message.isPinned,
      mentionedUserIds: message.mentions.map((mention) => mention.userId)
    }
  });
  return context.json(message, 201);
});

app.patch("/discussion/messages/:id", async (context) => {
  const user = context.get("user");
  requirePermission(user, "create", "note");
  const repo = context.get("repo");
  const message = await repo.getServiceDiscussionMessage(context.req.param("id"));
  if (!message) return context.json({ error: "Discussion message not found" }, 404);
  await requireActiveDiscussionService(repo, message);
  const input = serviceDiscussionMessageUpdateSchema.parse(await context.req.json());
  if (!isPersonalArchive(context.env) && (input.title !== undefined || input.bodyText !== undefined || input.mentionedUserIds !== undefined)) ensureDiscussionMessageMutationAllowed(user, message);
  const updated = await repo.updateServiceDiscussionMessage(message.messageId, {
    ...input,
    updatedBy: user.userId
  });
  if (!updated) return context.json({ error: "Discussion message not found" }, 404);
  await repo.createAuditLog({
    action: "service_discussion.message_updated",
    entityType: "service_discussion",
    entityId: updated.messageId,
    user,
    metadata: {
      caseId: updated.caseId ?? null,
      messageType: updated.messageType,
      threadStatus: updated.threadStatus,
      threadOwnerUserId: updated.threadOwnerUserId ?? null,
      isPinned: updated.isPinned,
      title: resolveDiscussionTitle(updated.title, updated.bodyText),
      titleEdited: input.title !== undefined,
      bodyEdited: input.bodyText !== undefined,
      mentionedUserIds: updated.mentions.map((mention) => mention.userId)
    }
  });
  return context.json(updated);
});

app.delete("/discussion/messages/:id", async (context) => {
  const user = context.get("user");
  requirePermission(user, "create", "note");
  const repo = context.get("repo");
  const message = await repo.getServiceDiscussionMessage(context.req.param("id"));
  if (!message) return context.json({ error: "Discussion message not found" }, 404);
  await requireActiveDiscussionService(repo, message);
  if (!isPersonalArchive(context.env)) ensureDiscussionMessageMutationAllowed(user, message);
  const deleted = await repo.softDeleteServiceDiscussionMessage(message.messageId);
  await repo.createAuditLog({
    action: "service_discussion.message_deleted",
    entityType: "service_discussion",
    entityId: message.messageId,
    user,
    metadata: { caseId: message.caseId ?? null, parentMessageId: message.parentMessageId }
  });
  return context.json(deleted ?? { ok: true });
});

app.post("/discussion/messages/:id/attachments", async (context) => {
  const user = context.get("user");
  requirePermission(user, "create", "note");
  requirePermission(user, "upload", "document");
  const repo = context.get("repo");
  const message = await repo.getServiceDiscussionMessage(context.req.param("id"));
  if (!message) return context.json({ error: "Discussion message not found" }, 404);
  await requireActiveDiscussionService(repo, message);
  const limitError = message.caseId ? await demoFileLimitResponse(repo, context.env, user, message.caseId) : null;
  if (limitError) return context.json(limitError, 409);
  const form = await context.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return context.json({ error: "File is required" }, 400);
  const fileLimitError = fileSizeLimitError(file, context.env);
  if (fileLimitError) return context.json(fileLimitError, 413);

  const documentId = crypto.randomUUID();
  const fileName = safeFileName(file.name) || `${documentId}.bin`;
  const r2ObjectKey = message.caseId
    ? `cases/${message.caseId}/discussion/${message.messageId}/attachments/${documentId}/${fileName}`
    : `discussions/unlinked/${message.messageId}/attachments/${documentId}/${fileName}`;
  const storage = createDocumentStorage(context.env);
  const mimeType = uploadContentType(file);
  await storage.put(r2ObjectKey, await file.arrayBuffer(), mimeType);
  try {
    const attachment = await repo.createDocumentWithDiscussionAttachment({
      documentId,
      caseId: message.caseId ?? null,
      fileName,
      originalFileName: file.name,
      fileSize: file.size,
      mimeType,
      category: "Discussion Attachment",
      r2ObjectKey,
      uploadedBy: user.userId,
      notes: String(form.get("notes") || `Attached to service discussion ${message.messageId}`),
      tagIds: form.getAll("tagIds").map((value) => String(value)).filter(Boolean)
    }, {
      messageId: message.messageId,
      inlineImage: isInlineImageFile(mimeType, fileName),
      sortOrder: Number.parseInt(String(form.get("sortOrder") || `${message.attachments.length}`), 10) || 0
    });
    await createAuditLogBestEffort(repo, {
      action: "service_discussion.attachment_uploaded",
      entityType: "service_discussion",
      entityId: message.messageId,
      user,
      metadata: {
        caseId: message.caseId,
        documentId: attachment.documentId,
        fileName: file.name,
        inlineImage: attachment.inlineImage
      }
    });
    return context.json(attachment, 201);
  } catch (error) {
    await cleanupDocumentObject(repo, context.env, r2ObjectKey);
    throw error;
  }
});

app.post("/discussion/messages/:id/attachments/:attachmentId/promote", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "asset");
  requirePermission(user, "view", "document");
  const repo = context.get("repo");
  const message = await repo.getServiceDiscussionMessage(context.req.param("id"));
  if (!message) return context.json({ error: "Discussion message not found" }, 404);
  await requireActiveDiscussionService(repo, message);
  const attachment = message.attachments.find((item) => item.attachmentId === context.req.param("attachmentId"));
  if (!attachment) return context.json({ error: "Discussion attachment not found" }, 404);
  const input = discussionAttachmentPromoteSchema.parse(await context.req.json());
  const asset = await repo.getAsset(input.assetId);
  if (!asset) return context.json({ error: "Asset not found" }, 404);
  if (message.caseId && asset.caseId !== message.caseId) {
    return context.json({ error: "Asset must belong to the same service as this discussion attachment." }, 409);
  }
  const document = await repo.getDocument(attachment.documentId);
  if (!document || document.deletedAt) return context.json({ error: "Document not found" }, 404);
  if (document.isCurrentVersion === false) {
    return context.json({ error: "Only the current version can be promoted as an asset core document." }, 409);
  }
  const link = await repo.linkAssetDocument({
    assetId: asset.assetId,
    documentId: document.documentId,
    relationship: input.relationship,
    note: input.note,
    isPinned: input.isPinned,
    sortOrder: 0,
    createdBy: user.userId,
    updatedBy: user.userId
  });
  await repo.createAuditLog({
    action: "service_discussion.attachment_promoted",
    entityType: "asset",
    entityId: asset.assetId,
    user,
    metadata: {
      caseId: message.caseId ?? null,
      discussionMessageId: message.messageId,
      attachmentId: attachment.attachmentId,
      documentId: document.documentId,
      fileName: document.originalFileName,
      relationship: link.relationship,
      isPinned: link.isPinned
    }
  });
  return context.json(link, 201);
});

app.post("/discussion/messages/:id/knowledge", async (context) => {
  const user = context.get("user");
  requirePermission(user, "create", "note");
  const repo = context.get("repo");
  const message = await repo.getServiceDiscussionMessage(context.req.param("id"));
  if (!message) return context.json({ error: "Discussion message not found" }, 404);
  await requireActiveDiscussionService(repo, message);
  const input = discussionKnowledgeSchema.parse(await context.req.json().catch(() => ({})));
  const attachment = input.attachmentId
    ? message.attachments.find((item) => item.attachmentId === input.attachmentId)
    : null;
  if (input.attachmentId && !attachment) return context.json({ error: "Discussion attachment not found" }, 404);
  let assetId = input.assetId ?? null;
  if (assetId) {
    const asset = await repo.getAsset(assetId);
    if (!asset) return context.json({ error: "Asset not found" }, 404);
    if (message.caseId && asset.caseId !== message.caseId) {
      return context.json({ error: "Asset must belong to the same service as this discussion knowledge." }, 409);
    }
  }
  const title = discussionKnowledgeTitle(message);
  const sourceBody = input.body?.trim() || (attachment ? `${attachment.document.originalFileName}\n\n${message.bodyText}` : message.bodyText);
  const sourceAttachmentLine = discussionAttachmentLine(message, attachment?.attachmentId);
  const linkedDocuments = attachment ? [attachment] : message.attachments;
  const linkedAssetIds = [
    assetId,
    ...message.assetLinks.map((link) => link.assetId)
  ].filter((value): value is string => Boolean(value));
  const knowledge = await repo.createKnowledge({
    title: input.title?.trim() || (title.length >= 2 ? title : "Service discussion note"),
    type: input.type,
    status: input.status,
    component: "Service Discussion",
    summary:
      input.summary?.trim() ||
      (message.messageType === "decision"
        ? "Decision captured from service discussion."
        : attachment
          ? "Attachment context captured from service discussion."
          : "Captured from service discussion."),
    body: [sourceBody, "", discussionSourceLine(message), sourceAttachmentLine].filter(Boolean).join("\n"),
    keywords: ["discussion", message.messageType, input.type.toLowerCase()],
    credentialReference: "",
    sourceServiceId: message.caseId ?? null,
    lastVerifiedAt: null,
    links: [
      { entityType: "discussion" as const, entityId: message.messageId, relationship: "source discussion" },
      ...(message.caseId ? [{ entityType: "service" as const, entityId: message.caseId, relationship: "source" }] : []),
      ...linkedAssetIds.map((linkedAssetId) => ({
        entityType: "asset" as const,
        entityId: linkedAssetId,
        relationship: "discussion context"
      })),
      ...linkedDocuments.map((linkedAttachment) => ({
        entityType: "document" as const,
        entityId: linkedAttachment.documentId,
        relationship: "discussion attachment"
      }))
    ],
    createdBy: user.userId,
    updatedBy: user.userId
  });
  await repo.createAuditLog({
    action: "knowledge.created_from_discussion",
    entityType: "knowledge",
    entityId: knowledge.knowledgeId,
    user,
    metadata: {
      caseId: message.caseId ?? null,
      discussionMessageId: message.messageId,
      attachmentId: attachment?.attachmentId ?? null,
      assetId,
      sourceServiceId: message.caseId ?? null,
      title: knowledge.title,
      type: knowledge.type
    }
  });
  return context.json(knowledge, 201);
});

app.post("/discussion/messages/:id/note", async (context) => {
  const user = context.get("user");
  requirePermission(user, "create", "note");
  const repo = context.get("repo");
  const message = await repo.getServiceDiscussionMessage(context.req.param("id"));
  if (!message) return context.json({ error: "Discussion message not found" }, 404);
  if (!message.caseId) return context.json({ error: "Link this discussion thread to a service before creating a note." }, 409);
  await requireActiveCase(repo, message.caseId);
  const input = discussionNoteSchema.parse(await context.req.json().catch(() => ({})));
  const attachment = input.attachmentId
    ? message.attachments.find((item) => item.attachmentId === input.attachmentId)
    : null;
  if (input.attachmentId && !attachment) return context.json({ error: "Discussion attachment not found" }, 404);
  const body = [
    input.body?.trim() || message.bodyText,
    "",
    discussionSourceLine(message),
    discussionAttachmentLine(message, attachment?.attachmentId)
  ].filter(Boolean).join("\n");
  const note = await repo.createNote({
    caseId: message.caseId,
    body,
    createdBy: user.userId
  });
  await repo.createAuditLog({
    action: "note.created_from_discussion",
    entityType: "note",
    entityId: note.noteId,
    user,
    metadata: {
      caseId: message.caseId,
      discussionMessageId: message.messageId,
      attachmentId: attachment?.attachmentId ?? null
    }
  });
  return context.json(note, 201);
});

app.post("/cases/:id/communications", async (context) => {
  const user = context.get("user");
  requirePermission(user, "create", "note");
  const repo = context.get("repo");
  const caseId = context.req.param("id");
  await requireActiveCase(repo, caseId);
  const input = communicationInputSchema.parse(await context.req.json());

  if (input.partyOrganizationId) {
    const organization = await repo.getPartyOrganization(input.partyOrganizationId);
    if (!organization) return context.json({ error: "Organization not found" }, 400);
  }
  if (input.contactId) {
    const contact = await repo.getContact(input.contactId);
    if (!contact) return context.json({ error: "Contact not found" }, 400);
  }
  if (input.assetId) {
    const asset = await repo.getAsset(input.assetId);
    if (!asset) return context.json({ error: "Asset not found" }, 400);
  }
  if (input.supportingDocumentId) {
    const document = await repo.getDocument(input.supportingDocumentId);
    if (!document || document.caseId !== caseId) return context.json({ error: "Supporting document not found" }, 400);
  }
  if (input.followUpAssignedTo && !(await repo.getUserById(input.followUpAssignedTo))) {
    return context.json({ error: "Follow-up owner not found" }, 400);
  }

  const communication = await repo.createCommunication({
    caseId,
    partyOrganizationId: input.partyOrganizationId ?? null,
    contactId: input.contactId ?? null,
    assetId: input.assetId ?? null,
    supportingDocumentId: input.supportingDocumentId ?? null,
    communicationType: input.communicationType,
    direction: input.direction,
    source: input.source,
    status: input.status ?? "Linked",
    followUpAssignedTo: input.followUpAssignedTo ?? null,
    followUpDueDate: input.followUpDueDate ?? null,
    externalProvider: input.externalProvider,
    externalReference: input.externalReference,
    externalUrl: input.externalUrl,
    sourceMetadata: input.sourceMetadata,
    subject: input.subject,
    body: input.body,
    occurredAt: input.occurredAt,
    createdBy: user.userId
  });
  await repo.createAuditLog({
    action: "communication.created",
    entityType: "communication",
    entityId: communication.communicationId,
    user,
    metadata: {
      caseId,
      communicationType: communication.communicationType,
      direction: communication.direction,
      source: communication.source,
      status: communication.status,
      followUpAssignedTo: communication.followUpAssignedTo ?? null,
      followUpAssignedToName: communication.followUpAssignedToName ?? null,
      followUpDueDate: communication.followUpDueDate ?? null,
      externalProvider: communication.externalProvider,
      externalReference: communication.externalReference,
      externalUrl: communication.externalUrl,
      subject: communication.subject,
      partyOrganizationId: communication.partyOrganizationId ?? null,
      contactId: communication.contactId ?? null,
      assetId: communication.assetId ?? null,
      supportingDocumentId: communication.supportingDocumentId ?? null
    }
  });
  return context.json(communication, 201);
});

app.get("/cases/:id/tasks", async (context) => {
  requirePermission(context.get("user"), "view", "task");
  return context.json(await context.get("repo").listTasks(context.req.param("id")));
});

app.post("/cases/:id/tasks", async (context) => {
  const user = context.get("user");
  requirePermission(user, "create", "task");
  await requireActiveCase(context.get("repo"), context.req.param("id"));
  const input = z
    .object({
      title: z.string().min(2),
      description: z.string().default(""),
      priority: taskPrioritySchema.default("Normal"),
      dueDate: z.string(),
      assignedTo: z.string().nullable().optional()
    })
    .parse(await context.req.json());
  const task = await context.get("repo").createTask({ caseId: context.req.param("id"), ...input });
  await context.get("repo").createAuditLog({
    action: "task.created",
    entityType: "task",
    entityId: task.taskId,
    user,
    metadata: { title: task.title, priority: task.priority, dueDate: task.dueDate, assignedTo: task.assignedTo }
  });
  return context.json(task, 201);
});

app.patch("/cases/:caseId/tasks/:taskId", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "task");
  await requireActiveCase(context.get("repo"), context.req.param("caseId"));
  const input = z
    .object({
      status: taskStatusSchema.optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      priority: taskPrioritySchema.optional(),
      dueDate: z.string().optional(),
      assignedTo: z.string().nullable().optional()
    })
    .parse(await context.req.json());
  const task = await context.get("repo").updateTask(context.req.param("taskId"), input);
  if (!task) return context.json({ error: "Task not found" }, 404);
  await context.get("repo").createAuditLog({
    action: "task.updated",
    entityType: "task",
    entityId: task.taskId,
    user,
    metadata: { title: task.title, status: task.status, priority: task.priority, dueDate: task.dueDate, assignedTo: task.assignedTo }
  });
  return context.json(task);
});

app.get("/search", async (context) => {
  const user = context.get("user");
  requirePermission(user, "view", "search");
  return context.json(
    await context.get("repo").search(context.req.query("q") ?? "", {
      includeCredentialMetadata: can(user, "view", "credential")
    })
  );
});

app.get("/backups/settings", async (context) => {
  requirePermission(context.get("user"), "view", "settings");
  return context.json(await context.get("repo").getBackupSettings());
});

app.put("/backups/settings", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "settings");
  const input = backupSettingsSchema.parse(await context.req.json());
  const settings = await context.get("repo").updateBackupSettings(input, user);
  await context.get("repo").createAuditLog({
    action: "backup.settings_updated",
    entityType: "backup_job",
    entityId: settings.backupJobId,
    user,
    metadata: {
      destination: settings.destination,
      schedule: settings.schedule,
      scope: settings.scope,
      isEnabled: settings.isEnabled
    }
  });
  return context.json(settings);
});

app.get("/backups/runs", async (context) => {
  requirePermission(context.get("user"), "view", "settings");
  const limit = positiveInteger(context.req.query("limit"), 20);
  return context.json(await context.get("repo").listBackupRuns(limit));
});

app.post("/backups/runs", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "settings");
  const input = backupRunRequestSchema.parse(await context.req.json().catch(() => ({})));
  const repo = context.get("repo");
  const savedSettings = await repo.getBackupSettings();
  const settings: BackupSettings = {
    ...savedSettings,
    destination: input.destination,
    scope: input.scope,
    includeMetadata: input.includeMetadata,
    includeDocuments: input.includeDocuments,
    includeAuditLogs: input.includeAuditLogs,
    includeRelationshipMap: input.includeRelationshipMap,
    folderByCaseAndCategory: input.folderByCaseAndCategory,
    checksumManifest: input.checksumManifest,
    isEnabled: true
  };

  const snapshot = await repo.buildBackupSnapshot(settings.scope);
  const backupRunId = crypto.randomUUID();
  const backupBaseObjectKey = backupRunObjectBase(backupRunId);
  const manifestFileName = backupManifestFileName(backupRunId);
  const manifestObjectKey =
    isWritableBackupDestination(settings.destination) && !input.dryRun
      ? backupObjectKey(backupBaseObjectKey, `manifest/${manifestFileName}`)
      : null;
  const manifest = buildBackupManifest(settings, snapshot, backupRunId, user, manifestObjectKey);
  const items = backupItemsFromManifest(settings, snapshot, manifest, backupBaseObjectKey, manifestObjectKey, manifestFileName);
  const documentStorage = createDocumentStorage(context.env);
  const backupStorage = createBackupStorage(context.env);
  const writtenObjectKeys: string[] = [];

  if (settings.destination === "r2-manifest" && manifestObjectKey) {
    const backupResult = await writeR2BackupPackage(documentStorage, backupStorage, settings, manifest, items);
    writtenObjectKeys.push(...backupResult.writtenObjectKeys);
  } else if (settings.destination === "google-drive" && manifestObjectKey && !input.dryRun) {
    const backupResult = await writeGoogleDriveBackupPackage(
      context.env,
      documentStorage,
      backupStorage,
      settings,
      manifest,
      items,
      backupBaseObjectKey,
      manifestObjectKey
    );
    writtenObjectKeys.push(...backupResult.writtenObjectKeys);
  }

  const failedItems = items.filter((item) => item.status === "failed").length;

  try {
    const run = await repo.createBackupRun({
      backupRunId,
      backupJobId: settings.backupJobId,
      status: backupStatus(settings, input.dryRun, failedItems, items.length),
      destination: settings.destination,
      scope: settings.scope,
      startedAt: snapshot.generatedAt,
      completedAt: new Date().toISOString(),
      caseCount: snapshot.cases.length,
      documentCount: snapshot.documents.length,
      metadataRows: snapshot.metadataRows,
      itemCount: items.length,
      failedItems,
      manifestObjectKey,
      manifestFileName,
      mode: backupMode(settings, input.dryRun),
      createdBy: user.userId,
      message: backupMessage(settings, input.dryRun, failedItems)
    });
    await Promise.all(items.map((item) => repo.createBackupItem(item)));
    await repo.createAuditLog({
      action: "backup.run_created",
      entityType: "backup_run",
      entityId: run.backupRunId,
      user,
      metadata: {
        dryRun: input.dryRun,
        status: run.status,
        destination: run.destination,
        caseCount: run.caseCount,
        documentCount: run.documentCount,
        itemCount: run.itemCount,
        failedItems: run.failedItems,
        manifestObjectKey: run.manifestObjectKey
      }
    });
    return context.json(run, 201);
  } catch (error) {
    await Promise.all(writtenObjectKeys.map((objectKey) => backupStorage.delete(objectKey).catch(() => undefined)));
    throw error;
  }
});

app.get("/backups/runs/:id/items", async (context) => {
  requirePermission(context.get("user"), "view", "settings");
  const run = await context.get("repo").getBackupRun(context.req.param("id"));
  if (!run) return context.json({ error: "Backup run not found" }, 404);
  return context.json(await context.get("repo").listBackupItems(run.backupRunId));
});

app.delete("/backups/runs/:id", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "settings");
  const repo = context.get("repo");
  const backupRunId = context.req.param("id");
  const run = await repo.getBackupRun(backupRunId);
  if (!run) return context.json({ error: "Backup run not found" }, 404);
  const items = await repo.listBackupItems(backupRunId);
  const backupStorage = createBackupStorage(context.env);
  const objectKeys = new Set(
    [run.manifestObjectKey, ...items.map((item) => item.targetPath)].filter(
      (key): key is string => typeof key === "string" && key.startsWith("backups/runs/")
    )
  );
  await Promise.all([...objectKeys].map((objectKey) => backupStorage.delete(objectKey).catch(() => undefined)));
  const deleted = await repo.deleteBackupRun(backupRunId);
  if (!deleted) return context.json({ error: "Backup run not found" }, 404);
  await repo.createAuditLog({
    action: "backup.run_deleted",
    entityType: "backup_run",
    entityId: backupRunId,
    user,
    metadata: {
      status: run.status,
      destination: run.destination,
      failedItems: run.failedItems,
      removedObjectCount: objectKeys.size
    }
  });
  return context.json(deleted);
});

app.get("/backups/runs/:id/manifest", async (context) => {
  requirePermission(context.get("user"), "view", "settings");
  const run = await context.get("repo").getBackupRun(context.req.param("id"));
  if (!run) return context.json({ error: "Backup run not found" }, 404);
  if (!run.manifestObjectKey) {
    return context.json({ error: "Manifest file not available", detail: "This backup run did not write a manifest file." }, 404);
  }
  const object = await createBackupStorage(context.env).get(run.manifestObjectKey);
  if (!object) {
    return context.json(
      { error: "Stored manifest not found", detail: "The backup run exists, but the private manifest object is missing." },
      404
    );
  }
  return new Response(object.body, {
    headers: {
      "content-type": object.contentType ?? "application/json",
      "content-disposition": contentDisposition("attachment", run.manifestFileName ?? "realtycase-backup-manifest.json")
    }
  });
});

app.get("/database/recovery-status", async (context) => {
  requirePermission(context.get("user"), "view", "settings");
  return context.json(await buildDatabaseRecoveryStatus(context.env));
});

app.get("/database/snapshots", async (context) => {
  requirePermission(context.get("user"), "view", "settings");
  return context.json(await listDatabaseSnapshots(context.env));
});

app.post("/database/snapshots", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "settings");
  let result: Awaited<ReturnType<typeof createDatabaseSnapshot>>;
  try {
    result = await createDatabaseSnapshot(context.env);
  } catch (error) {
    if (isNeonSnapshotLimitExceeded(error)) {
      return context.json(
        {
          error: "Restore point limit reached",
          detail: NEON_SNAPSHOT_LIMIT_MESSAGE
        },
        409
      );
    }
    throw error;
  }
  try {
    await context.get("repo").createAuditLog({
      action: "database.snapshot_created",
      entityType: "database_snapshot",
      entityId: crypto.randomUUID(),
      user,
      metadata: {
        projectId: result.projectId,
        branchId: result.branchId,
        branchName: result.branchName,
        snapshotId: result.snapshotId,
        snapshotName: result.snapshotName,
        operationIds: result.operationIds
      }
    });
  } catch (error) {
    console.warn("Failed to record database snapshot audit log", error);
  }
  return context.json(result, 201);
});

app.post("/database/table-exports", async (context) => {
  const user = context.get("user");
  requirePermission(user, "edit", "settings");
  const repo = context.get("repo");
  const exportId = crypto.randomUUID();
  const createdAt = new Date();
  const fileName = databaseTableExportFileName(exportId, createdAt);
  const objectKey = databaseTableExportObjectKey(exportId, fileName, createdAt);
  const tableExport = await repo.exportDatabaseTables();
  const archive = {
    exportId,
    createdAt: createdAt.toISOString(),
    generatedBy: { userId: user.userId, name: user.name, email: user.email, role: user.role },
    source: {
      provider: context.env.HYPERDRIVE?.connectionString ? "Application database" : "Memory demo",
      schema: tableExport.schema
    },
    tableCount: tableExport.tableCount,
    rowCount: tableExport.rowCount,
    tables: tableExport.tables
  };
  const payload = textToArrayBuffer(JSON.stringify(archive, null, 2));
  const checksum = await sha256Hex(payload);
  await createBackupStorage(context.env).put(objectKey, payload, "application/json");
  const result: DatabaseTableExportResult = {
    provider: context.env.HYPERDRIVE?.connectionString ? "database-json-r2" : "memory-demo",
    exportId,
    objectKey,
    fileName,
    createdAt: createdAt.toISOString(),
    tableCount: tableExport.tableCount,
    rowCount: tableExport.rowCount,
    sizeBytes: payload.byteLength,
    checksum,
    downloadUrl: `/api/database/table-exports/download?key=${encodeURIComponent(objectKey)}`,
    message: "Business record JSON export was written to the private backup area."
  };
  await repo.createAuditLog({
    action: "database.table_export_created",
    entityType: "database_table_export",
    entityId: exportId,
    user,
    metadata: {
      objectKey,
      fileName,
      tableCount: result.tableCount,
      rowCount: result.rowCount,
      sizeBytes: result.sizeBytes,
      checksum
    }
  });
  return context.json(result, 201);
});

app.get("/database/table-exports/download", async (context) => {
  requirePermission(context.get("user"), "view", "settings");
  const objectKey = context.req.query("key") ?? "";
  if (!objectKey.startsWith("database/table-exports/") || objectKey.includes("..")) {
    return context.json({ error: "Invalid export key" }, 400);
  }
  const object = await createBackupStorage(context.env).get(objectKey);
  if (!object) return context.json({ error: "Database table export not found" }, 404);
  const fileName = objectKey.split("/").pop() || "realtycase-database-tables.json";
  return new Response(object.body, {
    headers: {
      "content-type": object.contentType ?? "application/json",
      "content-disposition": contentDisposition("attachment", fileName)
    }
  });
});

app.get("/audit-logs", async (context) => {
  requirePermission(context.get("user"), "view", "audit");
  return context.json(await context.get("repo").listAuditLogs());
});

export const onRequest: PagesFunction<AppEnv> = (context) =>
  app.fetch(context.request, context.env, context as unknown as ExecutionContext);
