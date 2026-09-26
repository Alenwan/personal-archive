import { activeRequestUserId } from "../shared/sessionIdentity";
import type { ManuscriptBookmark, ManuscriptBookmarkInput } from "../shared/manuscriptBookmarks";
import type {
  AuditLog,
  AssetDocumentLink,
  AssetDocumentLinkInput,
  AssetDocumentLinkUpdateInput,
  AssetCredential,
  AssetCredentialInput,
  AssetCredentialSecret,
  AssetBulkActionInput,
  AssetFilters,
  ArchiveCategory,
  ArchiveCategoryInput,
  ArchiveFolder,
  ArchiveFolderInput,
  ArchiveFolderMetadataUpdateInput,
  ArchiveFolderMetadataUpdateResult,
  BackupItem,
  BackupRun,
  BackupRunRequest,
  BackupSettings,
  CaseContact,
  CaseFilters,
  CloseCaseInput,
  CloseCaseResult,
  CodeRepositoryBranch,
  CodeRepositoryCreateBranchInput,
  CodeRepositoryCreateInput,
  CodeRepositoryCreateTagInput,
  CodeRepositoryDetail,
  CodeRepositoryImportInput,
  CodeRepositoryOverview,
  CodeRepositoryRecord,
  CodeRepositorySnapshot,
  CodeRepositoryTag,
  CodeRepositoryUpdateInput,
  CaseInput,
  CaseBulkActionInput,
  CaseReadiness,
  CaseRecord,
  CaseTimelineEvent,
  CaseTypeTemplate,
  CaseWorkspacePayload,
  CommunicationFilters,
  CommunicationBulkActionInput,
  CommunicationInput,
  CommunicationRecord,
  BulkActionResult,
  Contact,
  ContactBulkActionInput,
  ContactFilters,
  ContactInput,
  DashboardStats,
  DatabaseRecoveryStatus,
  DatabaseSnapshotCreateResult,
  DatabaseSnapshotListResult,
  DatabaseTableExportResult,
  DocumentBulkActionInput,
  DocumentFilters,
  DocumentRecord,
  DocumentUpdateInput,
  DocumentVersionUploadResult,
  GmailExtensionToken,
  GmailExtensionTokenCreateResult,
  GmailExtensionTokenScope,
  KnowledgeFilters,
  KnowledgeInput,
  KnowledgeItem,
  Manuscript,
  ManuscriptBodyEncryptionEnableInput,
  ManuscriptBodyEncryptionInput,
  ManuscriptEncryptionPasswordMetadata,
  ManuscriptEncryptionPasswordResetInput,
  ManuscriptChapter,
  ManuscriptChapterInput,
  ManuscriptChapterSummary,
  ManuscriptChapterUpdateInput,
  ManuscriptChapterVersion,
  ManuscriptChapterVersionSummary,
  ManuscriptInput,
  ManagedAsset,
  ManagedAssetInput,
  MyWorkFilters,
  MyWorkQueue,
  OrganizationBulkActionInput,
  OrganizationFilters,
  PaginatedResult,
  NoteRecord,
  PartyOrganization,
  PartyOrganizationInput,
  PbxSettings,
  PbxSettingsInput,
  PrivateVault,
  PrivateVaultCreateInput,
  PrivateVaultFolder,
  PrivateVaultItem,
  PrivateVaultPasswordMetadata,
  PrivateVaultPasswordResetInput,
  PublicUser,
  SearchResult,
  SavedDirectoryView,
  SavedDirectoryViewInput,
  ServiceDiscussionAssetLink,
  ServiceDiscussionAttachment,
  ServiceDiscussionFilters,
  ServiceDiscussionMessage,
  ServiceDiscussionMessageInput,
  ServiceDiscussionSummary,
  SystemStatus,
  Tag,
  TaskInput,
  TaskRecord
} from "../shared/types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData)) headers.set("content-type", "application/json");
  const expectedUserId = activeRequestUserId();
  if (expectedUserId && !headers.has("x-archive-user-id")) headers.set("x-archive-user-id", expectedUserId);
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    ...init,
    headers
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({ error: response.statusText }))) as {
      error?: string;
      detail?: string;
    };
    throw new ApiError(payload.detail || payload.error || response.statusText, response.status);
  }
  return response.json() as Promise<T>;
}

async function apiArrayBuffer(path: string): Promise<ArrayBuffer> {
  const response = await fetch(`/api${path}`, { credentials: "include", cache: "no-store" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({ error: response.statusText }))) as {
      error?: string;
      detail?: string;
    };
    throw new ApiError(payload.detail || payload.error || response.statusText, response.status);
  }
  return response.arrayBuffer();
}

