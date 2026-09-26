export const ROLES = ["Admin", "Manager", "Staff", "ReadOnly"] as const;
export const CASE_STATUSES = [
  "New",
  "Active",
  "Pending",
  "Closing Soon",
  "Closed",
  "Cancelled",
  "On Hold"
] as const;
export const CONTACT_ROLES = [
  "Seller",
  "Buyer",
  "Seller Agent",
  "Buyer Agent",
  "Seller Attorney",
  "Buyer Attorney",
  "Bank",
  "Bank Attorney",
  "Title Company",
  "Inspector",
  "Customer",
  "Site Contact",
  "Billing Contact",
  "Technical Contact",
  "Vendor",
  "Carrier",
  "Technician",
  "Project Manager",
  "Other"
] as const;
export const REALTY_DOCUMENT_CATEGORIES = [
  "Contract",
  "Seller Documents",
  "Buyer Documents",
  "Bank Documents",
  "Attorney Documents",
  "Title Documents",
  "Inspection",
  "Closing Documents",
  "Other"
] as const;
export const MD3_SERVICE_DOCUMENT_CATEGORIES = [
  "Service Request",
  "Scope / Proposal",
  "Contract",
  "PBX",
  "Network",
  "DVR / Security",
  "Cabling",
  "Support",
  "Internal Infrastructure",
  "Carrier / Vendor Records",
  "Credentials Reference",
  "Discussion Attachment",
  "Photos / Screenshots",
  "Other"
] as const;
export const PERSONAL_ARCHIVE_DOCUMENT_CATEGORIES = [
  "Identity & Records",
  "Banking & Finance",
  "Family Insurance",
  "Tax",
  "Home & Property",
  "Medical",
  "Legal & Contracts",
  "Receipts & Warranties",
  "Books & Reading",
  "Discussion Attachment",
  "Other"
] as const;
export const DOCUMENT_CATEGORIES = [
  "Contract",
  "Seller Documents",
  "Buyer Documents",
  "Bank Documents",
  "Attorney Documents",
  "Title Documents",
  "Inspection",
  "Closing Documents",
  "Service Request",
  "Scope / Proposal",
  "PBX",
  "Network",
  "DVR / Security",
  "Cabling",
  "Support",
  "Internal Infrastructure",
  "Carrier / Vendor Records",
  "Credentials Reference",
  "Discussion Attachment",
  "Photos / Screenshots",
  "Identity & Records",
  "Banking & Finance",
  "Family Insurance",
  "Tax",
  "Home & Property",
  "Medical",
  "Legal & Contracts",
  "Receipts & Warranties",
  "Books & Reading",
  "Other"
] as const;
export const DOCUMENT_REVIEW_STATUSES = [
  "needs-review",
  "in-review",
  "approved",
  "needs-info",
  "rejected",
  "superseded"
] as const;
export const PROPERTY_TYPES = [
  "Condo",
  "Co-op",
  "Single Family",
  "Multi Family",
  "Townhouse",
  "Mixed Use",
  "Commercial"
] as const;
export const TASK_STATUSES = ["Open", "In Progress", "Blocked", "Done"] as const;
export const TASK_PRIORITIES = ["Low", "Normal", "High", "Urgent"] as const;
export const BACKUP_DESTINATIONS = ["google-drive", "r2-manifest", "manual-export"] as const;
export const BACKUP_SCHEDULES = ["daily", "weekly", "monthly"] as const;
export const BACKUP_SCOPES = ["all-cases", "closed-cases", "updated-since-last-run"] as const;
export const BACKUP_RUN_STATUSES = ["completed", "dry-run", "attention", "failed"] as const;
export const BACKUP_RUN_MODES = ["r2-manifest", "dry-run", "planned-integration"] as const;
export const BACKUP_ITEM_TYPES = [
  "metadata",
  "document",
  "private-vault-item",
  "audit-log",
  "relationship",
  "manifest"
] as const;
export const BACKUP_ITEM_STATUSES = ["included", "skipped", "failed"] as const;
export const PARTY_ORGANIZATION_TYPES = [
  "Company",
  "Law Firm",
  "Bank",
  "Title Company",
  "Government Agency",
  "Vendor",
  "Nonprofit",
  "Other"
] as const;
export const TAX_ID_TYPES = ["EIN", "ITIN", "VAT", "State Registration", "Other"] as const;
export const ASSET_TYPES = [
  "Server",
  "Virtual Machine",
  "Docker Host",
  "Container Service",
  "Database",
  "Object Storage",
  "PBX Server",
  "Network Service",
  "Phone",
  "Gateway",
  "Router",
  "Switch",
  "Firewall",
  "DVR/NVR",
  "Camera",
  "SIM",
  "SIP Trunk",
  "Phone Number",
  "Line",
  "Account",
  "Software",
  "Other"
] as const;
export const ASSET_STATUSES = ["Active", "Spare", "Maintenance", "Retired", "Lost", "Unknown"] as const;
export const ASSET_DOCUMENT_RELATIONSHIPS = [
  "Setup guide",
  "Runbook",
  "Network diagram",
  "Cable / wiring",
  "Config backup",
  "Vendor manual",
  "Troubleshooting",
  "Other"
] as const;
export const CREDENTIAL_TYPES = [
  "Admin login",
  "User login",
  "SIP credential",
  "Portal login",
  "Wi-Fi credential",
  "VPN credential",
  "API key",
  "License",
  "Other"
] as const;
export const COMMUNICATION_TYPES = [
  "Call",
  "Email",
  "SMS",
  "Voicemail",
  "Carrier / Vendor Update",
  "Customer Decision",
  "Internal Note"
] as const;
export const COMMUNICATION_CHANNELS = ["all", "calls", "emails", "other"] as const;
export const COMMUNICATION_DIRECTIONS = ["Inbound", "Outbound", "Internal"] as const;
export const COMMUNICATION_SOURCES = [
  "Manual",
  "Gmail",
  "Outlook",
  "Twilio",
  "Asterisk / PBX",
  "Crater",
  "Carrier Portal",
  "Vendor Portal",
  "Other"
] as const;
export const COMMUNICATION_STATUSES = ["New", "Logged", "Needs follow-up", "Linked", "Ignored / Spam"] as const;
export const GMAIL_EXTENSION_TOKEN_SCOPES = ["gmail:health", "gmail:search", "gmail:archive"] as const;
export const KNOWLEDGE_TYPES = [
  "Runbook",
  "Troubleshooting",
  "Install guide",
  "Configuration note",
  "Service lesson",
  "Reference"
] as const;
export const KNOWLEDGE_STATUSES = ["Draft", "Verified", "Needs review", "Outdated", "Archived"] as const;
export const MANUSCRIPT_KINDS = ["Novel", "Long document", "Memoir", "Collection", "Other"] as const;
export const MANUSCRIPT_STATUSES = ["Draft", "In progress", "Complete", "Archived"] as const;
export const MANUSCRIPT_CHAPTER_FORMATS = ["rich-text", "markdown"] as const;
export const MANUSCRIPT_CHAPTER_SAVE_SOURCES = ["autosave", "manual", "restore"] as const;
export const MANUSCRIPT_CHAPTER_VERSION_RETENTION = 200;
export const SERVICE_DISCUSSION_MESSAGE_TYPES = ["message", "decision", "system"] as const;
export const SERVICE_DISCUSSION_VISIBILITIES = ["team"] as const;
export const SERVICE_DISCUSSION_THREAD_STATUSES = ["open", "needs-action", "resolved", "archived"] as const;
export const MY_WORK_SOURCES = ["discussion", "task", "communication", "service"] as const;
export const MY_WORK_STATES = [
  "overdue",
  "due-today",
  "due-soon",
  "needs-action",
  "unread",
  "blocked",
  "open",
  "unscheduled"
] as const;

