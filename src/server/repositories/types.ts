import type { ManuscriptBookmark, ManuscriptBookmarkInput } from "../../shared/manuscriptBookmarks";
import type {
  AuditLog,
  BackupDestination,
  BackupItem,
  BackupItemStatus,
  BackupItemType,
  BackupRun,
  BackupRunMode,
  BackupRunStatus,
  BackupScope,
  BackupSchedule,
  BackupSettings,
  PbxSettings,
  PbxSettingsInput,
  AssetCredential,
  AssetCredentialInput,
  AssetDocumentLink,
  AssetDocumentLinkInput,
  AssetDocumentLinkUpdateInput,
  AssetFilters,
  ArchiveCategory,
  ArchiveCategoryInput,
  ArchiveFolder,
  ArchiveFolderInput,
  ArchiveFolderMetadataUpdateInput,
  ArchiveFolderMetadataUpdateResult,
  CaseContact,
  CaseFilters,
  CaseRecord,
  CaseTypeTemplate,
  CommunicationInput,
  CommunicationFilters,
  CommunicationRecord,
  CommunicationSource,
  GmailExtensionToken,
  GmailExtensionTokenScope,
  Contact,
  ContactFilters,
  ContactRole,
  DashboardStats,
  DocumentCategory,
  DocumentFilters,
  DocumentRecord,
  DocumentUpdateInput,
  DocumentVersionUploadResult,
  DirectoryViewScope,
  KnowledgeFilters,
  KnowledgeInput,
  KnowledgeItem,
  Manuscript,
  ManuscriptChapter,
  ManuscriptChapterInput,
  ManuscriptBodyEncryptionInput,
  ManuscriptEncryptionMetadata,
  ManuscriptChapterSaveSource,
  ManuscriptChapterVersion,
  ManuscriptChapterVersionSummary,
  ManuscriptInput,
  ManagedAsset,
  ManagedAssetInput,
  NoteRecord,
  OrganizationFilters,
  PaginatedResult,
  PaginationParams,
  PublicUser,
  PartyOrganization,
  PartyOrganizationInput,
  PrivateVault,
  PrivateVaultFolder,
  PrivateVaultItem,
  PrivateVaultPasswordMetadata,
  SearchResult,
  SavedDirectoryView,
  SavedDirectoryViewInput,
  ServiceDiscussionAssetLink,
  ServiceDiscussionAttachment,
  ServiceDiscussionFilters,
  ServiceDiscussionMessage,
  ServiceDiscussionSummary,
  ServiceDiscussionMessageInput,
  Tag,
  TaskRecord
} from "../../shared/types";

export interface CreateCaseInput {
  caseNumber?: string;
  caseTypeCode?: string;
  customerOrganizationId?: string | null;
  propertyAddress: string;
  city: string;
  state: string;
  zipCode: string;
  propertyType: CaseRecord["propertyType"];
  salePriceCents: number;
  status: CaseRecord["status"];
  closingDate: string;
  notes: string;
  tagIds?: string[];
}

export interface CreateContactInput {
  displayName: string;
  firstName: string;
  lastName: string;
  partyOrganizationId?: string | null;
  jobTitle: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
}

export interface CreatePartyOrganizationInput extends PartyOrganizationInput {}

export interface CreateManagedAssetInput extends ManagedAssetInput {
  createdBy?: string | null;
  updatedBy?: string | null;
}

export interface UpdateManagedAssetInput extends Partial<ManagedAssetInput> {
  updatedBy?: string | null;
}

export interface CreateAssetDocumentLinkInput extends AssetDocumentLinkInput {
  assetId: string;
  createdBy?: string | null;
  updatedBy?: string | null;
}

export interface UpdateAssetDocumentLinkInput extends AssetDocumentLinkUpdateInput {
  updatedBy?: string | null;
}

export interface EncryptedPayload {
  encryptedValue: string;
  iv: string;
  tag: string;
  algorithm: string;
}

export interface CreateAssetCredentialInput
  extends Omit<AssetCredentialInput, "secret" | "privateNotes"> {
  assetId: string;
  encryptedSecret: EncryptedPayload;
  encryptedPrivateNotes: EncryptedPayload;
  createdBy?: string | null;
  updatedBy?: string | null;
}

export interface UpdateAssetCredentialInput
  extends Partial<Omit<AssetCredentialInput, "secret" | "privateNotes">> {
  encryptedSecret?: EncryptedPayload;
  encryptedPrivateNotes?: EncryptedPayload;
  updatedBy?: string | null;
}