function toQuery(input: Record<string, string | number | boolean | null | undefined>): string {
  const params = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

export type BackupSettingsUpdatePayload = Pick<
  BackupSettings,
  | "destination"
  | "schedule"
  | "scope"
  | "includeMetadata"
  | "includeDocuments"
  | "includeAuditLogs"
  | "includeRelationshipMap"
  | "folderByCaseAndCategory"
  | "checksumManifest"
  | "isEnabled"
>;

export const client = {
  archiveManagementAccess: () => api<{ verifiedUntil: string | null }>("/archive/management-access"),
  verifyArchiveManagementAccess: (currentPassword: string) => api<{ verifiedUntil: string }>("/archive/management-access", {
    method: "POST", body: JSON.stringify({ currentPassword })
  }),
  endArchiveManagementAccess: () => api<{ verifiedUntil: null }>("/archive/management-access", { method: "DELETE" }),
  login: (email: string, password: string) =>
    api<{ user: PublicUser }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  changePassword: (body: { currentPassword: string; newPassword: string; confirmPassword: string }) =>
    api<{ user: PublicUser }>("/auth/change-password", { method: "POST", body: JSON.stringify(body) }),
  logout: () => api<{ ok: true }>("/auth/logout", { method: "POST" }),
  session: () => api<{ user: PublicUser | null }>("/auth/session"),
  systemStatus: (options: { refreshStorage?: boolean } = {}) =>
    api<SystemStatus>(`/system-status${options.refreshStorage ? "?refreshStorage=1" : ""}`),
  codeRepositories: () => api<CodeRepositoryOverview>("/code-repositories"),
  codeRepositoryDetail: (owner: string, name: string) =>
    api<CodeRepositoryDetail>(`/code-repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/detail`),
  createCodeRepository: (body: CodeRepositoryCreateInput) =>
    api<CodeRepositoryRecord>("/code-repositories", { method: "POST", body: JSON.stringify(body) }),
  importCodeRepository: (body: CodeRepositoryImportInput) =>
    api<CodeRepositoryRecord>("/code-repositories/import", { method: "POST", body: JSON.stringify(body) }),
  updateCodeRepository: (owner: string, name: string, body: CodeRepositoryUpdateInput) =>
    api<CodeRepositoryRecord>(`/code-repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  deleteCodeRepository: (owner: string, name: string, confirmation: string) =>
    api<{ ok: true }>(`/code-repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, {
      method: "DELETE",
      body: JSON.stringify({ confirmation })
    }),
  createCodeRepositoryBranch: (owner: string, name: string, body: CodeRepositoryCreateBranchInput) =>
    api<CodeRepositoryBranch>(`/code-repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  deleteCodeRepositoryBranch: (owner: string, name: string, branch: string) =>
    api<{ ok: true }>(
      `/code-repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches/${encodeURIComponent(branch)}`,
      { method: "DELETE" }
    ),
  createCodeRepositoryTag: (owner: string, name: string, body: CodeRepositoryCreateTagInput) =>
    api<CodeRepositoryTag>(`/code-repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/tags`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  deleteCodeRepositoryTag: (owner: string, name: string, tag: string) =>
    api<{ ok: true }>(
      `/code-repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/tags/${encodeURIComponent(tag)}`,
      { method: "DELETE" }
    ),
  createCodeRepositorySnapshot: (owner: string, name: string) =>
    api<CodeRepositorySnapshot>(`/code-repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/snapshots`, {
      method: "POST"
    }),
  codeRepositorySnapshotUrl: (owner: string, name: string, snapshotId: string) =>
    `/api/code-repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/snapshots/${encodeURIComponent(snapshotId)}/download`,
  dashboard: () => api<DashboardStats>("/dashboard"),
  myWork: (filters: MyWorkFilters = {}) =>
    api<MyWorkQueue>(`/my-work${toQuery(filters as Record<string, string | undefined>)}`),
  users: () => api<PublicUser[]>("/users"),
  gmailExtensionTokens: () => api<GmailExtensionToken[]>("/integrations/gmail-extension/tokens"),
  createGmailExtensionToken: (body: { name: string; scopes?: GmailExtensionTokenScope[] }) =>
    api<GmailExtensionTokenCreateResult>("/integrations/gmail-extension/tokens", { method: "POST", body: JSON.stringify(body) }),
  revokeGmailExtensionToken: (tokenId: string) =>
    api<GmailExtensionToken>(`/integrations/gmail-extension/tokens/${tokenId}`, { method: "DELETE" }),
  pbxSettings: () => api<PbxSettings>("/pbx/settings"),
  updatePbxSettings: (body: PbxSettingsInput) =>
    api<PbxSettings>("/pbx/settings", { method: "PUT", body: JSON.stringify(body) }),
  cases: (filters: CaseFilters = {}) => api<CaseRecord[]>(`/cases${toQuery(filters as Record<string, string>)}`),
  caseTypes: () => api<CaseTypeTemplate[]>("/case-types"),
  case: (id: string, options: { includeArchived?: boolean } = {}) =>
    api<CaseRecord>(`/cases/${id}${toQuery({ includeArchived: options.includeArchived ? "true" : undefined })}`),
  caseWorkspace: (id: string, options: { includeArchived?: boolean; category?: string } = {}) =>
    api<CaseWorkspacePayload>(
      `/cases/${id}/workspace${toQuery({
        includeArchived: options.includeArchived ? "true" : undefined,
        category: options.category
      })}`
    ),
  caseReadiness: (id: string, options: { includeArchived?: boolean } = {}) =>
    api<CaseReadiness>(`/cases/${id}/readiness${toQuery({ includeArchived: options.includeArchived ? "true" : undefined })}`),
  nextCaseNumber: () => api<{ caseNumber: string }>("/cases/next-number"),
  createCase: (body: CaseInput) => api<CaseRecord>("/cases", { method: "POST", body: JSON.stringify(body) }),
  casesPage: (filters: CaseFilters = {}, pagination: { page?: number; pageSize?: number } = {}) =>
    api<PaginatedResult<CaseRecord>>(
      `/cases/page${toQuery({ ...(filters as Record<string, string | undefined>), page: pagination.page, pageSize: pagination.pageSize })}`
    ),
  bulkCases: (body: CaseBulkActionInput) =>
    api<BulkActionResult>("/cases/bulk", { method: "POST", body: JSON.stringify(body) }),
  updateCase: (id: string, body: Partial<CaseInput>) =>
    api<CaseRecord>(`/cases/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  archiveCase: (id: string, body: { reason?: string }) =>
    api<CaseRecord>(`/cases/${id}`, { method: "DELETE", body: JSON.stringify(body) }),
  restoreCase: (id: string, body: { reason?: string } = {}) =>
    api<CaseRecord>(`/cases/${id}/restore`, { method: "POST", body: JSON.stringify(body) }),
  closeCase: (id: string, body: CloseCaseInput) =>
    api<CloseCaseResult>(`/cases/${id}/close`, { method: "POST", body: JSON.stringify(body) }),
  contacts: (filters: ContactFilters | string = {}) =>
    api<Contact[]>(`/contacts${toQuery(typeof filters === "string" ? { q: filters } : (filters as Record<string, string | undefined>))}`),
  contactsPage: (filters: ContactFilters = {}, pagination: { page?: number; pageSize?: number } = {}) =>
    api<PaginatedResult<Contact>>(
      `/contacts/page${toQuery({ ...(filters as Record<string, string | undefined>), page: pagination.page, pageSize: pagination.pageSize })}`
    ),
  contact: (id: string) => api<Contact>(`/contacts/${id}`),
  contactCases: (contactId: string) => api<CaseContact[]>(`/contacts/${contactId}/cases`),
  createContact: (body: ContactInput) => api<Contact>("/contacts", { method: "POST", body: JSON.stringify(body) }),
  updateContact: (id: string, body: Partial<ContactInput>) =>
    api<Contact>(`/contacts/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteContact: (id: string) => api<Contact>(`/contacts/${id}`, { method: "DELETE" }),
  bulkContacts: (body: ContactBulkActionInput) =>
    api<BulkActionResult>("/contacts/bulk", { method: "POST", body: JSON.stringify(body) }),
  partyOrganizations: (filters: OrganizationFilters | string = {}) =>
    api<PartyOrganization[]>(`/party-organizations${toQuery(typeof filters === "string" ? { q: filters } : (filters as Record<string, string | undefined>))}`),
  partyOrganizationsPage: (filters: OrganizationFilters = {}, pagination: { page?: number; pageSize?: number } = {}) =>
    api<PaginatedResult<PartyOrganization>>(
      `/party-organizations/page${toQuery({ ...(filters as Record<string, string | undefined>), page: pagination.page, pageSize: pagination.pageSize })}`
    ),
  partyOrganization: (id: string) => api<PartyOrganization>(`/party-organizations/${id}`),
  partyOrganizationContacts: (id: string) => api<Contact[]>(`/party-organizations/${id}/contacts`),
  partyOrganizationCases: (id: string) => api<CaseContact[]>(`/party-organizations/${id}/cases`),
  createPartyOrganization: (body: PartyOrganizationInput) =>
    api<PartyOrganization>("/party-organizations", { method: "POST", body: JSON.stringify(body) }),
  updatePartyOrganization: (id: string, body: Partial<PartyOrganizationInput>) =>
    api<PartyOrganization>(`/party-organizations/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deletePartyOrganization: (id: string) => api<PartyOrganization>(`/party-organizations/${id}`, { method: "DELETE" }),
  bulkPartyOrganizations: (body: OrganizationBulkActionInput) =>
    api<BulkActionResult>("/party-organizations/bulk", { method: "POST", body: JSON.stringify(body) }),
  assets: (filters: AssetFilters = {}) => api<ManagedAsset[]>(`/assets${toQuery(filters as Record<string, string | undefined>)}`),
  assetsPage: (filters: AssetFilters = {}, pagination: { page?: number; pageSize?: number } = {}) =>
    api<PaginatedResult<ManagedAsset>>(
      `/assets/page${toQuery({ ...(filters as Record<string, string | undefined>), page: pagination.page, pageSize: pagination.pageSize })}`
    ),
  asset: (id: string) => api<ManagedAsset>(`/assets/${id}`),
  createAsset: (body: ManagedAssetInput) =>
    api<ManagedAsset>("/assets", { method: "POST", body: JSON.stringify(body) }),
  updateAsset: (id: string, body: Partial<ManagedAssetInput>) =>
    api<ManagedAsset>(`/assets/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteAsset: (id: string) => api<ManagedAsset>(`/assets/${id}`, { method: "DELETE" }),
  bulkAssets: (body: AssetBulkActionInput) =>
    api<BulkActionResult>("/assets/bulk", { method: "POST", body: JSON.stringify(body) }),
  assetDocuments: (assetId: string) => api<AssetDocumentLink[]>(`/assets/${assetId}/documents`),
  linkAssetDocument: (assetId: string, body: AssetDocumentLinkInput) =>
    api<AssetDocumentLink>(`/assets/${assetId}/documents`, { method: "POST", body: JSON.stringify(body) }),
  updateAssetDocumentLink: (assetDocumentLinkId: string, body: AssetDocumentLinkUpdateInput) =>
    api<AssetDocumentLink>(`/asset-document-links/${assetDocumentLinkId}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  deleteAssetDocumentLink: (assetDocumentLinkId: string) =>
    api<AssetDocumentLink>(`/asset-document-links/${assetDocumentLinkId}`, { method: "DELETE" }),
  assetCredentials: (assetId: string) => api<AssetCredential[]>(`/assets/${assetId}/credentials`),
  createAssetCredential: (assetId: string, body: AssetCredentialInput) =>
    api<AssetCredential>(`/assets/${assetId}/credentials`, { method: "POST", body: JSON.stringify(body) }),
  updateAssetCredential: (credentialId: string, body: Partial<AssetCredentialInput>) =>
    api<AssetCredential>(`/asset-credentials/${credentialId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteAssetCredential: (credentialId: string) =>
    api<AssetCredential>(`/asset-credentials/${credentialId}`, { method: "DELETE" }),
  revealAssetCredential: (credentialId: string) =>
    api<AssetCredentialSecret>(`/asset-credentials/${credentialId}/reveal`, { method: "POST" }),
  copyAssetCredential: (credentialId: string) =>
    api<AssetCredentialSecret>(`/asset-credentials/${credentialId}/copy`, { method: "POST" }),
  caseContacts: (caseId: string) => api<CaseContact[]>(`/cases/${caseId}/contacts`),
  addCaseContact: (caseId: string, body: { contactId: string; role: string }) =>
    api<CaseContact>(`/cases/${caseId}/contacts`, { method: "POST", body: JSON.stringify(body) }),
  removeCaseContact: (caseId: string, contactId: string, role: string) =>
    api<{ ok: true }>(`/cases/${caseId}/contacts/${contactId}${toQuery({ role })}`, { method: "DELETE" }),
  documents: (caseId: string, filters: DocumentFilters = {}) =>
    api<DocumentRecord[]>(`/cases/${caseId}/documents${toQuery(filters as Record<string, string>)}`),
  documentsPage: (filters: DocumentFilters = {}, pagination: { page?: number; pageSize?: number } = {}) =>
    api<PaginatedResult<DocumentRecord>>(
      `/documents${toQuery({ ...(filters as Record<string, string | number | boolean | undefined>), page: pagination.page, pageSize: pagination.pageSize })}`
    ),
  uploadDocument: (caseId: string, form: FormData) =>
    api<DocumentRecord>(`/cases/${caseId}/documents`, { method: "POST", body: form }),
  uploadArchiveDocument: (form: FormData, expectedUserId?: string) =>
    api<DocumentRecord>("/documents", { method: "POST", body: form, headers: expectedUserId ? { "x-archive-user-id": expectedUserId } : undefined }),
  document: (documentId: string) => api<DocumentRecord>(`/documents/${documentId}`),
  documentVersions: (documentId: string) => api<DocumentRecord[]>(`/documents/${documentId}/versions`),
  uploadDocumentVersion: (documentId: string, form: FormData) =>
    api<DocumentVersionUploadResult>(`/documents/${documentId}/versions`, { method: "POST", body: form }),
  updateDocument: (documentId: string, body: DocumentUpdateInput) =>
    api<DocumentRecord>(`/documents/${documentId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteDocument: (documentId: string) => api<DocumentRecord>(`/documents/${documentId}`, { method: "DELETE" }),
  restoreDocument: (documentId: string) => api<DocumentRecord>(`/documents/${documentId}/restore`, { method: "POST" }),
  purgeDocument: (documentId: string) =>
    api<{ ok: true; versionsDeleted: number }>(`/documents/${documentId}/permanent`, { method: "DELETE" }),
  bulkDocuments: (body: DocumentBulkActionInput) =>
    api<BulkActionResult>("/documents/bulk", { method: "POST", body: JSON.stringify(body) }),
  archiveFolders: (trashed = false) => api<ArchiveFolder[]>(`/archive/folders${trashed ? "?trashed=true" : ""}`),
  restoreArchiveFolder: (folderId: string, body: Partial<ArchiveFolderInput>) =>
    api<ArchiveFolder>(`/archive/folders/${folderId}/restore`, { method: "POST", body: JSON.stringify(body) }),
  createArchiveFolder: (body: ArchiveFolderInput) =>
    api<ArchiveFolder>("/archive/folders", { method: "POST", body: JSON.stringify(body) }),
  updateArchiveFolder: (folderId: string, body: Partial<ArchiveFolderInput>) =>
    api<ArchiveFolder>(`/archive/folders/${folderId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteArchiveFolder: (folderId: string) =>
    api<{ ok: true; deletedFolders: number; trashedDocuments: number }>(`/archive/folders/${folderId}`, { method: "DELETE" }),
  updateArchiveFolderDocumentsMetadata: (folderId: string, body: ArchiveFolderMetadataUpdateInput) =>
    api<ArchiveFolderMetadataUpdateResult & { ok: true }>(`/archive/folders/${folderId}/documents/metadata`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  archiveCategories: () => api<ArchiveCategory[]>("/archive/categories"),
  createArchiveCategory: (body: ArchiveCategoryInput) =>
    api<ArchiveCategory>("/archive/categories", { method: "POST", body: JSON.stringify(body) }),
  updateArchiveCategory: (categoryId: string, body: Partial<ArchiveCategoryInput>) =>
    api<ArchiveCategory>(`/archive/categories/${categoryId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteArchiveCategory: (categoryId: string, replacementCategoryId?: string | null) =>
    api<{ ok: true }>(`/archive/categories/${categoryId}${toQuery({ replacementCategoryId: replacementCategoryId || undefined })}`, {
      method: "DELETE"
    }),
  privateVault: () => api<{ vault: PrivateVault | null }>("/private-vault"),
  createPrivateVault: (body: PrivateVaultCreateInput) =>
    api<{ vault: PrivateVault }>("/private-vault", { method: "POST", body: JSON.stringify(body) }),
  updatePrivateVaultPassword: (body: PrivateVaultPasswordMetadata) =>
    api<{ vault: PrivateVault }>("/private-vault/key", { method: "PATCH", body: JSON.stringify(body) }),
  resetPrivateVaultPassword: (body: PrivateVaultPasswordResetInput) =>
    api<{ vault: PrivateVault }>("/private-vault/reset-password", { method: "POST", body: JSON.stringify(body) }),
  updatePrivateVaultSettings: (autoLockMinutes: 5 | 10 | 30) =>
    api<{ vault: PrivateVault }>("/private-vault/settings", {
      method: "PATCH",
      body: JSON.stringify({ autoLockMinutes })
    }),
  privateVaultFolders: (trash = false) =>
    api<PrivateVaultFolder[]>(`/private-vault/folders${toQuery({ trash: trash || undefined })}`),
  createPrivateVaultFolder: (body: Pick<PrivateVaultFolder, "folderId" | "encryptionVersion" | "encryptedMetadata">) =>
    api<PrivateVaultFolder>("/private-vault/folders", { method: "POST", body: JSON.stringify(body) }),
  updatePrivateVaultFolderMetadata: (folderId: string, encryptedMetadata: string) =>
    api<PrivateVaultFolder>(`/private-vault/folders/${folderId}`, {
      method: "PATCH",
      body: JSON.stringify({ encryptedMetadata })
    }),
  trashPrivateVaultFolder: (folderId: string) =>
    api<PrivateVaultFolder>(`/private-vault/folders/${folderId}`, { method: "DELETE" }),
  restorePrivateVaultFolder: (folderId: string) =>
    api<PrivateVaultFolder>(`/private-vault/folders/${folderId}/restore`, { method: "POST" }),
  purgePrivateVaultFolder: (folderId: string) =>
    api<{ ok: true }>(`/private-vault/folders/${folderId}/permanent`, { method: "DELETE" }),
  privateVaultItems: (trash = false) =>
    api<PrivateVaultItem[]>(`/private-vault/items${toQuery({ trash: trash || undefined })}`),
  uploadPrivateVaultItem: (form: FormData) =>
    api<PrivateVaultItem>("/private-vault/items", { method: "POST", body: form }),
  privateVaultItemBlob: (itemId: string) => apiArrayBuffer(`/private-vault/items/${itemId}/blob`),
  updatePrivateVaultItemMetadata: (itemId: string, encryptedMetadata: string) =>
    api<PrivateVaultItem>(`/private-vault/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ encryptedMetadata })
    }),
  updatePrivateVaultItemMetadataBatch: (updates: Array<{ itemId: string; encryptedMetadata: string }>) =>
    api<PrivateVaultItem[]>("/private-vault/items", {
      method: "PATCH",
      body: JSON.stringify({ updates })
    }),
  trashPrivateVaultItem: (itemId: string) =>
    api<PrivateVaultItem>(`/private-vault/items/${itemId}`, { method: "DELETE" }),
  restorePrivateVaultItem: (itemId: string) =>
    api<PrivateVaultItem>(`/private-vault/items/${itemId}/restore`, { method: "POST" }),
  purgePrivateVaultItem: (itemId: string) =>
    api<{ ok: true }>(`/private-vault/items/${itemId}/permanent`, { method: "DELETE" }),
  knowledge: (filters: KnowledgeFilters = {}) =>
    api<KnowledgeItem[]>(`/knowledge${toQuery(filters as Record<string, string | number | boolean | undefined>)}`),
  knowledgePage: (filters: KnowledgeFilters = {}, pagination: { page?: number; pageSize?: number } = {}) =>
    api<PaginatedResult<KnowledgeItem>>(
      `/knowledge/page${toQuery({ ...(filters as Record<string, string | number | boolean | undefined>), page: pagination.page, pageSize: pagination.pageSize })}`
    ),
  knowledgeItem: (id: string) => api<KnowledgeItem>(`/knowledge/${id}`),
  createKnowledge: (body: KnowledgeInput) =>
    api<KnowledgeItem>("/knowledge", { method: "POST", body: JSON.stringify(body) }),
  updateKnowledge: (id: string, body: Partial<KnowledgeInput>) =>
    api<KnowledgeItem>(`/knowledge/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteKnowledge: (id: string) => api<KnowledgeItem>(`/knowledge/${id}`, { method: "DELETE" }),
  restoreKnowledge: (id: string) => api<KnowledgeItem>(`/knowledge/${id}/restore`, { method: "POST" }),
  purgeKnowledge: (id: string) => api<{ ok: true }>(`/knowledge/${id}/permanent`, { method: "DELETE" }),
  manuscripts: (q = "") => api<Manuscript[]>(`/manuscripts${toQuery({ q })}`),
  manuscript: (id: string) => api<Manuscript>(`/manuscripts/${id}`),
  manuscriptBookmarks: (id: string) => api<ManuscriptBookmark[]>(`/manuscripts/${id}/bookmarks`),
  createManuscriptBookmark: (id: string, input: ManuscriptBookmarkInput) => api<ManuscriptBookmark>(`/manuscripts/${id}/bookmarks`, { method: "POST", body: JSON.stringify(input) }),
  renameManuscriptBookmark: (id: string, bookmarkId: string, name: string) => api<ManuscriptBookmark>(`/manuscripts/${id}/bookmarks/${bookmarkId}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteManuscriptBookmark: (id: string, bookmarkId: string) => api<{ ok: boolean }>(`/manuscripts/${id}/bookmarks/${bookmarkId}`, { method: "DELETE" }),
  createManuscript: (body: ManuscriptInput) =>
    api<Manuscript>("/manuscripts", { method: "POST", body: JSON.stringify(body) }),
  updateManuscript: (id: string, body: Partial<ManuscriptInput>) =>
    api<Manuscript>(`/manuscripts/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  enableManuscriptEncryption: (id: string, body: ManuscriptBodyEncryptionEnableInput) =>
    api<Manuscript>(`/manuscripts/${id}/encryption/enable`, { method: "POST", body: JSON.stringify(body) }),
  disableManuscriptEncryption: (id: string, body: ManuscriptBodyEncryptionInput) =>
    api<Manuscript>(`/manuscripts/${id}/encryption/disable`, { method: "POST", body: JSON.stringify(body) }),
  updateManuscriptEncryptionKey: (id: string, body: ManuscriptEncryptionPasswordMetadata) =>
    api<Manuscript>(`/manuscripts/${id}/encryption/key`, { method: "PATCH", body: JSON.stringify(body) }),
  resetManuscriptEncryptionPassword: (id: string, body: ManuscriptEncryptionPasswordResetInput) =>
    api<Manuscript>(`/manuscripts/${id}/encryption/reset-password`, { method: "POST", body: JSON.stringify(body) }),
  deleteManuscript: (id: string) => api<Manuscript>(`/manuscripts/${id}`, { method: "DELETE" }),
  manuscriptChapter: (manuscriptId: string, chapterId: string) =>
    api<ManuscriptChapter>(`/manuscripts/${manuscriptId}/chapters/${chapterId}`),
  createManuscriptChapter: (manuscriptId: string, body: ManuscriptChapterInput) =>
    api<ManuscriptChapter>(`/manuscripts/${manuscriptId}/chapters`, { method: "POST", body: JSON.stringify(body) }),
  updateManuscriptChapter: (manuscriptId: string, chapterId: string, body: ManuscriptChapterUpdateInput, expectedUserId?: string) =>
    api<ManuscriptChapterSummary>(`/manuscripts/${manuscriptId}/chapters/${chapterId}?summary=true`, { method: "PATCH", body: JSON.stringify(body), headers: expectedUserId ? { "x-archive-user-id": expectedUserId } : undefined }),
  manuscriptChapterVersions: (manuscriptId: string, chapterId: string, limit = 50) =>
    api<ManuscriptChapterVersionSummary[]>(`/manuscripts/${manuscriptId}/chapters/${chapterId}/versions${toQuery({ limit })}`),
  manuscriptChapterVersion: (manuscriptId: string, chapterId: string, versionId: string) =>
    api<ManuscriptChapterVersion>(`/manuscripts/${manuscriptId}/chapters/${chapterId}/versions/${versionId}`),
  restoreManuscriptChapterVersion: (manuscriptId: string, chapterId: string, versionId: string, expectedRevision: number) =>
    api<ManuscriptChapter>(`/manuscripts/${manuscriptId}/chapters/${chapterId}/versions/${versionId}/restore`, {
      method: "POST",
      body: JSON.stringify({ expectedRevision })
    }),
  deleteManuscriptChapter: (manuscriptId: string, chapterId: string) =>
    api<{ ok: true }>(`/manuscripts/${manuscriptId}/chapters/${chapterId}`, { method: "DELETE" }),
  savedDirectoryViews: (scope: string) => api<SavedDirectoryView[]>(`/saved-directory-views${toQuery({ scope })}`),
  createSavedDirectoryView: (body: SavedDirectoryViewInput) =>
    api<SavedDirectoryView>("/saved-directory-views", { method: "POST", body: JSON.stringify(body) }),
  updateSavedDirectoryView: (id: string, body: Partial<SavedDirectoryViewInput>) =>
    api<SavedDirectoryView>(`/saved-directory-views/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteSavedDirectoryView: (id: string) => api<{ ok: true }>(`/saved-directory-views/${id}`, { method: "DELETE" }),
  tags: () => api<Tag[]>("/tags"),
  createTag: (body: { name: string; color: string }) =>
    api<Tag>("/tags", { method: "POST", body: JSON.stringify(body) }),
  updateTag: (tagId: string, body: { name: string; color: string }) =>
    api<Tag>(`/tags/${tagId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteTag: (tagId: string) => api<{ ok: true }>(`/tags/${tagId}`, { method: "DELETE" }),
  notes: (caseId: string) => api<NoteRecord[]>(`/cases/${caseId}/notes`),
  discussionSummary: (filters: ServiceDiscussionFilters = {}) =>
    api<ServiceDiscussionSummary>(`/discussion/summary${toQuery(filters as Record<string, string | undefined>)}`),
  discussionMessagesPage: (filters: ServiceDiscussionFilters = {}, pagination: { page?: number; pageSize?: number } = {}) =>
    api<PaginatedResult<ServiceDiscussionMessage>>(
      `/discussion/messages${toQuery({ ...(filters as Record<string, string | undefined>), page: pagination.page, pageSize: pagination.pageSize })}`
    ),
  createDiscussionMessage: (body: ServiceDiscussionMessageInput) =>
    api<ServiceDiscussionMessage>("/discussion/messages", { method: "POST", body: JSON.stringify(body) }),
  serviceDiscussion: (caseId: string) => api<ServiceDiscussionMessage[]>(`/cases/${caseId}/discussion`),
  createServiceDiscussionMessage: (caseId: string, body: ServiceDiscussionMessageInput) =>
    api<ServiceDiscussionMessage>(`/cases/${caseId}/discussion`, { method: "POST", body: JSON.stringify(body) }),
  updateServiceDiscussionMessage: (messageId: string, body: Partial<ServiceDiscussionMessageInput>) =>
    api<ServiceDiscussionMessage>(`/discussion/messages/${messageId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteServiceDiscussionMessage: (messageId: string) =>
    api<ServiceDiscussionMessage | { ok: true }>(`/discussion/messages/${messageId}`, { method: "DELETE" }),
  uploadServiceDiscussionAttachment: (messageId: string, form: FormData) =>
    api<ServiceDiscussionAttachment>(`/discussion/messages/${messageId}/attachments`, { method: "POST", body: form }),
  createKnowledgeFromDiscussionMessage: (
    messageId: string,
    body: Partial<Pick<KnowledgeInput, "title" | "type" | "status" | "summary" | "body">> & {
      attachmentId?: string | null;
      assetId?: string | null;
    } = {}
  ) =>
    api<KnowledgeItem>(`/discussion/messages/${messageId}/knowledge`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  createNoteFromDiscussionMessage: (
    messageId: string,
    body: { body?: string; attachmentId?: string | null } = {}
  ) =>
    api<NoteRecord>(`/discussion/messages/${messageId}/note`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  createTaskFromDiscussionMessage: (messageId: string, body: Partial<TaskInput> = {}) =>
    api<TaskRecord>(`/discussion/messages/${messageId}/task`, { method: "POST", body: JSON.stringify(body) }),
  linkDiscussionMessageAsset: (messageId: string, body: { assetId: string; relationship?: string }) =>
    api<ServiceDiscussionAssetLink>(`/discussion/messages/${messageId}/assets`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  unlinkDiscussionMessageAsset: (messageId: string, assetId: string) =>
    api<{ ok: true }>(`/discussion/messages/${messageId}/assets/${assetId}`, { method: "DELETE" }),
  promoteDiscussionAttachmentToAssetDocument: (
    messageId: string,
    attachmentId: string,
    body: {
      assetId: string;
      relationship?: AssetDocumentLinkInput["relationship"];
      note?: string;
      isPinned?: boolean;
    }
  ) =>
    api<AssetDocumentLink>(`/discussion/messages/${messageId}/attachments/${attachmentId}/promote`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  linkDiscussionThreadToService: (messageId: string, caseId: string) =>
    api<{ linkedMessages: ServiceDiscussionMessage[]; caseId: string }>(`/discussion/messages/${messageId}/link-service`, {
      method: "POST",
      body: JSON.stringify({ caseId })
    }),
  updateDiscussionThreadContext: (messageId: string, body: { caseId: string | null; assetIds: string[] }) =>
    api<{ linkedMessages: ServiceDiscussionMessage[]; caseId: string | null; assetIds: string[] }>(
      `/discussion/messages/${messageId}/context`,
      { method: "PATCH", body: JSON.stringify(body) }
    ),
  markDiscussionMessageRead: (messageId: string) =>
    api<ServiceDiscussionMessage>(`/discussion/messages/${messageId}/read`, { method: "POST" }),
  markDiscussionsRead: (filters: ServiceDiscussionFilters = {}) =>
    api<{ ok: true; count: number }>("/discussion/read", { method: "POST", body: JSON.stringify(filters) }),
  allCommunications: (filters: CommunicationFilters = {}) =>
    api<CommunicationRecord[]>(`/communications${toQuery(filters as Record<string, string>)}`),
  communicationsPage: (filters: CommunicationFilters = {}, pagination: { page?: number; pageSize?: number } = {}) =>
    api<PaginatedResult<CommunicationRecord>>(
      `/communications/page${toQuery({ ...(filters as Record<string, string | undefined>), page: pagination.page, pageSize: pagination.pageSize })}`
    ),
  communications: (caseId: string) => api<CommunicationRecord[]>(`/cases/${caseId}/communications`),
  caseTimeline: (caseId: string, options: { includeArchived?: boolean } = {}) =>
    api<CaseTimelineEvent[]>(
      `/cases/${caseId}/timeline${toQuery({ includeArchived: options.includeArchived ? "true" : undefined })}`
    ),
  createNote: (caseId: string, body: string) =>
    api<NoteRecord>(`/cases/${caseId}/notes`, { method: "POST", body: JSON.stringify({ body }) }),
  createGlobalCommunication: (body: CommunicationInput) =>
    api<CommunicationRecord>("/communications", { method: "POST", body: JSON.stringify(body) }),
  updateCommunication: (communicationId: string, body: Partial<CommunicationInput>) =>
    api<CommunicationRecord>(`/communications/${communicationId}`, { method: "PATCH", body: JSON.stringify(body) }),
  bulkCommunications: (body: CommunicationBulkActionInput) =>
    api<BulkActionResult>("/communications/bulk", { method: "POST", body: JSON.stringify(body) }),
  createCommunication: (caseId: string, body: CommunicationInput) =>
    api<CommunicationRecord>(`/cases/${caseId}/communications`, { method: "POST", body: JSON.stringify(body) }),
  tasks: (caseId: string) => api<TaskRecord[]>(`/cases/${caseId}/tasks`),
  createTask: (caseId: string, body: TaskInput) =>
    api<TaskRecord>(`/cases/${caseId}/tasks`, { method: "POST", body: JSON.stringify(body) }),
  updateTask: (caseId: string, taskId: string, body: Partial<TaskInput> & { status?: TaskRecord["status"] }) =>
    api<TaskRecord>(`/cases/${caseId}/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(body) }),
  backupSettings: () => api<BackupSettings>("/backups/settings"),
  updateBackupSettings: (body: BackupSettingsUpdatePayload) =>
    api<BackupSettings>("/backups/settings", { method: "PUT", body: JSON.stringify(body) }),
  backupRuns: (limit?: number) =>
    api<BackupRun[]>(`/backups/runs${toQuery({ limit: limit ? String(limit) : undefined })}`),
  runBackup: (body: BackupRunRequest) =>
    api<BackupRun>("/backups/runs", { method: "POST", body: JSON.stringify(body) }),
  backupRunItems: (backupRunId: string) => api<BackupItem[]>(`/backups/runs/${backupRunId}/items`),
  backupManifestUrl: (backupRunId: string) => `/api/backups/runs/${backupRunId}/manifest`,
  databaseRecoveryStatus: () => api<DatabaseRecoveryStatus>("/database/recovery-status"),
  databaseSnapshots: () => api<DatabaseSnapshotListResult>("/database/snapshots"),
  createDatabaseSnapshot: () => api<DatabaseSnapshotCreateResult>("/database/snapshots", { method: "POST" }),
  createDatabaseTableExport: () => api<DatabaseTableExportResult>("/database/table-exports", { method: "POST" }),
  search: (q: string) => api<SearchResult[]>(`/search${toQuery({ q })}`),
  auditLogs: () => api<AuditLog[]>("/audit-logs")
};
