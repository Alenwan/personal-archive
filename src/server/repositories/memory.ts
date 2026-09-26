import { HTTPException } from "hono/http-exception";
import { ARCHIVE_MANAGEMENT_TTL_MS, requireArchiveSession, type ArchiveAccess, type ArchiveManagementSession, type ArchiveManagementState, type ArchiveManagementTarget } from "../auth/archiveManagement";
import { archiveDocumentCandidates, type ArchiveContentKind } from "../../shared/archiveContent";
import {
  demoAuditLogs,
  demoCaseContacts,
  demoCases,
  demoContacts,
  demoDocuments,
  demoNotes,
  demoTags,
  demoTasks,
  demoUsers
} from "../demoData";
import { STORAGE_CLEANUP_LEASE_MS, STORAGE_CLEANUP_REFERENCE_DELAY_MS, storageCleanupRetryDelay } from "../services/storageCleanupPolicy";
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
  DirectoryViewScope,
  GmailExtensionToken,
  KnowledgeFilters,
  KnowledgeItem,
  KnowledgeLink,
  KnowledgeLinkInput,
  Manuscript,
  ManuscriptBodyEncryptionInput,
  ManuscriptChapter,
  ManuscriptChapterVersion,
  ManuscriptChapterVersionSummary,
  ManuscriptEncryptionMetadata,
  ManagedAsset,
  NoteRecord,
  OrganizationFilters,
  PaginatedResult,
  PaginationParams,
  PartyOrganization,
  PublicUser,
  PrivateVaultPasswordMetadata,
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
import { fileTypeLabel, naturalCompare } from "../../shared/naturalSort";
import { MANUSCRIPT_CHAPTER_VERSION_RETENTION, PERSONAL_ARCHIVE_DOCUMENT_CATEGORIES } from "../../shared/types";
import { contactDisplayName } from "../../shared/format";
import { resolveDiscussionTitle } from "../../shared/discussionTitle";
import { extensionMatches, phoneNumbersMatch } from "../../shared/phoneNumbers";
import { DEFAULT_CASE_TYPE_TEMPLATES, caseTypeName, inferCaseTypeCode } from "../../shared/workflowTemplates";
import type {
  AppRepository,
  ArchiveFolderDeleteResult,
  CreateAssetDocumentLinkInput,
  CreateArchiveCategoryInput,
  CreateArchiveFolderInput,
  CreateAssetCredentialInput,
  CreateCaseInput,
  CreateCommunicationInput,
  CreateContactInput,
  CreateGmailExtensionTokenInput,
  CreateKnowledgeInput,
  CreateManuscriptChapterInput,
  CreateManuscriptInput,
  CreatePartyOrganizationInput,
  CreateDocumentInput,
  CreateManagedAssetInput,
  CreateNoteInput,
  CreatePrivateVaultFolderInput,
  CreatePrivateVaultInput,
  CreatePrivateVaultItemInput,
  CreateServiceDiscussionAssetLinkInput,
  CreateServiceDiscussionAttachmentInput,
  CreateServiceDiscussionMessageInput,
  CreateTaskInput,
  BackupSnapshot,
  CreateBackupItemInput,
  CreateBackupRunInput,
  UpdateBackupSettingsInput,
  UpdatePbxSettingsInput,
  UpdateAssetDocumentLinkInput,
  UpdateAssetCredentialInput,
  DatabaseTableExportPayload,
  CreateAuthSessionInput,
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

const SYSTEM_AUDIT_USER_EMAIL = "system@md3-platform.local";
type StoredAssetDocumentLink = Omit<AssetDocumentLink, "document">;

function nowIso(): string {
  return new Date().toISOString();
}

const DEFAULT_BACKUP_JOB_ID = "80000000-0000-4000-8000-000000000001";
const DEFAULT_PBX_SETTINGS_ID = "70000000-0000-4000-8000-000000000001";
const DEFAULT_TENANT_ID = "90000000-0000-4000-8000-000000000001";

function matchText(value: string, q: string): boolean {
  return value.toLowerCase().includes(q.toLowerCase());
}

function discussionSnippet(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "Service discussion note";
  return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
}

function normalizePagination(pagination: PaginationParams = {}): Required<PaginationParams> {
  const page = Math.max(1, Math.floor(Number(pagination.page ?? 1)) || 1);
  const pageSize = Math.min(100, Math.max(10, Math.floor(Number(pagination.pageSize ?? 25)) || 25));
  return { page, pageSize };
}

function paginateArray<T>(items: T[], pagination: PaginationParams = {}): PaginatedResult<T> {
  const { page, pageSize } = normalizePagination(pagination);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: currentPage,
    pageSize,
    total,
    totalPages,
    hasNextPage: currentPage < totalPages,
    hasPreviousPage: currentPage > 1
  };
}

function withoutCreatedAt(user: (typeof demoUsers)[number]): PublicUser {
  return {
    userId: user.userId,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    tenantId: DEFAULT_TENANT_ID,
    mustChangePassword: false
  };
}

