import type { Sql, TransactionSql } from "postgres";
import type { ArchiveContentKind } from "../../shared/archiveContent";
import { HTTPException } from "hono/http-exception";
import { ARCHIVE_MANAGEMENT_TTL_MS, requireArchiveSession, type ArchiveAccess, type ArchiveManagementSession, type ArchiveManagementState, type ArchiveManagementTarget } from "../auth/archiveManagement";
import { STORAGE_CLEANUP_LEASE_MS, STORAGE_CLEANUP_REFERENCE_DELAY_MS, storageCleanupRetryDelay } from "../services/storageCleanupPolicy";
import { bookmarkForStorage, BookmarkConflictError, type ManuscriptBookmark, type ManuscriptBookmarkInput } from "../../shared/manuscriptBookmarks";

function mapBookmark(row: Record<string, unknown>): ManuscriptBookmark {
  return { bookmarkId: String(row.bookmark_id), userId: String(row.user_id), manuscriptId: String(row.manuscript_id), chapterId: String(row.chapter_id),
    name: String(row.name), anchor: row.anchor as ManuscriptBookmark["anchor"], positionOnly: Boolean(row.position_only),
    createdAt: new Date(row.created_at as string).toISOString(), updatedAt: new Date(row.updated_at as string).toISOString() };
}
import type {
  AuditLog,
  ArchiveCategory,
  ArchiveFolder,
  ArchiveFolderMetadataUpdateInput,
  ArchiveFolderMetadataUpdateResult,
  AssetDocumentLink,
  AssetCredential,
  AssetFilters,
  BackupItem,
  BackupRun,
  BackupScope,
  BackupSettings,
  PbxSettings,
  CaseContact,
  CaseFilters,
  CaseRecord,
  CaseTypeTemplate,
  CommunicationFilters,
  CommunicationRecord,
  Contact,
  ContactFilters,
  ContactRole,
  DashboardStats,
  DocumentFilters,
  DocumentRecord,
  DocumentReviewStatus,
  DirectoryViewScope,
  GmailExtensionToken,
  GmailExtensionTokenScope,
  KnowledgeFilters,
  KnowledgeItem,
  KnowledgeLink,
  KnowledgeLinkInput,
  Manuscript,
  ManuscriptBodyEncryptionInput,
  ManuscriptChapter,
  ManuscriptChapterSummary,
  ManuscriptChapterVersion,
  ManuscriptChapterVersionSummary,
  ManuscriptEncryptionMetadata,
  ManagedAsset,
  NoteRecord,
  OrganizationFilters,
  PaginatedResult,
  PaginationParams,
  PartyOrganization,
  PrivateVaultPasswordMetadata,
  PublicUser,
  SearchCredentialMatch,
  SearchResult,
  SavedDirectoryView,
  SavedDirectoryViewInput,
  ServiceDiscussionAssetLink,
  ServiceDiscussionAttachment,
  ServiceDiscussionFilters,
  ServiceDiscussionMention,
  ServiceDiscussionMessage,
  ServiceDiscussionSummary,
  Tag,
  TaskRecord
} from "../../shared/types";
import { MANUSCRIPT_CHAPTER_VERSION_RETENTION } from "../../shared/types";
import { contactDisplayName, dateOnlyString } from "../../shared/format";
import { resolveDiscussionTitle } from "../../shared/discussionTitle";
import { normalizePhoneNumber, phoneDigits } from "../../shared/phoneNumbers";
import { DEFAULT_CASE_TYPE_TEMPLATES, caseTypeName, inferCaseTypeCode } from "../../shared/workflowTemplates";
import type {
  AppRepository,
  ArchiveFolderDeleteResult,
  BackupSnapshot,
  CreateAuthSessionInput,
  CreateAssetDocumentLinkInput,
  CreateArchiveCategoryInput,
  CreateArchiveFolderInput,
  CreateBackupItemInput,
  CreateBackupRunInput,
  CreateCaseInput,
  CreateContactInput,
  CreatePartyOrganizationInput,
  CreateAssetCredentialInput,
  CreateCommunicationInput,
  CreateDocumentInput,
  CreateGmailExtensionTokenInput,
  CreateKnowledgeInput,
  CreateManuscriptChapterInput,
  CreateManuscriptInput,
  CreateManagedAssetInput,
  CreateNoteInput,
  CreatePrivateVaultFolderInput,
  CreatePrivateVaultInput,
  CreatePrivateVaultItemInput,
  CreateServiceDiscussionAssetLinkInput,
  CreateServiceDiscussionAttachmentInput,
  CreateServiceDiscussionMessageInput,
  CreateTaskInput,
  DatabaseTableExportPayload,
  UpdateBackupSettingsInput,
  UpdatePbxSettingsInput,
  UpdateAssetDocumentLinkInput,
  UpdateAssetCredentialInput,
  UpdateDocumentInput,
  UpdateKnowledgeInput,
  UpdateManuscriptChapterInput,
  UpdateManuscriptInput,
  UpdateManagedAssetInput,
  UpdateServiceDiscussionMessageInput,
  StoredAssetCredential,
  StoredGmailExtensionToken,
  StoredPrivateVault,
  StoredPrivateVaultFolder,
  StoredPrivateVaultItem,
  PrivateVaultItemMetadataUpdate,
  StorageCleanupJob,
  UserCredential,
  UpdateUserPasswordOptions
} from "./types";
import { ManuscriptChapterConflictError, ManuscriptEncryptionConflictError, PrivateVaultItemAccessError } from "./types";
import { manuscriptKeyOwnerClaimSchema, type ManuscriptKeyOwnerClaimInput } from "../auth/manuscriptKeyOwnership";
import { credentialMatchesAssetSearch, filterAssets } from "../../shared/assetFilters";
import { countTextCharacters } from "../../shared/textMetrics";
import {
  assetSearchResult,
  caseSearchResult,
  contactSearchResult,
  documentSearchResult,
  finalizeSearchResults,
  knowledgeSearchResult,
  manuscriptSearchResult,
  organizationSearchResult
} from "../../shared/searchRanking";

type Row = Record<string, unknown>;

const DEFAULT_TENANT_ID = "90000000-0000-4000-8000-000000000001";
const DEFAULT_ORGANIZATION_ID = DEFAULT_TENANT_ID;
const DEFAULT_BACKUP_JOB_ID = "80000000-0000-4000-8000-000000000001";
const DEFAULT_PBX_SETTINGS_ID = "70000000-0000-4000-8000-000000000001";
const SYSTEM_AUDIT_USER_EMAIL = "system@md3-platform.local";
const CASE_NUMBER_PREFIX = "MD3";
const CASE_NUMBER_START = 1001;
// Shared with the statement triggers in 0051_archive_folder_recovery.sql.
async function lockArchiveHierarchy(sql: TransactionSql): Promise<void> {
  await sql`select pg_advisory_xact_lock(1885430627, 1885430631)`;
}

const asString = (value: unknown) => (value instanceof Date ? value.toISOString() : String(value ?? ""));
const asNumber = (value: unknown) => Number(value ?? 0);
function mapStorageCleanupJob(row: Row): StorageCleanupJob {
  return {
    cleanupJobId: asString(row.cleanup_job_id), objectKey: asString(row.object_key), attempts: asNumber(row.attempts),
    startedAt: row.started_at ? asString(row.started_at) : null,
    leaseToken: row.lease_token ? asString(row.lease_token) : null,
    leaseExpiresAt: row.lease_expires_at ? asString(row.lease_expires_at) : null,
    nextAttemptAt: asString(row.next_attempt_at), completedAt: row.completed_at ? asString(row.completed_at) : null,
    lastError: row.last_error === "object_referenced" ? "object_referenced" : row.last_error ? "object_delete_failed" : null
  };
}
const asJson = <T>(value: unknown, fallback: T): T => {
  if (!value) return fallback;
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
};

function normalizePagination(pagination: PaginationParams = {}): Required<PaginationParams> {
  const page = Math.max(1, Math.floor(Number(pagination.page ?? 1)) || 1);
  const pageSize = Math.min(100, Math.max(10, Math.floor(Number(pagination.pageSize ?? 25)) || 25));
  return { page, pageSize };
}

function paginatedResult<T>(items: T[], total: number, pagination: Required<PaginationParams>): PaginatedResult<T> {
  const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
  return {
    items,
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    totalPages,
    hasNextPage: pagination.page < totalPages,
    hasPreviousPage: pagination.page > 1
  };
}

function normalizeExportValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalizeExportValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeExportValue(item)]));
  }
  return value;
}

function normalizeExportRecord(row: Row): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeExportValue(value)]));
}

function extensionMatchKeys(...values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => phoneDigits(value))
        .filter((digits) => digits.length >= 2 && digits.length <= 6)
    )
  );
}

function isMissingSchemaFeature(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code) : "";
  return code === "42703" || code === "42P01";
}

function mapTag(row: Row): Tag {
  return { tagId: asString(row.tag_id), name: asString(row.name), color: asString(row.color) };
}

function mapUser(row: Row): PublicUser {
  return {
    userId: asString(row.user_id),
    name: asString(row.name),
    email: asString(row.email),
    role: asString(row.role) as PublicUser["role"],
    createdAt: asString(row.created_at),
    tenantId: row.tenant_id || row.organization_id ? asString(row.tenant_id ?? row.organization_id) : null,
    mustChangePassword: row.must_change_password === true || row.must_change_password === "true"
  };
}

function mapUserCredential(row: Row): UserCredential {
  return {
    passwordHash: asString(row.password_hash),
    passwordSalt: asString(row.password_salt),
    passwordAlgorithm: asString(row.password_algorithm),
    passwordIterations: asNumber(row.password_iterations),
    mustChangePassword: row.must_change_password === true || row.must_change_password === "true"
  };
}

function mapGmailExtensionToken(row: Row): StoredGmailExtensionToken {
  return {
    tokenId: asString(row.token_id),
    name: asString(row.name),
    tokenHash: asString(row.token_hash),
    scopes: (Array.isArray(row.scopes) ? row.scopes : []) as GmailExtensionTokenScope[],
    ownerUserId: asString(row.owner_user_id),
    ownerUserName: asString(row.owner_user_name) || "Unknown user",
    createdBy: row.created_by ? asString(row.created_by) : null,
    createdByName: row.created_by_name ? asString(row.created_by_name) : null,
    createdAt: asString(row.created_at),
    lastUsedAt: row.last_used_at ? asString(row.last_used_at) : null,
    revokedAt: row.revoked_at ? asString(row.revoked_at) : null
  };
}

function mapSavedDirectoryView(row: Row): SavedDirectoryView {
  return {
    savedViewId: asString(row.saved_view_id),
    scope: asString(row.scope) as DirectoryViewScope,
    name: asString(row.name),
    filters: asJson<Record<string, unknown>>(row.filters, {}),
    sort: asString(row.sort),
    pageSize: asNumber(row.page_size) || 25,
    isDefault: row.is_default === true || row.is_default === "true",
    createdBy: row.created_by ? asString(row.created_by) : null,
    createdByName: row.created_by_name ? asString(row.created_by_name) : null,
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at)
  };
}

function publicGmailExtensionToken(token: StoredGmailExtensionToken): GmailExtensionToken {
  const { tokenHash: _tokenHash, ...publicToken } = token;
  return publicToken;
}

function mapCase(row: Row, tags: Tag[] = []): CaseRecord {
  const customFields = asJson<Record<string, unknown>>(row.custom_fields, {});
  const propertyAddress = asString(row.property_address) || asString(customFields.propertyAddress) || asString(row.title);
  const city = asString(row.city) || asString(customFields.city);
  const state = asString(row.state) || asString(customFields.state);
  const zipCode = asString(row.zip_code) || asString(customFields.zipCode);
  const propertyType = asString(row.property_type) || asString(customFields.propertyType) || "Single Family";
  const inferredCaseTypeCode =
    asString(row.case_type_code) || asString(row.work_item_type_code) || inferCaseTypeCode(propertyType, tags);
  return {
    caseId: asString(row.case_id) || asString(row.work_item_id),
    caseNumber: asString(row.case_number) || asString(row.number),
    caseTypeCode: inferredCaseTypeCode,
    caseTypeName: asString(row.case_type_name) || caseTypeName(inferredCaseTypeCode),
    customerOrganizationId: row.party_organization_id ? asString(row.party_organization_id) : null,
    customerOrganizationName: row.party_organization_name ? asString(row.party_organization_name) : null,
    propertyAddress,
    city,
    state,
    zipCode,
    propertyType: propertyType as CaseRecord["propertyType"],
    salePriceCents: asNumber(row.sale_price_cents ?? row.value_cents),
    status: asString(row.status) as CaseRecord["status"],
    closingDate: dateOnlyString(row.closing_date ?? row.target_date),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    deletedAt: row.deleted_at ? asString(row.deleted_at) : null,
    notes: asString(row.notes) || asString(row.summary),
    tags
  };
}

function mapCaseTypeTemplate(row: Row): CaseTypeTemplate {
  return {
    code: asString(row.case_type_code) || asString(row.type_code),
    name: asString(row.display_name),
    description: asString(row.description),
    requiredDocumentCategories: asJson<CaseTypeTemplate["requiredDocumentCategories"]>(
      row.required_document_categories,
      []
    ),
    checklist: asJson<CaseTypeTemplate["checklist"]>(row.checklist_template, []),
    closingReadinessEnabled: (row.closing_readiness_enabled ?? row.readiness_enabled) !== false,
    sortOrder: asNumber(row.sort_order),
    isActive: row.is_active !== false
  };
}

function contactRowDisplayName(row: Row): string {
  return asString(row.display_name) || [asString(row.first_name), asString(row.last_name)].filter(Boolean).join(" ").trim();
}

function mapContact(row: Row): Contact {
  const displayName = contactRowDisplayName(row);
  return {
    contactId: asString(row.contact_id),
    displayName,
    firstName: asString(row.first_name) || displayName,
    lastName: asString(row.last_name),
    partyOrganizationId: row.party_organization_id ? asString(row.party_organization_id) : null,
    partyOrganizationName: row.party_organization_name ? asString(row.party_organization_name) : null,
    jobTitle: asString(row.job_title),
    email: asString(row.email),
    phone: asString(row.phone),
    address: asString(row.address),
    notes: asString(row.notes),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    deletedAt: row.deleted_at ? asString(row.deleted_at) : null,
    relatedServiceCount: asNumber(row.related_service_count),
    openServiceCount: asNumber(row.open_service_count),
    communicationCount: asNumber(row.communication_count),
    needsFollowUpCommunicationCount: asNumber(row.needs_follow_up_communication_count),
    lastCommunicationAt: row.last_communication_at ? asString(row.last_communication_at) : null
  };
}

function mapPartyOrganization(row: Row): PartyOrganization {
  return {
    partyOrganizationId: asString(row.party_organization_id),
    name: asString(row.name),
    type: asString(row.type) as PartyOrganization["type"],
    taxIdType: asString(row.tax_id_type) as PartyOrganization["taxIdType"],
    taxIdValue: asString(row.tax_id_value),
    website: asString(row.website),
    email: asString(row.email),
    phone: asString(row.phone),
    fax: asString(row.fax),
    addressLine1: asString(row.address_line1),
    addressLine2: asString(row.address_line2),
    city: asString(row.city),
    state: asString(row.state),
    zipCode: asString(row.zip_code),
    country: asString(row.country),
    notes: asString(row.notes),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    contactCount: asNumber(row.contact_count),
    relatedServiceCount: asNumber(row.related_service_count),
    openServiceCount: asNumber(row.open_service_count),
    assetCount: asNumber(row.asset_count),
    communicationCount: asNumber(row.communication_count),
    needsFollowUpCommunicationCount: asNumber(row.needs_follow_up_communication_count),
    lastCommunicationAt: row.last_communication_at ? asString(row.last_communication_at) : null
  };
}

function mapManagedAsset(row: Row): ManagedAsset {
  return {
    createdBy: row.created_by ? asString(row.created_by) : null,
    assetId: asString(row.asset_id),
    partyOrganizationId: row.party_organization_id ? asString(row.party_organization_id) : null,
    partyOrganizationName: row.party_organization_name ? asString(row.party_organization_name) : null,
    caseId: row.work_item_id ? asString(row.work_item_id) : null,
    caseNumber: row.case_number ? asString(row.case_number) : null,
    caseTitle: row.case_title ? asString(row.case_title) : null,
    parentAssetId: row.parent_asset_id ? asString(row.parent_asset_id) : null,
    parentAssetName: row.parent_asset_name ? asString(row.parent_asset_name) : null,
    name: asString(row.name),
    assetType: asString(row.asset_type),
    status: asString(row.status),
    manufacturer: asString(row.manufacturer),
    model: asString(row.model),
    serialNumber: asString(row.serial_number),
    macAddress: asString(row.mac_address),
    imei: asString(row.imei),
    iccid: asString(row.iccid),
    phoneNumber: asString(row.phone_number),
    extension: asString(row.extension),
    hostname: asString(row.hostname),
    lanIp: asString(row.lan_ip),
    wanIp: asString(row.wan_ip),
    installedLocation: asString(row.installed_location),
    installedAt: row.installed_at ? dateOnlyString(row.installed_at) : null,
    lastServiceAt: row.last_service_at ? dateOnlyString(row.last_service_at) : null,
    notes: asString(row.notes),
    credentialCount: asNumber(row.credential_count),
    childAssetCount: asNumber(row.child_asset_count),
    coreDocumentCount: asNumber(row.core_document_count),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    deletedAt: row.deleted_at ? asString(row.deleted_at) : null
  };
}

function mapAssetCredential(row: Row): AssetCredential {
  return {
    credentialId: asString(row.credential_id),
    assetId: asString(row.asset_id),
    partyOrganizationId: row.party_organization_id ? asString(row.party_organization_id) : null,
    partyOrganizationName: row.party_organization_name ? asString(row.party_organization_name) : null,
    caseId: row.work_item_id ? asString(row.work_item_id) : null,
    caseNumber: row.case_number ? asString(row.case_number) : null,
    label: asString(row.label),
    credentialType: asString(row.credential_type),
    username: asString(row.username),
    loginUrl: asString(row.login_url),
    host: asString(row.host),
    notes: asString(row.notes),
    hasSecret: Boolean(row.secret_iv && row.secret_tag),
    hasPrivateNotes: Boolean(row.private_notes_iv && row.private_notes_tag),
    lastVerifiedAt: row.last_verified_at ? dateOnlyString(row.last_verified_at) : null,
    rotationDueAt: row.rotation_due_at ? dateOnlyString(row.rotation_due_at) : null,
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    deletedAt: row.deleted_at ? asString(row.deleted_at) : null
  };
}

function mapStoredAssetCredential(row: Row): StoredAssetCredential {
  return {
    ...mapAssetCredential(row),
    encryptedSecret: asString(row.encrypted_secret),
    secretIv: asString(row.secret_iv),
    secretTag: asString(row.secret_tag),
    encryptedPrivateNotes: asString(row.encrypted_private_notes),
    privateNotesIv: asString(row.private_notes_iv),
    privateNotesTag: asString(row.private_notes_tag),
    encryptionAlgorithm: asString(row.encryption_algorithm)
  };
}

function mapDocument(row: Row, tags: Tag[] = []): DocumentRecord {
  return {
    managementOwnerUserId: row.management_owner_user_id ? asString(row.management_owner_user_id) : null,
    documentId: asString(row.document_id),
    caseId: row.case_id ? asString(row.case_id) : null,
    caseNumber: row.case_number ? asString(row.case_number) : undefined,
    caseTitle: row.case_title ? asString(row.case_title) : undefined,
    partyOrganizationId: row.party_organization_id ? asString(row.party_organization_id) : null,
    partyOrganizationName: row.party_organization_name ? asString(row.party_organization_name) : null,
    documentGroupId: row.document_group_id ? asString(row.document_group_id) : asString(row.document_id),
    versionNumber: row.version_number ? asNumber(row.version_number) : 1,
    isCurrentVersion: row.is_current_version !== false,
    supersededBy: row.superseded_by ? asString(row.superseded_by) : null,
    supersededAt: row.superseded_at ? asString(row.superseded_at) : null,
    fileName: asString(row.file_name),
    originalFileName: asString(row.original_file_name),
    fileSize: asNumber(row.file_size),
    mimeType: asString(row.mime_type),
    category: asString(row.category) as DocumentRecord["category"],
    folderId: row.folder_id ? asString(row.folder_id) : null,
    folderName: row.folder_name ? asString(row.folder_name) : null,
    folderDeletionBatchId: row.folder_deletion_batch_id ? asString(row.folder_deletion_batch_id) : null,
    r2ObjectKey: asString(row.r2_object_key),
    uploadedAt: asString(row.uploaded_at),
    uploadedBy: asString(row.uploaded_by),
    uploadedByName: asString(row.uploaded_by_name),
    reviewStatus: (asString(row.review_status) || "needs-review") as DocumentReviewStatus,
    reviewedBy: row.reviewed_by ? asString(row.reviewed_by) : null,
    reviewedByName: row.reviewed_by_name ? asString(row.reviewed_by_name) : null,
    reviewedAt: row.reviewed_at ? asString(row.reviewed_at) : null,
    reviewNotes: asString(row.review_notes),
    tags,
    notes: asString(row.notes),
    deletedAt: row.deleted_at ? asString(row.deleted_at) : null
  };
}

function mapArchiveFolder(row: Row): ArchiveFolder {
  return {
    managementOwnerUserId: row.management_owner_user_id ? asString(row.management_owner_user_id) : null,
    folderId: asString(row.folder_id),
    name: asString(row.name),
    parentFolderId: row.parent_folder_id ? asString(row.parent_folder_id) : null,
    sortOrder: asNumber(row.sort_order),
    fileCount: asNumber(row.file_count),
    createdBy: row.created_by ? asString(row.created_by) : null,
    createdByName: row.created_by_name ? asString(row.created_by_name) : null,
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    deletedAt: row.deleted_at ? asString(row.deleted_at) : null,
    deletionBatchId: row.deletion_batch_id ? asString(row.deletion_batch_id) : null,
    deletionRootFolderId: row.deletion_root_folder_id ? asString(row.deletion_root_folder_id) : null
  };
}

function mapArchiveCategory(row: Row): ArchiveCategory {
  return {
    categoryId: asString(row.category_id),
    name: asString(row.name),
    sortOrder: asNumber(row.sort_order),
    isSystem: Boolean(row.is_system),
    fileCount: asNumber(row.file_count),
    createdBy: row.created_by ? asString(row.created_by) : null,
    createdByName: row.created_by_name ? asString(row.created_by_name) : null,
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at)
  };
}

function mapAssetDocumentLink(row: Row, document: DocumentRecord): AssetDocumentLink {
  return {
    assetDocumentLinkId: asString(row.link_asset_document_link_id),
    assetId: asString(row.link_asset_id),
    documentId: asString(row.link_document_id),
    relationship: asString(row.link_relationship) || "Other",
    note: asString(row.link_note),
    isPinned: row.link_is_pinned === true || row.link_is_pinned === "true",
    sortOrder: asNumber(row.link_sort_order),
    createdBy: row.link_created_by ? asString(row.link_created_by) : null,
    createdByName: row.link_created_by_name ? asString(row.link_created_by_name) : null,
    updatedBy: row.link_updated_by ? asString(row.link_updated_by) : null,
    updatedByName: row.link_updated_by_name ? asString(row.link_updated_by_name) : null,
    createdAt: asString(row.link_created_at),
    updatedAt: asString(row.link_updated_at),
    deletedAt: row.link_deleted_at ? asString(row.link_deleted_at) : null,
    document
  };
}

function mapNote(row: Row): NoteRecord {
  return {
    noteId: asString(row.note_id),
    caseId: asString(row.case_id),
    body: asString(row.body),
    createdAt: asString(row.created_at),
    createdBy: asString(row.created_by),
    createdByName: asString(row.created_by_name)
  };
}

function mapServiceDiscussionAttachment(row: Row, document: DocumentRecord): ServiceDiscussionAttachment {
  return {
    attachmentId: asString(row.attachment_id),
    messageId: asString(row.message_id),
    documentId: asString(row.document_id),
    inlineImage: row.inline_image === true || row.inline_image === "true",
    sortOrder: asNumber(row.sort_order),
    createdAt: asString(row.attachment_created_at ?? row.created_at),
    document
  };
}

function mapServiceDiscussionMention(row: Row): ServiceDiscussionMention {
  return {
    messageId: asString(row.message_id),
    userId: asString(row.user_id),
    userName: asString(row.user_name),
    createdAt: asString(row.mention_created_at ?? row.created_at)
  };
}

function mapServiceDiscussionAssetLink(row: Row): ServiceDiscussionAssetLink {
  return {
    discussionAssetLinkId: asString(row.discussion_asset_link_id),
    messageId: asString(row.message_id),
    assetId: asString(row.asset_id),
    assetName: asString(row.asset_name),
    assetType: asString(row.asset_type),
    caseId: row.work_item_id ? asString(row.work_item_id) : null,
    caseNumber: row.case_number ? asString(row.case_number) : null,
    relationship: asString(row.relationship || "related"),
    createdBy: row.created_by ? asString(row.created_by) : null,
    createdByName: row.created_by_name ? asString(row.created_by_name) : null,
    createdAt: asString(row.created_at)
  };
}

function mapServiceDiscussionMessage(
  row: Row,
  attachments: ServiceDiscussionAttachment[] = [],
  mentions: ServiceDiscussionMention[] = [],
  assetLinks: ServiceDiscussionAssetLink[] = []
): ServiceDiscussionMessage {
  return {
    messageId: asString(row.message_id),
    managementOwnerUserId: row.management_owner_user_id ? asString(row.management_owner_user_id) : null,
    title: row.parent_message_id ? null : row.title ? asString(row.title) : resolveDiscussionTitle(null, asString(row.body_text)),
    caseId: row.work_item_id ? asString(row.work_item_id) : null,
    caseNumber: row.case_number ? asString(row.case_number) : null,
    caseTitle: row.case_title ? asString(row.case_title) : null,
    caseStatus: row.case_status ? asString(row.case_status) : null,
    parentMessageId: row.parent_message_id ? asString(row.parent_message_id) : null,
    bodyText: asString(row.body_text),
    messageType: (asString(row.message_type) || "message") as ServiceDiscussionMessage["messageType"],
    visibility: (asString(row.visibility) || "team") as ServiceDiscussionMessage["visibility"],
    threadStatus: (asString(row.thread_status) || "open") as ServiceDiscussionMessage["threadStatus"],
    threadOwnerUserId: row.thread_owner_user_id ? asString(row.thread_owner_user_id) : null,
    threadOwnerUserName: row.thread_owner_user_name ? asString(row.thread_owner_user_name) : null,
    isPinned: row.is_pinned === true || row.is_pinned === "true",
    replyCount: asNumber(row.reply_count),
    latestActivityAt: row.latest_reply_at ? asString(row.latest_reply_at) : asString(row.updated_at),
    attachments,
    mentions,
    assetLinks,
    readAt: row.read_at ? asString(row.read_at) : null,
    isUnread: row.is_unread === true || row.is_unread === "true",
    createdBy: asString(row.created_by),
    createdByName: asString(row.created_by_name),
    updatedBy: row.updated_by ? asString(row.updated_by) : null,
    updatedByName: row.updated_by_name ? asString(row.updated_by_name) : null,
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    editedAt: row.edited_at ? asString(row.edited_at) : null,
    deletedAt: row.deleted_at ? asString(row.deleted_at) : null
  };
}

function mapKnowledgeLink(row: Row): KnowledgeLink {
  return {
    knowledgeLinkId: asString(row.knowledge_link_id),
    knowledgeId: asString(row.knowledge_id),
    entityType: asString(row.entity_type) as KnowledgeLink["entityType"],
    entityId: asString(row.entity_id),
    relationship: asString(row.relationship) || "related",
    label: row.label ? asString(row.label) : null,
    detail: row.detail ? asString(row.detail) : null,
    createdAt: asString(row.created_at)
  };
}

function mapKnowledgeItem(row: Row, links: KnowledgeLink[] = []): KnowledgeItem {
  return {
    knowledgeId: asString(row.knowledge_id),
    managementOwnerUserId: row.management_owner_user_id ? asString(row.management_owner_user_id) : null,
    title: asString(row.title),
    type: asString(row.knowledge_type) as KnowledgeItem["type"],
    status: asString(row.status) as KnowledgeItem["status"],
    component: asString(row.component),
    summary: asString(row.summary),
    body: asString(row.body),
    keywords: mapStringArray(row.keywords),
    credentialReference: asString(row.credential_reference),
    sourceServiceId: row.source_work_item_id ? asString(row.source_work_item_id) : null,
    sourceServiceNumber: row.source_service_number ? asString(row.source_service_number) : null,
    sourceServiceTitle: row.source_service_title ? asString(row.source_service_title) : null,
    lastVerifiedAt: row.last_verified_at ? dateOnlyString(row.last_verified_at) : null,
    createdBy: row.created_by ? asString(row.created_by) : null,
    createdByName: row.created_by_name ? asString(row.created_by_name) : null,
    updatedBy: row.updated_by ? asString(row.updated_by) : null,
    updatedByName: row.updated_by_name ? asString(row.updated_by_name) : null,
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    deletedAt: row.deleted_at ? asString(row.deleted_at) : null,
    links
  };
}

function mapManuscriptChapterSummary(row: Row): ManuscriptChapterSummary {
  return {
    chapterId: asString(row.chapter_id),
    manuscriptId: asString(row.manuscript_id),
    title: asString(row.title),
    contentFormat: (asString(row.content_format) || "rich-text") as ManuscriptChapterSummary["contentFormat"],
    sortOrder: asNumber(row.sort_order),
    characterCount: asNumber(row.character_count),
    revision: asNumber(row.revision) || 1,
    lastSaveSource: (asString(row.last_save_source) || "manual") as ManuscriptChapterSummary["lastSaveSource"],
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at)
  };
}

function mapManuscriptChapter(row: Row): ManuscriptChapter {
  return { ...mapManuscriptChapterSummary(row), body: asString(row.body) };
}

function mapManuscriptChapterVersionSummary(row: Row): ManuscriptChapterVersionSummary {
  return {
    versionId: asString(row.version_id),
    manuscriptId: asString(row.manuscript_id),
    chapterId: asString(row.chapter_id),
    revision: asNumber(row.revision),
    title: asString(row.title),
    contentFormat: (asString(row.content_format) || "rich-text") as ManuscriptChapterVersionSummary["contentFormat"],
    characterCount: asNumber(row.character_count),
    saveSource: (asString(row.save_source) || "manual") as ManuscriptChapterVersionSummary["saveSource"],
    savedBy: row.saved_by ? asString(row.saved_by) : null,
    savedByName: row.saved_by_name ? asString(row.saved_by_name) : null,
    savedAt: asString(row.saved_at),
    createdAt: asString(row.created_at)
  };
}

function mapManuscriptChapterVersion(row: Row): ManuscriptChapterVersion {
  return { ...mapManuscriptChapterVersionSummary(row), body: asString(row.body) };
}

function mapManuscript(row: Row, chapters: ManuscriptChapterSummary[] = []): Manuscript {
  return {
    manuscriptId: asString(row.manuscript_id),
    managementOwnerUserId: row.management_owner_user_id ? asString(row.management_owner_user_id) : null,
    keyOwnerUserId: row.key_owner_user_id ? asString(row.key_owner_user_id) : null,
    title: asString(row.title),
    kind: asString(row.manuscript_kind) as Manuscript["kind"],
    status: asString(row.status) as Manuscript["status"],
    description: asString(row.description),
    encryptionEnabled: Boolean(row.encryption_enabled),
    encryptionVersion: row.encryption_version === null || row.encryption_version === undefined ? null : asNumber(row.encryption_version),
    encryptionKdf: row.encryption_kdf ? asString(row.encryption_kdf) : null,
    encryptionIterations: row.encryption_iterations === null || row.encryption_iterations === undefined ? null : asNumber(row.encryption_iterations),
    encryptionSalt: row.encryption_salt ? asString(row.encryption_salt) : null,
    encryptedWorkKey: row.encrypted_work_key ? asString(row.encrypted_work_key) : null,
    recoveryEncryptedWorkKey: row.recovery_encrypted_work_key ? asString(row.recovery_encrypted_work_key) : null,
    encryptionUpdatedAt: row.encryption_updated_at ? asString(row.encryption_updated_at) : null,
    chapterCount: asNumber(row.chapter_count),
    characterCount: asNumber(row.character_count),
    createdBy: row.created_by ? asString(row.created_by) : null,
    createdByName: row.created_by_name ? asString(row.created_by_name) : null,
    updatedBy: row.updated_by ? asString(row.updated_by) : null,
    updatedByName: row.updated_by_name ? asString(row.updated_by_name) : null,
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    deletedAt: row.deleted_at ? asString(row.deleted_at) : null,
    chapters
  };
}

function mapPrivateVault(row: Row): StoredPrivateVault {
  return {
    vaultId: asString(row.vault_id),
    ownerUserId: asString(row.owner_user_id),
    encryptionVersion: asNumber(row.encryption_version),
    encryptionKdf: asString(row.encryption_kdf),
    encryptionIterations: asNumber(row.encryption_iterations),
    encryptionSalt: asString(row.encryption_salt),
    encryptedVaultKey: asString(row.encrypted_vault_key),
    recoveryEncryptedVaultKey: asString(row.recovery_encrypted_vault_key),
    autoLockMinutes: asNumber(row.auto_lock_minutes),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at)
  };
}

function mapPrivateVaultItem(row: Row): StoredPrivateVaultItem {
  return {
    itemId: asString(row.item_id),
    vaultId: asString(row.vault_id),
    encryptionVersion: asNumber(row.encryption_version),
    encryptedMetadata: asString(row.encrypted_metadata),
    wrappedFileKey: asString(row.wrapped_file_key),
    objectKey: asString(row.object_key),
    ciphertextSize: asNumber(row.ciphertext_size),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    deletedAt: row.deleted_at ? asString(row.deleted_at) : null
  };
}

function mapPrivateVaultFolder(row: Row): StoredPrivateVaultFolder {
  return {
    folderId: asString(row.folder_id),
    vaultId: asString(row.vault_id),
    encryptionVersion: asNumber(row.encryption_version),
    encryptedMetadata: asString(row.encrypted_metadata),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    deletedAt: row.deleted_at ? asString(row.deleted_at) : null
  };
}

function mapCommunication(row: Row): CommunicationRecord {
  return {
    communicationId: asString(row.communication_id),
    caseId: row.case_id || row.work_item_id ? asString(row.case_id) || asString(row.work_item_id) : null,
    caseNumber: row.case_number ? asString(row.case_number) : null,
    caseTitle: row.case_title ? asString(row.case_title) : null,
    partyOrganizationId: row.party_organization_id ? asString(row.party_organization_id) : null,
    partyOrganizationName: row.party_organization_name ? asString(row.party_organization_name) : null,
    contactId: row.contact_id ? asString(row.contact_id) : null,
    contactName: row.contact_name ? asString(row.contact_name) : null,
    assetId: row.asset_id ? asString(row.asset_id) : null,
    assetName: row.asset_name ? asString(row.asset_name) : null,
    supportingDocumentId: row.supporting_document_id ? asString(row.supporting_document_id) : null,
    supportingDocumentName: row.supporting_document_name ? asString(row.supporting_document_name) : null,
    communicationType: asString(row.communication_type) as CommunicationRecord["communicationType"],
    direction: asString(row.direction) as CommunicationRecord["direction"],
    source: (asString(row.source) || "Manual") as CommunicationRecord["source"],
    status: (asString(row.status) || "Logged") as CommunicationRecord["status"],
    followUpAssignedTo: row.follow_up_assigned_to ? asString(row.follow_up_assigned_to) : null,
    followUpAssignedToName: row.follow_up_assigned_to_name ? asString(row.follow_up_assigned_to_name) : null,
    followUpDueDate: row.follow_up_due_date ? dateOnlyString(row.follow_up_due_date) : null,
    externalProvider: asString(row.external_provider),
    externalReference: asString(row.external_reference),
    externalUrl: asString(row.external_url),
    sourceMetadata: asJson<Record<string, unknown>>(row.source_metadata, {}),
    subject: asString(row.subject),
    body: asString(row.body),
    occurredAt: asString(row.occurred_at),
    createdBy: row.created_by ? asString(row.created_by) : null,
    createdByName: row.created_by_name ? asString(row.created_by_name) : null,
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    deletedAt: row.deleted_at ? asString(row.deleted_at) : null
  };
}

function mapTask(row: Row): TaskRecord {
  return {
    taskId: asString(row.task_id),
    caseId: asString(row.case_id),
    caseNumber: row.case_number ? asString(row.case_number) : undefined,
    caseTitle: row.case_title ? asString(row.case_title) : undefined,
    title: asString(row.title),
    description: asString(row.description),
    status: asString(row.status) as TaskRecord["status"],
    priority: (asString(row.priority) || "Normal") as TaskRecord["priority"],
    dueDate: dateOnlyString(row.due_date),
    assignedTo: row.assigned_to ? asString(row.assigned_to) : null,
    assignedToName: row.assigned_to_name ? asString(row.assigned_to_name) : null,
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at)
  };
}

function mapAuditLog(row: Row): AuditLog {
  return {
    auditLogId: asString(row.audit_log_id),
    action: asString(row.action),
    entityType: asString(row.entity_type),
    entityId: asString(row.entity_id),
    userId: asString(row.user_id),
    userName: asString(row.user_name),
    createdAt: asString(row.created_at),
    metadata: asJson<Record<string, unknown>>(row.metadata, {})
  };
}

function defaultBackupSettings(user?: PublicUser | null): BackupSettings {
  const now = new Date().toISOString();
  return {
    backupJobId: DEFAULT_BACKUP_JOB_ID,
    name: "Primary backup plan",
    destination: "r2-manifest",
    schedule: "daily",
    scope: "all-cases",
    includeMetadata: true,
    includeDocuments: true,
    includeAuditLogs: true,
    includeRelationshipMap: true,
    folderByCaseAndCategory: true,
    checksumManifest: true,
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
    updatedBy: user?.userId ?? null,
    updatedByName: user?.name ?? null
  };
}

function mapBackupSettings(row: Row): BackupSettings {
  return {
    backupJobId: asString(row.backup_job_id),
    name: asString(row.name),
    destination: asString(row.destination) as BackupSettings["destination"],
    schedule: asString(row.schedule) as BackupSettings["schedule"],
    scope: asString(row.scope) as BackupSettings["scope"],
    includeMetadata: row.include_metadata !== false,
    includeDocuments: row.include_documents !== false,
    includeAuditLogs: row.include_audit_logs !== false,
    includeRelationshipMap: row.include_relationship_map !== false,
    folderByCaseAndCategory: row.folder_by_case_and_category !== false,
    checksumManifest: row.checksum_manifest !== false,
    isEnabled: row.is_enabled !== false,
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    updatedBy: row.updated_by ? asString(row.updated_by) : null,
    updatedByName: row.updated_by_name ? asString(row.updated_by_name) : null
  };
}