export interface StoredAssetCredential extends AssetCredential {
  encryptedSecret: string;
  secretIv: string;
  secretTag: string;
  encryptedPrivateNotes: string;
  privateNotesIv: string;
  privateNotesTag: string;
  encryptionAlgorithm: string;
}

export interface CreateDocumentInput {
  documentId: string;
  caseId?: string | null;
  documentGroupId?: string;
  versionNumber?: number;
  isCurrentVersion?: boolean;
  fileName: string;
  originalFileName: string;
  fileSize: number;
  mimeType: string;
  category: DocumentCategory;
  folderId?: string | null;
  r2ObjectKey: string;
  uploadedBy: string;
  notes: string;
  tagIds?: string[];
}

export interface UpdateDocumentInput extends DocumentUpdateInput {
  reviewedBy?: string | null;
}

export interface CreateArchiveFolderInput extends ArchiveFolderInput {
  folderId: string;
  createdBy?: string | null;
}

export interface ArchiveFolderDeleteResult {
  deletedFolders: number;
  trashedDocuments: number;
}

export interface CreateArchiveCategoryInput extends ArchiveCategoryInput {
  categoryId: string;
  createdBy?: string | null;
}

export interface StoredPrivateVault extends PrivateVault {
  recoveryEncryptedVaultKey: string;
}

export interface StoredPrivateVaultItem extends PrivateVaultItem {
  objectKey: string;
}

export interface StoredPrivateVaultFolder extends PrivateVaultFolder {}

export interface CreatePrivateVaultInput extends PrivateVaultPasswordMetadata {
  vaultId: string;
  ownerUserId: string;
  recoveryEncryptedVaultKey: string;
  autoLockMinutes?: number;
}

export interface CreatePrivateVaultItemInput {
  itemId: string;
  vaultId: string;
  encryptionVersion: number;
  encryptedMetadata: string;
  wrappedFileKey: string;
  objectKey: string;
  ciphertextSize: number;
}

export interface CreatePrivateVaultFolderInput {
  folderId: string;
  vaultId: string;
  encryptionVersion: number;
  encryptedMetadata: string;
}

export interface PrivateVaultItemMetadataUpdate {
  itemId: string;
  encryptedMetadata: string;
}

export class PrivateVaultItemAccessError extends Error {
  constructor() { super("A private vault item could not be updated."); this.name = "PrivateVaultItemAccessError"; }
}

export interface CreateNoteInput {
  caseId: string;
  body: string;
  createdBy: string;
}

export interface CreateServiceDiscussionMessageInput extends ServiceDiscussionMessageInput {
  caseId?: string | null;
  createdBy: string;
  updatedBy?: string | null;
}

export interface UpdateServiceDiscussionMessageInput {
  title?: string | null;
  bodyText?: string;
  messageType?: ServiceDiscussionMessage["messageType"];
  threadStatus?: ServiceDiscussionMessage["threadStatus"];
  threadOwnerUserId?: string | null;
  isPinned?: boolean;
  mentionedUserIds?: string[];
  updatedBy?: string | null;
}

export interface CreateServiceDiscussionAssetLinkInput {
  messageId: string;
  assetId: string;
  relationship?: string;
  createdBy?: string | null;
}

export interface CreateServiceDiscussionAttachmentInput {
  messageId: string;
  documentId: string;
  inlineImage?: boolean;
  sortOrder?: number;
}

export interface CreateKnowledgeInput extends KnowledgeInput {
  createdBy?: string | null;
  updatedBy?: string | null;
}

export interface UpdateKnowledgeInput extends Partial<KnowledgeInput> {
  updatedBy?: string | null;
}

export interface CreateManuscriptInput extends ManuscriptInput {
  createdBy?: string | null;
  updatedBy?: string | null;
}

export interface UpdateManuscriptInput extends Partial<ManuscriptInput> {
  updatedBy?: string | null;
}

export interface CreateManuscriptChapterInput extends ManuscriptChapterInput {
  manuscriptId: string;
}

export interface UpdateManuscriptChapterInput extends Partial<ManuscriptChapterInput> {
  expectedRevision?: number;
  saveSource?: ManuscriptChapterSaveSource;
  updatedBy?: string | null;
}

export class ManuscriptChapterConflictError extends Error {
  constructor(readonly current: ManuscriptChapter) {
    super("This part was updated in another tab or device. Your local draft was not overwritten.");
    this.name = "ManuscriptChapterConflictError";
  }
}