export type UserRole = (typeof ROLES)[number];
export type DemoAccessMode = "internal" | "public-readonly" | "client-editor";
export type CaseStatus = (typeof CASE_STATUSES)[number];
export type ContactRole = (typeof CONTACT_ROLES)[number];
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number] | (string & {});
export type DocumentReviewStatus = (typeof DOCUMENT_REVIEW_STATUSES)[number];
export type PropertyType = (typeof PROPERTY_TYPES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type CaseArchiveStatus = "active" | "archived" | "all";
export type BackupDestination = (typeof BACKUP_DESTINATIONS)[number];
export type BackupSchedule = (typeof BACKUP_SCHEDULES)[number];
export type BackupScope = (typeof BACKUP_SCOPES)[number];
export type BackupRunStatus = (typeof BACKUP_RUN_STATUSES)[number];
export type BackupRunMode = (typeof BACKUP_RUN_MODES)[number];
export type BackupItemType = (typeof BACKUP_ITEM_TYPES)[number];
export type BackupItemStatus = (typeof BACKUP_ITEM_STATUSES)[number];
export type PartyOrganizationType = (typeof PARTY_ORGANIZATION_TYPES)[number];
export type TaxIdType = (typeof TAX_ID_TYPES)[number];
export type AssetType = (typeof ASSET_TYPES)[number];
export type AssetStatus = (typeof ASSET_STATUSES)[number];
export type AssetDocumentRelationship = (typeof ASSET_DOCUMENT_RELATIONSHIPS)[number];
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];
export type CommunicationType = (typeof COMMUNICATION_TYPES)[number];
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];
export type CommunicationDirection = (typeof COMMUNICATION_DIRECTIONS)[number];
export type CommunicationSource = (typeof COMMUNICATION_SOURCES)[number];
export type CommunicationStatus = (typeof COMMUNICATION_STATUSES)[number];
export type GmailExtensionTokenScope = (typeof GMAIL_EXTENSION_TOKEN_SCOPES)[number];
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];
export type ManuscriptKind = (typeof MANUSCRIPT_KINDS)[number];
export type ManuscriptStatus = (typeof MANUSCRIPT_STATUSES)[number];
export type ManuscriptChapterFormat = (typeof MANUSCRIPT_CHAPTER_FORMATS)[number];
export type ManuscriptChapterSaveSource = (typeof MANUSCRIPT_CHAPTER_SAVE_SOURCES)[number];
export type KnowledgeLinkEntityType = "service" | "asset" | "document" | "credential" | "discussion";
export type ServiceDiscussionMessageType = (typeof SERVICE_DISCUSSION_MESSAGE_TYPES)[number];
export type ServiceDiscussionVisibility = (typeof SERVICE_DISCUSSION_VISIBILITIES)[number];
export type ServiceDiscussionThreadStatus = (typeof SERVICE_DISCUSSION_THREAD_STATUSES)[number];
export type MyWorkSource = (typeof MY_WORK_SOURCES)[number];
export type MyWorkState = (typeof MY_WORK_STATES)[number];

export type CaseTypeCode =
  | "residential_purchase"
  | "condo_coop"
  | "commercial_purchase"
  | "refinance"
  | "demo_training"
  | "md3_one_time_service"
  | "md3_deployment_recurring_service"
  | "md3_pbx_service"
  | "md3_network_service"
  | "md3_dvr_security_service"
  | "md3_cabling_service"
  | "md3_support_service";

export type WorkItemObjectLabel = "Case" | "Matter" | "Service Request" | "Order" | "Work Order" | string;

export interface WorkItemRecord {
  workItemId: string;
  tenantId: string;
  workItemTypeCode: string;
  number: string;
  title: string;
  objectLabel: WorkItemObjectLabel;
  status: string;
  priority: string;
  targetDate?: string | null;
  valueCents: number;
  currency: string;
  primaryLocationText: string;
  summary: string;
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  closedAt?: string | null;
}