function defaultPbxSettings(user?: PublicUser | null): PbxSettings {
  const now = new Date().toISOString();
  return {
    pbxSettingsId: DEFAULT_PBX_SETTINGS_ID,
    isEnabled: false,
    allowedDids: [],
    allowedDestinations: [],
    ignoredDids: [],
    ignoredDestinations: [],
    showUnknownCallers: true,
    popupRetentionSeconds: 30,
    createdAt: now,
    updatedAt: now,
    updatedBy: user?.userId ?? null,
    updatedByName: user?.name ?? null
  };
}

function mapStringArray(value: unknown): string[] {
  return asJson<unknown[]>(value, [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function mapPbxSettings(row: Row): PbxSettings {
  return {
    pbxSettingsId: asString(row.pbx_settings_id),
    isEnabled: row.is_enabled === true || row.is_enabled === "true",
    allowedDids: mapStringArray(row.allowed_dids),
    allowedDestinations: mapStringArray(row.allowed_destinations),
    ignoredDids: mapStringArray(row.ignored_dids),
    ignoredDestinations: mapStringArray(row.ignored_destinations),
    showUnknownCallers: row.show_unknown_callers !== false,
    popupRetentionSeconds: asNumber(row.popup_retention_seconds) || 30,
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    updatedBy: row.updated_by ? asString(row.updated_by) : null,
    updatedByName: row.updated_by_name ? asString(row.updated_by_name) : null
  };
}

function mapBackupRun(row: Row): BackupRun {
  return {
    backupRunId: asString(row.backup_run_id),
    backupJobId: asString(row.backup_job_id),
    status: asString(row.status) as BackupRun["status"],
    destination: asString(row.destination) as BackupRun["destination"],
    scope: asString(row.scope) as BackupRun["scope"],
    startedAt: asString(row.started_at),
    completedAt: row.completed_at ? asString(row.completed_at) : null,
    caseCount: asNumber(row.case_count),
    documentCount: asNumber(row.document_count),
    metadataRows: asNumber(row.metadata_rows),
    itemCount: asNumber(row.item_count),
    failedItems: asNumber(row.failed_items),
    manifestObjectKey: row.manifest_object_key ? asString(row.manifest_object_key) : null,
    manifestFileName: row.manifest_file_name ? asString(row.manifest_file_name) : null,
    mode: asString(row.mode) as BackupRun["mode"],
    createdBy: row.created_by ? asString(row.created_by) : null,
    createdByName: row.created_by_name ? asString(row.created_by_name) : null,
    message: asString(row.message)
  };
}

function mapBackupItem(row: Row): BackupItem {
  return {
    backupItemId: asString(row.backup_item_id),
    backupRunId: asString(row.backup_run_id),
    itemType: asString(row.item_type) as BackupItem["itemType"],
    sourceId: row.source_id ? asString(row.source_id) : null,
    sourcePath: asString(row.source_path),
    targetPath: asString(row.target_path),
    status: asString(row.status) as BackupItem["status"],
    sizeBytes: asNumber(row.size_bytes),
    checksum: row.checksum ? asString(row.checksum) : null,
    metadata: asJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: asString(row.created_at)
  };
}

// Existing repository methods may begin their own transaction. Within the
// authorization boundary these become savepoints on the SAME connection.
function archiveTransactionConnection(transaction: TransactionSql): Sql {
  return new Proxy(transaction as unknown as Sql, {
    get(target, key) {
      if (key === "begin") return (operation: (sql: TransactionSql) => Promise<unknown>) =>
        transaction.savepoint((inner) => operation(archiveTransactionConnection(inner) as unknown as TransactionSql));
      return Reflect.get(target, key);
    }
  });
}

export class PostgresRepository implements AppRepository {
  constructor(private readonly sql: Sql) {}

  async runArchiveMutation<T>(access: ArchiveAccess, operation: (repo: AppRepository) => Promise<T>): Promise<T> {
    return this.sql.begin(async (sql) => {
      await lockArchiveHierarchy(sql);
      // Credential changes lock the user first; logout locks this session.
      await sql`select user_id from users where user_id = ${access.userId} for update`;
      await sql`select token_hash from auth_sessions where token_hash = ${access.sessionTokenHash} and user_id = ${access.userId} for update`;
      const transaction = new PostgresRepository(archiveTransactionConnection(sql));
      const initial = requireArchiveSession(await transaction.getArchiveManagementSession(access), access);
      const wasVerified = initial.verifiedUntil && Date.parse(initial.verifiedUntil) > Date.now();
      const result = await operation(transaction);
      requireArchiveSession(await transaction.getArchiveManagementSession(access), access);
      if (wasVerified && Date.parse(initial.verifiedUntil!) <= Date.now()) throw new HTTPException(409, { message: "Archive management access expired during this operation. Try again." });
      return result;
    }) as Promise<T>;
  }

  async getArchiveManagementSession(access: ArchiveAccess): Promise<ArchiveManagementSession | null> {
    const rows = await this.sql`
      select u.*, coalesce(uc.must_change_password, false) as must_change_password,
        s.current_tenant_id as tenant_id, s.archive_management_verified_until
      from auth_sessions s join users u on u.user_id = s.user_id
      left join user_credentials uc on uc.user_id = u.user_id
      where s.token_hash = ${access.sessionTokenHash} and s.user_id = ${access.userId}
        and s.revoked_at is null and s.expires_at > clock_timestamp()
    `;
    if (!rows[0]) return null;
    return { user: mapUser(rows[0] as Row), verifiedUntil: rows[0].archive_management_verified_until ? asString(rows[0].archive_management_verified_until) : null };
  }

  async setArchiveManagementVerification(access: ArchiveAccess, expectedPasswordHash: string | null): Promise<string | null> {
    return this.sql.begin(async (sql) => {
      await sql`select user_id from users where user_id = ${access.userId} for update`;
      const rows = await sql`
        update auth_sessions s set archive_management_verified_until = case when ${expectedPasswordHash === null}
          then null else least(s.expires_at, clock_timestamp() + ${ARCHIVE_MANAGEMENT_TTL_MS} * interval '1 millisecond') end
        from users u join user_credentials uc on uc.user_id = u.user_id
        where s.user_id = u.user_id and u.user_id = ${access.userId} and u.role = 'Admin'
          and s.token_hash = ${access.sessionTokenHash} and s.revoked_at is null and s.expires_at > clock_timestamp()
          and not uc.must_change_password
          and (${expectedPasswordHash === null} or uc.password_hash = ${expectedPasswordHash})
        returning s.archive_management_verified_until
      `;
      return rows[0]?.archive_management_verified_until ? asString(rows[0].archive_management_verified_until) : null;
    }) as Promise<string | null>;
  }

  async readArchiveManagementState(documentId?: string, folderId?: string): Promise<ArchiveManagementState> {
    const folderRows = folderId ? await this.sql`select * from archive_folders` : [];
    const rows = await this.sql`
      with recursive folder_tree as (
        select folder_id from archive_folders where folder_id = ${folderId ?? null}::uuid
        union select f.folder_id from archive_folders f join folder_tree p on f.parent_folder_id = p.folder_id
      ), groups as (
        select coalesce(d.document_group_id, d.document_id) as group_id from documents d
        where d.document_id = ${documentId ?? null}::uuid or d.folder_id in (select folder_id from folder_tree)
          or d.folder_deletion_batch_id = (select deletion_batch_id from archive_folders where folder_id = ${folderId ?? null}::uuid)
      )
      select d.* from documents d where coalesce(d.document_group_id, d.document_id) in (select group_id from groups)
    `;
    const documents = rows.map((row) => mapDocument(row as Row));
    const ids = documents.map((d) => d.documentId);
    const refs = ids.length ? await this.sql`
      select a.document_id, 'discussion' as kind, m.message_id as id, u.user_id as owner_user_id
      from service_discussion_attachments a join service_discussion_messages m on m.message_id = a.message_id
        left join users u on u.user_id = m.management_owner_user_id where a.document_id in ${this.sql(ids)}
      union all
      select a.document_id, 'asset', m.asset_id, u.user_id from asset_document_links a
        join managed_assets m on m.asset_id = a.asset_id left join users u on u.user_id = m.created_by
        where a.document_id in ${this.sql(ids)}
      union all
      select a.entity_id, 'knowledge', k.knowledge_id, u.user_id from knowledge_links a
        join knowledge_items k on k.knowledge_id = a.knowledge_id left join users u on u.user_id = k.management_owner_user_id
        where a.entity_type = 'document' and a.entity_id in ${this.sql(ids)}
      union all
      select document_id, content_kind, content_id, owner_user_id from archive_content_document_references
        where document_id in ${this.sql(ids)}
    ` : [];
    return { folders: folderRows.map((row) => mapArchiveFolder(row as Row)), documents,
      references: refs.map((row) => ({ documentId: asString(row.document_id), kind: asString(row.kind), id: asString(row.id), ownerUserId: row.owner_user_id ? asString(row.owner_user_id) : null })) };
  }

  async recordArchiveManagementAudit(actorUserId: string, action: string, targets: ArchiveManagementTarget[]): Promise<void> {
    for (const target of targets) await this.sql`
      insert into archive_management_audit (actor_user_id, action, resource_kind, resource_id, owner_user_id)
      values (${actorUserId}, ${action}, ${target.kind}, ${target.id}, ${target.ownerUserId})
    `;
  }

  async readArchiveContentTargets(kind: ArchiveContentKind, id: string, wholeThread = false): Promise<ArchiveManagementTarget[]> {
    const rows = kind === "discussion" ? await this.sql`
      select message_id as id, management_owner_user_id as owner_id from service_discussion_messages
      where message_id = ${id}::uuid or (${wholeThread} and deleted_at is null and
        coalesce(parent_message_id, message_id) = (select coalesce(parent_message_id, message_id) from service_discussion_messages where message_id = ${id}::uuid))
    ` : kind === "knowledge" ? await this.sql`
      select knowledge_id as id, management_owner_user_id as owner_id from knowledge_items where knowledge_id = ${id}::uuid
    ` : await this.sql`
      select manuscript_id as id, management_owner_user_id as owner_id from manuscripts where manuscript_id = ${id}::uuid
    `;
    return rows.map((row) => ({ kind, id: asString(row.id), ownerUserId: row.owner_id ? asString(row.owner_id) : null }));
  }

  async readArchiveContentDocumentIds(kind: ArchiveContentKind, id: string): Promise<string[]> {
    const rows = await this.sql`select document_id from archive_content_document_references where content_kind = ${kind} and content_id = ${id}::uuid`;
    return rows.map((row) => asString(row.document_id));
  }

  async retainArchiveContentDocuments(kind: ArchiveContentKind, id: string, documentIds: string[]): Promise<void> {
    const [target] = await this.readArchiveContentTargets(kind, id);
    if (!target) throw new Error("Archive content not found");
    if (documentIds.length) await this.sql`
      insert into archive_content_document_references (content_kind, content_id, document_id, owner_user_id)
      select ${kind}, ${id}::uuid, document_id, ${target.ownerUserId}::uuid from documents where document_id in ${this.sql(documentIds)}
      on conflict do nothing
    `;
  }

  async hasOpaqueArchiveContent(): Promise<boolean> {
    const [row] = await this.sql`select exists (select 1 from manuscripts where encryption_enabled)
      or exists (select 1 from manuscript_chapters where body like 'pae1.%')
      or exists (select 1 from manuscript_chapter_versions where body like 'pae1.%') as opaque`;
    return Boolean(row.opaque);
  }

  async createManuscriptDocument(manuscriptId: string, input: CreateDocumentInput): Promise<DocumentRecord> {
    return this.sql.begin(async (sql) => {
      await lockArchiveHierarchy(sql);
      const repo = new PostgresRepository(archiveTransactionConnection(sql));
      if (!(await repo.getManuscript(manuscriptId))) throw new Error("Manuscript not found");
      const document = await repo.createDocument(input);
      await repo.retainArchiveContentDocuments("manuscript", manuscriptId, [document.documentId]);
      return document;
    }) as Promise<DocumentRecord>;
  }

  async healthCheck(): Promise<void> {
    await this.sql`select 1 as ok`;
  }

  async getDatabaseSizeBytes(): Promise<number | null> {
    const rows = await this.sql`select pg_database_size(current_database())::text as size_bytes`;
    const size = Number(rows[0]?.size_bytes);
    return Number.isFinite(size) && size >= 0 ? size : null;
  }

  private async nextCaseNumber(): Promise<string> {
    const year = new Date().getUTCFullYear();
    try {
      const rows = await this.sql`
        insert into work_item_number_sequences (tenant_id, year, prefix, next_sequence)
        values (${DEFAULT_TENANT_ID}, ${year}, ${CASE_NUMBER_PREFIX}, ${CASE_NUMBER_START + 1})
        on conflict (tenant_id, year, prefix)
        do update set next_sequence = work_item_number_sequences.next_sequence + 1, updated_at = now()
        returning next_sequence - 1 as sequence_value
      `;
      return `${CASE_NUMBER_PREFIX}-${year}-${asNumber(rows[0]?.sequence_value)}`;
    } catch (error) {
      console.warn("Falling back to work-item number scan because sequence table is unavailable.", error);
      const rows = await this.sql`
        select coalesce(max(substring(number from ${`^${CASE_NUMBER_PREFIX}-${year}-([0-9]+)$`})::integer), ${CASE_NUMBER_START - 1}) as max_sequence
        from work_items
        where number ~ ${`^${CASE_NUMBER_PREFIX}-${year}-[0-9]+$`}
      `;
      return `${CASE_NUMBER_PREFIX}-${year}-${asNumber(rows[0]?.max_sequence) + 1}`;
    }
  }

  async previewNextCaseNumber(): Promise<string> {
    const year = new Date().getUTCFullYear();
    try {
      const rows = await this.sql`
        select next_sequence
        from work_item_number_sequences
        where tenant_id = ${DEFAULT_TENANT_ID}
          and year = ${year}
          and prefix = ${CASE_NUMBER_PREFIX}
        limit 1
      `;
      if (rows[0]) return `${CASE_NUMBER_PREFIX}-${year}-${asNumber(rows[0].next_sequence)}`;
    } catch (error) {
      console.warn("Falling back to work-item number scan because sequence table is unavailable.", error);
    }

    const rows = await this.sql`
      select coalesce(max(substring(number from ${`^${CASE_NUMBER_PREFIX}-${year}-([0-9]+)$`})::integer), ${CASE_NUMBER_START - 1}) as max_sequence
      from work_items
      where number ~ ${`^${CASE_NUMBER_PREFIX}-${year}-[0-9]+$`}
    `;
    return `${CASE_NUMBER_PREFIX}-${year}-${asNumber(rows[0]?.max_sequence) + 1}`;
  }

  private async advanceCaseNumberSequence(caseNumber: string): Promise<void> {
    const match = caseNumber.match(new RegExp(`^${CASE_NUMBER_PREFIX}-(\\d{4})-(\\d+)$`));
    if (!match) return;
    try {
      await this.sql`
        insert into work_item_number_sequences (tenant_id, year, prefix, next_sequence)
        values (${DEFAULT_TENANT_ID}, ${Number(match[1])}, ${CASE_NUMBER_PREFIX}, ${Number(match[2]) + 1})
        on conflict (tenant_id, year, prefix)
        do update set
          next_sequence = greatest(work_item_number_sequences.next_sequence, excluded.next_sequence),
          updated_at = now()
      `;
    } catch (error) {
      console.warn("Unable to advance work-item number sequence.", error);
    }
  }

  async getUserByEmail(email: string): Promise<PublicUser | null> {
    const rows = await this.sql`
      select u.user_id, u.name, u.email, u.role, u.created_at, u.organization_id as tenant_id,
        coalesce(uc.must_change_password, false) as must_change_password
      from users u
      left join user_credentials uc on uc.user_id = u.user_id
      where lower(u.email) = lower(${email})
      limit 1
    `;
    return rows[0] ? mapUser(rows[0] as Row) : null;
  }

  async getUserById(userId: string): Promise<PublicUser | null> {
    const rows = await this.sql`
      select u.user_id, u.name, u.email, u.role, u.created_at, u.organization_id as tenant_id,
        coalesce(uc.must_change_password, false) as must_change_password
      from users u
      left join user_credentials uc on uc.user_id = u.user_id
      where u.user_id = ${userId}
      limit 1
    `;
    return rows[0] ? mapUser(rows[0] as Row) : null;
  }

  async listUsers(): Promise<PublicUser[]> {
    const rows = await this.sql`
      select u.user_id, u.name, u.email, u.role, u.created_at, u.organization_id as tenant_id,
        coalesce(uc.must_change_password, false) as must_change_password
      from users u
      left join user_credentials uc on uc.user_id = u.user_id
      where lower(u.email) <> lower(${SYSTEM_AUDIT_USER_EMAIL})
      order by u.role, u.name
    `;
    return rows.map((row) => mapUser(row as Row));
  }

  async getUserCredential(userId: string): Promise<UserCredential | null> {
    const rows = await this.sql`
      select password_hash, password_salt, password_algorithm, password_iterations, must_change_password
      from user_credentials
      where user_id = ${userId}
      limit 1
    `;
    return rows[0] ? mapUserCredential(rows[0] as Row) : null;
  }

  async updateUserPassword(userId: string, credential: UserCredential, options: UpdateUserPasswordOptions = {}): Promise<PublicUser | null> {
    if (options.replacementSession && options.replacementSession.userId !== userId) {
      throw new Error("Replacement session must belong to the updated user.");
    }
    const changed = await this.sql.begin(async (sql) => {
      // Login/session creation takes the same lock, so a password verified before
      // a concurrent reset cannot create a new session after that reset commits.
      const users = await sql`select user_id from users where user_id = ${userId} for update`;
      if (!users.length) return false;
      if (options.expectedPasswordHash !== undefined) {
        const current = await sql`select password_hash from user_credentials where user_id = ${userId}`;
        if ((current[0]?.password_hash ?? null) !== options.expectedPasswordHash) return false;
      }
      await sql`
      insert into user_credentials (
        user_id,
        password_hash,
        password_salt,
        password_algorithm,
        password_iterations,
        must_change_password,
        password_changed_at,
        temporary_password_issued_at,
        failed_login_count,
        locked_until,
        updated_at
      )
      values (
        ${userId},
        ${credential.passwordHash},
        ${credential.passwordSalt},
        ${credential.passwordAlgorithm},
        ${credential.passwordIterations},
        ${credential.mustChangePassword},
        ${credential.mustChangePassword ? null : new Date().toISOString()},
        ${credential.mustChangePassword ? new Date().toISOString() : null},
        0,
        null,
        now()
      )
      on conflict (user_id) do update set
        password_hash = excluded.password_hash,
        password_salt = excluded.password_salt,
        password_algorithm = excluded.password_algorithm,
        password_iterations = excluded.password_iterations,
        must_change_password = excluded.must_change_password,
        password_changed_at = excluded.password_changed_at,
        temporary_password_issued_at = excluded.temporary_password_issued_at,
        failed_login_count = 0,
        locked_until = null,
        updated_at = now()
      `;
      await sql`update auth_sessions set revoked_at = now() where user_id = ${userId} and revoked_at is null`;
      const session = options.replacementSession;
      if (session) {
        await sql`
          insert into auth_sessions (user_id, current_tenant_id, token_hash, expires_at)
          values (${userId}, ${session.currentTenantId ?? null}, ${session.tokenHash}, ${session.expiresAt})
        `;
      }
      return true;
    });
    return changed ? this.getUserById(userId) : null;
  }

  async getDefaultTenantForUser(userId: string): Promise<string | null> {
    const rows = await this.sql`
      select coalesce(
        u.organization_id,
        (
          select ur.organization_id
          from user_roles ur
          where ur.user_id = u.user_id
          order by ur.created_at asc
          limit 1
        ),
        ${DEFAULT_TENANT_ID}::uuid
      ) as tenant_id
      from users u
      where u.user_id = ${userId}
      limit 1
    `;
    return rows[0]?.tenant_id ? asString(rows[0].tenant_id) : null;
  }

  async createAuthSession(input: CreateAuthSessionInput, expectedPasswordHash?: string | null): Promise<boolean> {
    return this.sql.begin(async (sql) => {
      const users = await sql`select user_id from users where user_id = ${input.userId} for update`;
      if (!users.length) return false;
      if (expectedPasswordHash !== undefined) {
        const current = await sql`select password_hash from user_credentials where user_id = ${input.userId}`;
        if ((current[0]?.password_hash ?? null) !== expectedPasswordHash) return false;
      }
      await sql`
        delete from auth_sessions
        where expires_at < now() - interval '7 days'
           or (revoked_at is not null and revoked_at < now() - interval '7 days')
      `;
      await sql`
        insert into auth_sessions (user_id, current_tenant_id, token_hash, expires_at)
        values (${input.userId}, ${input.currentTenantId ?? null}, ${input.tokenHash}, ${input.expiresAt})
      `;
      return true;
    });
  }

  async getUserBySessionTokenHash(tokenHash: string, refreshExpiresAt?: string): Promise<PublicUser | null> {
    const rows = await this.sql`
      select u.user_id, u.name, u.email, u.role, u.created_at, s.last_seen_at,
        coalesce(s.current_tenant_id, u.organization_id) as tenant_id,
        coalesce(uc.must_change_password, false) as must_change_password
      from auth_sessions s
      join users u on u.user_id = s.user_id
      left join user_credentials uc on uc.user_id = u.user_id
      where s.token_hash = ${tokenHash}
        and s.revoked_at is null
        and s.expires_at > now()
      limit 1
    `;
    if (!rows[0]) return null;
    const lastSeenAt = rows[0].last_seen_at ? new Date(asString(rows[0].last_seen_at)).getTime() : 0;
    if (!lastSeenAt || Date.now() - lastSeenAt >= 10 * 60 * 1000) {
      if (refreshExpiresAt) {
        await this.sql`
          update auth_sessions
          set last_seen_at = now(),
              expires_at = greatest(expires_at, ${refreshExpiresAt}::timestamptz)
          where token_hash = ${tokenHash}
        `;
      } else {
        await this.sql`update auth_sessions set last_seen_at = now() where token_hash = ${tokenHash}`;
      }
    }
    return mapUser(rows[0] as Row);
  }

  async revokeAuthSession(tokenHash: string): Promise<void> {
    await this.sql`
      update auth_sessions
      set revoked_at = now()
      where token_hash = ${tokenHash} and revoked_at is null
    `;
  }

  async listGmailExtensionTokens(): Promise<GmailExtensionToken[]> {
    const rows = await this.sql`
      select
        t.*,
        owner.name as owner_user_name,
        creator.name as created_by_name
      from gmail_extension_tokens t
      join users owner on owner.user_id = t.owner_user_id
      left join users creator on creator.user_id = t.created_by
      where t.tenant_id = ${DEFAULT_TENANT_ID}
      order by t.created_at desc
    `;
    return rows.map((row) => publicGmailExtensionToken(mapGmailExtensionToken(row as Row)));
  }

  async getGmailExtensionTokenByHash(tokenHash: string): Promise<StoredGmailExtensionToken | null> {
    const rows = await this.sql`
      select
        t.*,
        owner.name as owner_user_name,
        creator.name as created_by_name
      from gmail_extension_tokens t
      join users owner on owner.user_id = t.owner_user_id
      left join users creator on creator.user_id = t.created_by
      where t.tenant_id = ${DEFAULT_TENANT_ID}
        and t.token_hash = ${tokenHash}
        and t.revoked_at is null
      limit 1
    `;
    return rows[0] ? mapGmailExtensionToken(rows[0] as Row) : null;
  }

  async createGmailExtensionToken(input: CreateGmailExtensionTokenInput): Promise<GmailExtensionToken> {
    const rows = await this.sql`
      insert into gmail_extension_tokens (
        tenant_id, name, token_hash, scopes, owner_user_id, created_by
      )
      values (
        ${DEFAULT_TENANT_ID}, ${input.name}, ${input.tokenHash}, ${input.scopes}, ${input.ownerUserId}, ${input.createdBy ?? null}
      )
      returning *
    `;
    const created = rows[0] ? await this.getGmailExtensionTokenByHash(asString(rows[0].token_hash)) : null;
    if (!created) throw new Error("Unable to create Gmail extension token.");
    return publicGmailExtensionToken(created);
  }

  async markGmailExtensionTokenUsed(tokenId: string): Promise<void> {
    await this.sql`
      update gmail_extension_tokens
      set last_used_at = now()
      where token_id = ${tokenId}
        and tenant_id = ${DEFAULT_TENANT_ID}
        and revoked_at is null
    `;
  }

  async revokeGmailExtensionToken(tokenId: string): Promise<GmailExtensionToken | null> {
    const rows = await this.sql`
      update gmail_extension_tokens
      set revoked_at = coalesce(revoked_at, now())
      where token_id = ${tokenId}
        and tenant_id = ${DEFAULT_TENANT_ID}
      returning *
    `;
    if (!rows[0]) return null;
    const refreshed = await this.sql`
      select
        t.*,
        owner.name as owner_user_name,
        creator.name as created_by_name
      from gmail_extension_tokens t
      join users owner on owner.user_id = t.owner_user_id
      left join users creator on creator.user_id = t.created_by
      where t.token_id = ${tokenId}
      limit 1
    `;
    return refreshed[0] ? publicGmailExtensionToken(mapGmailExtensionToken(refreshed[0] as Row)) : null;
  }

  private async tagsForCase(caseId: string): Promise<Tag[]> {
    const rows = await this.sql`
      select t.tag_id, t.name, t.color
      from tags t
      join work_item_tags wit on wit.tag_id = t.tag_id
      where wit.work_item_id = ${caseId}
      order by t.name
    `;
    return rows.map((row) => mapTag(row as Row));
  }

  private async tagsForDocument(documentId: string): Promise<Tag[]> {
    const rows = await this.sql`
      select t.tag_id, t.name, t.color
      from tags t
      join document_tags dt on dt.tag_id = t.tag_id
      where dt.document_id = ${documentId}
      order by t.name
    `;
    return rows.map((row) => mapTag(row as Row));
  }

  async getDashboardStats(): Promise<DashboardStats> {
    const cases = await this.listCases();
    const recentUploads = await this.listRecentDocuments(5);
    const today = new Date().toISOString().slice(0, 10);
    const dueSoonEndDate = new Date(`${today}T00:00:00.000Z`);
    dueSoonEndDate.setUTCDate(dueSoonEndDate.getUTCDate() + 7);
    const upcomingEndDate = new Date(`${today}T00:00:00.000Z`);
    upcomingEndDate.setUTCDate(upcomingEndDate.getUTCDate() + 14);
    const dueSoonEnd = dueSoonEndDate.toISOString().slice(0, 10);
    const upcomingEnd = upcomingEndDate.toISOString().slice(0, 10);
    const taskGroups = await Promise.all(
      cases.map(async (caseRecord) =>
        (await this.listTasks(caseRecord.caseId)).map((task) => ({
          ...task,
          caseNumber: caseRecord.caseNumber,
          caseTitle: caseRecord.propertyAddress
        }))
      )
    );
    const openTasks = taskGroups.flat().filter((task) => task.status !== "Done");
    const priorityRank: Record<TaskRecord["priority"], number> = { Urgent: 0, High: 1, Normal: 2, Low: 3 };
    const sortTasks = (items: TaskRecord[]) =>
      [...items].sort(
        (a, b) =>
          a.dueDate.localeCompare(b.dueDate) ||
          (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9) ||
          a.title.localeCompare(b.title)
      );
    const activeUpcomingCases = cases.filter(
      (item) =>
        item.status !== "Closed" &&
        item.status !== "Cancelled" &&
        item.closingDate >= today &&
        item.closingDate <= upcomingEnd
    );
    return {
      totalCases: cases.length,
      activeCases: cases.filter((item) => item.status === "Active").length,
      closingSoon: cases.filter((item) => item.status === "Closing Soon").length,
      pendingCases: cases.filter((item) => item.status === "Pending").length,
      recentlyUpdatedCases: cases.slice(0, 5),
      recentUploads,
      casesByStatus: [...new Set(cases.map((item) => item.status))].map((status) => ({
        status,
        count: cases.filter((item) => item.status === status).length
      })),
      workQueue: {
        upcomingCases: activeUpcomingCases.slice(0, 8),
        overdueTasks: sortTasks(openTasks.filter((task) => task.dueDate < today)).slice(0, 8),
        dueSoonTasks: sortTasks(openTasks.filter((task) => task.dueDate >= today && task.dueDate <= dueSoonEnd)).slice(0, 8),
        blockedTasks: sortTasks(openTasks.filter((task) => task.status === "Blocked")).slice(0, 8)
      }
    };
  }

  async listCases(filters: CaseFilters = {}): Promise<CaseRecord[]> {
    const archiveStatus = filters.archiveStatus ?? "active";
    const rows =
      archiveStatus === "archived"
        ? await this.sql`
            select wi.*, c.party_organization_id, po.name as party_organization_name
            from work_items wi
            left join cases c on c.case_id = wi.work_item_id
            left join party_organizations po on po.party_organization_id = c.party_organization_id and po.deleted_at is null
            where wi.deleted_at is not null
            order by wi.updated_at desc
          `
        : archiveStatus === "all"
          ? await this.sql`
              select wi.*, c.party_organization_id, po.name as party_organization_name
              from work_items wi
              left join cases c on c.case_id = wi.work_item_id
              left join party_organizations po on po.party_organization_id = c.party_organization_id and po.deleted_at is null
              order by wi.updated_at desc
            `
          : await this.sql`
              select wi.*, c.party_organization_id, po.name as party_organization_name
              from work_items wi
              left join cases c on c.case_id = wi.work_item_id
              left join party_organizations po on po.party_organization_id = c.party_organization_id and po.deleted_at is null
              where wi.deleted_at is null
              order by wi.updated_at desc
            `;
    const cases = await Promise.all(rows.map(async (row) => mapCase(row as Row, await this.tagsForCase(asString(row.work_item_id)))));
    const q = filters.q?.toLowerCase();
    const linkedAssetCaseId = filters.assetId ? (await this.getAsset(filters.assetId))?.caseId ?? "__missing__" : "";
    const filtered: CaseRecord[] = [];
    for (const caseRecord of cases) {
      if (filters.status && caseRecord.status !== filters.status) continue;
      if (filters.caseTypeCode && caseRecord.caseTypeCode !== filters.caseTypeCode) continue;
      if (filters.customerOrganizationId && caseRecord.customerOrganizationId !== filters.customerOrganizationId) continue;
      if (filters.assetId && caseRecord.caseId !== linkedAssetCaseId) continue;
      if (filters.tag && !caseRecord.tags.some((tag) => tag.name === filters.tag || tag.tagId === filters.tag)) continue;
      if (filters.closingFrom && caseRecord.closingDate < filters.closingFrom) continue;
      if (filters.closingTo && caseRecord.closingDate > filters.closingTo) continue;
      const contacts = await this.listCaseContacts(caseRecord.caseId);
      if (filters.contactRole && !contacts.some((item) => item.role === filters.contactRole)) continue;
      if (filters.assignedTo) {
        const assignedTasks = await this.listTasks(caseRecord.caseId);
        if (!assignedTasks.some((task) => task.assignedTo === filters.assignedTo && task.status !== "Done")) continue;
      }
      if (q) {
        const haystack = [
          caseRecord.caseNumber,
          caseRecord.propertyAddress,
          caseRecord.customerOrganizationName,
          caseRecord.city,
          caseRecord.notes,
          ...caseRecord.tags.map((tag) => tag.name),
          ...contacts.map(
            (item) =>
              `${contactDisplayName(item.contact)} ${item.contact.firstName} ${item.contact.lastName} ${item.contact.jobTitle} ${item.contact.partyOrganizationName ?? ""}`
          )
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) continue;
      }
      filtered.push(caseRecord);
    }
    return filtered;
  }

  async listCasesPage(filters: CaseFilters = {}, pagination: PaginationParams = {}): Promise<PaginatedResult<CaseRecord>> {
    const pageInfo = normalizePagination(pagination);
    const offset = (pageInfo.page - 1) * pageInfo.pageSize;
    const archiveStatus = filters.archiveStatus ?? "active";
    const q = filters.q?.trim() ?? "";
    const qLike = q ? `%${q}%` : null;
    const status = filters.status || null;
    const tag = filters.tag || null;
    const contactRole = filters.contactRole || null;
    const caseTypeCode = filters.caseTypeCode || null;
    const customerOrganizationId = filters.customerOrganizationId || null;
    const assignedTo = filters.assignedTo || null;
    const assetId = filters.assetId || null;
    const closingFrom = filters.closingFrom || null;
    const closingTo = filters.closingTo || null;
    const sort = filters.sort || "updated";
    const direction = filters.direction || "desc";
    const rows = await this.sql`
      with service_rows as (
        select
          wi.*,
          c.party_organization_id,
          po.name as party_organization_name
        from work_items wi
        left join cases c on c.case_id = wi.work_item_id
        left join party_organizations po on po.party_organization_id = c.party_organization_id and po.deleted_at is null
        where (
            ${archiveStatus} = 'all'
            or (${archiveStatus} = 'active' and wi.deleted_at is null)
            or (${archiveStatus} = 'archived' and wi.deleted_at is not null)
          )
          and (${status}::text is null or wi.status = ${status})
          and (${caseTypeCode}::text is null or wi.work_item_type_code = ${caseTypeCode})
          and (${customerOrganizationId}::text is null or c.party_organization_id::text = ${customerOrganizationId})
          and (${closingFrom}::date is null or wi.target_date >= ${closingFrom}::date)
          and (${closingTo}::date is null or wi.target_date <= ${closingTo}::date)
          and (
            ${assetId}::text is null
            or exists (
              select 1 from managed_assets ma
              where ma.work_item_id = wi.work_item_id
                and ma.asset_id::text = ${assetId}
                and ma.deleted_at is null
            )
          )
          and (
            ${assignedTo}::text is null
            or exists (
              select 1 from tasks t
              where coalesce(t.work_item_id, t.case_id) = wi.work_item_id
                and t.assigned_to::text = ${assignedTo}
                and t.status <> 'Done'
            )
          )
          and (
            ${contactRole}::text is null
            or exists (
              select 1 from work_item_participants wip
              where wip.work_item_id = wi.work_item_id
                and wip.role = ${contactRole}
            )
          )
          and (
            ${tag}::text is null
            or exists (
              select 1
              from case_tags ct
              join tags t on t.tag_id = ct.tag_id
              where ct.case_id = wi.work_item_id
                and (ct.tag_id::text = ${tag} or t.name = ${tag})
            )
          )
          and (
            ${qLike}::text is null
            or concat_ws(' ', wi.number, wi.title, po.name, wi.status, wi.work_item_type_code, wi.summary) ilike ${qLike}
            or exists (
              select 1
              from case_tags ct
              join tags t on t.tag_id = ct.tag_id
              where ct.case_id = wi.work_item_id and t.name ilike ${qLike}
            )
            or exists (
              select 1
              from work_item_participants wip
              join contacts contact on contact.contact_id = wip.contact_id and contact.deleted_at is null
              left join contact_organization_affiliations coa on coa.contact_id = contact.contact_id and coa.is_primary = true
              left join party_organizations contact_po on contact_po.party_organization_id = coa.party_organization_id
              where wip.work_item_id = wi.work_item_id
                and concat_ws(
                  ' ',
                  contact.display_name,
                  contact.first_name,
                  contact.last_name,
                  contact.job_title,
                  contact_po.name
                ) ilike ${qLike}
            )
          )
      )
      select *, count(*) over() as total_count
      from service_rows
      order by
        case when ${sort} = 'number' and ${direction} = 'asc' then number end asc nulls last,
        case when ${sort} = 'number' and ${direction} = 'desc' then number end desc nulls last,
        case when ${sort} = 'title' and ${direction} = 'asc' then lower(title) end asc nulls last,
        case when ${sort} = 'title' and ${direction} = 'desc' then lower(title) end desc nulls last,
        case when ${sort} = 'status' and ${direction} = 'asc' then status end asc nulls last,
        case when ${sort} = 'status' and ${direction} = 'desc' then status end desc nulls last,
        case when ${sort} = 'targetDate' and ${direction} = 'asc' then target_date end asc nulls last,
        case when ${sort} = 'targetDate' and ${direction} = 'desc' then target_date end desc nulls last,
        case when ${sort} = 'customer' and ${direction} = 'asc' then lower(party_organization_name) end asc nulls last,
        case when ${sort} = 'customer' and ${direction} = 'desc' then lower(party_organization_name) end desc nulls last,
        case when ${sort} = 'type' and ${direction} = 'asc' then work_item_type_code end asc nulls last,
        case when ${sort} = 'type' and ${direction} = 'desc' then work_item_type_code end desc nulls last,
        case when ${sort} = 'updated' and ${direction} = 'asc' then updated_at end asc nulls last,
        case when ${sort} = 'updated' and ${direction} = 'desc' then updated_at end desc nulls last,
        updated_at desc
      limit ${pageInfo.pageSize}
      offset ${offset}
    `;
    const cases = await Promise.all(rows.map(async (row) => mapCase(row as Row, await this.tagsForCase(asString(row.work_item_id)))));
    const total = rows[0] ? asNumber((rows[0] as Row).total_count) : 0;
    return paginatedResult(cases, total, pageInfo);
  }

  async getCase(caseId: string, options: { includeArchived?: boolean } = {}): Promise<CaseRecord | null> {
    const rows = options.includeArchived
      ? await this.sql`
          select wi.*, c.party_organization_id, po.name as party_organization_name
          from work_items wi
          left join cases c on c.case_id = wi.work_item_id
          left join party_organizations po on po.party_organization_id = c.party_organization_id and po.deleted_at is null
          where wi.work_item_id = ${caseId}
          limit 1
        `
      : await this.sql`
          select wi.*, c.party_organization_id, po.name as party_organization_name
          from work_items wi
          left join cases c on c.case_id = wi.work_item_id
          left join party_organizations po on po.party_organization_id = c.party_organization_id and po.deleted_at is null
          where wi.work_item_id = ${caseId}
            and wi.deleted_at is null
          limit 1
        `;
    return rows[0] ? mapCase(rows[0] as Row, await this.tagsForCase(caseId)) : null;
  }

  async listCaseTypeTemplates(): Promise<CaseTypeTemplate[]> {
    try {
      const rows = await this.sql`
        select *
        from work_item_types
        where is_active = true
          and tenant_id = ${DEFAULT_TENANT_ID}
        order by sort_order, display_name
      `;
      return rows.map((row) => mapCaseTypeTemplate(row as Row));
    } catch (error) {
      if (!isMissingSchemaFeature(error)) throw error;
      return DEFAULT_CASE_TYPE_TEMPLATES;
    }
  }

  async getCaseTypeTemplate(code: string): Promise<CaseTypeTemplate | null> {
    try {
      const rows = await this.sql`
        select *
        from work_item_types
        where tenant_id = ${DEFAULT_TENANT_ID}
          and type_code = ${code}
        limit 1
      `;
      return rows[0] ? mapCaseTypeTemplate(rows[0] as Row) : null;
    } catch (error) {
      if (!isMissingSchemaFeature(error)) throw error;
      return DEFAULT_CASE_TYPE_TEMPLATES.find((template) => template.code === code) ?? null;
    }
  }

  async createCase(input: CreateCaseInput): Promise<CaseRecord> {
    const caseId = crypto.randomUUID();
    const caseNumber = input.caseNumber?.trim() || (await this.nextCaseNumber());
    const caseTypeCode = input.caseTypeCode || inferCaseTypeCode(input.propertyType, []);
    const customerOrganizationId = input.customerOrganizationId ?? null;
    const primaryLocationText = [input.propertyAddress, input.city, `${input.state} ${input.zipCode}`.trim()]
      .filter(Boolean)
      .join(", ");
    const customFields = {
      realtyCase: true,
      propertyAddress: input.propertyAddress,
      city: input.city,
      state: input.state,
      zipCode: input.zipCode,
      propertyType: input.propertyType,
      customerOrganizationId
    };
    await this.sql.begin(async (sql) => {
      await sql`
        insert into work_items (
          work_item_id, tenant_id, work_item_type_code, number, title, status, target_date,
          value_cents, currency, primary_location_text, summary, custom_fields, closed_at
        ) values (
          ${caseId}, ${DEFAULT_TENANT_ID}, ${caseTypeCode}, ${caseNumber}, ${input.propertyAddress},
          ${input.status}, ${input.closingDate}, ${input.salePriceCents}, 'USD',
          ${primaryLocationText}, ${input.notes}, ${sql.json(customFields)},
          case when ${input.status} = 'Closed' then now() else null end
        )
      `;
      await sql`
        insert into cases (
          case_id, case_number, case_type_code, party_organization_id, property_address, city, state, zip_code, property_type,
          sale_price_cents, status, closing_date, notes
        ) values (
          ${caseId}, ${caseNumber}, ${caseTypeCode}, ${customerOrganizationId}, ${input.propertyAddress}, ${input.city}, ${input.state}, ${input.zipCode},
          ${input.propertyType}, ${input.salePriceCents}, ${input.status}, ${input.closingDate}, ${input.notes}
        )
        on conflict (case_number) do update set
          case_type_code = excluded.case_type_code,
          party_organization_id = excluded.party_organization_id,
          property_address = excluded.property_address,
          city = excluded.city,
          state = excluded.state,
          zip_code = excluded.zip_code,
          property_type = excluded.property_type,
          sale_price_cents = excluded.sale_price_cents,
          status = excluded.status,
          closing_date = excluded.closing_date,
          notes = excluded.notes,
          updated_at = now()
      `;
      for (const tagId of input.tagIds ?? []) {
        await sql`insert into work_item_tags (work_item_id, tag_id) values (${caseId}, ${tagId}) on conflict do nothing`;
        await sql`insert into case_tags (case_id, tag_id) values (${caseId}, ${tagId}) on conflict do nothing`;
      }
    });
    await this.advanceCaseNumberSequence(caseNumber);
    const created = await this.getCase(caseId);
    if (!created) throw new Error("Failed to create case");
    return input.caseTypeCode ? { ...created, caseTypeCode: input.caseTypeCode, caseTypeName: caseTypeName(input.caseTypeCode) } : created;
  }

  async updateCase(caseId: string, input: Partial<CreateCaseInput>): Promise<CaseRecord | null> {
    const current = await this.getCase(caseId);
    if (!current) return null;
    const nextCaseNumber = input.caseNumber ?? current.caseNumber;
    const nextCaseTypeCode = input.caseTypeCode ?? current.caseTypeCode;
    const nextCustomerOrganizationId = input.customerOrganizationId === undefined ? current.customerOrganizationId : input.customerOrganizationId;
    const nextPropertyAddress = input.propertyAddress ?? current.propertyAddress;
    const nextCity = input.city ?? current.city;
    const nextState = input.state ?? current.state;
    const nextZipCode = input.zipCode ?? current.zipCode;
    const nextPropertyType = input.propertyType ?? current.propertyType;
    const nextSalePriceCents = input.salePriceCents ?? current.salePriceCents;
    const nextStatus = input.status ?? current.status;
    const nextClosingDate = input.closingDate ?? current.closingDate;
    const nextNotes = input.notes ?? current.notes;
    const primaryLocationText = [nextPropertyAddress, nextCity, `${nextState} ${nextZipCode}`.trim()].filter(Boolean).join(", ");
    const customFields = {
      realtyCase: true,
      propertyAddress: nextPropertyAddress,
      city: nextCity,
      state: nextState,
      zipCode: nextZipCode,
      propertyType: nextPropertyType,
      customerOrganizationId: nextCustomerOrganizationId ?? null
    };
    await this.sql.begin(async (sql) => {
      await sql`
        update work_items set
          number = ${nextCaseNumber},
          work_item_type_code = ${nextCaseTypeCode},
          title = ${nextPropertyAddress},
          status = ${nextStatus},
          target_date = ${nextClosingDate},
          value_cents = ${nextSalePriceCents},
          primary_location_text = ${primaryLocationText},
          summary = ${nextNotes},
          custom_fields = ${sql.json(customFields)},
          closed_at = case when ${nextStatus} = 'Closed' then coalesce(closed_at, now()) else null end,
          updated_at = now()
        where work_item_id = ${caseId}
      `;
      await sql`
        update cases set
          case_number = ${nextCaseNumber},
          case_type_code = ${nextCaseTypeCode},
          party_organization_id = ${nextCustomerOrganizationId ?? null},
          property_address = ${nextPropertyAddress},
          city = ${nextCity},
          state = ${nextState},
          zip_code = ${nextZipCode},
          property_type = ${nextPropertyType},
          sale_price_cents = ${nextSalePriceCents},
          status = ${nextStatus},
          closing_date = ${nextClosingDate},
          notes = ${nextNotes},
          updated_at = now()
        where case_id = ${caseId}
      `;
      if (input.tagIds) {
        await sql`delete from work_item_tags where work_item_id = ${caseId}`;
        await sql`delete from case_tags where case_id = ${caseId}`;
        for (const tagId of input.tagIds) {
          await sql`insert into work_item_tags (work_item_id, tag_id) values (${caseId}, ${tagId}) on conflict do nothing`;
          await sql`insert into case_tags (case_id, tag_id) values (${caseId}, ${tagId}) on conflict do nothing`;
        }
      }
    });
    const updated = await this.getCase(caseId);
    return input.caseTypeCode && updated
      ? { ...updated, caseTypeCode: input.caseTypeCode, caseTypeName: caseTypeName(input.caseTypeCode) }
      : updated;
  }

  async softDeleteCase(caseId: string): Promise<CaseRecord | null> {
    const rows = await this.sql.begin(async (sql) => {
      await sql`
        update cases set deleted_at = now(), updated_at = now()
        where case_id = ${caseId} and deleted_at is null
      `;
      return sql`
        update work_items
        set deleted_at = now(), updated_at = now()
        where work_item_id = ${caseId} and deleted_at is null
        returning *
      `;
    });
    return rows[0] ? mapCase(rows[0] as Row, await this.tagsForCase(caseId)) : null;
  }

  async restoreCase(caseId: string): Promise<CaseRecord | null> {
    const rows = await this.sql.begin(async (sql) => {
      await sql`
        update cases set deleted_at = null, updated_at = now()
        where case_id = ${caseId} and deleted_at is not null
      `;
      return sql`
        update work_items
        set deleted_at = null, updated_at = now()
        where work_item_id = ${caseId} and deleted_at is not null
        returning *
      `;
    });
    return rows[0] ? mapCase(rows[0] as Row, await this.tagsForCase(caseId)) : null;
  }

  async listPartyOrganizations(input: OrganizationFilters | string = {}): Promise<PartyOrganization[]> {
    return (await this.listPartyOrganizationsPage(input, { page: 1, pageSize: 1000 })).items;
  }

  async listPartyOrganizationsPage(
    input: OrganizationFilters | string = {},
    pagination: PaginationParams = {}
  ): Promise<PaginatedResult<PartyOrganization>> {
    const filters: OrganizationFilters = typeof input === "string" ? { q: input } : input;
    const pageInfo = normalizePagination(pagination);
    const offset = (pageInfo.page - 1) * pageInfo.pageSize;
    const q = filters.q?.trim() ?? "";
    const qLike = q ? `%${q}%` : null;
    const qDigits = q ? phoneDigits(q) : "";
    const email = filters.email || null;
    const phone = filters.phone || null;
    const website = filters.website || null;
    const contacts = filters.contacts || null;
    const services = filters.services || null;
    const assets = filters.assets || null;
    const communications = filters.communications || null;
    const sort = filters.sort || "name";
    const direction = filters.direction || "asc";
    const rows = await this.sql`
      with contact_stats as (
        select
          coa.party_organization_id,
          count(distinct c.contact_id) as contact_count
        from contact_organization_affiliations coa
        join contacts c on c.contact_id = coa.contact_id
        where c.deleted_at is null
        group by coa.party_organization_id
      ),
      service_links as (
        select
          c.party_organization_id,
          wi.work_item_id,
          wi.status
        from cases c
        join work_items wi on wi.work_item_id = c.case_id
        where c.party_organization_id is not null
          and wi.deleted_at is null
        union
        select
          coa.party_organization_id,
          wi.work_item_id,
          wi.status
        from contact_organization_affiliations coa
        join contacts c on c.contact_id = coa.contact_id
        join work_item_participants wip on wip.contact_id = c.contact_id
        join work_items wi on wi.work_item_id = wip.work_item_id
        where coa.party_organization_id is not null
          and c.deleted_at is null
          and wi.deleted_at is null
      ),
      service_stats as (
        select
          party_organization_id,
          count(distinct work_item_id) as related_service_count,
          count(distinct work_item_id) filter (where status not in ('Closed', 'Cancelled')) as open_service_count
        from service_links
        group by party_organization_id
      ),
      asset_stats as (
        select
          party_organization_id,
          count(*) as asset_count
        from managed_assets
        where deleted_at is null
          and party_organization_id is not null
        group by party_organization_id
      ),
      communication_stats as (
        select
          party_organization_id,
          count(*) as communication_count,
          count(*) filter (where status = 'Needs follow-up') as needs_follow_up_communication_count,
          max(occurred_at) as last_communication_at
        from communications
        where deleted_at is null
          and party_organization_id is not null
        group by party_organization_id
      ),
      organization_rows as (
        select
          po.*,
          coalesce(cs.contact_count, 0) as contact_count,
          coalesce(ss.related_service_count, 0) as related_service_count,
          coalesce(ss.open_service_count, 0) as open_service_count,
          coalesce(ast.asset_count, 0) as asset_count,
          coalesce(coms.communication_count, 0) as communication_count,
          coalesce(coms.needs_follow_up_communication_count, 0) as needs_follow_up_communication_count,
          coms.last_communication_at,
          lower(po.name) as sort_name,
          lower(concat_ws(' ', nullif(po.city, ''), nullif(po.state, ''), nullif(po.country, ''))) as sort_location
        from party_organizations po
        left join contact_stats cs on cs.party_organization_id = po.party_organization_id
        left join service_stats ss on ss.party_organization_id = po.party_organization_id
        left join asset_stats ast on ast.party_organization_id = po.party_organization_id
        left join communication_stats coms on coms.party_organization_id = po.party_organization_id
        where po.deleted_at is null
          and po.tenant_id = ${DEFAULT_TENANT_ID}
      )
      select *, count(*) over() as total_count
      from organization_rows
      where (
          ${email}::text is null
          or (${email}::text = 'has' and nullif(trim(email), '') is not null)
          or (${email}::text = 'missing' and nullif(trim(email), '') is null)
        )
        and (
          ${phone}::text is null
          or (${phone}::text = 'has' and nullif(trim(phone), '') is not null)
          or (${phone}::text = 'missing' and nullif(trim(phone), '') is null)
        )
        and (
          ${website}::text is null
          or (${website}::text = 'has' and nullif(trim(website), '') is not null)
          or (${website}::text = 'missing' and nullif(trim(website), '') is null)
        )
        and (
          ${contacts}::text is null
          or (${contacts}::text = 'has' and contact_count > 0)
          or (${contacts}::text = 'none' and contact_count = 0)
        )
        and (
          ${services}::text is null
          or (${services}::text = 'has' and related_service_count > 0)
          or (${services}::text = 'open' and open_service_count > 0)
          or (${services}::text = 'none' and related_service_count = 0)
        )
        and (
          ${assets}::text is null
          or (${assets}::text = 'has' and asset_count > 0)
          or (${assets}::text = 'none' and asset_count = 0)
        )
        and (
          ${communications}::text is null
          or (${communications}::text = 'has' and communication_count > 0)
          or (${communications}::text = 'needs-follow-up' and needs_follow_up_communication_count > 0)
          or (${communications}::text = 'none' and communication_count = 0)
        )
        and (
          ${qLike}::text is null
          or concat_ws(
            ' ',
            name,
            type,
            tax_id_value,
            email,
            phone,
            fax,
            website,
            address_line1,
            address_line2,
            city,
            state,
            zip_code,
            country,
            notes
          ) ilike ${qLike}
          or (${qDigits} <> '' and regexp_replace(coalesce(phone, ''), '[^0-9]+', '', 'g') like ${`%${qDigits}%`})
        )
      order by
        case when ${sort} = 'name' and ${direction} = 'asc' then sort_name end asc nulls last,
        case when ${sort} = 'name' and ${direction} = 'desc' then sort_name end desc nulls last,
        case when ${sort} = 'location' and ${direction} = 'asc' then sort_location end asc nulls last,
        case when ${sort} = 'location' and ${direction} = 'desc' then sort_location end desc nulls last,
        case when ${sort} = 'lastCommunication' and ${direction} = 'asc' then last_communication_at end asc nulls last,
        case when ${sort} = 'lastCommunication' and ${direction} = 'desc' then last_communication_at end desc nulls last,
        case when ${sort} = 'updated' and ${direction} = 'asc' then updated_at end asc nulls last,
        case when ${sort} = 'updated' and ${direction} = 'desc' then updated_at end desc nulls last,
        sort_name asc
      limit ${pageInfo.pageSize}
      offset ${offset}
    `;
    const total = rows[0] ? asNumber((rows[0] as Row).total_count) : 0;
    return paginatedResult(rows.map((row) => mapPartyOrganization(row as Row)), total, pageInfo);
  }

  async findPartyOrganizationsByPhone(phone: string): Promise<PartyOrganization[]> {
    const keys = normalizePhoneNumber(phone).matchKeys;
    if (!keys.length) return [];
    const rows = await this.sql`
      select *
      from party_organizations
      where deleted_at is null
        and tenant_id = ${DEFAULT_TENANT_ID}
        and regexp_replace(coalesce(phone, ''), '[^0-9]+', '', 'g') = any(${keys}::text[])
      order by name
      limit 20
    `;
    return rows.map((row) => mapPartyOrganization(row as Row));
  }

  async getPartyOrganization(partyOrganizationId: string): Promise<PartyOrganization | null> {
    const rows = await this.sql`
      select *
      from party_organizations
      where party_organization_id = ${partyOrganizationId}
        and tenant_id = ${DEFAULT_TENANT_ID}
        and deleted_at is null
      limit 1
    `;
    return rows[0] ? mapPartyOrganization(rows[0] as Row) : null;
  }

  async createPartyOrganization(input: CreatePartyOrganizationInput): Promise<PartyOrganization> {
    const rows = await this.sql`
      insert into party_organizations (
        tenant_id, organization_id, name, type, tax_id_type, tax_id_value, website, email, phone, fax,
        address_line1, address_line2, city, state, zip_code, country, notes
      )
      values (
        ${DEFAULT_TENANT_ID}, ${DEFAULT_ORGANIZATION_ID}, ${input.name}, ${input.type}, ${input.taxIdType}, ${input.taxIdValue},
        ${input.website}, ${input.email}, ${input.phone}, ${input.fax}, ${input.addressLine1},
        ${input.addressLine2}, ${input.city}, ${input.state}, ${input.zipCode}, ${input.country}, ${input.notes}
      )
      returning *
    `;
    return mapPartyOrganization(rows[0] as Row);
  }

  async updatePartyOrganization(
    partyOrganizationId: string,
    input: Partial<CreatePartyOrganizationInput>
  ): Promise<PartyOrganization | null> {
    const current = await this.getPartyOrganization(partyOrganizationId);
    if (!current) return null;
    const rows = await this.sql`
      update party_organizations set
        name = ${input.name ?? current.name},
        type = ${input.type ?? current.type},
        tax_id_type = ${input.taxIdType ?? current.taxIdType},
        tax_id_value = ${input.taxIdValue ?? current.taxIdValue},
        website = ${input.website ?? current.website},
        email = ${input.email ?? current.email},
        phone = ${input.phone ?? current.phone},
        fax = ${input.fax ?? current.fax},
        address_line1 = ${input.addressLine1 ?? current.addressLine1},
        address_line2 = ${input.addressLine2 ?? current.addressLine2},
        city = ${input.city ?? current.city},
        state = ${input.state ?? current.state},
        zip_code = ${input.zipCode ?? current.zipCode},
        country = ${input.country ?? current.country},
        notes = ${input.notes ?? current.notes},
        updated_at = now()
      where party_organization_id = ${partyOrganizationId} and deleted_at is null
        and tenant_id = ${DEFAULT_TENANT_ID}
      returning *
    `;
    return rows[0] ? mapPartyOrganization(rows[0] as Row) : null;
  }

  async softDeletePartyOrganization(partyOrganizationId: string): Promise<PartyOrganization | null> {
    const rows = await this.sql`
      update party_organizations
      set deleted_at = now(), updated_at = now()
      where party_organization_id = ${partyOrganizationId} and deleted_at is null
        and tenant_id = ${DEFAULT_TENANT_ID}
      returning *
    `;
    return rows[0] ? mapPartyOrganization(rows[0] as Row) : null;
  }

  async listPartyOrganizationContacts(partyOrganizationId: string): Promise<Contact[]> {
    const rows = await this.sql`
      select c.*, po.party_organization_id, po.name as party_organization_name
      from contact_organization_affiliations coa
      join contacts c on c.contact_id = coa.contact_id
      join party_organizations po on po.party_organization_id = coa.party_organization_id
      where coa.party_organization_id = ${partyOrganizationId}
        and c.deleted_at is null
        and po.tenant_id = ${DEFAULT_TENANT_ID}
        and po.deleted_at is null
      order by lower(coalesce(nullif(c.display_name, ''), trim(c.first_name || ' ' || c.last_name)))
    `;
    return rows.map((row) => mapContact(row as Row));
  }

  async listPartyOrganizationCases(partyOrganizationId: string): Promise<CaseContact[]> {
    const rows = await this.sql`
      select
        wip.work_item_id as relation_case_id, wip.contact_id as relation_contact_id, wip.role as relation_role,
        c.contact_id as contact_id, c.display_name as display_name, c.first_name as first_name, c.last_name as last_name,
        c.job_title as job_title, c.email as email, c.phone as phone, c.address as address,
        c.notes as contact_notes, c.created_at as contact_created_at, c.updated_at as contact_updated_at,
        po.party_organization_id as party_organization_id, po.name as party_organization_name,
        wi.*
      from contact_organization_affiliations coa
      join party_organizations po on po.party_organization_id = coa.party_organization_id
      join contacts c on c.contact_id = coa.contact_id
      join work_item_participants wip on wip.contact_id = c.contact_id
      join work_items wi on wi.work_item_id = wip.work_item_id
      where coa.party_organization_id = ${partyOrganizationId}
        and po.tenant_id = ${DEFAULT_TENANT_ID}
        and po.deleted_at is null
        and c.deleted_at is null
        and wi.deleted_at is null
      order by wi.updated_at desc, lower(coalesce(nullif(c.display_name, ''), trim(c.first_name || ' ' || c.last_name)))
    `;
    return Promise.all(
      rows.map(async (row) => {
        const tags = await this.tagsForCase(asString(row.relation_case_id));
        return {
          caseId: asString(row.relation_case_id),
          contactId: asString(row.relation_contact_id),
          role: asString(row.relation_role) as ContactRole,
          contact: {
            contactId: asString(row.contact_id),
            displayName: contactRowDisplayName(row as Row),
            firstName: asString(row.first_name) || contactRowDisplayName(row as Row),
            lastName: asString(row.last_name),
            partyOrganizationId: row.party_organization_id ? asString(row.party_organization_id) : null,
            partyOrganizationName: row.party_organization_name ? asString(row.party_organization_name) : null,
            jobTitle: asString(row.job_title),
            email: asString(row.email),
            phone: asString(row.phone),
            address: asString(row.address),
            notes: asString(row.contact_notes),
            createdAt: asString(row.contact_created_at),
            updatedAt: asString(row.contact_updated_at)
          },
          case: mapCase(row as Row, tags)
        };
      })
    );
  }

  async listAssets(filters: AssetFilters = {}): Promise<ManagedAsset[]> {
    const rows = await this.sql`
      select
        ma.*,
        po.name as party_organization_name,
        wi.number as case_number,
        wi.title as case_title,
        parent.name as parent_asset_name,
        (
          select count(*)
          from asset_credentials ac
          where ac.asset_id = ma.asset_id
            and ac.deleted_at is null
        ) as credential_count,
        (
          select count(*)
          from managed_assets child
          where child.parent_asset_id = ma.asset_id
            and child.deleted_at is null
        ) as child_asset_count,
        (
          select count(*)
          from asset_document_links adl
          join documents d on d.document_id = adl.document_id
          where adl.asset_id = ma.asset_id
            and adl.deleted_at is null
            and d.deleted_at is null
            and coalesce(d.is_current_version, true) = true
        ) as core_document_count
      from managed_assets ma
      left join party_organizations po on po.party_organization_id = ma.party_organization_id and po.deleted_at is null
      left join work_items wi on wi.work_item_id = ma.work_item_id and wi.deleted_at is null
      left join managed_assets parent on parent.asset_id = ma.parent_asset_id and parent.deleted_at is null
      where ma.tenant_id = ${DEFAULT_TENANT_ID}
        and ma.deleted_at is null
      order by ma.updated_at desc
    `;
    return filterAssets(rows.map((row) => mapManagedAsset(row as Row)), filters);
  }

  async listAssetsPage(filters: AssetFilters = {}, pagination: PaginationParams = {}): Promise<PaginatedResult<ManagedAsset>> {
    const pageInfo = normalizePagination(pagination);
    const offset = (pageInfo.page - 1) * pageInfo.pageSize;
    const q = filters.q?.trim() ?? "";
    const qLike = q ? `%${q}%` : null;
    const type = filters.type || null;
    const status = filters.status || null;
    const partyOrganizationId = filters.partyOrganizationId || null;
    const caseId = filters.caseId || null;
    const parentAssetId = filters.parentAssetId || null;
    const organization = filters.organization || null;
    const service = filters.service || null;
    const parent = filters.parent || null;
    const credentials = filters.credentials || null;
    const identifiers = filters.identifiers || null;
    const sort = filters.sort || "updated";
    const direction = filters.direction || "desc";
    const rows = await this.sql`
      with asset_rows as (
        select
          ma.*,
          po.name as party_organization_name,
          wi.number as case_number,
          wi.title as case_title,
          parent_asset.name as parent_asset_name,
          (
            select count(*)
            from asset_credentials ac
            where ac.asset_id = ma.asset_id
              and ac.deleted_at is null
          ) as credential_count,
          (
            select count(*)
            from managed_assets child
            where child.parent_asset_id = ma.asset_id
              and child.deleted_at is null
          ) as child_asset_count,
          (
            select count(*)
            from asset_document_links adl
            join documents d on d.document_id = adl.document_id
            where adl.asset_id = ma.asset_id
              and adl.deleted_at is null
              and d.deleted_at is null
              and coalesce(d.is_current_version, true) = true
          ) as core_document_count
        from managed_assets ma
        left join party_organizations po on po.party_organization_id = ma.party_organization_id and po.deleted_at is null
        left join work_items wi on wi.work_item_id = ma.work_item_id and wi.deleted_at is null
        left join managed_assets parent_asset on parent_asset.asset_id = ma.parent_asset_id and parent_asset.deleted_at is null
        where ma.tenant_id = ${DEFAULT_TENANT_ID}
          and ma.deleted_at is null
      )
      select *, count(*) over() as total_count
      from asset_rows
      where (${type}::text is null or asset_type = ${type})
        and (${status}::text is null or status = ${status})
        and (${partyOrganizationId}::text is null or party_organization_id::text = ${partyOrganizationId})
        and (${caseId}::text is null or work_item_id::text = ${caseId})
        and (${parentAssetId}::text is null or parent_asset_id::text = ${parentAssetId})
        and (
          ${organization}::text is null
          or (${organization}::text = 'linked' and party_organization_id is not null)
          or (${organization}::text = 'unlinked' and party_organization_id is null)
        )
        and (
          ${service}::text is null
          or (${service}::text = 'linked' and work_item_id is not null)
          or (${service}::text = 'unlinked' and work_item_id is null)
        )
        and (
          ${parent}::text is null
          or (${parent}::text = 'linked' and parent_asset_id is not null)
          or (${parent}::text = 'unlinked' and parent_asset_id is null)
        )
        and (
          ${credentials}::text is null
          or (${credentials}::text = 'has' and credential_count > 0)
          or (${credentials}::text = 'none' and credential_count = 0)
        )
        and (
          ${identifiers}::text is null
          or (${identifiers}::text = 'missing-network' and nullif(trim(concat_ws('', hostname, lan_ip, wan_ip)), '') is null)
          or (${identifiers}::text = 'missing-hardware' and nullif(trim(concat_ws('', serial_number, mac_address, imei, iccid)), '') is null)
          or (${identifiers}::text = 'missing-phone' and nullif(trim(concat_ws('', phone_number, extension)), '') is null)
        )
        and (
          ${qLike}::text is null
          or concat_ws(
            ' ',
            name,
            asset_type,
            status,
            party_organization_name,
            case_number,
            case_title,
            parent_asset_name,
            manufacturer,
            model,
            serial_number,
            mac_address,
            imei,
            iccid,
            phone_number,
            extension,
            hostname,
            lan_ip,
            wan_ip,
            installed_location,
            notes
          ) ilike ${qLike}
        )
      order by
        case when ${sort} = 'name' and ${direction} = 'asc' then lower(name) end asc nulls last,
        case when ${sort} = 'name' and ${direction} = 'desc' then lower(name) end desc nulls last,
        case when ${sort} = 'type' and ${direction} = 'asc' then asset_type end asc nulls last,
        case when ${sort} = 'type' and ${direction} = 'desc' then asset_type end desc nulls last,
        case when ${sort} = 'organization' and ${direction} = 'asc' then lower(party_organization_name) end asc nulls last,
        case when ${sort} = 'organization' and ${direction} = 'desc' then lower(party_organization_name) end desc nulls last,
        case when ${sort} = 'service' and ${direction} = 'asc' then case_number end asc nulls last,
        case when ${sort} = 'service' and ${direction} = 'desc' then case_number end desc nulls last,
        case when ${sort} = 'installedAt' and ${direction} = 'asc' then installed_at end asc nulls last,
        case when ${sort} = 'installedAt' and ${direction} = 'desc' then installed_at end desc nulls last,
        case when ${sort} = 'lastServiceAt' and ${direction} = 'asc' then last_service_at end asc nulls last,
        case when ${sort} = 'lastServiceAt' and ${direction} = 'desc' then last_service_at end desc nulls last,
        case when ${sort} = 'updated' and ${direction} = 'asc' then updated_at end asc nulls last,
        case when ${sort} = 'updated' and ${direction} = 'desc' then updated_at end desc nulls last,
        updated_at desc
      limit ${pageInfo.pageSize}
      offset ${offset}
    `;
    const total = rows[0] ? asNumber((rows[0] as Row).total_count) : 0;
    return paginatedResult(rows.map((row) => mapManagedAsset(row as Row)), total, pageInfo);
  }

  async findAssetsByPhoneOrExtension(phone: string, extension = ""): Promise<ManagedAsset[]> {
    const phoneKeys = normalizePhoneNumber(phone).matchKeys;
    const extensionKeys = extensionMatchKeys(phone, extension);
    if (!phoneKeys.length && !extensionKeys.length) return [];
    const phoneKeysOrNoMatch = phoneKeys.length ? phoneKeys : ["__no_phone_match__"];
    const extensionKeysOrNoMatch = extensionKeys.length ? extensionKeys : ["__no_extension_match__"];
    const rows = await this.sql`
      select
        ma.*,
        po.name as party_organization_name,
        wi.number as case_number,
        wi.title as case_title,
        parent.name as parent_asset_name,
        (
          select count(*)
          from asset_credentials ac
          where ac.asset_id = ma.asset_id
            and ac.deleted_at is null
        ) as credential_count,
        (
          select count(*)
          from managed_assets child
          where child.parent_asset_id = ma.asset_id
            and child.deleted_at is null
        ) as child_asset_count,
        (
          select count(*)
          from asset_document_links adl
          join documents d on d.document_id = adl.document_id
          where adl.asset_id = ma.asset_id
            and adl.deleted_at is null
            and d.deleted_at is null
            and coalesce(d.is_current_version, true) = true
        ) as core_document_count
      from managed_assets ma
      left join party_organizations po on po.party_organization_id = ma.party_organization_id and po.deleted_at is null
      left join work_items wi on wi.work_item_id = ma.work_item_id and wi.deleted_at is null
      left join managed_assets parent on parent.asset_id = ma.parent_asset_id and parent.deleted_at is null
      where ma.tenant_id = ${DEFAULT_TENANT_ID}
        and ma.deleted_at is null
        and (
          regexp_replace(coalesce(ma.phone_number, ''), '[^0-9]+', '', 'g') = any(${phoneKeysOrNoMatch}::text[])
          or regexp_replace(coalesce(ma.extension, ''), '[^0-9]+', '', 'g') = any(${extensionKeysOrNoMatch}::text[])
        )
      order by ma.updated_at desc
      limit 20
    `;
    return rows.map((row) => mapManagedAsset(row as Row));
  }

  async getAsset(assetId: string): Promise<ManagedAsset | null> {
    const rows = await this.sql`
      select
        ma.*,
        po.name as party_organization_name,
        wi.number as case_number,
        wi.title as case_title,
        parent.name as parent_asset_name,
        (
          select count(*)
          from asset_credentials ac
          where ac.asset_id = ma.asset_id
            and ac.deleted_at is null
        ) as credential_count,
        (
          select count(*)
          from managed_assets child
          where child.parent_asset_id = ma.asset_id
            and child.deleted_at is null
        ) as child_asset_count,
        (
          select count(*)
          from asset_document_links adl
          join documents d on d.document_id = adl.document_id
          where adl.asset_id = ma.asset_id
            and adl.deleted_at is null
            and d.deleted_at is null
            and coalesce(d.is_current_version, true) = true
        ) as core_document_count
      from managed_assets ma
      left join party_organizations po on po.party_organization_id = ma.party_organization_id and po.deleted_at is null
      left join work_items wi on wi.work_item_id = ma.work_item_id and wi.deleted_at is null
      left join managed_assets parent on parent.asset_id = ma.parent_asset_id and parent.deleted_at is null
      where ma.asset_id = ${assetId}
        and ma.tenant_id = ${DEFAULT_TENANT_ID}
        and ma.deleted_at is null
      limit 1
    `;
    return rows[0] ? mapManagedAsset(rows[0] as Row) : null;
  }

  async createAsset(input: CreateManagedAssetInput): Promise<ManagedAsset> {
    const rows = await this.sql`
      insert into managed_assets (
        tenant_id, party_organization_id, work_item_id, parent_asset_id, name, asset_type, status,
        manufacturer, model, serial_number, mac_address, imei, iccid, phone_number,
        extension, hostname, lan_ip, wan_ip, installed_location, installed_at,
        last_service_at, notes, created_by, updated_by
      )
      values (
        ${DEFAULT_TENANT_ID}, ${input.partyOrganizationId ?? null}, ${input.caseId ?? null}, ${input.parentAssetId ?? null}, ${input.name},
        ${input.assetType}, ${input.status}, ${input.manufacturer}, ${input.model},
        ${input.serialNumber}, ${input.macAddress}, ${input.imei}, ${input.iccid},
        ${input.phoneNumber}, ${input.extension}, ${input.hostname}, ${input.lanIp},
        ${input.wanIp}, ${input.installedLocation}, ${input.installedAt || null},
        ${input.lastServiceAt || null}, ${input.notes}, ${input.createdBy ?? null}, ${input.updatedBy ?? input.createdBy ?? null}
      )
      returning asset_id
    `;
    const created = await this.getAsset(asString(rows[0].asset_id));
    if (!created) throw new Error("Failed to create asset");
    return created;
  }

  async updateAsset(assetId: string, input: UpdateManagedAssetInput): Promise<ManagedAsset | null> {
    const current = await this.getAsset(assetId);
    if (!current) return null;
    const partyOrganizationId = (input.partyOrganizationId === undefined ? current.partyOrganizationId : input.partyOrganizationId) ?? null;
    const caseId = (input.caseId === undefined ? current.caseId : input.caseId) ?? null;
    await this.sql.begin(async (sql) => {
      await sql`
        update managed_assets set
        party_organization_id = ${(input.partyOrganizationId === undefined ? current.partyOrganizationId : input.partyOrganizationId) ?? null},
        work_item_id = ${(input.caseId === undefined ? current.caseId : input.caseId) ?? null},
        parent_asset_id = ${(input.parentAssetId === undefined ? current.parentAssetId : input.parentAssetId) ?? null},
        name = ${input.name ?? current.name},
        asset_type = ${input.assetType ?? current.assetType},
        status = ${input.status ?? current.status},
        manufacturer = ${input.manufacturer ?? current.manufacturer},
        model = ${input.model ?? current.model},
        serial_number = ${input.serialNumber ?? current.serialNumber},
        mac_address = ${input.macAddress ?? current.macAddress},
        imei = ${input.imei ?? current.imei},
        iccid = ${input.iccid ?? current.iccid},
        phone_number = ${input.phoneNumber ?? current.phoneNumber},
        extension = ${input.extension ?? current.extension},
        hostname = ${input.hostname ?? current.hostname},
        lan_ip = ${input.lanIp ?? current.lanIp},
        wan_ip = ${input.wanIp ?? current.wanIp},
        installed_location = ${input.installedLocation ?? current.installedLocation},
        installed_at = ${(input.installedAt === undefined ? current.installedAt : input.installedAt || null) ?? null},
        last_service_at = ${(input.lastServiceAt === undefined ? current.lastServiceAt : input.lastServiceAt || null) ?? null},
        notes = ${input.notes ?? current.notes},
        updated_by = ${input.updatedBy ?? null},
        updated_at = now()
      where asset_id = ${assetId}
        and tenant_id = ${DEFAULT_TENANT_ID}
        and deleted_at is null
      `;
      await sql`
        update asset_credentials
        set party_organization_id = ${partyOrganizationId},
            work_item_id = ${caseId},
            updated_at = now()
        where asset_id = ${assetId}
          and tenant_id = ${DEFAULT_TENANT_ID}
          and deleted_at is null
          and (
            party_organization_id is distinct from ${partyOrganizationId}
            or work_item_id is distinct from ${caseId}
          )
      `;
    });
    return this.getAsset(assetId);
  }

  async softDeleteAsset(assetId: string): Promise<ManagedAsset | null> {
    const current = await this.getAsset(assetId);
    if (!current) return null;
    await this.sql`
      update managed_assets
      set deleted_at = now(), updated_at = now()
      where asset_id = ${assetId}
        and tenant_id = ${DEFAULT_TENANT_ID}
        and deleted_at is null
    `;
    return { ...current, deletedAt: new Date().toISOString() };
  }

  private async assetDocumentLinkRows(filters: {
    assetId?: string | null;
    assetDocumentLinkId?: string | null;
  }): Promise<AssetDocumentLink[]> {
    const assetId = filters.assetId ?? null;
    const assetDocumentLinkId = filters.assetDocumentLinkId ?? null;
    const rows = await this.sql`
      select
        adl.asset_document_link_id as link_asset_document_link_id,
        adl.asset_id as link_asset_id,
        adl.document_id as link_document_id,
        adl.relationship as link_relationship,
        adl.note as link_note,
        adl.is_pinned as link_is_pinned,
        adl.sort_order as link_sort_order,
        adl.created_by as link_created_by,
        adl.updated_by as link_updated_by,
        adl.created_at as link_created_at,
        adl.updated_at as link_updated_at,
        adl.deleted_at as link_deleted_at,
        creator.name as link_created_by_name,
        updater.name as link_updated_by_name,
        d.*,
        uploader.name as uploaded_by_name,
        reviewer.name as reviewed_by_name,
        coalesce(wi.number, c.case_number) as case_number,
        coalesce(wi.title, c.property_address) as case_title,
        c.party_organization_id,
        po.name as party_organization_name
      from asset_document_links adl
      join managed_assets ma on ma.asset_id = adl.asset_id and ma.deleted_at is null
      join documents d on d.document_id = adl.document_id and d.deleted_at is null
      join users uploader on uploader.user_id = d.uploaded_by
      left join users reviewer on reviewer.user_id = d.reviewed_by
      left join users creator on creator.user_id = adl.created_by
      left join users updater on updater.user_id = adl.updated_by
      left join work_items wi on wi.work_item_id = coalesce(d.work_item_id, d.case_id)
        and wi.deleted_at is null
      left join cases c on c.case_id = coalesce(d.work_item_id, d.case_id)
      left join party_organizations po on po.party_organization_id = c.party_organization_id
        and po.deleted_at is null
      where adl.tenant_id = ${DEFAULT_TENANT_ID}
        and adl.deleted_at is null
        and (${assetId}::text is null or adl.asset_id::text = ${assetId})
        and (${assetDocumentLinkId}::text is null or adl.asset_document_link_id::text = ${assetDocumentLinkId})
      order by adl.is_pinned desc, adl.sort_order asc, adl.updated_at desc, d.uploaded_at desc
    `;
    return Promise.all(
      rows.map(async (row) => {
        const record = row as Row;
        const document = mapDocument(record, await this.tagsForDocument(asString(record.document_id)));
        return mapAssetDocumentLink(record, document);
      })
    );
  }

  async listAssetDocumentLinks(assetId: string): Promise<AssetDocumentLink[]> {
    return this.assetDocumentLinkRows({ assetId });
  }

  async getAssetDocumentLink(assetDocumentLinkId: string): Promise<AssetDocumentLink | null> {
    return (await this.assetDocumentLinkRows({ assetDocumentLinkId }))[0] ?? null;
  }

  async linkAssetDocument(input: CreateAssetDocumentLinkInput): Promise<AssetDocumentLink> {
    const existing = await this.sql`
      select asset_document_link_id
      from asset_document_links
      where tenant_id = ${DEFAULT_TENANT_ID}
        and asset_id = ${input.assetId}
        and document_id = ${input.documentId}
        and deleted_at is null
      limit 1
    `;
    if (existing[0]) {
      const updated = await this.updateAssetDocumentLink(asString(existing[0].asset_document_link_id), {
        relationship: input.relationship,
        note: input.note,
        isPinned: input.isPinned,
        sortOrder: input.sortOrder,
        updatedBy: input.updatedBy ?? input.createdBy ?? null
      });
      if (!updated) throw new Error("Failed to update asset document link");
      return updated;
    }

    const rows = await this.sql`
      insert into asset_document_links (
        tenant_id, asset_id, document_id, relationship, note, is_pinned, sort_order, created_by, updated_by
      )
      values (
        ${DEFAULT_TENANT_ID}, ${input.assetId}, ${input.documentId}, ${input.relationship || "Other"},
        ${input.note ?? ""}, ${input.isPinned ?? false}, ${input.sortOrder ?? 0},
        ${input.createdBy ?? null}, ${input.updatedBy ?? input.createdBy ?? null}
      )
      returning asset_document_link_id
    `;
    const created = await this.getAssetDocumentLink(asString(rows[0].asset_document_link_id));
    if (!created) throw new Error("Failed to create asset document link");
    return created;
  }

  async updateAssetDocumentLink(
    assetDocumentLinkId: string,
    input: UpdateAssetDocumentLinkInput
  ): Promise<AssetDocumentLink | null> {
    const current = await this.getAssetDocumentLink(assetDocumentLinkId);
    if (!current) return null;
    await this.sql`
      update asset_document_links
      set relationship = ${input.relationship ?? current.relationship},
          note = ${input.note ?? current.note},
          is_pinned = ${input.isPinned === undefined ? current.isPinned : input.isPinned},
          sort_order = ${input.sortOrder ?? current.sortOrder},
          updated_by = ${input.updatedBy ?? null},
          updated_at = now()
      where asset_document_link_id = ${assetDocumentLinkId}
        and tenant_id = ${DEFAULT_TENANT_ID}
        and deleted_at is null
    `;
    return this.getAssetDocumentLink(assetDocumentLinkId);
  }

  async deleteAssetDocumentLink(assetDocumentLinkId: string): Promise<AssetDocumentLink | null> {
    const current = await this.getAssetDocumentLink(assetDocumentLinkId);
    if (!current) return null;
    await this.sql`
      update asset_document_links
      set deleted_at = now(), updated_at = now()
      where asset_document_link_id = ${assetDocumentLinkId}
        and tenant_id = ${DEFAULT_TENANT_ID}
        and deleted_at is null
    `;
    return { ...current, deletedAt: new Date().toISOString() };
  }

  async listAssetCredentials(assetId: string): Promise<AssetCredential[]> {
    const rows = await this.sql`
      select ac.*, ma.party_organization_id as effective_party_organization_id,
        ma.work_item_id as effective_work_item_id, po.name as party_organization_name, wi.number as case_number
      from asset_credentials ac
      join managed_assets ma on ma.asset_id = ac.asset_id and ma.deleted_at is null
      left join party_organizations po on po.party_organization_id = ma.party_organization_id and po.deleted_at is null
      left join work_items wi on wi.work_item_id = ma.work_item_id and wi.deleted_at is null
      where ac.asset_id = ${assetId}
        and ac.tenant_id = ${DEFAULT_TENANT_ID}
        and ac.deleted_at is null
      order by ac.updated_at desc
    `;
    return rows.map((row) => mapAssetCredential({
      ...(row as Row),
      party_organization_id: row.effective_party_organization_id,
      work_item_id: row.effective_work_item_id
    }));
  }

  async getAssetCredential(credentialId: string): Promise<StoredAssetCredential | null> {
    const rows = await this.sql`
      select ac.*, ma.party_organization_id as effective_party_organization_id,
        ma.work_item_id as effective_work_item_id, po.name as party_organization_name, wi.number as case_number
      from asset_credentials ac
      join managed_assets ma on ma.asset_id = ac.asset_id and ma.deleted_at is null
      left join party_organizations po on po.party_organization_id = ma.party_organization_id and po.deleted_at is null
      left join work_items wi on wi.work_item_id = ma.work_item_id and wi.deleted_at is null
      where ac.credential_id = ${credentialId}
        and ac.tenant_id = ${DEFAULT_TENANT_ID}
        and ac.deleted_at is null
      limit 1
    `;
    return rows[0]
      ? mapStoredAssetCredential({
          ...(rows[0] as Row),
          party_organization_id: rows[0].effective_party_organization_id,
          work_item_id: rows[0].effective_work_item_id
        })
      : null;
  }

  async createAssetCredential(input: CreateAssetCredentialInput): Promise<AssetCredential> {
    const asset = await this.getAsset(input.assetId);
    if (!asset) throw new Error("Asset not found");
    const rows = await this.sql`
      insert into asset_credentials (
        tenant_id, asset_id, party_organization_id, work_item_id, label, credential_type,
        username, login_url, host, notes, encrypted_secret, secret_iv, secret_tag,
        encrypted_private_notes, private_notes_iv, private_notes_tag, encryption_algorithm,
        last_verified_at, rotation_due_at, created_by, updated_by
      )
      values (
        ${DEFAULT_TENANT_ID}, ${input.assetId}, ${asset.partyOrganizationId ?? null}, ${asset.caseId ?? null},
        ${input.label}, ${input.credentialType}, ${input.username}, ${input.loginUrl}, ${input.host},
        ${input.notes}, ${input.encryptedSecret.encryptedValue}, ${input.encryptedSecret.iv},
        ${input.encryptedSecret.tag}, ${input.encryptedPrivateNotes.encryptedValue},
        ${input.encryptedPrivateNotes.iv}, ${input.encryptedPrivateNotes.tag},
        ${input.encryptedSecret.algorithm}, ${input.lastVerifiedAt || null}, ${input.rotationDueAt || null},
        ${input.createdBy ?? null}, ${input.updatedBy ?? input.createdBy ?? null}
      )
      returning credential_id
    `;
    const created = await this.getAssetCredential(asString(rows[0].credential_id));
    if (!created) throw new Error("Failed to create credential");
    return created;
  }

  async updateAssetCredential(
    credentialId: string,
    input: UpdateAssetCredentialInput
  ): Promise<AssetCredential | null> {
    const current = await this.getAssetCredential(credentialId);
    if (!current) return null;
    await this.sql`
      update asset_credentials set
        label = ${input.label ?? current.label},
        credential_type = ${input.credentialType ?? current.credentialType},
        username = ${input.username ?? current.username},
        login_url = ${input.loginUrl ?? current.loginUrl},
        host = ${input.host ?? current.host},
        notes = ${input.notes ?? current.notes},
        encrypted_secret = ${input.encryptedSecret?.encryptedValue ?? current.encryptedSecret},
        secret_iv = ${input.encryptedSecret?.iv ?? current.secretIv},
        secret_tag = ${input.encryptedSecret?.tag ?? current.secretTag},
        encrypted_private_notes = ${input.encryptedPrivateNotes?.encryptedValue ?? current.encryptedPrivateNotes},
        private_notes_iv = ${input.encryptedPrivateNotes?.iv ?? current.privateNotesIv},
        private_notes_tag = ${input.encryptedPrivateNotes?.tag ?? current.privateNotesTag},
        encryption_algorithm = ${input.encryptedSecret?.algorithm ?? input.encryptedPrivateNotes?.algorithm ?? current.encryptionAlgorithm},
        last_verified_at = ${(input.lastVerifiedAt === undefined ? current.lastVerifiedAt : input.lastVerifiedAt || null) ?? null},
        rotation_due_at = ${(input.rotationDueAt === undefined ? current.rotationDueAt : input.rotationDueAt || null) ?? null},
        updated_by = ${input.updatedBy ?? null},
        updated_at = now()
      where credential_id = ${credentialId}
        and tenant_id = ${DEFAULT_TENANT_ID}
        and deleted_at is null
    `;
    const updated = await this.getAssetCredential(credentialId);
    return updated;
  }

  async softDeleteAssetCredential(credentialId: string): Promise<AssetCredential | null> {
    const current = await this.getAssetCredential(credentialId);
    if (!current) return null;
    await this.sql`
      update asset_credentials
      set deleted_at = now(), updated_at = now()
      where credential_id = ${credentialId}
        and tenant_id = ${DEFAULT_TENANT_ID}
        and deleted_at is null
    `;
    return { ...current, deletedAt: new Date().toISOString() };
  }

  private async replacePrimaryContactOrganization(contactId: string, partyOrganizationId?: string | null): Promise<void> {
    if (partyOrganizationId === undefined) return;
    await this.sql`delete from contact_organization_affiliations where contact_id = ${contactId} and is_primary = true`;
    if (!partyOrganizationId) return;
    await this.sql`
      insert into contact_organization_affiliations (contact_id, party_organization_id, is_primary)
      values (${contactId}, ${partyOrganizationId}, true)
      on conflict (contact_id, party_organization_id) do update set is_primary = true
    `;
  }

  async listContacts(input: ContactFilters | string = {}): Promise<Contact[]> {
    return (await this.listContactsPage(input, { page: 1, pageSize: 1000 })).items;
  }

  async listContactsPage(
    input: ContactFilters | string = {},
    pagination: PaginationParams = {}
  ): Promise<PaginatedResult<Contact>> {
    const filters: ContactFilters = typeof input === "string" ? { q: input } : input;
    const pageInfo = normalizePagination(pagination);
    const offset = (pageInfo.page - 1) * pageInfo.pageSize;
    const q = filters.q?.trim() ?? "";
    const qLike = q ? `%${q}%` : null;
    const qDigits = q ? phoneDigits(q) : "";
    const partyOrganizationId = filters.partyOrganizationId || null;
    const noOrganization = filters.partyOrganizationId === "none";
    const email = filters.email || null;
    const phone = filters.phone || null;
    const services = filters.services || null;
    const communications = filters.communications || null;
    const sort = filters.sort || "updated";
    const direction = filters.direction || "desc";
    const rows = await this.sql`
      with service_stats as (
        select
          wip.contact_id,
          count(distinct wi.work_item_id) filter (where wi.deleted_at is null) as related_service_count,
          count(distinct wi.work_item_id) filter (
            where wi.deleted_at is null and wi.status not in ('Closed', 'Cancelled')
          ) as open_service_count
        from work_item_participants wip
        join work_items wi on wi.work_item_id = wip.work_item_id
        where wip.contact_id is not null
        group by wip.contact_id
      ),
      communication_stats as (
        select
          contact_id,
          count(*) as communication_count,
          count(*) filter (where status = 'Needs follow-up') as needs_follow_up_communication_count,
          max(occurred_at) as last_communication_at
        from communications
        where deleted_at is null
          and contact_id is not null
        group by contact_id
      ),
      contact_rows as (
        select
          c.*,
          po.party_organization_id,
          po.name as party_organization_name,
          coalesce(ss.related_service_count, 0) as related_service_count,
          coalesce(ss.open_service_count, 0) as open_service_count,
          coalesce(cs.communication_count, 0) as communication_count,
          coalesce(cs.needs_follow_up_communication_count, 0) as needs_follow_up_communication_count,
          cs.last_communication_at,
          lower(coalesce(nullif(c.display_name, ''), trim(c.first_name || ' ' || c.last_name))) as sort_name,
          lower(coalesce(po.name, '')) as sort_organization
        from contacts c
        left join contact_organization_affiliations coa on coa.contact_id = c.contact_id and coa.is_primary = true
        left join party_organizations po on po.party_organization_id = coa.party_organization_id
          and po.tenant_id = ${DEFAULT_TENANT_ID}
          and po.deleted_at is null
        left join service_stats ss on ss.contact_id = c.contact_id
        left join communication_stats cs on cs.contact_id = c.contact_id
        where c.deleted_at is null
      )
      select *, count(*) over() as total_count
      from contact_rows
      where (${partyOrganizationId}::text is null or party_organization_id::text = ${partyOrganizationId})
        and (${noOrganization}::boolean is false or party_organization_id is null)
        and (
          ${email}::text is null
          or (${email}::text = 'has' and nullif(trim(email), '') is not null)
          or (${email}::text = 'missing' and nullif(trim(email), '') is null)
        )
        and (
          ${phone}::text is null
          or (${phone}::text = 'has' and nullif(trim(phone), '') is not null)
          or (${phone}::text = 'missing' and nullif(trim(phone), '') is null)
        )
        and (
          ${services}::text is null
          or (${services}::text = 'open' and open_service_count > 0)
          or (${services}::text = 'none' and related_service_count = 0)
        )
        and (
          ${communications}::text is null
          or (${communications}::text = 'has' and communication_count > 0)
          or (${communications}::text = 'needs-follow-up' and needs_follow_up_communication_count > 0)
          or (${communications}::text = 'none' and communication_count = 0)
        )
        and (
          ${qLike}::text is null
          or concat_ws(
            ' ',
            display_name,
            first_name,
            last_name,
            job_title,
            party_organization_name,
            email,
            phone,
            address,
            notes
          ) ilike ${qLike}
          or (${qDigits} <> '' and regexp_replace(coalesce(phone, ''), '[^0-9]+', '', 'g') like ${`%${qDigits}%`})
        )
      order by
        case when ${sort} = 'name' and ${direction} = 'asc' then sort_name end asc nulls last,
        case when ${sort} = 'name' and ${direction} = 'desc' then sort_name end desc nulls last,
        case when ${sort} = 'organization' and ${direction} = 'asc' then sort_organization end asc nulls last,
        case when ${sort} = 'organization' and ${direction} = 'desc' then sort_organization end desc nulls last,
        case when ${sort} = 'updated' and ${direction} = 'asc' then updated_at end asc nulls last,
        case when ${sort} = 'updated' and ${direction} = 'desc' then updated_at end desc nulls last,
        updated_at desc
      limit ${pageInfo.pageSize}
      offset ${offset}
    `;
    const total = rows[0] ? asNumber((rows[0] as Row).total_count) : 0;
    return paginatedResult(rows.map((row) => mapContact(row as Row)), total, pageInfo);
  }

  async findContactsByPhone(phone: string): Promise<Contact[]> {
    const keys = normalizePhoneNumber(phone).matchKeys;
    if (!keys.length) return [];
    const rows = await this.sql`
      select c.*, po.party_organization_id, po.name as party_organization_name
      from contacts c
      left join contact_organization_affiliations coa on coa.contact_id = c.contact_id and coa.is_primary = true
      left join party_organizations po on po.party_organization_id = coa.party_organization_id
        and po.tenant_id = ${DEFAULT_TENANT_ID}
        and po.deleted_at is null
      where c.deleted_at is null
        and regexp_replace(coalesce(c.phone, ''), '[^0-9]+', '', 'g') = any(${keys}::text[])
      order by c.updated_at desc
      limit 20
    `;
    return rows.map((row) => mapContact(row as Row));
  }

  async getContact(contactId: string): Promise<Contact | null> {
    const rows = await this.sql`
      select c.*, po.party_organization_id, po.name as party_organization_name
      from contacts c
      left join contact_organization_affiliations coa on coa.contact_id = c.contact_id and coa.is_primary = true
      left join party_organizations po on po.party_organization_id = coa.party_organization_id
        and po.tenant_id = ${DEFAULT_TENANT_ID}
        and po.deleted_at is null
      where c.contact_id = ${contactId} and c.deleted_at is null
      limit 1
    `;
    return rows[0] ? mapContact(rows[0] as Row) : null;
  }

  async createContact(input: CreateContactInput): Promise<Contact> {
    const contactId = crypto.randomUUID();
    await this.sql`
      insert into contacts (contact_id, display_name, first_name, last_name, job_title, email, phone, address, notes)
      values (${contactId}, ${input.displayName}, ${input.firstName}, ${input.lastName}, ${input.jobTitle ?? ""}, ${input.email}, ${input.phone}, ${input.address}, ${input.notes})
    `;
    await this.replacePrimaryContactOrganization(contactId, input.partyOrganizationId);
    const created = await this.getContact(contactId);
    if (!created) throw new Error("Failed to create contact");
    return created;
  }

  async updateContact(contactId: string, input: Partial<CreateContactInput>): Promise<Contact | null> {
    const current = await this.getContact(contactId);
    if (!current) return null;
    await this.sql`
      update contacts set
        display_name = ${input.displayName ?? current.displayName},
        first_name = ${input.firstName ?? current.firstName},
        last_name = ${input.lastName ?? current.lastName},
        job_title = ${input.jobTitle ?? current.jobTitle},
        email = ${input.email ?? current.email},
        phone = ${input.phone ?? current.phone},
        address = ${input.address ?? current.address},
        notes = ${input.notes ?? current.notes},
        updated_at = now()
      where contact_id = ${contactId}
    `;
    await this.replacePrimaryContactOrganization(contactId, input.partyOrganizationId);
    return this.getContact(contactId);
  }

  async deleteContact(contactId: string): Promise<Contact | null> {
    const rows = await this.sql`
      update contacts
      set deleted_at = now(), updated_at = now()
      where contact_id = ${contactId}
        and deleted_at is null
      returning *
    `;
    return rows[0] ? mapContact(rows[0] as Row) : null;
  }

  async listCaseContacts(caseId: string): Promise<CaseContact[]> {
    const rows = await this.sql`
      select wip.work_item_id as case_id, wip.contact_id, wip.role, c.*, po.party_organization_id, po.name as party_organization_name
      from work_item_participants wip
      join contacts c on c.contact_id = wip.contact_id
      left join contact_organization_affiliations coa on coa.contact_id = c.contact_id and coa.is_primary = true
      left join party_organizations po on po.party_organization_id = coa.party_organization_id
        and po.tenant_id = ${DEFAULT_TENANT_ID}
        and po.deleted_at is null
      where wip.work_item_id = ${caseId} and c.deleted_at is null
      order by wip.role, lower(coalesce(nullif(c.display_name, ''), trim(c.first_name || ' ' || c.last_name)))
    `;
    return rows.map((row) => ({
      caseId: asString(row.case_id),
      contactId: asString(row.contact_id),
      role: asString(row.role) as ContactRole,
      contact: mapContact(row as Row)
    }));
  }

  async listContactCases(contactId: string): Promise<CaseContact[]> {
    const rows = await this.sql`
      select
        wip.work_item_id as relation_case_id, wip.contact_id as relation_contact_id, wip.role as relation_role,
        c.contact_id as contact_id, c.display_name as display_name, c.first_name as first_name, c.last_name as last_name,
        c.job_title as job_title, c.email as email, c.phone as phone, c.address as address,
        c.notes as contact_notes, c.created_at as contact_created_at, c.updated_at as contact_updated_at,
        po.party_organization_id as party_organization_id, po.name as party_organization_name,
        wi.*
      from work_item_participants wip
      join contacts c on c.contact_id = wip.contact_id
      left join contact_organization_affiliations coa on coa.contact_id = c.contact_id and coa.is_primary = true
      left join party_organizations po on po.party_organization_id = coa.party_organization_id
        and po.tenant_id = ${DEFAULT_TENANT_ID}
        and po.deleted_at is null
      join work_items wi on wi.work_item_id = wip.work_item_id
      where wip.contact_id = ${contactId} and wi.deleted_at is null and c.deleted_at is null
      order by wi.updated_at desc
    `;
    return Promise.all(
      rows.map(async (row) => {
        const tags = await this.tagsForCase(asString(row.relation_case_id));
        return {
          caseId: asString(row.relation_case_id),
          contactId: asString(row.relation_contact_id),
          role: asString(row.relation_role) as ContactRole,
          contact: {
            contactId: asString(row.contact_id),
            displayName: contactRowDisplayName(row as Row),
            firstName: asString(row.first_name) || contactRowDisplayName(row as Row),
            lastName: asString(row.last_name),
            partyOrganizationId: row.party_organization_id ? asString(row.party_organization_id) : null,
            partyOrganizationName: row.party_organization_name ? asString(row.party_organization_name) : null,
            jobTitle: asString(row.job_title),
            email: asString(row.email),
            phone: asString(row.phone),
            address: asString(row.address),
            notes: asString(row.contact_notes),
            createdAt: asString(row.contact_created_at),
            updatedAt: asString(row.contact_updated_at)
          },
          case: mapCase(row as Row, tags)
        };
      })
    );
  }

  async addCaseContact(caseId: string, contactId: string, role: ContactRole): Promise<CaseContact> {
    await this.sql.begin(async (sql) => {
      await sql`
        insert into work_item_participants (work_item_id, contact_id, role)
        values (${caseId}, ${contactId}, ${role})
        on conflict do nothing
      `;
      await sql`
        insert into case_contacts (case_id, contact_id, role)
        values (${caseId}, ${contactId}, ${role})
        on conflict (case_id, contact_id, role) do nothing
      `;
    });
    const contacts = await this.listCaseContacts(caseId);
    const record = contacts.find((item) => item.contactId === contactId && item.role === role);
    if (!record) throw new Error("Failed to attach contact");
    return record;
  }

  async removeCaseContact(caseId: string, contactId: string, role: ContactRole): Promise<boolean> {
    return this.sql.begin(async (sql) => {
      const workItemRows = await sql`
        delete from work_item_participants
        where work_item_id = ${caseId}
          and contact_id = ${contactId}
          and role = ${role}
        returning participant_id
      `;
      const caseContactRows = await sql`
        delete from case_contacts
        where case_id = ${caseId}
          and contact_id = ${contactId}
          and role = ${role}
        returning contact_id
      `;
      return workItemRows.length > 0 || caseContactRows.length > 0;
    });
  }

  private async listDocumentsForBackup(caseId: string | null): Promise<DocumentRecord[]> {
    const rows = await this.sql`
      select d.*, uploader.name as uploaded_by_name, reviewer.name as reviewed_by_name
      from documents d
      join users uploader on uploader.user_id = d.uploaded_by
      left join users reviewer on reviewer.user_id = d.reviewed_by
      where coalesce(d.work_item_id, d.case_id) is not distinct from ${caseId}::uuid and d.deleted_at is null
      order by coalesce(d.document_group_id, d.document_id), d.version_number desc, d.uploaded_at desc
    `;
    return Promise.all(rows.map(async (row) => mapDocument(row as Row, await this.tagsForDocument(asString(row.document_id)))));
  }

  async listDocuments(caseId: string, filters: DocumentFilters = {}): Promise<DocumentRecord[]> {
    const rows = await this.sql`
      select d.*, uploader.name as uploaded_by_name, reviewer.name as reviewed_by_name
      from documents d
      join users uploader on uploader.user_id = d.uploaded_by
      left join users reviewer on reviewer.user_id = d.reviewed_by
      where coalesce(d.work_item_id, d.case_id) = ${caseId} and d.deleted_at is null
      order by d.uploaded_at desc
    `;
    const documents = await Promise.all(
      rows.map(async (row) => mapDocument(row as Row, await this.tagsForDocument(asString(row.document_id))))
    );
    return documents
      .filter((item) => item.isCurrentVersion !== false)
      .filter((item) => !filters.category || item.category === filters.category)
      .filter((item) => {
        if (!filters.q) return true;
        return `${item.fileName} ${item.originalFileName} ${item.category} ${item.notes} ${item.reviewStatus} ${item.reviewNotes} ${item.tags.map((tag) => tag.name).join(" ")}`
          .toLowerCase()
          .includes(filters.q.toLowerCase());
      });
  }

  async listDocumentsPage(filters: DocumentFilters = {}, pagination: PaginationParams = {}): Promise<PaginatedResult<DocumentRecord>> {
    const pageInfo = normalizePagination(pagination);
    const offset = (pageInfo.page - 1) * pageInfo.pageSize;
    const caseId = filters.caseId || null;
    const assetId = filters.assetId || null;
    const partyOrganizationId = filters.partyOrganizationId || null;
    const category = filters.category || null;
    const folderId = filters.folderId || null;
    const unfiled = filters.unfiled === true;
    const trashed = filters.trashed === true;
    const reviewStatus = filters.reviewStatus || null;
    const tagId = filters.tagId || null;
    const uploadedFrom = filters.uploadedFrom || null;
    const uploadedTo = filters.uploadedTo || null;
    const q = filters.q?.trim() ?? "";
    const qLike = q ? `%${q}%` : null;
    const sort = filters.sort || "uploaded";
    const direction = filters.direction || "desc";
    const rows = await this.sql`
      with document_rows as (
        select
          d.*,
          uploader.name as uploaded_by_name,
          reviewer.name as reviewed_by_name,
          coalesce(wi.number, c.case_number) as case_number,
          coalesce(wi.title, c.property_address) as case_title,
          c.party_organization_id,
          po.name as party_organization_name,
          af.name as folder_name
        from documents d
        join users uploader on uploader.user_id = d.uploaded_by
        left join users reviewer on reviewer.user_id = d.reviewed_by
        left join work_items wi on wi.work_item_id = coalesce(d.work_item_id, d.case_id)
        left join cases c on c.case_id = coalesce(d.work_item_id, d.case_id)
        left join party_organizations po on po.party_organization_id = c.party_organization_id
          and po.deleted_at is null
        left join archive_folders af on af.folder_id = d.folder_id
        where ((${trashed}::boolean and d.deleted_at is not null) or (not ${trashed}::boolean and d.deleted_at is null))
          and coalesce(d.is_current_version, true) = true
          and (wi.work_item_id is null or wi.deleted_at is null)
      )
      select *, count(*) over() as total_count
      from document_rows
      where (${caseId}::text is null or coalesce(work_item_id, case_id)::text = ${caseId})
        and (${assetId}::text is null or exists (
          select 1
          from asset_document_links adl
          where adl.document_id = document_rows.document_id
            and adl.asset_id::text = ${assetId}
            and adl.deleted_at is null
        ))
        and (${partyOrganizationId}::text is null or party_organization_id::text = ${partyOrganizationId})
        and (${category}::text is null or category = ${category})
        and (${folderId}::text is null or folder_id::text = ${folderId})
        and (not ${unfiled}::boolean or folder_id is null)
        and (${reviewStatus}::text is null or review_status = ${reviewStatus})
        and (${tagId}::text is null or exists (
          select 1 from document_tags dt where dt.document_id = document_rows.document_id and dt.tag_id::text = ${tagId}
        ))
        and (${uploadedFrom}::text is null or uploaded_at::date >= ${uploadedFrom}::date)
        and (${uploadedTo}::text is null or uploaded_at::date <= ${uploadedTo}::date)
        and (
          ${qLike}::text is null
          or concat_ws(
            ' ',
            file_name,
            original_file_name,
            category,
            folder_name,
            review_status,
            review_notes,
            notes,
            case_number,
            case_title,
            party_organization_name
          ) ilike ${qLike}
          or exists (
            select 1
            from document_tags dt
            join tags t on t.tag_id = dt.tag_id
            where dt.document_id = document_rows.document_id and t.name ilike ${qLike}
          )
        )
      order by
        case when ${sort} = 'fileName' and ${direction} = 'asc' then personal_archive_natural_sort_key(original_file_name) end asc nulls last,
        case when ${sort} = 'fileName' and ${direction} = 'desc' then personal_archive_natural_sort_key(original_file_name) end desc nulls last,
        case when ${sort} = 'fileType' and ${direction} = 'asc' then lower(case when strpos(original_file_name, '.') > 0 then regexp_replace(original_file_name, '^.*\.', '') else mime_type end) end asc nulls last,
        case when ${sort} = 'fileType' and ${direction} = 'desc' then lower(case when strpos(original_file_name, '.') > 0 then regexp_replace(original_file_name, '^.*\.', '') else mime_type end) end desc nulls last,
        case when ${sort} = 'fileSize' and ${direction} = 'asc' then file_size end asc nulls last,
        case when ${sort} = 'fileSize' and ${direction} = 'desc' then file_size end desc nulls last,
        case when ${sort} = 'folder' and ${direction} = 'asc' then personal_archive_natural_sort_key(coalesce(folder_name, 'Unfiled')) end asc nulls last,
        case when ${sort} = 'folder' and ${direction} = 'desc' then personal_archive_natural_sort_key(coalesce(folder_name, 'Unfiled')) end desc nulls last,
        case when ${sort} = 'category' and ${direction} = 'asc' then category end asc nulls last,
        case when ${sort} = 'category' and ${direction} = 'desc' then category end desc nulls last,
        case when ${sort} = 'reviewStatus' and ${direction} = 'asc' then review_status end asc nulls last,
        case when ${sort} = 'reviewStatus' and ${direction} = 'desc' then review_status end desc nulls last,
        case when ${sort} = 'uploadedBy' and ${direction} = 'asc' then personal_archive_natural_sort_key(uploaded_by_name) end asc nulls last,
        case when ${sort} = 'uploadedBy' and ${direction} = 'desc' then personal_archive_natural_sort_key(uploaded_by_name) end desc nulls last,
        case when ${sort} = 'service' and ${direction} = 'asc' then case_number end asc nulls last,
        case when ${sort} = 'service' and ${direction} = 'desc' then case_number end desc nulls last,
        case when ${sort} = 'customer' and ${direction} = 'asc' then party_organization_name end asc nulls last,
        case when ${sort} = 'customer' and ${direction} = 'desc' then party_organization_name end desc nulls last,
        case when ${sort} = 'uploaded' and ${direction} = 'asc' then uploaded_at end asc nulls last,
        case when ${sort} = 'uploaded' and ${direction} = 'desc' then uploaded_at end desc nulls last,
        case when ${direction} = 'asc' then personal_archive_natural_sort_key(original_file_name) end asc,
        case when ${direction} = 'desc' then personal_archive_natural_sort_key(original_file_name) end desc,
        document_id asc
      limit ${pageInfo.pageSize}
      offset ${offset}
    `;
    const documents = await Promise.all(
      rows.map(async (row) => {
        const rowRecord = row as Row;
        return mapDocument(rowRecord, await this.tagsForDocument(asString(rowRecord.document_id)));
      })
    );
    const total = rows[0] ? asNumber((rows[0] as Row).total_count) : 0;
    return paginatedResult(documents, total, pageInfo);
  }

  async listRecentDocuments(limit: number): Promise<DocumentRecord[]> {
    const rows = await this.sql`
      select d.*, uploader.name as uploaded_by_name, reviewer.name as reviewed_by_name
      from documents d
      join users uploader on uploader.user_id = d.uploaded_by
      left join users reviewer on reviewer.user_id = d.reviewed_by
      join work_items wi on wi.work_item_id = coalesce(d.work_item_id, d.case_id)
      where d.deleted_at is null and wi.deleted_at is null
      order by d.uploaded_at desc
      limit ${limit}
    `;
    const documents = await Promise.all(
      rows.map(async (row) => mapDocument(row as Row, await this.tagsForDocument(asString(row.document_id))))
    );
    return documents.filter((item) => item.isCurrentVersion !== false).slice(0, limit);
  }

  async getDocument(documentId: string, options: { includeDeleted?: boolean } = {}): Promise<DocumentRecord | null> {
    const rows = await this.sql`
      select d.*, uploader.name as uploaded_by_name, reviewer.name as reviewed_by_name, af.name as folder_name
      from documents d
      join users uploader on uploader.user_id = d.uploaded_by
      left join users reviewer on reviewer.user_id = d.reviewed_by
      left join archive_folders af on af.folder_id = d.folder_id
      where d.document_id = ${documentId}
        and (${options.includeDeleted === true}::boolean or d.deleted_at is null)
      limit 1
    `;
    return rows[0] ? mapDocument(rows[0] as Row, await this.tagsForDocument(documentId)) : null;
  }

  async createDocument(input: CreateDocumentInput): Promise<DocumentRecord> {
    const documentGroupId = input.documentGroupId ?? input.documentId;
    const versionNumber = input.versionNumber ?? 1;
    const isCurrentVersion = input.isCurrentVersion ?? true;
    await this.sql.begin(async (sql) => {
      await lockArchiveHierarchy(sql);
      try {
        await sql`
          insert into documents (
            document_id, case_id, work_item_id, document_group_id, version_number, is_current_version,
            file_name, original_file_name, file_size, mime_type,
            category, folder_id, r2_object_key, uploaded_by, notes
          ) values (
            ${input.documentId}, ${input.caseId ?? null}, ${input.caseId ?? null}, ${documentGroupId}, ${versionNumber}, ${isCurrentVersion},
            ${input.fileName}, ${input.originalFileName}, ${input.fileSize}, ${input.mimeType},
            ${input.category}, ${input.folderId ?? null}, ${input.r2ObjectKey}, ${input.uploadedBy}, ${input.notes}
          )
        `;
      } catch (error) {
        if (!isMissingSchemaFeature(error)) throw error;
        await sql`
          insert into documents (
            document_id, case_id, file_name, original_file_name, file_size, mime_type,
            category, r2_object_key, uploaded_by, notes
          ) values (
            ${input.documentId}, ${input.caseId ?? null}, ${input.fileName}, ${input.originalFileName},
            ${input.fileSize}, ${input.mimeType}, ${input.category}, ${input.r2ObjectKey},
            ${input.uploadedBy}, ${input.notes}
          )
        `;
      }
      for (const tagId of input.tagIds ?? []) {
        await sql`insert into document_tags (document_id, tag_id) values (${input.documentId}, ${tagId}) on conflict do nothing`;
      }
    });
    const created = await this.getDocument(input.documentId);
    if (!created) throw new Error("Failed to create document");
    return created;
  }

  async listDocumentVersions(documentId: string): Promise<DocumentRecord[]> {
    const document = await this.getDocument(documentId);
    if (!document) return [];
    try {
      const rows = await this.sql`
        select d.*, uploader.name as uploaded_by_name, reviewer.name as reviewed_by_name, af.name as folder_name
        from documents d
        join users uploader on uploader.user_id = d.uploaded_by
        left join users reviewer on reviewer.user_id = d.reviewed_by
        left join archive_folders af on af.folder_id = d.folder_id
        where d.document_group_id = ${document.documentGroupId}
          and d.deleted_at is null
        order by d.version_number desc, d.uploaded_at desc
      `;
      return Promise.all(
        rows.map(async (row) => mapDocument(row as Row, await this.tagsForDocument(asString(row.document_id))))
      );
    } catch (error) {
      if (!isMissingSchemaFeature(error)) throw error;
      return [document];
    }
  }

  async createDocumentVersion(sourceDocumentId: string, input: CreateDocumentInput) {
    const source = await this.getDocument(sourceDocumentId);
    if (!source) return null;
    const sourceCaseId = source.caseId ?? null;
    const groupId = source.documentGroupId || source.documentId;
    try {
      await this.sql.begin(async (sql) => {
        await lockArchiveHierarchy(sql);
        const versionRows = await sql`
          select document_id, version_number, folder_id
          from documents
          where document_group_id = ${groupId}
            and deleted_at is null
          for update
        `;
        if (!versionRows.length) throw new Error("Document is no longer available for a new version");
        const currentSource = versionRows.find((row) => asString(row.document_id) === sourceDocumentId);
        if (!currentSource) throw new Error("Document is no longer available for a new version");
        const nextVersion = Math.max(0, ...versionRows.map((row) => asNumber(row.version_number) || 1)) + 1;
        await sql`
          insert into documents (
            document_id, case_id, work_item_id, document_group_id, version_number, is_current_version,
            file_name, original_file_name, file_size, mime_type,
            category, folder_id, r2_object_key, uploaded_by, notes, review_status, review_notes
          ) values (
            ${input.documentId}, ${sourceCaseId}, ${sourceCaseId}, ${groupId}, ${nextVersion}, true,
            ${input.fileName}, ${input.originalFileName}, ${input.fileSize}, ${input.mimeType},
            ${input.category}, ${input.folderId ?? (currentSource.folder_id ? asString(currentSource.folder_id) : null)}, ${input.r2ObjectKey}, ${input.uploadedBy}, ${input.notes},
            'needs-review', ''
          )
        `;
        await sql`
          update documents
          set is_current_version = false,
              review_status = 'superseded',
              superseded_by = ${input.documentId},
              superseded_at = now(),
              review_notes = case
                when coalesce(review_notes, '') = '' then ${`Superseded by version ${nextVersion}.`}
                else review_notes
              end
          where document_group_id = ${groupId}
            and document_id <> ${input.documentId}
            and deleted_at is null
            and is_current_version = true
        `;
        const tagIds = input.tagIds?.length ? input.tagIds : source.tags.map((tag) => tag.tagId);
        for (const tagId of tagIds) {
          await sql`
            insert into document_tags (document_id, tag_id)
            values (${input.documentId}, ${tagId})
            on conflict do nothing
          `;
        }
        await sql`
          update asset_document_links adl
          set document_id = ${input.documentId},
              updated_by = ${input.uploadedBy},
              updated_at = now()
          where adl.document_id = ${source.documentId}
            and adl.deleted_at is null
            and not exists (
              select 1
              from asset_document_links existing
              where existing.asset_id = adl.asset_id
                and existing.document_id = ${input.documentId}
                and existing.deleted_at is null
            )
        `;
      });
    } catch (error) {
      if (isMissingSchemaFeature(error)) {
        throw new Error("Document versioning schema has not been migrated yet.");
      }
      throw error;
    }

    const previous = await this.getDocument(source.documentId);
    const current = await this.getDocument(input.documentId);
    if (!current) throw new Error("Failed to create document version");
    return {
      previous: previous ?? source,
      current,
      versions: await this.listDocumentVersions(current.documentId)
    };
  }

  async updateDocument(documentId: string, input: UpdateDocumentInput): Promise<DocumentRecord | null> {
    const existing = await this.getDocument(documentId);
    if (!existing) return null;
    const reviewChanged = input.reviewStatus !== undefined && input.reviewStatus !== existing.reviewStatus;
    await this.sql.begin(async (sql) => {
      if (input.folderId !== undefined) {
        await sql`
          update documents
          set folder_id = ${input.folderId}
          where coalesce(document_group_id, document_id) = ${existing.documentGroupId || existing.documentId}
        `;
      }
      await sql`
        update documents
        set category = ${input.category ?? existing.category},
            notes = ${input.notes ?? existing.notes},
            review_status = ${input.reviewStatus ?? existing.reviewStatus},
            review_notes = ${input.reviewNotes ?? existing.reviewNotes},
            reviewed_by = ${reviewChanged ? input.reviewedBy ?? null : existing.reviewedBy ?? null},
            reviewed_at = ${reviewChanged ? new Date().toISOString() : existing.reviewedAt ?? null}
        where document_id = ${documentId} and deleted_at is null
      `;
      if (input.tagIds) {
        await sql`delete from document_tags where document_id = ${documentId}`;
        for (const tagId of input.tagIds) {
          await sql`
            insert into document_tags (document_id, tag_id)
            values (${documentId}, ${tagId})
            on conflict do nothing
          `;
        }
      }
    });
    return this.getDocument(documentId);
  }

  async softDeleteDocument(
    documentId: string,
    options: { retainObject?: boolean; entireGroup?: boolean } = {}
  ): Promise<DocumentRecord | null> {
    const source = await this.getDocument(documentId);
    if (!source) return null;
    const deletedRows = await this.sql.begin(async (sql) => {
      const deleted = options.entireGroup
        ? await sql`
            update documents
            set deleted_at = now()
            where coalesce(document_group_id, document_id) = ${source.documentGroupId || source.documentId}
              and deleted_at is null
            returning r2_object_key
          `
        : await sql`
            update documents
            set deleted_at = now()
            where document_id = ${documentId} and deleted_at is null
            returning r2_object_key
          `;
      if (!options.retainObject) {
        for (const row of deleted) {
          await sql`
            insert into storage_cleanup_jobs (object_key)
            values (${asString(row.r2_object_key)})
            on conflict (object_key) do update
            set next_attempt_at = least(storage_cleanup_jobs.next_attempt_at, now()), updated_at = now()
            where storage_cleanup_jobs.completed_at is null and storage_cleanup_jobs.lease_token is null
          `;
        }
      }
      return deleted;
    });
    if (!deletedRows.length) return null;
    return this.getDocument(documentId, { includeDeleted: true });
  }

  async restoreDocument(documentId: string): Promise<DocumentRecord | null> {
    const source = await this.getDocument(documentId, { includeDeleted: true });
    if (!source?.deletedAt) return null;
    await this.sql.begin(async (sql) => {
      await lockArchiveHierarchy(sql);
      const restored = await sql`
        update documents
        set deleted_at = null, folder_deletion_batch_id = null
        where coalesce(document_group_id, document_id) = ${source.documentGroupId || source.documentId}
        returning r2_object_key
      `;
      for (const row of restored) {
        await sql`delete from storage_cleanup_jobs where object_key = ${asString(row.r2_object_key)} and started_at is null`;
      }
    });
    return this.getDocument(documentId);
  }

  async purgeDocument(documentId: string): Promise<DocumentRecord[]> {
    const source = await this.getDocument(documentId, { includeDeleted: true });
    if (!source?.deletedAt) return [];
    return this.sql.begin(async (sql) => {
      await lockArchiveHierarchy(sql);
      const rows = await sql`
        select d.*, uploader.name as uploaded_by_name, reviewer.name as reviewed_by_name, af.name as folder_name
        from documents d
        join users uploader on uploader.user_id = d.uploaded_by
        left join users reviewer on reviewer.user_id = d.reviewed_by
        left join archive_folders af on af.folder_id = d.folder_id
        where coalesce(d.document_group_id, d.document_id) = ${source.documentGroupId || source.documentId}
        order by d.document_id for update of d
      `;
      if (!rows.length || rows.some((row) => !row.deleted_at)) return [];
      const records = await Promise.all(rows.map(async (row) =>
        mapDocument(row as Row, await this.tagsForDocument(asString(row.document_id)))));
      // DELETE triggers enqueue every object within this same transaction.
      await sql`delete from documents where document_id in ${sql(rows.map((row) => asString(row.document_id)))}`;
      return records;
    }) as Promise<DocumentRecord[]>;
  }

  async listArchiveFolders(options: { includeDeleted?: boolean } = {}): Promise<ArchiveFolder[]> {
    const rows = await this.sql`
      select
        af.*,
        creator.name as created_by_name,
        count(d.document_id) filter (
          where d.deleted_at is null and coalesce(d.is_current_version, true) = true
        ) as file_count
      from archive_folders af
      left join users creator on creator.user_id = af.created_by
      left join documents d on d.folder_id = af.folder_id
      where (${options.includeDeleted === true}::boolean or af.deleted_at is null)
      group by af.folder_id, creator.name
      order by af.sort_order, lower(af.name)
    `;
    return rows.map((row) => mapArchiveFolder(row as Row));
  }

  async getArchiveFolder(folderId: string, options: { includeDeleted?: boolean } = {}): Promise<ArchiveFolder | null> {
    const rows = await this.sql`
      select
        af.*,
        creator.name as created_by_name,
        count(d.document_id) filter (
          where d.deleted_at is null and coalesce(d.is_current_version, true) = true
        ) as file_count
      from archive_folders af
      left join users creator on creator.user_id = af.created_by
      left join documents d on d.folder_id = af.folder_id
      where af.folder_id = ${folderId} and (${options.includeDeleted === true}::boolean or af.deleted_at is null)
      group by af.folder_id, creator.name
      limit 1
    `;
    return rows[0] ? mapArchiveFolder(rows[0] as Row) : null;
  }

  async createArchiveFolder(input: CreateArchiveFolderInput): Promise<ArchiveFolder> {
    if (input.parentFolderId && !(await this.getArchiveFolder(input.parentFolderId))) {
      throw new Error("Parent folder not found");
    }
    const duplicate = await this.sql`
      select folder_id
      from archive_folders
      where parent_folder_id is not distinct from ${input.parentFolderId ?? null}
        and deleted_at is null
        and lower(btrim(name)) = lower(btrim(${input.name}))
      limit 1
    `;
    if (duplicate.length) throw new Error("A folder with this name already exists here");
    await this.sql`
      insert into archive_folders (folder_id, name, parent_folder_id, sort_order, created_by)
      values (${input.folderId}, ${input.name.trim()}, ${input.parentFolderId ?? null}, ${input.sortOrder ?? 0}, ${input.createdBy ?? null})
    `;
    const created = await this.getArchiveFolder(input.folderId);
    if (!created) throw new Error("Failed to create folder");
    return created;
  }

  async updateArchiveFolder(
    folderId: string,
    input: Partial<{ name: string; parentFolderId?: string | null; sortOrder?: number }>
  ): Promise<ArchiveFolder | null> {
    const existing = await this.getArchiveFolder(folderId);
    if (!existing) return null;
    const nextName = input.name?.trim() || existing.name;
    const nextParentId = input.parentFolderId === undefined ? existing.parentFolderId ?? null : input.parentFolderId;
    if (nextParentId === folderId) throw new Error("A folder cannot contain itself");
    if (nextParentId) {
      const parent = await this.getArchiveFolder(nextParentId);
      if (!parent) throw new Error("Parent folder not found");
      const descendants = await this.sql`
        with recursive folder_descendants as (
          select folder_id from archive_folders where parent_folder_id = ${folderId}
          union all
          select child.folder_id
          from archive_folders child
          join folder_descendants parent on child.parent_folder_id = parent.folder_id
        )
        select folder_id from folder_descendants where folder_id = ${nextParentId} limit 1
      `;
      if (descendants.length) throw new Error("A folder cannot move inside one of its descendants");
    }
    const duplicate = await this.sql`
      select folder_id
      from archive_folders
      where folder_id <> ${folderId}
        and deleted_at is null
        and parent_folder_id is not distinct from ${nextParentId}
        and lower(btrim(name)) = lower(btrim(${nextName}))
      limit 1
    `;
    if (duplicate.length) throw new Error("A folder with this name already exists here");
    await this.sql`
      update archive_folders
      set name = ${nextName},
          parent_folder_id = ${nextParentId},
          sort_order = ${input.sortOrder ?? existing.sortOrder},
          updated_at = now()
      where folder_id = ${folderId} and deleted_at is null
    `;
    return this.getArchiveFolder(folderId);
  }

  async deleteArchiveFolder(folderId: string): Promise<ArchiveFolderDeleteResult | null> {
    return this.sql.begin(async (sql) => {
      await lockArchiveHierarchy(sql);
      const folders = await sql`
        with recursive folder_tree as (
          select folder_id from archive_folders where folder_id = ${folderId} and deleted_at is null
          union
          select child.folder_id from archive_folders child
          join folder_tree parent on child.parent_folder_id = parent.folder_id where child.deleted_at is null
        ) select folder_id from folder_tree
      `;
      if (!folders.length) return null;
      const ids = folders.map((row) => asString(row.folder_id));
      const batchId = crypto.randomUUID();
      const trashed = await sql`
        update documents set deleted_at = now(), folder_deletion_batch_id = ${batchId}
        where deleted_at is null and coalesce(document_group_id, document_id) in (
          select coalesce(document_group_id, document_id) from documents
          where folder_id in ${sql(ids)} and deleted_at is null
        ) returning coalesce(document_group_id, document_id) as group_id
      `;
      await sql`update archive_folders set deleted_at = now(), deletion_batch_id = ${batchId},
        deletion_root_folder_id = ${folderId}, updated_at = now() where folder_id in ${sql(ids)}`;
      return { deletedFolders: ids.length, trashedDocuments: new Set(trashed.map((row) => asString(row.group_id))).size };
    });
  }

  async restoreArchiveFolder(folderId: string, input: Partial<{ name: string; parentFolderId?: string | null; sortOrder?: number }> = {}): Promise<ArchiveFolder | null> {
    const restored = await this.sql.begin(async (sql) => {
      await lockArchiveHierarchy(sql);
      const [root] = await sql`select * from archive_folders where folder_id = ${folderId} and deleted_at is not null`;
      if (!root || asString(root.deletion_root_folder_id) !== folderId) return false;
      const batchId = asString(root.deletion_batch_id);
      const nextName = input.name?.trim() || asString(root.name);
      const nextParentId = input.parentFolderId === undefined ? root.parent_folder_id ? asString(root.parent_folder_id) : null : input.parentFolderId;
      if (nextParentId && !(await sql`select 1 from archive_folders where folder_id = ${nextParentId} and deleted_at is null`).length) {
        throw new Error("Restore the parent folder first or choose another location");
      }
      if ((await sql`select 1 from archive_folders where deleted_at is null
        and parent_folder_id is not distinct from ${nextParentId} and lower(btrim(name)) = lower(btrim(${nextName}))`).length) {
        throw new Error("A folder with this name already exists here; choose another name or location");
      }
      const folders = await sql`
        with recursive folder_tree as (
          select folder_id, 0 as depth from archive_folders where folder_id = ${folderId}
          union all
          select child.folder_id, parent.depth + 1 from archive_folders child
          join folder_tree parent on child.parent_folder_id = parent.folder_id
          where child.deletion_batch_id = ${batchId} and child.deleted_at is not null
        ) select folder_id, depth from folder_tree order by depth, folder_id
      `;
      // Parent first so each row's active-parent guard remains true throughout.
      for (const folder of folders) {
        if (asString(folder.folder_id) === folderId) {
          await sql`update archive_folders set name = ${nextName}, parent_folder_id = ${nextParentId},
            deleted_at = null, deletion_batch_id = null, deletion_root_folder_id = null, updated_at = now()
            where folder_id = ${folderId}`;
        } else {
          await sql`update archive_folders set deleted_at = null, deletion_batch_id = null,
            deletion_root_folder_id = null, updated_at = now() where folder_id = ${asString(folder.folder_id)}`;
        }
      }
      await sql`update documents set deleted_at = null, folder_deletion_batch_id = null
        where folder_deletion_batch_id = ${batchId} and deleted_at is not null`;
      return true;
    });
    return restored ? this.getArchiveFolder(folderId) : null;
  }

  async updateArchiveFolderDocumentsMetadata(
    folderId: string,
    input: ArchiveFolderMetadataUpdateInput,
    reviewedBy: string
  ): Promise<ArchiveFolderMetadataUpdateResult | null> {
    return this.sql.begin(async (sql) => {
      await lockArchiveHierarchy(sql);
      const folders = await sql`
        with recursive folder_tree as (
          select folder_id
          from archive_folders
          where folder_id = ${folderId} and deleted_at is null
          union all
          select child.folder_id
          from archive_folders child
          join folder_tree parent on child.parent_folder_id = parent.folder_id
          where ${Boolean(input.includeSubfolders)}::boolean and child.deleted_at is null
        )
        select folder_id from folder_tree
      `;
      if (!folders.length) return null;
      const hasCategory = input.category !== undefined;
      const hasReviewStatus = input.reviewStatus !== undefined;
      const hasNotes = input.notes !== undefined;
      const hasReviewNotes = input.reviewNotes !== undefined;
      const updatedRows = await sql`
        with recursive folder_tree as (
          select folder_id
          from archive_folders
          where folder_id = ${folderId}
          union all
          select child.folder_id
          from archive_folders child
          join folder_tree parent on child.parent_folder_id = parent.folder_id
          where ${Boolean(input.includeSubfolders)}::boolean
        )
        update documents as d
        set category = case when ${hasCategory}::boolean then ${input.category ?? ""} else d.category end,
            review_status = case when ${hasReviewStatus}::boolean then ${input.reviewStatus ?? "needs-review"} else d.review_status end,
            notes = case when ${hasNotes}::boolean then ${input.notes ?? ""} else d.notes end,
            review_notes = case when ${hasReviewNotes}::boolean then ${input.reviewNotes ?? ""} else d.review_notes end,
            reviewed_by = case
              when ${hasReviewStatus}::boolean and d.review_status is distinct from ${input.reviewStatus ?? "needs-review"}
                then ${reviewedBy}
              else d.reviewed_by
            end,
            reviewed_at = case
              when ${hasReviewStatus}::boolean and d.review_status is distinct from ${input.reviewStatus ?? "needs-review"}
                then now()
              else d.reviewed_at
            end
        from folder_tree folder
        where d.folder_id = folder.folder_id
          and d.deleted_at is null
          and coalesce(d.is_current_version, true) = true
        returning d.document_id
      `;
      if (input.tagIds !== undefined) {
        for (const row of updatedRows) {
          const documentId = asString(row.document_id);
          await sql`delete from document_tags where document_id = ${documentId}`;
          for (const tagId of input.tagIds) {
            await sql`
              insert into document_tags (document_id, tag_id)
              values (${documentId}, ${tagId})
              on conflict do nothing
            `;
          }
        }
      }
      return {
        folderId,
        folderCount: folders.length,
        matched: updatedRows.length,
        updated: updatedRows.length
      };
    });
  }

  async listArchiveCategories(): Promise<ArchiveCategory[]> {
    const rows = await this.sql`
      select
        ac.*,
        creator.name as created_by_name,
        count(d.document_id) filter (
          where d.deleted_at is null and coalesce(d.is_current_version, true) = true
        ) as file_count
      from archive_categories ac
      left join users creator on creator.user_id = ac.created_by
      left join documents d on lower(d.category) = lower(ac.name)
      group by ac.category_id, creator.name
      order by ac.sort_order, lower(ac.name)
    `;
    return rows.map((row) => mapArchiveCategory(row as Row));
  }

  async getArchiveCategory(categoryId: string): Promise<ArchiveCategory | null> {
    const rows = await this.sql`
      select
        ac.*,
        creator.name as created_by_name,
        count(d.document_id) filter (
          where d.deleted_at is null and coalesce(d.is_current_version, true) = true
        ) as file_count
      from archive_categories ac
      left join users creator on creator.user_id = ac.created_by
      left join documents d on lower(d.category) = lower(ac.name)
      where ac.category_id = ${categoryId}
      group by ac.category_id, creator.name
      limit 1
    `;
    return rows[0] ? mapArchiveCategory(rows[0] as Row) : null;
  }

  async createArchiveCategory(input: CreateArchiveCategoryInput): Promise<ArchiveCategory> {
    const duplicate = await this.sql`
      select category_id from archive_categories where lower(btrim(name)) = lower(btrim(${input.name})) limit 1
    `;
    if (duplicate.length) throw new Error("A category with this name already exists");
    const sortRows = input.sortOrder === undefined
      ? await this.sql`select coalesce(max(sort_order), 0) + 10 as next_sort_order from archive_categories`
      : [];
    const sortOrder = input.sortOrder ?? asNumber(sortRows[0]?.next_sort_order);
    await this.sql`
      insert into archive_categories (category_id, name, sort_order, is_system, created_by)
      values (${input.categoryId}, ${input.name.trim()}, ${sortOrder}, false, ${input.createdBy ?? null})
    `;
    const created = await this.getArchiveCategory(input.categoryId);
    if (!created) throw new Error("Failed to create category");
    return created;
  }

  async updateArchiveCategory(
    categoryId: string,
    input: Partial<{ name: string; sortOrder?: number }>
  ): Promise<ArchiveCategory | null> {
    const existing = await this.getArchiveCategory(categoryId);
    if (!existing) return null;
    const nextName = input.name?.trim() || existing.name;
    const duplicate = await this.sql`
      select category_id
      from archive_categories
      where category_id <> ${categoryId} and lower(btrim(name)) = lower(btrim(${nextName}))
      limit 1
    `;
    if (duplicate.length) throw new Error("A category with this name already exists");
    await this.sql.begin(async (sql) => {
      if (nextName !== existing.name) {
        await sql`update documents set category = ${nextName} where category = ${existing.name}`;
      }
      await sql`
        update archive_categories
        set name = ${nextName}, sort_order = ${input.sortOrder ?? existing.sortOrder}, updated_at = now()
        where category_id = ${categoryId}
      `;
    });
    return this.getArchiveCategory(categoryId);
  }

  async deleteArchiveCategory(categoryId: string, replacementCategoryId?: string | null): Promise<boolean> {
    const existing = await this.getArchiveCategory(categoryId);
    if (!existing) return false;
    const countRows = await this.sql`select count(*)::integer as category_count from archive_categories`;
    if (asNumber(countRows[0]?.category_count) <= 1) throw new Error("At least one archive category is required");
    if (existing.name === "Other") throw new Error("The Other category cannot be deleted");
    const replacement = replacementCategoryId ? await this.getArchiveCategory(replacementCategoryId) : null;
    if (replacementCategoryId && !replacement) throw new Error("Replacement category not found");
    if (replacement?.categoryId === categoryId) throw new Error("Choose a different replacement category");
    const documents = await this.sql`select document_id from documents where category = ${existing.name} limit 1`;
    if (documents.length && !replacement) throw new Error("Choose a replacement category for the existing files");
    await this.sql.begin(async (sql) => {
      if (replacement) await sql`update documents set category = ${replacement.name} where category = ${existing.name}`;
      await sql`delete from archive_categories where category_id = ${categoryId}`;
    });
    return true;
  }

  async enqueueStorageCleanup(objectKey: string): Promise<void> {
    await this.sql`
      insert into storage_cleanup_jobs (object_key)
      values (${objectKey})
      on conflict (object_key) do update
      set next_attempt_at = least(storage_cleanup_jobs.next_attempt_at, now()), updated_at = now()
      where storage_cleanup_jobs.completed_at is null and storage_cleanup_jobs.lease_token is null
    `;
  }

  async listPendingStorageCleanupJobs(limit = 25): Promise<StorageCleanupJob[]> {
    const rows = await this.sql`
      select *
      from storage_cleanup_jobs
      where completed_at is null and next_attempt_at <= now()
        and (lease_expires_at is null or lease_expires_at <= now())
      order by next_attempt_at, created_at, cleanup_job_id
      limit ${Math.min(100, Math.max(1, limit))}
    `;
    return rows.map((row) => mapStorageCleanupJob(row as Row));
  }

  async claimStorageCleanupJob(cleanupJobId: string): Promise<StorageCleanupJob | null> {
    return this.sql.begin(async (sql) => {
      const [candidate] = await sql`select object_key from storage_cleanup_jobs where cleanup_job_id = ${cleanupJobId}`;
      if (!candidate) return null;
      const key = asString(candidate.object_key);
      // Reference INSERTs take this same lock before accepting a new key.
      await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 1885430630))`;
      const [current] = await sql`
        select * from storage_cleanup_jobs where cleanup_job_id = ${cleanupJobId}
          and completed_at is null and next_attempt_at <= now()
          and (lease_expires_at is null or lease_expires_at <= now()) for update
      `;
      if (!current) return null;
      const [references] = await sql`
        select exists(select 1 from documents where r2_object_key = ${key})
          or exists(select 1 from private_vault_items where object_key = ${key}) as retained
      `;
      if (references.retained) {
        await sql`update storage_cleanup_jobs set last_error = 'object_referenced',
          next_attempt_at = now() + ${STORAGE_CLEANUP_REFERENCE_DELAY_MS} * interval '1 millisecond',
          lease_token = null, lease_expires_at = null, updated_at = now()
          where cleanup_job_id = ${cleanupJobId}`;
        return null;
      }
      const [claimed] = await sql`update storage_cleanup_jobs set started_at = coalesce(started_at, now()),
        lease_token = ${crypto.randomUUID()}, lease_expires_at = now() + ${STORAGE_CLEANUP_LEASE_MS} * interval '1 millisecond',
        attempts = attempts + 1, last_error = null, updated_at = now()
        where cleanup_job_id = ${cleanupJobId} returning *`;
      return mapStorageCleanupJob(claimed as Row);
    }) as Promise<StorageCleanupJob | null>;
  }

  async completeStorageCleanup(cleanupJobId: string, leaseToken: string): Promise<boolean> {
    const rows = await this.sql`
      update storage_cleanup_jobs
      set completed_at = now(), last_error = null, updated_at = now(), lease_token = null, lease_expires_at = null
      where cleanup_job_id = ${cleanupJobId} and lease_token = ${leaseToken} and completed_at is null
      returning cleanup_job_id
    `;
    return rows.length === 1;
  }

  async failStorageCleanup(cleanupJobId: string, leaseToken: string): Promise<boolean> {
    const [job] = await this.sql`select attempts from storage_cleanup_jobs where cleanup_job_id = ${cleanupJobId}`;
    if (!job) return false;
    const rows = await this.sql`update storage_cleanup_jobs set last_error = 'object_delete_failed',
      next_attempt_at = now() + ${storageCleanupRetryDelay(asNumber(job.attempts))} * interval '1 millisecond',
      lease_token = null, lease_expires_at = null, updated_at = now()
      where cleanup_job_id = ${cleanupJobId} and lease_token = ${leaseToken} and completed_at is null
      returning cleanup_job_id`;
    return rows.length === 1;
  }

  async getStorageCleanupStatus() {
    const [row] = await this.sql`select
      count(*) filter (where completed_at is null)::int as pending,
      count(*) filter (where completed_at is null and lease_expires_at > now())::int as leased,
      count(*) filter (where completed_at is null and last_error = 'object_delete_failed')::int as failed,
      count(*) filter (where completed_at is null and last_error = 'object_referenced')::int as referenced,
      count(*) filter (where completed_at is not null)::int as completed from storage_cleanup_jobs`;
    return { pending: asNumber(row.pending), leased: asNumber(row.leased), failed: asNumber(row.failed),
      referenced: asNumber(row.referenced), completed: asNumber(row.completed) };
  }

  async getPrivateVaultByOwner(ownerUserId: string): Promise<StoredPrivateVault | null> {
    const rows = await this.sql`
      select * from private_vaults
      where owner_user_id = ${ownerUserId}
      limit 1
    `;
    return rows[0] ? mapPrivateVault(rows[0] as Row) : null;
  }

  async createPrivateVault(input: CreatePrivateVaultInput): Promise<StoredPrivateVault> {
    const rows = await this.sql`
      insert into private_vaults (
        vault_id, owner_user_id, encryption_version, encryption_kdf, encryption_iterations,
        encryption_salt, encrypted_vault_key, recovery_encrypted_vault_key, auto_lock_minutes
      ) values (
        ${input.vaultId}, ${input.ownerUserId}, ${input.encryptionVersion}, ${input.encryptionKdf},
        ${input.encryptionIterations}, ${input.encryptionSalt}, ${input.encryptedVaultKey},
        ${input.recoveryEncryptedVaultKey}, ${input.autoLockMinutes ?? 10}
      )
      returning *
    `;
    return mapPrivateVault(rows[0] as Row);
  }

  async updatePrivateVaultPassword(
    ownerUserId: string,
    metadata: PrivateVaultPasswordMetadata
  ): Promise<StoredPrivateVault | null> {
    const rows = await this.sql`
      update private_vaults
      set encryption_version = ${metadata.encryptionVersion},
          encryption_kdf = ${metadata.encryptionKdf},
          encryption_iterations = ${metadata.encryptionIterations},
          encryption_salt = ${metadata.encryptionSalt},
          encrypted_vault_key = ${metadata.encryptedVaultKey},
          updated_at = now()
      where owner_user_id = ${ownerUserId}
      returning *
    `;
    return rows[0] ? mapPrivateVault(rows[0] as Row) : null;
  }

  async updatePrivateVaultAutoLock(ownerUserId: string, autoLockMinutes: number): Promise<StoredPrivateVault | null> {
    const rows = await this.sql`
      update private_vaults
      set auto_lock_minutes = ${autoLockMinutes}, updated_at = now()
      where owner_user_id = ${ownerUserId}
      returning *
    `;
    return rows[0] ? mapPrivateVault(rows[0] as Row) : null;
  }

  async listPrivateVaultFolders(ownerUserId: string, includeDeleted = false): Promise<StoredPrivateVaultFolder[]> {
    const rows = await this.sql`
      select folder.*
      from private_vault_folders folder
      join private_vaults vault on vault.vault_id = folder.vault_id
      where vault.owner_user_id = ${ownerUserId}
        and (${includeDeleted} = true and folder.deleted_at is not null
          or ${includeDeleted} = false and folder.deleted_at is null)
      order by folder.updated_at desc, folder.created_at desc
    `;
    return rows.map((row) => mapPrivateVaultFolder(row as Row));
  }

  async getPrivateVaultFolder(
    ownerUserId: string,
    folderId: string,
    includeDeleted = false
  ): Promise<StoredPrivateVaultFolder | null> {
    const rows = await this.sql`
      select folder.*
      from private_vault_folders folder
      join private_vaults vault on vault.vault_id = folder.vault_id
      where vault.owner_user_id = ${ownerUserId}
        and folder.folder_id = ${folderId}
        and (${includeDeleted} = true or folder.deleted_at is null)
      limit 1
    `;
    return rows[0] ? mapPrivateVaultFolder(rows[0] as Row) : null;
  }

  async createPrivateVaultFolder(input: CreatePrivateVaultFolderInput): Promise<StoredPrivateVaultFolder> {
    const rows = await this.sql`
      insert into private_vault_folders (
        folder_id, vault_id, encryption_version, encrypted_metadata
      ) values (
        ${input.folderId}, ${input.vaultId}, ${input.encryptionVersion}, ${input.encryptedMetadata}
      )
      returning *
    `;
    return mapPrivateVaultFolder(rows[0] as Row);
  }

  async updatePrivateVaultFolderMetadata(
    ownerUserId: string,
    folderId: string,
    encryptedMetadata: string
  ): Promise<StoredPrivateVaultFolder | null> {
    const rows = await this.sql`
      update private_vault_folders folder
      set encrypted_metadata = ${encryptedMetadata}, updated_at = now()
      from private_vaults vault
      where folder.vault_id = vault.vault_id
        and vault.owner_user_id = ${ownerUserId}
        and folder.folder_id = ${folderId}
        and folder.deleted_at is null
      returning folder.*
    `;
    return rows[0] ? mapPrivateVaultFolder(rows[0] as Row) : null;
  }

  async softDeletePrivateVaultFolder(ownerUserId: string, folderId: string): Promise<StoredPrivateVaultFolder | null> {
    const rows = await this.sql`
      update private_vault_folders folder
      set deleted_at = now(), updated_at = now()
      from private_vaults vault
      where folder.vault_id = vault.vault_id
        and vault.owner_user_id = ${ownerUserId}
        and folder.folder_id = ${folderId}
        and folder.deleted_at is null
      returning folder.*
    `;
    return rows[0] ? mapPrivateVaultFolder(rows[0] as Row) : null;
  }

  async restorePrivateVaultFolder(ownerUserId: string, folderId: string): Promise<StoredPrivateVaultFolder | null> {
    const rows = await this.sql`
      update private_vault_folders folder
      set deleted_at = null, updated_at = now()
      from private_vaults vault
      where folder.vault_id = vault.vault_id
        and vault.owner_user_id = ${ownerUserId}
        and folder.folder_id = ${folderId}
        and folder.deleted_at is not null
      returning folder.*
    `;
    return rows[0] ? mapPrivateVaultFolder(rows[0] as Row) : null;
  }

  async purgePrivateVaultFolder(ownerUserId: string, folderId: string): Promise<StoredPrivateVaultFolder | null> {
    const rows = await this.sql`
      delete from private_vault_folders folder
      using private_vaults vault
      where folder.vault_id = vault.vault_id
        and vault.owner_user_id = ${ownerUserId}
        and folder.folder_id = ${folderId}
      returning folder.*
    `;
    return rows[0] ? mapPrivateVaultFolder(rows[0] as Row) : null;
  }

  async listPrivateVaultItems(ownerUserId: string, includeDeleted = false): Promise<StoredPrivateVaultItem[]> {
    const rows = await this.sql`
      select item.*
      from private_vault_items item
      join private_vaults vault on vault.vault_id = item.vault_id
      where vault.owner_user_id = ${ownerUserId}
        and (${includeDeleted} = true and item.deleted_at is not null
          or ${includeDeleted} = false and item.deleted_at is null)
      order by item.updated_at desc, item.created_at desc
    `;
    return rows.map((row) => mapPrivateVaultItem(row as Row));
  }

  async getPrivateVaultItem(
    ownerUserId: string,
    itemId: string,
    includeDeleted = false
  ): Promise<StoredPrivateVaultItem | null> {
    const rows = await this.sql`
      select item.*
      from private_vault_items item
      join private_vaults vault on vault.vault_id = item.vault_id
      where vault.owner_user_id = ${ownerUserId}
        and item.item_id = ${itemId}
        and (${includeDeleted} = true or item.deleted_at is null)
      limit 1
    `;
    return rows[0] ? mapPrivateVaultItem(rows[0] as Row) : null;
  }

  async createPrivateVaultItem(input: CreatePrivateVaultItemInput): Promise<StoredPrivateVaultItem> {
    const rows = await this.sql`
      insert into private_vault_items (
        item_id, vault_id, encryption_version, encrypted_metadata, wrapped_file_key,
        object_key, ciphertext_size
      ) values (
        ${input.itemId}, ${input.vaultId}, ${input.encryptionVersion}, ${input.encryptedMetadata},
        ${input.wrappedFileKey}, ${input.objectKey}, ${input.ciphertextSize}
      )
      returning *
    `;
    return mapPrivateVaultItem(rows[0] as Row);
  }

  async updatePrivateVaultItemMetadata(
    ownerUserId: string,
    itemId: string,
    encryptedMetadata: string
  ): Promise<StoredPrivateVaultItem | null> {
    const rows = await this.sql`
      update private_vault_items item
      set encrypted_metadata = ${encryptedMetadata}, updated_at = now()
      from private_vaults vault
      where item.vault_id = vault.vault_id
        and vault.owner_user_id = ${ownerUserId}
        and item.item_id = ${itemId}
        and item.deleted_at is null
      returning item.*
    `;
    return rows[0] ? mapPrivateVaultItem(rows[0] as Row) : null;
  }

  async updatePrivateVaultItemMetadataBatch(
    ownerUserId: string,
    updates: PrivateVaultItemMetadataUpdate[]
  ): Promise<StoredPrivateVaultItem[]> {
    if (!updates.length) return [];
    return this.sql.begin(async (sql) => {
      const records: StoredPrivateVaultItem[] = [];
      for (const update of updates) {
        const rows = await sql`
          update private_vault_items item
          set encrypted_metadata = ${update.encryptedMetadata}, updated_at = now()
          from private_vaults vault
          where item.vault_id = vault.vault_id
            and vault.owner_user_id = ${ownerUserId}
            and item.item_id = ${update.itemId}
            and item.deleted_at is null
          returning item.*
        `;
        if (!rows[0]) throw new PrivateVaultItemAccessError();
        records.push(mapPrivateVaultItem(rows[0] as Row));
      }
      return records;
    });
  }

  async softDeletePrivateVaultItem(ownerUserId: string, itemId: string): Promise<StoredPrivateVaultItem | null> {
    const rows = await this.sql`
      update private_vault_items item
      set deleted_at = now(), updated_at = now()
      from private_vaults vault
      where item.vault_id = vault.vault_id
        and vault.owner_user_id = ${ownerUserId}
        and item.item_id = ${itemId}
        and item.deleted_at is null
      returning item.*
    `;
    return rows[0] ? mapPrivateVaultItem(rows[0] as Row) : null;
  }

  async restorePrivateVaultItem(ownerUserId: string, itemId: string): Promise<StoredPrivateVaultItem | null> {
    const rows = await this.sql`
      update private_vault_items item
      set deleted_at = null, updated_at = now()
      from private_vaults vault
      where item.vault_id = vault.vault_id
        and vault.owner_user_id = ${ownerUserId}
        and item.item_id = ${itemId}
        and item.deleted_at is not null
      returning item.*
    `;
    return rows[0] ? mapPrivateVaultItem(rows[0] as Row) : null;
  }

  async purgePrivateVaultItem(ownerUserId: string, itemId: string): Promise<StoredPrivateVaultItem | null> {
    const rows = await this.sql`
      delete from private_vault_items item
      using private_vaults vault
      where item.vault_id = vault.vault_id
        and vault.owner_user_id = ${ownerUserId}
        and item.item_id = ${itemId}
      returning item.*
    `;
    return rows[0] ? mapPrivateVaultItem(rows[0] as Row) : null;
  }

  async listTags(): Promise<Tag[]> {
    const rows = await this.sql`select * from tags order by name`;
    return rows.map((row) => mapTag(row as Row));
  }

  async createTag(name: string, color: string): Promise<Tag> {
    const tagId = crypto.randomUUID();
    await this.sql`insert into tags (tag_id, name, color) values (${tagId}, ${name}, ${color})`;
    const rows = await this.sql`select * from tags where tag_id = ${tagId}`;
    return mapTag(rows[0] as Row);
  }

  async updateTag(tagId: string, name: string, color: string): Promise<Tag | null> {
    const rows = await this.sql`
      update tags
      set name = ${name}, color = ${color}
      where tag_id = ${tagId}
      returning *
    `;
    return rows[0] ? mapTag(rows[0] as Row) : null;
  }

  async deleteTag(tagId: string): Promise<boolean> {
    const rows = await this.sql`
      delete from tags
      where tag_id = ${tagId}
      returning tag_id
    `;
    return rows.length > 0;
  }

  async listNotes(caseId: string): Promise<NoteRecord[]> {
    const rows = await this.sql`
      select n.*, u.name as created_by_name
      from notes n
      join users u on u.user_id = n.created_by
      where coalesce(n.work_item_id, n.case_id) = ${caseId}
      order by n.created_at desc
    `;
    return rows.map((row) => mapNote(row as Row));
  }

  async createNote(input: CreateNoteInput): Promise<NoteRecord> {
    const noteId = crypto.randomUUID();
    await this.sql`
      insert into notes (note_id, case_id, work_item_id, body, created_by)
      values (${noteId}, ${input.caseId}, ${input.caseId}, ${input.body}, ${input.createdBy})
    `;
    const rows = await this.sql`
      select n.*, u.name as created_by_name
      from notes n
      join users u on u.user_id = n.created_by
      where n.note_id = ${noteId}
    `;
    return mapNote(rows[0] as Row);
  }

  private async serviceDiscussionAttachmentsFor(messageId: string): Promise<ServiceDiscussionAttachment[]> {
    const rows = await this.sql`
      select
        sda.attachment_id,
        sda.message_id,
        sda.document_id,
        sda.inline_image,
        sda.sort_order,
        sda.created_at as attachment_created_at,
        d.*,
        uploader.name as uploaded_by_name,
        reviewer.name as reviewed_by_name,
        wi.number as case_number,
        wi.title as case_title
      from service_discussion_attachments sda
      join documents d on d.document_id = sda.document_id
      join users uploader on uploader.user_id = d.uploaded_by
      left join users reviewer on reviewer.user_id = d.reviewed_by
      left join work_items wi on wi.work_item_id = coalesce(d.work_item_id, d.case_id)
      where sda.message_id = ${messageId}
        and d.deleted_at is null
      order by sda.sort_order asc, sda.created_at asc
    `;
    return Promise.all(
      rows.map(async (row) => {
        const record = row as Row;
        const document = mapDocument(record, await this.tagsForDocument(asString(record.document_id)));
        return mapServiceDiscussionAttachment(record, document);
      })
    );
  }

  private async serviceDiscussionMentionsFor(messageId: string): Promise<ServiceDiscussionMention[]> {
    const rows = await this.sql`
      select
        sdm.message_id,
        sdm.user_id,
        sdm.created_at as mention_created_at,
        u.name as user_name
      from service_discussion_mentions sdm
      join users u on u.user_id = sdm.user_id
      where sdm.message_id = ${messageId}
      order by u.name asc
    `;
    return rows.map((row) => mapServiceDiscussionMention(row as Row));
  }

  private async serviceDiscussionAssetLinksFor(messageId: string): Promise<ServiceDiscussionAssetLink[]> {
    const rows = await this.sql`
      select
        sdal.discussion_asset_link_id,
        sdal.message_id,
        sdal.asset_id,
        sdal.relationship,
        sdal.created_by,
        sdal.created_at,
        creator.name as created_by_name,
        ma.name as asset_name,
        ma.asset_type,
        ma.work_item_id,
        wi.number as case_number
      from service_discussion_asset_links sdal
      join managed_assets ma on ma.asset_id = sdal.asset_id and ma.deleted_at is null
      left join users creator on creator.user_id = sdal.created_by
      left join work_items wi on wi.work_item_id = ma.work_item_id and wi.deleted_at is null
      where sdal.message_id = ${messageId}
      order by sdal.created_at asc
    `;
    return rows.map((row) => mapServiceDiscussionAssetLink(row as Row));
  }

  private async replaceServiceDiscussionMentions(
    sql: Sql | TransactionSql,
    messageId: string,
    userIds: string[] = []
  ): Promise<void> {
    await sql`delete from service_discussion_mentions where message_id = ${messageId}`;
    const uniqueUserIds = [...new Set(userIds)].filter(Boolean);
    for (const userId of uniqueUserIds) {
      await sql`
        insert into service_discussion_mentions (message_id, user_id)
        select ${messageId}, ${userId}
        where exists (select 1 from users where user_id = ${userId})
        on conflict (message_id, user_id) do nothing
      `;
    }
  }

  private async hydrateServiceDiscussionRows(rows: readonly Row[]): Promise<ServiceDiscussionMessage[]> {
    if (!rows.length) return [];
    const messageIds = rows.map((row) => asString(row.message_id));
    const [attachmentRows, mentionRows, assetLinkRows] = await Promise.all([
      this.sql`
        select
          sda.attachment_id,
          sda.message_id,
          sda.document_id,
          sda.inline_image,
          sda.sort_order,
          sda.created_at as attachment_created_at,
          d.*,
          uploader.name as uploaded_by_name,
          reviewer.name as reviewed_by_name,
          wi.number as case_number,
          wi.title as case_title
        from service_discussion_attachments sda
        join documents d on d.document_id = sda.document_id
        join users uploader on uploader.user_id = d.uploaded_by
        left join users reviewer on reviewer.user_id = d.reviewed_by
        left join work_items wi on wi.work_item_id = coalesce(d.work_item_id, d.case_id)
        where sda.message_id = any(${messageIds}::uuid[])
          and d.deleted_at is null
        order by sda.message_id, sda.sort_order asc, sda.created_at asc
      `,
      this.sql`
        select sdm.message_id, sdm.user_id, sdm.created_at as mention_created_at, u.name as user_name
        from service_discussion_mentions sdm
        join users u on u.user_id = sdm.user_id
        where sdm.message_id = any(${messageIds}::uuid[])
        order by sdm.message_id, u.name asc
      `,
      this.sql`
        select
          sdal.discussion_asset_link_id,
          sdal.message_id,
          sdal.asset_id,
          sdal.relationship,
          sdal.created_by,
          sdal.created_at,
          creator.name as created_by_name,
          ma.name as asset_name,
          ma.asset_type,
          ma.work_item_id,
          wi.number as case_number
        from service_discussion_asset_links sdal
        join managed_assets ma on ma.asset_id = sdal.asset_id and ma.deleted_at is null
        left join users creator on creator.user_id = sdal.created_by
        left join work_items wi on wi.work_item_id = ma.work_item_id and wi.deleted_at is null
        where sdal.message_id = any(${messageIds}::uuid[])
        order by sdal.message_id, sdal.created_at asc
      `
    ]);
    const documentIds = attachmentRows.map((row) => asString(row.document_id));
    const documentTagRows = documentIds.length
      ? await this.sql`
          select dt.document_id, t.*
          from document_tags dt
          join tags t on t.tag_id = dt.tag_id
          where dt.document_id = any(${documentIds}::uuid[])
          order by t.name asc
        `
      : [];
    const tagsByDocument = new Map<string, Tag[]>();
    for (const row of documentTagRows) {
      const documentId = asString(row.document_id);
      tagsByDocument.set(documentId, [...(tagsByDocument.get(documentId) ?? []), mapTag(row as Row)]);
    }
    const attachmentsByMessage = new Map<string, ServiceDiscussionAttachment[]>();
    for (const row of attachmentRows) {
      const messageId = asString(row.message_id);
      const documentId = asString(row.document_id);
      const document = mapDocument(row as Row, tagsByDocument.get(documentId) ?? []);
      attachmentsByMessage.set(messageId, [
        ...(attachmentsByMessage.get(messageId) ?? []),
        mapServiceDiscussionAttachment(row as Row, document)
      ]);
    }
    const mentionsByMessage = new Map<string, ServiceDiscussionMention[]>();
    for (const row of mentionRows) {
      const messageId = asString(row.message_id);
      mentionsByMessage.set(messageId, [
        ...(mentionsByMessage.get(messageId) ?? []),
        mapServiceDiscussionMention(row as Row)
      ]);
    }
    const assetLinksByMessage = new Map<string, ServiceDiscussionAssetLink[]>();
    for (const row of assetLinkRows) {
      const messageId = asString(row.message_id);
      assetLinksByMessage.set(messageId, [
        ...(assetLinksByMessage.get(messageId) ?? []),
        mapServiceDiscussionAssetLink(row as Row)
      ]);
    }
    return rows.map((row) => {
      const messageId = asString(row.message_id);
      return mapServiceDiscussionMessage(
        row,
        attachmentsByMessage.get(messageId) ?? [],
        mentionsByMessage.get(messageId) ?? [],
        assetLinksByMessage.get(messageId) ?? []
      );
    });
  }

  async listServiceDiscussion(caseId: string, userId?: string): Promise<ServiceDiscussionMessage[]> {
    return this.listDiscussionMessagesForScope(caseId, userId);
  }

  private async listDiscussionMessagesForScope(caseId: string | null, userId?: string): Promise<ServiceDiscussionMessage[]> {
    const rows = await this.sql`
      select
        sdm.*,
        creator.name as created_by_name,
        updater.name as updated_by_name,
        owner.name as thread_owner_user_name,
        wi.number as case_number,
        wi.title as case_title,
        wi.status as case_status,
        sdr.read_at,
        (${userId ?? null}::uuid is not null and sdm.created_by <> ${userId ?? null}::uuid and sdr.read_at is null) as is_unread,
        (
          select count(*)
          from service_discussion_messages replies
          where replies.parent_message_id = sdm.message_id
            and replies.deleted_at is null
        ) as reply_count
      from service_discussion_messages sdm
      join users creator on creator.user_id = sdm.created_by
      left join users updater on updater.user_id = sdm.updated_by
      left join users owner on owner.user_id = sdm.thread_owner_user_id
      left join work_items wi on wi.work_item_id = sdm.work_item_id
      left join service_discussion_reads sdr on sdr.message_id = sdm.message_id and sdr.user_id = ${userId ?? null}
      where sdm.work_item_id is not distinct from ${caseId}::uuid
        and sdm.deleted_at is null
      order by sdm.created_at asc
    `;
    return this.hydrateServiceDiscussionRows(rows as Row[]);
  }

  async listServiceDiscussionsPage(
    filters: ServiceDiscussionFilters = {},
    pagination: PaginationParams = {},
    userId?: string
  ): Promise<PaginatedResult<ServiceDiscussionMessage>> {
    const pageInfo = normalizePagination(pagination);
    const offset = (pageInfo.page - 1) * pageInfo.pageSize;
    const q = filters.q?.trim() ?? "";
    const qLike = q ? `%${q}%` : null;
    const view = filters.view ?? "all";
    const sort = filters.sort ?? "newest";
    const caseId = filters.caseId || null;
    const assetId = filters.assetId || null;
    const rows = await this.sql`
      with discussion_rows as (
        select
          sdm.*,
          creator.name as created_by_name,
          updater.name as updated_by_name,
          owner.name as thread_owner_user_name,
          wi.number as case_number,
          wi.title as case_title,
          wi.status as case_status,
          sdr.read_at,
          (${userId ?? null}::uuid is not null and sdm.created_by <> ${userId ?? null}::uuid and sdr.read_at is null) as is_unread,
          (
            select count(*)
            from service_discussion_messages replies
            where replies.parent_message_id = sdm.message_id
              and replies.deleted_at is null
          ) as reply_count,
          (
            select max(replies.updated_at)
            from service_discussion_messages replies
            where replies.parent_message_id = sdm.message_id
              and replies.deleted_at is null
          ) as latest_reply_at
        from service_discussion_messages sdm
        join users creator on creator.user_id = sdm.created_by
        left join users updater on updater.user_id = sdm.updated_by
        left join users owner on owner.user_id = sdm.thread_owner_user_id
        left join work_items wi on wi.work_item_id = sdm.work_item_id
        left join service_discussion_reads sdr on sdr.message_id = sdm.message_id and sdr.user_id = ${userId ?? null}
        where sdm.deleted_at is null
          and sdm.parent_message_id is null
          and (sdm.work_item_id is null or wi.deleted_at is null)
      )
      select *, count(*) over() as total_count
      from discussion_rows
      where (${caseId}::text is null or work_item_id::text = ${caseId})
        and (${assetId}::text is null or exists (
          select 1
          from service_discussion_asset_links asset_filter
          join service_discussion_messages linked_message on linked_message.message_id = asset_filter.message_id
          where asset_filter.asset_id::text = ${assetId}
            and linked_message.deleted_at is null
            and (
              linked_message.message_id = discussion_rows.message_id
              or linked_message.parent_message_id = discussion_rows.message_id
            )
        ))
        and (${view} <> 'unlinked' or work_item_id is null)
        and (${view} <> 'pinned' or is_pinned = true or exists (
          select 1 from service_discussion_messages reply_filter
          where reply_filter.parent_message_id = discussion_rows.message_id
            and reply_filter.deleted_at is null
            and reply_filter.is_pinned = true
        ))
        and (${view} <> 'decisions' or message_type = 'decision' or exists (
          select 1 from service_discussion_messages reply_filter
          where reply_filter.parent_message_id = discussion_rows.message_id
            and reply_filter.deleted_at is null
            and reply_filter.message_type = 'decision'
        ))
        and (${view} <> 'needs-action' or thread_status = 'needs-action')
        and (${view} <> 'resolved' or thread_status = 'resolved')
        and (${view} <> 'unread' or (
          ${userId ?? null}::uuid is not null
          and (
            (created_by <> ${userId ?? null}::uuid and read_at is null)
            or exists (
              select 1
              from service_discussion_messages reply_filter
              left join service_discussion_reads reply_read
                on reply_read.message_id = reply_filter.message_id and reply_read.user_id = ${userId ?? null}
              where reply_filter.parent_message_id = discussion_rows.message_id
                and reply_filter.deleted_at is null
                and reply_filter.created_by <> ${userId ?? null}::uuid
                and reply_read.read_at is null
            )
          )
        ))
        and (${view} <> 'mentions' or exists (
          select 1
          from service_discussion_mentions mention_filter
          join service_discussion_messages mentioned_message on mentioned_message.message_id = mention_filter.message_id
          where (mentioned_message.message_id = discussion_rows.message_id or mentioned_message.parent_message_id = discussion_rows.message_id)
            and mentioned_message.deleted_at is null
            and mention_filter.user_id = ${userId ?? null}
        ))
        and (${view} <> 'my-attention' or (
          ${userId ?? null}::uuid is not null
          and thread_status not in ('resolved', 'archived')
          and (
            thread_owner_user_id = ${userId ?? null}::uuid
            or (created_by <> ${userId ?? null}::uuid and read_at is null)
            or exists (
              select 1
              from service_discussion_messages reply_filter
              left join service_discussion_reads reply_read
                on reply_read.message_id = reply_filter.message_id and reply_read.user_id = ${userId ?? null}
              where reply_filter.parent_message_id = discussion_rows.message_id
                and reply_filter.deleted_at is null
                and reply_filter.created_by <> ${userId ?? null}::uuid
                and reply_read.read_at is null
            )
            or exists (
              select 1
              from service_discussion_mentions attention_mentions
              join service_discussion_messages mentioned_message on mentioned_message.message_id = attention_mentions.message_id
              where (mentioned_message.message_id = discussion_rows.message_id or mentioned_message.parent_message_id = discussion_rows.message_id)
                and mentioned_message.deleted_at is null
                and attention_mentions.user_id = ${userId ?? null}
            )
          )
        ))
        and (${view} <> 'attachments' or exists (
          select 1
          from service_discussion_attachments attachment_filter
          join service_discussion_messages attached_message on attached_message.message_id = attachment_filter.message_id
          where (attached_message.message_id = discussion_rows.message_id or attached_message.parent_message_id = discussion_rows.message_id)
            and attached_message.deleted_at is null
        ))
        and (
          ${qLike}::text is null
          or concat_ws(' ', message_id::text, title, body_text, message_type, created_by_name, thread_owner_user_name, case_number, case_title) ilike ${qLike}
          or exists (
            select 1
            from service_discussion_mentions sm
            join users u on u.user_id = sm.user_id
            where sm.message_id = discussion_rows.message_id and u.name ilike ${qLike}
          )
          or exists (
            select 1
            from service_discussion_attachments sda
            join documents d on d.document_id = sda.document_id
            where sda.message_id = discussion_rows.message_id
              and d.deleted_at is null
              and d.original_file_name ilike ${qLike}
          )
          or exists (
            select 1
            from service_discussion_messages reply_match
            join users reply_creator on reply_creator.user_id = reply_match.created_by
            left join users reply_owner on reply_owner.user_id = reply_match.thread_owner_user_id
            where reply_match.parent_message_id = discussion_rows.message_id
              and reply_match.deleted_at is null
              and (
                concat_ws(' ', reply_match.message_id::text, reply_match.title, reply_match.body_text, reply_match.message_type, reply_creator.name, reply_owner.name) ilike ${qLike}
                or exists (
                  select 1
                  from service_discussion_mentions reply_mention
                  join users mentioned_user on mentioned_user.user_id = reply_mention.user_id
                  where reply_mention.message_id = reply_match.message_id and mentioned_user.name ilike ${qLike}
                )
                or exists (
                  select 1
                  from service_discussion_attachments reply_attachment
                  join documents reply_document on reply_document.document_id = reply_attachment.document_id
                  where reply_attachment.message_id = reply_match.message_id
                    and reply_document.deleted_at is null
                    and reply_document.original_file_name ilike ${qLike}
                )
              )
          )
        )
      order by
        case when ${sort} = 'oldest' then created_at end asc nulls last,
        case when ${sort} = 'recent' then coalesce(latest_reply_at, updated_at) end desc nulls last,
        case when ${sort} = 'newest' then created_at end desc nulls last,
        created_at desc
      limit ${pageInfo.pageSize}
      offset ${offset}
    `;
    const messages = await this.hydrateServiceDiscussionRows(rows as Row[]);
    const rootIds = messages.map((message) => message.messageId);
    if (rootIds.length) {
      const replyRows = await this.sql`
        select
          reply.*,
          creator.name as created_by_name,
          updater.name as updated_by_name,
          owner.name as thread_owner_user_name,
          wi.number as case_number,
          wi.title as case_title,
          wi.status as case_status,
          sdr.read_at,
          (${userId ?? null}::uuid is not null and reply.created_by <> ${userId ?? null}::uuid and sdr.read_at is null) as is_unread,
          0::integer as reply_count,
          null::timestamptz as latest_reply_at
        from service_discussion_messages reply
        join users creator on creator.user_id = reply.created_by
        left join users updater on updater.user_id = reply.updated_by
        left join users owner on owner.user_id = reply.thread_owner_user_id
        left join work_items wi on wi.work_item_id = reply.work_item_id
        left join service_discussion_reads sdr on sdr.message_id = reply.message_id and sdr.user_id = ${userId ?? null}
        where reply.parent_message_id = any(${rootIds}::uuid[])
          and reply.deleted_at is null
        order by reply.created_at asc
      `;
      const replies = await this.hydrateServiceDiscussionRows(replyRows as Row[]);
      for (const message of messages) {
        message.replies = replies.filter((reply) => reply.parentMessageId === message.messageId);
      }
    }
    const total = rows[0] ? asNumber((rows[0] as Row).total_count) : 0;
    return paginatedResult(messages, total, pageInfo);
  }

  async getServiceDiscussionSummary(
    filters: ServiceDiscussionFilters = {},
    userId?: string
  ): Promise<ServiceDiscussionSummary> {
    const q = filters.q?.trim() ?? "";
    const qLike = q ? `%${q}%` : null;
    const caseId = filters.caseId || null;
    const assetId = filters.assetId || null;
    const rows = await this.sql`
      with roots as (
        select
          root.message_id,
          root.work_item_id,
          root.title,
          root.body_text,
          root.message_type,
          root.thread_status,
          root.thread_owner_user_id,
          root.is_pinned,
          root.created_by,
          creator.name as created_by_name,
          owner.name as thread_owner_user_name,
          wi.number as case_number,
          wi.title as case_title,
          root_read.read_at
        from service_discussion_messages root
        join users creator on creator.user_id = root.created_by
        left join users owner on owner.user_id = root.thread_owner_user_id
        left join work_items wi on wi.work_item_id = root.work_item_id
        left join service_discussion_reads root_read
          on root_read.message_id = root.message_id and root_read.user_id = ${userId ?? null}
        where root.deleted_at is null
          and root.parent_message_id is null
          and (root.work_item_id is null or wi.deleted_at is null)
      ),
      facts as (
        select
          roots.*,
          (
            ${userId ?? null}::uuid is not null
            and (
              (roots.created_by <> ${userId ?? null}::uuid and roots.read_at is null)
              or exists (
                select 1
                from service_discussion_messages reply
                left join service_discussion_reads reply_read
                  on reply_read.message_id = reply.message_id and reply_read.user_id = ${userId ?? null}
                where reply.parent_message_id = roots.message_id
                  and reply.deleted_at is null
                  and reply.created_by <> ${userId ?? null}::uuid
                  and reply_read.read_at is null
              )
            )
          ) as has_unread,
          exists (
            select 1
            from service_discussion_mentions mention
            join service_discussion_messages mentioned on mentioned.message_id = mention.message_id
            where (mentioned.message_id = roots.message_id or mentioned.parent_message_id = roots.message_id)
              and mentioned.deleted_at is null
              and mention.user_id = ${userId ?? null}
          ) as has_mention,
          (
            roots.is_pinned = true
            or exists (
              select 1 from service_discussion_messages reply
              where reply.parent_message_id = roots.message_id and reply.deleted_at is null and reply.is_pinned = true
            )
          ) as has_pinned,
          (
            roots.message_type = 'decision'
            or exists (
              select 1 from service_discussion_messages reply
              where reply.parent_message_id = roots.message_id and reply.deleted_at is null and reply.message_type = 'decision'
            )
          ) as has_decision,
          exists (
            select 1
            from service_discussion_attachments attachment
            join service_discussion_messages attached on attached.message_id = attachment.message_id
            where (attached.message_id = roots.message_id or attached.parent_message_id = roots.message_id)
              and attached.deleted_at is null
          ) as has_attachment
        from roots
        where (${caseId}::text is null or roots.work_item_id::text = ${caseId})
          and (${assetId}::text is null or exists (
            select 1
            from service_discussion_asset_links asset_filter
            join service_discussion_messages linked_message on linked_message.message_id = asset_filter.message_id
            where asset_filter.asset_id::text = ${assetId}
              and linked_message.deleted_at is null
              and (linked_message.message_id = roots.message_id or linked_message.parent_message_id = roots.message_id)
          ))
          and (
            ${qLike}::text is null
            or concat_ws(' ', roots.message_id::text, roots.title, roots.body_text, roots.message_type,
              roots.created_by_name, roots.thread_owner_user_name, roots.case_number, roots.case_title) ilike ${qLike}
            or exists (
              select 1
              from service_discussion_mentions mention
              join users mentioned_user on mentioned_user.user_id = mention.user_id
              where mention.message_id = roots.message_id and mentioned_user.name ilike ${qLike}
            )
            or exists (
              select 1
              from service_discussion_attachments attachment
              join documents document on document.document_id = attachment.document_id
              where attachment.message_id = roots.message_id
                and document.deleted_at is null
                and document.original_file_name ilike ${qLike}
            )
            or exists (
              select 1
              from service_discussion_messages reply
              join users reply_creator on reply_creator.user_id = reply.created_by
              left join users reply_owner on reply_owner.user_id = reply.thread_owner_user_id
              where reply.parent_message_id = roots.message_id
                and reply.deleted_at is null
                and (
                  concat_ws(' ', reply.message_id::text, reply.title, reply.body_text, reply.message_type,
                    reply_creator.name, reply_owner.name) ilike ${qLike}
                  or exists (
                    select 1 from service_discussion_mentions reply_mention
                    join users reply_mentioned_user on reply_mentioned_user.user_id = reply_mention.user_id
                    where reply_mention.message_id = reply.message_id and reply_mentioned_user.name ilike ${qLike}
                  )
                  or exists (
                    select 1 from service_discussion_attachments reply_attachment
                    join documents reply_document on reply_document.document_id = reply_attachment.document_id
                    where reply_attachment.message_id = reply.message_id
                      and reply_document.deleted_at is null
                      and reply_document.original_file_name ilike ${qLike}
                  )
                )
            )
          )
      )
      select
        count(*)::integer as all_count,
        count(*) filter (
          where ${userId ?? null}::uuid is not null
            and thread_status not in ('resolved', 'archived')
            and (thread_owner_user_id = ${userId ?? null}::uuid or has_unread or has_mention)
        )::integer as my_attention_count,
        count(*) filter (where has_unread)::integer as unread_count,
        count(*) filter (where has_mention)::integer as mentions_count,
        count(*) filter (where thread_status = 'needs-action')::integer as needs_action_count,
        count(*) filter (where thread_status = 'resolved')::integer as resolved_count,
        count(*) filter (where has_pinned)::integer as pinned_count,
        count(*) filter (where has_decision)::integer as decisions_count,
        count(*) filter (where has_attachment)::integer as attachments_count,
        count(*) filter (where work_item_id is null)::integer as unlinked_count
      from facts
    `;
    const row = (rows[0] ?? {}) as Row;
    return {
      all: asNumber(row.all_count),
      myAttention: asNumber(row.my_attention_count),
      unread: asNumber(row.unread_count),
      mentions: asNumber(row.mentions_count),
      needsAction: asNumber(row.needs_action_count),
      resolved: asNumber(row.resolved_count),
      pinned: asNumber(row.pinned_count),
      decisions: asNumber(row.decisions_count),
      attachments: asNumber(row.attachments_count),
      unlinked: asNumber(row.unlinked_count)
    };
  }

  async getServiceDiscussionMessage(messageId: string): Promise<ServiceDiscussionMessage | null> {
    const rows = await this.sql`
      select
        sdm.*,
        creator.name as created_by_name,
        updater.name as updated_by_name,
        owner.name as thread_owner_user_name,
        wi.number as case_number,
        wi.title as case_title,
        wi.status as case_status,
        null::timestamptz as read_at,
        false as is_unread,
        (
          select count(*)
          from service_discussion_messages replies
          where replies.parent_message_id = sdm.message_id
            and replies.deleted_at is null
        ) as reply_count
      from service_discussion_messages sdm
      join users creator on creator.user_id = sdm.created_by
      left join users updater on updater.user_id = sdm.updated_by
      left join users owner on owner.user_id = sdm.thread_owner_user_id
      left join work_items wi on wi.work_item_id = sdm.work_item_id
      where sdm.message_id = ${messageId}
        and sdm.deleted_at is null
      limit 1
    `;
    if (!rows[0]) return null;
    return (await this.hydrateServiceDiscussionRows([rows[0] as Row]))[0] ?? null;
  }

  async createServiceDiscussionMessage(input: CreateServiceDiscussionMessageInput): Promise<ServiceDiscussionMessage> {
    const messageId = crypto.randomUUID();
    await this.sql.begin(async (sql) => {
      await sql`
        insert into service_discussion_messages (
          message_id, tenant_id, work_item_id, parent_message_id, title, body_text, message_type, visibility, thread_status, thread_owner_user_id, is_pinned, created_by, updated_by
        ) values (
          ${messageId}, ${DEFAULT_TENANT_ID}, ${input.caseId ?? null}, ${input.parentMessageId ?? null},
          ${input.parentMessageId ? null : resolveDiscussionTitle(input.title, input.bodyText)}, ${input.bodyText.trim()},
          ${input.messageType ?? "message"}, ${input.visibility ?? "team"}, ${input.threadStatus ?? "open"}, ${input.threadOwnerUserId ?? null}, ${Boolean(input.isPinned)}, ${input.createdBy}, ${input.updatedBy ?? input.createdBy}
        )
      `;
      await this.replaceServiceDiscussionMentions(sql, messageId, input.mentionedUserIds);
    });
    const created = await this.getServiceDiscussionMessage(messageId);
    if (!created) throw new Error("Failed to create service discussion message");
    return created;
  }

  async updateServiceDiscussionMessage(
    messageId: string,
    input: UpdateServiceDiscussionMessageInput
  ): Promise<ServiceDiscussionMessage | null> {
    const current = await this.getServiceDiscussionMessage(messageId);
    if (!current) return null;
    const bodyText = input.bodyText === undefined ? current.bodyText : input.bodyText.trim();
    const bodyChanged = bodyText !== current.bodyText;
    const title = current.parentMessageId
      ? null
      : input.title === undefined
        ? resolveDiscussionTitle(current.title, bodyText)
        : resolveDiscussionTitle(input.title, bodyText);
    const titleChanged = title !== (current.title ?? null);
    const nextThreadStatus = input.threadStatus ?? current.threadStatus;
    const nextThreadOwnerUserId =
      input.threadOwnerUserId === undefined ? current.threadOwnerUserId ?? null : input.threadOwnerUserId ?? null;
    const rootId = current.parentMessageId ?? current.messageId;
    await this.sql.begin(async (sql) => {
      await sql`
        update service_discussion_messages
        set title = ${title},
            body_text = ${bodyText},
            message_type = ${input.messageType ?? current.messageType},
            thread_status = ${nextThreadStatus},
            thread_owner_user_id = ${nextThreadOwnerUserId},
            is_pinned = ${input.isPinned ?? current.isPinned},
            updated_by = ${input.updatedBy ?? current.updatedBy ?? null},
            updated_at = now(),
            edited_at = ${bodyChanged || titleChanged ? new Date().toISOString() : current.editedAt ?? null}
        where message_id = ${messageId}
          and deleted_at is null
      `;
      if (input.threadStatus !== undefined || input.threadOwnerUserId !== undefined) {
        await sql`
          update service_discussion_messages
          set thread_status = ${nextThreadStatus},
              thread_owner_user_id = ${nextThreadOwnerUserId},
              updated_by = ${input.updatedBy ?? current.updatedBy ?? null},
              updated_at = now()
          where deleted_at is null
            and (message_id = ${rootId} or parent_message_id = ${rootId})
        `;
      }
      if (input.mentionedUserIds) await this.replaceServiceDiscussionMentions(sql, messageId, input.mentionedUserIds);
    });
    return this.getServiceDiscussionMessage(messageId);
  }

  async softDeleteServiceDiscussionMessage(messageId: string): Promise<ServiceDiscussionMessage | null> {
    const current = await this.getServiceDiscussionMessage(messageId);
    if (!current) return null;
    await this.sql`
      update service_discussion_messages
      set deleted_at = now(),
          updated_at = now()
      where message_id = ${messageId}
        and deleted_at is null
    `;
    return { ...current, deletedAt: new Date().toISOString() };
  }

  async linkServiceDiscussionThread(messageId: string, caseId: string, updatedBy: string): Promise<ServiceDiscussionMessage[]> {
    const current = await this.getServiceDiscussionMessage(messageId);
    if (!current) return [];
    const rootId = current.parentMessageId ?? current.messageId;
    const linkedRows = await this.sql.begin(async (sql) => {
      const rows = await sql`
        update service_discussion_messages
        set work_item_id = ${caseId},
            updated_by = ${updatedBy},
            updated_at = now()
        where deleted_at is null
          and (message_id = ${rootId} or parent_message_id = ${rootId})
        returning message_id
      `;
      await sql`
        update documents
        set case_id = ${caseId},
            work_item_id = ${caseId}
        where document_id in (
          select sda.document_id
          from service_discussion_attachments sda
          where sda.message_id in (select message_id from service_discussion_messages where message_id = ${rootId} or parent_message_id = ${rootId})
        )
          and deleted_at is null
      `;
      return rows;
    });
    const linked = await Promise.all(
      linkedRows.map((row) => this.getServiceDiscussionMessage(asString((row as Row).message_id)))
    );
    return linked.filter((message): message is ServiceDiscussionMessage => Boolean(message));
  }

  async updateServiceDiscussionThreadContext(
    messageId: string,
    caseId: string | null,
    assetIds: string[],
    updatedBy: string
  ): Promise<ServiceDiscussionMessage[]> {
    const current = await this.getServiceDiscussionMessage(messageId);
    if (!current) return [];
    const rootId = current.parentMessageId ?? current.messageId;
    const uniqueAssetIds = [...new Set(assetIds)];
    const updatedRows = await this.sql.begin(async (sql) => {
      const rows = await sql`
        update service_discussion_messages
        set work_item_id = ${caseId},
            updated_by = ${updatedBy},
            updated_at = now()
        where deleted_at is null
          and (message_id = ${rootId} or parent_message_id = ${rootId})
        returning message_id
      `;
      await sql`
        update documents
        set case_id = ${caseId},
            work_item_id = ${caseId}
        where document_id in (
          select sda.document_id
          from service_discussion_attachments sda
          where sda.message_id in (
            select message_id
            from service_discussion_messages
            where message_id = ${rootId} or parent_message_id = ${rootId}
          )
        )
          and deleted_at is null
      `;
      await sql`
        delete from service_discussion_asset_links
        where message_id in (
          select message_id
          from service_discussion_messages
          where message_id = ${rootId} or parent_message_id = ${rootId}
        )
      `;
      for (const assetId of uniqueAssetIds) {
        await sql`
          insert into service_discussion_asset_links (message_id, asset_id, relationship, created_by)
          values (${rootId}, ${assetId}, 'discussion context', ${updatedBy})
        `;
      }
      return rows;
    });
    const updated = await Promise.all(
      updatedRows.map((row) => this.getServiceDiscussionMessage(asString((row as Row).message_id)))
    );
    return updated.filter((message): message is ServiceDiscussionMessage => Boolean(message));
  }

  async markServiceDiscussionRead(messageId: string, userId: string): Promise<ServiceDiscussionMessage | null> {
    const current = await this.getServiceDiscussionMessage(messageId);
    if (!current) return null;
    await this.sql`
      insert into service_discussion_reads (message_id, user_id, read_at)
      values (${messageId}, ${userId}, now())
      on conflict (message_id, user_id) do update
      set read_at = excluded.read_at
    `;
    const rows = await this.sql`
      select
        sdm.*,
        creator.name as created_by_name,
        updater.name as updated_by_name,
        owner.name as thread_owner_user_name,
        wi.number as case_number,
        wi.title as case_title,
        wi.status as case_status,
        sdr.read_at,
        false as is_unread,
        (
          select count(*)
          from service_discussion_messages replies
          where replies.parent_message_id = sdm.message_id
            and replies.deleted_at is null
        ) as reply_count
      from service_discussion_messages sdm
      join users creator on creator.user_id = sdm.created_by
      left join users updater on updater.user_id = sdm.updated_by
      left join users owner on owner.user_id = sdm.thread_owner_user_id
      left join work_items wi on wi.work_item_id = sdm.work_item_id
      left join service_discussion_reads sdr on sdr.message_id = sdm.message_id and sdr.user_id = ${userId}
      where sdm.message_id = ${messageId}
        and sdm.deleted_at is null
      limit 1
    `;
    if (!rows[0]) return null;
    return mapServiceDiscussionMessage(
      rows[0] as Row,
      await this.serviceDiscussionAttachmentsFor(messageId),
      await this.serviceDiscussionMentionsFor(messageId),
      await this.serviceDiscussionAssetLinksFor(messageId)
    );
  }

  async markServiceDiscussionsRead(filters: ServiceDiscussionFilters, userId: string): Promise<number> {
    const page = await this.listServiceDiscussionsPage(filters, { page: 1, pageSize: 100 }, userId);
    const unreadIds = page.items
      .flatMap((message) => [message, ...(message.replies ?? [])])
      .filter((message) => message.isUnread)
      .map((message) => message.messageId);
    for (const messageId of unreadIds) {
      await this.sql`
        insert into service_discussion_reads (message_id, user_id, read_at)
        values (${messageId}, ${userId}, now())
        on conflict (message_id, user_id) do update
        set read_at = excluded.read_at
      `;
    }
    return unreadIds.length;
  }

  async linkServiceDiscussionAsset(input: CreateServiceDiscussionAssetLinkInput): Promise<ServiceDiscussionAssetLink> {
    const rows = await this.sql`
      insert into service_discussion_asset_links (message_id, asset_id, relationship, created_by)
      values (${input.messageId}, ${input.assetId}, ${input.relationship?.trim() || "related"}, ${input.createdBy ?? null})
      on conflict (message_id, asset_id) do update
      set relationship = excluded.relationship
      returning *
    `;
    const row = rows[0] as Row;
    const links = await this.serviceDiscussionAssetLinksFor(asString(row.message_id));
    const link = links.find((item) => item.discussionAssetLinkId === asString(row.discussion_asset_link_id));
    if (!link) throw new Error("Failed to link discussion asset");
    return link;
  }

  async unlinkServiceDiscussionAsset(messageId: string, assetId: string): Promise<boolean> {
    const rows = await this.sql`
      delete from service_discussion_asset_links
      where message_id = ${messageId}
        and asset_id = ${assetId}
      returning discussion_asset_link_id
    `;
    return rows.length > 0;
  }

  async createDocumentWithDiscussionAttachment(input: CreateDocumentInput, attachment: Omit<CreateServiceDiscussionAttachmentInput, "documentId">): Promise<ServiceDiscussionAttachment> {
    return this.sql.begin(async (sql) => {
      await lockArchiveHierarchy(sql);
      const transaction = new PostgresRepository(archiveTransactionConnection(sql));
      const document = await transaction.createDocument(input);
      return transaction.createServiceDiscussionAttachment({ ...attachment, documentId: document.documentId });
    }) as Promise<ServiceDiscussionAttachment>;
  }

  async createServiceDiscussionAttachment(
    input: CreateServiceDiscussionAttachmentInput
  ): Promise<ServiceDiscussionAttachment> {
    const rows = await this.sql`
      insert into service_discussion_attachments (message_id, document_id, inline_image, sort_order)
      values (${input.messageId}, ${input.documentId}, ${Boolean(input.inlineImage)}, ${input.sortOrder ?? 0})
      on conflict (message_id, document_id) do update
      set inline_image = excluded.inline_image,
          sort_order = excluded.sort_order
      returning *
    `;
    const attachmentRow = rows[0] as Row;
    const document = await this.getDocument(input.documentId);
    if (!document) throw new Error("Document not found");
    return mapServiceDiscussionAttachment(attachmentRow, document);
  }

  private async knowledgeLinksFor(knowledgeId: string): Promise<KnowledgeLink[]> {
    const rows = await this.sql`
      select
        kl.*,
        case
          when kl.entity_type = 'service' then concat_ws(' - ', wi.number, wi.title)
          when kl.entity_type = 'asset' then ma.name
          when kl.entity_type = 'document' then d.original_file_name
          when kl.entity_type = 'credential' then ac.label
          when kl.entity_type = 'discussion' then concat('Discussion: ', left(nullif(sdm.body_text, ''), 80))
          else null
        end as label,
        case
          when kl.entity_type = 'service' then wi.status
          when kl.entity_type = 'asset' then concat_ws(' · ', ma.asset_type, nullif(ma.hostname, ''), nullif(ma.lan_ip, ''), nullif(ma.wan_ip, ''))
          when kl.entity_type = 'document' then concat_ws(' · ', d.category, d.review_status)
          when kl.entity_type = 'credential' then concat_ws(' · ', ac.credential_type, nullif(ac.username, ''), nullif(ac.host, ''))
          when kl.entity_type = 'discussion' then concat_ws(' · ', sdm.message_type, owner.name, wi_discussion.number)
          else null
        end as detail
      from knowledge_links kl
      left join work_items wi on kl.entity_type = 'service' and wi.work_item_id = kl.entity_id
      left join managed_assets ma on kl.entity_type = 'asset' and ma.asset_id = kl.entity_id
      left join documents d on kl.entity_type = 'document' and d.document_id = kl.entity_id
      left join asset_credentials ac on kl.entity_type = 'credential' and ac.credential_id = kl.entity_id
      left join service_discussion_messages sdm on kl.entity_type = 'discussion' and sdm.message_id = kl.entity_id
      left join users owner on owner.user_id = sdm.created_by
      left join work_items wi_discussion on wi_discussion.work_item_id = sdm.work_item_id
      where kl.knowledge_id = ${knowledgeId}
      order by kl.created_at asc
    `;
    return rows.map((row) => mapKnowledgeLink(row as Row));
  }

  private normalizeKnowledgeLinks(
    links: KnowledgeLinkInput[] = [],
    sourceServiceId?: string | null
  ): KnowledgeLinkInput[] {
    const inputLinks = sourceServiceId
      ? [{ entityType: "service" as const, entityId: sourceServiceId, relationship: "source" }, ...links]
      : links;
    const seen = new Set<string>();
    return inputLinks
      .filter((link) => link.entityId)
      .filter((link) => {
        const key = `${link.entityType}:${link.entityId}:${link.relationship || "related"}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((link) => ({
        entityType: link.entityType,
        entityId: link.entityId,
        relationship: link.relationship?.trim() || "related"
      }));
  }

  private async replaceKnowledgeLinks(
    sql: Sql | TransactionSql,
    knowledgeId: string,
    links: KnowledgeLinkInput[],
    sourceServiceId?: string | null
  ): Promise<void> {
    await sql`delete from knowledge_links where knowledge_id = ${knowledgeId}`;
    for (const link of this.normalizeKnowledgeLinks(links, sourceServiceId)) {
      await sql`
        insert into knowledge_links (knowledge_id, entity_type, entity_id, relationship)
        values (${knowledgeId}, ${link.entityType}, ${link.entityId}, ${link.relationship || "related"})
      `;
    }
  }

  private async hydrateKnowledgeRows(rows: readonly Row[]): Promise<KnowledgeItem[]> {
    return Promise.all(
      rows.map(async (row) => mapKnowledgeItem(row, await this.knowledgeLinksFor(asString(row.knowledge_id))))
    );
  }

  async listKnowledge(filters: KnowledgeFilters = {}): Promise<KnowledgeItem[]> {
    const items: KnowledgeItem[] = [];
    let pageNumber = 1;
    let hasNextPage = true;
    while (hasNextPage) {
      const page = await this.listKnowledgePage(filters, { page: pageNumber, pageSize: 100 });
      items.push(...page.items);
      hasNextPage = page.hasNextPage;
      pageNumber += 1;
    }
    return items;
  }

  async listKnowledgePage(filters: KnowledgeFilters = {}, pagination: PaginationParams = {}): Promise<PaginatedResult<KnowledgeItem>> {
    const pageInfo = normalizePagination(pagination);
    const offset = (pageInfo.page - 1) * pageInfo.pageSize;
    const q = filters.q?.trim() ?? "";
    const qLike = q ? `%${q}%` : null;
    const type = filters.type || null;
    const status = filters.status || null;
    const component = filters.component || null;
    const caseId = filters.caseId || null;
    const assetId = filters.assetId || null;
    const documentId = filters.documentId || null;
    const trashed = Boolean(filters.trashed);
    const sort = filters.sort || "updated";
    const direction = filters.direction || "desc";
    const rows = await this.sql`
      with knowledge_rows as (
        select
          ki.*,
          source.number as source_service_number,
          source.title as source_service_title,
          created.name as created_by_name,
          updated.name as updated_by_name
        from knowledge_items ki
        left join work_items source on source.work_item_id = ki.source_work_item_id
        left join users created on created.user_id = ki.created_by
        left join users updated on updated.user_id = ki.updated_by
        where (
          (${trashed}::boolean and ki.deleted_at is not null)
          or (not ${trashed}::boolean and ki.deleted_at is null)
        )
      )
      select *, count(*) over() as total_count
      from knowledge_rows
      where (${type}::text is null or knowledge_type = ${type})
        and (${status}::text is null or status = ${status})
        and (${component}::text is null or component = ${component})
        and (
          ${caseId}::text is null
          or source_work_item_id::text = ${caseId}
          or exists (
            select 1
            from knowledge_links kl
            where kl.knowledge_id = knowledge_rows.knowledge_id
              and kl.entity_type = 'service'
              and kl.entity_id::text = ${caseId}
          )
        )
        and (
          ${assetId}::text is null
          or exists (
            select 1
            from knowledge_links kl
            where kl.knowledge_id = knowledge_rows.knowledge_id
              and kl.entity_type = 'asset'
              and kl.entity_id::text = ${assetId}
          )
        )
        and (
          ${documentId}::text is null
          or exists (
            select 1
            from knowledge_links kl
            where kl.knowledge_id = knowledge_rows.knowledge_id
              and kl.entity_type = 'document'
              and kl.entity_id::text = ${documentId}
          )
        )
        and (
          ${qLike}::text is null
          or concat_ws(
            ' ',
            title,
            knowledge_type,
            status,
            component,
            summary,
            body,
            credential_reference,
            source_service_number,
            source_service_title,
            array_to_string(keywords, ' ')
          ) ilike ${qLike}
          or exists (
            select 1
            from knowledge_links kl
            left join work_items wi on kl.entity_type = 'service' and wi.work_item_id = kl.entity_id
            left join managed_assets ma on kl.entity_type = 'asset' and ma.asset_id = kl.entity_id
            left join documents d on kl.entity_type = 'document' and d.document_id = kl.entity_id
            left join asset_credentials ac on kl.entity_type = 'credential' and ac.credential_id = kl.entity_id
            where kl.knowledge_id = knowledge_rows.knowledge_id
              and concat_ws(
                ' ',
                kl.relationship,
                wi.number,
                wi.title,
                ma.name,
                ma.asset_type,
                ma.hostname,
                ma.lan_ip,
                ma.wan_ip,
                d.original_file_name,
                d.category,
                ac.label,
                ac.credential_type,
                ac.username,
                ac.host
              ) ilike ${qLike}
          )
        )
      order by
        case when ${sort} = 'title' and ${direction} = 'asc' then personal_archive_natural_sort_key(title) end asc nulls last,
        case when ${sort} = 'title' and ${direction} = 'desc' then personal_archive_natural_sort_key(title) end desc nulls last,
        case when ${sort} = 'type' and ${direction} = 'asc' then knowledge_type end asc nulls last,
        case when ${sort} = 'type' and ${direction} = 'desc' then knowledge_type end desc nulls last,
        case when ${sort} = 'status' and ${direction} = 'asc' then status end asc nulls last,
        case when ${sort} = 'status' and ${direction} = 'desc' then status end desc nulls last,
        case when ${sort} = 'component' and ${direction} = 'asc' then lower(component) end asc nulls last,
        case when ${sort} = 'component' and ${direction} = 'desc' then lower(component) end desc nulls last,
        case when ${sort} = 'verified' and ${direction} = 'asc' then last_verified_at end asc nulls last,
        case when ${sort} = 'verified' and ${direction} = 'desc' then last_verified_at end desc nulls last,
        case when ${sort} = 'updated' and ${direction} = 'asc' then updated_at end asc nulls last,
        case when ${sort} = 'updated' and ${direction} = 'desc' then updated_at end desc nulls last,
        updated_at desc
      limit ${pageInfo.pageSize}
      offset ${offset}
    `;
    const items = await this.hydrateKnowledgeRows(rows as Row[]);
    const total = rows[0] ? asNumber((rows[0] as Row).total_count) : 0;
    return paginatedResult(items, total, pageInfo);
  }

  async getKnowledge(knowledgeId: string, options: { includeDeleted?: boolean } = {}): Promise<KnowledgeItem | null> {
    const includeDeleted = Boolean(options.includeDeleted);
    const rows = await this.sql`
      select
        ki.*,
        source.number as source_service_number,
        source.title as source_service_title,
        created.name as created_by_name,
        updated.name as updated_by_name
      from knowledge_items ki
      left join work_items source on source.work_item_id = ki.source_work_item_id
      left join users created on created.user_id = ki.created_by
      left join users updated on updated.user_id = ki.updated_by
      where ki.knowledge_id = ${knowledgeId}
        and (${includeDeleted}::boolean or ki.deleted_at is null)
      limit 1
    `;
    if (!rows[0]) return null;
    return mapKnowledgeItem(rows[0] as Row, await this.knowledgeLinksFor(knowledgeId));
  }

  async createKnowledge(input: CreateKnowledgeInput): Promise<KnowledgeItem> {
    const knowledgeId = crypto.randomUUID();
    const sourceServiceId = input.sourceServiceId || input.links?.find((link) => link.entityType === "service")?.entityId || null;
    const keywords = [...new Set((input.keywords ?? []).map((keyword) => keyword.trim()).filter(Boolean))];
    await this.sql.begin(async (sql) => {
      await sql`
        insert into knowledge_items (
          knowledge_id, tenant_id, title, knowledge_type, status, component, summary, body, keywords,
          credential_reference, source_work_item_id, last_verified_at, created_by, updated_by
        ) values (
          ${knowledgeId}, ${DEFAULT_TENANT_ID}, ${input.title.trim()}, ${input.type}, ${input.status}, ${input.component.trim()},
          ${input.summary.trim()}, ${input.body.trim()}, ${keywords}::text[], ${input.credentialReference?.trim() ?? ""},
          ${sourceServiceId}, ${input.lastVerifiedAt || null}, ${input.createdBy ?? null}, ${input.updatedBy ?? input.createdBy ?? null}
        )
      `;
      await this.replaceKnowledgeLinks(sql, knowledgeId, input.links ?? [], sourceServiceId);
    });
    const created = await this.getKnowledge(knowledgeId);
    if (!created) throw new Error("Failed to create knowledge item");
    return created;
  }

  async updateKnowledge(knowledgeId: string, input: UpdateKnowledgeInput): Promise<KnowledgeItem | null> {
    const current = await this.getKnowledge(knowledgeId);
    if (!current) return null;
    const sourceServiceId =
      input.sourceServiceId === undefined
        ? current.sourceServiceId ?? null
        : input.sourceServiceId || input.links?.find((link) => link.entityType === "service")?.entityId || null;
    const keywords =
      input.keywords === undefined
        ? current.keywords
        : [...new Set(input.keywords.map((keyword) => keyword.trim()).filter(Boolean))];
    await this.sql.begin(async (sql) => {
      await sql`
        update knowledge_items
        set title = ${input.title === undefined ? current.title : input.title.trim()},
            knowledge_type = ${input.type ?? current.type},
            status = ${input.status ?? current.status},
            component = ${input.component === undefined ? current.component : input.component.trim()},
            summary = ${input.summary === undefined ? current.summary : input.summary.trim()},
            body = ${input.body === undefined ? current.body : input.body.trim()},
            keywords = ${keywords}::text[],
            credential_reference = ${input.credentialReference === undefined ? current.credentialReference : input.credentialReference.trim()},
            source_work_item_id = ${sourceServiceId},
            last_verified_at = ${input.lastVerifiedAt === undefined ? current.lastVerifiedAt ?? null : input.lastVerifiedAt || null},
            updated_by = ${input.updatedBy ?? current.updatedBy ?? null},
            updated_at = now()
        where knowledge_id = ${knowledgeId} and deleted_at is null
      `;
      if (input.links !== undefined || input.sourceServiceId !== undefined) {
        await this.replaceKnowledgeLinks(sql, knowledgeId, input.links ?? current.links, sourceServiceId);
      }
    });
    return this.getKnowledge(knowledgeId);
  }

  async softDeleteKnowledge(knowledgeId: string): Promise<KnowledgeItem | null> {
    await this.sql`
      update knowledge_items
      set deleted_at = now(),
          updated_at = now()
      where knowledge_id = ${knowledgeId} and deleted_at is null
    `;
    const rows = await this.sql`
      select
        ki.*,
        source.number as source_service_number,
        source.title as source_service_title,
        created.name as created_by_name,
        updated.name as updated_by_name
      from knowledge_items ki
      left join work_items source on source.work_item_id = ki.source_work_item_id
      left join users created on created.user_id = ki.created_by
      left join users updated on updated.user_id = ki.updated_by
      where ki.knowledge_id = ${knowledgeId}
      limit 1
    `;
    return rows[0] ? mapKnowledgeItem(rows[0] as Row, await this.knowledgeLinksFor(knowledgeId)) : null;
  }

  async restoreKnowledge(knowledgeId: string): Promise<KnowledgeItem | null> {
    await this.sql`
      update knowledge_items
      set deleted_at = null,
          updated_at = now()
      where knowledge_id = ${knowledgeId} and deleted_at is not null
    `;
    return this.getKnowledge(knowledgeId);
  }

  async purgeKnowledge(knowledgeId: string): Promise<KnowledgeItem | null> {
    const current = await this.getKnowledge(knowledgeId, { includeDeleted: true });
    if (!current?.deletedAt) return null;
    await this.sql`
      delete from knowledge_items
      where knowledge_id = ${knowledgeId} and deleted_at is not null
    `;
    return current;
  }

  private async manuscriptChaptersFor(manuscriptId: string): Promise<ManuscriptChapterSummary[]> {
    const rows = await this.sql`
      select chapter_id, manuscript_id, title, content_format, sort_order, character_count, revision, last_save_source, created_at, updated_at
      from manuscript_chapters
      where manuscript_id = ${manuscriptId} and deleted_at is null
      order by sort_order asc, created_at asc
    `;
    return rows.map((row) => mapManuscriptChapterSummary(row as Row));
  }

  async listManuscripts(query = ""): Promise<Manuscript[]> {
    const q = query.trim();
    const qLike = q ? `%${q}%` : null;
    const rows = await this.sql`
      select
        m.*,
        created.name as created_by_name,
        updated.name as updated_by_name,
        (select count(*) from manuscript_chapters mc where mc.manuscript_id = m.manuscript_id and mc.deleted_at is null) as chapter_count,
        coalesce((select sum(mc.character_count) from manuscript_chapters mc where mc.manuscript_id = m.manuscript_id and mc.deleted_at is null), 0) as character_count
      from manuscripts m
      left join users created on created.user_id = m.created_by
      left join users updated on updated.user_id = m.updated_by
      where m.deleted_at is null
        and (
          ${qLike}::text is null
          or concat_ws(' ', m.title, m.manuscript_kind, m.status, m.description) ilike ${qLike}
          or exists (
            select 1 from manuscript_chapters search_chapter
            where search_chapter.manuscript_id = m.manuscript_id
              and search_chapter.deleted_at is null
              and concat_ws(' ', search_chapter.title, search_chapter.body) ilike ${qLike}
          )
        )
      order by m.updated_at desc, lower(m.title) asc
    `;
    return rows.map((row) => mapManuscript(row as Row));
  }

  async getManuscript(manuscriptId: string): Promise<Manuscript | null> {
    const rows = await this.sql`
      select
        m.*,
        created.name as created_by_name,
        updated.name as updated_by_name,
        (select count(*) from manuscript_chapters mc where mc.manuscript_id = m.manuscript_id and mc.deleted_at is null) as chapter_count,
        coalesce((select sum(mc.character_count) from manuscript_chapters mc where mc.manuscript_id = m.manuscript_id and mc.deleted_at is null), 0) as character_count
      from manuscripts m
      left join users created on created.user_id = m.created_by
      left join users updated on updated.user_id = m.updated_by
      where m.manuscript_id = ${manuscriptId} and m.deleted_at is null
      limit 1
    `;
    if (!rows[0]) return null;
    return mapManuscript(rows[0] as Row, await this.manuscriptChaptersFor(manuscriptId));
  }

  async createManuscript(input: CreateManuscriptInput): Promise<Manuscript> {
    const manuscriptId = crypto.randomUUID();
    await this.sql.begin(async (sql) => {
      await sql`
        insert into manuscripts (
          manuscript_id, tenant_id, title, manuscript_kind, status, description, created_by, updated_by, key_owner_user_id
        ) values (
          ${manuscriptId}, ${DEFAULT_TENANT_ID}, ${input.title.trim()}, ${input.kind}, ${input.status},
          ${input.description?.trim() ?? ""}, ${input.createdBy ?? null}, ${input.updatedBy ?? input.createdBy ?? null}, ${input.createdBy ?? null}
        )
      `;
      await sql`
        insert into manuscript_chapters (chapter_id, manuscript_id, title, body, content_format, sort_order, character_count)
        values (${crypto.randomUUID()}, ${manuscriptId}, 'Chapter 1', '', 'rich-text', 1000, 0)
      `;
    });
    const created = await this.getManuscript(manuscriptId);
    if (!created) throw new Error("Failed to create manuscript");
    return created;
  }

  async claimManuscriptKeyOwner(input: ManuscriptKeyOwnerClaimInput): Promise<void> {
    const claim = manuscriptKeyOwnerClaimSchema.parse(input);
    await this.sql.begin(async (sql) => {
      await lockArchiveHierarchy(sql);
      const rows = await sql`select manuscript_id from manuscripts
        where manuscript_id = ${claim.manuscriptId} and key_owner_user_id is null
          and updated_at = ${claim.expectedUpdatedAt}::text::timestamptz for update`;
      if (!rows.length) throw new Error("Key ownership review is stale or already claimed.");
      await sql`insert into manuscript_key_owner_claims
        (claim_id, manuscript_id, owner_user_id, previous_updated_at, evidence_reference, operator_reference)
        values (${crypto.randomUUID()}, ${claim.manuscriptId}, ${claim.ownerUserId},
          ${claim.expectedUpdatedAt}::text::timestamptz, ${claim.evidenceReference}, ${claim.operatorReference})`;
      await sql`update manuscripts set key_owner_user_id = ${claim.ownerUserId} where manuscript_id = ${claim.manuscriptId}`;
    });
  }

  async listUnresolvedManuscriptKeyOwnership() {
    const rows = await this.sql`select manuscript_id, created_by, encryption_enabled, deleted_at is not null as deleted,
      to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as review_updated_at
      from manuscripts where key_owner_user_id is null order by manuscript_id`;
    return rows.map((row) => ({ manuscriptId: asString(row.manuscript_id),
      createdBy: row.created_by ? asString(row.created_by) : null,
      expectedUpdatedAt: asString(row.review_updated_at), encryptionEnabled: Boolean(row.encryption_enabled),
      deleted: Boolean(row.deleted) }));
  }

  async listManuscriptBookmarks(userId: string, manuscriptId: string): Promise<ManuscriptBookmark[]> {
    const rows = await this.sql`select b.* from manuscript_bookmarks b join manuscripts m using (manuscript_id)
      where b.user_id = ${userId} and b.manuscript_id = ${manuscriptId} and m.deleted_at is null order by b.created_at, b.bookmark_id`;
    return rows.map((r) => mapBookmark(r));
  }

  async createManuscriptBookmark(userId: string, manuscriptId: string, input: ManuscriptBookmarkInput): Promise<ManuscriptBookmark | null> {
    const result = await this.sql.begin(async (sql) => {
      const works = await sql`select encryption_enabled from manuscripts where manuscript_id = ${manuscriptId} and deleted_at is null for update`;
      if (!works[0]) return null;
      const chapters = await sql`select revision, content_format from manuscript_chapters where manuscript_id = ${manuscriptId} and chapter_id = ${input.chapterId} and deleted_at is null for share`;
      if (!chapters[0]) return null;
      const encrypted = Boolean(works[0].encryption_enabled);
      const value = bookmarkForStorage(input, Number(chapters[0].revision), String(chapters[0].content_format), encrypted);
      const rows = await sql`select * from manuscript_bookmarks where user_id = ${userId} and manuscript_id = ${manuscriptId} order by created_at`;
      const existing = rows.map((r) => mapBookmark(r)).find((b) => b.chapterId === value.chapterId
        && ["revision", "version", "format", "block", "offset", "kind"].every((key) => b.anchor[key as keyof typeof b.anchor] === value.anchor[key as keyof typeof value.anchor]));
      if (existing) return existing;
      if (rows.length >= 500) throw new BookmarkConflictError("This work has reached the 500 bookmark limit.");
      const inserted = await sql`insert into manuscript_bookmarks (user_id, manuscript_id, chapter_id, name, anchor, position_only)
        values (${userId}, ${manuscriptId}, ${value.chapterId}, ${value.name}, ${sql.json(value.anchor)}, ${encrypted}) returning *`;
      return mapBookmark(inserted[0]);
    });
    return result as ManuscriptBookmark | null;
  }

  async renameManuscriptBookmark(userId: string, manuscriptId: string, bookmarkId: string, name: string): Promise<ManuscriptBookmark | null> {
    const result = await this.sql.begin(async (sql) => {
      const works = await sql`select encryption_enabled from manuscripts where manuscript_id = ${manuscriptId} and deleted_at is null for update`;
      if (!works[0]) return null;
      const own = await sql`select bookmark_id from manuscript_bookmarks where user_id = ${userId} and manuscript_id = ${manuscriptId} and bookmark_id = ${bookmarkId}`;
      if (!own[0]) return null;
      if (works[0].encryption_enabled) throw new BookmarkConflictError("Encrypted works use neutral bookmark names.");
      if (name.trim().length > 120) throw new BookmarkConflictError("Bookmark name is too long.");
      const rows = await sql`update manuscript_bookmarks set name = ${name.trim()}, updated_at = now()
        where user_id = ${userId} and manuscript_id = ${manuscriptId} and bookmark_id = ${bookmarkId} returning *`;
      return rows[0] ? mapBookmark(rows[0]) : null;
    });
    return result as ManuscriptBookmark | null;
  }

  async deleteManuscriptBookmark(userId: string, manuscriptId: string, bookmarkId: string): Promise<boolean> {
    const rows = await this.sql`delete from manuscript_bookmarks where user_id = ${userId} and manuscript_id = ${manuscriptId} and bookmark_id = ${bookmarkId} returning bookmark_id`;
    return rows.length > 0;
  }

  async updateManuscript(manuscriptId: string, input: UpdateManuscriptInput): Promise<Manuscript | null> {
    const current = await this.getManuscript(manuscriptId);
    if (!current) return null;
    await this.sql`
      update manuscripts
      set title = ${input.title === undefined ? current.title : input.title.trim()},
          manuscript_kind = ${input.kind ?? current.kind},
          status = ${input.status ?? current.status},
          description = ${input.description === undefined ? current.description : input.description.trim()},
          updated_by = ${input.updatedBy ?? current.updatedBy ?? null},
          updated_at = now()
      where manuscript_id = ${manuscriptId} and deleted_at is null
    `;
    return this.getManuscript(manuscriptId);
  }

  async replaceManuscriptBodyEncryption(
    manuscriptId: string,
    input: ManuscriptBodyEncryptionInput,
    enable: boolean,
    updatedBy?: string | null
  ): Promise<Manuscript | null> {
    let found = false;
    await this.sql.begin(async (sql) => {
      await lockArchiveHierarchy(sql);
      const manuscriptRows = await sql`
        select * from manuscripts
        where manuscript_id = ${manuscriptId} and deleted_at is null
        for update
      `;
      if (!manuscriptRows[0]) return;
      found = true;
      const currentEnabled = Boolean((manuscriptRows[0] as Row).encryption_enabled);
      if (currentEnabled === enable) throw new ManuscriptEncryptionConflictError(
        enable ? "This work is already encrypted." : "This work is not encrypted."
      );

      const chapterRows = await sql`
        select chapter_id, revision
        from manuscript_chapters
        where manuscript_id = ${manuscriptId} and deleted_at is null
        order by chapter_id
        for update
      `;
      const expectedChapters = new Map(input.chapters.map((chapter) => [chapter.chapterId, chapter]));
      if (expectedChapters.size !== input.chapters.length || chapterRows.length !== expectedChapters.size) {
        throw new ManuscriptEncryptionConflictError();
      }
      for (const row of chapterRows as Row[]) {
        const chapter = expectedChapters.get(asString(row.chapter_id));
        if (!chapter || chapter.expectedRevision !== asNumber(row.revision)) throw new ManuscriptEncryptionConflictError();
      }

      const versionRows = await sql`
        select version_id, chapter_id
        from manuscript_chapter_versions
        where manuscript_id = ${manuscriptId}
        order by version_id
        for update
      `;
      const expectedVersions = new Map(input.versions.map((version) => [version.versionId, version]));
      if (expectedVersions.size !== input.versions.length || versionRows.length !== expectedVersions.size) {
        throw new ManuscriptEncryptionConflictError();
      }
      for (const row of versionRows as Row[]) {
        const version = expectedVersions.get(asString(row.version_id));
        if (!version || version.chapterId !== asString(row.chapter_id)) throw new ManuscriptEncryptionConflictError();
      }

      for (const chapter of input.chapters) {
        await sql`
          update manuscript_chapters set body = ${chapter.body}
          where manuscript_id = ${manuscriptId} and chapter_id = ${chapter.chapterId} and deleted_at is null
        `;
      }
      for (const version of input.versions) {
        await sql`
          update manuscript_chapter_versions set body = ${version.body}
          where manuscript_id = ${manuscriptId} and version_id = ${version.versionId} and chapter_id = ${version.chapterId}
        `;
      }

      const metadata = input.metadata;
      if (enable && !metadata) throw new ManuscriptEncryptionConflictError("Encryption metadata is missing.");
      if (enable) await sql`update manuscript_bookmarks set name = '', position_only = true,
        anchor = anchor || '{"exact":"","prefix":"","suffix":""}'::jsonb, updated_at = now() where manuscript_id = ${manuscriptId}`;
      await sql`
        update manuscripts
        set encryption_enabled = ${enable},
            encryption_version = ${enable ? metadata!.encryptionVersion : null},
            encryption_kdf = ${enable ? metadata!.encryptionKdf : null},
            encryption_iterations = ${enable ? metadata!.encryptionIterations : null},
            encryption_salt = ${enable ? metadata!.encryptionSalt : null},
            encrypted_work_key = ${enable ? metadata!.encryptedWorkKey : null},
            recovery_encrypted_work_key = ${enable ? metadata!.recoveryEncryptedWorkKey : null},
            encryption_updated_at = now(),
            updated_by = ${updatedBy ?? null},
            updated_at = now()
        where manuscript_id = ${manuscriptId} and deleted_at is null
      `;
    });
    return found ? this.getManuscript(manuscriptId) : null;
  }

  async updateManuscriptEncryptionKey(
    manuscriptId: string,
    metadata: ManuscriptEncryptionMetadata,
    updatedBy?: string | null
  ): Promise<Manuscript | null> {
    const rows = await this.sql`
      update manuscripts
      set encryption_version = ${metadata.encryptionVersion},
          encryption_kdf = ${metadata.encryptionKdf},
          encryption_iterations = ${metadata.encryptionIterations},
          encryption_salt = ${metadata.encryptionSalt},
          encrypted_work_key = ${metadata.encryptedWorkKey},
          recovery_encrypted_work_key = ${metadata.recoveryEncryptedWorkKey},
          encryption_updated_at = now(),
          updated_by = ${updatedBy ?? null},
          updated_at = now()
      where manuscript_id = ${manuscriptId}
        and deleted_at is null
        and encryption_enabled = true
        and recovery_encrypted_work_key = ${metadata.recoveryEncryptedWorkKey}
      returning manuscript_id
    `;
    return rows[0] ? this.getManuscript(manuscriptId) : null;
  }

  async softDeleteManuscript(manuscriptId: string): Promise<Manuscript | null> {
    const current = await this.getManuscript(manuscriptId);
    if (!current) return null;
    await this.sql`
      update manuscripts
      set status = 'Archived', deleted_at = now(), updated_at = now()
      where manuscript_id = ${manuscriptId} and deleted_at is null
    `;
    return { ...current, status: "Archived", deletedAt: new Date().toISOString() };
  }

  async getManuscriptChapter(manuscriptId: string, chapterId: string): Promise<ManuscriptChapter | null> {
    const rows = await this.sql`
      select mc.*
      from manuscript_chapters mc
      join manuscripts m on m.manuscript_id = mc.manuscript_id
      where mc.manuscript_id = ${manuscriptId}
        and mc.chapter_id = ${chapterId}
        and mc.deleted_at is null
        and m.deleted_at is null
      limit 1
    `;
    return rows[0] ? mapManuscriptChapter(rows[0] as Row) : null;
  }

  async listManuscriptChapterVersions(
    manuscriptId: string,
    chapterId: string,
    limit = 50
  ): Promise<ManuscriptChapterVersionSummary[]> {
    const rows = await this.sql`
      select version.*, saved_by.name as saved_by_name
      from manuscript_chapter_versions version
      join manuscript_chapters chapter on chapter.chapter_id = version.chapter_id and chapter.deleted_at is null
      join manuscripts manuscript on manuscript.manuscript_id = version.manuscript_id and manuscript.deleted_at is null
      left join users saved_by on saved_by.user_id = version.saved_by
      where version.manuscript_id = ${manuscriptId}
        and version.chapter_id = ${chapterId}
      order by version.created_at desc, version.revision desc
      limit ${Math.min(MANUSCRIPT_CHAPTER_VERSION_RETENTION, Math.max(1, limit))}
    `;
    return rows.map((row) => mapManuscriptChapterVersionSummary(row as Row));
  }

  async getManuscriptChapterVersion(
    manuscriptId: string,
    chapterId: string,
    versionId: string
  ): Promise<ManuscriptChapterVersion | null> {
    const rows = await this.sql`
      select version.*, saved_by.name as saved_by_name
      from manuscript_chapter_versions version
      join manuscript_chapters chapter on chapter.chapter_id = version.chapter_id and chapter.deleted_at is null
      join manuscripts manuscript on manuscript.manuscript_id = version.manuscript_id and manuscript.deleted_at is null
      left join users saved_by on saved_by.user_id = version.saved_by
      where version.version_id = ${versionId}
        and version.manuscript_id = ${manuscriptId}
        and version.chapter_id = ${chapterId}
      limit 1
    `;
    return rows[0] ? mapManuscriptChapterVersion(rows[0] as Row) : null;
  }

  async createManuscriptChapter(input: CreateManuscriptChapterInput): Promise<ManuscriptChapter> {
    const chapterId = input.chapterId ?? crypto.randomUUID();
    const body = input.body?.trim() ?? "";
    const sortOrder = input.sortOrder ?? null;
    const rows = await this.sql`
      insert into manuscript_chapters (chapter_id, manuscript_id, title, body, content_format, sort_order, character_count)
      select
        ${chapterId},
        m.manuscript_id,
        ${input.title.trim()},
        ${body},
        ${input.contentFormat ?? "rich-text"},
        coalesce(${sortOrder}, (select coalesce(max(sort_order), 0) + 1000 from manuscript_chapters where manuscript_id = ${input.manuscriptId} and deleted_at is null)),
        ${input.characterCount ?? countTextCharacters(body)}
      from manuscripts m
      where m.manuscript_id = ${input.manuscriptId} and m.deleted_at is null
      returning *
    `;
    if (!rows[0]) throw new Error("Manuscript not found");
    await this.sql`update manuscripts set updated_at = now() where manuscript_id = ${input.manuscriptId}`;
    return mapManuscriptChapter(rows[0] as Row);
  }

  async updateManuscriptChapter(
    manuscriptId: string,
    chapterId: string,
    input: UpdateManuscriptChapterInput
  ): Promise<ManuscriptChapter | null> {
    let updated: ManuscriptChapter | null = null;
    await this.sql.begin(async (sql) => {
      await lockArchiveHierarchy(sql);
      const currentRows = await sql`
        select chapter.*
        from manuscript_chapters chapter
        join manuscripts manuscript on manuscript.manuscript_id = chapter.manuscript_id
        where chapter.manuscript_id = ${manuscriptId}
          and chapter.chapter_id = ${chapterId}
          and chapter.deleted_at is null
          and manuscript.deleted_at is null
        for update of chapter
      `;
      if (!currentRows[0]) return;
      const currentRow = currentRows[0] as Row;
      const current = mapManuscriptChapter(currentRow);
      if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
        throw new ManuscriptChapterConflictError(current);
      }

      const title = input.title === undefined ? current.title : input.title.trim();
      const body = input.body === undefined ? current.body : input.body.trim();
      const contentFormat = input.contentFormat ?? current.contentFormat;
      const saveSource = input.saveSource ?? "manual";
      const contentChanged = title !== current.title || body !== current.body || contentFormat !== current.contentFormat;
      let snapshotCreated = false;

      if (contentChanged) {
        const recentSnapshots = saveSource === "autosave"
          ? await sql`
              select version_id
              from manuscript_chapter_versions
              where chapter_id = ${chapterId}
                and created_at >= now() - interval '10 minutes'
              limit 1
            `
          : [];
        if (saveSource !== "autosave" || !recentSnapshots[0]) {
          await sql`
            insert into manuscript_chapter_versions (
              manuscript_id, chapter_id, revision, title, body, content_format, character_count,
              save_source, saved_by, saved_at
            ) values (
              ${manuscriptId}, ${chapterId}, ${current.revision}, ${current.title}, ${current.body},
              ${current.contentFormat}, ${current.characterCount}, ${current.lastSaveSource},
              ${currentRow.last_saved_by ? asString(currentRow.last_saved_by) : null}, ${current.updatedAt}
            )
            on conflict (chapter_id, revision) do nothing
          `;
          snapshotCreated = true;
        }
      }

      const rows = await sql`
        update manuscript_chapters
        set title = ${title},
            body = ${body},
            content_format = ${contentFormat},
            sort_order = ${input.sortOrder ?? current.sortOrder},
            character_count = ${input.body === undefined ? current.characterCount : input.characterCount ?? countTextCharacters(body)},
            revision = revision + 1,
            last_save_source = ${saveSource},
            last_saved_by = ${input.updatedBy ?? null},
            updated_at = now()
        where manuscript_id = ${manuscriptId} and chapter_id = ${chapterId} and deleted_at is null
        returning *
      `;
      if (!rows[0]) return;
      if (snapshotCreated) {
        await sql`
          delete from manuscript_chapter_versions
          where chapter_id = ${chapterId}
            and version_id not in (
              select version_id
              from manuscript_chapter_versions
              where chapter_id = ${chapterId}
              order by created_at desc, revision desc
              limit ${MANUSCRIPT_CHAPTER_VERSION_RETENTION}
            )
        `;
      }
      await sql`update manuscripts set updated_at = now(), updated_by = ${input.updatedBy ?? null} where manuscript_id = ${manuscriptId} and deleted_at is null`;
      updated = mapManuscriptChapter(rows[0] as Row);
    });
    return updated;
  }

  async deleteManuscriptChapter(manuscriptId: string, chapterId: string): Promise<boolean> {
    const rows = await this.sql`
      update manuscript_chapters
      set deleted_at = now(), updated_at = now()
      where manuscript_id = ${manuscriptId} and chapter_id = ${chapterId} and deleted_at is null
      returning chapter_id
    `;
    if (!rows[0]) return false;
    await this.sql`update manuscripts set updated_at = now() where manuscript_id = ${manuscriptId} and deleted_at is null`;
    return true;
  }

  private async communicationRows(filters: CommunicationFilters = {}): Promise<CommunicationRecord[]> {
    const q = filters.q?.trim();
    const qLike = q ? `%${q}%` : null;
    const status = filters.status || null;
    const communicationChannel = filters.channel || null;
    const communicationType = filters.communicationType || null;
    const direction = filters.direction || null;
    const source = filters.source || null;
    const workflowView = filters.workflowView || null;
    const followUpAssignedTo = filters.followUpAssignedTo || null;
    const followUpDueFrom = filters.followUpDueFrom || null;
    const followUpDueTo = filters.followUpDueTo || null;
    const caseId = filters.caseId || null;
    const partyOrganizationId = filters.partyOrganizationId || null;
    const contactId = filters.contactId || null;
    const assetId = filters.assetId || null;
    const dateFrom = filters.dateFrom || null;
    const dateTo = filters.dateTo || null;
    const unlinked = filters.unlinked === "true";
    const rows = await this.sql`
      select
        comm.*,
        wi.number as case_number,
        wi.title as case_title,
        po.name as party_organization_name,
        coalesce(nullif(c.display_name, ''), trim(c.first_name || ' ' || c.last_name)) as contact_name,
        ma.name as asset_name,
        d.original_file_name as supporting_document_name,
        u.name as created_by_name,
        fu.name as follow_up_assigned_to_name
      from communications comm
      left join work_items wi on wi.work_item_id = coalesce(comm.work_item_id, comm.case_id)
      left join party_organizations po on po.party_organization_id = comm.party_organization_id and po.deleted_at is null
      left join contacts c on c.contact_id = comm.contact_id and c.deleted_at is null
      left join managed_assets ma on ma.asset_id = comm.asset_id and ma.deleted_at is null
      left join documents d on d.document_id = comm.supporting_document_id and d.deleted_at is null
      left join users u on u.user_id = comm.created_by
      left join users fu on fu.user_id = comm.follow_up_assigned_to
      where comm.deleted_at is null
        and (${status}::text is null or comm.status = ${status})
        and (
          ${communicationChannel}::text is null
          or ${communicationChannel} = 'all'
          or (${communicationChannel} = 'calls' and comm.communication_type = 'Call')
          or (${communicationChannel} = 'emails' and comm.communication_type = 'Email')
          or (${communicationChannel} = 'other' and comm.communication_type not in ('Call', 'Email'))
        )
        and (${communicationType}::text is null or comm.communication_type = ${communicationType})
        and (${direction}::text is null or comm.direction = ${direction})
        and (${source}::text is null or comm.source = ${source})
        and (
          ${workflowView}::text is null
          or ${workflowView} = 'all'
          or (${workflowView} = 'inbox' and comm.status in ('New', 'Logged'))
          or (${workflowView} = 'followUp' and comm.status = 'Needs follow-up')
          or (${workflowView} = 'linked' and comm.status <> 'Ignored / Spam' and coalesce(comm.work_item_id, comm.case_id) is not null)
          or (${workflowView} = 'archived' and comm.status = 'Ignored / Spam')
        )
        and (${followUpAssignedTo}::text is null or comm.follow_up_assigned_to::text = ${followUpAssignedTo})
        and (${followUpDueFrom}::date is null or comm.follow_up_due_date >= ${followUpDueFrom}::date)
        and (${followUpDueTo}::date is null or comm.follow_up_due_date <= ${followUpDueTo}::date)
        and (${caseId}::text is null or coalesce(comm.work_item_id, comm.case_id)::text = ${caseId})
        and (${partyOrganizationId}::text is null or comm.party_organization_id::text = ${partyOrganizationId})
        and (${contactId}::text is null or comm.contact_id::text = ${contactId})
        and (${assetId}::text is null or comm.asset_id::text = ${assetId})
        and (${dateFrom}::date is null or comm.occurred_at::date >= ${dateFrom}::date)
        and (${dateTo}::date is null or comm.occurred_at::date <= ${dateTo}::date)
        and (${unlinked}::boolean is false or coalesce(comm.work_item_id, comm.case_id) is null)
        and (
          ${qLike}::text is null
          or concat_ws(
            ' ',
            comm.subject,
            comm.body,
            wi.number,
            wi.title,
            po.name,
            coalesce(nullif(c.display_name, ''), trim(c.first_name || ' ' || c.last_name)),
            ma.name,
            comm.external_provider,
            comm.external_reference,
            comm.source_metadata::text
          ) ilike ${qLike}
        )
      order by comm.occurred_at desc, comm.created_at desc
      limit 1000
    `;
    return rows.map((row) => mapCommunication(row as Row));
  }

  async getCommunication(communicationId: string): Promise<CommunicationRecord | null> {
    const rows = await this.sql`
      select
        comm.*,
        wi.number as case_number,
        wi.title as case_title,
        po.name as party_organization_name,
        coalesce(nullif(c.display_name, ''), trim(c.first_name || ' ' || c.last_name)) as contact_name,
        ma.name as asset_name,
        d.original_file_name as supporting_document_name,
        u.name as created_by_name,
        fu.name as follow_up_assigned_to_name
      from communications comm
      left join work_items wi on wi.work_item_id = coalesce(comm.work_item_id, comm.case_id)
      left join party_organizations po on po.party_organization_id = comm.party_organization_id and po.deleted_at is null
      left join contacts c on c.contact_id = comm.contact_id and c.deleted_at is null
      left join managed_assets ma on ma.asset_id = comm.asset_id and ma.deleted_at is null
      left join documents d on d.document_id = comm.supporting_document_id and d.deleted_at is null
      left join users u on u.user_id = comm.created_by
      left join users fu on fu.user_id = comm.follow_up_assigned_to
      where comm.communication_id = ${communicationId}
        and comm.deleted_at is null
      limit 1
    `;
    return rows[0] ? mapCommunication(rows[0] as Row) : null;
  }

  async listAllCommunications(filters: CommunicationFilters = {}): Promise<CommunicationRecord[]> {
    return this.communicationRows(filters);
  }

  async listAllCommunicationsPage(
    filters: CommunicationFilters = {},
    pagination: PaginationParams = {}
  ): Promise<PaginatedResult<CommunicationRecord>> {
    const pageInfo = normalizePagination(pagination);
    const offset = (pageInfo.page - 1) * pageInfo.pageSize;
    const q = filters.q?.trim();
    const qLike = q ? `%${q}%` : null;
    const status = filters.status || null;
    const communicationChannel = filters.channel || null;
    const communicationType = filters.communicationType || null;
    const direction = filters.direction || null;
    const source = filters.source || null;
    const workflowView = filters.workflowView || null;
    const followUpAssignedTo = filters.followUpAssignedTo || null;
    const followUpDueFrom = filters.followUpDueFrom || null;
    const followUpDueTo = filters.followUpDueTo || null;
    const caseId = filters.caseId || null;
    const partyOrganizationId = filters.partyOrganizationId || null;
    const contactId = filters.contactId || null;
    const assetId = filters.assetId || null;
    const dateFrom = filters.dateFrom || null;
    const dateTo = filters.dateTo || null;
    const unlinked = filters.unlinked === "true";
    const sort = filters.sort || "occurred";
    const sortDirection = filters.sortDirection === "asc" ? "asc" : "desc";
    const rows = await this.sql`
      select
        comm.*,
        wi.number as case_number,
        wi.title as case_title,
        po.name as party_organization_name,
        coalesce(nullif(c.display_name, ''), trim(c.first_name || ' ' || c.last_name)) as contact_name,
        ma.name as asset_name,
        d.original_file_name as supporting_document_name,
        u.name as created_by_name,
        fu.name as follow_up_assigned_to_name,
        count(*) over() as total_count
      from communications comm
      left join work_items wi on wi.work_item_id = coalesce(comm.work_item_id, comm.case_id)
      left join party_organizations po on po.party_organization_id = comm.party_organization_id and po.deleted_at is null
      left join contacts c on c.contact_id = comm.contact_id and c.deleted_at is null
      left join managed_assets ma on ma.asset_id = comm.asset_id and ma.deleted_at is null
      left join documents d on d.document_id = comm.supporting_document_id and d.deleted_at is null
      left join users u on u.user_id = comm.created_by
      left join users fu on fu.user_id = comm.follow_up_assigned_to
      where comm.deleted_at is null
        and (${status}::text is null or comm.status = ${status})
        and (
          ${communicationChannel}::text is null
          or ${communicationChannel} = 'all'
          or (${communicationChannel} = 'calls' and comm.communication_type = 'Call')
          or (${communicationChannel} = 'emails' and comm.communication_type = 'Email')
          or (${communicationChannel} = 'other' and comm.communication_type not in ('Call', 'Email'))
        )
        and (${communicationType}::text is null or comm.communication_type = ${communicationType})
        and (${direction}::text is null or comm.direction = ${direction})
        and (${source}::text is null or comm.source = ${source})
        and (
          ${workflowView}::text is null
          or ${workflowView} = 'all'
          or (${workflowView} = 'inbox' and comm.status in ('New', 'Logged'))
          or (${workflowView} = 'followUp' and comm.status = 'Needs follow-up')
          or (${workflowView} = 'linked' and comm.status <> 'Ignored / Spam' and coalesce(comm.work_item_id, comm.case_id) is not null)
          or (${workflowView} = 'archived' and comm.status = 'Ignored / Spam')
        )
        and (${followUpAssignedTo}::text is null or comm.follow_up_assigned_to::text = ${followUpAssignedTo})
        and (${followUpDueFrom}::date is null or comm.follow_up_due_date >= ${followUpDueFrom}::date)
        and (${followUpDueTo}::date is null or comm.follow_up_due_date <= ${followUpDueTo}::date)
        and (${caseId}::text is null or coalesce(comm.work_item_id, comm.case_id)::text = ${caseId})
        and (${partyOrganizationId}::text is null or comm.party_organization_id::text = ${partyOrganizationId})
        and (${contactId}::text is null or comm.contact_id::text = ${contactId})
        and (${assetId}::text is null or comm.asset_id::text = ${assetId})
        and (${dateFrom}::date is null or comm.occurred_at::date >= ${dateFrom}::date)
        and (${dateTo}::date is null or comm.occurred_at::date <= ${dateTo}::date)
        and (${unlinked}::boolean is false or coalesce(comm.work_item_id, comm.case_id) is null)
        and (
          ${qLike}::text is null
          or concat_ws(
            ' ',
            comm.subject,
            comm.body,
            wi.number,
            wi.title,
            po.name,
            coalesce(nullif(c.display_name, ''), trim(c.first_name || ' ' || c.last_name)),
            ma.name,
            comm.external_provider,
            comm.external_reference,
            comm.source_metadata::text
          ) ilike ${qLike}
        )
      order by
        case when ${sort} = 'updated' and ${sortDirection} = 'asc' then comm.updated_at end asc nulls last,
        case when ${sort} = 'updated' and ${sortDirection} = 'desc' then comm.updated_at end desc nulls last,
        case when ${sort} = 'subject' and ${sortDirection} = 'asc' then lower(comm.subject) end asc nulls last,
        case when ${sort} = 'subject' and ${sortDirection} = 'desc' then lower(comm.subject) end desc nulls last,
        case when ${sort} = 'status' and ${sortDirection} = 'asc' then comm.status end asc nulls last,
        case when ${sort} = 'status' and ${sortDirection} = 'desc' then comm.status end desc nulls last,
        case when ${sort} = 'type' and ${sortDirection} = 'asc' then comm.communication_type end asc nulls last,
        case when ${sort} = 'type' and ${sortDirection} = 'desc' then comm.communication_type end desc nulls last,
        case when ${sort} = 'contact' and ${sortDirection} = 'asc' then lower(coalesce(nullif(c.display_name, ''), trim(c.first_name || ' ' || c.last_name))) end asc nulls last,
        case when ${sort} = 'contact' and ${sortDirection} = 'desc' then lower(coalesce(nullif(c.display_name, ''), trim(c.first_name || ' ' || c.last_name))) end desc nulls last,
        case when ${sort} = 'organization' and ${sortDirection} = 'asc' then lower(po.name) end asc nulls last,
        case when ${sort} = 'organization' and ${sortDirection} = 'desc' then lower(po.name) end desc nulls last,
        case when ${sort} = 'service' and ${sortDirection} = 'asc' then wi.number end asc nulls last,
        case when ${sort} = 'service' and ${sortDirection} = 'desc' then wi.number end desc nulls last,
        case when ${sort} = 'occurred' and ${sortDirection} = 'asc' then comm.occurred_at end asc nulls last,
        case when ${sort} = 'occurred' and ${sortDirection} = 'desc' then comm.occurred_at end desc nulls last,
        comm.occurred_at desc,
        comm.created_at desc
      limit ${pageInfo.pageSize}
      offset ${offset}
    `;
    const total = rows[0] ? asNumber((rows[0] as Row).total_count) : 0;
    return paginatedResult(rows.map((row) => mapCommunication(row as Row)), total, pageInfo);
  }

  async listCommunications(caseId: string): Promise<CommunicationRecord[]> {
    return this.communicationRows({ caseId });
  }

  async findCommunicationByExternalReferences(
    source: CommunicationRecord["source"],
    externalReferences: string[],
    externalProvider = ""
  ): Promise<CommunicationRecord | null> {
    const references = Array.from(new Set(externalReferences.map((item) => item.trim()).filter(Boolean)));
    if (!references.length) return null;
    const provider = externalProvider.trim() || null;
    const rows = await this.sql`
      select
        comm.*,
        wi.number as case_number,
        wi.title as case_title,
        po.name as party_organization_name,
        coalesce(nullif(c.display_name, ''), trim(c.first_name || ' ' || c.last_name)) as contact_name,
        ma.name as asset_name,
        d.original_file_name as supporting_document_name,
        u.name as created_by_name,
        fu.name as follow_up_assigned_to_name
      from communications comm
      left join work_items wi on wi.work_item_id = coalesce(comm.work_item_id, comm.case_id)
      left join party_organizations po on po.party_organization_id = comm.party_organization_id and po.deleted_at is null
      left join contacts c on c.contact_id = comm.contact_id and c.deleted_at is null
      left join managed_assets ma on ma.asset_id = comm.asset_id and ma.deleted_at is null
      left join documents d on d.document_id = comm.supporting_document_id and d.deleted_at is null
      left join users u on u.user_id = comm.created_by
      left join users fu on fu.user_id = comm.follow_up_assigned_to
      where comm.deleted_at is null
        and comm.source = ${source}
        and (${provider}::text is null or comm.external_provider = ${provider})
        and (
          comm.external_reference = any(${references}::text[])
          or comm.source_metadata ->> 'gmailMessageId' = any(${references}::text[])
          or comm.source_metadata ->> 'rfcMessageId' = any(${references}::text[])
          or comm.source_metadata ->> 'messageUrl' = any(${references}::text[])
          or comm.source_metadata ->> 'gmailMessageUrl' = any(${references}::text[])
          or comm.source_metadata ->> 'callId' = any(${references}::text[])
          or comm.source_metadata ->> 'linkedId' = any(${references}::text[])
          or comm.source_metadata ->> 'uniqueId' = any(${references}::text[])
          or concat_ws(
            '|',
            comm.source_metadata ->> 'gmailThreadId',
            comm.source_metadata ->> 'subject',
            comm.source_metadata ->> 'date'
          ) = any(${references}::text[])
        )
      order by comm.occurred_at desc, comm.created_at desc
      limit 1
    `;
    return rows[0] ? mapCommunication(rows[0] as Row) : null;
  }

  async createCommunication(input: CreateCommunicationInput): Promise<CommunicationRecord> {
    const communicationId = crypto.randomUUID();
    const linkedCaseId = input.caseId ?? null;
    const status = input.status ?? (linkedCaseId ? "Linked" : "New");
    const rows = await this.sql`
      insert into communications (
        communication_id, tenant_id, case_id, work_item_id, party_organization_id, contact_id,
        asset_id, supporting_document_id, communication_type, direction, source, external_provider,
        external_reference, external_url, source_metadata, status, follow_up_assigned_to, follow_up_due_date,
        subject, body, occurred_at, created_by
      )
      values (
        ${communicationId}, ${DEFAULT_TENANT_ID}, ${linkedCaseId}, ${linkedCaseId},
        ${input.partyOrganizationId ?? null}, ${input.contactId ?? null}, ${input.assetId ?? null},
        ${input.supportingDocumentId ?? null}, ${input.communicationType}, ${input.direction}, ${input.source ?? "Manual"},
        ${input.externalProvider ?? ""}, ${input.externalReference ?? ""}, ${input.externalUrl ?? ""},
        ${this.sql.json((input.sourceMetadata ?? {}) as never)}, ${status}, ${input.followUpAssignedTo ?? null},
        ${input.followUpDueDate ?? null}, ${input.subject}, ${input.body}, ${input.occurredAt},
        ${input.createdBy ?? null}
      )
      returning communication_id
    `;
    const created = await this.getCommunication(asString(rows[0].communication_id));
    if (!created) throw new Error("Failed to create communication");
    return created;
  }

  async updateCommunication(communicationId: string, input: Partial<CreateCommunicationInput>): Promise<CommunicationRecord | null> {
    const current = await this.getCommunication(communicationId);
    if (!current) return null;
    const linkedCaseId = input.caseId === undefined ? current.caseId ?? null : input.caseId ?? null;
    const status = input.status ?? (linkedCaseId ? (current.status === "New" ? "Linked" : current.status) : current.status);
    const clearFollowUp = input.status !== undefined && input.status !== "Needs follow-up";
    const followUpAssignedTo =
      input.followUpAssignedTo === undefined ? (clearFollowUp ? null : current.followUpAssignedTo ?? null) : input.followUpAssignedTo ?? null;
    const followUpDueDate =
      input.followUpDueDate === undefined ? (clearFollowUp ? null : current.followUpDueDate ?? null) : input.followUpDueDate ?? null;
    await this.sql`
      update communications
      set
        case_id = ${linkedCaseId},
        work_item_id = ${linkedCaseId},
        party_organization_id = ${input.partyOrganizationId === undefined ? current.partyOrganizationId ?? null : input.partyOrganizationId ?? null},
        contact_id = ${input.contactId === undefined ? current.contactId ?? null : input.contactId ?? null},
        asset_id = ${input.assetId === undefined ? current.assetId ?? null : input.assetId ?? null},
        supporting_document_id = ${input.supportingDocumentId === undefined ? current.supportingDocumentId ?? null : input.supportingDocumentId ?? null},
        communication_type = ${input.communicationType ?? current.communicationType},
        direction = ${input.direction ?? current.direction},
        source = ${input.source ?? current.source},
        status = ${status},
        follow_up_assigned_to = ${followUpAssignedTo},
        follow_up_due_date = ${followUpDueDate},
        external_provider = ${input.externalProvider === undefined ? current.externalProvider : input.externalProvider ?? ""},
        external_reference = ${input.externalReference === undefined ? current.externalReference : input.externalReference ?? ""},
        external_url = ${input.externalUrl === undefined ? current.externalUrl : input.externalUrl ?? ""},
        source_metadata = ${this.sql.json((input.sourceMetadata ?? current.sourceMetadata ?? {}) as never)},
        subject = ${input.subject ?? current.subject},
        body = ${input.body ?? current.body},
        occurred_at = ${input.occurredAt ?? current.occurredAt},
        updated_at = now()
      where communication_id = ${communicationId}
        and deleted_at is null
    `;
    return this.getCommunication(communicationId);
  }

  async listSavedDirectoryViews(scope?: DirectoryViewScope, userId?: string): Promise<SavedDirectoryView[]> {
    const rows = await this.sql`
      select sdv.*, u.name as created_by_name
      from saved_directory_views sdv
      left join users u on u.user_id = sdv.created_by
      where sdv.deleted_at is null
        and sdv.tenant_id = ${DEFAULT_TENANT_ID}
        and (${scope ?? null}::text is null or sdv.scope = ${scope ?? null})
        and (${userId ?? null}::text is null or sdv.created_by::text = ${userId ?? null})
      order by sdv.scope, sdv.name
    `;
    return rows.map((row) => mapSavedDirectoryView(row as Row));
  }

  async getSavedDirectoryView(savedViewId: string): Promise<SavedDirectoryView | null> {
    const rows = await this.sql`
      select sdv.*, u.name as created_by_name
      from saved_directory_views sdv
      left join users u on u.user_id = sdv.created_by
      where sdv.saved_view_id = ${savedViewId}
        and sdv.tenant_id = ${DEFAULT_TENANT_ID}
        and sdv.deleted_at is null
      limit 1
    `;
    return rows[0] ? mapSavedDirectoryView(rows[0] as Row) : null;
  }

  async createSavedDirectoryView(input: SavedDirectoryViewInput, user: PublicUser): Promise<SavedDirectoryView> {
    if (input.isDefault) {
      await this.sql`
        update saved_directory_views
        set is_default = false, updated_at = now()
        where tenant_id = ${DEFAULT_TENANT_ID}
          and scope = ${input.scope}
          and created_by = ${user.userId}
          and deleted_at is null
      `;
    }
    const rows = await this.sql`
      insert into saved_directory_views (
        tenant_id, scope, name, filters, sort, page_size, is_default, created_by
      )
      values (
        ${DEFAULT_TENANT_ID}, ${input.scope}, ${input.name.trim()},
        ${this.sql.json((input.filters ?? {}) as never)}, ${input.sort ?? ""},
        ${input.pageSize ?? 25}, ${Boolean(input.isDefault)}, ${user.userId}
      )
      returning *
    `;
    return (await this.getSavedDirectoryView(asString(rows[0].saved_view_id))) ?? mapSavedDirectoryView(rows[0] as Row);
  }

  async updateSavedDirectoryView(
    savedViewId: string,
    input: Partial<SavedDirectoryViewInput>,
    user: PublicUser
  ): Promise<SavedDirectoryView | null> {
    const current = await this.getSavedDirectoryView(savedViewId);
    if (!current) return null;
    const nextScope = input.scope ?? current.scope;
    if (input.isDefault) {
      await this.sql`
        update saved_directory_views
        set is_default = false, updated_at = now()
        where tenant_id = ${DEFAULT_TENANT_ID}
          and scope = ${nextScope}
          and created_by = ${user.userId}
          and saved_view_id <> ${savedViewId}
          and deleted_at is null
      `;
    }
    await this.sql`
      update saved_directory_views
      set
        scope = ${nextScope},
        name = ${input.name?.trim() || current.name},
        filters = ${this.sql.json((input.filters ?? current.filters) as never)},
        sort = ${input.sort ?? current.sort},
        page_size = ${input.pageSize ?? current.pageSize},
        is_default = ${input.isDefault ?? current.isDefault},
        updated_at = now()
      where saved_view_id = ${savedViewId}
        and tenant_id = ${DEFAULT_TENANT_ID}
        and deleted_at is null
    `;
    return this.getSavedDirectoryView(savedViewId);
  }

  async deleteSavedDirectoryView(savedViewId: string, _user: PublicUser): Promise<boolean> {
    const rows = await this.sql`
      update saved_directory_views
      set deleted_at = now(), updated_at = now()
      where saved_view_id = ${savedViewId}
        and tenant_id = ${DEFAULT_TENANT_ID}
        and deleted_at is null
      returning saved_view_id
    `;
    return rows.length > 0;
  }

  async listTasks(caseId: string): Promise<TaskRecord[]> {
    const rows = await this.sql`
      select t.*, u.name as assigned_to_name
      from tasks t
      left join users u on u.user_id = t.assigned_to
      where coalesce(t.work_item_id, t.case_id) = ${caseId}
      order by t.due_date asc, t.created_at asc
    `;
    return rows.map((row) => mapTask(row as Row));
  }

  async listAllTasks(): Promise<TaskRecord[]> {
    const rows = await this.sql`
      select
        t.*,
        coalesce(t.work_item_id, t.case_id) as case_id,
        wi.number as case_number,
        wi.title as case_title,
        u.name as assigned_to_name
      from tasks t
      join work_items wi on wi.work_item_id = coalesce(t.work_item_id, t.case_id)
      left join users u on u.user_id = t.assigned_to
      where wi.deleted_at is null
      order by t.due_date asc, t.created_at asc
    `;
    return rows.map((row) => mapTask(row as Row));
  }

  async createTask(input: CreateTaskInput): Promise<TaskRecord> {
    const taskId = crypto.randomUUID();
    await this.sql`
      insert into tasks (task_id, case_id, work_item_id, title, description, priority, due_date, assigned_to)
      values (${taskId}, ${input.caseId}, ${input.caseId}, ${input.title}, ${input.description}, ${input.priority ?? "Normal"}, ${input.dueDate}, ${input.assignedTo ?? null})
    `;
    const rows = await this.sql`
      select t.*, u.name as assigned_to_name
      from tasks t
      left join users u on u.user_id = t.assigned_to
      where t.task_id = ${taskId}
    `;
    return mapTask(rows[0] as Row);
  }

  async updateTask(taskId: string, input: Partial<TaskRecord>): Promise<TaskRecord | null> {
    const rows = await this.sql`select * from tasks where task_id = ${taskId}`;
    if (!rows[0]) return null;
    const current = mapTask(rows[0] as Row);
    const assignedTo = Object.prototype.hasOwnProperty.call(input, "assignedTo")
      ? input.assignedTo ?? null
      : current.assignedTo ?? null;
    await this.sql`
      update tasks set
        title = ${input.title ?? current.title},
        description = ${input.description ?? current.description},
        status = ${input.status ?? current.status},
        priority = ${input.priority ?? current.priority},
        due_date = ${input.dueDate ?? current.dueDate},
        assigned_to = ${assignedTo},
        updated_at = now()
      where task_id = ${taskId}
    `;
    const updated = await this.sql`
      select t.*, u.name as assigned_to_name
      from tasks t
      left join users u on u.user_id = t.assigned_to
      where t.task_id = ${taskId}
    `;
    return mapTask(updated[0] as Row);
  }

  private async ensureBackupSettings(): Promise<void> {
    try {
      const userRows = await this.sql`
        select user_id, name, email, role, created_at
        from users
        order by case when role = 'Admin' then 0 else 1 end, name asc
        limit 1
      `;
      const user = userRows[0] ? mapUser(userRows[0] as Row) : null;
      await this.sql`
        insert into backup_jobs (
          backup_job_id,
          organization_id,
          name,
          destination,
          schedule,
          scope,
          include_metadata,
          include_documents,
          include_audit_logs,
          include_relationship_map,
          folder_by_case_and_category,
          checksum_manifest,
          is_enabled,
          updated_by
        )
        values (
          ${DEFAULT_BACKUP_JOB_ID},
          ${DEFAULT_ORGANIZATION_ID},
          'Primary backup plan',
          'r2-manifest',
          'daily',
          'all-cases',
          true,
          true,
          true,
          true,
          true,
          true,
          true,
          ${user?.userId ?? null}
        )
        on conflict (backup_job_id) do nothing
      `;
    } catch (error) {
      if (!isMissingSchemaFeature(error)) throw error;
    }
  }

  async getBackupSettings(): Promise<BackupSettings> {
    await this.ensureBackupSettings();
    try {
      const rows = await this.sql`
        select bj.*, u.name as updated_by_name
        from backup_jobs bj
        left join users u on u.user_id = bj.updated_by
        where bj.backup_job_id = ${DEFAULT_BACKUP_JOB_ID}
        limit 1
      `;
      return rows[0] ? mapBackupSettings(rows[0] as Row) : defaultBackupSettings();
    } catch (error) {
      if (!isMissingSchemaFeature(error)) throw error;
      return defaultBackupSettings();
    }
  }

  async updateBackupSettings(input: UpdateBackupSettingsInput, user: PublicUser): Promise<BackupSettings> {
    await this.ensureBackupSettings();
    try {
      const rows = await this.sql`
        with updated as (
          update backup_jobs set
            destination = ${input.destination},
            schedule = ${input.schedule},
            scope = ${input.scope},
            include_metadata = ${input.includeMetadata},
            include_documents = ${input.includeDocuments},
            include_audit_logs = ${input.includeAuditLogs},
            include_relationship_map = ${input.includeRelationshipMap},
            folder_by_case_and_category = ${input.folderByCaseAndCategory},
            checksum_manifest = ${input.checksumManifest},
            is_enabled = ${input.isEnabled},
            updated_by = ${user.userId},
            updated_at = now()
          where backup_job_id = ${DEFAULT_BACKUP_JOB_ID}
          returning *
        )
        select updated.*, u.name as updated_by_name
        from updated
        left join users u on u.user_id = updated.updated_by
      `;
      return rows[0] ? mapBackupSettings(rows[0] as Row) : defaultBackupSettings(user);
    } catch (error) {
      if (!isMissingSchemaFeature(error)) throw error;
      return { ...defaultBackupSettings(user), ...input };
    }
  }

  private async ensurePbxSettings(): Promise<void> {
    try {
      await this.sql`
        insert into pbx_settings (
          pbx_settings_id,
          organization_id,
          is_enabled,
          allowed_dids,
          allowed_destinations,
          ignored_dids,
          ignored_destinations,
          show_unknown_callers,
          popup_retention_seconds
        )
        values (
          ${DEFAULT_PBX_SETTINGS_ID},
          ${DEFAULT_ORGANIZATION_ID},
          false,
          '[]'::jsonb,
          '[]'::jsonb,
          '[]'::jsonb,
          '[]'::jsonb,
          true,
          30
        )
        on conflict (pbx_settings_id) do nothing
      `;
    } catch (error) {
      if (!isMissingSchemaFeature(error)) throw error;
    }
  }

  async getPbxSettings(): Promise<PbxSettings> {
    await this.ensurePbxSettings();
    try {
      const rows = await this.sql`
        select ps.*, u.name as updated_by_name
        from pbx_settings ps
        left join users u on u.user_id = ps.updated_by
        where ps.pbx_settings_id = ${DEFAULT_PBX_SETTINGS_ID}
        limit 1
      `;
      return rows[0] ? mapPbxSettings(rows[0] as Row) : defaultPbxSettings();
    } catch (error) {
      if (!isMissingSchemaFeature(error)) throw error;
      return defaultPbxSettings();
    }
  }

  async updatePbxSettings(input: UpdatePbxSettingsInput, user: PublicUser): Promise<PbxSettings> {
    await this.ensurePbxSettings();
    try {
      const rows = await this.sql`
        with updated as (
          update pbx_settings set
            is_enabled = ${input.isEnabled},
            allowed_dids = ${this.sql.json(input.allowedDids as never)},
            allowed_destinations = ${this.sql.json(input.allowedDestinations as never)},
            ignored_dids = ${this.sql.json(input.ignoredDids as never)},
            ignored_destinations = ${this.sql.json(input.ignoredDestinations as never)},
            show_unknown_callers = ${input.showUnknownCallers},
            popup_retention_seconds = ${input.popupRetentionSeconds},
            updated_by = ${user.userId},
            updated_at = now()
          where pbx_settings_id = ${DEFAULT_PBX_SETTINGS_ID}
          returning *
        )
        select updated.*, u.name as updated_by_name
        from updated
        left join users u on u.user_id = updated.updated_by
      `;
      return rows[0] ? mapPbxSettings(rows[0] as Row) : defaultPbxSettings(user);
    } catch (error) {
      if (!isMissingSchemaFeature(error)) throw error;
      return { ...defaultPbxSettings(user), ...input };
    }
  }

  async listBackupRuns(limit = 20): Promise<BackupRun[]> {
    try {
      const rows = await this.sql`
        select br.*, u.name as created_by_name
        from backup_runs br
        left join users u on u.user_id = br.created_by
        order by br.started_at desc
        limit ${limit}
      `;
      return rows.map((row) => mapBackupRun(row as Row));
    } catch (error) {
      if (!isMissingSchemaFeature(error)) throw error;
      return [];
    }
  }

  async getBackupRun(backupRunId: string): Promise<BackupRun | null> {
    try {
      const rows = await this.sql`
        select br.*, u.name as created_by_name
        from backup_runs br
        left join users u on u.user_id = br.created_by
        where br.backup_run_id = ${backupRunId}
        limit 1
      `;
      return rows[0] ? mapBackupRun(rows[0] as Row) : null;
    } catch (error) {
      if (!isMissingSchemaFeature(error)) throw error;
      return null;
    }
  }

  async createBackupRun(input: CreateBackupRunInput): Promise<BackupRun> {
    const rows = await this.sql`
      with inserted as (
        insert into backup_runs (
          backup_run_id,
          backup_job_id,
          status,
          destination,
          scope,
          started_at,
          completed_at,
          case_count,
          document_count,
          metadata_rows,
          item_count,
          failed_items,
          manifest_object_key,
          manifest_file_name,
          mode,
          created_by,
          message
        )
        values (
          ${input.backupRunId},
          ${input.backupJobId},
          ${input.status},
          ${input.destination},
          ${input.scope},
          ${input.startedAt},
          ${input.completedAt ?? null},
          ${input.caseCount},
          ${input.documentCount},
          ${input.metadataRows},
          ${input.itemCount},
          ${input.failedItems},
          ${input.manifestObjectKey ?? null},
          ${input.manifestFileName ?? null},
          ${input.mode},
          ${input.createdBy ?? null},
          ${input.message}
        )
        returning *
      )
      select inserted.*, u.name as created_by_name
      from inserted
      left join users u on u.user_id = inserted.created_by
    `;
    return mapBackupRun(rows[0] as Row);
  }

  async deleteBackupRun(backupRunId: string): Promise<BackupRun | null> {
    try {
      const rows = await this.sql`
        with deleted as (
          delete from backup_runs
          where backup_run_id = ${backupRunId}
          returning *
        )
        select deleted.*, u.name as created_by_name
        from deleted
        left join users u on u.user_id = deleted.created_by
      `;
      return rows[0] ? mapBackupRun(rows[0] as Row) : null;
    } catch (error) {
      if (!isMissingSchemaFeature(error)) throw error;
      return null;
    }
  }

  async createBackupItem(input: CreateBackupItemInput): Promise<BackupItem> {
    const rows = await this.sql`
      insert into backup_items (
        backup_item_id,
        backup_run_id,
        item_type,
        source_id,
        source_path,
        target_path,
        status,
        size_bytes,
        checksum,
        metadata
      )
      values (
        ${input.backupItemId},
        ${input.backupRunId},
        ${input.itemType},
        ${input.sourceId ?? null},
        ${input.sourcePath},
        ${input.targetPath},
        ${input.status},
        ${input.sizeBytes},
        ${input.checksum ?? null},
        ${this.sql.json((input.metadata ?? {}) as never)}
      )
      returning *
    `;
    return mapBackupItem(rows[0] as Row);
  }

  async listBackupItems(backupRunId: string): Promise<BackupItem[]> {
    try {
      const rows = await this.sql`
        select *
        from backup_items
        where backup_run_id = ${backupRunId}
        order by created_at asc
      `;
      return rows.map((row) => mapBackupItem(row as Row));
    } catch (error) {
      if (!isMissingSchemaFeature(error)) throw error;
      return [];
    }
  }

  async buildBackupSnapshot(scope: BackupScope): Promise<BackupSnapshot> {
    // Preserve closed-case selection and the legacy full-snapshot behavior of
    // updated-since-last-run while including independent personal content.
    const includeGlobalContent = scope !== "closed-cases";
    const allCases = await this.listCases({ archiveStatus: "all" });
    const cases = scope === "closed-cases" ? allCases.filter((caseRecord) => caseRecord.status === "Closed") : allCases;
    const [
      tags, partyOrganizations, manuscripts, globalDocuments, globalDiscussion,
      globalKnowledge, archiveFolders, archiveCategories, perCaseData
    ] = await Promise.all([
      this.listTags(),
      this.listPartyOrganizations(""),
      this.listManuscripts(),
      includeGlobalContent ? this.listDocumentsForBackup(null) : Promise.resolve([]),
      includeGlobalContent ? this.listDiscussionMessagesForScope(null) : Promise.resolve([]),
      includeGlobalContent ? this.listKnowledge() : Promise.resolve([]),
      includeGlobalContent ? this.listArchiveFolders() : Promise.resolve([]),
      includeGlobalContent ? this.listArchiveCategories() : Promise.resolve([]),
      Promise.all(
        cases.map(async (caseRecord) => {
          const [documents, caseContacts, tasks, notes, discussion, knowledge, communications, auditLogs] = await Promise.all([
            this.listDocumentsForBackup(caseRecord.caseId),
            this.listCaseContacts(caseRecord.caseId),
            this.listTasks(caseRecord.caseId),
            this.listNotes(caseRecord.caseId),
            this.listServiceDiscussion(caseRecord.caseId),
            includeGlobalContent ? Promise.resolve([]) : this.listKnowledge({ caseId: caseRecord.caseId }),
            this.listCommunications(caseRecord.caseId),
            this.listCaseAuditLogs(caseRecord.caseId)
          ]);
          return { documents, caseContacts, tasks, notes, discussion, knowledge, communications, auditLogs };
        })
      )
    ]);

    const documents = [...perCaseData.flatMap((item) => item.documents), ...globalDocuments];
    const caseContacts = perCaseData.flatMap((item) => item.caseContacts);
    const tasks = perCaseData.flatMap((item) => item.tasks);
    const notes = perCaseData.flatMap((item) => item.notes);
    const discussion = [...perCaseData.flatMap((item) => item.discussion), ...globalDiscussion];
    const knowledgeById = new Map<string, KnowledgeItem>();
    for (const knowledgeItem of [...perCaseData.flatMap((item) => item.knowledge), ...globalKnowledge]) {
      knowledgeById.set(knowledgeItem.knowledgeId, knowledgeItem);
    }
    // listManuscripts intentionally returns list summaries with chapters: [].
    // Backups need the stored bodies, including encrypted bodies, rather than
    // relying on a UI summary's hydrated chapter list.
    const manuscriptChapterRows = manuscripts.length
      ? await this.sql`
          select chapter.*
          from manuscript_chapters chapter
          join manuscripts manuscript on manuscript.manuscript_id = chapter.manuscript_id
          where chapter.manuscript_id = any(${manuscripts.map((item) => item.manuscriptId)}::uuid[])
            and chapter.deleted_at is null
            and manuscript.deleted_at is null
          order by chapter.manuscript_id, chapter.sort_order asc, chapter.created_at asc
        `
      : [];
    const manuscriptChapters = manuscriptChapterRows.map((row) => mapManuscriptChapter(row as Row));
    for (const manuscript of manuscripts) {
      const chapters = manuscriptChapters.filter((chapter) => chapter.manuscriptId === manuscript.manuscriptId);
      manuscript.chapters = chapters.map(({ body: _body, ...chapter }) => chapter);
      manuscript.chapterCount = chapters.length;
      manuscript.characterCount = chapters.reduce((sum, chapter) => sum + chapter.characterCount, 0);
    }
    const manuscriptChapterVersionRows = manuscripts.length
      ? await this.sql`
          select version.*, saved_by.name as saved_by_name
          from manuscript_chapter_versions version
          join manuscript_chapters chapter
            on chapter.chapter_id = version.chapter_id
           and chapter.deleted_at is null
          join manuscripts manuscript
            on manuscript.manuscript_id = version.manuscript_id
           and manuscript.deleted_at is null
          left join users saved_by on saved_by.user_id = version.saved_by
          where version.manuscript_id = any(${manuscripts.map((item) => item.manuscriptId)}::uuid[])
          order by version.manuscript_id, version.chapter_id, version.created_at desc
        `
      : [];
    const manuscriptChapterVersions = manuscriptChapterVersionRows.map((row) =>
      mapManuscriptChapterVersion(row as Row)
    );
    const communications = perCaseData.flatMap((item) => item.communications);
    const manuscriptBookmarks = manuscripts.length ? (await this.sql`select * from manuscript_bookmarks where manuscript_id = any(${manuscripts.map((m) => m.manuscriptId)}::uuid[]) order by created_at`).map((r) => mapBookmark(r)) : [];
    const auditLogsById = new Map<string, AuditLog>();
    for (const auditLog of perCaseData.flatMap((item) => item.auditLogs)) {
      auditLogsById.set(auditLog.auditLogId, auditLog);
    }
    const contactsById = new Map<string, Contact>();
    for (const relation of caseContacts) {
      contactsById.set(relation.contact.contactId, relation.contact);
    }
    const privateVaultRows = await this.sql`select * from private_vaults order by created_at`;
    const privateVaultFolderRows = await this.sql`select * from private_vault_folders order by created_at`;
    const privateVaultItemRows = await this.sql`select * from private_vault_items order by created_at`;
    const privateVaults = privateVaultRows.map((row) => mapPrivateVault(row as Row));
    const privateVaultFolders = privateVaultFolderRows.map((row) => mapPrivateVaultFolder(row as Row));
    const privateVaultItems = privateVaultItemRows.map((row) => mapPrivateVaultItem(row as Row));

    return {
      generatedAt: new Date().toISOString(),
      cases,
      documents,
      archiveFolders,
      archiveCategories,
      auditLogs: [...auditLogsById.values()],
      contacts: [...contactsById.values()],
      partyOrganizations,
      caseContacts,
      tags,
      tasks,
      notes,
      discussion,
      knowledge: [...knowledgeById.values()],
      manuscripts,
      manuscriptChapters,
      manuscriptChapterVersions,
      manuscriptBookmarks,
      privateVaults,
      privateVaultFolders,
      privateVaultItems,
      communications,
      metadataRows:
        cases.length +
        documents.length +
        archiveFolders.length +
        archiveCategories.length +
        contactsById.size +
        partyOrganizations.length +
        caseContacts.length +
        tags.length +
        tasks.length +
        notes.length +
        discussion.length +
        knowledgeById.size +
        manuscripts.length +
        manuscriptChapters.length +
        manuscriptChapterVersions.length +
        manuscriptBookmarks.length +
        privateVaults.length +
        privateVaultFolders.length +
        privateVaultItems.length +
        communications.length +
        auditLogsById.size
    };
  }

  async exportDatabaseTables(): Promise<DatabaseTableExportPayload> {
    const tableRows = await this.sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name
    `;
    const columnRows = await this.sql`
      select table_name, column_name, data_type, is_nullable
      from information_schema.columns
      where table_schema = 'public'
      order by table_name, ordinal_position
    `;
    const columnsByTable = new Map<string, DatabaseTableExportPayload["tables"][number]["columns"]>();
    for (const row of columnRows) {
      const tableName = asString(row.table_name);
      const columns = columnsByTable.get(tableName) ?? [];
      columns.push({
        name: asString(row.column_name),
        dataType: asString(row.data_type),
        isNullable: asString(row.is_nullable) === "YES"
      });
      columnsByTable.set(tableName, columns);
    }

    const tables: DatabaseTableExportPayload["tables"] = [];
    for (const tableRow of tableRows) {
      const tableName = asString(tableRow.table_name);
      const rows = await this.sql`select * from ${this.sql(tableName)}`;
      const normalizedRows = rows.map((row) => normalizeExportRecord(row as Row));
      tables.push({
        tableName,
        columns: columnsByTable.get(tableName) ?? [],
        rowCount: normalizedRows.length,
        rows: normalizedRows
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      schema: "public",
      tableCount: tables.length,
      rowCount: tables.reduce((sum, table) => sum + table.rowCount, 0),
      tables
    };
  }

  async search(q: string, options: { includeCredentialMetadata?: boolean } = {}): Promise<SearchResult[]> {
    const cases = (await this.listCases({ q })).map((item) => caseSearchResult(item, q));
    const contacts = (await this.listContacts(q)).map((item) => contactSearchResult(item, q));
    const organizations = (await this.listPartyOrganizations(q)).map((item) => organizationSearchResult(item, q));
    const allAssets = await this.listAssets();
    const nativeAssetIds = new Set(filterAssets(allAssets, { q }).map((item) => item.assetId));
    const assetsById = new Map(allAssets.map((item) => [item.assetId, item]));
    const credentialMatchesByAsset = new Map<string, SearchCredentialMatch[]>();
    if (options.includeCredentialMetadata) {
      const credentialRows = await this.sql`
        select ac.credential_id, ac.asset_id, ac.label, ac.credential_type, ac.host, ac.login_url
        from asset_credentials ac
        join managed_assets ma on ma.asset_id = ac.asset_id and ma.deleted_at is null
        where ac.tenant_id = ${DEFAULT_TENANT_ID}
          and ac.deleted_at is null
        order by ac.updated_at desc
      `;
      for (const row of credentialRows) {
        const assetRecord = assetsById.get(asString(row.asset_id));
        if (!assetRecord) continue;
        const match: SearchCredentialMatch = {
          credentialId: asString(row.credential_id),
          label: asString(row.label),
          credentialType: asString(row.credential_type),
          host: asString(row.host),
          loginUrl: asString(row.login_url)
        };
        if (!credentialMatchesAssetSearch(assetRecord, match, q)) continue;
        const matches = credentialMatchesByAsset.get(assetRecord.assetId) ?? [];
        matches.push(match);
        credentialMatchesByAsset.set(assetRecord.assetId, matches);
      }
    }
    const assets = allAssets
      .filter((item) => nativeAssetIds.has(item.assetId) || credentialMatchesByAsset.has(item.assetId))
      .sort((a, b) => Number(credentialMatchesByAsset.has(b.assetId)) - Number(credentialMatchesByAsset.has(a.assetId)))
      .map((item) => {
        const credentialMatches = credentialMatchesByAsset.get(item.assetId) ?? [];
        return assetSearchResult(item, q, credentialMatches);
      });
    const documentRows = await this.sql`
      select d.*, uploader.name as uploaded_by_name, reviewer.name as reviewed_by_name, wi.number as case_number, wi.title as property_address
      from documents d
      join users uploader on uploader.user_id = d.uploaded_by
      left join users reviewer on reviewer.user_id = d.reviewed_by
      join work_items wi on wi.work_item_id = coalesce(d.work_item_id, d.case_id)
      where d.deleted_at is null and wi.deleted_at is null
      order by d.uploaded_at desc
    `;
    const documentsWithContext = await Promise.all(
      documentRows.map(async (row) => ({
        document: mapDocument(row as Row, await this.tagsForDocument(asString(row.document_id))),
        caseNumber: asString(row.case_number),
        propertyAddress: asString(row.property_address)
      }))
    );
    const documents = documentsWithContext
      .filter(({ document, caseNumber, propertyAddress }) =>
        document.isCurrentVersion !== false &&
        [
            document.fileName,
            document.originalFileName,
            document.category,
            document.notes,
            document.reviewStatus,
            document.reviewNotes,
            ...document.tags.map((tag) => tag.name),
            caseNumber,
            propertyAddress
          ]
            .join(" ")
            .toLowerCase()
            .includes(q.toLowerCase())
      )
      .map(({ document, caseNumber, propertyAddress }) =>
        documentSearchResult(document, { caseNumber, propertyAddress }, q)
      );
    const knowledge = (await this.listKnowledgePage({ q }, { pageSize: 12 })).items
      .map((item) => knowledgeSearchResult(item, q));
    const manuscripts = (await this.listManuscripts(q)).map((item) => manuscriptSearchResult(item, q));
    return finalizeSearchResults([...cases, ...contacts, ...organizations, ...assets, ...documents, ...knowledge, ...manuscripts]);
  }

  async listAuditLogs(): Promise<AuditLog[]> {
    const rows = await this.sql`
      select a.*, u.name as user_name
      from audit_logs a
      join users u on u.user_id = a.user_id
      order by a.created_at desc
      limit 100
    `;
    return rows.map((row) => mapAuditLog(row as Row));
  }

  async listCaseAuditLogs(caseId: string): Promise<AuditLog[]> {
    const rows = await this.sql`
      select distinct a.*, u.name as user_name
      from audit_logs a
      join users u on u.user_id = a.user_id
      left join documents d on a.entity_type = 'document' and d.document_id = a.entity_id
      left join tasks t on a.entity_type = 'task' and t.task_id = a.entity_id
      left join notes n on a.entity_type = 'note' and n.note_id = a.entity_id
      left join service_discussion_messages sdm on a.entity_type = 'service_discussion' and sdm.message_id = a.entity_id
      left join communications comm on a.entity_type = 'communication' and comm.communication_id = a.entity_id
      left join managed_assets ma on a.entity_type = 'asset' and ma.asset_id = a.entity_id
      left join asset_credentials ac on a.entity_type = 'credential' and ac.credential_id = a.entity_id
      left join managed_assets acma on ac.asset_id = acma.asset_id
      left join knowledge_items ki on a.entity_type = 'knowledge' and ki.knowledge_id = a.entity_id
      left join managed_assets meta_asset on a.metadata->>'assetId' = meta_asset.asset_id::text
      where a.action <> 'note.created'
        and (
          (a.entity_type = 'case' and a.entity_id = ${caseId})
          or coalesce(d.work_item_id, d.case_id) = ${caseId}
          or coalesce(t.work_item_id, t.case_id) = ${caseId}
          or coalesce(n.work_item_id, n.case_id) = ${caseId}
          or sdm.work_item_id = ${caseId}
          or coalesce(comm.work_item_id, comm.case_id) = ${caseId}
          or ma.work_item_id = ${caseId}
          or ac.work_item_id = ${caseId}
          or acma.work_item_id = ${caseId}
          or ki.source_work_item_id = ${caseId}
          or exists (
            select 1
            from knowledge_links kl
            where kl.knowledge_id = ki.knowledge_id
              and kl.entity_type = 'service'
              and kl.entity_id::text = ${caseId}
          )
          or meta_asset.work_item_id = ${caseId}
          or a.metadata->>'caseId' = ${caseId}
          or a.metadata->>'sourceServiceId' = ${caseId}
        )
      order by a.created_at desc
      limit 100
    `;
    return rows.map((row) => mapAuditLog(row as Row));
  }

  async createAuditLog(input: {
    action: string;
    entityType: string;
    entityId: string;
    user: PublicUser;
    metadata?: Record<string, unknown>;
  }): Promise<AuditLog> {
    const auditLogId = crypto.randomUUID();
    await this.sql`
      insert into audit_logs (audit_log_id, action, entity_type, entity_id, user_id, metadata)
      values (${auditLogId}, ${input.action}, ${input.entityType}, ${input.entityId}, ${input.user.userId}, ${this.sql.json((input.metadata ?? {}) as never)})
    `;
    const rows = await this.sql`
      select a.*, u.name as user_name
      from audit_logs a
      join users u on u.user_id = a.user_id
      where a.audit_log_id = ${auditLogId}
    `;
    return mapAuditLog(rows[0] as Row);
  }
}