export class ManuscriptEncryptionConflictError extends Error {
  constructor(message = "The work changed while its encryption was being updated. Reload it and try again.") {
    super(message);
    this.name = "ManuscriptEncryptionConflictError";
  }
}

export interface CreateCommunicationInput extends CommunicationInput {
  createdBy?: string | null;
}

export interface CreateTaskInput {
  caseId: string;
  title: string;
  description: string;
  priority?: TaskRecord["priority"];
  dueDate: string;
  assignedTo?: string | null;
}

export interface UpdateBackupSettingsInput {
  destination: BackupDestination;
  schedule: BackupSchedule;
  scope: BackupScope;
  includeMetadata: boolean;
  includeDocuments: boolean;
  includeAuditLogs: boolean;
  includeRelationshipMap: boolean;
  folderByCaseAndCategory: boolean;
  checksumManifest: boolean;
  isEnabled: boolean;
}

export interface UpdatePbxSettingsInput extends PbxSettingsInput {}

export interface CreateBackupRunInput {
  backupRunId: string;
  backupJobId: string;
  status: BackupRunStatus;
  destination: BackupDestination;
  scope: BackupScope;
  startedAt: string;
  completedAt?: string | null;
  caseCount: number;
  documentCount: number;
  metadataRows: number;
  itemCount: number;
  failedItems: number;
  manifestObjectKey?: string | null;
  manifestFileName?: string | null;
  mode: BackupRunMode;
  createdBy?: string | null;
  message: string;
}

export interface CreateBackupItemInput {
  backupItemId: string;
  backupRunId: string;
  itemType: BackupItemType;
  sourceId?: string | null;
  sourcePath: string;
  targetPath: string;
  status: BackupItemStatus;
  sizeBytes: number;
  checksum?: string | null;
  metadata?: Record<string, unknown>;
}

export interface BackupSnapshot {
  generatedAt: string;
  cases: CaseRecord[];
  documents: DocumentRecord[];
  archiveFolders: ArchiveFolder[];
  archiveCategories: ArchiveCategory[];
  auditLogs: AuditLog[];
  contacts: Contact[];
  partyOrganizations: PartyOrganization[];
  caseContacts: CaseContact[];
  communications: CommunicationRecord[];
  tags: Tag[];
  tasks: TaskRecord[];
  notes: NoteRecord[];
  discussion: ServiceDiscussionMessage[];
  knowledge: KnowledgeItem[];
  manuscripts: Manuscript[];
  manuscriptChapters: ManuscriptChapter[];
  manuscriptChapterVersions: ManuscriptChapterVersion[];
  manuscriptBookmarks: ManuscriptBookmark[];
  privateVaults: StoredPrivateVault[];
  privateVaultFolders: StoredPrivateVaultFolder[];
  privateVaultItems: StoredPrivateVaultItem[];
  metadataRows: number;
}

export interface DatabaseTableExportColumn {
  name: string;
  dataType: string;
  isNullable: boolean;
}

export interface DatabaseTableExportTable {
  tableName: string;
  columns: DatabaseTableExportColumn[];
  rowCount: number;
  rows: Record<string, unknown>[];
}

export interface DatabaseTableExportPayload {
  generatedAt: string;
  schema: string;
  tableCount: number;
  rowCount: number;
  tables: DatabaseTableExportTable[];
}

export interface UserCredential {
  passwordHash: string;
  passwordSalt: string;
  passwordAlgorithm: string;
  passwordIterations: number;
  mustChangePassword: boolean;
}

export interface CreateAuthSessionInput {
  userId: string;
  currentTenantId?: string | null;
  tokenHash: string;
  expiresAt: string;
}

export interface UpdateUserPasswordOptions {
  // undefined = trusted administrative reset; null = expect no credential yet.
  expectedPasswordHash?: string | null;
  replacementSession?: CreateAuthSessionInput;
}

export interface StorageCleanupJob {
  cleanupJobId: string;
  objectKey: string;
  attempts: number;
  startedAt: string | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  nextAttemptAt: string;
  completedAt: string | null;
  lastError: "object_delete_failed" | "object_referenced" | null;
}

export interface StorageCleanupStatus {
  pending: number;
  leased: number;
  failed: number;
  referenced: number;
  completed: number;
}

export interface CreateGmailExtensionTokenInput {
  name: string;
  tokenHash: string;
  scopes: GmailExtensionTokenScope[];
  ownerUserId: string;
  createdBy?: string | null;
}

export interface StoredGmailExtensionToken extends GmailExtensionToken {
  tokenHash: string;
}