export interface User {
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

export type PublicUser = Omit<User, "createdAt"> & {
  createdAt?: string;
  tenantId?: string | null;
  mustChangePassword?: boolean;
  accessMode?: DemoAccessMode;
  mutationAllowed?: boolean;
  capabilities?: AppCapabilities;
};

export interface AppCapabilities {
  canMutate: boolean;
  canDeleteDocuments: boolean;
  canEditDocuments: boolean;
  canEditCases: boolean;
  canArchiveCases: boolean;
  canManageContacts: boolean;
  canDeleteContacts: boolean;
  canManageOrganizations: boolean;
  canDeleteOrganizations: boolean;
  canManageAssets: boolean;
  canRevealCredentials: boolean;
  canCreateTasks: boolean;
  canUpdateTasks: boolean;
  canAddNotes: boolean;
  canUpload: boolean;
  canManageBackups: boolean;
  canManageSettings: boolean;
}

export type SystemStatusState = "healthy" | "attention" | "unavailable";

export interface SystemStatusStorageMetric {
  status: SystemStatusState;
  bytes: number | null;
  objectCount?: number | null;
}

export interface SystemStatusService {
  id: "application" | "database" | "document-storage" | "backup-storage" | "code-repositories";
  label: string;
  status: SystemStatusState;
  detail: string;
}

export interface CodeRepositoryRecord {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  description: string;
  isPrivate: boolean;
  isArchived: boolean;
  isEmpty: boolean;
  isMirror: boolean;
  defaultBranch: string;
  sizeBytes: number;
  updatedAt: string;
  webUrl: string;
  sshUrl: string;
  cloneUrl: string;
}

export interface CodeRepositoryCommit {
  sha: string;
  shortSha: string;
  message: string;
  authorName: string;
  authoredAt: string;
  webUrl: string;
}

export interface CodeRepositoryBranch {
  name: string;
  sha: string;
  updatedAt: string;
  isProtected: boolean;
}

export interface CodeRepositoryTag {
  name: string;
  sha: string;
  message: string;
  archiveUrl: string;
}

export interface CodeRepositoryRelease {
  id: number;
  name: string;
  tagName: string;
  publishedAt: string;
  isDraft: boolean;
  isPrerelease: boolean;
  webUrl: string;
}

export interface CodeRepositorySnapshot {
  snapshotId: string;
  repositoryId: number;
  fullName: string;
  ref: string;
  createdAt: string;
  archiveBytes: number;
}

export interface CodeRepositoryDetail {
  repository: CodeRepositoryRecord;
  branches: CodeRepositoryBranch[];
  commits: CodeRepositoryCommit[];
  tags: CodeRepositoryTag[];
  releases: CodeRepositoryRelease[];
  snapshots: CodeRepositorySnapshot[];
  generatedAt: string;
}

export interface CodeRepositoryOverview {
  configured: boolean;
  status: SystemStatusState;
  version: string | null;
  owner: string | null;
  webUrl: string | null;
  sshHost: string | null;
  sshPort: number | null;
  repositoryCount: number;
  totalRepositoryBytes: number;
  repositories: CodeRepositoryRecord[];
  generatedAt: string;
  message: string;
}

export interface CodeRepositoryCreateInput {
  name: string;
  description?: string;
  isPrivate?: boolean;
  initialize?: boolean;
}

export interface CodeRepositoryImportInput {
  sourceUrl: string;
  name: string;
  description?: string;
  isPrivate?: boolean;
  mirror?: boolean;
  includeMetadata?: boolean;
  sourceToken?: string;
}

export interface CodeRepositoryCreateBranchInput {
  name: string;
  sourceRef?: string;
}

export interface CodeRepositoryCreateTagInput {
  name: string;
  target?: string;
  message?: string;
}

export interface CodeRepositoryUpdateInput {
  name?: string;
  description?: string;
  defaultBranch?: string;
  isPrivate?: boolean;
  isArchived?: boolean;
}

export interface SystemStatus {
  generatedAt: string;
  overallStatus: SystemStatusState;
  disk: {
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    usagePercent: number;
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    usagePercent: number;
  };
  runtime: {
    serverUptimeSeconds: number;
    applicationUptimeSeconds: number;
    cpuCount: number;
    loadAverage: [number, number, number];
  };
  storage: {
    objectUsageUpdatedAt: string;
    database: SystemStatusStorageMetric;
    documents: SystemStatusStorageMetric;
    backups: SystemStatusStorageMetric;
  };
  services: SystemStatusService[];
  latestBackup: Pick<BackupRun, "status" | "completedAt" | "itemCount" | "failedItems" | "message"> | null;
}

export interface Tag {
  tagId: string;
  name: string;
  color: string;
}

export interface CaseRecord {
  caseId: string;
  caseNumber: string;
  caseTypeCode: string;
  caseTypeName: string;
  customerOrganizationId?: string | null;
  customerOrganizationName?: string | null;
  propertyAddress: string;
  city: string;
  state: string;
  zipCode: string;
  propertyType: PropertyType;
  salePriceCents: number;
  status: CaseStatus;
  closingDate: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  notes: string;
  tags: Tag[];
}

export interface CaseInput {
  caseNumber?: string;
  caseTypeCode?: string;
  createChecklistTasks?: boolean;
  customerOrganizationId?: string | null;
  propertyAddress: string;
  city: string;
  state: string;
  zipCode: string;
  propertyType: PropertyType;
  salePriceCents: number;
  status: CaseStatus;
  closingDate: string;
  notes: string;
  tagIds?: string[];
}

export interface Contact {
  contactId: string;
  displayName: string;
  firstName: string;
  lastName: string;
  partyOrganizationId?: string | null;
  partyOrganizationName?: string | null;
  jobTitle: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  relatedServiceCount?: number;
  openServiceCount?: number;
  communicationCount?: number;
  needsFollowUpCommunicationCount?: number;
  lastCommunicationAt?: string | null;
}

export interface ContactInput {
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

export type ContactEmailFilter = "" | "has" | "missing";
export type ContactPhoneFilter = "" | "has" | "missing";
export type ContactServiceFilter = "" | "open" | "none";
export type ContactCommunicationFilter = "" | "has" | "needs-follow-up" | "none";
export type ContactSortField = "updated" | "name" | "organization";
export type SortDirection = "asc" | "desc";

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ContactFilters {
  q?: string;
  partyOrganizationId?: string;
  email?: ContactEmailFilter;
  phone?: ContactPhoneFilter;
  services?: ContactServiceFilter;
  communications?: ContactCommunicationFilter;
  sort?: ContactSortField;
  direction?: SortDirection;
}

export interface CaseContact {
  caseId: string;
  contactId: string;
  role: ContactRole;
  contact: Contact;
  case?: CaseRecord;
}

export interface PartyOrganization {
  partyOrganizationId: string;
  name: string;
  type: PartyOrganizationType;
  taxIdType: TaxIdType | "";
  taxIdValue: string;
  website: string;
  email: string;
  phone: string;
  fax: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  contactCount?: number;
  relatedServiceCount?: number;
  openServiceCount?: number;
  assetCount?: number;
  communicationCount?: number;
  needsFollowUpCommunicationCount?: number;
  lastCommunicationAt?: string | null;
}

export interface PartyOrganizationInput {
  name: string;
  type: PartyOrganizationType;
  taxIdType: TaxIdType | "";
  taxIdValue: string;
  website: string;
  email: string;
  phone: string;
  fax: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  notes: string;
}

export type OrganizationPresenceFilter = "" | "has" | "missing";
export type OrganizationRelationshipFilter = "" | "has" | "open" | "none";
export type OrganizationCommunicationFilter = "" | "has" | "needs-follow-up" | "none";
export type OrganizationSortField = "updated" | "name" | "location" | "lastCommunication";

export interface OrganizationFilters {
  q?: string;
  email?: OrganizationPresenceFilter;
  phone?: OrganizationPresenceFilter;
  website?: OrganizationPresenceFilter;
  contacts?: OrganizationRelationshipFilter;
  services?: OrganizationRelationshipFilter;
  assets?: OrganizationRelationshipFilter;
  communications?: OrganizationCommunicationFilter;
  sort?: OrganizationSortField;
  direction?: SortDirection;
}

export type AssetRelationshipFilter = "" | "linked" | "unlinked";
export type AssetCredentialFilter = "" | "has" | "none";
export type AssetIdentifierFilter = "" | "missing-network" | "missing-hardware" | "missing-phone";
export type AssetSortField = "updated" | "name" | "type" | "organization" | "service" | "installedAt" | "lastServiceAt";

export interface ManagedAsset {
  createdBy?: string | null;
  assetId: string;
  partyOrganizationId?: string | null;
  partyOrganizationName?: string | null;
  caseId?: string | null;
  caseNumber?: string | null;
  caseTitle?: string | null;
  parentAssetId?: string | null;
  parentAssetName?: string | null;
  name: string;
  assetType: AssetType | string;
  status: AssetStatus | string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  macAddress: string;
  imei: string;
  iccid: string;
  phoneNumber: string;
  extension: string;
  hostname: string;
  lanIp: string;
  wanIp: string;
  installedLocation: string;
  installedAt?: string | null;
  lastServiceAt?: string | null;
  notes: string;
  credentialCount: number;
  childAssetCount?: number;
  coreDocumentCount?: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface ManagedAssetInput {
  partyOrganizationId?: string | null;
  caseId?: string | null;
  parentAssetId?: string | null;
  name: string;
  assetType: AssetType | string;
  status: AssetStatus | string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  macAddress: string;
  imei: string;
  iccid: string;
  phoneNumber: string;
  extension: string;
  hostname: string;
  lanIp: string;
  wanIp: string;
  installedLocation: string;
  installedAt?: string | null;
  lastServiceAt?: string | null;
  notes: string;
}

export interface AssetCredential {
  credentialId: string;
  assetId: string;
  partyOrganizationId?: string | null;
  partyOrganizationName?: string | null;
  caseId?: string | null;
  caseNumber?: string | null;
  label: string;
  credentialType: CredentialType | string;
  username: string;
  loginUrl: string;
  host: string;
  notes: string;
  hasSecret: boolean;
  hasPrivateNotes: boolean;
  lastVerifiedAt?: string | null;
  rotationDueAt?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface AssetCredentialInput {
  label: string;
  credentialType: CredentialType | string;
  username: string;
  loginUrl: string;
  host: string;
  notes: string;
  secret?: string;
  privateNotes?: string;
  lastVerifiedAt?: string | null;
  rotationDueAt?: string | null;
}

export interface AssetCredentialSecret {
  credentialId: string;
  secret: string;
  privateNotes: string;
  revealedAt: string;
}

export interface DocumentRecord {
  managementOwnerUserId?: string | null;
  documentId: string;
  caseId?: string | null;
  caseNumber?: string;
  caseTitle?: string;
  partyOrganizationId?: string | null;
  partyOrganizationName?: string | null;
  documentGroupId: string;
  versionNumber: number;
  isCurrentVersion: boolean;
  supersededBy?: string | null;
  supersededAt?: string | null;
  fileName: string;
  originalFileName: string;
  fileSize: number;
  mimeType: string;
  category: DocumentCategory;
  folderId?: string | null;
  folderName?: string | null;
  folderDeletionBatchId?: string | null;
  r2ObjectKey: string;
  uploadedAt: string;
  uploadedBy: string;
  uploadedByName: string;
  reviewStatus: DocumentReviewStatus;
  reviewedBy?: string | null;
  reviewedByName?: string | null;
  reviewedAt?: string | null;
  reviewNotes: string;
  tags: Tag[];
  notes: string;
  deletedAt?: string | null;
}

export interface AssetDocumentLink {
  assetDocumentLinkId: string;
  assetId: string;
  documentId: string;
  relationship: AssetDocumentRelationship | string;
  note: string;
  isPinned: boolean;
  sortOrder: number;
  createdBy?: string | null;
  createdByName?: string | null;
  updatedBy?: string | null;
  updatedByName?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  document: DocumentRecord;
}

export interface AssetDocumentLinkInput {
  documentId: string;
  relationship: AssetDocumentRelationship | string;
  note?: string;
  isPinned?: boolean;
  sortOrder?: number;
}

export interface AssetDocumentLinkUpdateInput {
  relationship?: AssetDocumentRelationship | string;
  note?: string;
  isPinned?: boolean;
  sortOrder?: number;
}

export interface DocumentUpdateInput {
  category?: DocumentCategory;
  folderId?: string | null;
  notes?: string;
  reviewStatus?: DocumentReviewStatus;
  reviewNotes?: string;
  tagIds?: string[];
}

export interface DocumentVersionUploadResult {
  previous: DocumentRecord;
  current: DocumentRecord;
  versions: DocumentRecord[];
}

export type DocumentSortField =
  | "uploaded"
  | "fileName"
  | "fileType"
  | "fileSize"
  | "folder"
  | "category"
  | "reviewStatus"
  | "uploadedBy"
  | "service"
  | "customer";

export interface DocumentFilters {
  caseId?: string;
  assetId?: string;
  partyOrganizationId?: string;
  category?: DocumentCategory | "";
  folderId?: string;
  unfiled?: boolean;
  trashed?: boolean;
  reviewStatus?: DocumentReviewStatus | "";
  tagId?: string;
  uploadedFrom?: string;
  uploadedTo?: string;
  q?: string;
  sort?: DocumentSortField;
  direction?: SortDirection;
}

export type DirectoryViewScope = "contacts" | "organizations" | "documents" | "communications" | "assets" | "services" | "discussions";

export interface SavedDirectoryView {
  savedViewId: string;
  scope: DirectoryViewScope;
  name: string;
  filters: Record<string, unknown>;
  sort: string;
  pageSize: number;
  isDefault: boolean;
  createdBy?: string | null;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SavedDirectoryViewInput {
  scope: DirectoryViewScope;
  name: string;
  filters?: Record<string, unknown>;
  sort?: string;
  pageSize?: number;
  isDefault?: boolean;
}

export type ContactBulkAction = "set-organization" | "clear-organization" | "delete";
export interface ContactBulkActionInput {
  action: ContactBulkAction;
  contactIds: string[];
  partyOrganizationId?: string | null;
}

export type OrganizationBulkAction = "delete";
export interface OrganizationBulkActionInput {
  action: OrganizationBulkAction;
  partyOrganizationIds: string[];
}

export type DocumentBulkAction = "set-category" | "set-review-status" | "move-folder" | "delete";
export interface DocumentBulkActionInput {
  action: DocumentBulkAction;
  documentIds: string[];
  category?: DocumentCategory;
  folderId?: string | null;
  reviewStatus?: DocumentReviewStatus;
}

export interface ArchiveFolder {
  managementOwnerUserId?: string | null;
  folderId: string;
  name: string;
  parentFolderId?: string | null;
  sortOrder: number;
  fileCount: number;
  createdBy?: string | null;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  deletionBatchId?: string | null;
  deletionRootFolderId?: string | null;
}

export interface ArchiveFolderInput {
  name: string;
  parentFolderId?: string | null;
  sortOrder?: number;
}

export interface ArchiveFolderMetadataUpdateInput {
  includeSubfolders?: boolean;
  category?: DocumentCategory;
  reviewStatus?: DocumentReviewStatus;
  notes?: string;
  reviewNotes?: string;
  tagIds?: string[];
}

export interface ArchiveFolderMetadataUpdateResult {
  folderId: string;
  folderCount: number;
  matched: number;
  updated: number;
}

export interface ArchiveCategory {
  categoryId: string;
  name: string;
  sortOrder: number;
  isSystem: boolean;
  fileCount: number;
  createdBy?: string | null;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArchiveCategoryInput {
  name: string;
  sortOrder?: number;
}

export type CommunicationBulkAction = "set-status" | "assign-follow-up" | "clear-follow-up" | "link-service";
export interface CommunicationBulkActionInput {
  action: CommunicationBulkAction;
  communicationIds: string[];
  status?: CommunicationStatus;
  followUpAssignedTo?: string | null;
  followUpDueDate?: string | null;
  caseId?: string | null;
}

export type AssetBulkAction = "set-status" | "set-type";
export interface AssetBulkActionInput {
  action: AssetBulkAction;
  assetIds: string[];
  status?: AssetStatus | string;
  assetType?: AssetType | string;
}

export type CaseBulkAction = "set-status" | "add-tag" | "remove-tag";
export interface CaseBulkActionInput {
  action: CaseBulkAction;
  caseIds: string[];
  status?: CaseStatus;
  tagId?: string;
}

export interface BulkActionResult {
  requested: number;
  succeeded: number;
  failed: Array<{ id: string; error: string }>;
}

export interface NoteRecord {
  noteId: string;
  caseId: string;
  body: string;
  createdAt: string;
  createdBy: string;
  createdByName: string;
}

export interface KnowledgeLink {
  knowledgeLinkId: string;
  knowledgeId: string;
  entityType: KnowledgeLinkEntityType;
  entityId: string;
  relationship: string;
  label?: string | null;
  detail?: string | null;
  createdAt: string;
}

export interface KnowledgeItem {
  knowledgeId: string;
  managementOwnerUserId?: string | null;
  title: string;
  type: KnowledgeType;
  status: KnowledgeStatus;
  component: string;
  summary: string;
  body: string;
  keywords: string[];
  credentialReference: string;
  sourceServiceId?: string | null;
  sourceServiceNumber?: string | null;
  sourceServiceTitle?: string | null;
  lastVerifiedAt?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  updatedBy?: string | null;
  updatedByName?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  links: KnowledgeLink[];
}

export interface KnowledgeLinkInput {
  entityType: KnowledgeLinkEntityType;
  entityId: string;
  relationship?: string;
}

export interface KnowledgeInput {
  title: string;
  type: KnowledgeType;
  status: KnowledgeStatus;
  component: string;
  summary: string;
  body: string;
  keywords?: string[];
  credentialReference?: string;
  sourceServiceId?: string | null;
  lastVerifiedAt?: string | null;
  links?: KnowledgeLinkInput[];
}

export interface ManuscriptChapterSummary {
  chapterId: string;
  manuscriptId: string;
  title: string;
  contentFormat: ManuscriptChapterFormat;
  sortOrder: number;
  characterCount: number;
  revision: number;
  lastSaveSource: ManuscriptChapterSaveSource;
  createdAt: string;
  updatedAt: string;
}

export interface ManuscriptChapter extends ManuscriptChapterSummary {
  body: string;
}

export interface ManuscriptChapterVersionSummary {
  versionId: string;
  manuscriptId: string;
  chapterId: string;
  revision: number;
  title: string;
  contentFormat: ManuscriptChapterFormat;
  characterCount: number;
  saveSource: ManuscriptChapterSaveSource;
  savedBy?: string | null;
  savedByName?: string | null;
  savedAt: string;
  createdAt: string;
}

export interface ManuscriptChapterVersion extends ManuscriptChapterVersionSummary {
  body: string;
}

export interface Manuscript {
  manuscriptId: string;
  managementOwnerUserId?: string | null;
  /** Confirmed key authority; null/absent legacy values require maintenance review. */
  keyOwnerUserId?: string | null;
  title: string;
  kind: ManuscriptKind;
  status: ManuscriptStatus;
  description: string;
  encryptionEnabled: boolean;
  encryptionVersion?: number | null;
  encryptionKdf?: string | null;
  encryptionIterations?: number | null;
  encryptionSalt?: string | null;
  encryptedWorkKey?: string | null;
  recoveryEncryptedWorkKey?: string | null;
  encryptionUpdatedAt?: string | null;
  chapterCount: number;
  characterCount: number;
  createdBy?: string | null;
  createdByName?: string | null;
  updatedBy?: string | null;
  updatedByName?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  chapters: ManuscriptChapterSummary[];
}

export interface ManuscriptInput {
  title: string;
  kind: ManuscriptKind;
  status: ManuscriptStatus;
  description?: string;
}

export interface ManuscriptChapterInput {
  chapterId?: string;
  title: string;
  body?: string;
  contentFormat?: ManuscriptChapterFormat;
  sortOrder?: number;
  characterCount?: number;
}

export interface ManuscriptEncryptionPasswordMetadata {
  encryptionVersion: number;
  encryptionKdf: string;
  encryptionIterations: number;
  encryptionSalt: string;
  encryptedWorkKey: string;
}

export interface ManuscriptEncryptionMetadata extends ManuscriptEncryptionPasswordMetadata {
  recoveryEncryptedWorkKey: string;
}

export interface ManuscriptBodyEncryptionChapter {
  chapterId: string;
  expectedRevision: number;
  body: string;
}

export interface ManuscriptBodyEncryptionVersion {
  versionId: string;
  chapterId: string;
  body: string;
}

export interface ManuscriptBodyEncryptionInput {
  chapters: ManuscriptBodyEncryptionChapter[];
  versions: ManuscriptBodyEncryptionVersion[];
  metadata?: ManuscriptEncryptionMetadata;
}

export interface ManuscriptBodyEncryptionEnableInput {
  chapters: ManuscriptBodyEncryptionChapter[];
  versions: ManuscriptBodyEncryptionVersion[];
  metadata: ManuscriptEncryptionPasswordMetadata;
  recoveryWorkKey: string;
}

export interface ManuscriptEncryptionPasswordResetInput {
  currentAccountPassword: string;
  newEncryptionPassword: string;
}

export interface PrivateVaultPasswordMetadata {
  encryptionVersion: number;
  encryptionKdf: string;
  encryptionIterations: number;
  encryptionSalt: string;
  encryptedVaultKey: string;
}

export interface PrivateVault extends PrivateVaultPasswordMetadata {
  vaultId: string;
  ownerUserId: string;
  autoLockMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export interface PrivateVaultItem {
  itemId: string;
  vaultId: string;
  encryptionVersion: number;
  encryptedMetadata: string;
  wrappedFileKey: string;
  ciphertextSize: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface PrivateVaultItemMetadata {
  fileName: string;
  mimeType: string;
  size: number;
  folder: string;
  folderId?: string | null;
  favorite?: boolean;
  lastOpenedAt?: string | null;
  tags?: string[];
  note: string;
}

export interface PrivateVaultFolder {
  folderId: string;
  vaultId: string;
  encryptionVersion: number;
  encryptedMetadata: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface PrivateVaultFolderMetadata {
  name: string;
  parentFolderId: string | null;
  favorite: boolean;
}

export interface PrivateVaultCreateInput {
  metadata: PrivateVaultPasswordMetadata;
  recoveryVaultKey: string;
}

export interface PrivateVaultPasswordResetInput {
  currentAccountPassword: string;
  newVaultPassword: string;
}

export interface ManuscriptChapterUpdateInput extends Partial<ManuscriptChapterInput> {
  expectedRevision?: number;
  saveSource?: ManuscriptChapterSaveSource;
}

export type KnowledgeSortField = "updated" | "title" | "type" | "status" | "component" | "verified";

export interface KnowledgeFilters {
  q?: string;
  type?: KnowledgeType | "";
  status?: KnowledgeStatus | "";
  component?: string;
  caseId?: string;
  assetId?: string;
  documentId?: string;
  trashed?: boolean;
  sort?: KnowledgeSortField;
  direction?: SortDirection;
}

export interface ServiceDiscussionAttachment {
  attachmentId: string;
  messageId: string;
  documentId: string;
  inlineImage: boolean;
  sortOrder: number;
  createdAt: string;
  document: DocumentRecord;
}

export interface ServiceDiscussionMention {
  messageId: string;
  userId: string;
  userName: string;
  createdAt: string;
}

export interface ServiceDiscussionAssetLink {
  discussionAssetLinkId: string;
  messageId: string;
  assetId: string;
  assetName: string;
  assetType: AssetType | string;
  caseId?: string | null;
  caseNumber?: string | null;
  relationship: string;
  createdBy?: string | null;
  createdByName?: string | null;
  createdAt: string;
}

export interface ServiceDiscussionMessage {
  messageId: string;
  managementOwnerUserId?: string | null;
  title?: string | null;
  caseId?: string | null;
  caseNumber?: string | null;
  caseTitle?: string | null;
  caseStatus?: string | null;
  parentMessageId?: string | null;
  bodyText: string;
  messageType: ServiceDiscussionMessageType;
  visibility: ServiceDiscussionVisibility;
  threadStatus: ServiceDiscussionThreadStatus;
  threadOwnerUserId?: string | null;
  threadOwnerUserName?: string | null;
  isPinned: boolean;
  replyCount: number;
  replies?: ServiceDiscussionMessage[];
  latestActivityAt?: string | null;
  attachments: ServiceDiscussionAttachment[];
  mentions: ServiceDiscussionMention[];
  assetLinks: ServiceDiscussionAssetLink[];
  readAt?: string | null;
  isUnread?: boolean;
  createdBy: string;
  createdByName: string;
  updatedBy?: string | null;
  updatedByName?: string | null;
  createdAt: string;
  updatedAt: string;
  editedAt?: string | null;
  deletedAt?: string | null;
}

export interface ServiceDiscussionMessageInput {
  title?: string | null;
  bodyText: string;
  caseId?: string | null;
  parentMessageId?: string | null;
  messageType?: ServiceDiscussionMessageType;
  visibility?: ServiceDiscussionVisibility;
  threadStatus?: ServiceDiscussionThreadStatus;
  threadOwnerUserId?: string | null;
  isPinned?: boolean;
  mentionedUserIds?: string[];
}

export type ServiceDiscussionViewFilter =
  | "all"
  | "my-attention"
  | "unread"
  | "mentions"
  | "pinned"
  | "decisions"
  | "attachments"
  | "unlinked"
  | "needs-action"
  | "resolved";
export type ServiceDiscussionSortField = "newest" | "oldest" | "recent";

export interface ServiceDiscussionFilters {
  q?: string;
  view?: ServiceDiscussionViewFilter;
  caseId?: string;
  assetId?: string;
  sort?: ServiceDiscussionSortField;
}

export interface ServiceDiscussionSummary {
  all: number;
  myAttention: number;
  unread: number;
  mentions: number;
  needsAction: number;
  resolved: number;
  pinned: number;
  decisions: number;
  attachments: number;
  unlinked: number;
}

export interface CommunicationRecord {
  communicationId: string;
  caseId?: string | null;
  caseNumber?: string | null;
  caseTitle?: string | null;
  partyOrganizationId?: string | null;
  partyOrganizationName?: string | null;
  contactId?: string | null;
  contactName?: string | null;
  assetId?: string | null;
  assetName?: string | null;
  supportingDocumentId?: string | null;
  supportingDocumentName?: string | null;
  communicationType: CommunicationType;
  direction: CommunicationDirection;
  source: CommunicationSource;
  status: CommunicationStatus;
  followUpAssignedTo?: string | null;
  followUpAssignedToName?: string | null;
  followUpDueDate?: string | null;
  externalProvider: string;
  externalReference: string;
  externalUrl: string;
  sourceMetadata: Record<string, unknown>;
  subject: string;
  body: string;
  occurredAt: string;
  createdBy?: string | null;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface CommunicationInput {
  caseId?: string | null;
  partyOrganizationId?: string | null;
  contactId?: string | null;
  assetId?: string | null;
  supportingDocumentId?: string | null;
  communicationType: CommunicationType;
  direction: CommunicationDirection;
  source?: CommunicationSource;
  status?: CommunicationStatus;
  followUpAssignedTo?: string | null;
  followUpDueDate?: string | null;
  externalProvider?: string;
  externalReference?: string;
  externalUrl?: string;
  sourceMetadata?: Record<string, unknown>;
  subject: string;
  body: string;
  occurredAt: string;
}

export interface CommunicationFilters {
  q?: string;
  status?: CommunicationStatus | "";
  channel?: CommunicationChannel | "";
  communicationType?: CommunicationType | "";
  direction?: CommunicationDirection | "";
  source?: CommunicationSource | "";
  followUpAssignedTo?: string;
  followUpDueFrom?: string;
  followUpDueTo?: string;
  caseId?: string;
  partyOrganizationId?: string;
  contactId?: string;
  assetId?: string;
  dateFrom?: string;
  dateTo?: string;
  unlinked?: "true" | "false";
  workflowView?: CommunicationWorkflowView;
  sort?: CommunicationSortField;
  sortDirection?: SortDirection;
}

export interface GmailExtensionToken {
  tokenId: string;
  name: string;
  scopes: GmailExtensionTokenScope[];
  ownerUserId: string;
  ownerUserName: string;
  createdBy?: string | null;
  createdByName?: string | null;
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
}

export interface GmailExtensionTokenCreateResult {
  token: string;
  tokenRecord: GmailExtensionToken;
}

export interface TaskRecord {
  taskId: string;
  caseId: string;
  caseNumber?: string;
  caseTitle?: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string;
  assignedTo?: string | null;
  assignedToName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackupSettings {
  backupJobId: string;
  name: string;
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
  createdAt: string;
  updatedAt: string;
  updatedBy?: string | null;
  updatedByName?: string | null;
}

export interface PbxSettings {
  pbxSettingsId: string;
  isEnabled: boolean;
  allowedDids: string[];
  allowedDestinations: string[];
  ignoredDids: string[];
  ignoredDestinations: string[];
  showUnknownCallers: boolean;
  popupRetentionSeconds: number;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string | null;
  updatedByName?: string | null;
}

export interface PbxSettingsInput {
  isEnabled: boolean;
  allowedDids: string[];
  allowedDestinations: string[];
  ignoredDids: string[];
  ignoredDestinations: string[];
  showUnknownCallers: boolean;
  popupRetentionSeconds: number;
}

export interface BackupRun {
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
  createdByName?: string | null;
  message: string;
}

export interface BackupItem {
  backupItemId: string;
  backupRunId: string;
  itemType: BackupItemType;
  sourceId?: string | null;
  sourcePath: string;
  targetPath: string;
  status: BackupItemStatus;
  sizeBytes: number;
  checksum?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface BackupRunRequest {
  dryRun?: boolean;
  destination: BackupDestination;
  scope: BackupScope;
  includeMetadata: boolean;
  includeDocuments: boolean;
  includeAuditLogs: boolean;
  includeRelationshipMap: boolean;
  folderByCaseAndCategory: boolean;
  checksumManifest: boolean;
}

export interface DatabaseRecoveryStatus {
  provider: "managed-database" | "memory-demo";
  configured: boolean;
  connected: boolean;
  source: "recovery-service" | "local-config";
  projectId?: string | null;
  projectName?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  defaultBranchId?: string | null;
  regionId?: string | null;
  pgVersion?: number | null;
  restoreWindowSeconds?: number | null;
  restoreWindowLabel?: string | null;
  branchCreatedAt?: string | null;
  branchUpdatedAt?: string | null;
  endpointCount?: number | null;
  readWriteEndpointId?: string | null;
  readOnlyEndpointCount?: number | null;
  consoleUrl?: string | null;
  checkedAt: string;
  message: string;
  missingEnv: string[];
  error?: string | null;
}

export interface DatabaseSnapshotCreateResult {
  provider: "managed-database";
  projectId?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  snapshotId?: string | null;
  snapshotName: string;
  createdAt: string;
  operationIds: string[];
  message: string;
}

export interface DatabaseSnapshotSummary {
  snapshotId: string;
  snapshotName: string;
  branchId?: string | null;
  branchName?: string | null;
  createdAt?: string | null;
  expiresAt?: string | null;
  fullSizeBytes?: number | null;
  diffSizeBytes?: number | null;
}

export interface DatabaseSnapshotListResult {
  provider: "managed-database";
  configured: boolean;
  connected: boolean;
  projectId?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  snapshots: DatabaseSnapshotSummary[];
  checkedAt: string;
  message: string;
  missingEnv: string[];
  error?: string | null;
}

export interface DatabaseTableExportResult {
  provider: "database-json-r2" | "memory-demo";
  exportId: string;
  objectKey: string;
  fileName: string;
  createdAt: string;
  tableCount: number;
  rowCount: number;
  sizeBytes: number;
  checksum: string;
  downloadUrl: string;
  message: string;
}

export interface ChecklistTemplateItem {
  title: string;
  description: string;
  priority?: TaskPriority;
  dueOffsetDays: number;
  dueFrom: "created" | "closing";
}

export interface CaseTypeTemplate {
  code: CaseTypeCode | string;
  name: string;
  description: string;
  requiredDocumentCategories: DocumentCategory[];
  checklist: ChecklistTemplateItem[];
  closingReadinessEnabled: boolean;
  sortOrder: number;
  isActive: boolean;
}

export interface DocumentCategorySummary {
  category: DocumentCategory;
  count: number;
  totalSize: number;
  latestUploadedAt?: string | null;
  required: boolean;
  complete: boolean;
}

export interface CaseReadiness {
  caseId: string;
  caseTypeCode: string;
  caseTypeName: string;
  closingReadinessEnabled: boolean;
  requiredDocumentCategories: DocumentCategory[];
  presentDocumentCategories: DocumentCategory[];
  missingDocumentCategories: DocumentCategory[];
  documentCategories: DocumentCategorySummary[];
  openTasks: TaskRecord[];
  completedTasks: number;
  totalTasks: number;
  canClose: boolean;
  checkedAt: string;
  message: string;
}

export interface CloseCaseInput {
  force?: boolean;
  reason?: string;
}

export interface CloseCaseResult {
  ok: boolean;
  case: CaseRecord;
  readiness: CaseReadiness;
  blockers: string[];
  forced: boolean;
  message: string;
}

export interface TaskInput {
  title: string;
  description: string;
  priority?: TaskPriority;
  dueDate: string;
  assignedTo?: string | null;
}

export interface AuditLog {
  auditLogId: string;
  action: string;
  entityType: string;
  entityId: string;
  userId: string;
  userName: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export type CaseTimelineEventType = "note" | "communication" | "case" | "document" | "task" | "party" | "asset" | "credential" | "system";

export interface CaseTimelineEvent {
  eventId: string;
  caseId: string;
  type: CaseTimelineEventType;
  title: string;
  description: string;
  createdAt: string;
  createdByName: string;
  source: "note" | "communication" | "audit";
  action?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

export interface CaseWorkspacePayload {
  case: CaseRecord;
  caseContacts: CaseContact[];
  documents: DocumentRecord[];
  knowledge: KnowledgeItem[];
  discussion: ServiceDiscussionMessage[];
  readiness: CaseReadiness;
  timeline: CaseTimelineEvent[];
  communications: CommunicationRecord[];
  tasks: TaskRecord[];
  tags: Tag[];
  contacts: Contact[];
  partyOrganizations: PartyOrganization[];
  users: PublicUser[];
  caseTypes: CaseTypeTemplate[];
}

export interface DashboardStats {
  totalCases: number;
  activeCases: number;
  closingSoon: number;
  pendingCases: number;
  recentlyUpdatedCases: CaseRecord[];
  recentUploads: DocumentRecord[];
  casesByStatus: Array<{ status: CaseStatus; count: number }>;
  workQueue: {
    upcomingCases: CaseRecord[];
    overdueTasks: TaskRecord[];
    dueSoonTasks: TaskRecord[];
    blockedTasks: TaskRecord[];
  };
}

export interface MyWorkFilters {
  source?: MyWorkSource | "";
  owner?: "attention" | "unassigned" | "all" | string;
  state?: MyWorkState | "";
  dateFrom?: string;
  dateTo?: string;
}

export interface MyWorkItem {
  key: string;
  source: MyWorkSource;
  sourceId: string;
  title: string;
  summary: string;
  status: string;
  states: MyWorkState[];
  relevantDate: string;
  dueDate?: string | null;
  activityAt: string;
  ownerUserId?: string | null;
  ownerUserName?: string | null;
  ownerScope: "assigned" | "unassigned" | "shared";
  needsCurrentUserAttention: boolean;
  caseId?: string | null;
  caseNumber?: string | null;
  caseTitle?: string | null;
  priority?: TaskPriority | null;
  replyCount?: number;
}

export interface MyWorkQueue {
  generatedAt: string;
  today: string;
  items: MyWorkItem[];
  summary: {
    total: number;
    overdue: number;
    dueToday: number;
    unassigned: number;
    bySource: Record<MyWorkSource, number>;
  };
}

export interface SearchResult {
  type: "case" | "contact" | "document" | "organization" | "asset" | "knowledge" | "manuscript";
  id: string;
  title: string;
  subtitle: string;
  meta: string;
  matchReason?: string;
  caseId?: string;
  quickValues?: SearchQuickValue[];
  credentialMatches?: SearchCredentialMatch[];
  credentialMatchCount?: number;
}

export interface SearchQuickValue {
  label: string;
  value: string;
  kind?: "text" | "url";
}

export interface SearchCredentialMatch {
  credentialId: string;
  label: string;
  credentialType: string;
  host: string;
  loginUrl: string;
}

export type PbxCallStatus = "ringing" | "answered" | "ended" | "missed" | "unknown";
export type PbxCallDirection = "Inbound" | "Outbound" | "Internal";

export interface PbxCallMatchedEntity {
  type: "contact" | "organization" | "asset";
  id: string;
  label: string;
  detail: string;
  matchedField: string;
  matchedValue: string;
}

export interface PbxCallMatchedService {
  caseId: string;
  caseNumber: string;
  title: string;
  status: CaseStatus;
}

export interface PbxCallEvent {
  eventId: string;
  provider: "Asterisk / PBX";
  externalProvider: string;
  callId: string;
  linkedId: string;
  uniqueId: string;
  status: PbxCallStatus;
  direction: PbxCallDirection;
  callerNumber: string;
  callerName: string;
  normalizedCallerNumber: string;
  displayCallerNumber: string;
  destination: string;
  extension: string;
  channel: string;
  startedAt: string;
  answeredAt?: string | null;
  endedAt?: string | null;
  updatedAt: string;
  matches: PbxCallMatchedEntity[];
  services: PbxCallMatchedService[];
  metadata: Record<string, unknown>;
}

export interface CaseFilters {
  q?: string;
  status?: CaseStatus | "";
  tag?: string;
  contactRole?: ContactRole | "";
  caseTypeCode?: string;
  customerOrganizationId?: string;
  assignedTo?: string;
  assetId?: string;
  closingFrom?: string;
  closingTo?: string;
  archiveStatus?: CaseArchiveStatus;
  sort?: CaseSortField;
  direction?: SortDirection;
}

export interface AssetFilters {
  q?: string;
  type?: AssetType | string;
  status?: AssetStatus | string;
  partyOrganizationId?: string;
  caseId?: string;
  parentAssetId?: string;
  organization?: AssetRelationshipFilter;
  service?: AssetRelationshipFilter;
  parent?: AssetRelationshipFilter;
  credentials?: AssetCredentialFilter;
  identifiers?: AssetIdentifierFilter;
  sort?: AssetSortField;
  direction?: SortDirection;
}

export type CommunicationSortField = "occurred" | "updated" | "subject" | "status" | "type" | "contact" | "organization" | "service";
export type CommunicationWorkflowView = "inbox" | "followUp" | "linked" | "archived" | "all";
export type CaseSortField = "updated" | "number" | "title" | "status" | "targetDate" | "customer" | "type";

export interface ApiErrorPayload {
  error: string;
  detail?: string;
}