function nextCaseNumber(cases: CaseRecord[]): string {
  const year = new Date().getUTCFullYear();
  const maxSequence = cases.reduce((max, item) => {
    const match = item.caseNumber.match(new RegExp(`^MD3-${year}-(\\d+)$`));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 1000);
  return `MD3-${year}-${maxSequence + 1}`;
}

function defaultBackupSettings(user?: PublicUser | null): BackupSettings {
  const now = nowIso();
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

function defaultPbxSettings(user?: PublicUser | null): PbxSettings {
  const now = nowIso();
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

function memoryExportTable(tableName: string, rows: unknown[]): DatabaseTableExportPayload["tables"][number] {
  const normalizedRows = structuredClone(rows) as Record<string, unknown>[];
  const firstRow = normalizedRows[0] ?? {};
  return {
    tableName,
    columns: Object.keys(firstRow).map((name) => ({ name, dataType: "json", isNullable: true })),
    rowCount: normalizedRows.length,
    rows: normalizedRows
  };
}

import { bookmarkForStorage, BookmarkConflictError, positionOnlyAnchor, type ManuscriptBookmark, type ManuscriptBookmarkInput } from "../../shared/manuscriptBookmarks";

export class DemoRepository implements AppRepository {
  private manuscriptBookmarks: ManuscriptBookmark[] = [];
  private users = structuredClone(demoUsers);
  private tags = structuredClone(demoTags);
  private cases = structuredClone(demoCases);
  private contacts = structuredClone(demoContacts);
  private partyOrganizations: PartyOrganization[] = [];
  private contactOrganizationAffiliations: Array<{ contactId: string; partyOrganizationId: string; isPrimary: boolean }> = [];
  private assets: ManagedAsset[] = [];
  private assetDocumentLinks: StoredAssetDocumentLink[] = [];
  private assetCredentials: StoredAssetCredential[] = [];
  private communications: CommunicationRecord[] = [];
  private gmailExtensionTokens: StoredGmailExtensionToken[] = [];
  private caseContacts = structuredClone(demoCaseContacts);
  private documents: DocumentRecord[] = structuredClone(demoDocuments).map((doc) => {
    const group = demoDocuments.filter((d) => d.documentGroupId === doc.documentGroupId);
    const origins = group.filter((d) => d.versionNumber === 1);
    const owner = origins.length === 1 && origins[0].documentId === doc.documentGroupId
      && group.every((d) => (d.caseId ?? null) === (origins[0].caseId ?? null))
      && demoUsers.some((u) => u.userId === origins[0].uploadedBy) ? origins[0].uploadedBy : null;
    return { ...doc, managementOwnerUserId: owner };
  });
  private archiveFolders: ArchiveFolder[] = [];
  private archiveCategories: ArchiveCategory[] = PERSONAL_ARCHIVE_DOCUMENT_CATEGORIES.map((name, index) => ({
    categoryId: crypto.randomUUID(),
    name,
    sortOrder: (index + 1) * 10,
    isSystem: true,
    fileCount: 0,
    createdBy: null,
    createdByName: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  }));
  private notes = structuredClone(demoNotes);
  private serviceDiscussionMessages: ServiceDiscussionMessage[] = [];
  private serviceDiscussionAssetLinks: ServiceDiscussionAssetLink[] = [];
  private serviceDiscussionMentions: ServiceDiscussionMention[] = [];
  private serviceDiscussionReads: Array<{ messageId: string; userId: string; readAt: string }> = [];
  private knowledgeItems: KnowledgeItem[] = [];
  private manuscripts: Manuscript[] = [];
  private manuscriptKeyOwnerClaims: Record<string, unknown>[] = [];
  private manuscriptChapters: Array<ManuscriptChapter & { deletedAt?: string | null; lastSavedBy?: string | null }> = [];
  private manuscriptChapterVersions: ManuscriptChapterVersion[] = [];
  private privateVaults: StoredPrivateVault[] = [];
  private privateVaultFolders: StoredPrivateVaultFolder[] = [];
  private privateVaultItems: StoredPrivateVaultItem[] = [];
  private tasks = structuredClone(demoTasks);
  private auditLogs = structuredClone(demoAuditLogs);
  private savedDirectoryViews: SavedDirectoryView[] = [];
  private backupSettings: BackupSettings = defaultBackupSettings(withoutCreatedAt(demoUsers[0]));
  private pbxSettings: PbxSettings = defaultPbxSettings(withoutCreatedAt(demoUsers[0]));
  private backupRuns: BackupRun[] = [];
  private backupItems: BackupItem[] = [];
  private credentials = new Map<string, UserCredential>();
  private authSessions = new Map<string, CreateAuthSessionInput & { revokedAt?: string | null; lastSeenAt?: string | null; archiveManagementVerifiedUntil?: string | null }>();
  private storageCleanupJobs = new Map<string, StorageCleanupJob>();
  private archiveManagementAudit: Record<string, unknown>[] = [];
  private archiveContentReferences: Array<{ contentKind: ArchiveContentKind; contentId: string; documentId: string; ownerUserId: string | null; createdAt: string }> = [];
  private archiveMutationTail: Promise<void> = Promise.resolve();

  async runArchiveMutation<T>(access: ArchiveAccess, operation: (repo: AppRepository) => Promise<T>): Promise<T> {
    const previous = this.archiveMutationTail;
    let release!: () => void;
    this.archiveMutationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const initialSession = requireArchiveSession(await this.getArchiveManagementSession(access), access);
      const wasVerified = initialSession.verifiedUntil && Date.parse(initialSession.verifiedUntil) > Date.now();
      // Copy only this boundary's writable state. Other memory operations may
      // continue, but conflicting writes/read-dependencies cause rollback.
      const keys = ["documents", "archiveFolders", "archiveCategories", "assetDocumentLinks",
        "serviceDiscussionMessages", "serviceDiscussionAssetLinks", "serviceDiscussionMentions",
        "storageCleanupJobs", "archiveManagementAudit", "archiveContentReferences", "knowledgeItems",
        "manuscripts", "manuscriptChapters", "manuscriptChapterVersions"] as const;
      const reads = [...keys, "assets", "users", "tags"] as const;
      const fingerprint = (key: typeof reads[number]) => JSON.stringify(this[key] instanceof Map ? [...this[key] as Map<string, unknown>] : this[key]);
      const before = reads.map(fingerprint);
      const transaction: DemoRepository = Object.assign(Object.create(Object.getPrototypeOf(this)), this);
      for (const key of reads) Reflect.set(transaction, key, structuredClone(this[key]));
      const result = await operation(transaction);
      const current = requireArchiveSession(await this.getArchiveManagementSession(access), access);
      if (current.user.role !== initialSession.user.role || current.verifiedUntil !== initialSession.verifiedUntil
        || (wasVerified && Date.parse(initialSession.verifiedUntil!) <= Date.now())
        || reads.some((key, index) => fingerprint(key) !== before[index])) {
        throw new HTTPException(409, { message: "Archive state changed during this operation. Try again." });
      }
      for (const key of keys) Reflect.set(this, key, transaction[key]);
      return result;
    } finally { release(); }
  }

  async getArchiveManagementSession(access: ArchiveAccess): Promise<ArchiveManagementSession | null> {
    const session = this.authSessions.get(access.sessionTokenHash);
    const user = this.users.find((u) => u.userId === access.userId);
    if (!session || !user || session.userId !== access.userId || session.revokedAt || Date.parse(session.expiresAt) <= Date.now()) return null;
    return { user: { ...withoutCreatedAt(user), mustChangePassword: this.credentials.get(user.userId)?.mustChangePassword ?? false },
      verifiedUntil: session.archiveManagementVerifiedUntil ?? null };
  }

  async setArchiveManagementVerification(access: ArchiveAccess, expectedPasswordHash: string | null): Promise<string | null> {
    const user = this.users.find((u) => u.userId === access.userId);
    const session = this.authSessions.get(access.sessionTokenHash);
    const credential = this.credentials.get(access.userId);
    if (!session || session.userId !== access.userId || session.revokedAt || Date.parse(session.expiresAt) <= Date.now()
      || user?.role !== "Admin" || credential?.mustChangePassword
      || (expectedPasswordHash !== null && credential?.passwordHash !== expectedPasswordHash)) return null;
    const until = expectedPasswordHash === null ? null : new Date(Math.min(Date.now() + ARCHIVE_MANAGEMENT_TTL_MS, Date.parse(session.expiresAt))).toISOString();
    this.authSessions.set(access.sessionTokenHash, { ...session, archiveManagementVerifiedUntil: until });
    return until;
  }

  async readArchiveManagementState(documentId?: string, folderId?: string): Promise<ArchiveManagementState> {
    const source = this.documents.find((d) => d.documentId === documentId);
    const root = this.archiveFolders.find((f) => f.folderId === folderId);
    const ids = new Set(folderId ? [folderId] : []);
    for (let size = -1; size !== ids.size;) {
      size = ids.size;
      for (const f of this.archiveFolders) if (f.parentFolderId && ids.has(f.parentFolderId)) ids.add(f.folderId);
    }
    const groups = new Set(this.documents.filter((d) => (source && d.documentGroupId === source.documentGroupId)
      || (d.folderId && ids.has(d.folderId)) || (root?.deletionBatchId && d.folderDeletionBatchId === root.deletionBatchId)).map((d) => d.documentGroupId));
    const documents = this.documents.filter((d) => groups.has(d.documentGroupId));
    const documentIds = new Set(documents.map((d) => d.documentId));
    const references: ArchiveManagementState["references"] = [];
    const validOwner = (owner?: string | null) => this.users.some((u) => u.userId === owner) ? owner! : null;
    for (const message of this.serviceDiscussionMessages) for (const link of message.attachments) {
      if (documentIds.has(link.documentId)) references.push({ documentId: link.documentId, kind: "discussion", id: message.messageId, ownerUserId: message.managementOwnerUserId ?? null });
    }
    for (const link of this.assetDocumentLinks) if (documentIds.has(link.documentId)) {
      references.push({ documentId: link.documentId, kind: "asset", id: link.assetId, ownerUserId: validOwner(this.assets.find((a) => a.assetId === link.assetId)?.createdBy) });
    }
    for (const item of this.knowledgeItems) for (const link of item.links) if (link.entityType === "document" && documentIds.has(link.entityId)) {
      references.push({ documentId: link.entityId, kind: "knowledge", id: item.knowledgeId, ownerUserId: item.managementOwnerUserId ?? null });
    }
    for (const ref of this.archiveContentReferences) if (documentIds.has(ref.documentId)) {
      references.push({ documentId: ref.documentId, kind: ref.contentKind, id: ref.contentId, ownerUserId: ref.ownerUserId });
    }
    return { folders: folderId ? structuredClone(this.archiveFolders) : [], documents: structuredClone(documents), references };
  }

  async readArchiveContentTargets(kind: ArchiveContentKind, id: string, wholeThread = false): Promise<ArchiveManagementTarget[]> {
    if (kind === "discussion") {
      const source = this.serviceDiscussionMessages.find((m) => m.messageId === id);
      const rootId = source?.parentMessageId ?? id;
      return this.serviceDiscussionMessages.filter((m) => m.messageId === id || (wholeThread && !m.deletedAt && (m.messageId === rootId || m.parentMessageId === rootId)))
        .map((m) => ({ kind, id: m.messageId, ownerUserId: m.managementOwnerUserId ?? null }));
    }
    const source = kind === "knowledge" ? this.knowledgeItems.find((m) => m.knowledgeId === id) : this.manuscripts.find((m) => m.manuscriptId === id);
    return source ? [{ kind, id, ownerUserId: source.managementOwnerUserId ?? null }] : [];
  }

  async readArchiveContentDocumentIds(kind: ArchiveContentKind, id: string): Promise<string[]> {
    return this.archiveContentReferences.filter((r) => r.contentKind === kind && r.contentId === id).map((r) => r.documentId);
  }

  async retainArchiveContentDocuments(kind: ArchiveContentKind, id: string, documentIds: string[]): Promise<void> {
    const [target] = await this.readArchiveContentTargets(kind, id);
    if (!target) throw new Error("Archive content not found");
    for (const documentId of new Set(documentIds)) {
      if (this.documents.some((d) => d.documentId === documentId) && !this.archiveContentReferences.some((r) => r.contentKind === kind && r.contentId === id && r.documentId === documentId)) {
        this.archiveContentReferences.push({ contentKind: kind, contentId: id, documentId, ownerUserId: target.ownerUserId, createdAt: nowIso() });
      }
    }
  }

  async hasOpaqueArchiveContent(): Promise<boolean> {
    return this.manuscripts.some((m) => m.encryptionEnabled)
      || this.manuscriptChapters.some((c) => c.body.startsWith("pae1."))
      || this.manuscriptChapterVersions.some((c) => c.body.startsWith("pae1."));
  }

  async createManuscriptDocument(manuscriptId: string, input: CreateDocumentInput): Promise<DocumentRecord> {
    if (!(await this.getManuscript(manuscriptId))) throw new Error("Manuscript not found");
    const document = await this.createDocument(input);
    await this.retainArchiveContentDocuments("manuscript", manuscriptId, [document.documentId]);
    return document;
  }

  async recordArchiveManagementAudit(actorUserId: string, action: string, targets: ArchiveManagementTarget[]): Promise<void> {
    this.archiveManagementAudit.push(...targets.map((target) => ({
      auditId: crypto.randomUUID(), actorUserId, action, resourceKind: target.kind, resourceId: target.id,
      ownerUserId: target.ownerUserId, createdAt: nowIso()
    })));
  }

  async healthCheck(): Promise<void> {}

  async getDatabaseSizeBytes(): Promise<number | null> {
    return null;
  }

  async getUserByEmail(email: string): Promise<PublicUser | null> {
    const user = this.users.find((item) => item.email.toLowerCase() === email.toLowerCase());
    return user ? withoutCreatedAt(user) : null;
  }

  async getUserById(userId: string): Promise<PublicUser | null> {
    const user = this.users.find((item) => item.userId === userId);
    return user ? withoutCreatedAt(user) : null;
  }

  async listUsers(): Promise<PublicUser[]> {
    return this.users.filter((user) => user.email.toLowerCase() !== SYSTEM_AUDIT_USER_EMAIL).map(withoutCreatedAt);
  }

  async getUserCredential(userId: string): Promise<UserCredential | null> {
    return this.credentials.get(userId) ?? null;
  }

  async updateUserPassword(userId: string, credential: UserCredential, options: UpdateUserPasswordOptions = {}): Promise<PublicUser | null> {
    const user = this.users.find((item) => item.userId === userId);
    if (!user) return null;
    if (options.expectedPasswordHash !== undefined
      && (this.credentials.get(userId)?.passwordHash ?? null) !== options.expectedPasswordHash) return null;
    if (options.replacementSession && options.replacementSession.userId !== userId) {
      throw new Error("Replacement session must belong to the updated user.");
    }
    if (options.replacementSession && this.authSessions.has(options.replacementSession.tokenHash)) {
      throw new Error("Session token hash must be unique.");
    }
    this.credentials.set(userId, credential);
    for (const [tokenHash, session] of this.authSessions) {
      if (session.userId === userId) this.authSessions.set(tokenHash, { ...session, revokedAt: nowIso() });
    }
    if (options.replacementSession) this.authSessions.set(options.replacementSession.tokenHash, options.replacementSession);
    return { ...withoutCreatedAt(user), mustChangePassword: credential.mustChangePassword };
  }

  async getDefaultTenantForUser(): Promise<string | null> {
    return DEFAULT_TENANT_ID;
  }

  async createAuthSession(input: CreateAuthSessionInput, expectedPasswordHash?: string | null): Promise<boolean> {
    if (!this.users.some((user) => user.userId === input.userId)) return false;
    if (expectedPasswordHash !== undefined
      && (this.credentials.get(input.userId)?.passwordHash ?? null) !== expectedPasswordHash) return false;
    if (this.authSessions.has(input.tokenHash)) throw new Error("Session token hash must be unique.");
    const retentionCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const [tokenHash, session] of this.authSessions) {
      if (new Date(session.expiresAt).getTime() < retentionCutoff) this.authSessions.delete(tokenHash);
    }
    this.authSessions.set(input.tokenHash, input);
    return true;
  }

  async getUserBySessionTokenHash(tokenHash: string, refreshExpiresAt?: string): Promise<PublicUser | null> {
    const session = this.authSessions.get(tokenHash);
    if (!session || session.revokedAt || new Date(session.expiresAt).getTime() < Date.now()) return null;
    const lastSeenAt = session.lastSeenAt ? new Date(session.lastSeenAt).getTime() : 0;
    if (refreshExpiresAt && (!lastSeenAt || Date.now() - lastSeenAt >= 10 * 60 * 1000)) {
      this.authSessions.set(tokenHash, { ...session, expiresAt: refreshExpiresAt, lastSeenAt: nowIso() });
    }
    const user = await this.getUserById(session.userId);
    if (!user) return null;
    const credential = await this.getUserCredential(user.userId);
    return {
      ...user,
      tenantId: session.currentTenantId ?? user.tenantId ?? DEFAULT_TENANT_ID,
      mustChangePassword: credential?.mustChangePassword ?? false
    };
  }

  async revokeAuthSession(tokenHash: string): Promise<void> {
    const session = this.authSessions.get(tokenHash);
    if (session) this.authSessions.set(tokenHash, { ...session, revokedAt: nowIso() });
  }

  private publicGmailExtensionToken(token: StoredGmailExtensionToken): GmailExtensionToken {
    const owner = this.users.find((user) => user.userId === token.ownerUserId);
    const creator = token.createdBy ? this.users.find((user) => user.userId === token.createdBy) : null;
    return {
      tokenId: token.tokenId,
      name: token.name,
      scopes: token.scopes,
      ownerUserId: token.ownerUserId,
      ownerUserName: owner?.name ?? "Unknown user",
      createdBy: token.createdBy ?? null,
      createdByName: creator?.name ?? null,
      createdAt: token.createdAt,
      lastUsedAt: token.lastUsedAt ?? null,
      revokedAt: token.revokedAt ?? null
    };
  }

  async listGmailExtensionTokens(): Promise<GmailExtensionToken[]> {
    return this.gmailExtensionTokens.map((token) => this.publicGmailExtensionToken(token)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getGmailExtensionTokenByHash(tokenHash: string): Promise<StoredGmailExtensionToken | null> {
    return this.gmailExtensionTokens.find((token) => token.tokenHash === tokenHash && !token.revokedAt) ?? null;
  }

  async createGmailExtensionToken(input: CreateGmailExtensionTokenInput): Promise<GmailExtensionToken> {
    const record: StoredGmailExtensionToken = {
      tokenId: crypto.randomUUID(),
      name: input.name,
      tokenHash: input.tokenHash,
      scopes: input.scopes,
      ownerUserId: input.ownerUserId,
      ownerUserName: "",
      createdBy: input.createdBy ?? null,
      createdByName: null,
      createdAt: nowIso(),
      lastUsedAt: null,
      revokedAt: null
    };
    this.gmailExtensionTokens.unshift(record);
    return this.publicGmailExtensionToken(record);
  }

  async markGmailExtensionTokenUsed(tokenId: string): Promise<void> {
    const index = this.gmailExtensionTokens.findIndex((token) => token.tokenId === tokenId);
    if (index >= 0) {
      this.gmailExtensionTokens[index] = { ...this.gmailExtensionTokens[index], lastUsedAt: nowIso() };
    }
  }

  async revokeGmailExtensionToken(tokenId: string): Promise<GmailExtensionToken | null> {
    const index = this.gmailExtensionTokens.findIndex((token) => token.tokenId === tokenId);
    if (index < 0) return null;
    this.gmailExtensionTokens[index] = { ...this.gmailExtensionTokens[index], revokedAt: nowIso() };
    return this.publicGmailExtensionToken(this.gmailExtensionTokens[index]);
  }

  private enrichPartyOrganization(organization: PartyOrganization): PartyOrganization {
    const contactIds = new Set(
      this.contactOrganizationAffiliations
        .filter((item) => item.partyOrganizationId === organization.partyOrganizationId)
        .map((item) => item.contactId)
    );
    const contactCount = this.contacts.filter((contact) => contactIds.has(contact.contactId)).length;
    const directCaseIds = this.cases
      .filter((caseRecord) => caseRecord.customerOrganizationId === organization.partyOrganizationId && !caseRecord.deletedAt)
      .map((caseRecord) => caseRecord.caseId);
    const participantCaseIds = this.caseContacts
      .filter((item) => contactIds.has(item.contactId))
      .map((item) => item.caseId);
    const relatedCaseIds = new Set([...directCaseIds, ...participantCaseIds]);
    const relatedCases = this.cases.filter((caseRecord) => relatedCaseIds.has(caseRecord.caseId) && !caseRecord.deletedAt);
    const assetRows = this.assets.filter((asset) => asset.partyOrganizationId === organization.partyOrganizationId && !asset.deletedAt);
    const communicationRows = this.communications.filter(
      (communication) => communication.partyOrganizationId === organization.partyOrganizationId && !communication.deletedAt
    );
    const lastCommunicationAt = communicationRows
      .slice()
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0]?.occurredAt;
    return {
      ...organization,
      contactCount,
      relatedServiceCount: relatedCases.length,
      openServiceCount: relatedCases.filter((item) => item.status !== "Closed" && item.status !== "Cancelled").length,
      assetCount: assetRows.length,
      communicationCount: communicationRows.length,
      needsFollowUpCommunicationCount: communicationRows.filter((item) => item.status === "Needs follow-up").length,
      lastCommunicationAt: lastCommunicationAt ?? null
    };
  }

  private enrichContact(contact: Contact): Contact {
    const affiliation = this.contactOrganizationAffiliations.find((item) => item.contactId === contact.contactId && item.isPrimary);
    const organization = affiliation
      ? this.partyOrganizations.find((item) => item.partyOrganizationId === affiliation.partyOrganizationId)
      : null;
    const relatedCaseIds = new Set(this.caseContacts.filter((item) => item.contactId === contact.contactId).map((item) => item.caseId));
    const relatedCases = this.cases.filter((item) => relatedCaseIds.has(item.caseId) && !item.deletedAt);
    const communicationRows = this.communications.filter((item) => item.contactId === contact.contactId && !item.deletedAt);
    const lastCommunicationAt = communicationRows
      .slice()
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0]?.occurredAt;
    return {
      ...contact,
      partyOrganizationId: organization?.partyOrganizationId ?? null,
      partyOrganizationName: organization?.name ?? null,
      relatedServiceCount: relatedCases.length,
      openServiceCount: relatedCases.filter((item) => item.status !== "Closed" && item.status !== "Cancelled").length,
      communicationCount: communicationRows.length,
      needsFollowUpCommunicationCount: communicationRows.filter((item) => item.status === "Needs follow-up").length,
      lastCommunicationAt: lastCommunicationAt ?? null
    };
  }

  private enrichAsset(asset: ManagedAsset): ManagedAsset {
    const organization = asset.partyOrganizationId
      ? this.partyOrganizations.find((item) => item.partyOrganizationId === asset.partyOrganizationId)
      : null;
    const caseRecord = asset.caseId ? this.cases.find((item) => item.caseId === asset.caseId) : null;
    const parentAsset = asset.parentAssetId ? this.assets.find((item) => item.assetId === asset.parentAssetId) : null;
    const coreDocumentCount = this.assetDocumentLinks.filter(
      (link) =>
        link.assetId === asset.assetId &&
        !link.deletedAt &&
        this.documents.some(
          (document) => document.documentId === link.documentId && !document.deletedAt && document.isCurrentVersion !== false
        )
    ).length;
    return {
      ...asset,
      partyOrganizationName: organization?.name ?? null,
      caseNumber: caseRecord?.caseNumber ?? null,
      caseTitle: caseRecord?.propertyAddress ?? null,
      parentAssetName: parentAsset?.name ?? null,
      credentialCount: this.assetCredentials.filter((item) => item.assetId === asset.assetId && !item.deletedAt).length,
      childAssetCount: this.assets.filter((item) => item.parentAssetId === asset.assetId && !item.deletedAt).length,
      coreDocumentCount
    };
  }

  private enrichDocument(document: DocumentRecord): DocumentRecord {
    const caseRecord = document.caseId ? this.cases.find((item) => item.caseId === document.caseId) : null;
    const folder = document.folderId ? this.archiveFolders.find((item) => item.folderId === document.folderId) : null;
    return {
      ...document,
      folderName: folder?.name ?? null,
      caseNumber: caseRecord?.caseNumber,
      caseTitle: caseRecord?.propertyAddress,
      partyOrganizationId: caseRecord?.customerOrganizationId ?? null,
      partyOrganizationName: caseRecord?.customerOrganizationName ?? null
    };
  }

  private enrichAssetDocumentLink(link: StoredAssetDocumentLink): AssetDocumentLink | null {
    const document = this.documents.find(
      (item) => item.documentId === link.documentId && !item.deletedAt && item.isCurrentVersion !== false
    );
    if (!document) return null;
    return {
      ...link,
      document: this.enrichDocument(document)
    };
  }

  private enrichCredential(credential: StoredAssetCredential): StoredAssetCredential {
    const asset = this.assets.find((item) => item.assetId === credential.assetId);
    const organization = asset?.partyOrganizationId
      ? this.partyOrganizations.find((item) => item.partyOrganizationId === asset.partyOrganizationId)
      : null;
    const caseRecord = asset?.caseId ? this.cases.find((item) => item.caseId === asset.caseId) : null;
    return {
      ...credential,
      partyOrganizationId: asset?.partyOrganizationId ?? null,
      partyOrganizationName: organization?.name ?? null,
      caseId: asset?.caseId ?? null,
      caseNumber: caseRecord?.caseNumber ?? null
    };
  }

  async getDashboardStats(): Promise<DashboardStats> {
    const activeCases = await this.listCases();
    const casesByStatus = [...new Set(activeCases.map((item) => item.status))].map((status) => ({
      status,
      count: activeCases.filter((item) => item.status === status).length
    }));
    const recentlyUpdatedCases = [...activeCases]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 5);
    const recentUploads = await this.listRecentDocuments(5);
    const today = new Date().toISOString().slice(0, 10);
    const dueSoonEndDate = new Date(`${today}T00:00:00.000Z`);
    dueSoonEndDate.setUTCDate(dueSoonEndDate.getUTCDate() + 7);
    const upcomingEndDate = new Date(`${today}T00:00:00.000Z`);
    upcomingEndDate.setUTCDate(upcomingEndDate.getUTCDate() + 14);
    const dueSoonEnd = dueSoonEndDate.toISOString().slice(0, 10);
    const upcomingEnd = upcomingEndDate.toISOString().slice(0, 10);
    const priorityRank: Record<TaskRecord["priority"], number> = { Urgent: 0, High: 1, Normal: 2, Low: 3 };
    const openTasks = this.tasks
      .filter((task) => task.status !== "Done" && activeCases.some((caseRecord) => caseRecord.caseId === task.caseId))
      .map((task) => {
        const caseRecord = activeCases.find((item) => item.caseId === task.caseId);
        return { ...task, caseNumber: caseRecord?.caseNumber, caseTitle: caseRecord?.propertyAddress };
      });
    const sortTasks = (items: TaskRecord[]) =>
      [...items].sort(
        (a, b) =>
          a.dueDate.localeCompare(b.dueDate) ||
          (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9) ||
          a.title.localeCompare(b.title)
      );
    return {
      totalCases: activeCases.length,
      activeCases: activeCases.filter((item) => item.status === "Active").length,
      closingSoon: activeCases.filter((item) => item.status === "Closing Soon").length,
      pendingCases: activeCases.filter((item) => item.status === "Pending").length,
      recentlyUpdatedCases,
      recentUploads,
      casesByStatus,
      workQueue: {
        upcomingCases: activeCases
          .filter(
            (item) =>
              item.status !== "Closed" &&
              item.status !== "Cancelled" &&
              item.closingDate >= today &&
              item.closingDate <= upcomingEnd
          )
          .slice(0, 8),
        overdueTasks: sortTasks(openTasks.filter((task) => task.dueDate < today)).slice(0, 8),
        dueSoonTasks: sortTasks(openTasks.filter((task) => task.dueDate >= today && task.dueDate <= dueSoonEnd)).slice(0, 8),
        blockedTasks: sortTasks(openTasks.filter((task) => task.status === "Blocked")).slice(0, 8)
      }
    };
  }

  async listCases(filters: CaseFilters = {}): Promise<CaseRecord[]> {
    const direction = filters.direction === "asc" ? 1 : -1;
    const sorted = this.cases.filter((caseRecord) => {
      const archiveStatus = filters.archiveStatus ?? "active";
      if (archiveStatus === "active" && caseRecord.deletedAt) return false;
      if (archiveStatus === "archived" && !caseRecord.deletedAt) return false;
      if (filters.status && caseRecord.status !== filters.status) return false;
      if (filters.caseTypeCode && caseRecord.caseTypeCode !== filters.caseTypeCode) return false;
      if (filters.customerOrganizationId && caseRecord.customerOrganizationId !== filters.customerOrganizationId) return false;
      if (filters.assetId && !this.assets.some((asset) => asset.assetId === filters.assetId && asset.caseId === caseRecord.caseId)) return false;
      if (
        filters.assignedTo &&
        !this.tasks.some((task) => task.caseId === caseRecord.caseId && task.assignedTo === filters.assignedTo && task.status !== "Done")
      ) {
        return false;
      }
      if (filters.tag && !caseRecord.tags.some((tag) => tag.name === filters.tag || tag.tagId === filters.tag)) return false;
      if (filters.closingFrom && caseRecord.closingDate < filters.closingFrom) return false;
      if (filters.closingTo && caseRecord.closingDate > filters.closingTo) return false;
      if (filters.contactRole) {
        const hasRole = this.caseContacts.some((item) => item.caseId === caseRecord.caseId && item.role === filters.contactRole);
        if (!hasRole) return false;
      }
      if (filters.q) {
        const relatedContacts = this.caseContacts
          .filter((item) => item.caseId === caseRecord.caseId)
          .map((item) => item.contact)
          .map((contact) => `${contactDisplayName(contact)} ${contact.firstName} ${contact.lastName} ${contact.jobTitle} ${contact.partyOrganizationName ?? ""}`);
        const haystack = [
          caseRecord.caseNumber,
          caseRecord.propertyAddress,
          caseRecord.customerOrganizationName,
          caseRecord.city,
          caseRecord.notes,
          ...caseRecord.tags.map((tag) => tag.name),
          ...relatedContacts
        ].join(" ");
        return matchText(haystack, filters.q);
      }
      return true;
    });
    return sorted.sort((a, b) => {
      const sort = filters.sort ?? "updated";
      let result = 0;
      if (sort === "number") result = a.caseNumber.localeCompare(b.caseNumber);
      else if (sort === "title") result = a.propertyAddress.localeCompare(b.propertyAddress);
      else if (sort === "status") result = a.status.localeCompare(b.status);
      else if (sort === "targetDate") result = a.closingDate.localeCompare(b.closingDate);
      else if (sort === "customer") result = (a.customerOrganizationName ?? "").localeCompare(b.customerOrganizationName ?? "");
      else if (sort === "type") result = a.caseTypeName.localeCompare(b.caseTypeName);
      else result = a.updatedAt.localeCompare(b.updatedAt);
      return (result || b.updatedAt.localeCompare(a.updatedAt)) * direction;
    });
  }

  async listCasesPage(filters: CaseFilters = {}, pagination: PaginationParams = {}): Promise<PaginatedResult<CaseRecord>> {
    return paginateArray(await this.listCases(filters), pagination);
  }

  async getCase(caseId: string, options: { includeArchived?: boolean } = {}): Promise<CaseRecord | null> {
    const record = this.cases.find((item) => item.caseId === caseId) ?? null;
    if (!record) return null;
    if (record.deletedAt && !options.includeArchived) return null;
    return record;
  }

  async listCaseTypeTemplates(): Promise<CaseTypeTemplate[]> {
    return DEFAULT_CASE_TYPE_TEMPLATES;
  }

  async getCaseTypeTemplate(code: string): Promise<CaseTypeTemplate | null> {
    return DEFAULT_CASE_TYPE_TEMPLATES.find((template) => template.code === code) ?? null;
  }

  async previewNextCaseNumber(): Promise<string> {
    return nextCaseNumber(this.cases);
  }

  async createCase(input: CreateCaseInput): Promise<CaseRecord> {
    const tagSet = input.tagIds ? this.tags.filter((tag) => input.tagIds?.includes(tag.tagId)) : [];
    const caseTypeCode = input.caseTypeCode || inferCaseTypeCode(input.propertyType, tagSet);
    const customerOrganization = input.customerOrganizationId
      ? this.partyOrganizations.find((item) => item.partyOrganizationId === input.customerOrganizationId)
      : null;
    const record: CaseRecord = {
      ...input,
      customerOrganizationId: input.customerOrganizationId ?? null,
      customerOrganizationName: customerOrganization?.name ?? null,
      caseId: crypto.randomUUID(),
      caseNumber: input.caseNumber?.trim() || nextCaseNumber(this.cases),
      caseTypeCode,
      caseTypeName: caseTypeName(caseTypeCode),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      tags: tagSet
    };
    this.cases.unshift(record);
    return record;
  }

  async updateCase(caseId: string, input: Partial<CreateCaseInput>): Promise<CaseRecord | null> {
    const index = this.cases.findIndex((item) => item.caseId === caseId);
    if (index === -1) return null;
    const tagSet = input.tagIds ? this.tags.filter((tag) => input.tagIds?.includes(tag.tagId)) : this.cases[index].tags;
    const caseTypeCode = input.caseTypeCode ?? this.cases[index].caseTypeCode;
    const customerOrganizationId =
      input.customerOrganizationId === undefined ? this.cases[index].customerOrganizationId : input.customerOrganizationId;
    const customerOrganization = customerOrganizationId
      ? this.partyOrganizations.find((item) => item.partyOrganizationId === customerOrganizationId)
      : null;
    this.cases[index] = {
      ...this.cases[index],
      ...input,
      customerOrganizationId: customerOrganizationId ?? null,
      customerOrganizationName: customerOrganization?.name ?? null,
      caseTypeCode,
      caseTypeName: caseTypeName(caseTypeCode),
      tags: tagSet,
      updatedAt: nowIso()
    };
    return this.cases[index];
  }

  async softDeleteCase(caseId: string): Promise<CaseRecord | null> {
    const index = this.cases.findIndex((item) => item.caseId === caseId && !item.deletedAt);
    const record = index === -1 ? null : this.cases[index];
    if (!record) return null;
    this.cases[index] = { ...record, deletedAt: nowIso(), updatedAt: nowIso() };
    return this.cases[index];
  }

  async restoreCase(caseId: string): Promise<CaseRecord | null> {
    const index = this.cases.findIndex((item) => item.caseId === caseId && item.deletedAt);
    if (index === -1) return null;
    this.cases[index] = { ...this.cases[index], deletedAt: null, updatedAt: nowIso() };
    return this.cases[index];
  }

  async listPartyOrganizations(input: OrganizationFilters | string = {}): Promise<PartyOrganization[]> {
    const filters: OrganizationFilters = typeof input === "string" ? { q: input } : input;
    const q = filters.q?.trim() ?? "";
    const qDigits = q.replace(/\D+/g, "");
    return this.partyOrganizations
      .map((organization) => this.enrichPartyOrganization(organization))
      .filter((organization) => {
        if (filters.email === "has" && !organization.email.trim()) return false;
        if (filters.email === "missing" && organization.email.trim()) return false;
        if (filters.phone === "has" && !organization.phone.trim()) return false;
        if (filters.phone === "missing" && organization.phone.trim()) return false;
        if (filters.website === "has" && !organization.website.trim()) return false;
        if (filters.website === "missing" && organization.website.trim()) return false;
        if (filters.contacts === "has" && !(organization.contactCount ?? 0)) return false;
        if (filters.contacts === "none" && (organization.contactCount ?? 0) > 0) return false;
        if (filters.services === "has" && !(organization.relatedServiceCount ?? 0)) return false;
        if (filters.services === "open" && !(organization.openServiceCount ?? 0)) return false;
        if (filters.services === "none" && (organization.relatedServiceCount ?? 0) > 0) return false;
        if (filters.assets === "has" && !(organization.assetCount ?? 0)) return false;
        if (filters.assets === "none" && (organization.assetCount ?? 0) > 0) return false;
        if (filters.communications === "has" && !(organization.communicationCount ?? 0)) return false;
        if (filters.communications === "needs-follow-up" && !(organization.needsFollowUpCommunicationCount ?? 0)) return false;
        if (filters.communications === "none" && (organization.communicationCount ?? 0) > 0) return false;
        if (!q) return true;
        const haystack = [
          organization.name,
          organization.type,
          organization.taxIdValue,
          organization.email,
          organization.phone,
          organization.fax,
          organization.website,
          organization.addressLine1,
          organization.addressLine2,
          organization.city,
          organization.state,
          organization.zipCode,
          organization.country,
          organization.notes
        ].join(" ");
        if (matchText(haystack, q)) return true;
        return qDigits.length > 0 && organization.phone.replace(/\D+/g, "").includes(qDigits);
      })
      .sort((a, b) => {
        const direction = filters.direction === "asc" ? 1 : -1;
        if (filters.sort === "name") return direction * a.name.localeCompare(b.name);
        if (filters.sort === "location") {
          const left = [a.city, a.state, a.country].filter(Boolean).join(" ");
          const right = [b.city, b.state, b.country].filter(Boolean).join(" ");
          return direction * left.localeCompare(right);
        }
        if (filters.sort === "lastCommunication") {
          return direction * (a.lastCommunicationAt ?? "").localeCompare(b.lastCommunicationAt ?? "");
        }
        return direction * a.updatedAt.localeCompare(b.updatedAt);
      });
  }

  async listPartyOrganizationsPage(
    input: OrganizationFilters | string = {},
    pagination: PaginationParams = {}
  ): Promise<PaginatedResult<PartyOrganization>> {
    return paginateArray(await this.listPartyOrganizations(input), pagination);
  }

  async getPartyOrganization(partyOrganizationId: string): Promise<PartyOrganization | null> {
    const organization = this.partyOrganizations.find((item) => item.partyOrganizationId === partyOrganizationId) ?? null;
    return organization ? this.enrichPartyOrganization(organization) : null;
  }

  async createPartyOrganization(input: CreatePartyOrganizationInput): Promise<PartyOrganization> {
    const now = nowIso();
    const record: PartyOrganization = {
      partyOrganizationId: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      ...input
    };
    this.partyOrganizations.unshift(record);
    return this.enrichPartyOrganization(record);
  }

  async updatePartyOrganization(
    partyOrganizationId: string,
    input: Partial<CreatePartyOrganizationInput>
  ): Promise<PartyOrganization | null> {
    const index = this.partyOrganizations.findIndex((item) => item.partyOrganizationId === partyOrganizationId);
    if (index === -1) return null;
    this.partyOrganizations[index] = { ...this.partyOrganizations[index], ...input, updatedAt: nowIso() };
    return this.enrichPartyOrganization(this.partyOrganizations[index]);
  }

  async softDeletePartyOrganization(partyOrganizationId: string): Promise<PartyOrganization | null> {
    const index = this.partyOrganizations.findIndex((item) => item.partyOrganizationId === partyOrganizationId);
    if (index === -1) return null;
    const [deleted] = this.partyOrganizations.splice(index, 1);
    this.contactOrganizationAffiliations = this.contactOrganizationAffiliations.filter(
      (item) => item.partyOrganizationId !== partyOrganizationId
    );
    return deleted;
  }

  async listPartyOrganizationContacts(partyOrganizationId: string): Promise<Contact[]> {
    const contactIds = new Set(
      this.contactOrganizationAffiliations
        .filter((item) => item.partyOrganizationId === partyOrganizationId)
        .map((item) => item.contactId)
    );
    return this.contacts
      .filter((contact) => contactIds.has(contact.contactId))
      .map((contact) => this.enrichContact(contact))
      .sort((a, b) => contactDisplayName(a).localeCompare(contactDisplayName(b)));
  }

  async listPartyOrganizationCases(partyOrganizationId: string): Promise<CaseContact[]> {
    const contacts = await this.listPartyOrganizationContacts(partyOrganizationId);
    const contactIds = new Set(contacts.map((contact) => contact.contactId));
    return this.caseContacts
      .filter((item) => contactIds.has(item.contactId))
      .map((item) => ({
        ...item,
        contact: contacts.find((contact) => contact.contactId === item.contactId) ?? item.contact,
        case: this.cases.find((caseRecord) => caseRecord.caseId === item.caseId)
      }))
      .filter((item) => !item.case?.deletedAt)
      .sort((a, b) => (b.case?.updatedAt ?? "").localeCompare(a.case?.updatedAt ?? ""));
  }

  async listAssets(filters: AssetFilters = {}): Promise<ManagedAsset[]> {
    return filterAssets(
      this.assets
      .filter((asset) => !asset.deletedAt)
      .map((asset) => this.enrichAsset(asset)),
      filters
    );
  }

  async listAssetsPage(filters: AssetFilters = {}, pagination: PaginationParams = {}): Promise<PaginatedResult<ManagedAsset>> {
    return paginateArray(await this.listAssets(filters), pagination);
  }

  async getAsset(assetId: string): Promise<ManagedAsset | null> {
    const asset = this.assets.find((item) => item.assetId === assetId && !item.deletedAt);
    return asset ? this.enrichAsset(asset) : null;
  }

  async createAsset(input: CreateManagedAssetInput): Promise<ManagedAsset> {
    const now = nowIso();
    const record: ManagedAsset = {
      createdBy: input.createdBy ?? null,
      assetId: crypto.randomUUID(),
      partyOrganizationId: input.partyOrganizationId ?? null,
      partyOrganizationName: null,
      caseId: input.caseId ?? null,
      caseNumber: null,
      caseTitle: null,
      parentAssetId: input.parentAssetId ?? null,
      parentAssetName: null,
      name: input.name,
      assetType: input.assetType,
      status: input.status,
      manufacturer: input.manufacturer,
      model: input.model,
      serialNumber: input.serialNumber,
      macAddress: input.macAddress,
      imei: input.imei,
      iccid: input.iccid,
      phoneNumber: input.phoneNumber,
      extension: input.extension,
      hostname: input.hostname,
      lanIp: input.lanIp,
      wanIp: input.wanIp,
      installedLocation: input.installedLocation,
      installedAt: input.installedAt || null,
      lastServiceAt: input.lastServiceAt || null,
      notes: input.notes,
      credentialCount: 0,
      childAssetCount: 0,
      coreDocumentCount: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    };
    this.assets.unshift(record);
    return this.enrichAsset(record);
  }

  async updateAsset(assetId: string, input: UpdateManagedAssetInput): Promise<ManagedAsset | null> {
    const index = this.assets.findIndex((item) => item.assetId === assetId && !item.deletedAt);
    if (index === -1) return null;
    this.assets[index] = {
      ...this.assets[index],
      ...input,
      partyOrganizationId: input.partyOrganizationId === undefined ? this.assets[index].partyOrganizationId : input.partyOrganizationId,
      caseId: input.caseId === undefined ? this.assets[index].caseId : input.caseId,
      parentAssetId: input.parentAssetId === undefined ? this.assets[index].parentAssetId : input.parentAssetId,
      installedAt: input.installedAt === undefined ? this.assets[index].installedAt : input.installedAt || null,
      lastServiceAt: input.lastServiceAt === undefined ? this.assets[index].lastServiceAt : input.lastServiceAt || null,
      updatedAt: nowIso()
    };
    const updatedAsset = this.enrichAsset(this.assets[index]);
    this.assetCredentials = this.assetCredentials.map((credential) =>
      credential.assetId === assetId && !credential.deletedAt
        ? {
            ...credential,
            partyOrganizationId: updatedAsset.partyOrganizationId,
            partyOrganizationName: updatedAsset.partyOrganizationName,
            caseId: updatedAsset.caseId,
            caseNumber: updatedAsset.caseNumber,
            updatedAt: nowIso()
          }
        : credential
    );
    return updatedAsset;
  }

  async softDeleteAsset(assetId: string): Promise<ManagedAsset | null> {
    const index = this.assets.findIndex((item) => item.assetId === assetId && !item.deletedAt);
    if (index === -1) return null;
    this.assets[index] = { ...this.assets[index], deletedAt: nowIso(), updatedAt: nowIso() };
    return this.enrichAsset(this.assets[index]);
  }

  async listAssetDocumentLinks(assetId: string): Promise<AssetDocumentLink[]> {
    return this.assetDocumentLinks
      .filter((item) => item.assetId === assetId && !item.deletedAt)
      .map((item) => this.enrichAssetDocumentLink(item))
      .filter((item): item is AssetDocumentLink => Boolean(item))
      .sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return b.updatedAt.localeCompare(a.updatedAt);
      });
  }

  async getAssetDocumentLink(assetDocumentLinkId: string): Promise<AssetDocumentLink | null> {
    const link = this.assetDocumentLinks.find((item) => item.assetDocumentLinkId === assetDocumentLinkId && !item.deletedAt);
    return link ? this.enrichAssetDocumentLink(link) : null;
  }

  async linkAssetDocument(input: CreateAssetDocumentLinkInput): Promise<AssetDocumentLink> {
    const existingIndex = this.assetDocumentLinks.findIndex(
      (item) => item.assetId === input.assetId && item.documentId === input.documentId && !item.deletedAt
    );
    if (existingIndex !== -1) {
      const updated = await this.updateAssetDocumentLink(this.assetDocumentLinks[existingIndex].assetDocumentLinkId, {
        relationship: input.relationship,
        note: input.note,
        isPinned: input.isPinned,
        sortOrder: input.sortOrder,
        updatedBy: input.updatedBy ?? input.createdBy ?? null
      });
      if (!updated) throw new Error("Failed to update asset document link");
      return updated;
    }

    const now = nowIso();
    const createdBy = input.createdBy ?? null;
    const updatedBy = input.updatedBy ?? createdBy;
    const creator = createdBy ? this.users.find((item) => item.userId === createdBy) : null;
    const updater = updatedBy ? this.users.find((item) => item.userId === updatedBy) : null;
    const record: StoredAssetDocumentLink = {
      assetDocumentLinkId: crypto.randomUUID(),
      assetId: input.assetId,
      documentId: input.documentId,
      relationship: input.relationship || "Other",
      note: input.note ?? "",
      isPinned: input.isPinned ?? false,
      sortOrder: input.sortOrder ?? 0,
      createdBy,
      createdByName: creator?.name ?? null,
      updatedBy,
      updatedByName: updater?.name ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    };
    this.assetDocumentLinks.unshift(record);
    const link = this.enrichAssetDocumentLink(record);
    if (!link) throw new Error("Document not found");
    return link;
  }

  async updateAssetDocumentLink(
    assetDocumentLinkId: string,
    input: UpdateAssetDocumentLinkInput
  ): Promise<AssetDocumentLink | null> {
    const index = this.assetDocumentLinks.findIndex(
      (item) => item.assetDocumentLinkId === assetDocumentLinkId && !item.deletedAt
    );
    if (index === -1) return null;
    const updater = input.updatedBy ? this.users.find((item) => item.userId === input.updatedBy) : null;
    this.assetDocumentLinks[index] = {
      ...this.assetDocumentLinks[index],
      relationship: input.relationship ?? this.assetDocumentLinks[index].relationship,
      note: input.note ?? this.assetDocumentLinks[index].note,
      isPinned: input.isPinned === undefined ? this.assetDocumentLinks[index].isPinned : input.isPinned,
      sortOrder: input.sortOrder ?? this.assetDocumentLinks[index].sortOrder,
      updatedBy: input.updatedBy ?? null,
      updatedByName: updater?.name ?? null,
      updatedAt: nowIso()
    };
    return this.enrichAssetDocumentLink(this.assetDocumentLinks[index]);
  }

  async deleteAssetDocumentLink(assetDocumentLinkId: string): Promise<AssetDocumentLink | null> {
    const index = this.assetDocumentLinks.findIndex(
      (item) => item.assetDocumentLinkId === assetDocumentLinkId && !item.deletedAt
    );
    if (index === -1) return null;
    this.assetDocumentLinks[index] = {
      ...this.assetDocumentLinks[index],
      deletedAt: nowIso(),
      updatedAt: nowIso()
    };
    return this.enrichAssetDocumentLink(this.assetDocumentLinks[index]);
  }

  async listAssetCredentials(assetId: string): Promise<AssetCredential[]> {
    return this.assetCredentials
      .filter((item) => item.assetId === assetId && !item.deletedAt)
      .map((item) => this.enrichCredential(item))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getAssetCredential(credentialId: string): Promise<StoredAssetCredential | null> {
    const credential = this.assetCredentials.find((item) => item.credentialId === credentialId && !item.deletedAt);
    return credential ? this.enrichCredential(credential) : null;
  }

  async createAssetCredential(input: CreateAssetCredentialInput): Promise<AssetCredential> {
    const asset = await this.getAsset(input.assetId);
    if (!asset) throw new Error("Asset not found");
    const now = nowIso();
    const record: StoredAssetCredential = {
      credentialId: crypto.randomUUID(),
      assetId: input.assetId,
      partyOrganizationId: asset.partyOrganizationId ?? null,
      partyOrganizationName: asset.partyOrganizationName ?? null,
      caseId: asset.caseId ?? null,
      caseNumber: asset.caseNumber ?? null,
      label: input.label,
      credentialType: input.credentialType,
      username: input.username,
      loginUrl: input.loginUrl,
      host: input.host,
      notes: input.notes,
      hasSecret: Boolean(input.encryptedSecret.iv && input.encryptedSecret.tag),
      hasPrivateNotes: Boolean(input.encryptedPrivateNotes.iv && input.encryptedPrivateNotes.tag),
      lastVerifiedAt: input.lastVerifiedAt || null,
      rotationDueAt: input.rotationDueAt || null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      encryptedSecret: input.encryptedSecret.encryptedValue,
      secretIv: input.encryptedSecret.iv,
      secretTag: input.encryptedSecret.tag,
      encryptedPrivateNotes: input.encryptedPrivateNotes.encryptedValue,
      privateNotesIv: input.encryptedPrivateNotes.iv,
      privateNotesTag: input.encryptedPrivateNotes.tag,
      encryptionAlgorithm: input.encryptedSecret.algorithm
    };
    this.assetCredentials.unshift(record);
    return this.enrichCredential(record);
  }

  async updateAssetCredential(
    credentialId: string,
    input: UpdateAssetCredentialInput
  ): Promise<AssetCredential | null> {
    const index = this.assetCredentials.findIndex((item) => item.credentialId === credentialId && !item.deletedAt);
    if (index === -1) return null;
    const current = this.assetCredentials[index];
    this.assetCredentials[index] = {
      ...current,
      label: input.label ?? current.label,
      credentialType: input.credentialType ?? current.credentialType,
      username: input.username ?? current.username,
      loginUrl: input.loginUrl ?? current.loginUrl,
      host: input.host ?? current.host,
      notes: input.notes ?? current.notes,
      encryptedSecret: input.encryptedSecret?.encryptedValue ?? current.encryptedSecret,
      secretIv: input.encryptedSecret?.iv ?? current.secretIv,
      secretTag: input.encryptedSecret?.tag ?? current.secretTag,
      encryptedPrivateNotes: input.encryptedPrivateNotes?.encryptedValue ?? current.encryptedPrivateNotes,
      privateNotesIv: input.encryptedPrivateNotes?.iv ?? current.privateNotesIv,
      privateNotesTag: input.encryptedPrivateNotes?.tag ?? current.privateNotesTag,
      encryptionAlgorithm: input.encryptedSecret?.algorithm ?? input.encryptedPrivateNotes?.algorithm ?? current.encryptionAlgorithm,
      hasSecret: input.encryptedSecret ? Boolean(input.encryptedSecret.iv && input.encryptedSecret.tag) : current.hasSecret,
      hasPrivateNotes: input.encryptedPrivateNotes
        ? Boolean(input.encryptedPrivateNotes.iv && input.encryptedPrivateNotes.tag)
        : current.hasPrivateNotes,
      lastVerifiedAt: input.lastVerifiedAt === undefined ? current.lastVerifiedAt : input.lastVerifiedAt || null,
      rotationDueAt: input.rotationDueAt === undefined ? current.rotationDueAt : input.rotationDueAt || null,
      updatedAt: nowIso()
    };
    return this.enrichCredential(this.assetCredentials[index]);
  }

  async softDeleteAssetCredential(credentialId: string): Promise<AssetCredential | null> {
    const index = this.assetCredentials.findIndex((item) => item.credentialId === credentialId && !item.deletedAt);
    if (index === -1) return null;
    this.assetCredentials[index] = { ...this.assetCredentials[index], deletedAt: nowIso(), updatedAt: nowIso() };
    return this.enrichCredential(this.assetCredentials[index]);
  }

  async listContacts(input: ContactFilters | string = {}): Promise<Contact[]> {
    const filters: ContactFilters = typeof input === "string" ? { q: input } : input;
    const q = filters.q?.trim() ?? "";
    const qDigits = q.replace(/\D+/g, "");
    return this.contacts
      .filter((contact) => !contact.deletedAt)
      .map((contact) => this.enrichContact(contact))
      .filter((contact) => {
        if (filters.partyOrganizationId === "none" && contact.partyOrganizationId) return false;
        if (
          filters.partyOrganizationId &&
          filters.partyOrganizationId !== "none" &&
          contact.partyOrganizationId !== filters.partyOrganizationId
        ) {
          return false;
        }
        if (filters.email === "has" && !contact.email.trim()) return false;
        if (filters.email === "missing" && contact.email.trim()) return false;
        if (filters.phone === "has" && !contact.phone.trim()) return false;
        if (filters.phone === "missing" && contact.phone.trim()) return false;
        if (filters.services === "open" && !(contact.openServiceCount ?? 0)) return false;
        if (filters.services === "none" && (contact.relatedServiceCount ?? 0) > 0) return false;
        if (filters.communications === "has" && !(contact.communicationCount ?? 0)) return false;
        if (filters.communications === "needs-follow-up" && !(contact.needsFollowUpCommunicationCount ?? 0)) return false;
        if (filters.communications === "none" && (contact.communicationCount ?? 0) > 0) return false;
        if (!q) return true;
        const haystack = `${contactDisplayName(contact)} ${contact.firstName} ${contact.lastName} ${contact.jobTitle} ${
          contact.partyOrganizationName ?? ""
        } ${contact.email} ${contact.phone} ${contact.address} ${contact.notes}`;
        if (matchText(haystack, q)) return true;
        return qDigits.length > 0 && contact.phone.replace(/\D+/g, "").includes(qDigits);
      })
      .sort((a, b) => {
        const direction = filters.direction === "asc" ? 1 : -1;
        if (filters.sort === "name") return direction * contactDisplayName(a).localeCompare(contactDisplayName(b));
        if (filters.sort === "organization") {
          return direction * (a.partyOrganizationName ?? "").localeCompare(b.partyOrganizationName ?? "");
        }
        return direction * a.updatedAt.localeCompare(b.updatedAt);
      });
  }

  async listContactsPage(
    input: ContactFilters | string = {},
    pagination: PaginationParams = {}
  ): Promise<PaginatedResult<Contact>> {
    return paginateArray(await this.listContacts(input), pagination);
  }

  async getContact(contactId: string): Promise<Contact | null> {
    const contact = this.contacts.find((item) => item.contactId === contactId && !item.deletedAt);
    return contact ? this.enrichContact(contact) : null;
  }

  async createContact(input: CreateContactInput): Promise<Contact> {
    const record: Contact = {
      contactId: crypto.randomUUID(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      deletedAt: null,
      ...input
    };
    this.contacts.unshift(record);
    this.contactOrganizationAffiliations = this.contactOrganizationAffiliations.filter(
      (item) => item.contactId !== record.contactId || !item.isPrimary
    );
    if (input.partyOrganizationId) {
      this.contactOrganizationAffiliations.push({
        contactId: record.contactId,
        partyOrganizationId: input.partyOrganizationId,
        isPrimary: true
      });
    }
    return this.enrichContact(record);
  }

  async updateContact(contactId: string, input: Partial<CreateContactInput>): Promise<Contact | null> {
    const index = this.contacts.findIndex((item) => item.contactId === contactId && !item.deletedAt);
    if (index === -1) return null;
    this.contacts[index] = { ...this.contacts[index], ...input, updatedAt: nowIso() };
    if (input.partyOrganizationId !== undefined) {
      this.contactOrganizationAffiliations = this.contactOrganizationAffiliations.filter(
        (item) => item.contactId !== contactId || !item.isPrimary
      );
      if (input.partyOrganizationId) {
        this.contactOrganizationAffiliations.push({ contactId, partyOrganizationId: input.partyOrganizationId, isPrimary: true });
      }
    }
    return this.enrichContact(this.contacts[index]);
  }

  async deleteContact(contactId: string): Promise<Contact | null> {
    const index = this.contacts.findIndex((item) => item.contactId === contactId && !item.deletedAt);
    if (index === -1) return null;
    this.contacts[index] = { ...this.contacts[index], deletedAt: nowIso(), updatedAt: nowIso() };
    return this.enrichContact(this.contacts[index]);
  }

  async listCaseContacts(caseId: string): Promise<CaseContact[]> {
    return this.caseContacts
      .filter((item) => item.caseId === caseId)
      .map((item) => ({ ...item, contact: this.enrichContact(item.contact) }));
  }

  async listContactCases(contactId: string): Promise<CaseContact[]> {
    return this.caseContacts
      .filter((item) => item.contactId === contactId)
      .map((item) => ({
        ...item,
        contact: this.enrichContact(item.contact),
        case: this.cases.find((caseRecord) => caseRecord.caseId === item.caseId)
      }))
      .filter((item) => !item.case?.deletedAt)
      .sort((a, b) => (b.case?.updatedAt ?? "").localeCompare(a.case?.updatedAt ?? ""));
  }

  async addCaseContact(caseId: string, contactId: string, role: ContactRole): Promise<CaseContact> {
    const contact = await this.getContact(contactId);
    if (!contact) throw new Error("Contact not found");
    const existing = this.caseContacts.find((item) => item.caseId === caseId && item.contactId === contactId && item.role === role);
    if (existing) return { ...existing, contact: this.enrichContact(existing.contact) };
    const record: CaseContact = { caseId, contactId, role, contact };
    this.caseContacts.push(record);
    return record;
  }

  async removeCaseContact(caseId: string, contactId: string, role: ContactRole): Promise<boolean> {
    const before = this.caseContacts.length;
    this.caseContacts = this.caseContacts.filter(
      (item) => !(item.caseId === caseId && item.contactId === contactId && item.role === role)
    );
    return this.caseContacts.length !== before;
  }

  async listDocuments(caseId: string, filters: DocumentFilters = {}): Promise<DocumentRecord[]> {
    return this.documents
      .filter((item) => item.caseId === caseId && !item.deletedAt && item.isCurrentVersion !== false)
      .filter((item) => !filters.category || item.category === filters.category)
      .filter((item) => {
        if (!filters.q) return true;
        return matchText(
          `${item.fileName} ${item.originalFileName} ${item.notes} ${item.category} ${item.tags.map((tag) => tag.name).join(" ")}`,
          filters.q
        );
      })
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }

  async listDocumentsPage(filters: DocumentFilters = {}, pagination: PaginationParams = {}): Promise<PaginatedResult<DocumentRecord>> {
    const q = filters.q?.trim() ?? "";
    const rows = this.documents
      .filter((item) => (filters.trashed ? Boolean(item.deletedAt) : !item.deletedAt) && item.isCurrentVersion !== false)
      .map((document) => this.enrichDocument(document))
      .filter((item) => !filters.caseId || item.caseId === filters.caseId)
      .filter(
        (item) =>
          !filters.assetId ||
          this.assetDocumentLinks.some(
            (link) => link.assetId === filters.assetId && link.documentId === item.documentId && !link.deletedAt
          )
      )
      .filter((item) => !filters.partyOrganizationId || item.partyOrganizationId === filters.partyOrganizationId)
      .filter((item) => !filters.category || item.category === filters.category)
      .filter((item) => !filters.folderId || item.folderId === filters.folderId)
      .filter((item) => !filters.unfiled || !item.folderId)
      .filter((item) => !filters.reviewStatus || item.reviewStatus === filters.reviewStatus)
      .filter((item) => !filters.tagId || item.tags.some((tag) => tag.tagId === filters.tagId))
      .filter((item) => !filters.uploadedFrom || item.uploadedAt.slice(0, 10) >= filters.uploadedFrom!)
      .filter((item) => !filters.uploadedTo || item.uploadedAt.slice(0, 10) <= filters.uploadedTo!)
      .filter((item) => {
        if (!q) return true;
        return matchText(
          [
            item.fileName,
            item.originalFileName,
            item.notes,
            item.category,
            item.folderName,
            item.reviewStatus,
            item.reviewNotes,
            item.caseNumber,
            item.caseTitle,
            item.partyOrganizationName,
            ...item.tags.map((tag) => tag.name)
          ]
            .filter(Boolean)
            .join(" "),
          q
        );
      })
      .sort((a, b) => {
        const direction = filters.direction === "asc" ? 1 : -1;
        let result = 0;
        if (filters.sort === "fileName") result = naturalCompare(a.originalFileName, b.originalFileName);
        else if (filters.sort === "fileType") result = naturalCompare(fileTypeLabel(a.originalFileName, a.mimeType), fileTypeLabel(b.originalFileName, b.mimeType));
        else if (filters.sort === "fileSize") result = a.fileSize - b.fileSize;
        else if (filters.sort === "folder") result = naturalCompare(a.folderName ?? "Unfiled", b.folderName ?? "Unfiled");
        else if (filters.sort === "category") result = naturalCompare(a.category, b.category);
        else if (filters.sort === "reviewStatus") result = naturalCompare(a.reviewStatus, b.reviewStatus);
        else if (filters.sort === "uploadedBy") result = naturalCompare(a.uploadedByName, b.uploadedByName);
        else if (filters.sort === "service") result = naturalCompare(a.caseNumber, b.caseNumber);
        else if (filters.sort === "customer") result = naturalCompare(a.partyOrganizationName, b.partyOrganizationName);
        else result = a.uploadedAt.localeCompare(b.uploadedAt);
        if (result === 0) result = naturalCompare(a.originalFileName, b.originalFileName);
        if (result === 0) result = a.documentId.localeCompare(b.documentId);
        return direction * result;
      });
    return paginateArray(rows, pagination);
  }

  async listRecentDocuments(limit: number): Promise<DocumentRecord[]> {
    return this.documents
      .filter(
        (item) =>
          !item.deletedAt &&
          item.isCurrentVersion !== false &&
          !this.cases.find((caseRecord) => caseRecord.caseId === item.caseId)?.deletedAt
      )
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
      .slice(0, limit);
  }

  async getDocument(documentId: string, options: { includeDeleted?: boolean } = {}): Promise<DocumentRecord | null> {
    const document = this.documents.find(
      (item) => item.documentId === documentId && (options.includeDeleted || !item.deletedAt)
    );
    return document ? this.enrichDocument(document) : null;
  }

  async createDocument(input: CreateDocumentInput): Promise<DocumentRecord> {
    this.assertActiveArchiveFolder(input.folderId);
    this.assertObjectKeyAvailable(input.r2ObjectKey);
    if (this.documents.some((item) => item.r2ObjectKey === input.r2ObjectKey || item.documentId === input.documentId)) {
      throw new Error("This document already exists.");
    }
    const user = this.users.find((item) => item.userId === input.uploadedBy);
    const tags = input.tagIds ? this.tags.filter((tag) => input.tagIds?.includes(tag.tagId)) : [];
    const record: DocumentRecord = {
      ...input,
      managementOwnerUserId: this.documents.find((d) => d.documentGroupId === (input.documentGroupId ?? input.documentId))?.managementOwnerUserId
        ?? (this.documents.some((d) => d.documentGroupId === (input.documentGroupId ?? input.documentId)) ? null
          : (input.versionNumber ?? 1) === 1 && (input.documentGroupId ?? input.documentId) === input.documentId ? user?.userId ?? null : null),
      documentGroupId: input.documentGroupId ?? input.documentId,
      versionNumber: input.versionNumber ?? 1,
      isCurrentVersion: input.isCurrentVersion ?? true,
      supersededBy: null,
      supersededAt: null,
      uploadedAt: nowIso(),
      uploadedByName: user?.name ?? "Unknown User",
      reviewStatus: "needs-review",
      reviewedBy: null,
      reviewedByName: null,
      reviewedAt: null,
      reviewNotes: "",
      tags,
      deletedAt: null
    };
    this.documents.unshift(record);
    return record;
  }

  async listDocumentVersions(documentId: string): Promise<DocumentRecord[]> {
    const source = await this.getDocument(documentId);
    if (!source) return [];
    const groupId = source.documentGroupId || source.documentId;
    return this.documents
      .filter((item) => !item.deletedAt && item.caseId === source.caseId && (item.documentGroupId || item.documentId) === groupId)
      .sort((a, b) => {
        const versionDelta = (b.versionNumber ?? 1) - (a.versionNumber ?? 1);
        return versionDelta || b.uploadedAt.localeCompare(a.uploadedAt);
      });
  }

  async createDocumentVersion(sourceDocumentId: string, input: CreateDocumentInput) {
    const source = await this.getDocument(sourceDocumentId);
    if (!source) return null;
    const groupId = source.documentGroupId || source.documentId;
    const currentSource = this.documents.find((item) => item.documentId === sourceDocumentId && !item.deletedAt);
    if (!currentSource) return null;
    const versions = this.documents.filter((item) => !item.deletedAt && (item.documentGroupId || item.documentId) === groupId);
    const nextFolderId = input.folderId ?? currentSource.folderId ?? null;
    this.assertActiveArchiveFolder(nextFolderId);
    this.assertObjectKeyAvailable(input.r2ObjectKey);
    if (this.documents.some((item) => item.documentId === input.documentId || item.r2ObjectKey === input.r2ObjectKey)) {
      throw new Error("This document already exists.");
    }
    const nextVersion = Math.max(0, ...versions.map((item) => item.versionNumber ?? 1)) + 1;
    const now = nowIso();

    this.documents = this.documents.map((item) => {
      const sameGroup = item.caseId === source.caseId && (item.documentGroupId || item.documentId) === groupId && !item.deletedAt;
      if (!sameGroup || item.isCurrentVersion === false) return item;
      return {
        ...item,
        isCurrentVersion: false,
        reviewStatus: "superseded" as const,
        supersededBy: input.documentId,
        supersededAt: now,
        reviewNotes: item.reviewNotes || `Superseded by version ${nextVersion}.`
      };
    });

    const user = this.users.find((item) => item.userId === input.uploadedBy);
    const tags = input.tagIds ? this.tags.filter((tag) => input.tagIds?.includes(tag.tagId)) : source.tags;
    const current: DocumentRecord = {
      ...input,
      managementOwnerUserId: source.managementOwnerUserId ?? null,
      folderId: nextFolderId,
      documentGroupId: groupId,
      versionNumber: nextVersion,
      isCurrentVersion: true,
      supersededBy: null,
      supersededAt: null,
      uploadedAt: now,
      uploadedByName: user?.name ?? "Unknown User",
      reviewStatus: "needs-review",
      reviewedBy: null,
      reviewedByName: null,
      reviewedAt: null,
      reviewNotes: "",
      tags,
      deletedAt: null
    };
    this.documents.unshift(current);
    this.assetDocumentLinks = this.assetDocumentLinks.map((link) => {
      const duplicateLinkExists = this.assetDocumentLinks.some(
        (item) => item.assetId === link.assetId && item.documentId === current.documentId && !item.deletedAt
      );
      if (link.documentId !== source.documentId || link.deletedAt || duplicateLinkExists) return link;
      return {
        ...link,
        documentId: current.documentId,
        updatedBy: input.uploadedBy,
        updatedByName: user?.name ?? null,
        updatedAt: now
      };
    });
    return {
      previous: this.documents.find((item) => item.documentId === source.documentId) ?? source,
      current,
      versions: await this.listDocumentVersions(current.documentId)
    };
  }

  async updateDocument(documentId: string, input: UpdateDocumentInput): Promise<DocumentRecord | null> {
    this.assertActiveArchiveFolder(input.folderId);
    const index = this.documents.findIndex((item) => item.documentId === documentId && !item.deletedAt);
    if (index === -1) return null;
    const groupId = this.documents[index].documentGroupId || this.documents[index].documentId;
    if (input.folderId !== undefined) {
      this.documents = this.documents.map((item) =>
        (item.documentGroupId || item.documentId) === groupId ? { ...item, folderId: input.folderId } : item
      );
    }
    const currentIndex = this.documents.findIndex((item) => item.documentId === documentId && !item.deletedAt);
    if (currentIndex === -1) return null;
    const nextTags = input.tagIds ? this.tags.filter((tag) => input.tagIds?.includes(tag.tagId)) : this.documents[currentIndex].tags;
    const reviewChanged = input.reviewStatus !== undefined && input.reviewStatus !== this.documents[currentIndex].reviewStatus;
    const reviewer = reviewChanged ? this.users.find((item) => item.userId === input.reviewedBy) : null;
    this.documents[currentIndex] = {
      ...this.documents[currentIndex],
      category: input.category ?? this.documents[currentIndex].category,
      notes: input.notes ?? this.documents[currentIndex].notes,
      reviewStatus: input.reviewStatus ?? this.documents[currentIndex].reviewStatus,
      reviewNotes: input.reviewNotes ?? this.documents[currentIndex].reviewNotes,
      reviewedBy: reviewChanged ? input.reviewedBy ?? null : this.documents[currentIndex].reviewedBy ?? null,
      reviewedByName: reviewChanged ? reviewer?.name ?? null : this.documents[currentIndex].reviewedByName ?? null,
      reviewedAt: reviewChanged ? nowIso() : this.documents[currentIndex].reviewedAt ?? null,
      tags: nextTags
    };
    return this.enrichDocument(this.documents[currentIndex]);
  }

  async softDeleteDocument(
    documentId: string,
    options: { retainObject?: boolean; entireGroup?: boolean } = {}
  ): Promise<DocumentRecord | null> {
    const source = this.documents.find((item) => item.documentId === documentId && !item.deletedAt);
    if (!source) return null;
    const groupId = source.documentGroupId || source.documentId;
    const deletedAt = nowIso();
    this.documents = this.documents.map((item) => {
      const matches = options.entireGroup
        ? (item.documentGroupId || item.documentId) === groupId && !item.deletedAt
        : item.documentId === documentId && !item.deletedAt;
      if (!matches) return item;
      if (!options.retainObject) {
        this.queueStorageCleanup(item.r2ObjectKey);
      }
      return { ...item, deletedAt };
    });
    return this.getDocument(documentId, { includeDeleted: true });
  }

  async restoreDocument(documentId: string): Promise<DocumentRecord | null> {
    const source = await this.getDocument(documentId, { includeDeleted: true });
    if (!source?.deletedAt) return null;
    const groupId = source.documentGroupId || source.documentId;
    for (const item of this.documents.filter((item) => (item.documentGroupId || item.documentId) === groupId)) {
      this.assertActiveArchiveFolder(item.folderId);
    }
    this.documents = this.documents.map((item) => {
      if ((item.documentGroupId || item.documentId) !== groupId) return item;
      if (!this.storageCleanupJobs.get(item.r2ObjectKey)?.startedAt) this.storageCleanupJobs.delete(item.r2ObjectKey);
      return { ...item, deletedAt: null, folderDeletionBatchId: null };
    });
    return this.getDocument(documentId);
  }

  async purgeDocument(documentId: string): Promise<DocumentRecord[]> {
    const source = this.documents.find((item) => item.documentId === documentId);
    if (!source?.deletedAt) return [];
    const groupId = source.documentGroupId || source.documentId;
    const purged = this.documents
      .filter((item) => (item.documentGroupId || item.documentId) === groupId)
      .map((item) => this.enrichDocument(item));
    if (purged.some((item) => !item.deletedAt)) return [];
    if ((await this.readArchiveManagementState(documentId)).references.length) throw new Error("Referenced files cannot be permanently deleted");
    const purgedIds = new Set(purged.map((item) => item.documentId));
    this.documents = this.documents.filter((item) => !purgedIds.has(item.documentId));
    this.assetDocumentLinks = this.assetDocumentLinks.filter((item) => !purgedIds.has(item.documentId));
    purged.forEach((item) => this.queueStorageCleanup(item.r2ObjectKey));
    return purged;
  }

  private assertActiveArchiveFolder(folderId?: string | null): void {
    if (folderId && !this.archiveFolders.some((folder) => folder.folderId === folderId && !folder.deletedAt)) {
      throw new Error("Restore the containing folder before restoring or adding files");
    }
  }

  async listArchiveFolders(options: { includeDeleted?: boolean } = {}): Promise<ArchiveFolder[]> {
    return this.archiveFolders
      .filter((folder) => options.includeDeleted || !folder.deletedAt)
      .map((folder) => ({
        ...folder,
        fileCount: this.documents.filter(
          (document) => !document.deletedAt && document.isCurrentVersion !== false && document.folderId === folder.folderId
        ).length,
        createdByName: folder.createdBy
          ? this.users.find((user) => user.userId === folder.createdBy)?.name ?? null
          : null
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  async getArchiveFolder(folderId: string, options: { includeDeleted?: boolean } = {}): Promise<ArchiveFolder | null> {
    return (await this.listArchiveFolders(options)).find((folder) => folder.folderId === folderId) ?? null;
  }

  async createArchiveFolder(input: CreateArchiveFolderInput): Promise<ArchiveFolder> {
    const name = input.name.trim();
    if (input.parentFolderId && !this.archiveFolders.some((folder) => folder.folderId === input.parentFolderId && !folder.deletedAt)) {
      throw new Error("Parent folder not found");
    }
    const duplicate = this.archiveFolders.some(
      (folder) => !folder.deletedAt && (folder.parentFolderId ?? null) === (input.parentFolderId ?? null) && folder.name.toLowerCase() === name.toLowerCase()
    );
    if (duplicate) throw new Error("A folder with this name already exists here");
    const now = nowIso();
    const record: ArchiveFolder = {
      folderId: input.folderId,
      managementOwnerUserId: this.users.find((u) => u.userId === input.createdBy)?.userId ?? null,
      name,
      parentFolderId: input.parentFolderId ?? null,
      sortOrder: input.sortOrder ?? this.archiveFolders.length * 10 + 10,
      fileCount: 0,
      createdBy: input.createdBy ?? null,
      createdByName: input.createdBy
        ? this.users.find((user) => user.userId === input.createdBy)?.name ?? null
        : null,
      createdAt: now,
      updatedAt: now
    };
    this.archiveFolders.push(record);
    return record;
  }

  async updateArchiveFolder(
    folderId: string,
    input: Partial<{ name: string; parentFolderId?: string | null; sortOrder?: number }>
  ): Promise<ArchiveFolder | null> {
    const index = this.archiveFolders.findIndex((folder) => folder.folderId === folderId && !folder.deletedAt);
    if (index === -1) return null;
    const nextName = input.name?.trim() || this.archiveFolders[index].name;
    const nextParentId = input.parentFolderId === undefined ? this.archiveFolders[index].parentFolderId ?? null : input.parentFolderId;
    if (nextParentId === folderId) throw new Error("A folder cannot contain itself");
    if (nextParentId && !this.archiveFolders.some((folder) => folder.folderId === nextParentId && !folder.deletedAt)) {
      throw new Error("Parent folder not found");
    }
    let ancestorId = nextParentId;
    while (ancestorId) {
      if (ancestorId === folderId) throw new Error("A folder cannot move inside one of its descendants");
      ancestorId = this.archiveFolders.find((folder) => folder.folderId === ancestorId)?.parentFolderId ?? null;
    }
    const duplicate = this.archiveFolders.some(
      (folder) =>
        folder.folderId !== folderId &&
        !folder.deletedAt &&
        (folder.parentFolderId ?? null) === nextParentId &&
        folder.name.toLowerCase() === nextName.toLowerCase()
    );
    if (duplicate) throw new Error("A folder with this name already exists here");
    this.archiveFolders[index] = {
      ...this.archiveFolders[index],
      name: nextName,
      parentFolderId: nextParentId,
      sortOrder: input.sortOrder ?? this.archiveFolders[index].sortOrder,
      updatedAt: nowIso()
    };
    return this.getArchiveFolder(folderId);
  }

  async deleteArchiveFolder(folderId: string): Promise<ArchiveFolderDeleteResult | null> {
    if (!this.archiveFolders.some((folder) => folder.folderId === folderId && !folder.deletedAt)) return null;
    const folderIds = new Set([folderId]);
    let foundDescendant = true;
    while (foundDescendant) {
      foundDescendant = false;
      for (const folder of this.archiveFolders) {
        if (!folder.deletedAt && folder.parentFolderId && folderIds.has(folder.parentFolderId) && !folderIds.has(folder.folderId)) {
          folderIds.add(folder.folderId);
          foundDescendant = true;
        }
      }
    }
    const documentGroupIds = new Set(
      this.documents
        .filter((document) => !document.deletedAt && document.folderId && folderIds.has(document.folderId))
        .map((document) => document.documentGroupId || document.documentId)
    );
    const deletedAt = nowIso();
    const deletionBatchId = crypto.randomUUID();
    this.documents = this.documents.map((document) => {
      const groupId = document.documentGroupId || document.documentId;
      const documentWillBeTrashed = documentGroupIds.has(groupId) && !document.deletedAt;
      return documentWillBeTrashed ? { ...document, deletedAt, folderDeletionBatchId: deletionBatchId } : document;
    });
    this.archiveFolders = this.archiveFolders.map((folder) => folderIds.has(folder.folderId)
      ? { ...folder, deletedAt, deletionBatchId, deletionRootFolderId: folderId, updatedAt: deletedAt } : folder);
    return { deletedFolders: folderIds.size, trashedDocuments: documentGroupIds.size };
  }

  async restoreArchiveFolder(folderId: string, input: Partial<{ name: string; parentFolderId?: string | null; sortOrder?: number }> = {}): Promise<ArchiveFolder | null> {
    const root = this.archiveFolders.find((folder) => folder.folderId === folderId && folder.deletedAt);
    if (!root || root.deletionRootFolderId !== folderId) return null;
    const batchId = root.deletionBatchId;
    const folders = this.archiveFolders.filter((folder) => folder.deletedAt && folder.deletionBatchId === batchId);
    const ids = new Set(folders.map((folder) => folder.folderId));
    const nextName = input.name?.trim() || root.name;
    const nextParentId = input.parentFolderId === undefined ? root.parentFolderId ?? null : input.parentFolderId;
    if (nextParentId && !this.archiveFolders.some((folder) => folder.folderId === nextParentId && !folder.deletedAt)) {
      throw new Error("Restore the parent folder first or choose another location");
    }
    if (this.archiveFolders.some((folder) => !folder.deletedAt && (folder.parentFolderId ?? null) === nextParentId
      && folder.name.toLowerCase() === nextName.toLowerCase())) {
      throw new Error("A folder with this name already exists here; choose another name or location");
    }
    for (const document of this.documents.filter((document) => document.folderDeletionBatchId === batchId && document.deletedAt)) {
      if (document.folderId && !ids.has(document.folderId)) this.assertActiveArchiveFolder(document.folderId);
    }
    // All validation precedes mutation, matching PostgreSQL's all-or-nothing restore.
    this.archiveFolders = this.archiveFolders.map((folder) => ids.has(folder.folderId) ? {
      ...folder, ...(folder.folderId === folderId ? { name: nextName, parentFolderId: nextParentId } : {}),
      deletedAt: null, deletionBatchId: null, deletionRootFolderId: null, updatedAt: nowIso()
    } : folder);
    this.documents = this.documents.map((document) => document.deletedAt && document.folderDeletionBatchId === batchId
      ? { ...document, deletedAt: null, folderDeletionBatchId: null } : document);
    return this.getArchiveFolder(folderId);
  }

  async updateArchiveFolderDocumentsMetadata(
    folderId: string,
    input: ArchiveFolderMetadataUpdateInput,
    reviewedBy: string
  ): Promise<ArchiveFolderMetadataUpdateResult | null> {
    if (!this.archiveFolders.some((folder) => folder.folderId === folderId && !folder.deletedAt)) return null;
    const folderIds = new Set([folderId]);
    if (input.includeSubfolders) {
      let foundDescendant = true;
      while (foundDescendant) {
        foundDescendant = false;
        for (const folder of this.archiveFolders) {
          if (!folder.deletedAt && folder.parentFolderId && folderIds.has(folder.parentFolderId) && !folderIds.has(folder.folderId)) {
            folderIds.add(folder.folderId);
            foundDescendant = true;
          }
        }
      }
    }
    const targetDocumentIds = new Set(
      this.documents
        .filter(
          (document) =>
            !document.deletedAt &&
            document.isCurrentVersion !== false &&
            Boolean(document.folderId && folderIds.has(document.folderId))
        )
        .map((document) => document.documentId)
    );
    const reviewer = this.users.find((user) => user.userId === reviewedBy);
    const selectedTags = input.tagIds === undefined
      ? null
      : this.tags.filter((tag) => input.tagIds?.includes(tag.tagId));
    this.documents = this.documents.map((document) => {
      if (!targetDocumentIds.has(document.documentId)) return document;
      const reviewChanged = input.reviewStatus !== undefined && input.reviewStatus !== document.reviewStatus;
      return {
        ...document,
        category: input.category ?? document.category,
        reviewStatus: input.reviewStatus ?? document.reviewStatus,
        notes: input.notes ?? document.notes,
        reviewNotes: input.reviewNotes ?? document.reviewNotes,
        tags: selectedTags ?? document.tags,
        reviewedBy: reviewChanged ? reviewedBy : document.reviewedBy,
        reviewedByName: reviewChanged ? reviewer?.name ?? null : document.reviewedByName,
        reviewedAt: reviewChanged ? nowIso() : document.reviewedAt
      };
    });
    return {
      folderId,
      folderCount: folderIds.size,
      matched: targetDocumentIds.size,
      updated: targetDocumentIds.size
    };
  }

  async listArchiveCategories(): Promise<ArchiveCategory[]> {
    return this.archiveCategories
      .map((category) => ({
        ...category,
        fileCount: this.documents.filter(
          (document) =>
            !document.deletedAt &&
            document.isCurrentVersion !== false &&
            document.category.toLowerCase() === category.name.toLowerCase()
        ).length,
        createdByName: category.createdBy
          ? this.users.find((user) => user.userId === category.createdBy)?.name ?? null
          : null
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  async getArchiveCategory(categoryId: string): Promise<ArchiveCategory | null> {
    return (await this.listArchiveCategories()).find((category) => category.categoryId === categoryId) ?? null;
  }

  async createArchiveCategory(input: CreateArchiveCategoryInput): Promise<ArchiveCategory> {
    const name = input.name.trim();
    if (this.archiveCategories.some((category) => category.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("A category with this name already exists");
    }
    const now = nowIso();
    const record: ArchiveCategory = {
      categoryId: input.categoryId,
      name,
      sortOrder: input.sortOrder ?? this.archiveCategories.length * 10 + 10,
      isSystem: false,
      fileCount: 0,
      createdBy: input.createdBy ?? null,
      createdByName: input.createdBy
        ? this.users.find((user) => user.userId === input.createdBy)?.name ?? null
        : null,
      createdAt: now,
      updatedAt: now
    };
    this.archiveCategories.push(record);
    return record;
  }

  async updateArchiveCategory(
    categoryId: string,
    input: Partial<{ name: string; sortOrder?: number }>
  ): Promise<ArchiveCategory | null> {
    const index = this.archiveCategories.findIndex((category) => category.categoryId === categoryId);
    if (index === -1) return null;
    const previousName = this.archiveCategories[index].name;
    const nextName = input.name?.trim() || previousName;
    if (
      this.archiveCategories.some(
        (category) => category.categoryId !== categoryId && category.name.toLowerCase() === nextName.toLowerCase()
      )
    ) {
      throw new Error("A category with this name already exists");
    }
    this.archiveCategories[index] = {
      ...this.archiveCategories[index],
      name: nextName,
      sortOrder: input.sortOrder ?? this.archiveCategories[index].sortOrder,
      updatedAt: nowIso()
    };
    if (previousName !== nextName) {
      this.documents = this.documents.map((document) =>
        document.category === previousName ? { ...document, category: nextName } : document
      );
    }
    return this.getArchiveCategory(categoryId);
  }

  async deleteArchiveCategory(categoryId: string, replacementCategoryId?: string | null): Promise<boolean> {
    const category = this.archiveCategories.find((item) => item.categoryId === categoryId);
    if (!category) return false;
    if (this.archiveCategories.length <= 1) throw new Error("At least one archive category is required");
    if (category.name === "Other") throw new Error("The Other category cannot be deleted");
    const inUse = this.documents.some((document) => document.category === category.name);
    const replacement = replacementCategoryId
      ? this.archiveCategories.find((item) => item.categoryId === replacementCategoryId)
      : null;
    if (inUse && !replacement) throw new Error("Choose a replacement category for the existing files");
    if (replacement?.categoryId === categoryId) throw new Error("Choose a different replacement category");
    if (replacement) {
      this.documents = this.documents.map((document) =>
        document.category === category.name ? { ...document, category: replacement.name } : document
      );
    }
    this.archiveCategories = this.archiveCategories.filter((item) => item.categoryId !== categoryId);
    return true;
  }

  private assertObjectKeyAvailable(objectKey: string): void {
    if (this.storageCleanupJobs.get(objectKey)?.startedAt) throw new Error("Stored object key has been retired");
  }

  private queueStorageCleanup(objectKey: string): void {
    const existing = this.storageCleanupJobs.get(objectKey);
    if (existing) {
      if (!existing.completedAt && !existing.leaseToken) existing.nextAttemptAt = new Date(Math.min(Date.now(), Date.parse(existing.nextAttemptAt))).toISOString();
      return;
    }
    this.storageCleanupJobs.set(objectKey, {
      cleanupJobId: crypto.randomUUID(), objectKey, attempts: 0, startedAt: null,
      leaseToken: null, leaseExpiresAt: null, nextAttemptAt: nowIso(), completedAt: null, lastError: null
    });
  }

  async enqueueStorageCleanup(objectKey: string): Promise<void> {
    this.queueStorageCleanup(objectKey);
  }

  async listPendingStorageCleanupJobs(limit = 25): Promise<StorageCleanupJob[]> {
    return [...this.storageCleanupJobs.values()]
      .filter((job) => !job.completedAt && Date.parse(job.nextAttemptAt) <= Date.now()
        && (!job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) <= Date.now()))
      .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt) || a.cleanupJobId.localeCompare(b.cleanupJobId))
      .slice(0, Math.min(100, Math.max(1, limit))).map((job) => ({ ...job }));
  }

  async claimStorageCleanupJob(cleanupJobId: string): Promise<StorageCleanupJob | null> {
    // The check and state transition are synchronous: no reference INSERT can interleave.
    const job = [...this.storageCleanupJobs.values()].find((item) => item.cleanupJobId === cleanupJobId);
    if (!job || job.completedAt || Date.parse(job.nextAttemptAt) > Date.now()
      || (job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) > Date.now())) return null;
    if (this.documents.some((item) => item.r2ObjectKey === job.objectKey)
      || this.privateVaultItems.some((item) => item.objectKey === job.objectKey)) {
      job.lastError = "object_referenced";
      job.nextAttemptAt = new Date(Date.now() + STORAGE_CLEANUP_REFERENCE_DELAY_MS).toISOString();
      job.leaseToken = null;
      job.leaseExpiresAt = null;
      return null;
    }
    job.startedAt ??= nowIso();
    job.leaseToken = crypto.randomUUID();
    job.leaseExpiresAt = new Date(Date.now() + STORAGE_CLEANUP_LEASE_MS).toISOString();
    job.attempts += 1;
    job.lastError = null;
    return { ...job };
  }

  async completeStorageCleanup(cleanupJobId: string, leaseToken: string): Promise<boolean> {
    const job = [...this.storageCleanupJobs.values()].find((item) => item.cleanupJobId === cleanupJobId);
    if (!job || job.completedAt || job.leaseToken !== leaseToken) return false;
    Object.assign(job, { completedAt: nowIso(), leaseToken: null, leaseExpiresAt: null, lastError: null });
    return true;
  }

  async failStorageCleanup(cleanupJobId: string, leaseToken: string): Promise<boolean> {
    const job = [...this.storageCleanupJobs.values()].find((item) => item.cleanupJobId === cleanupJobId);
    if (!job || job.completedAt || job.leaseToken !== leaseToken) return false;
    Object.assign(job, { lastError: "object_delete_failed", leaseToken: null, leaseExpiresAt: null,
      nextAttemptAt: new Date(Date.now() + storageCleanupRetryDelay(job.attempts)).toISOString() });
    return true;
  }

  async getStorageCleanupStatus() {
    const jobs = [...this.storageCleanupJobs.values()];
    return {
      pending: jobs.filter((job) => !job.completedAt).length,
      leased: jobs.filter((job) => !job.completedAt && job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) > Date.now()).length,
      failed: jobs.filter((job) => !job.completedAt && job.lastError === "object_delete_failed").length,
      referenced: jobs.filter((job) => !job.completedAt && job.lastError === "object_referenced").length,
      completed: jobs.filter((job) => job.completedAt).length
    };
  }

  async getPrivateVaultByOwner(ownerUserId: string): Promise<StoredPrivateVault | null> {
    return this.privateVaults.find((vault) => vault.ownerUserId === ownerUserId) ?? null;
  }

  async createPrivateVault(input: CreatePrivateVaultInput): Promise<StoredPrivateVault> {
    if (this.privateVaults.some((vault) => vault.ownerUserId === input.ownerUserId)) {
      throw new Error("This account already has a private vault.");
    }
    const now = nowIso();
    const record: StoredPrivateVault = {
      vaultId: input.vaultId,
      ownerUserId: input.ownerUserId,
      encryptionVersion: input.encryptionVersion,
      encryptionKdf: input.encryptionKdf,
      encryptionIterations: input.encryptionIterations,
      encryptionSalt: input.encryptionSalt,
      encryptedVaultKey: input.encryptedVaultKey,
      recoveryEncryptedVaultKey: input.recoveryEncryptedVaultKey,
      autoLockMinutes: input.autoLockMinutes ?? 10,
      createdAt: now,
      updatedAt: now
    };
    this.privateVaults.push(record);
    return record;
  }

  async updatePrivateVaultPassword(
    ownerUserId: string,
    metadata: PrivateVaultPasswordMetadata
  ): Promise<StoredPrivateVault | null> {
    const index = this.privateVaults.findIndex((vault) => vault.ownerUserId === ownerUserId);
    if (index === -1) return null;
    this.privateVaults[index] = { ...this.privateVaults[index], ...metadata, updatedAt: nowIso() };
    return this.privateVaults[index];
  }

  async updatePrivateVaultAutoLock(ownerUserId: string, autoLockMinutes: number): Promise<StoredPrivateVault | null> {
    const index = this.privateVaults.findIndex((vault) => vault.ownerUserId === ownerUserId);
    if (index === -1) return null;
    this.privateVaults[index] = { ...this.privateVaults[index], autoLockMinutes, updatedAt: nowIso() };
    return this.privateVaults[index];
  }

  async listPrivateVaultFolders(ownerUserId: string, includeDeleted = false): Promise<StoredPrivateVaultFolder[]> {
    const vault = await this.getPrivateVaultByOwner(ownerUserId);
    if (!vault) return [];
    return this.privateVaultFolders
      .filter((folder) => folder.vaultId === vault.vaultId)
      .filter((folder) => includeDeleted ? Boolean(folder.deletedAt) : !folder.deletedAt)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getPrivateVaultFolder(
    ownerUserId: string,
    folderId: string,
    includeDeleted = false
  ): Promise<StoredPrivateVaultFolder | null> {
    const vault = await this.getPrivateVaultByOwner(ownerUserId);
    if (!vault) return null;
    return this.privateVaultFolders.find((folder) =>
      folder.folderId === folderId && folder.vaultId === vault.vaultId && (includeDeleted || !folder.deletedAt)
    ) ?? null;
  }

  async createPrivateVaultFolder(input: CreatePrivateVaultFolderInput): Promise<StoredPrivateVaultFolder> {
    if (this.privateVaultFolders.some((folder) => folder.folderId === input.folderId)) {
      throw new Error("This private vault folder already exists.");
    }
    const now = nowIso();
    const record: StoredPrivateVaultFolder = { ...input, createdAt: now, updatedAt: now, deletedAt: null };
    this.privateVaultFolders.unshift(record);
    return record;
  }

  async updatePrivateVaultFolderMetadata(
    ownerUserId: string,
    folderId: string,
    encryptedMetadata: string
  ): Promise<StoredPrivateVaultFolder | null> {
    const current = await this.getPrivateVaultFolder(ownerUserId, folderId);
    if (!current) return null;
    const index = this.privateVaultFolders.findIndex((folder) => folder.folderId === folderId);
    this.privateVaultFolders[index] = { ...current, encryptedMetadata, updatedAt: nowIso() };
    return this.privateVaultFolders[index];
  }

  async softDeletePrivateVaultFolder(ownerUserId: string, folderId: string): Promise<StoredPrivateVaultFolder | null> {
    const current = await this.getPrivateVaultFolder(ownerUserId, folderId);
    if (!current) return null;
    const index = this.privateVaultFolders.findIndex((folder) => folder.folderId === folderId);
    const now = nowIso();
    this.privateVaultFolders[index] = { ...current, deletedAt: now, updatedAt: now };
    return this.privateVaultFolders[index];
  }

  async restorePrivateVaultFolder(ownerUserId: string, folderId: string): Promise<StoredPrivateVaultFolder | null> {
    const current = await this.getPrivateVaultFolder(ownerUserId, folderId, true);
    if (!current?.deletedAt) return null;
    const index = this.privateVaultFolders.findIndex((folder) => folder.folderId === folderId);
    this.privateVaultFolders[index] = { ...current, deletedAt: null, updatedAt: nowIso() };
    return this.privateVaultFolders[index];
  }

  async purgePrivateVaultFolder(ownerUserId: string, folderId: string): Promise<StoredPrivateVaultFolder | null> {
    const current = await this.getPrivateVaultFolder(ownerUserId, folderId, true);
    if (!current) return null;
    this.privateVaultFolders = this.privateVaultFolders.filter((folder) => folder.folderId !== folderId);
    return current;
  }

  async listPrivateVaultItems(ownerUserId: string, includeDeleted = false): Promise<StoredPrivateVaultItem[]> {
    const vault = await this.getPrivateVaultByOwner(ownerUserId);
    if (!vault) return [];
    return this.privateVaultItems
      .filter((item) => item.vaultId === vault.vaultId)
      .filter((item) => includeDeleted ? Boolean(item.deletedAt) : !item.deletedAt)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getPrivateVaultItem(
    ownerUserId: string,
    itemId: string,
    includeDeleted = false
  ): Promise<StoredPrivateVaultItem | null> {
    const vault = await this.getPrivateVaultByOwner(ownerUserId);
    if (!vault) return null;
    return this.privateVaultItems.find((item) =>
      item.itemId === itemId && item.vaultId === vault.vaultId && (includeDeleted || !item.deletedAt)
    ) ?? null;
  }

  async createPrivateVaultItem(input: CreatePrivateVaultItemInput): Promise<StoredPrivateVaultItem> {
    this.assertObjectKeyAvailable(input.objectKey);
    if (this.privateVaultItems.some((item) => item.itemId === input.itemId || item.objectKey === input.objectKey)) {
      throw new Error("This private vault item already exists.");
    }
    const now = nowIso();
    const record: StoredPrivateVaultItem = {
      ...input,
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    };
    this.privateVaultItems.unshift(record);
    return record;
  }

  async updatePrivateVaultItemMetadata(
    ownerUserId: string,
    itemId: string,
    encryptedMetadata: string
  ): Promise<StoredPrivateVaultItem | null> {
    const current = await this.getPrivateVaultItem(ownerUserId, itemId);
    if (!current) return null;
    const index = this.privateVaultItems.findIndex((item) => item.itemId === itemId);
    this.privateVaultItems[index] = { ...current, encryptedMetadata, updatedAt: nowIso() };
    return this.privateVaultItems[index];
  }

  async updatePrivateVaultItemMetadataBatch(
    ownerUserId: string,
    updates: PrivateVaultItemMetadataUpdate[]
  ): Promise<StoredPrivateVaultItem[]> {
    const currentRecords = await Promise.all(
      updates.map((update) => this.getPrivateVaultItem(ownerUserId, update.itemId))
    );
    if (currentRecords.some((record) => !record)) {
      throw new PrivateVaultItemAccessError();
    }
    const updatedAt = nowIso();
    return updates.map((update, updateIndex) => {
      const current = currentRecords[updateIndex] as StoredPrivateVaultItem;
      const itemIndex = this.privateVaultItems.findIndex((item) => item.itemId === current.itemId);
      const record = { ...current, encryptedMetadata: update.encryptedMetadata, updatedAt };
      this.privateVaultItems[itemIndex] = record;
      return record;
    });
  }

  async softDeletePrivateVaultItem(ownerUserId: string, itemId: string): Promise<StoredPrivateVaultItem | null> {
    const current = await this.getPrivateVaultItem(ownerUserId, itemId);
    if (!current) return null;
    const index = this.privateVaultItems.findIndex((item) => item.itemId === itemId);
    const now = nowIso();
    this.privateVaultItems[index] = { ...current, deletedAt: now, updatedAt: now };
    return this.privateVaultItems[index];
  }

  async restorePrivateVaultItem(ownerUserId: string, itemId: string): Promise<StoredPrivateVaultItem | null> {
    const current = await this.getPrivateVaultItem(ownerUserId, itemId, true);
    if (!current?.deletedAt) return null;
    const index = this.privateVaultItems.findIndex((item) => item.itemId === itemId);
    this.privateVaultItems[index] = { ...current, deletedAt: null, updatedAt: nowIso() };
    return this.privateVaultItems[index];
  }

  async purgePrivateVaultItem(ownerUserId: string, itemId: string): Promise<StoredPrivateVaultItem | null> {
    const current = await this.getPrivateVaultItem(ownerUserId, itemId, true);
    if (!current) return null;
    this.privateVaultItems = this.privateVaultItems.filter((item) => item.itemId !== itemId);
    this.queueStorageCleanup(current.objectKey);
    return current;
  }

  async listTags(): Promise<Tag[]> {
    return this.tags;
  }

  async createTag(name: string, color: string): Promise<Tag> {
    const record: Tag = { tagId: crypto.randomUUID(), name, color };
    this.tags.push(record);
    return record;
  }

  async updateTag(tagId: string, name: string, color: string): Promise<Tag | null> {
    const index = this.tags.findIndex((item) => item.tagId === tagId);
    if (index === -1) return null;
    this.tags[index] = { ...this.tags[index], name, color };
    this.cases = this.cases.map((caseRecord) => ({
      ...caseRecord,
      tags: caseRecord.tags.map((tag) => (tag.tagId === tagId ? this.tags[index] : tag))
    }));
    this.documents = this.documents.map((document) => ({
      ...document,
      tags: document.tags.map((tag) => (tag.tagId === tagId ? this.tags[index] : tag))
    }));
    return this.tags[index];
  }

  async deleteTag(tagId: string): Promise<boolean> {
    const exists = this.tags.some((item) => item.tagId === tagId);
    if (!exists) return false;
    this.tags = this.tags.filter((item) => item.tagId !== tagId);
    this.cases = this.cases.map((caseRecord) => ({
      ...caseRecord,
      tags: caseRecord.tags.filter((tag) => tag.tagId !== tagId)
    }));
    this.documents = this.documents.map((document) => ({
      ...document,
      tags: document.tags.filter((tag) => tag.tagId !== tagId)
    }));
    return true;
  }

  async listNotes(caseId: string): Promise<NoteRecord[]> {
    return this.notes.filter((item) => item.caseId === caseId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createNote(input: CreateNoteInput): Promise<NoteRecord> {
    const user = this.users.find((item) => item.userId === input.createdBy);
    const record: NoteRecord = {
      noteId: crypto.randomUUID(),
      createdAt: nowIso(),
      createdByName: user?.name ?? "Unknown User",
      ...input
    };
    this.notes.unshift(record);
    return record;
  }

  private discussionMentionsFor(messageId: string): ServiceDiscussionMention[] {
    return this.serviceDiscussionMentions
      .filter((mention) => mention.messageId === messageId)
      .map((mention) => ({
        ...mention,
        userName: this.users.find((user) => user.userId === mention.userId)?.name ?? mention.userName
      }))
      .sort((a, b) => a.userName.localeCompare(b.userName));
  }

  private discussionAssetLinksFor(messageId: string): ServiceDiscussionAssetLink[] {
    return this.serviceDiscussionAssetLinks
      .filter((link) => link.messageId === messageId)
      .map((link) => {
        const asset = this.assets.find((item) => item.assetId === link.assetId);
        const caseRecord = asset?.caseId ? this.cases.find((item) => item.caseId === asset.caseId) : null;
        const user = link.createdBy ? this.users.find((item) => item.userId === link.createdBy) : null;
        return {
          ...link,
          assetName: asset?.name ?? link.assetName,
          assetType: asset?.assetType ?? link.assetType,
          caseId: asset?.caseId ?? link.caseId ?? null,
          caseNumber: caseRecord?.caseNumber ?? link.caseNumber ?? null,
          createdByName: user?.name ?? link.createdByName ?? null
        };
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private replaceDiscussionMentions(messageId: string, userIds: string[] = []) {
    const uniqueUserIds = [...new Set(userIds)].filter((userId) => this.users.some((user) => user.userId === userId));
    this.serviceDiscussionMentions = this.serviceDiscussionMentions.filter((mention) => mention.messageId !== messageId);
    this.serviceDiscussionMentions.push(
      ...uniqueUserIds.map((userId) => ({
        messageId,
        userId,
        userName: this.users.find((user) => user.userId === userId)?.name ?? "Unknown User",
        createdAt: nowIso()
      }))
    );
  }

  private enrichServiceDiscussionMessage(item: ServiceDiscussionMessage, userId?: string): ServiceDiscussionMessage {
    const createdBy = this.users.find((user) => user.userId === item.createdBy);
    const updatedBy = item.updatedBy ? this.users.find((user) => user.userId === item.updatedBy) : null;
    const threadOwner = item.threadOwnerUserId ? this.users.find((user) => user.userId === item.threadOwnerUserId) : null;
    const caseRecord = item.caseId ? this.cases.find((record) => record.caseId === item.caseId) : null;
    const read = userId ? this.serviceDiscussionReads.find((record) => record.messageId === item.messageId && record.userId === userId) : null;
    const attachments = item.attachments
      .map((attachment) => {
        const document = this.documents.find((record) => record.documentId === attachment.documentId && !record.deletedAt);
        return document ? { ...attachment, document } : null;
      })
      .filter((attachment): attachment is ServiceDiscussionAttachment => Boolean(attachment))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
    return {
      ...item,
      caseId: item.caseId ?? null,
      caseNumber: caseRecord?.caseNumber ?? item.caseNumber ?? null,
      caseTitle: caseRecord?.propertyAddress ?? item.caseTitle ?? null,
      caseStatus: caseRecord?.status ?? item.caseStatus ?? null,
      visibility: item.visibility ?? "team",
      threadStatus: item.threadStatus ?? "open",
      threadOwnerUserId: item.threadOwnerUserId ?? null,
      threadOwnerUserName: threadOwner?.name ?? item.threadOwnerUserName ?? null,
      createdByName: createdBy?.name ?? item.createdByName ?? "Unknown User",
      updatedByName: updatedBy?.name ?? item.updatedByName ?? null,
      replyCount: this.serviceDiscussionMessages.filter(
        (message) => message.parentMessageId === item.messageId && !message.deletedAt
      ).length,
      attachments,
      mentions: this.discussionMentionsFor(item.messageId),
      assetLinks: this.discussionAssetLinksFor(item.messageId),
      readAt: read?.readAt ?? null,
      isUnread: Boolean(userId && item.createdBy !== userId && !read)
    };
  }

  async listServiceDiscussion(caseId: string, userId?: string): Promise<ServiceDiscussionMessage[]> {
    return this.serviceDiscussionMessages
      .filter((item) => item.caseId === caseId && !item.deletedAt)
      .map((item) => this.enrichServiceDiscussionMessage(item, userId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listServiceDiscussionsPage(
    filters: ServiceDiscussionFilters = {},
    pagination: PaginationParams = {},
    userId?: string
  ): Promise<PaginatedResult<ServiceDiscussionMessage>> {
    const q = filters.q?.trim() ?? "";
    const view = filters.view ?? "all";
    const sort = filters.sort ?? "newest";
    const allRows = this.serviceDiscussionMessages
      .filter((item) => !item.deletedAt)
      .map((item) => this.enrichServiceDiscussionMessage(item, userId))
      .filter((item) => {
        if (item.caseId) {
          const service = this.cases.find((record) => record.caseId === item.caseId);
          if (!service || service.deletedAt) return false;
        }
        return true;
      })
      .filter((item) => !filters.caseId || item.caseId === filters.caseId);
    const messageMatches = (item: ServiceDiscussionMessage) =>
      !q ||
      matchText(
        [
          item.title,
          item.bodyText,
          item.messageId,
          item.createdByName,
          item.threadOwnerUserName,
          item.caseNumber,
          item.caseTitle,
          item.messageType,
          ...item.mentions.map((mention) => mention.userName),
          ...item.attachments.map((attachment) => attachment.document.originalFileName)
        ]
          .filter(Boolean)
          .join(" "),
        q
      );
    const rows = allRows
      .filter((item) => !item.parentMessageId)
      .map((item) => {
        const replies = allRows
          .filter((reply) => reply.parentMessageId === item.messageId)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const latestActivityAt = [item, ...replies].reduce(
          (latest, entry) => (entry.updatedAt > latest ? entry.updatedAt : latest),
          item.updatedAt
        );
        return { ...item, replies, replyCount: replies.length, latestActivityAt };
      })
      .filter(
        (item) =>
          !filters.assetId ||
          [item, ...(item.replies ?? [])].some((message) =>
            message.assetLinks.some((link) => link.assetId === filters.assetId)
          )
      )
      .filter((item) => {
        const thread = [item, ...(item.replies ?? [])];
        if (view === "unlinked") return !item.caseId;
        if (view === "pinned") return thread.some((message) => message.isPinned);
        if (view === "decisions") return thread.some((message) => message.messageType === "decision");
        if (view === "needs-action") return item.threadStatus === "needs-action";
        if (view === "resolved") return item.threadStatus === "resolved";
        if (view === "my-attention") {
          return Boolean(
            userId &&
              item.threadStatus !== "resolved" &&
              item.threadStatus !== "archived" &&
              (item.threadOwnerUserId === userId ||
                thread.some((message) => message.isUnread) ||
                thread.some((message) => message.mentions.some((mention) => mention.userId === userId)))
          );
        }
        if (view === "attachments") return thread.some((message) => message.attachments.length > 0);
        if (view === "mentions") return Boolean(userId && thread.some((message) => message.mentions.some((mention) => mention.userId === userId)));
        if (view === "unread") return thread.some((message) => Boolean(message.isUnread));
        return true;
      })
      .filter((item) => messageMatches(item) || (item.replies ?? []).some(messageMatches))
      .sort((a, b) => {
        if (sort === "oldest") return a.createdAt.localeCompare(b.createdAt);
        if (sort === "recent") return (b.latestActivityAt ?? b.updatedAt).localeCompare(a.latestActivityAt ?? a.updatedAt);
        return b.createdAt.localeCompare(a.createdAt);
      });
    return paginateArray(rows, pagination);
  }

  async getServiceDiscussionSummary(
    filters: ServiceDiscussionFilters = {},
    userId?: string
  ): Promise<ServiceDiscussionSummary> {
    const count = async (view: ServiceDiscussionFilters["view"]) =>
      (await this.listServiceDiscussionsPage({ ...filters, view }, { page: 1, pageSize: 10 }, userId)).total;
    const [all, myAttention, unread, mentions, needsAction, resolved, pinned, decisions, attachments, unlinked] =
      await Promise.all([
        count("all"),
        count("my-attention"),
        count("unread"),
        count("mentions"),
        count("needs-action"),
        count("resolved"),
        count("pinned"),
        count("decisions"),
        count("attachments"),
        count("unlinked")
      ]);
    return { all, myAttention, unread, mentions, needsAction, resolved, pinned, decisions, attachments, unlinked };
  }

  async getServiceDiscussionMessage(messageId: string): Promise<ServiceDiscussionMessage | null> {
    const message = this.serviceDiscussionMessages.find((item) => item.messageId === messageId && !item.deletedAt);
    return message ? this.enrichServiceDiscussionMessage(message) : null;
  }

  async createServiceDiscussionMessage(input: CreateServiceDiscussionMessageInput): Promise<ServiceDiscussionMessage> {
    const user = this.users.find((item) => item.userId === input.createdBy);
    const now = nowIso();
    const record: ServiceDiscussionMessage = {
      messageId: crypto.randomUUID(),
      managementOwnerUserId: input.createdBy,
      title: input.parentMessageId ? null : resolveDiscussionTitle(input.title, input.bodyText),
      caseId: input.caseId ?? null,
      parentMessageId: input.parentMessageId ?? null,
      bodyText: input.bodyText.trim(),
      messageType: input.messageType ?? "message",
      visibility: input.visibility ?? "team",
      threadStatus: input.threadStatus ?? "open",
      threadOwnerUserId: input.threadOwnerUserId ?? null,
      threadOwnerUserName: null,
      isPinned: Boolean(input.isPinned),
      replyCount: 0,
      attachments: [],
      mentions: [],
      assetLinks: [],
      readAt: null,
      isUnread: false,
      createdBy: input.createdBy,
      createdByName: user?.name ?? "Unknown User",
      updatedBy: input.updatedBy ?? input.createdBy,
      updatedByName: user?.name ?? "Unknown User",
      createdAt: now,
      updatedAt: now,
      editedAt: null,
      deletedAt: null
    };
    this.serviceDiscussionMessages.push(record);
    await this.retainArchiveContentDocuments("discussion", record.messageId, archiveDocumentCandidates(record.bodyText));
    this.replaceDiscussionMentions(record.messageId, input.mentionedUserIds);
    return this.enrichServiceDiscussionMessage(record);
  }

  async updateServiceDiscussionMessage(
    messageId: string,
    input: UpdateServiceDiscussionMessageInput
  ): Promise<ServiceDiscussionMessage | null> {
    const index = this.serviceDiscussionMessages.findIndex((item) => item.messageId === messageId && !item.deletedAt);
    if (index === -1) return null;
    const current = this.serviceDiscussionMessages[index];
    const bodyChanged = input.bodyText !== undefined && input.bodyText.trim() !== current.bodyText;
    const nextBodyText = input.bodyText === undefined ? current.bodyText : input.bodyText.trim();
    const nextTitle = current.parentMessageId
      ? null
      : input.title === undefined
        ? resolveDiscussionTitle(current.title, nextBodyText)
        : resolveDiscussionTitle(input.title, nextBodyText);
    const titleChanged = nextTitle !== (current.title ?? null);
    const rootId = current.parentMessageId ?? current.messageId;
    const nextThreadStatus = input.threadStatus ?? current.threadStatus ?? "open";
    const nextThreadOwnerUserId =
      input.threadOwnerUserId === undefined ? current.threadOwnerUserId ?? null : input.threadOwnerUserId ?? null;
    this.serviceDiscussionMessages[index] = {
      ...current,
      title: nextTitle,
      bodyText: nextBodyText,
      messageType: input.messageType ?? current.messageType,
      threadStatus: nextThreadStatus,
      threadOwnerUserId: nextThreadOwnerUserId,
      isPinned: input.isPinned ?? current.isPinned,
      updatedBy: input.updatedBy ?? current.updatedBy ?? null,
      updatedAt: nowIso(),
      editedAt: bodyChanged || titleChanged ? nowIso() : current.editedAt ?? null
    };
    if (input.threadStatus !== undefined || input.threadOwnerUserId !== undefined) {
      const now = nowIso();
      this.serviceDiscussionMessages = this.serviceDiscussionMessages.map((message) =>
        !message.deletedAt && (message.messageId === rootId || message.parentMessageId === rootId)
          ? {
              ...message,
              threadStatus: nextThreadStatus,
              threadOwnerUserId: nextThreadOwnerUserId,
              updatedBy: input.updatedBy ?? message.updatedBy ?? null,
              updatedAt: now
            }
          : message
      );
    }
    if (input.mentionedUserIds) this.replaceDiscussionMentions(messageId, input.mentionedUserIds);
    await this.retainArchiveContentDocuments("discussion", messageId, archiveDocumentCandidates(nextBodyText));
    return this.getServiceDiscussionMessage(messageId);
  }

  async softDeleteServiceDiscussionMessage(messageId: string): Promise<ServiceDiscussionMessage | null> {
    const index = this.serviceDiscussionMessages.findIndex((item) => item.messageId === messageId && !item.deletedAt);
    if (index === -1) return null;
    this.serviceDiscussionMessages[index] = {
      ...this.serviceDiscussionMessages[index],
      deletedAt: nowIso(),
      updatedAt: nowIso()
    };
    return this.enrichServiceDiscussionMessage(this.serviceDiscussionMessages[index]);
  }

  async linkServiceDiscussionThread(messageId: string, caseId: string, updatedBy: string): Promise<ServiceDiscussionMessage[]> {
    const target = this.serviceDiscussionMessages.find((item) => item.messageId === messageId && !item.deletedAt);
    if (!target) return [];
    const rootId = target.parentMessageId ?? target.messageId;
    const now = nowIso();
    const linked: ServiceDiscussionMessage[] = [];
    this.serviceDiscussionMessages = this.serviceDiscussionMessages.map((message) => {
      if (message.messageId !== rootId && message.parentMessageId !== rootId) return message;
      const updated = { ...message, caseId, updatedBy, updatedAt: now };
      linked.push(updated);
      return updated;
    });
    const linkedMessageIds = new Set(linked.map((message) => message.messageId));
    const linkedDocumentIds = new Set(
      this.serviceDiscussionMessages
        .filter((message) => linkedMessageIds.has(message.messageId))
        .flatMap((message) => message.attachments.map((attachment) => attachment.documentId))
    );
    this.documents = this.documents.map((document) =>
      linkedDocumentIds.has(document.documentId) ? { ...document, caseId } : document
    );
    return linked.map((message) => this.enrichServiceDiscussionMessage(message));
  }

  async updateServiceDiscussionThreadContext(
    messageId: string,
    caseId: string | null,
    assetIds: string[],
    updatedBy: string
  ): Promise<ServiceDiscussionMessage[]> {
    const target = this.serviceDiscussionMessages.find((item) => item.messageId === messageId && !item.deletedAt);
    if (!target) return [];
    const rootId = target.parentMessageId ?? target.messageId;
    const now = nowIso();
    const updated: ServiceDiscussionMessage[] = [];
    this.serviceDiscussionMessages = this.serviceDiscussionMessages.map((message) => {
      if (message.messageId !== rootId && message.parentMessageId !== rootId) return message;
      const next = { ...message, caseId, updatedBy, updatedAt: now };
      updated.push(next);
      return next;
    });
    const threadMessageIds = new Set(updated.map((message) => message.messageId));
    const linkedDocumentIds = new Set(
      updated.flatMap((message) => message.attachments.map((attachment) => attachment.documentId))
    );
    this.documents = this.documents.map((document) =>
      linkedDocumentIds.has(document.documentId) ? { ...document, caseId } : document
    );
    this.serviceDiscussionAssetLinks = this.serviceDiscussionAssetLinks.filter(
      (link) => !threadMessageIds.has(link.messageId)
    );
    for (const assetId of [...new Set(assetIds)]) {
      const asset = this.assets.find((item) => item.assetId === assetId && !item.deletedAt);
      if (!asset) continue;
      const caseRecord = asset.caseId ? this.cases.find((item) => item.caseId === asset.caseId) : null;
      const user = this.users.find((item) => item.userId === updatedBy);
      this.serviceDiscussionAssetLinks.push({
        discussionAssetLinkId: crypto.randomUUID(),
        messageId: rootId,
        assetId,
        assetName: asset.name,
        assetType: asset.assetType,
        caseId: asset.caseId ?? null,
        caseNumber: caseRecord?.caseNumber ?? null,
        relationship: "discussion context",
        createdBy: updatedBy,
        createdByName: user?.name ?? null,
        createdAt: now
      });
    }
    return updated.map((message) => this.enrichServiceDiscussionMessage(message));
  }

  async markServiceDiscussionRead(messageId: string, userId: string): Promise<ServiceDiscussionMessage | null> {
    const message = this.serviceDiscussionMessages.find((item) => item.messageId === messageId && !item.deletedAt);
    if (!message) return null;
    const existing = this.serviceDiscussionReads.find((record) => record.messageId === messageId && record.userId === userId);
    if (existing) {
      existing.readAt = nowIso();
    } else {
      this.serviceDiscussionReads.push({ messageId, userId, readAt: nowIso() });
    }
    return this.enrichServiceDiscussionMessage(message, userId);
  }

  async markServiceDiscussionsRead(filters: ServiceDiscussionFilters, userId: string): Promise<number> {
    const page = await this.listServiceDiscussionsPage({ ...filters, view: filters.view === "unread" ? "unread" : filters.view }, { pageSize: 100 }, userId);
    const unreadIds = page.items
      .flatMap((message) => [message, ...(message.replies ?? [])])
      .filter((message) => message.isUnread)
      .map((message) => message.messageId);
    for (const messageId of unreadIds) {
      await this.markServiceDiscussionRead(messageId, userId);
    }
    return unreadIds.length;
  }

  async linkServiceDiscussionAsset(input: CreateServiceDiscussionAssetLinkInput): Promise<ServiceDiscussionAssetLink> {
    const message = this.serviceDiscussionMessages.find((item) => item.messageId === input.messageId && !item.deletedAt);
    if (!message) throw new Error("Discussion message not found");
    const asset = this.assets.find((item) => item.assetId === input.assetId && !item.deletedAt);
    if (!asset) throw new Error("Asset not found");
    const existingIndex = this.serviceDiscussionAssetLinks.findIndex(
      (link) => link.messageId === input.messageId && link.assetId === input.assetId
    );
    if (existingIndex !== -1) {
      this.serviceDiscussionAssetLinks[existingIndex] = {
        ...this.serviceDiscussionAssetLinks[existingIndex],
        relationship: input.relationship?.trim() || this.serviceDiscussionAssetLinks[existingIndex].relationship
      };
      return this.discussionAssetLinksFor(input.messageId).find((link) => link.assetId === input.assetId)!;
    }
    const caseRecord = asset.caseId ? this.cases.find((item) => item.caseId === asset.caseId) : null;
    const user = input.createdBy ? this.users.find((item) => item.userId === input.createdBy) : null;
    const link: ServiceDiscussionAssetLink = {
      discussionAssetLinkId: crypto.randomUUID(),
      messageId: input.messageId,
      assetId: input.assetId,
      assetName: asset.name,
      assetType: asset.assetType,
      caseId: asset.caseId ?? null,
      caseNumber: caseRecord?.caseNumber ?? null,
      relationship: input.relationship?.trim() || "related",
      createdBy: input.createdBy ?? null,
      createdByName: user?.name ?? null,
      createdAt: nowIso()
    };
    this.serviceDiscussionAssetLinks.push(link);
    return link;
  }

  async unlinkServiceDiscussionAsset(messageId: string, assetId: string): Promise<boolean> {
    const previousLength = this.serviceDiscussionAssetLinks.length;
    this.serviceDiscussionAssetLinks = this.serviceDiscussionAssetLinks.filter(
      (link) => link.messageId !== messageId || link.assetId !== assetId
    );
    return this.serviceDiscussionAssetLinks.length !== previousLength;
  }

  async createDocumentWithDiscussionAttachment(input: CreateDocumentInput, attachment: Omit<CreateServiceDiscussionAttachmentInput, "documentId">): Promise<ServiceDiscussionAttachment> {
    const document = await this.createDocument(input);
    try {
      return await this.createServiceDiscussionAttachment({ ...attachment, documentId: document.documentId });
    } catch (error) {
      this.documents = this.documents.filter((d) => d.documentId !== document.documentId);
      throw error;
    }
  }

  async createServiceDiscussionAttachment(
    input: CreateServiceDiscussionAttachmentInput
  ): Promise<ServiceDiscussionAttachment> {
    const messageIndex = this.serviceDiscussionMessages.findIndex(
      (item) => item.messageId === input.messageId && !item.deletedAt
    );
    if (messageIndex === -1) throw new Error("Discussion message not found");
    const document = await this.getDocument(input.documentId);
    if (!document) throw new Error("Document not found");
    const attachment: ServiceDiscussionAttachment = {
      attachmentId: crypto.randomUUID(),
      messageId: input.messageId,
      documentId: input.documentId,
      inlineImage: Boolean(input.inlineImage),
      sortOrder: input.sortOrder ?? this.serviceDiscussionMessages[messageIndex].attachments.length,
      createdAt: nowIso(),
      document
    };
    this.serviceDiscussionMessages[messageIndex] = {
      ...this.serviceDiscussionMessages[messageIndex],
      attachments: [...this.serviceDiscussionMessages[messageIndex].attachments, attachment],
      updatedAt: nowIso()
    };
    return attachment;
  }

  private knowledgeLinkLabel(link: KnowledgeLink): Pick<KnowledgeLink, "label" | "detail"> {
    if (link.entityType === "service") {
      const service = this.cases.find((item) => item.caseId === link.entityId);
      return {
        label: service ? `${service.caseNumber} - ${service.propertyAddress}` : null,
        detail: service?.status ?? null
      };
    }
    if (link.entityType === "asset") {
      const asset = this.assets.find((item) => item.assetId === link.entityId);
      return {
        label: asset?.name ?? null,
        detail: asset ? [asset.assetType, asset.hostname || asset.lanIp || asset.wanIp].filter(Boolean).join(" · ") : null
      };
    }
    if (link.entityType === "document") {
      const document = this.documents.find((item) => item.documentId === link.entityId);
      return {
        label: document?.originalFileName ?? null,
        detail: document ? [document.category, document.reviewStatus].filter(Boolean).join(" · ") : null
      };
    }
    if (link.entityType === "discussion") {
      const message = this.serviceDiscussionMessages.find((item) => item.messageId === link.entityId);
      const creator = message ? this.users.find((item) => item.userId === message.createdBy) : null;
      const service = message?.caseId ? this.cases.find((item) => item.caseId === message.caseId) : null;
      return {
        label: message ? `Discussion: ${discussionSnippet(message.bodyText)}` : null,
        detail: [message?.messageType, creator?.name, service?.caseNumber].filter(Boolean).join(" · ") || null
      };
    }
    const credential = this.assetCredentials.find((item) => item.credentialId === link.entityId);
    return {
      label: credential?.label ?? null,
      detail: credential ? [credential.credentialType, credential.username || credential.host].filter(Boolean).join(" · ") : null
    };
  }

  private normalizeKnowledgeLinks(
    knowledgeId: string,
    links: KnowledgeLinkInput[] = [],
    sourceServiceId?: string | null
  ): KnowledgeLink[] {
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
        knowledgeLinkId: crypto.randomUUID(),
        knowledgeId,
        entityType: link.entityType,
        entityId: link.entityId,
        relationship: link.relationship?.trim() || "related",
        label: null,
        detail: null,
        createdAt: nowIso()
      }));
  }

  private enrichKnowledge(item: KnowledgeItem): KnowledgeItem {
    const sourceService = item.sourceServiceId
      ? this.cases.find((record) => record.caseId === item.sourceServiceId)
      : null;
    const createdBy = item.createdBy ? this.users.find((user) => user.userId === item.createdBy) : null;
    const updatedBy = item.updatedBy ? this.users.find((user) => user.userId === item.updatedBy) : null;
    return {
      ...item,
      sourceServiceNumber: sourceService?.caseNumber ?? null,
      sourceServiceTitle: sourceService?.propertyAddress ?? null,
      createdByName: createdBy?.name ?? null,
      updatedByName: updatedBy?.name ?? null,
      links: item.links.map((link) => ({ ...link, ...this.knowledgeLinkLabel(link) }))
    };
  }

  async listKnowledge(filters: KnowledgeFilters = {}): Promise<KnowledgeItem[]> {
    const q = filters.q?.trim() ?? "";
    return this.knowledgeItems
      .filter((item) => filters.trashed ? Boolean(item.deletedAt) : !item.deletedAt)
      .map((item) => this.enrichKnowledge(item))
      .filter((item) => !filters.type || item.type === filters.type)
      .filter((item) => !filters.status || item.status === filters.status)
      .filter((item) => !filters.component || item.component === filters.component)
      .filter((item) => !filters.caseId || item.sourceServiceId === filters.caseId || item.links.some((link) => link.entityType === "service" && link.entityId === filters.caseId))
      .filter((item) => !filters.assetId || item.links.some((link) => link.entityType === "asset" && link.entityId === filters.assetId))
      .filter((item) => !filters.documentId || item.links.some((link) => link.entityType === "document" && link.entityId === filters.documentId))
      .filter((item) => {
        if (!q) return true;
        return matchText(
          [
            item.title,
            item.type,
            item.status,
            item.component,
            item.summary,
            item.body,
            item.credentialReference,
            item.sourceServiceNumber,
            item.sourceServiceTitle,
            ...item.keywords,
            ...item.links.flatMap((link) => [link.label ?? "", link.detail ?? ""])
          ].join(" "),
          q
        );
      })
      .sort((a, b) => {
        const direction = filters.direction === "asc" ? 1 : -1;
        if (filters.sort === "title") return direction * naturalCompare(a.title, b.title);
        if (filters.sort === "type") return direction * a.type.localeCompare(b.type);
        if (filters.sort === "status") return direction * a.status.localeCompare(b.status);
        if (filters.sort === "component") return direction * a.component.localeCompare(b.component);
        if (filters.sort === "verified") return direction * (a.lastVerifiedAt ?? "").localeCompare(b.lastVerifiedAt ?? "");
        return direction * a.updatedAt.localeCompare(b.updatedAt);
      });
  }

  async listKnowledgePage(filters: KnowledgeFilters = {}, pagination: PaginationParams = {}): Promise<PaginatedResult<KnowledgeItem>> {
    return paginateArray(await this.listKnowledge(filters), pagination);
  }

  async getKnowledge(knowledgeId: string, options: { includeDeleted?: boolean } = {}): Promise<KnowledgeItem | null> {
    const item = this.knowledgeItems.find(
      (record) => record.knowledgeId === knowledgeId && (options.includeDeleted || !record.deletedAt)
    );
    return item ? this.enrichKnowledge(item) : null;
  }

  async createKnowledge(input: CreateKnowledgeInput): Promise<KnowledgeItem> {
    const now = nowIso();
    const knowledgeId = crypto.randomUUID();
    const sourceServiceId = input.sourceServiceId || input.links?.find((link) => link.entityType === "service")?.entityId || null;
    const record: KnowledgeItem = {
      knowledgeId,
      managementOwnerUserId: input.createdBy ?? null,
      title: input.title.trim(),
      type: input.type,
      status: input.status,
      component: input.component.trim(),
      summary: input.summary.trim(),
      body: input.body.trim(),
      keywords: [...new Set((input.keywords ?? []).map((keyword) => keyword.trim()).filter(Boolean))],
      credentialReference: input.credentialReference?.trim() ?? "",
      sourceServiceId,
      sourceServiceNumber: null,
      sourceServiceTitle: null,
      lastVerifiedAt: input.lastVerifiedAt || null,
      createdBy: input.createdBy ?? null,
      updatedBy: input.updatedBy ?? input.createdBy ?? null,
      createdByName: null,
      updatedByName: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      links: this.normalizeKnowledgeLinks(knowledgeId, input.links, sourceServiceId)
    };
    this.knowledgeItems.unshift(record);
    await this.retainArchiveContentDocuments("knowledge", knowledgeId, [...archiveDocumentCandidates(record.body), ...record.links.filter((l) => l.entityType === "document").map((l) => l.entityId)]);
    return this.enrichKnowledge(record);
  }

  async updateKnowledge(knowledgeId: string, input: UpdateKnowledgeInput): Promise<KnowledgeItem | null> {
    const index = this.knowledgeItems.findIndex((item) => item.knowledgeId === knowledgeId && !item.deletedAt);
    if (index === -1) return null;
    const current = this.knowledgeItems[index];
    const sourceServiceId =
      input.sourceServiceId === undefined
        ? current.sourceServiceId ?? null
        : input.sourceServiceId || input.links?.find((link) => link.entityType === "service")?.entityId || null;
    this.knowledgeItems[index] = {
      ...current,
      title: input.title === undefined ? current.title : input.title.trim(),
      type: input.type ?? current.type,
      status: input.status ?? current.status,
      component: input.component === undefined ? current.component : input.component.trim(),
      summary: input.summary === undefined ? current.summary : input.summary.trim(),
      body: input.body === undefined ? current.body : input.body.trim(),
      keywords:
        input.keywords === undefined
          ? current.keywords
          : [...new Set(input.keywords.map((keyword) => keyword.trim()).filter(Boolean))],
      credentialReference:
        input.credentialReference === undefined ? current.credentialReference : input.credentialReference.trim(),
      sourceServiceId,
      lastVerifiedAt: input.lastVerifiedAt === undefined ? current.lastVerifiedAt ?? null : input.lastVerifiedAt || null,
      updatedBy: input.updatedBy ?? current.updatedBy ?? null,
      updatedAt: nowIso(),
      links: input.links === undefined ? current.links : this.normalizeKnowledgeLinks(knowledgeId, input.links, sourceServiceId)
    };
    await this.retainArchiveContentDocuments("knowledge", knowledgeId, [...archiveDocumentCandidates(this.knowledgeItems[index].body), ...this.knowledgeItems[index].links.filter((l) => l.entityType === "document").map((l) => l.entityId)]);
    return this.enrichKnowledge(this.knowledgeItems[index]);
  }

  async softDeleteKnowledge(knowledgeId: string): Promise<KnowledgeItem | null> {
    const index = this.knowledgeItems.findIndex((item) => item.knowledgeId === knowledgeId && !item.deletedAt);
    if (index === -1) return null;
    this.knowledgeItems[index] = {
      ...this.knowledgeItems[index],
      deletedAt: nowIso(),
      updatedAt: nowIso()
    };
    return this.enrichKnowledge(this.knowledgeItems[index]);
  }

  async restoreKnowledge(knowledgeId: string): Promise<KnowledgeItem | null> {
    const index = this.knowledgeItems.findIndex((item) => item.knowledgeId === knowledgeId && item.deletedAt);
    if (index === -1) return null;
    this.knowledgeItems[index] = {
      ...this.knowledgeItems[index],
      deletedAt: null,
      updatedAt: nowIso()
    };
    return this.enrichKnowledge(this.knowledgeItems[index]);
  }

  async purgeKnowledge(knowledgeId: string): Promise<KnowledgeItem | null> {
    const index = this.knowledgeItems.findIndex((item) => item.knowledgeId === knowledgeId && item.deletedAt);
    if (index === -1) return null;
    const [removed] = this.knowledgeItems.splice(index, 1);
    return this.enrichKnowledge(removed);
  }

  private enrichManuscript(item: Manuscript): Manuscript {
    const chapters = this.manuscriptChapters
      .filter((chapter) => chapter.manuscriptId === item.manuscriptId && !chapter.deletedAt)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
    const createdBy = item.createdBy ? this.users.find((user) => user.userId === item.createdBy) : null;
    const updatedBy = item.updatedBy ? this.users.find((user) => user.userId === item.updatedBy) : null;
    return {
      ...item,
      chapterCount: chapters.length,
      characterCount: chapters.reduce((total, chapter) => total + chapter.characterCount, 0),
      createdByName: createdBy?.name ?? null,
      updatedByName: updatedBy?.name ?? null,
      chapters: chapters.map(({ body: _body, deletedAt: _deletedAt, lastSavedBy: _lastSavedBy, ...chapter }) => ({
        ...chapter,
        contentFormat: chapter.contentFormat ?? "rich-text"
      }))
    };
  }

  async listManuscripts(query = ""): Promise<Manuscript[]> {
    const q = query.trim();
    return this.manuscripts
      .filter((item) => !item.deletedAt)
      .map((item) => this.enrichManuscript(item))
      .filter((item) => {
        if (!q) return true;
        const chapterText = this.manuscriptChapters
          .filter((chapter) => chapter.manuscriptId === item.manuscriptId && !chapter.deletedAt)
          .flatMap((chapter) => [chapter.title, chapter.body]);
        return matchText([item.title, item.kind, item.status, item.description, ...chapterText].join(" "), q);
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getManuscript(manuscriptId: string): Promise<Manuscript | null> {
    const item = this.manuscripts.find((record) => record.manuscriptId === manuscriptId && !record.deletedAt);
    return item ? this.enrichManuscript(item) : null;
  }

  async listManuscriptBookmarks(userId: string, manuscriptId: string): Promise<ManuscriptBookmark[]> {
    if (!this.manuscripts.some((m) => m.manuscriptId === manuscriptId && !m.deletedAt)) return [];
    return structuredClone(this.manuscriptBookmarks.filter((b) => b.userId === userId && b.manuscriptId === manuscriptId));
  }

  async createManuscriptBookmark(userId: string, manuscriptId: string, input: ManuscriptBookmarkInput): Promise<ManuscriptBookmark | null> {
    const work = this.manuscripts.find((m) => m.manuscriptId === manuscriptId && !m.deletedAt);
    const chapter = this.manuscriptChapters.find((c) => c.manuscriptId === manuscriptId && c.chapterId === input.chapterId && !c.deletedAt);
    if (!work || !chapter) return null;
    const value = bookmarkForStorage(input, chapter.revision, chapter.contentFormat, work.encryptionEnabled);
    const existing = this.manuscriptBookmarks.find((b) => b.userId === userId && b.manuscriptId === manuscriptId && b.chapterId === value.chapterId
      && ["revision", "version", "format", "block", "offset", "kind"].every((key) => b.anchor[key as keyof typeof b.anchor] === value.anchor[key as keyof typeof value.anchor]));
    if (existing) return structuredClone(existing);
    if (this.manuscriptBookmarks.filter((b) => b.userId === userId && b.manuscriptId === manuscriptId).length >= 500) throw new BookmarkConflictError("This work has reached the 500 bookmark limit.");
    const now = nowIso();
    const bookmark: ManuscriptBookmark = { ...value, bookmarkId: crypto.randomUUID(), userId, manuscriptId, positionOnly: work.encryptionEnabled, createdAt: now, updatedAt: now };
    this.manuscriptBookmarks.push(bookmark);
    return structuredClone(bookmark);
  }

  async renameManuscriptBookmark(userId: string, manuscriptId: string, bookmarkId: string, name: string): Promise<ManuscriptBookmark | null> {
    const work = this.manuscripts.find((m) => m.manuscriptId === manuscriptId && !m.deletedAt);
    const bookmark = this.manuscriptBookmarks.find((b) => b.userId === userId && b.manuscriptId === manuscriptId && b.bookmarkId === bookmarkId);
    if (!work || !bookmark) return null;
    if (work.encryptionEnabled) throw new BookmarkConflictError("Encrypted works use neutral bookmark names.");
    if (name.trim().length > 120) throw new BookmarkConflictError("Bookmark name is too long.");
    bookmark.name = name.trim(); bookmark.updatedAt = nowIso();
    return structuredClone(bookmark);
  }

  async deleteManuscriptBookmark(userId: string, manuscriptId: string, bookmarkId: string): Promise<boolean> {
    const index = this.manuscriptBookmarks.findIndex((b) => b.userId === userId && b.manuscriptId === manuscriptId && b.bookmarkId === bookmarkId);
    if (index < 0) return false;
    this.manuscriptBookmarks.splice(index, 1); return true;
  }

  async createManuscript(input: CreateManuscriptInput): Promise<Manuscript> {
    if (input.createdBy && !this.users.some((user) => user.userId === input.createdBy)) throw new Error("Manuscript creator does not exist.");
    const now = nowIso();
    const manuscriptId = crypto.randomUUID();
    const record: Manuscript = {
      manuscriptId,
      managementOwnerUserId: input.createdBy ?? null,
      keyOwnerUserId: input.createdBy ?? null,
      title: input.title.trim(),
      kind: input.kind,
      status: input.status,
      description: input.description?.trim() ?? "",
      encryptionEnabled: false,
      encryptionVersion: null,
      encryptionKdf: null,
      encryptionIterations: null,
      encryptionSalt: null,
      encryptedWorkKey: null,
      recoveryEncryptedWorkKey: null,
      encryptionUpdatedAt: null,
      chapterCount: 0,
      characterCount: 0,
      createdBy: input.createdBy ?? null,
      createdByName: null,
      updatedBy: input.updatedBy ?? input.createdBy ?? null,
      updatedByName: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      chapters: []
    };
    this.manuscripts.unshift(record);
    this.manuscriptChapters.push({
      chapterId: crypto.randomUUID(),
      manuscriptId,
      title: "Chapter 1",
      body: "",
      contentFormat: "rich-text",
      sortOrder: 1000,
      characterCount: 0,
      revision: 1,
      lastSaveSource: "manual",
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    });
    return this.enrichManuscript(record);
  }

  async claimManuscriptKeyOwner(input: ManuscriptKeyOwnerClaimInput): Promise<void> {
    const claim = manuscriptKeyOwnerClaimSchema.parse(input);
    const work = this.manuscripts.find((item) => item.manuscriptId === claim.manuscriptId);
    if (!work || work.keyOwnerUserId || new Date(work.updatedAt).getTime() !== new Date(claim.expectedUpdatedAt).getTime()) {
      throw new Error("Key ownership review is stale or already claimed.");
    }
    if (!this.users.some((user) => user.userId === claim.ownerUserId)) throw new Error("Key owner does not exist.");
    // No await between validation, audit insertion and state transition.
    this.manuscriptKeyOwnerClaims.push({
      claim_id: crypto.randomUUID(), manuscript_id: claim.manuscriptId, owner_user_id: claim.ownerUserId,
      previous_updated_at: claim.expectedUpdatedAt, evidence_reference: claim.evidenceReference,
      operator_reference: claim.operatorReference, recorded_by: "memory-maintenance", created_at: nowIso()
    });
    work.keyOwnerUserId = claim.ownerUserId;
  }

  async listUnresolvedManuscriptKeyOwnership() {
    return this.manuscripts.filter((work) => !work.keyOwnerUserId).map((work) => ({
      manuscriptId: work.manuscriptId, createdBy: work.createdBy ?? null,
      expectedUpdatedAt: work.updatedAt, encryptionEnabled: work.encryptionEnabled, deleted: Boolean(work.deletedAt)
    })).sort((a, b) => a.manuscriptId.localeCompare(b.manuscriptId));
  }

  async updateManuscript(manuscriptId: string, input: UpdateManuscriptInput): Promise<Manuscript | null> {
    const index = this.manuscripts.findIndex((item) => item.manuscriptId === manuscriptId && !item.deletedAt);
    if (index === -1) return null;
    const current = this.manuscripts[index];
    this.manuscripts[index] = {
      ...current,
      title: input.title === undefined ? current.title : input.title.trim(),
      kind: input.kind ?? current.kind,
      status: input.status ?? current.status,
      description: input.description === undefined ? current.description : input.description.trim(),
      updatedBy: input.updatedBy ?? current.updatedBy ?? null,
      updatedAt: nowIso()
    };
    return this.enrichManuscript(this.manuscripts[index]);
  }

  async replaceManuscriptBodyEncryption(
    manuscriptId: string,
    input: ManuscriptBodyEncryptionInput,
    enable: boolean,
    updatedBy?: string | null
  ): Promise<Manuscript | null> {
    const manuscriptIndex = this.manuscripts.findIndex((item) => item.manuscriptId === manuscriptId && !item.deletedAt);
    if (manuscriptIndex === -1) return null;
    const record = this.manuscripts[manuscriptIndex];
    if (record.encryptionEnabled === enable) {
      throw new ManuscriptEncryptionConflictError(enable ? "This work is already encrypted." : "This work is not encrypted.");
    }
    const chapters = this.manuscriptChapters.filter((chapter) => chapter.manuscriptId === manuscriptId && !chapter.deletedAt);
    const chapterInputs = new Map(input.chapters.map((chapter) => [chapter.chapterId, chapter]));
    if (chapterInputs.size !== input.chapters.length || chapterInputs.size !== chapters.length
      || chapters.some((chapter) => chapterInputs.get(chapter.chapterId)?.expectedRevision !== chapter.revision)) {
      throw new ManuscriptEncryptionConflictError();
    }
    const versions = this.manuscriptChapterVersions.filter((version) => version.manuscriptId === manuscriptId);
    const versionInputs = new Map(input.versions.map((version) => [version.versionId, version]));
    if (versionInputs.size !== input.versions.length || versionInputs.size !== versions.length
      || versions.some((version) => versionInputs.get(version.versionId)?.chapterId !== version.chapterId)) {
      throw new ManuscriptEncryptionConflictError();
    }
    if (enable && !input.metadata) throw new ManuscriptEncryptionConflictError("Encryption metadata is missing.");
    const referenceIds = [...chapters, ...versions, ...input.chapters, ...input.versions].flatMap((item) => archiveDocumentCandidates(item.body));
    if (enable) for (const bookmark of this.manuscriptBookmarks.filter((b) => b.manuscriptId === manuscriptId)) {
      bookmark.name = ""; bookmark.anchor = positionOnlyAnchor(bookmark.anchor); bookmark.positionOnly = true; bookmark.updatedAt = nowIso();
    }
    chapters.forEach((chapter) => { chapter.body = chapterInputs.get(chapter.chapterId)!.body; });
    versions.forEach((version) => { version.body = versionInputs.get(version.versionId)!.body; });
    const now = nowIso();
    this.manuscripts[manuscriptIndex] = {
      ...record,
      encryptionEnabled: enable,
      encryptionVersion: enable ? input.metadata!.encryptionVersion : null,
      encryptionKdf: enable ? input.metadata!.encryptionKdf : null,
      encryptionIterations: enable ? input.metadata!.encryptionIterations : null,
      encryptionSalt: enable ? input.metadata!.encryptionSalt : null,
      encryptedWorkKey: enable ? input.metadata!.encryptedWorkKey : null,
      recoveryEncryptedWorkKey: enable ? input.metadata!.recoveryEncryptedWorkKey : null,
      encryptionUpdatedAt: now,
      updatedBy: updatedBy ?? null,
      updatedAt: now
    };
    await this.retainArchiveContentDocuments("manuscript", manuscriptId, referenceIds);
    return this.enrichManuscript(this.manuscripts[manuscriptIndex]);
  }

  async updateManuscriptEncryptionKey(
    manuscriptId: string,
    metadata: ManuscriptEncryptionMetadata,
    updatedBy?: string | null
  ): Promise<Manuscript | null> {
    const index = this.manuscripts.findIndex((item) => item.manuscriptId === manuscriptId
      && !item.deletedAt
      && item.encryptionEnabled
      && item.recoveryEncryptedWorkKey === metadata.recoveryEncryptedWorkKey);
    if (index === -1) return null;
    this.manuscripts[index] = {
      ...this.manuscripts[index],
      ...metadata,
      encryptionUpdatedAt: nowIso(),
      updatedBy: updatedBy ?? null,
      updatedAt: nowIso()
    };
    return this.enrichManuscript(this.manuscripts[index]);
  }

  async softDeleteManuscript(manuscriptId: string): Promise<Manuscript | null> {
    const index = this.manuscripts.findIndex((item) => item.manuscriptId === manuscriptId && !item.deletedAt);
    if (index === -1) return null;
    this.manuscripts[index] = {
      ...this.manuscripts[index],
      status: "Archived",
      deletedAt: nowIso(),
      updatedAt: nowIso()
    };
    return this.enrichManuscript(this.manuscripts[index]);
  }

  async getManuscriptChapter(manuscriptId: string, chapterId: string): Promise<ManuscriptChapter | null> {
    const manuscript = await this.getManuscript(manuscriptId);
    if (!manuscript) return null;
    const chapter = this.manuscriptChapters.find(
      (item) => item.manuscriptId === manuscriptId && item.chapterId === chapterId && !item.deletedAt
    );
    if (!chapter) return null;
    const { deletedAt: _deletedAt, lastSavedBy: _lastSavedBy, ...result } = chapter;
    return { ...result, contentFormat: result.contentFormat ?? "rich-text" };
  }

  async listManuscriptChapterVersions(
    manuscriptId: string,
    chapterId: string,
    limit = 50
  ): Promise<ManuscriptChapterVersionSummary[]> {
    if (!(await this.getManuscriptChapter(manuscriptId, chapterId))) return [];
    return this.manuscriptChapterVersions
      .filter((version) => version.manuscriptId === manuscriptId && version.chapterId === chapterId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.revision - left.revision)
      .slice(0, Math.min(MANUSCRIPT_CHAPTER_VERSION_RETENTION, Math.max(1, limit)))
      .map(({ body: _body, ...summary }) => summary);
  }

  async getManuscriptChapterVersion(
    manuscriptId: string,
    chapterId: string,
    versionId: string
  ): Promise<ManuscriptChapterVersion | null> {
    if (!(await this.getManuscriptChapter(manuscriptId, chapterId))) return null;
    return this.manuscriptChapterVersions.find(
      (version) => version.manuscriptId === manuscriptId && version.chapterId === chapterId && version.versionId === versionId
    ) ?? null;
  }

  async createManuscriptChapter(input: CreateManuscriptChapterInput): Promise<ManuscriptChapter> {
    const manuscript = await this.getManuscript(input.manuscriptId);
    if (!manuscript) throw new Error("Manuscript not found");
    const now = nowIso();
    const body = input.body?.trim() ?? "";
    const siblingOrders = this.manuscriptChapters
      .filter((chapter) => chapter.manuscriptId === input.manuscriptId && !chapter.deletedAt)
      .map((chapter) => chapter.sortOrder);
    const chapter: ManuscriptChapter & { deletedAt?: string | null; lastSavedBy?: string | null } = {
      chapterId: input.chapterId ?? crypto.randomUUID(),
      manuscriptId: input.manuscriptId,
      title: input.title.trim(),
      body,
      contentFormat: input.contentFormat ?? "rich-text",
      sortOrder: input.sortOrder ?? Math.max(0, ...siblingOrders) + 1000,
      characterCount: input.characterCount ?? countTextCharacters(body),
      revision: 1,
      lastSaveSource: "manual",
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    };
    this.manuscriptChapters.push(chapter);
    await this.retainArchiveContentDocuments("manuscript", input.manuscriptId, archiveDocumentCandidates(chapter.body));
    const manuscriptIndex = this.manuscripts.findIndex((item) => item.manuscriptId === input.manuscriptId);
    if (manuscriptIndex >= 0) this.manuscripts[manuscriptIndex].updatedAt = now;
    const { deletedAt: _deletedAt, lastSavedBy: _lastSavedBy, ...result } = chapter;
    return result;
  }

  async updateManuscriptChapter(
    manuscriptId: string,
    chapterId: string,
    input: UpdateManuscriptChapterInput
  ): Promise<ManuscriptChapter | null> {
    const index = this.manuscriptChapters.findIndex(
      (chapter) => chapter.manuscriptId === manuscriptId && chapter.chapterId === chapterId && !chapter.deletedAt
    );
    if (index === -1 || !(await this.getManuscript(manuscriptId))) return null;
    const current = this.manuscriptChapters[index];
    if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
      const { deletedAt: _deletedAt, lastSavedBy: _lastSavedBy, ...currentChapter } = current;
      throw new ManuscriptChapterConflictError(currentChapter);
    }
    const title = input.title === undefined ? current.title : input.title.trim();
    const body = input.body === undefined ? current.body : input.body.trim();
    const contentFormat = input.contentFormat ?? current.contentFormat ?? "rich-text";
    const saveSource = input.saveSource ?? "manual";
    const contentChanged = title !== current.title || body !== current.body || contentFormat !== current.contentFormat;
    const recentSnapshot = this.manuscriptChapterVersions.some(
      (version) => version.chapterId === chapterId && Date.now() - new Date(version.createdAt).getTime() < 10 * 60 * 1000
    );
    if (contentChanged && (saveSource !== "autosave" || !recentSnapshot)) {
      const savedBy = current.lastSavedBy ?? null;
      this.manuscriptChapterVersions.push({
        versionId: crypto.randomUUID(),
        manuscriptId,
        chapterId,
        revision: current.revision,
        title: current.title,
        body: current.body,
        contentFormat: current.contentFormat,
        characterCount: current.characterCount,
        saveSource: current.lastSaveSource,
        savedBy,
        savedByName: savedBy ? this.users.find((user) => user.userId === savedBy)?.name ?? null : null,
        savedAt: current.updatedAt,
        createdAt: nowIso()
      });
      const retainedIds = new Set(
        this.manuscriptChapterVersions
          .filter((version) => version.chapterId === chapterId)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.revision - left.revision)
          .slice(0, MANUSCRIPT_CHAPTER_VERSION_RETENTION)
          .map((version) => version.versionId)
      );
      this.manuscriptChapterVersions = this.manuscriptChapterVersions.filter(
        (version) => version.chapterId !== chapterId || retainedIds.has(version.versionId)
      );
    }
    const updatedAt = nowIso();
    this.manuscriptChapters[index] = {
      ...current,
      title,
      body,
      contentFormat,
      sortOrder: input.sortOrder ?? current.sortOrder,
      characterCount: input.body === undefined ? current.characterCount : input.characterCount ?? countTextCharacters(body),
      revision: current.revision + 1,
      lastSaveSource: saveSource,
      lastSavedBy: input.updatedBy ?? null,
      updatedAt
    };
    const manuscriptIndex = this.manuscripts.findIndex((item) => item.manuscriptId === manuscriptId);
    if (manuscriptIndex >= 0) {
      this.manuscripts[manuscriptIndex].updatedAt = updatedAt;
      this.manuscripts[manuscriptIndex].updatedBy = input.updatedBy ?? null;
    }
    const { deletedAt: _deletedAt, lastSavedBy: _lastSavedBy, ...result } = this.manuscriptChapters[index];
    await this.retainArchiveContentDocuments("manuscript", manuscriptId, [...archiveDocumentCandidates(current.body), ...archiveDocumentCandidates(body)]);
    return result;
  }

  async deleteManuscriptChapter(manuscriptId: string, chapterId: string): Promise<boolean> {
    const index = this.manuscriptChapters.findIndex(
      (chapter) => chapter.manuscriptId === manuscriptId && chapter.chapterId === chapterId && !chapter.deletedAt
    );
    if (index === -1) return false;
    this.manuscriptChapters[index].deletedAt = nowIso();
    this.manuscriptChapters[index].updatedAt = nowIso();
    const manuscriptIndex = this.manuscripts.findIndex((item) => item.manuscriptId === manuscriptId);
    if (manuscriptIndex >= 0) this.manuscripts[manuscriptIndex].updatedAt = nowIso();
    return true;
  }

  private enrichCommunication(item: CommunicationRecord): CommunicationRecord {
    const caseRecord = item.caseId ? this.cases.find((record) => record.caseId === item.caseId) : null;
    const organization = item.partyOrganizationId
      ? this.partyOrganizations.find((record) => record.partyOrganizationId === item.partyOrganizationId)
      : null;
    const contact = item.contactId ? this.contacts.find((record) => record.contactId === item.contactId) : null;
    const asset = item.assetId ? this.assets.find((record) => record.assetId === item.assetId) : null;
    const document = item.supportingDocumentId
      ? this.documents.find((record) => record.documentId === item.supportingDocumentId)
      : null;
    const user = item.createdBy ? this.users.find((record) => record.userId === item.createdBy) : null;
    const followUpUser = item.followUpAssignedTo ? this.users.find((record) => record.userId === item.followUpAssignedTo) : null;
    return {
      ...item,
      caseNumber: caseRecord?.caseNumber ?? null,
      caseTitle: caseRecord?.propertyAddress ?? null,
      partyOrganizationName: organization?.name ?? null,
      contactName: contact ? contactDisplayName(this.enrichContact(contact)) : null,
      assetName: asset?.name ?? null,
      supportingDocumentName: document?.originalFileName ?? null,
      createdByName: user?.name ?? null,
      followUpAssignedToName: followUpUser?.name ?? null
    };
  }

  async getCommunication(communicationId: string): Promise<CommunicationRecord | null> {
    const record = this.communications.find((item) => item.communicationId === communicationId && !item.deletedAt);
    return record ? this.enrichCommunication(record) : null;
  }

  async listAllCommunications(filters: CommunicationFilters = {}): Promise<CommunicationRecord[]> {
    const q = filters.q?.trim().toLowerCase() ?? "";
    return this.communications
      .filter((item) => !item.deletedAt)
      .map((item) => this.enrichCommunication(item))
      .filter((communication) => {
        if (filters.status && communication.status !== filters.status) return false;
        if (filters.channel === "calls" && communication.communicationType !== "Call") return false;
        if (filters.channel === "emails" && communication.communicationType !== "Email") return false;
        if (filters.channel === "other" && ["Call", "Email"].includes(communication.communicationType)) return false;
        if (filters.communicationType && communication.communicationType !== filters.communicationType) return false;
        if (filters.direction && communication.direction !== filters.direction) return false;
        if (filters.source && communication.source !== filters.source) return false;
        if (filters.workflowView === "inbox" && communication.status !== "New" && communication.status !== "Logged") return false;
        if (filters.workflowView === "followUp" && communication.status !== "Needs follow-up") return false;
        if (filters.workflowView === "linked" && (communication.status === "Ignored / Spam" || !communication.caseId)) return false;
        if (filters.workflowView === "archived" && communication.status !== "Ignored / Spam") return false;
        if (filters.followUpAssignedTo && communication.followUpAssignedTo !== filters.followUpAssignedTo) return false;
        if (filters.followUpDueFrom && (!communication.followUpDueDate || communication.followUpDueDate < filters.followUpDueFrom)) return false;
        if (filters.followUpDueTo && (!communication.followUpDueDate || communication.followUpDueDate > filters.followUpDueTo)) return false;
        if (filters.caseId && communication.caseId !== filters.caseId) return false;
        if (filters.partyOrganizationId && communication.partyOrganizationId !== filters.partyOrganizationId) return false;
        if (filters.contactId && communication.contactId !== filters.contactId) return false;
        if (filters.assetId && communication.assetId !== filters.assetId) return false;
        if (filters.unlinked === "true" && communication.caseId) return false;
        if (filters.dateFrom && communication.occurredAt.slice(0, 10) < filters.dateFrom) return false;
        if (filters.dateTo && communication.occurredAt.slice(0, 10) > filters.dateTo) return false;
        if (q) {
          const haystack = [
            communication.subject,
            communication.body,
            communication.caseNumber,
            communication.caseTitle,
            communication.partyOrganizationName,
            communication.contactName,
            communication.assetName,
            communication.externalProvider,
            communication.externalReference,
            JSON.stringify(communication.sourceMetadata ?? {})
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const direction = filters.sortDirection === "asc" ? 1 : -1;
        const sort = filters.sort ?? "occurred";
        let result = 0;
        if (sort === "updated") result = a.updatedAt.localeCompare(b.updatedAt);
        else if (sort === "subject") result = a.subject.localeCompare(b.subject);
        else if (sort === "status") result = a.status.localeCompare(b.status);
        else if (sort === "type") result = a.communicationType.localeCompare(b.communicationType);
        else if (sort === "contact") result = (a.contactName ?? "").localeCompare(b.contactName ?? "");
        else if (sort === "organization") result = (a.partyOrganizationName ?? "").localeCompare(b.partyOrganizationName ?? "");
        else if (sort === "service") result = (a.caseNumber ?? "").localeCompare(b.caseNumber ?? "");
        else result = a.occurredAt.localeCompare(b.occurredAt);
        return (result || a.createdAt.localeCompare(b.createdAt)) * direction;
      });
  }

  async listAllCommunicationsPage(
    filters: CommunicationFilters = {},
    pagination: PaginationParams = {}
  ): Promise<PaginatedResult<CommunicationRecord>> {
    return paginateArray(await this.listAllCommunications(filters), pagination);
  }

  async listCommunications(caseId: string): Promise<CommunicationRecord[]> {
    return (await this.listAllCommunications({ caseId }));
  }

  async findCommunicationByExternalReferences(
    source: CommunicationRecord["source"],
    externalReferences: string[],
    externalProvider = ""
  ): Promise<CommunicationRecord | null> {
    const keys = new Set(externalReferences.filter(Boolean));
    if (!keys.size) return null;
    const matches = await this.listAllCommunications({ source });
    return (
      matches.find((communication) => {
        if (externalProvider && communication.externalProvider !== externalProvider) return false;
        if (communication.externalReference && keys.has(communication.externalReference)) return true;
        const metadata = communication.sourceMetadata ?? {};
        const metadataKeys = [
          metadata.gmailMessageId,
          metadata.rfcMessageId,
          metadata.messageUrl,
          metadata.gmailMessageUrl,
          metadata.callId,
          metadata.linkedId,
          metadata.uniqueId,
          metadata.gmailThreadId && metadata.subject && metadata.date
            ? `${metadata.gmailThreadId}|${metadata.subject}|${metadata.date}`
            : ""
        ].map((value) => (typeof value === "string" ? value : ""));
        return metadataKeys.some((key) => key && keys.has(key));
      }) ?? null
    );
  }

  async createCommunication(input: CreateCommunicationInput): Promise<CommunicationRecord> {
    const now = nowIso();
    const linkedCaseId = input.caseId ?? null;
    const record: CommunicationRecord = {
      communicationId: crypto.randomUUID(),
      caseId: linkedCaseId,
      caseNumber: null,
      caseTitle: null,
      partyOrganizationId: input.partyOrganizationId ?? null,
      partyOrganizationName: null,
      contactId: input.contactId ?? null,
      contactName: null,
      assetId: input.assetId ?? null,
      assetName: null,
      supportingDocumentId: input.supportingDocumentId ?? null,
      supportingDocumentName: null,
      communicationType: input.communicationType,
      direction: input.direction,
      source: input.source ?? "Manual",
      status: input.status ?? (linkedCaseId ? "Linked" : "New"),
      followUpAssignedTo: input.followUpAssignedTo ?? null,
      followUpAssignedToName: null,
      followUpDueDate: input.followUpDueDate ?? null,
      externalProvider: input.externalProvider ?? "",
      externalReference: input.externalReference ?? "",
      externalUrl: input.externalUrl ?? "",
      sourceMetadata: input.sourceMetadata ?? {},
      subject: input.subject,
      body: input.body,
      occurredAt: input.occurredAt,
      createdBy: input.createdBy ?? null,
      createdByName: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    };
    this.communications.unshift(record);
    return this.enrichCommunication(record);
  }

  async updateCommunication(communicationId: string, input: Partial<CreateCommunicationInput>): Promise<CommunicationRecord | null> {
    const index = this.communications.findIndex((item) => item.communicationId === communicationId && !item.deletedAt);
    if (index === -1) return null;
    const current = this.communications[index];
    const linkedCaseId = input.caseId === undefined ? current.caseId ?? null : input.caseId ?? null;
    const clearFollowUp = input.status !== undefined && input.status !== "Needs follow-up";
    const followUpAssignedTo =
      input.followUpAssignedTo === undefined ? (clearFollowUp ? null : current.followUpAssignedTo ?? null) : input.followUpAssignedTo ?? null;
    const followUpDueDate =
      input.followUpDueDate === undefined ? (clearFollowUp ? null : current.followUpDueDate ?? null) : input.followUpDueDate ?? null;
    const next: CommunicationRecord = {
      ...current,
      caseId: linkedCaseId,
      partyOrganizationId: input.partyOrganizationId === undefined ? current.partyOrganizationId ?? null : input.partyOrganizationId ?? null,
      contactId: input.contactId === undefined ? current.contactId ?? null : input.contactId ?? null,
      assetId: input.assetId === undefined ? current.assetId ?? null : input.assetId ?? null,
      supportingDocumentId: input.supportingDocumentId === undefined ? current.supportingDocumentId ?? null : input.supportingDocumentId ?? null,
      communicationType: input.communicationType ?? current.communicationType,
      direction: input.direction ?? current.direction,
      source: input.source ?? current.source,
      status: input.status ?? (linkedCaseId && current.status === "New" ? "Linked" : current.status),
      followUpAssignedTo,
      followUpDueDate,
      externalProvider: input.externalProvider === undefined ? current.externalProvider : input.externalProvider ?? "",
      externalReference: input.externalReference === undefined ? current.externalReference : input.externalReference ?? "",
      externalUrl: input.externalUrl === undefined ? current.externalUrl : input.externalUrl ?? "",
      sourceMetadata: input.sourceMetadata ?? current.sourceMetadata,
      subject: input.subject ?? current.subject,
      body: input.body ?? current.body,
      occurredAt: input.occurredAt ?? current.occurredAt,
      updatedAt: nowIso()
    };
    this.communications[index] = next;
    return this.enrichCommunication(next);
  }

  async listSavedDirectoryViews(scope?: DirectoryViewScope, userId?: string): Promise<SavedDirectoryView[]> {
    return this.savedDirectoryViews
      .filter((view) => !scope || view.scope === scope)
      .filter((view) => !userId || !view.createdBy || view.createdBy === userId)
      .sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name));
  }

  async getSavedDirectoryView(savedViewId: string): Promise<SavedDirectoryView | null> {
    return this.savedDirectoryViews.find((view) => view.savedViewId === savedViewId) ?? null;
  }

  async createSavedDirectoryView(input: SavedDirectoryViewInput, user: PublicUser): Promise<SavedDirectoryView> {
    const now = nowIso();
    if (input.isDefault) {
      this.savedDirectoryViews = this.savedDirectoryViews.map((view) =>
        view.scope === input.scope && view.createdBy === user.userId ? { ...view, isDefault: false, updatedAt: now } : view
      );
    }
    const record: SavedDirectoryView = {
      savedViewId: crypto.randomUUID(),
      scope: input.scope,
      name: input.name.trim(),
      filters: input.filters ?? {},
      sort: input.sort ?? "",
      pageSize: input.pageSize ?? 25,
      isDefault: Boolean(input.isDefault),
      createdBy: user.userId,
      createdByName: user.name,
      createdAt: now,
      updatedAt: now
    };
    this.savedDirectoryViews.unshift(record);
    return record;
  }

  async updateSavedDirectoryView(
    savedViewId: string,
    input: Partial<SavedDirectoryViewInput>,
    user: PublicUser
  ): Promise<SavedDirectoryView | null> {
    const index = this.savedDirectoryViews.findIndex((view) => view.savedViewId === savedViewId);
    if (index === -1) return null;
    const current = this.savedDirectoryViews[index];
    const now = nowIso();
    if (input.isDefault) {
      this.savedDirectoryViews = this.savedDirectoryViews.map((view) =>
        view.scope === current.scope && view.createdBy === user.userId && view.savedViewId !== savedViewId
          ? { ...view, isDefault: false, updatedAt: now }
          : view
      );
    }
    const next: SavedDirectoryView = {
      ...current,
      scope: input.scope ?? current.scope,
      name: input.name?.trim() || current.name,
      filters: input.filters ?? current.filters,
      sort: input.sort ?? current.sort,
      pageSize: input.pageSize ?? current.pageSize,
      isDefault: input.isDefault ?? current.isDefault,
      updatedAt: now
    };
    this.savedDirectoryViews[index] = next;
    return next;
  }

  async deleteSavedDirectoryView(savedViewId: string, _user?: PublicUser): Promise<boolean> {
    const before = this.savedDirectoryViews.length;
    this.savedDirectoryViews = this.savedDirectoryViews.filter((view) => view.savedViewId !== savedViewId);
    return this.savedDirectoryViews.length !== before;
  }

  async findContactsByPhone(phone: string): Promise<Contact[]> {
    return (await this.listContacts("")).filter((contact) => phoneNumbersMatch(contact.phone, phone));
  }

  async findPartyOrganizationsByPhone(phone: string): Promise<PartyOrganization[]> {
    return (await this.listPartyOrganizations("")).filter((organization) => phoneNumbersMatch(organization.phone, phone));
  }

  async findAssetsByPhoneOrExtension(phone: string, extension = ""): Promise<ManagedAsset[]> {
    return (await this.listAssets({})).filter(
      (asset) =>
        phoneNumbersMatch(asset.phoneNumber, phone) ||
        extensionMatches(asset.extension, phone) ||
        extensionMatches(asset.extension, extension)
    );
  }

  async listTasks(caseId: string): Promise<TaskRecord[]> {
    return this.tasks.filter((item) => item.caseId === caseId).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

  async listAllTasks(): Promise<TaskRecord[]> {
    const activeCases = new Map(this.cases.filter((item) => !item.deletedAt).map((item) => [item.caseId, item]));
    return this.tasks
      .filter((item) => activeCases.has(item.caseId))
      .map((item) => {
        const caseRecord = activeCases.get(item.caseId);
        return { ...item, caseNumber: caseRecord?.caseNumber, caseTitle: caseRecord?.propertyAddress };
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.createdAt.localeCompare(b.createdAt));
  }

  async createTask(input: CreateTaskInput): Promise<TaskRecord> {
    const user = input.assignedTo ? this.users.find((item) => item.userId === input.assignedTo) : null;
    const record: TaskRecord = {
      taskId: crypto.randomUUID(),
      status: "Open",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      assignedToName: user?.name ?? null,
      ...input,
      priority: input.priority ?? "Normal"
    };
    this.tasks.push(record);
    return record;
  }

  async updateTask(taskId: string, input: Partial<TaskRecord>): Promise<TaskRecord | null> {
    const index = this.tasks.findIndex((item) => item.taskId === taskId);
    if (index === -1) return null;
    const assignedToName = Object.prototype.hasOwnProperty.call(input, "assignedTo")
      ? this.users.find((user) => user.userId === input.assignedTo)?.name ?? null
      : this.tasks[index].assignedToName;
    this.tasks[index] = { ...this.tasks[index], ...input, assignedToName, updatedAt: nowIso() };
    return this.tasks[index];
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
      for (const credential of [...this.assetCredentials]
        .filter((item) => !item.deletedAt)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
        const assetRecord = assetsById.get(credential.assetId);
        if (!assetRecord) continue;
        const match: SearchCredentialMatch = {
          credentialId: credential.credentialId,
          label: credential.label,
          credentialType: credential.credentialType,
          host: credential.host,
          loginUrl: credential.loginUrl
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
    const documents = this.documents
      .filter((item) => {
        const caseRecord = this.cases.find((record) => record.caseId === item.caseId);
        const haystack = [
          item.fileName,
          item.originalFileName,
          item.category,
          item.notes,
          ...item.tags.map((tag) => tag.name),
          caseRecord?.caseNumber,
          caseRecord?.propertyAddress
        ].join(" ");
        return !item.deletedAt && item.isCurrentVersion !== false && matchText(haystack, q);
      })
      .map((item) => {
        const caseRecord = this.cases.find((record) => record.caseId === item.caseId);
        return documentSearchResult(item, {
          caseNumber: caseRecord?.caseNumber ?? "Case",
          propertyAddress: caseRecord?.propertyAddress ?? ""
        }, q);
      });
    const knowledge = (await this.listKnowledgePage({ q }, { pageSize: 12 })).items
      .map((item) => knowledgeSearchResult(item, q));
    const manuscripts = (await this.listManuscripts(q)).map((item) => manuscriptSearchResult(item, q));
    return finalizeSearchResults([...cases, ...contacts, ...organizations, ...assets, ...documents, ...knowledge, ...manuscripts]);
  }

  async getBackupSettings(): Promise<BackupSettings> {
    return this.backupSettings;
  }

  async updateBackupSettings(input: UpdateBackupSettingsInput, user: PublicUser): Promise<BackupSettings> {
    this.backupSettings = {
      ...this.backupSettings,
      ...input,
      updatedAt: nowIso(),
      updatedBy: user.userId,
      updatedByName: user.name
    };
    return this.backupSettings;
  }

  async getPbxSettings(): Promise<PbxSettings> {
    return this.pbxSettings;
  }

  async updatePbxSettings(input: UpdatePbxSettingsInput, user: PublicUser): Promise<PbxSettings> {
    this.pbxSettings = {
      ...this.pbxSettings,
      ...input,
      updatedAt: nowIso(),
      updatedBy: user.userId,
      updatedByName: user.name
    };
    return this.pbxSettings;
  }

  async listBackupRuns(limit = 20): Promise<BackupRun[]> {
    return [...this.backupRuns].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
  }

  async getBackupRun(backupRunId: string): Promise<BackupRun | null> {
    return this.backupRuns.find((run) => run.backupRunId === backupRunId) ?? null;
  }

  async createBackupRun(input: CreateBackupRunInput): Promise<BackupRun> {
    const user = input.createdBy ? this.users.find((item) => item.userId === input.createdBy) : null;
    const run: BackupRun = {
      backupRunId: input.backupRunId,
      backupJobId: input.backupJobId,
      status: input.status,
      destination: input.destination,
      scope: input.scope,
      startedAt: input.startedAt,
      completedAt: input.completedAt ?? null,
      caseCount: input.caseCount,
      documentCount: input.documentCount,
      metadataRows: input.metadataRows,
      itemCount: input.itemCount,
      failedItems: input.failedItems,
      manifestObjectKey: input.manifestObjectKey ?? null,
      manifestFileName: input.manifestFileName ?? null,
      mode: input.mode,
      createdBy: input.createdBy ?? null,
      createdByName: user?.name ?? null,
      message: input.message
    };
    this.backupRuns.unshift(run);
    return run;
  }

  async deleteBackupRun(backupRunId: string): Promise<BackupRun | null> {
    const index = this.backupRuns.findIndex((run) => run.backupRunId === backupRunId);
    if (index === -1) return null;
    const [deleted] = this.backupRuns.splice(index, 1);
    this.backupItems = this.backupItems.filter((item) => item.backupRunId !== backupRunId);
    return deleted;
  }

  async createBackupItem(input: CreateBackupItemInput): Promise<BackupItem> {
    const item: BackupItem = {
      backupItemId: input.backupItemId,
      backupRunId: input.backupRunId,
      itemType: input.itemType,
      sourceId: input.sourceId ?? null,
      sourcePath: input.sourcePath,
      targetPath: input.targetPath,
      status: input.status,
      sizeBytes: input.sizeBytes,
      checksum: input.checksum ?? null,
      metadata: input.metadata ?? {},
      createdAt: nowIso()
    };
    this.backupItems.push(item);
    return item;
  }

  async listBackupItems(backupRunId: string): Promise<BackupItem[]> {
    return this.backupItems.filter((item) => item.backupRunId === backupRunId);
  }

  async buildBackupSnapshot(scope: BackupScope): Promise<BackupSnapshot> {
    // The legacy updated-since-last-run scope is still a full snapshot. Only
    // closed-cases excludes independent Archive and Reading & Notes content.
    const includeGlobalContent = scope !== "closed-cases";
    const cases = (await this.listCases({ archiveStatus: "all" })).filter((caseRecord) => {
      if (scope === "closed-cases") return caseRecord.status === "Closed";
      return true;
    });
    const caseIds = new Set(cases.map((caseRecord) => caseRecord.caseId));
    const documents = this.documents
      .filter((document) => !document.deletedAt && (document.caseId ? caseIds.has(document.caseId) : includeGlobalContent))
      .map((document) => this.enrichDocument(document));
    const archiveFolders = includeGlobalContent ? await this.listArchiveFolders() : [];
    const archiveCategories = includeGlobalContent ? await this.listArchiveCategories() : [];
    const caseContacts = this.caseContacts.filter((item) => caseIds.has(item.caseId));
    const contacts = this.contacts
      .filter((contact) => caseContacts.some((item) => item.contactId === contact.contactId))
      .map((contact) => this.enrichContact(contact));
    const tasks = this.tasks.filter((task) => caseIds.has(task.caseId));
    const notes = this.notes.filter((note) => caseIds.has(note.caseId));
    const discussion = this.serviceDiscussionMessages
      .filter((message) => !message.deletedAt && (message.caseId ? caseIds.has(message.caseId) : includeGlobalContent))
      .map((message) => this.enrichServiceDiscussionMessage(message));
    const knowledge = this.knowledgeItems
      .filter((item) => !item.deletedAt)
      .filter(
        (item) =>
          includeGlobalContent ||
          (item.sourceServiceId && caseIds.has(item.sourceServiceId)) ||
          item.links.some((link) => link.entityType === "service" && caseIds.has(link.entityId))
      )
      .map((item) => this.enrichKnowledge(item));
    const manuscripts = this.manuscripts.filter((item) => !item.deletedAt).map((item) => this.enrichManuscript(item));
    const manuscriptIds = new Set(manuscripts.map((item) => item.manuscriptId));
    const manuscriptChapters = this.manuscriptChapters
      .filter((chapter) => manuscriptIds.has(chapter.manuscriptId) && !chapter.deletedAt)
      .map(({ deletedAt: _deletedAt, lastSavedBy: _lastSavedBy, ...chapter }) => chapter);
    const manuscriptChapterIds = new Set(manuscriptChapters.map((item) => item.chapterId));
    const manuscriptChapterVersions = this.manuscriptChapterVersions.filter((version) =>
      manuscriptIds.has(version.manuscriptId) && manuscriptChapterIds.has(version.chapterId)
    );
    const communications = this.communications.filter(
      (communication) => communication.caseId && caseIds.has(communication.caseId) && !communication.deletedAt
    );
    const partyOrganizationIds = new Set(contacts.map((contact) => contact.partyOrganizationId).filter(Boolean));
    const partyOrganizations = this.partyOrganizations.filter((organization) =>
      partyOrganizationIds.has(organization.partyOrganizationId)
    );
    const documentIds = new Set(documents.map((document) => document.documentId));
    const taskIds = new Set(tasks.map((task) => task.taskId));
    const noteIds = new Set(notes.map((note) => note.noteId));
    const discussionIds = new Set(discussion.map((message) => message.messageId));
    const knowledgeIds = new Set(knowledge.map((item) => item.knowledgeId));
    const communicationIds = new Set(communications.map((communication) => communication.communicationId));
    const auditLogs = this.auditLogs.filter((log) => {
      if (log.entityType === "case" && caseIds.has(log.entityId)) return true;
      if (log.entityType === "document" && documentIds.has(log.entityId)) return true;
      if (log.entityType === "task" && taskIds.has(log.entityId)) return true;
      if (log.entityType === "note" && noteIds.has(log.entityId)) return true;
      if (log.entityType === "service_discussion" && discussionIds.has(log.entityId)) return true;
      if (log.entityType === "knowledge" && knowledgeIds.has(log.entityId)) return true;
      if (log.entityType === "manuscript" && manuscriptIds.has(log.entityId)) return true;
      if (log.entityType === "manuscript_chapter" && manuscriptChapterIds.has(log.entityId)) return true;
      if (log.entityType === "communication" && communicationIds.has(log.entityId)) return true;
      if (typeof log.metadata?.caseId === "string" && caseIds.has(log.metadata.caseId)) return true;
      return typeof log.metadata?.sourceServiceId === "string" && caseIds.has(log.metadata.sourceServiceId);
    });
    return {
      generatedAt: nowIso(),
      cases,
      documents,
      archiveFolders,
      archiveCategories,
      auditLogs,
      contacts,
      partyOrganizations,
      caseContacts,
      tags: this.tags,
      tasks,
      notes,
      discussion,
      knowledge,
      manuscripts,
      manuscriptChapters,
      manuscriptChapterVersions,
      manuscriptBookmarks: structuredClone(this.manuscriptBookmarks.filter((b) => manuscripts.some((m) => m.manuscriptId === b.manuscriptId))),
      privateVaults: this.privateVaults,
      privateVaultFolders: this.privateVaultFolders,
      privateVaultItems: this.privateVaultItems,
      communications,
      metadataRows:
        cases.length +
        documents.length +
        archiveFolders.length +
        archiveCategories.length +
        auditLogs.length +
        contacts.length +
        partyOrganizations.length +
        caseContacts.length +
        this.tags.length +
        tasks.length +
        notes.length +
        discussion.length +
        knowledge.length +
        manuscripts.length +
        manuscriptChapters.length +
        manuscriptChapterVersions.length +
        this.manuscriptBookmarks.filter((b) => manuscripts.some((m) => m.manuscriptId === b.manuscriptId)).length +
        this.privateVaults.length +
        this.privateVaultFolders.length +
        this.privateVaultItems.length +
        communications.length
    };
  }

  async exportDatabaseTables(): Promise<DatabaseTableExportPayload> {
    const tables: DatabaseTableExportPayload["tables"] = [
      memoryExportTable("users", this.users),
      memoryExportTable("cases", this.cases),
      memoryExportTable("contacts", this.contacts),
      memoryExportTable("party_organizations", this.partyOrganizations),
      memoryExportTable("contact_organization_affiliations", this.contactOrganizationAffiliations),
      memoryExportTable("managed_assets", this.assets),
      memoryExportTable("asset_document_links", this.assetDocumentLinks),
      memoryExportTable("asset_credentials", this.assetCredentials),
      memoryExportTable("case_contacts", this.caseContacts),
      memoryExportTable("documents", this.documents),
      memoryExportTable("archive_management_audit", this.archiveManagementAudit),
      memoryExportTable("archive_content_document_references", this.archiveContentReferences),
      memoryExportTable("storage_cleanup_jobs", [...this.storageCleanupJobs.values()]),
      memoryExportTable("archive_folders", this.archiveFolders),
      memoryExportTable("archive_categories", this.archiveCategories),
      memoryExportTable("tags", this.tags),
      memoryExportTable("notes", this.notes),
      memoryExportTable("service_discussion_messages", this.serviceDiscussionMessages),
      memoryExportTable("knowledge_items", this.knowledgeItems),
      memoryExportTable("manuscripts", this.manuscripts),
      memoryExportTable("manuscript_chapters", this.manuscriptChapters),
      memoryExportTable("manuscript_key_owner_claims", this.manuscriptKeyOwnerClaims),
      memoryExportTable("manuscript_chapter_versions", this.manuscriptChapterVersions),
      memoryExportTable("manuscript_bookmarks", this.manuscriptBookmarks),
      memoryExportTable("private_vaults", this.privateVaults),
      memoryExportTable("private_vault_folders", this.privateVaultFolders),
      memoryExportTable("private_vault_items", this.privateVaultItems),
      memoryExportTable("communications", this.communications),
      memoryExportTable("tasks", this.tasks),
      memoryExportTable("audit_logs", this.auditLogs),
      memoryExportTable("backup_jobs", [this.backupSettings]),
      memoryExportTable("backup_runs", this.backupRuns),
      memoryExportTable("backup_items", this.backupItems)
    ];
    return {
      generatedAt: nowIso(),
      schema: "memory-demo",
      tableCount: tables.length,
      rowCount: tables.reduce((sum, table) => sum + table.rowCount, 0),
      tables
    };
  }

  async listAuditLogs(): Promise<AuditLog[]> {
    return this.auditLogs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
  }

  async listCaseAuditLogs(caseId: string): Promise<AuditLog[]> {
    const documentIds = new Set(
      this.documents.filter((document) => document.caseId === caseId).map((document) => document.documentId)
    );
    const taskIds = new Set(this.tasks.filter((task) => task.caseId === caseId).map((task) => task.taskId));
    const noteIds = new Set(this.notes.filter((note) => note.caseId === caseId).map((note) => note.noteId));
    const discussionIds = new Set(
      this.serviceDiscussionMessages
        .filter((message) => message.caseId === caseId)
        .map((message) => message.messageId)
    );
    const communicationIds = new Set(
      this.communications
        .filter((communication) => communication.caseId === caseId)
        .map((communication) => communication.communicationId)
    );
    const assetIds = new Set(this.assets.filter((asset) => asset.caseId === caseId).map((asset) => asset.assetId));
    const credentialIds = new Set(this.assetCredentials.filter((credential) => assetIds.has(credential.assetId)).map((credential) => credential.credentialId));

    return this.auditLogs
      .filter((log) => {
        if (log.action === "note.created") return false;
        if (log.entityType === "case" && log.entityId === caseId) return true;
        if (log.entityType === "document" && documentIds.has(log.entityId)) return true;
        if (log.entityType === "task" && taskIds.has(log.entityId)) return true;
        if (log.entityType === "note" && noteIds.has(log.entityId)) return true;
        if (log.entityType === "service_discussion" && discussionIds.has(log.entityId)) return true;
        if (log.entityType === "communication" && communicationIds.has(log.entityId)) return true;
        if (log.entityType === "asset" && assetIds.has(log.entityId)) return true;
        if (log.entityType === "credential" && credentialIds.has(log.entityId)) return true;
        if (typeof log.metadata?.assetId === "string" && assetIds.has(log.metadata.assetId)) return true;
        return log.metadata?.caseId === caseId;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100);
  }

  async createAuditLog(input: {
    action: string;
    entityType: string;
    entityId: string;
    user: PublicUser;
    metadata?: Record<string, unknown>;
  }): Promise<AuditLog> {
    const record: AuditLog = {
      auditLogId: crypto.randomUUID(),
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      userId: input.user.userId,
      userName: input.user.name,
      createdAt: nowIso(),
      metadata: input.metadata ?? {}
    };
    this.auditLogs.unshift(record);
    return record;
  }
}