export interface AppRepository {
  runArchiveMutation<T>(access: import("../auth/archiveManagement").ArchiveAccess, operation: (repo: AppRepository) => Promise<T>): Promise<T>;
  getArchiveManagementSession(access: import("../auth/archiveManagement").ArchiveAccess): Promise<import("../auth/archiveManagement").ArchiveManagementSession | null>;
  setArchiveManagementVerification(access: import("../auth/archiveManagement").ArchiveAccess, expectedPasswordHash: string | null): Promise<string | null>;
  readArchiveManagementState(documentId?: string, folderId?: string): Promise<import("../auth/archiveManagement").ArchiveManagementState>;
  readArchiveContentTargets(kind: import("../../shared/archiveContent").ArchiveContentKind, id: string, wholeThread?: boolean): Promise<import("../auth/archiveManagement").ArchiveManagementTarget[]>;
  readArchiveContentDocumentIds(kind: import("../../shared/archiveContent").ArchiveContentKind, id: string): Promise<string[]>;
  retainArchiveContentDocuments(kind: import("../../shared/archiveContent").ArchiveContentKind, id: string, documentIds: string[]): Promise<void>;
  hasOpaqueArchiveContent(): Promise<boolean>;
  createManuscriptDocument(manuscriptId: string, input: CreateDocumentInput): Promise<DocumentRecord>;
  recordArchiveManagementAudit(actorUserId: string, action: string, targets: import("../auth/archiveManagement").ArchiveManagementTarget[]): Promise<void>;
  healthCheck(): Promise<void>;
  getDatabaseSizeBytes(): Promise<number | null>;
  getUserByEmail(email: string): Promise<PublicUser | null>;
  getUserById(userId: string): Promise<PublicUser | null>;
  listUsers(): Promise<PublicUser[]>;
  getUserCredential(userId: string): Promise<UserCredential | null>;
  updateUserPassword(userId: string, credential: UserCredential, options?: UpdateUserPasswordOptions): Promise<PublicUser | null>;
  getDefaultTenantForUser(userId: string): Promise<string | null>;
  createAuthSession(input: CreateAuthSessionInput, expectedPasswordHash?: string | null): Promise<boolean>;
  getUserBySessionTokenHash(tokenHash: string, refreshExpiresAt?: string): Promise<PublicUser | null>;
  revokeAuthSession(tokenHash: string): Promise<void>;
  listGmailExtensionTokens(): Promise<GmailExtensionToken[]>;
  getGmailExtensionTokenByHash(tokenHash: string): Promise<StoredGmailExtensionToken | null>;
  createGmailExtensionToken(input: CreateGmailExtensionTokenInput): Promise<GmailExtensionToken>;
  markGmailExtensionTokenUsed(tokenId: string): Promise<void>;
  revokeGmailExtensionToken(tokenId: string): Promise<GmailExtensionToken | null>;

  getDashboardStats(): Promise<DashboardStats>;
  listCases(filters?: CaseFilters): Promise<CaseRecord[]>;
  listCasesPage(filters?: CaseFilters, pagination?: PaginationParams): Promise<PaginatedResult<CaseRecord>>;
  getCase(caseId: string, options?: { includeArchived?: boolean }): Promise<CaseRecord | null>;
  listCaseTypeTemplates(): Promise<CaseTypeTemplate[]>;
  getCaseTypeTemplate(code: string): Promise<CaseTypeTemplate | null>;
  previewNextCaseNumber(): Promise<string>;
  createCase(input: CreateCaseInput): Promise<CaseRecord>;
  updateCase(caseId: string, input: Partial<CreateCaseInput>): Promise<CaseRecord | null>;
  softDeleteCase(caseId: string): Promise<CaseRecord | null>;
  restoreCase(caseId: string): Promise<CaseRecord | null>;

  listPartyOrganizations(filters?: OrganizationFilters | string): Promise<PartyOrganization[]>;
  listPartyOrganizationsPage(
    filters?: OrganizationFilters | string,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<PartyOrganization>>;
  getPartyOrganization(partyOrganizationId: string): Promise<PartyOrganization | null>;
  createPartyOrganization(input: CreatePartyOrganizationInput): Promise<PartyOrganization>;
  updatePartyOrganization(
    partyOrganizationId: string,
    input: Partial<CreatePartyOrganizationInput>
  ): Promise<PartyOrganization | null>;
  softDeletePartyOrganization(partyOrganizationId: string): Promise<PartyOrganization | null>;
  listPartyOrganizationContacts(partyOrganizationId: string): Promise<Contact[]>;
  listPartyOrganizationCases(partyOrganizationId: string): Promise<CaseContact[]>;

  listAssets(filters?: AssetFilters): Promise<ManagedAsset[]>;
  listAssetsPage(filters?: AssetFilters, pagination?: PaginationParams): Promise<PaginatedResult<ManagedAsset>>;
  getAsset(assetId: string): Promise<ManagedAsset | null>;
  createAsset(input: CreateManagedAssetInput): Promise<ManagedAsset>;
  updateAsset(assetId: string, input: UpdateManagedAssetInput): Promise<ManagedAsset | null>;
  softDeleteAsset(assetId: string): Promise<ManagedAsset | null>;
  listAssetDocumentLinks(assetId: string): Promise<AssetDocumentLink[]>;
  getAssetDocumentLink(assetDocumentLinkId: string): Promise<AssetDocumentLink | null>;
  linkAssetDocument(input: CreateAssetDocumentLinkInput): Promise<AssetDocumentLink>;
  updateAssetDocumentLink(
    assetDocumentLinkId: string,
    input: UpdateAssetDocumentLinkInput
  ): Promise<AssetDocumentLink | null>;
  deleteAssetDocumentLink(assetDocumentLinkId: string): Promise<AssetDocumentLink | null>;
  listAssetCredentials(assetId: string): Promise<AssetCredential[]>;
  getAssetCredential(credentialId: string): Promise<StoredAssetCredential | null>;
  createAssetCredential(input: CreateAssetCredentialInput): Promise<AssetCredential>;
  updateAssetCredential(credentialId: string, input: UpdateAssetCredentialInput): Promise<AssetCredential | null>;
  softDeleteAssetCredential(credentialId: string): Promise<AssetCredential | null>;

  listContacts(filters?: ContactFilters | string): Promise<Contact[]>;
  listContactsPage(filters?: ContactFilters | string, pagination?: PaginationParams): Promise<PaginatedResult<Contact>>;
  getContact(contactId: string): Promise<Contact | null>;
  createContact(input: CreateContactInput): Promise<Contact>;
  updateContact(contactId: string, input: Partial<CreateContactInput>): Promise<Contact | null>;
  deleteContact(contactId: string): Promise<Contact | null>;
  listCaseContacts(caseId: string): Promise<CaseContact[]>;
  listContactCases(contactId: string): Promise<CaseContact[]>;
  addCaseContact(caseId: string, contactId: string, role: ContactRole): Promise<CaseContact>;
  removeCaseContact(caseId: string, contactId: string, role: ContactRole): Promise<boolean>;

  listDocuments(caseId: string, filters?: DocumentFilters): Promise<DocumentRecord[]>;
  listDocumentsPage(filters?: DocumentFilters, pagination?: PaginationParams): Promise<PaginatedResult<DocumentRecord>>;
  listRecentDocuments(limit: number): Promise<DocumentRecord[]>;
  getDocument(documentId: string, options?: { includeDeleted?: boolean }): Promise<DocumentRecord | null>;
  createDocument(input: CreateDocumentInput): Promise<DocumentRecord>;
  listDocumentVersions(documentId: string): Promise<DocumentRecord[]>;
  createDocumentVersion(sourceDocumentId: string, input: CreateDocumentInput): Promise<DocumentVersionUploadResult | null>;
  updateDocument(documentId: string, input: UpdateDocumentInput): Promise<DocumentRecord | null>;
  softDeleteDocument(
    documentId: string,
    options?: { retainObject?: boolean; entireGroup?: boolean }
  ): Promise<DocumentRecord | null>;
  restoreDocument(documentId: string): Promise<DocumentRecord | null>;
  purgeDocument(documentId: string): Promise<DocumentRecord[]>;
  listArchiveFolders(options?: { includeDeleted?: boolean }): Promise<ArchiveFolder[]>;
  getArchiveFolder(folderId: string, options?: { includeDeleted?: boolean }): Promise<ArchiveFolder | null>;
  createArchiveFolder(input: CreateArchiveFolderInput): Promise<ArchiveFolder>;
  updateArchiveFolder(folderId: string, input: Partial<ArchiveFolderInput>): Promise<ArchiveFolder | null>;
  deleteArchiveFolder(folderId: string): Promise<ArchiveFolderDeleteResult | null>;
  restoreArchiveFolder(folderId: string, input?: Partial<ArchiveFolderInput>): Promise<ArchiveFolder | null>;
  updateArchiveFolderDocumentsMetadata(
    folderId: string,
    input: ArchiveFolderMetadataUpdateInput,
    reviewedBy: string
  ): Promise<ArchiveFolderMetadataUpdateResult | null>;
  listArchiveCategories(): Promise<ArchiveCategory[]>;
  getArchiveCategory(categoryId: string): Promise<ArchiveCategory | null>;
  createArchiveCategory(input: CreateArchiveCategoryInput): Promise<ArchiveCategory>;
  updateArchiveCategory(categoryId: string, input: Partial<ArchiveCategoryInput>): Promise<ArchiveCategory | null>;
  deleteArchiveCategory(categoryId: string, replacementCategoryId?: string | null): Promise<boolean>;
  enqueueStorageCleanup(objectKey: string): Promise<void>;
  listPendingStorageCleanupJobs(limit?: number): Promise<StorageCleanupJob[]>;
  claimStorageCleanupJob(cleanupJobId: string): Promise<StorageCleanupJob | null>;
  completeStorageCleanup(cleanupJobId: string, leaseToken: string): Promise<boolean>;
  failStorageCleanup(cleanupJobId: string, leaseToken: string): Promise<boolean>;
  getStorageCleanupStatus(): Promise<StorageCleanupStatus>;

  getPrivateVaultByOwner(ownerUserId: string): Promise<StoredPrivateVault | null>;
  createPrivateVault(input: CreatePrivateVaultInput): Promise<StoredPrivateVault>;
  updatePrivateVaultPassword(
    ownerUserId: string,
    metadata: PrivateVaultPasswordMetadata
  ): Promise<StoredPrivateVault | null>;
  updatePrivateVaultAutoLock(ownerUserId: string, autoLockMinutes: number): Promise<StoredPrivateVault | null>;
  listPrivateVaultFolders(ownerUserId: string, includeDeleted?: boolean): Promise<StoredPrivateVaultFolder[]>;
  getPrivateVaultFolder(
    ownerUserId: string,
    folderId: string,
    includeDeleted?: boolean
  ): Promise<StoredPrivateVaultFolder | null>;
  createPrivateVaultFolder(input: CreatePrivateVaultFolderInput): Promise<StoredPrivateVaultFolder>;
  updatePrivateVaultFolderMetadata(
    ownerUserId: string,
    folderId: string,
    encryptedMetadata: string
  ): Promise<StoredPrivateVaultFolder | null>;
  softDeletePrivateVaultFolder(ownerUserId: string, folderId: string): Promise<StoredPrivateVaultFolder | null>;
  restorePrivateVaultFolder(ownerUserId: string, folderId: string): Promise<StoredPrivateVaultFolder | null>;
  purgePrivateVaultFolder(ownerUserId: string, folderId: string): Promise<StoredPrivateVaultFolder | null>;
  listPrivateVaultItems(ownerUserId: string, includeDeleted?: boolean): Promise<StoredPrivateVaultItem[]>;
  getPrivateVaultItem(
    ownerUserId: string,
    itemId: string,
    includeDeleted?: boolean
  ): Promise<StoredPrivateVaultItem | null>;
  createPrivateVaultItem(input: CreatePrivateVaultItemInput): Promise<StoredPrivateVaultItem>;
  updatePrivateVaultItemMetadata(
    ownerUserId: string,
    itemId: string,
    encryptedMetadata: string
  ): Promise<StoredPrivateVaultItem | null>;
  updatePrivateVaultItemMetadataBatch(
    ownerUserId: string,
    updates: PrivateVaultItemMetadataUpdate[]
  ): Promise<StoredPrivateVaultItem[]>;
  softDeletePrivateVaultItem(ownerUserId: string, itemId: string): Promise<StoredPrivateVaultItem | null>;
  restorePrivateVaultItem(ownerUserId: string, itemId: string): Promise<StoredPrivateVaultItem | null>;
  purgePrivateVaultItem(ownerUserId: string, itemId: string): Promise<StoredPrivateVaultItem | null>;

  listTags(): Promise<Tag[]>;
  createTag(name: string, color: string): Promise<Tag>;
  updateTag(tagId: string, name: string, color: string): Promise<Tag | null>;
  deleteTag(tagId: string): Promise<boolean>;

  listNotes(caseId: string): Promise<NoteRecord[]>;
  createNote(input: CreateNoteInput): Promise<NoteRecord>;
  listServiceDiscussion(caseId: string, userId?: string): Promise<ServiceDiscussionMessage[]>;
  listServiceDiscussionsPage(
    filters?: ServiceDiscussionFilters,
    pagination?: PaginationParams,
    userId?: string
  ): Promise<PaginatedResult<ServiceDiscussionMessage>>;
  getServiceDiscussionSummary(filters: ServiceDiscussionFilters, userId?: string): Promise<ServiceDiscussionSummary>;
  getServiceDiscussionMessage(messageId: string): Promise<ServiceDiscussionMessage | null>;
  createServiceDiscussionMessage(input: CreateServiceDiscussionMessageInput): Promise<ServiceDiscussionMessage>;
  updateServiceDiscussionMessage(
    messageId: string,
    input: UpdateServiceDiscussionMessageInput
  ): Promise<ServiceDiscussionMessage | null>;
  softDeleteServiceDiscussionMessage(messageId: string): Promise<ServiceDiscussionMessage | null>;
  linkServiceDiscussionThread(messageId: string, caseId: string, updatedBy: string): Promise<ServiceDiscussionMessage[]>;
  updateServiceDiscussionThreadContext(
    messageId: string,
    caseId: string | null,
    assetIds: string[],
    updatedBy: string
  ): Promise<ServiceDiscussionMessage[]>;
  markServiceDiscussionRead(messageId: string, userId: string): Promise<ServiceDiscussionMessage | null>;
  markServiceDiscussionsRead(filters: ServiceDiscussionFilters, userId: string): Promise<number>;
  linkServiceDiscussionAsset(input: CreateServiceDiscussionAssetLinkInput): Promise<ServiceDiscussionAssetLink>;
  unlinkServiceDiscussionAsset(messageId: string, assetId: string): Promise<boolean>;
  createServiceDiscussionAttachment(input: CreateServiceDiscussionAttachmentInput): Promise<ServiceDiscussionAttachment>;
  createDocumentWithDiscussionAttachment(document: CreateDocumentInput, attachment: Omit<CreateServiceDiscussionAttachmentInput, "documentId">): Promise<ServiceDiscussionAttachment>;
  listKnowledge(filters?: KnowledgeFilters): Promise<KnowledgeItem[]>;
  listKnowledgePage(filters?: KnowledgeFilters, pagination?: PaginationParams): Promise<PaginatedResult<KnowledgeItem>>;
  getKnowledge(knowledgeId: string, options?: { includeDeleted?: boolean }): Promise<KnowledgeItem | null>;
  createKnowledge(input: CreateKnowledgeInput): Promise<KnowledgeItem>;
  updateKnowledge(knowledgeId: string, input: UpdateKnowledgeInput): Promise<KnowledgeItem | null>;
  softDeleteKnowledge(knowledgeId: string): Promise<KnowledgeItem | null>;
  restoreKnowledge(knowledgeId: string): Promise<KnowledgeItem | null>;
  purgeKnowledge(knowledgeId: string): Promise<KnowledgeItem | null>;
  listManuscripts(query?: string): Promise<Manuscript[]>;
  getManuscript(manuscriptId: string): Promise<Manuscript | null>;
  listManuscriptBookmarks(userId: string, manuscriptId: string): Promise<ManuscriptBookmark[]>;
  createManuscriptBookmark(userId: string, manuscriptId: string, input: ManuscriptBookmarkInput): Promise<ManuscriptBookmark | null>;
  renameManuscriptBookmark(userId: string, manuscriptId: string, bookmarkId: string, name: string): Promise<ManuscriptBookmark | null>;
  deleteManuscriptBookmark(userId: string, manuscriptId: string, bookmarkId: string): Promise<boolean>;
  createManuscript(input: CreateManuscriptInput): Promise<Manuscript>;
  /** Maintenance only. No HTTP claim endpoint; immutable once confirmed. */
  claimManuscriptKeyOwner(input: import("../auth/manuscriptKeyOwnership").ManuscriptKeyOwnerClaimInput): Promise<void>;
  listUnresolvedManuscriptKeyOwnership(): Promise<import("../auth/manuscriptKeyOwnership").ManuscriptKeyOwnershipReview[]>;
  updateManuscript(manuscriptId: string, input: UpdateManuscriptInput): Promise<Manuscript | null>;
  replaceManuscriptBodyEncryption(
    manuscriptId: string,
    input: ManuscriptBodyEncryptionInput,
    enable: boolean,
    updatedBy?: string | null
  ): Promise<Manuscript | null>;
  updateManuscriptEncryptionKey(
    manuscriptId: string,
    metadata: ManuscriptEncryptionMetadata,
    updatedBy?: string | null
  ): Promise<Manuscript | null>;
  softDeleteManuscript(manuscriptId: string): Promise<Manuscript | null>;
  getManuscriptChapter(manuscriptId: string, chapterId: string): Promise<ManuscriptChapter | null>;
  listManuscriptChapterVersions(
    manuscriptId: string,
    chapterId: string,
    limit?: number
  ): Promise<ManuscriptChapterVersionSummary[]>;
  getManuscriptChapterVersion(
    manuscriptId: string,
    chapterId: string,
    versionId: string
  ): Promise<ManuscriptChapterVersion | null>;
  createManuscriptChapter(input: CreateManuscriptChapterInput): Promise<ManuscriptChapter>;
  updateManuscriptChapter(
    manuscriptId: string,
    chapterId: string,
    input: UpdateManuscriptChapterInput
  ): Promise<ManuscriptChapter | null>;
  deleteManuscriptChapter(manuscriptId: string, chapterId: string): Promise<boolean>;
  getCommunication(communicationId: string): Promise<CommunicationRecord | null>;
  listAllCommunications(filters?: CommunicationFilters): Promise<CommunicationRecord[]>;
  listAllCommunicationsPage(filters?: CommunicationFilters, pagination?: PaginationParams): Promise<PaginatedResult<CommunicationRecord>>;
  listCommunications(caseId: string): Promise<CommunicationRecord[]>;
  findCommunicationByExternalReferences(
    source: CommunicationSource,
    externalReferences: string[],
    externalProvider?: string
  ): Promise<CommunicationRecord | null>;
  createCommunication(input: CreateCommunicationInput): Promise<CommunicationRecord>;
  updateCommunication(communicationId: string, input: Partial<CommunicationInput>): Promise<CommunicationRecord | null>;

  listSavedDirectoryViews(scope?: DirectoryViewScope, userId?: string): Promise<SavedDirectoryView[]>;
  getSavedDirectoryView(savedViewId: string): Promise<SavedDirectoryView | null>;
  createSavedDirectoryView(input: SavedDirectoryViewInput, user: PublicUser): Promise<SavedDirectoryView>;
  updateSavedDirectoryView(savedViewId: string, input: Partial<SavedDirectoryViewInput>, user: PublicUser): Promise<SavedDirectoryView | null>;
  deleteSavedDirectoryView(savedViewId: string, user: PublicUser): Promise<boolean>;

  findContactsByPhone(phone: string): Promise<Contact[]>;
  findPartyOrganizationsByPhone(phone: string): Promise<PartyOrganization[]>;
  findAssetsByPhoneOrExtension(phone: string, extension?: string): Promise<ManagedAsset[]>;

  listTasks(caseId: string): Promise<TaskRecord[]>;
  listAllTasks(): Promise<TaskRecord[]>;
  createTask(input: CreateTaskInput): Promise<TaskRecord>;
  updateTask(taskId: string, input: Partial<TaskRecord>): Promise<TaskRecord | null>;

  search(q: string, options?: { includeCredentialMetadata?: boolean }): Promise<SearchResult[]>;

  getBackupSettings(): Promise<BackupSettings>;
  updateBackupSettings(input: UpdateBackupSettingsInput, user: PublicUser): Promise<BackupSettings>;
  getPbxSettings(): Promise<PbxSettings>;
  updatePbxSettings(input: UpdatePbxSettingsInput, user: PublicUser): Promise<PbxSettings>;
  listBackupRuns(limit?: number): Promise<BackupRun[]>;
  getBackupRun(backupRunId: string): Promise<BackupRun | null>;
  createBackupRun(input: CreateBackupRunInput): Promise<BackupRun>;
  deleteBackupRun(backupRunId: string): Promise<BackupRun | null>;
  createBackupItem(input: CreateBackupItemInput): Promise<BackupItem>;
  listBackupItems(backupRunId: string): Promise<BackupItem[]>;
  buildBackupSnapshot(scope: BackupScope): Promise<BackupSnapshot>;
  exportDatabaseTables(): Promise<DatabaseTableExportPayload>;

  listAuditLogs(): Promise<AuditLog[]>;
  listCaseAuditLogs(caseId: string): Promise<AuditLog[]>;
  createAuditLog(input: {
    action: string;
    entityType: string;
    entityId: string;
    user: PublicUser;
    metadata?: Record<string, unknown>;
  }): Promise<AuditLog>;
}
