<script setup lang="ts">
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, BarChart3, BookOpen, CheckCircle2, ChevronDown, ChevronRight, Download, Edit3, Eye, FileText, FolderCheck, FolderOpen, FolderPlus, FolderX, Play, Plus, RotateCcw, Save, Search, Settings2, SlidersHorizontal, Trash2, UploadCloud, X } from "lucide-vue-next";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { client } from "../api/client";
import { useBusinessTemplate, workItemPath } from "../businessTemplate";
import DirectoryToolbar from "../components/directory/DirectoryToolbar.vue";
import DocumentDetailDrawer from "../components/documents/DocumentDetailDrawer.vue";
import ArchiveManagementAccess from "../components/documents/ArchiveManagementAccess.vue";
import PageHeader from "../components/PageHeader.vue";
import { useDismissibleMenus } from "../composables/useDismissibleMenus";
import { useResizablePanel } from "../composables/useResizablePanel";
import { useI18n } from "../i18n";
import { formatDateTime, formatFileSize } from "../shared/format";
import { isAudioPreviewFile } from "../shared/audioPreview";
import { isImagePreviewFile } from "../shared/imagePreview";
import { fileTypeLabel, naturalCompare } from "../shared/naturalSort";
import type {
  ArchiveCategory,
  ArchiveFolder,
  CaseReadiness,
  CaseRecord,
  DocumentCategory,
  DocumentFilters,
  DocumentRecord,
  DocumentReviewStatus,
  DocumentSortField,
  DocumentUpdateInput,
  SavedDirectoryView,
  Tag
} from "../shared/types";
import { useAuthStore } from "../stores/auth";
import { useArchiveAudioPlayerStore } from "../stores/archiveAudioPlayer";
import { useToastStore } from "../stores/toasts";

const { t } = useI18n();
const { template, labels } = useBusinessTemplate();
const auth = useAuthStore();
const archiveAudio = useArchiveAudioPlayerStore();
const toasts = useToastStore();
const route = useRoute();
const router = useRouter();
useDismissibleMenus();

const ARCHIVE_DOCUMENT_PREVIEW_STATE = "archiveDocumentPreview";
const ARCHIVE_DIRECTORY_HISTORY_STATE = "archiveDirectoryHistory";
const ARCHIVE_SIDEBAR_WIDTH_STORAGE_KEY = "personal-archive.archive.sidebar-width";
const ARCHIVE_COLUMNS_STORAGE_KEY = "personal-archive.archive.columns.v1";

type ArchiveLocationMode = "all" | "root" | "folder" | "unfiled" | "trash";
type ArchiveColumnKey = "fileType" | "location" | "category" | "review" | "size" | "uploaded";
type ArchiveColumnProfile = "archive" | "music";
type ArchiveColumnVisibility = Record<ArchiveColumnKey, boolean>;

const ARCHIVE_COLUMN_OPTIONS: ReadonlyArray<{ key: ArchiveColumnKey; label: string }> = [
  { key: "fileType", label: "File type" },
  { key: "location", label: "Location" },
  { key: "category", label: "Category" },
  { key: "review", label: "Review status" },
  { key: "size", label: "Size" },
  { key: "uploaded", label: "Date uploaded" }
];

const DEFAULT_ARCHIVE_COLUMNS: Record<ArchiveColumnProfile, ArchiveColumnVisibility> = {
  archive: { fileType: true, location: true, category: true, review: true, size: true, uploaded: true },
  music: { fileType: true, location: true, category: true, review: false, size: true, uploaded: true }
};

function loadArchiveColumnVisibility(): Record<ArchiveColumnProfile, ArchiveColumnVisibility> {
  try {
    const parsed = JSON.parse(localStorage.getItem(ARCHIVE_COLUMNS_STORAGE_KEY) ?? "{}") as Partial<Record<ArchiveColumnProfile, Partial<ArchiveColumnVisibility>>>;
    return {
      archive: { ...DEFAULT_ARCHIVE_COLUMNS.archive, ...parsed.archive },
      music: { ...DEFAULT_ARCHIVE_COLUMNS.music, ...parsed.music }
    };
  } catch {
    return {
      archive: { ...DEFAULT_ARCHIVE_COLUMNS.archive },
      music: { ...DEFAULT_ARCHIVE_COLUMNS.music }
    };
  }
}

interface ArchiveDirectoryHistoryState {
  locationMode: ArchiveLocationMode;
  folderId: string | null;
  category: string;
  search: string;
  reviewStatus: string;
  organizationId: string;
  tagId: string;
  uploadedFrom: string;
  uploadedTo: string;
  sortOption: string;
  savedViewId: string;
  showAdvancedFilters: boolean;
  page: number;
  pageSize: number;
}

interface ArchiveUploadFile {
  file: File;
  relativePath: string;
}

interface ArchiveUploadSelection {
  files: ArchiveUploadFile[];
  folderPaths: string[];
}

const DOCUMENT_REVIEW_LABELS: Record<DocumentReviewStatus, string> = {
  "needs-review": "Needs review",
  "in-review": "In review",
  approved: "Approved",
  "needs-info": "Needs information",
  rejected: "Rejected",
  superseded: "Superseded"
};

const DOCUMENT_REVIEW_CLASSES: Record<DocumentReviewStatus, string> = {
  "needs-review": "bg-amber-100 text-amber-900",
  "in-review": "bg-blue-100 text-blue-900",
  approved: "bg-emerald-100 text-emerald-900",
  "needs-info": "bg-yellow-100 text-yellow-900",
  rejected: "bg-red-100 text-red-900",
  superseded: "bg-ink-100 text-ink-700"
};
const ARCHIVE_SORT_STORAGE_KEY = "personal-archive.archive.sort";
const ARCHIVE_SORT_FIELDS: readonly DocumentSortField[] = [
  "fileName",
  "uploaded",
  "fileType",
  "fileSize",
  "folder",
  "category",
  "reviewStatus",
  "uploadedBy"
];
const ARCHIVE_SORT_LABELS: Record<DocumentSortField, string> = {
  fileName: "Name",
  uploaded: "Date uploaded",
  fileType: "File type",
  fileSize: "Size",
  folder: "Location",
  category: "Category",
  reviewStatus: "Review status",
  uploadedBy: "Uploaded by",
  service: "Service",
  customer: "Customer"
};
const storedArchiveSort = localStorage.getItem(ARCHIVE_SORT_STORAGE_KEY) ?? "";
const [storedArchiveSortField, storedArchiveSortDirection] = storedArchiveSort.split("_");
const initialArchiveSort = ARCHIVE_SORT_FIELDS.includes(storedArchiveSortField as DocumentSortField)
  && (storedArchiveSortDirection === "asc" || storedArchiveSortDirection === "desc")
  ? storedArchiveSort
  : "uploaded_desc";
const ALL_SERVICES = "__all__";
const cases = ref<CaseRecord[]>([]);
const documents = ref<DocumentRecord[]>([]);
const tags = ref<Tag[]>([]);
const savedViews = ref<SavedDirectoryView[]>([]);
const readiness = ref<CaseReadiness | null>(null);
const selectedCaseId = ref(ALL_SERVICES);
const selectedCategory = ref("");
const documentSearch = ref("");
const selectedReviewStatus = ref("");
const selectedOrganizationId = ref("");
const selectedTagId = ref("");
const uploadedFrom = ref("");
const uploadedTo = ref("");
const sortOption = ref(initialArchiveSort);
const selectedSavedViewId = ref("");
const savedViewName = ref("");
const showAdvancedFilters = ref(false);
const page = ref(1);
const pageSize = ref(25);
const totalDocuments = ref(0);
const totalPages = ref(1);
const archiveColumnVisibility = ref(loadArchiveColumnVisibility());
const selectedDocumentIds = ref<string[]>([]);
const bulkCategory = ref<DocumentCategory | "">("");
const bulkReviewStatus = ref<DocumentReviewStatus | "">("");
const documentsLoading = ref(false);
const documentsError = ref("");
const selectedDocument = ref<DocumentRecord | null>(null);
const documentVersions = ref<DocumentRecord[]>([]);
const showDocumentDetail = ref(false);
const documentFormError = ref("");
const savingDocument = ref(false);
const documentVersionError = ref("");
const uploadingDocumentVersion = ref(false);
const documentRouteReady = ref(false);
const archiveRouteReady = ref(false);
const archiveImageSequence = ref<DocumentRecord[]>([]);
const archiveImageSequenceLoading = ref(false);
let archiveImageSequenceRequestId = 0;
const showArchiveUpload = ref(false);
const archiveUploadInput = ref<HTMLInputElement | null>(null);
const archiveUploadDirectoryInput = ref<HTMLInputElement | null>(null);
const archiveUploadFiles = ref<ArchiveUploadFile[]>([]);
const archiveUploadFolderPaths = ref<string[]>([]);
const archiveUploadDragging = ref(false);
const archiveUploadScanning = ref(false);
const archiveUploadCategory = ref<DocumentCategory>("Other");
const archiveUploadNotes = ref("");
const archiveUploadTagIds = ref<string[]>([]);
const uploadingArchiveDocuments = ref(false);
const archiveUploadProgress = ref(0);
const archiveUploadError = ref("");
const archiveUploadFolderId = ref<string | null>(null);
const archiveFolders = ref<ArchiveFolder[]>([]);
const trashedArchiveFolders = ref<ArchiveFolder[]>([]);
const archiveFolderPendingRestore = ref<ArchiveFolder | null>(null);
const archiveRestoreName = ref("");
const archiveRestoreParent = ref("__original__");
const archiveRestoreError = ref("");
const restoringArchiveFolder = ref(false);
const archiveCategories = ref<ArchiveCategory[]>([]);
const archiveLocationMode = ref<ArchiveLocationMode>("all");
const selectedArchiveFolderId = ref<string | null>(null);
const expandedArchiveFolderIds = ref<string[]>([]);
const {
  width: archiveSidebarWidth,
  minWidth: archiveSidebarMinWidth,
  maxWidth: archiveSidebarMaxWidth,
  resizing: archiveSidebarResizing,
  startResize: startArchiveSidebarResize,
  resetWidth: resetArchiveSidebarWidth,
  onSeparatorKeydown: onArchiveSidebarResizeKeydown
} = useResizablePanel({
  storageKey: ARCHIVE_SIDEBAR_WIDTH_STORAGE_KEY,
  defaultWidth: 248,
  minWidth: 224,
  maxWidth: 640
});
const archiveFolderDropTargetId = ref<string | null | "root">(null);
const archiveTrashCount = ref(0);
const archiveUnfiledCount = ref(0);
const bulkFolderId = ref<string | null | "">("");
const showFolderEditor = ref(false);
const editingArchiveFolder = ref<ArchiveFolder | null>(null);
const archiveFolderName = ref("");
const archiveFolderParentId = ref<string | null>(null);
const archiveFolderError = ref("");
const savingArchiveFolder = ref(false);
const archiveFolderPendingDeletion = ref<ArchiveFolder | null>(null);
const archiveFolderDeleteError = ref("");
const deletingArchiveFolder = ref(false);
const archiveFolderMetadataTarget = ref<ArchiveFolder | null>(null);
const archiveFolderMetadataIncludeSubfolders = ref(true);
const archiveFolderMetadataApplyCategory = ref(false);
const archiveFolderMetadataCategory = ref<DocumentCategory>("Other");
const archiveFolderMetadataApplyReviewStatus = ref(false);
const archiveFolderMetadataReviewStatus = ref<DocumentReviewStatus>("needs-review");
const archiveFolderMetadataApplyNotes = ref(false);
const archiveFolderMetadataNotes = ref("");
const archiveFolderMetadataApplyReviewNotes = ref(false);
const archiveFolderMetadataReviewNotes = ref("");
const archiveFolderMetadataApplyTags = ref(false);
const archiveFolderMetadataTagIds = ref<string[]>([]);
const archiveFolderMetadataSaving = ref(false);
const archiveFolderMetadataError = ref("");
const showCategoryManager = ref(false);
const newArchiveCategoryName = ref("");
const archiveCategoryDrafts = ref<Record<string, string>>({});
const archiveCategoryError = ref("");
const savingArchiveCategoryId = ref<string | null>(null);
const deletingArchiveCategory = ref<ArchiveCategory | null>(null);
const replacementArchiveCategoryId = ref("");
const hasCases = computed(() => template.value.personalArchive || cases.value.length > 0);
const caseById = computed(() => new Map(cases.value.map((caseRecord) => [caseRecord.caseId, caseRecord])));
const selectedCase = computed(() => (selectedCaseId.value === ALL_SERVICES ? null : cases.value.find((caseRecord) => caseRecord.caseId === selectedCaseId.value) ?? null));
const globalDocumentsMode = computed(() => selectedCaseId.value === ALL_SERVICES);
const organizationOptions = computed(() => {
  const options = new Map<string, string>();
  cases.value.forEach((caseRecord) => {
    if (caseRecord.customerOrganizationId && caseRecord.customerOrganizationName) {
      options.set(caseRecord.customerOrganizationId, caseRecord.customerOrganizationName);
    }
  });
  return [...options.entries()]
    .map(([partyOrganizationId, name]) => ({ partyOrganizationId, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
});
const documentReviewOptions = computed(() =>
  Object.entries(DOCUMENT_REVIEW_LABELS).map(([status, label]) => ({ status: status as DocumentReviewStatus, label }))
);
const archiveColumnProfile = computed<ArchiveColumnProfile>(() =>
  documents.value.length > 0 && documents.value.every((document) => isAudioPreviewFile(document.mimeType, document.originalFileName))
    ? "music"
    : "archive"
);
const archiveColumnProfileLabel = computed(() => archiveColumnProfile.value === "music" ? "Music view" : "Archive view");
const visibleArchiveColumnCount = computed(() =>
  Object.values(archiveColumnVisibility.value[archiveColumnProfile.value]).filter(Boolean).length
);
const archiveFolderRowColspan = computed(() => 2 + visibleArchiveColumnCount.value);
const archiveTableMinWidth = computed(() => {
  const widths: Record<ArchiveColumnKey, number> = {
    fileType: 88,
    location: 128,
    category: 136,
    review: 124,
    size: 88,
    uploaded: 152
  };
  const optionalWidth = ARCHIVE_COLUMN_OPTIONS.reduce(
    (total, column) => total + (archiveColumnVisibility.value[archiveColumnProfile.value][column.key] ? widths[column.key] : 0),
    0
  );
  return Math.max(760, 568 + optionalWidth);
});
const sortParts = computed(() => {
  const [sort, direction] = sortOption.value.split("_");
  return {
    sort: (sort || "uploaded") as DocumentSortField,
    direction: (direction || "desc") as "asc" | "desc"
  };
});
const documentSortField = computed(() => sortParts.value.sort);
const documentSortDirection = computed(() => sortParts.value.direction);
const documentSortDirectionLabel = computed(() => {
  if (documentSortField.value === "uploaded") return documentSortDirection.value === "asc" ? "Oldest first" : "Newest first";
  if (documentSortField.value === "fileSize") return documentSortDirection.value === "asc" ? "Smallest first" : "Largest first";
  return documentSortDirection.value === "asc" ? "A–Z" : "Z–A";
});
const documentSortIcon = computed(() => documentSortDirection.value === "asc" ? ArrowUp : ArrowDown);

function setDocumentSortField(event: Event) {
  const field = (event.target as HTMLSelectElement).value as DocumentSortField;
  if (!ARCHIVE_SORT_FIELDS.includes(field)) return;
  const defaultDirection = field === "uploaded" || field === "fileSize" ? "desc" : "asc";
  const direction = documentSortField.value === field ? documentSortDirection.value : defaultDirection;
  sortOption.value = `${field}_${direction}`;
}

function toggleDocumentSortDirection() {
  sortOption.value = `${documentSortField.value}_${documentSortDirection.value === "asc" ? "desc" : "asc"}`;
}

function sortDocumentsFromColumn(field: DocumentSortField) {
  if (documentSortField.value === field) {
    toggleDocumentSortDirection();
    return;
  }
  const defaultDirection = field === "uploaded" || field === "fileSize" ? "desc" : "asc";
  sortOption.value = `${field}_${defaultDirection}`;
}

function isArchiveColumnVisible(column: ArchiveColumnKey) {
  return archiveColumnVisibility.value[archiveColumnProfile.value][column];
}

function setArchiveColumnVisible(column: ArchiveColumnKey, event: Event) {
  const visible = (event.target as HTMLInputElement).checked;
  const profile = archiveColumnProfile.value;
  archiveColumnVisibility.value = {
    ...archiveColumnVisibility.value,
    [profile]: { ...archiveColumnVisibility.value[profile], [column]: visible }
  };
}

function resetArchiveColumns() {
  const profile = archiveColumnProfile.value;
  archiveColumnVisibility.value = {
    ...archiveColumnVisibility.value,
    [profile]: { ...DEFAULT_ARCHIVE_COLUMNS[profile] }
  };
}

function caseForDocument(document: DocumentRecord) {
  if (!document.caseId) return null;
  return caseById.value.get(document.caseId) ?? null;
}

function documentMatchesNonCategoryFilters(document: DocumentRecord) {
  const caseRecord = caseForDocument(document);
  if (selectedReviewStatus.value && document.reviewStatus !== selectedReviewStatus.value) return false;
  if (selectedOrganizationId.value && caseRecord?.customerOrganizationId !== selectedOrganizationId.value) return false;
  if (selectedTagId.value && !document.tags.some((tag) => tag.tagId === selectedTagId.value)) return false;
  if (uploadedFrom.value && document.uploadedAt.slice(0, 10) < uploadedFrom.value) return false;
  if (uploadedTo.value && document.uploadedAt.slice(0, 10) > uploadedTo.value) return false;
  if (documentSearch.value.trim()) {
    const query = documentSearch.value.trim().toLowerCase();
    const haystack = [
      document.fileName,
      document.originalFileName,
      document.category,
      document.notes,
      document.reviewStatus,
      document.reviewNotes,
      caseRecord?.caseNumber,
      caseRecord?.propertyAddress,
      caseRecord?.customerOrganizationName,
      ...document.tags.map((tag) => tag.name)
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

const documentsMatchingNonCategoryFilters = computed(() => documents.value);
const filteredDocuments = computed(() => documents.value);
const trashedArchiveRoots = computed(() => archiveLocationMode.value === "trash"
  ? trashedArchiveFolders.value.filter((folder) => folder.deletionRootFolderId === folder.folderId) : []);
const documentCandidateCount = computed(() => totalDocuments.value);
const documentTotalCount = computed(() => totalDocuments.value);
const selectedDocumentCount = computed(() => selectedDocumentIds.value.length);
const currentPageAllSelected = computed(
  () => documents.value.length > 0 && documents.value.every((document) => selectedDocumentIds.value.includes(document.documentId))
);
const selectedServiceLabel = computed(() =>
  selectedCase.value ? `${selectedCase.value.caseNumber} - ${selectedCase.value.propertyAddress}` : `All ${labels.value.lowerPlural}`
);
const activeFilterCount = computed(
  () =>
    [
      selectedCaseId.value !== ALL_SERVICES ? selectedCaseId.value : "",
      selectedCategory.value,
      selectedReviewStatus.value,
      selectedOrganizationId.value,
      selectedTagId.value,
      uploadedFrom.value,
      uploadedTo.value
    ].filter(Boolean).length
);
const personalArchiveFilterCount = computed(
  () =>
    [
      selectedReviewStatus.value,
      selectedTagId.value,
      uploadedFrom.value,
      uploadedTo.value,
      sortOption.value !== "uploaded_desc" ? sortOption.value : "",
      selectedSavedViewId.value
    ].filter(Boolean).length
);
const activeFilterChips = computed(() => {
  const selectedCategoryLabel = selectedCategory.value;
  const reviewLabel = selectedReviewStatus.value ? DOCUMENT_REVIEW_LABELS[selectedReviewStatus.value as DocumentReviewStatus] : "";
  const organizationName = organizationOptions.value.find(
    (organization) => organization.partyOrganizationId === selectedOrganizationId.value
  )?.name;
  const tagName = tags.value.find((tag) => tag.tagId === selectedTagId.value)?.name;
  return [
    selectedCaseId.value !== ALL_SERVICES ? { key: "caseId", label: `${labels.value.singular}: ${selectedServiceLabel.value}` } : null,
    selectedCategoryLabel ? { key: "category", label: `Category: ${selectedCategoryLabel}` } : null,
    reviewLabel ? { key: "reviewStatus", label: `Review: ${reviewLabel}` } : null,
    selectedOrganizationId.value ? { key: "organization", label: `Customer: ${organizationName ?? selectedOrganizationId.value}` } : null,
    selectedTagId.value ? { key: "tag", label: `Tag: ${tagName ?? selectedTagId.value}` } : null,
    uploadedFrom.value ? { key: "uploadedFrom", label: `Uploaded from: ${uploadedFrom.value}` } : null,
    uploadedTo.value ? { key: "uploadedTo", label: `Uploaded to: ${uploadedTo.value}` } : null
  ].filter(Boolean) as Array<{ key: string; label: string }>;
});
const reviewAttentionCount = computed(() =>
  filteredDocuments.value.filter((document) => ["needs-review", "in-review", "needs-info", "rejected"].includes(document.reviewStatus)).length
);
const documentCategorySummaries = computed(() => {
  if (template.value.personalArchive && archiveCategories.value.length) {
    return archiveCategories.value.map((category) => ({
      category: category.name as DocumentCategory,
      count: category.fileCount,
      required: false,
      complete: category.fileCount > 0
    }));
  }
  const readinessByCategory = new Map((readiness.value?.documentCategories ?? []).map((category) => [category.category, category]));
  const categories = new Set<DocumentCategory>([
    ...(template.value.documentCategories as DocumentCategory[]),
    ...documentsMatchingNonCategoryFilters.value.map((document) => document.category),
    ...readinessByCategory.keys()
  ]);
  return [...categories].map((category) => {
    const count = documentsMatchingNonCategoryFilters.value.filter((document) => document.category === category).length;
    const readinessCategory = readinessByCategory.get(category);
    return {
      category,
      count,
      required: readinessCategory?.required ?? false,
      complete: readinessCategory?.complete ?? count > 0
    };
  });
});
const availableDocumentCategories = computed(() => documentCategorySummaries.value.map((category) => category.category));
const archiveAllFileCount = computed(() => archiveCategories.value.reduce((total, category) => total + category.fileCount, 0));
const archiveFolderById = computed(() => new Map(archiveFolders.value.map((folder) => [folder.folderId, folder])));
const archiveFolderChildren = computed(() => {
  const children = new Map<string | null, ArchiveFolder[]>();
  archiveFolders.value.forEach((folder) => {
    const parentId = folder.parentFolderId ?? null;
    children.set(parentId, [...(children.get(parentId) ?? []), folder]);
  });
  children.forEach((rows) => rows.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)));
  return children;
});
const flattenedArchiveFolders = computed(() => {
  const result: Array<{ folder: ArchiveFolder; depth: number; hasChildren: boolean }> = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const folder of archiveFolderChildren.value.get(parentId) ?? []) {
      const children = archiveFolderChildren.value.get(folder.folderId) ?? [];
      result.push({ folder, depth, hasChildren: children.length > 0 });
      if (expandedArchiveFolderIds.value.includes(folder.folderId)) visit(folder.folderId, depth + 1);
    }
  };
  visit(null, 0);
  return result;
});
const currentArchiveChildFolders = computed(() => {
  let rows: ArchiveFolder[] = [];
  if (archiveLocationMode.value === "root") rows = archiveFolderChildren.value.get(null) ?? [];
  if (archiveLocationMode.value === "folder" && selectedArchiveFolderId.value) {
    rows = archiveFolderChildren.value.get(selectedArchiveFolderId.value) ?? [];
  }
  const direction = documentSortField.value === "fileName" && documentSortDirection.value === "desc" ? -1 : 1;
  return [...rows].sort((left, right) => direction * naturalCompare(left.name, right.name));
});
const currentArchiveFolder = computed(() =>
  selectedArchiveFolderId.value ? archiveFolderById.value.get(selectedArchiveFolderId.value) ?? null : null
);

function archiveDirectorySnapshot(): ArchiveDirectoryHistoryState {
  return {
    locationMode: archiveLocationMode.value,
    folderId: selectedArchiveFolderId.value,
    category: selectedCategory.value,
    search: documentSearch.value,
    reviewStatus: selectedReviewStatus.value,
    organizationId: selectedOrganizationId.value,
    tagId: selectedTagId.value,
    uploadedFrom: uploadedFrom.value,
    uploadedTo: uploadedTo.value,
    sortOption: sortOption.value,
    savedViewId: selectedSavedViewId.value,
    showAdvancedFilters: showAdvancedFilters.value,
    page: page.value,
    pageSize: pageSize.value
  };
}

function isArchiveDirectoryHistoryState(value: unknown): value is ArchiveDirectoryHistoryState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<ArchiveDirectoryHistoryState>;
  return ["all", "root", "folder", "unfiled", "trash"].includes(state.locationMode ?? "")
    && (typeof state.folderId === "string" || state.folderId === null)
    && typeof state.category === "string"
    && typeof state.search === "string"
    && typeof state.reviewStatus === "string"
    && typeof state.organizationId === "string"
    && typeof state.tagId === "string"
    && typeof state.uploadedFrom === "string"
    && typeof state.uploadedTo === "string"
    && typeof state.sortOption === "string"
    && typeof state.savedViewId === "string"
    && typeof state.showAdvancedFilters === "boolean"
    && typeof state.page === "number"
    && typeof state.pageSize === "number";
}

function archiveDirectoryStateKey(state: ArchiveDirectoryHistoryState): string {
  return JSON.stringify(state);
}

function archiveDirectoryStateFromRoute(): ArchiveDirectoryHistoryState {
  const storedValue = window.history.state?.[ARCHIVE_DIRECTORY_HISTORY_STATE];
  let storedState: unknown;
  try {
    storedState = typeof storedValue === "string" ? JSON.parse(storedValue) : storedValue;
  } catch {
    storedState = null;
  }
  const base = isArchiveDirectoryHistoryState(storedState) ? storedState : archiveDirectorySnapshot();
  const requestedFolderId = typeof route.query.archiveFolder === "string" ? route.query.archiveFolder : null;
  const requestedLocation = typeof route.query.archiveLocation === "string" ? route.query.archiveLocation : "";
  const locationMode: ArchiveLocationMode = requestedFolderId
    ? "folder"
    : ["root", "unfiled", "trash"].includes(requestedLocation)
      ? requestedLocation as ArchiveLocationMode
      : "all";
  const folderId = locationMode === "folder" && requestedFolderId && archiveFolderById.value.has(requestedFolderId)
    ? requestedFolderId
    : null;
  const normalizedLocationMode = locationMode === "folder" && !folderId ? "root" : locationMode;
  return {
    ...base,
    locationMode: normalizedLocationMode,
    folderId,
    category: typeof route.query.category === "string" ? route.query.category : "",
    sortOption: ARCHIVE_SORT_FIELDS.some((field) => base.sortOption === `${field}_asc` || base.sortOption === `${field}_desc`)
      ? base.sortOption
      : initialArchiveSort,
    page: Number.isInteger(base.page) && base.page > 0 ? base.page : 1,
    pageSize: [10, 25, 50, 100].includes(base.pageSize) ? base.pageSize : 25
  };
}

function archiveDirectoryQuery(state: ArchiveDirectoryHistoryState) {
  const query = { ...route.query };
  delete query.archiveLocation;
  delete query.archiveFolder;
  delete query.category;
  delete query.documentId;
  if (state.locationMode === "folder" && state.folderId) query.archiveFolder = state.folderId;
  else if (state.locationMode !== "all") query.archiveLocation = state.locationMode;
  if (state.category) query.category = state.category;
  return query;
}

let applyingArchiveDirectoryState = false;
let archiveDirectoryApplyVersion = 0;
function applyArchiveDirectoryState(state: ArchiveDirectoryHistoryState) {
  applyingArchiveDirectoryState = true;
  const applyVersion = ++archiveDirectoryApplyVersion;
  archiveLocationMode.value = state.locationMode;
  selectedArchiveFolderId.value = state.folderId;
  selectedCategory.value = state.category;
  documentSearch.value = state.search;
  selectedReviewStatus.value = state.reviewStatus;
  selectedOrganizationId.value = state.organizationId;
  selectedTagId.value = state.tagId;
  uploadedFrom.value = state.uploadedFrom;
  uploadedTo.value = state.uploadedTo;
  sortOption.value = state.sortOption;
  selectedSavedViewId.value = state.savedViewId;
  showAdvancedFilters.value = state.showAdvancedFilters;
  page.value = state.page;
  pageSize.value = state.pageSize;
  selectedDocumentIds.value = [];
  if (state.folderId) {
    let folder = archiveFolderById.value.get(state.folderId);
    const expanded = new Set(expandedArchiveFolderIds.value);
    while (folder) {
      expanded.add(folder.folderId);
      folder = folder.parentFolderId ? archiveFolderById.value.get(folder.parentFolderId) : undefined;
    }
    expandedArchiveFolderIds.value = [...expanded];
  }
  queueMicrotask(() => {
    if (archiveDirectoryApplyVersion === applyVersion) applyingArchiveDirectoryState = false;
  });
}

function rememberArchiveDirectoryState() {
  if (!archiveRouteReady.value || !template.value.personalArchive || applyingArchiveDirectoryState) return;
  window.history.replaceState({
    ...window.history.state,
    [ARCHIVE_DIRECTORY_HISTORY_STATE]: JSON.stringify(archiveDirectorySnapshot())
  }, "");
}

function navigateArchiveDirectory(state: ArchiveDirectoryHistoryState, replace = false) {
  applyArchiveDirectoryState(state);
  const location = {
    path: route.path,
    query: archiveDirectoryQuery(state),
    state: { [ARCHIVE_DIRECTORY_HISTORY_STATE]: JSON.stringify(state) }
  };
  void (replace ? router.replace(location) : router.push(location));
  void loadDocuments();
}

function syncArchiveDirectoryFromRoute() {
  if (!archiveRouteReady.value || !template.value.personalArchive) return;
  const nextState = archiveDirectoryStateFromRoute();
  if (archiveDirectoryStateKey(nextState) === archiveDirectoryStateKey(archiveDirectorySnapshot())) return;
  applyArchiveDirectoryState(nextState);
  void loadDocuments();
}

function archiveFolderTreeIds(folderId: string) {
  const folderIds = new Set([folderId]);
  const visit = (parentFolderId: string) => {
    for (const child of archiveFolderChildren.value.get(parentFolderId) ?? []) {
      if (folderIds.has(child.folderId)) continue;
      folderIds.add(child.folderId);
      visit(child.folderId);
    }
  };
  visit(folderId);
  return folderIds;
}

const archiveFolderDeleteImpact = computed(() => {
  const folder = archiveFolderPendingDeletion.value;
  if (!folder) return { folderCount: 0, subfolderCount: 0, fileCount: 0 };
  const folderIds = archiveFolderTreeIds(folder.folderId);
  return {
    folderCount: folderIds.size,
    subfolderCount: Math.max(0, folderIds.size - 1),
    fileCount: archiveFolders.value
      .filter((item) => folderIds.has(item.folderId))
      .reduce((total, item) => total + item.fileCount, 0)
  };
});
const archiveFolderMetadataImpact = computed(() => {
  const folder = archiveFolderMetadataTarget.value;
  if (!folder) return { folderCount: 0, fileCount: 0 };
  const folderIds = archiveFolderMetadataIncludeSubfolders.value
    ? archiveFolderTreeIds(folder.folderId)
    : new Set([folder.folderId]);
  return {
    folderCount: folderIds.size,
    fileCount: archiveFolders.value
      .filter((item) => folderIds.has(item.folderId))
      .reduce((total, item) => total + item.fileCount, 0)
  };
});
const archiveFolderMetadataHasChanges = computed(() =>
  archiveFolderMetadataApplyCategory.value ||
  archiveFolderMetadataApplyReviewStatus.value ||
  archiveFolderMetadataApplyNotes.value ||
  archiveFolderMetadataApplyReviewNotes.value ||
  archiveFolderMetadataApplyTags.value
);
const archiveBreadcrumbs = computed(() => {
  if (archiveLocationMode.value === "all") return [{ id: "all", label: "All files" }];
  if (archiveLocationMode.value === "unfiled") return [{ id: "unfiled", label: "Unfiled" }];
  if (archiveLocationMode.value === "trash") return [{ id: "trash", label: "Archive trash" }];
  const path: Array<{ id: string; label: string }> = [{ id: "root", label: "My archive" }];
  if (archiveLocationMode.value !== "folder" || !currentArchiveFolder.value) return path;
  const folders: ArchiveFolder[] = [];
  const visited = new Set<string>();
  let folder: ArchiveFolder | undefined | null = currentArchiveFolder.value;
  while (folder && !visited.has(folder.folderId)) {
    visited.add(folder.folderId);
    folders.unshift(folder);
    folder = folder.parentFolderId ? archiveFolderById.value.get(folder.parentFolderId) : null;
  }
  return [...path, ...folders.map((item) => ({ id: item.folderId, label: item.name }))];
});
const currentArchiveLocationLabel = computed(() => archiveBreadcrumbs.value.at(-1)?.label ?? "Archive");
const archiveFolderSelectOptions = computed(() => {
  const pathFor = (folder: ArchiveFolder) => {
    const parts = [folder.name];
    const visited = new Set([folder.folderId]);
    let parentId = folder.parentFolderId ?? null;
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = archiveFolderById.value.get(parentId);
      if (!parent) break;
      parts.unshift(parent.name);
      parentId = parent.parentFolderId ?? null;
    }
    return parts.join(" / ");
  };
  return archiveFolders.value
    .map((folder) => ({ folderId: folder.folderId, label: pathFor(folder) }))
    .sort((a, b) => a.label.localeCompare(b.label));
});
const archiveFolderParentOptions = computed(() => {
  if (!editingArchiveFolder.value) return archiveFolderSelectOptions.value;
  const excluded = new Set<string>([editingArchiveFolder.value.folderId]);
  const visit = (folderId: string) => {
    for (const child of archiveFolderChildren.value.get(folderId) ?? []) {
      if (excluded.has(child.folderId)) continue;
      excluded.add(child.folderId);
      visit(child.folderId);
    }
  };
  visit(editingArchiveFolder.value.folderId);
  return archiveFolderSelectOptions.value.filter((folder) => !excluded.has(folder.folderId));
});
const archiveUploadFolderCount = computed(() => {
  const paths = new Set(archiveUploadFolderPaths.value);
  for (const item of archiveUploadFiles.value) {
    const parts = item.relativePath.split("/");
    parts.pop();
    for (let index = 1; index <= parts.length; index += 1) paths.add(parts.slice(0, index).join("/"));
  }
  return paths.size;
});
const archiveUploadVisibleFiles = computed(() => archiveUploadFiles.value.slice(0, 100));

function currentDocumentFilters(): DocumentFilters {
  return {
    caseId: globalDocumentsMode.value ? undefined : selectedCaseId.value,
    partyOrganizationId: selectedOrganizationId.value || undefined,
    category: selectedCategory.value as DocumentCategory | "",
    folderId:
      template.value.personalArchive && archiveLocationMode.value === "folder"
        ? selectedArchiveFolderId.value ?? undefined
        : undefined,
    unfiled:
      template.value.personalArchive && ["root", "unfiled"].includes(archiveLocationMode.value)
        ? true
        : undefined,
    trashed: template.value.personalArchive && archiveLocationMode.value === "trash" ? true : undefined,
    reviewStatus: selectedReviewStatus.value as DocumentReviewStatus | "",
    tagId: selectedTagId.value || undefined,
    uploadedFrom: uploadedFrom.value || undefined,
    uploadedTo: uploadedTo.value || undefined,
    q: documentSearch.value,
    sort: sortParts.value.sort,
    direction: sortParts.value.direction
  };
}

async function loadDocuments() {
  documentsLoading.value = true;
  documentsError.value = "";
  if (!cases.value.length && !template.value.personalArchive) {
    documents.value = [];
    readiness.value = null;
    documentsLoading.value = false;
    return;
  }
  try {
    const documentFilters = currentDocumentFilters();
    const documentPagePromise = client.documentsPage(documentFilters, { page: page.value, pageSize: pageSize.value });
    if (globalDocumentsMode.value) {
      const documentPage = await documentPagePromise;
      documents.value = documentPage.items;
      totalDocuments.value = documentPage.total;
      totalPages.value = documentPage.totalPages;
      page.value = documentPage.page;
      readiness.value = null;
    } else {
      const [documentPage, readinessData] = await Promise.all([
        documentPagePromise,
        client.caseReadiness(selectedCaseId.value)
      ]);
      documents.value = documentPage.items;
      totalDocuments.value = documentPage.total;
      totalPages.value = documentPage.totalPages;
      page.value = documentPage.page;
      readiness.value = readinessData;
    }
    selectedDocumentIds.value = selectedDocumentIds.value.filter((id) => documents.value.some((document) => document.documentId === id));
    if (selectedDocument.value) {
      const selectedDocumentId = selectedDocument.value.documentId;
      const nextDocument = documents.value.find((document) => document.documentId === selectedDocumentId);
      const routeDocumentId = documentIdFromRoute();
      if (nextDocument) selectedDocument.value = nextDocument;
      if (!nextDocument && routeDocumentId !== selectedDocumentId) {
        selectedDocument.value = null;
        showDocumentDetail.value = false;
      }
      if (selectedDocument.value && showDocumentDetail.value) void loadDocumentVersions(selectedDocument.value.documentId);
    }
  } catch (error) {
    documentsError.value = error instanceof Error ? error.message : "Unable to load documents";
    documents.value = [];
    readiness.value = null;
  } finally {
    documentsLoading.value = false;
  }
}

async function loadArchiveManager() {
  if (!template.value.personalArchive) return;
  const [folderRows, categoryRows, trashPage, unfiledPage, trashedFolderRows] = await Promise.all([
    client.archiveFolders(),
    client.archiveCategories(),
    client.documentsPage({ trashed: true }, { page: 1, pageSize: 10 }),
    client.documentsPage({ unfiled: true }, { page: 1, pageSize: 10 }),
    client.archiveFolders(true)
  ]);
  archiveFolders.value = folderRows;
  archiveCategories.value = categoryRows;
  trashedArchiveFolders.value = trashedFolderRows;
  archiveTrashCount.value = trashPage.total + trashedFolderRows.filter((folder) => folder.deletionRootFolderId === folder.folderId).length;
  archiveUnfiledCount.value = unfiledPage.total;
  archiveCategoryDrafts.value = Object.fromEntries(categoryRows.map((category) => [category.categoryId, category.name]));
  const rootFolderIds = folderRows.filter((folder) => !folder.parentFolderId).map((folder) => folder.folderId);
  expandedArchiveFolderIds.value = [...new Set([...expandedArchiveFolderIds.value, ...rootFolderIds])];
  if (selectedArchiveFolderId.value && !folderRows.some((folder) => folder.folderId === selectedArchiveFolderId.value)) {
    archiveLocationMode.value = "root";
    selectedArchiveFolderId.value = null;
  }
}

async function reloadArchiveWorkspace() {
  await Promise.all([loadArchiveManager(), loadDocuments()]);
}

function selectArchiveLocation(mode: Exclude<ArchiveLocationMode, "folder">, preserveCategory = false, replace = false) {
  navigateArchiveDirectory({
    ...archiveDirectorySnapshot(),
    locationMode: mode,
    folderId: null,
    category: preserveCategory ? selectedCategory.value : "",
    page: 1
  }, replace);
}

function selectArchiveFolder(folderId: string) {
  if (!archiveFolderById.value.has(folderId)) return;
  navigateArchiveDirectory({
    ...archiveDirectorySnapshot(),
    locationMode: "folder",
    folderId,
    category: "",
    page: 1
  });
}

function selectArchiveCategory(category: string) {
  navigateArchiveDirectory({
    ...archiveDirectorySnapshot(),
    locationMode: "all",
    folderId: null,
    category,
    page: 1
  });
}

function openArchiveBreadcrumb(id: string) {
  if (id === "all") return selectArchiveLocation("all");
  if (id === "root") return selectArchiveLocation("root");
  if (id === "unfiled") return selectArchiveLocation("unfiled");
  if (id === "trash") return selectArchiveLocation("trash");
  selectArchiveFolder(id);
}

function toggleArchiveFolderExpanded(folderId: string) {
  expandedArchiveFolderIds.value = expandedArchiveFolderIds.value.includes(folderId)
    ? expandedArchiveFolderIds.value.filter((id) => id !== folderId)
    : [...expandedArchiveFolderIds.value, folderId];
}

function openNewArchiveFolder(parentFolderId: string | null = archiveLocationMode.value === "folder" ? selectedArchiveFolderId.value : null) {
  editingArchiveFolder.value = null;
  archiveFolderName.value = "";
  archiveFolderParentId.value = parentFolderId;
  archiveFolderError.value = "";
  showFolderEditor.value = true;
}

function openRenameArchiveFolder(folder: ArchiveFolder) {
  editingArchiveFolder.value = folder;
  archiveFolderName.value = folder.name;
  archiveFolderParentId.value = folder.parentFolderId ?? null;
  archiveFolderError.value = "";
  showFolderEditor.value = true;
}

async function saveArchiveFolder() {
  const name = archiveFolderName.value.trim();
  if (!name || savingArchiveFolder.value) return;
  savingArchiveFolder.value = true;
  archiveFolderError.value = "";
  try {
    const folder = editingArchiveFolder.value
      ? await client.updateArchiveFolder(editingArchiveFolder.value.folderId, {
          name,
          parentFolderId: archiveFolderParentId.value
        })
      : await client.createArchiveFolder({ name, parentFolderId: archiveFolderParentId.value });
    showFolderEditor.value = false;
    expandedArchiveFolderIds.value = [...new Set([
      ...expandedArchiveFolderIds.value,
      ...(folder.parentFolderId ? [folder.parentFolderId] : [])
    ])];
    toasts.success(editingArchiveFolder.value ? "Folder updated" : "Folder created", folder.name);
    await loadArchiveManager();
  } catch (error) {
    archiveFolderError.value = error instanceof Error ? error.message : "Unable to save folder";
  } finally {
    savingArchiveFolder.value = false;
  }
}

function openDeleteArchiveFolder(folder: ArchiveFolder) {
  archiveFolderPendingDeletion.value = folder;
  archiveFolderDeleteError.value = "";
}

function closeDeleteArchiveFolder() {
  if (deletingArchiveFolder.value) return;
  archiveFolderPendingDeletion.value = null;
  archiveFolderDeleteError.value = "";
}

async function confirmDeleteArchiveFolder() {
  const folder = archiveFolderPendingDeletion.value;
  if (!folder || deletingArchiveFolder.value || !auth.canDeleteDocuments) return;
  const deletedFolderIds = archiveFolderTreeIds(folder.folderId);
  deletingArchiveFolder.value = true;
  archiveFolderDeleteError.value = "";
  try {
    const result = await client.deleteArchiveFolder(folder.folderId);
    const folderSummary = `${result.deletedFolders} ${result.deletedFolders === 1 ? "folder" : "folders"} moved to trash`;
    const fileSummary = result.trashedDocuments
      ? `${result.trashedDocuments} ${result.trashedDocuments === 1 ? "file" : "files"} moved to Archive trash`
      : "No files were in this folder tree";
    toasts.success("Folder moved to trash", `${folderSummary}. ${fileSummary}.`);
    if (selectedArchiveFolderId.value && deletedFolderIds.has(selectedArchiveFolderId.value)) selectArchiveLocation("root", false, true);
    expandedArchiveFolderIds.value = expandedArchiveFolderIds.value.filter((id) => !deletedFolderIds.has(id));
    archiveFolderPendingDeletion.value = null;
    await reloadArchiveWorkspace();
  } catch (error) {
    archiveFolderDeleteError.value = error instanceof Error ? error.message : "Unable to delete this folder tree.";
  } finally {
    deletingArchiveFolder.value = false;
  }
}

function openRestoreArchiveFolder(folder: ArchiveFolder) {
  archiveFolderPendingRestore.value = folder;
  archiveRestoreName.value = folder.name;
  archiveRestoreParent.value = "__original__";
  archiveRestoreError.value = "";
}

async function restoreArchiveFolderTree() {
  const folder = archiveFolderPendingRestore.value;
  if (!folder || restoringArchiveFolder.value || !auth.canEditDocuments) return;
  restoringArchiveFolder.value = true;
  archiveRestoreError.value = "";
  try {
    await client.restoreArchiveFolder(folder.folderId, {
      name: archiveRestoreName.value.trim(),
      ...(archiveRestoreParent.value === "__original__" ? {} : { parentFolderId: archiveRestoreParent.value || null })
    });
    archiveFolderPendingRestore.value = null;
    await reloadArchiveWorkspace();
    toasts.success("Folder restored", "Its folders and files are back in the selected location.");
  } catch (error) {
    archiveRestoreError.value = error instanceof Error ? error.message : "Unable to restore folder.";
  } finally {
    restoringArchiveFolder.value = false;
  }
}

function openArchiveFolderMetadataEditor(folder: ArchiveFolder) {
  archiveFolderMetadataTarget.value = folder;
  archiveFolderMetadataIncludeSubfolders.value = true;
  archiveFolderMetadataApplyCategory.value = false;
  archiveFolderMetadataCategory.value = availableDocumentCategories.value[0] ?? "Other";
  archiveFolderMetadataApplyReviewStatus.value = false;
  archiveFolderMetadataReviewStatus.value = "needs-review";
  archiveFolderMetadataApplyNotes.value = false;
  archiveFolderMetadataNotes.value = "";
  archiveFolderMetadataApplyReviewNotes.value = false;
  archiveFolderMetadataReviewNotes.value = "";
  archiveFolderMetadataApplyTags.value = false;
  archiveFolderMetadataTagIds.value = [];
  archiveFolderMetadataError.value = "";
}

function closeArchiveFolderMetadataEditor() {
  if (archiveFolderMetadataSaving.value) return;
  archiveFolderMetadataTarget.value = null;
  archiveFolderMetadataError.value = "";
}

function toggleArchiveFolderMetadataTag(tagId: string, checked: boolean) {
  archiveFolderMetadataTagIds.value = checked
    ? [...new Set([...archiveFolderMetadataTagIds.value, tagId])]
    : archiveFolderMetadataTagIds.value.filter((id) => id !== tagId);
}

async function saveArchiveFolderMetadata() {
  const folder = archiveFolderMetadataTarget.value;
  if (!folder || archiveFolderMetadataSaving.value || !archiveFolderMetadataHasChanges.value) return;
  archiveFolderMetadataSaving.value = true;
  archiveFolderMetadataError.value = "";
  try {
    const result = await client.updateArchiveFolderDocumentsMetadata(folder.folderId, {
      includeSubfolders: archiveFolderMetadataIncludeSubfolders.value,
      category: archiveFolderMetadataApplyCategory.value ? archiveFolderMetadataCategory.value : undefined,
      reviewStatus: archiveFolderMetadataApplyReviewStatus.value ? archiveFolderMetadataReviewStatus.value : undefined,
      notes: archiveFolderMetadataApplyNotes.value ? archiveFolderMetadataNotes.value : undefined,
      reviewNotes: archiveFolderMetadataApplyReviewNotes.value ? archiveFolderMetadataReviewNotes.value : undefined,
      tagIds: archiveFolderMetadataApplyTags.value ? archiveFolderMetadataTagIds.value : undefined
    });
    toasts.success(
      "Folder metadata updated",
      `${result.updated} of ${result.matched} ${result.matched === 1 ? "file" : "files"} updated across ${result.folderCount} ${result.folderCount === 1 ? "folder" : "folders"}.`
    );
    archiveFolderMetadataTarget.value = null;
    await reloadArchiveWorkspace();
  } catch (error) {
    archiveFolderMetadataError.value = error instanceof Error ? error.message : "Unable to update folder metadata.";
  } finally {
    archiveFolderMetadataSaving.value = false;
  }
}

async function moveDocumentsToFolder(documentIds: string[], folderId: string | null) {
  if (!documentIds.length) return;
  try {
    const result = await client.bulkDocuments({ action: "move-folder", documentIds, folderId });
    const destination = folderId ? archiveFolderById.value.get(folderId)?.name ?? "folder" : "Unfiled";
    toasts.success("Files moved", `${result.succeeded} of ${result.requested} moved to ${destination}.`);
    selectedDocumentIds.value = [];
    await reloadArchiveWorkspace();
  } catch (error) {
    toasts.error("Unable to move files", error instanceof Error ? error.message : "Please try again.");
  }
}

function onArchiveDocumentDragStart(event: DragEvent, document: DocumentRecord) {
  if (archiveLocationMode.value === "trash" || !event.dataTransfer) return;
  const ids = selectedDocumentIds.value.includes(document.documentId)
    ? selectedDocumentIds.value
    : [document.documentId];
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-personal-archive-documents", JSON.stringify(ids));
  event.dataTransfer.setData("text/plain", document.originalFileName);
}

function onArchiveFolderDragOver(event: DragEvent, target: string | null) {
  const hasFiles = Array.from(event.dataTransfer?.types ?? []).includes("Files");
  const hasArchiveDocuments = Array.from(event.dataTransfer?.types ?? []).includes("application/x-personal-archive-documents");
  if (!hasFiles && !hasArchiveDocuments) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = hasFiles ? "copy" : "move";
  archiveFolderDropTargetId.value = target ?? "root";
}

function clearArchiveFolderDropTarget() {
  archiveFolderDropTargetId.value = null;
}

async function onArchiveFolderDrop(event: DragEvent, targetFolderId: string | null) {
  event.preventDefault();
  archiveFolderDropTargetId.value = null;
  if (event.dataTransfer && archiveDragContainsFiles(event)) {
    openArchiveUpload(targetFolderId);
    await addArchiveUploadFromDataTransfer(event.dataTransfer);
    return;
  }
  const rawIds = event.dataTransfer?.getData("application/x-personal-archive-documents") ?? "";
  if (!rawIds) return;
  try {
    const ids = JSON.parse(rawIds) as string[];
    await moveDocumentsToFolder(ids.filter((id) => typeof id === "string"), targetFolderId);
  } catch {
    toasts.error("Unable to move files", "The dragged file selection could not be read.");
  }
}

function currentArchiveDropFolderId(): string | null | undefined {
  if (archiveLocationMode.value === "folder") return selectedArchiveFolderId.value ?? undefined;
  if (["root", "unfiled"].includes(archiveLocationMode.value)) return null;
  return undefined;
}

function onArchiveCurrentViewDragOver(event: DragEvent) {
  const folderId = currentArchiveDropFolderId();
  if (folderId === undefined) return;
  onArchiveFolderDragOver(event, folderId);
}

function onArchiveCurrentViewDrop(event: DragEvent) {
  const folderId = currentArchiveDropFolderId();
  if (folderId === undefined) return;
  void onArchiveFolderDrop(event, folderId);
}

async function createArchiveCategory() {
  const name = newArchiveCategoryName.value.trim();
  if (!name) return;
  archiveCategoryError.value = "";
  savingArchiveCategoryId.value = "new";
  try {
    const category = await client.createArchiveCategory({ name });
    newArchiveCategoryName.value = "";
    toasts.success("Category created", category.name);
    await loadArchiveManager();
  } catch (error) {
    archiveCategoryError.value = error instanceof Error ? error.message : "Unable to create category";
  } finally {
    savingArchiveCategoryId.value = null;
  }
}

async function saveArchiveCategory(category: ArchiveCategory) {
  const name = archiveCategoryDrafts.value[category.categoryId]?.trim();
  if (!name || name === category.name) return;
  archiveCategoryError.value = "";
  savingArchiveCategoryId.value = category.categoryId;
  try {
    const updated = await client.updateArchiveCategory(category.categoryId, { name });
    if (selectedCategory.value === category.name) selectedCategory.value = updated.name;
    toasts.success("Category renamed", `${category.name} is now ${updated.name}.`);
    await reloadArchiveWorkspace();
  } catch (error) {
    archiveCategoryError.value = error instanceof Error ? error.message : "Unable to rename category";
  } finally {
    savingArchiveCategoryId.value = null;
  }
}

async function moveArchiveCategory(category: ArchiveCategory, direction: -1 | 1) {
  const index = archiveCategories.value.findIndex((item) => item.categoryId === category.categoryId);
  const other = archiveCategories.value[index + direction];
  if (index < 0 || !other) return;
  savingArchiveCategoryId.value = category.categoryId;
  try {
    await Promise.all([
      client.updateArchiveCategory(category.categoryId, { sortOrder: other.sortOrder }),
      client.updateArchiveCategory(other.categoryId, { sortOrder: category.sortOrder })
    ]);
    await loadArchiveManager();
  } catch (error) {
    archiveCategoryError.value = error instanceof Error ? error.message : "Unable to reorder categories";
  } finally {
    savingArchiveCategoryId.value = null;
  }
}

function requestDeleteArchiveCategory(category: ArchiveCategory) {
  deletingArchiveCategory.value = category;
  replacementArchiveCategoryId.value =
    archiveCategories.value.find((item) => item.name === "Other" && item.categoryId !== category.categoryId)?.categoryId ?? "";
  archiveCategoryError.value = "";
}

async function confirmDeleteArchiveCategory() {
  const category = deletingArchiveCategory.value;
  if (!category) return;
  if (category.fileCount > 0 && !replacementArchiveCategoryId.value) {
    archiveCategoryError.value = "Choose where the existing files should move.";
    return;
  }
  savingArchiveCategoryId.value = category.categoryId;
  try {
    await client.deleteArchiveCategory(category.categoryId, replacementArchiveCategoryId.value || null);
    if (selectedCategory.value === category.name) selectedCategory.value = "";
    deletingArchiveCategory.value = null;
    toasts.success("Category deleted", category.name);
    await reloadArchiveWorkspace();
  } catch (error) {
    archiveCategoryError.value = error instanceof Error ? error.message : "Unable to delete category";
  } finally {
    savingArchiveCategoryId.value = null;
  }
}

function openArchiveUpload(folderId: string | null = archiveLocationMode.value === "folder" ? selectedArchiveFolderId.value : null) {
  archiveUploadFiles.value = [];
  archiveUploadFolderPaths.value = [];
  archiveUploadDragging.value = false;
  archiveUploadScanning.value = false;
  archiveUploadProgress.value = 0;
  const categoryNames = availableDocumentCategories.value;
  archiveUploadCategory.value = (
    categoryNames.includes(selectedCategory.value as DocumentCategory)
      ? selectedCategory.value
      : categoryNames.find((category) => category === "Other") ?? categoryNames[0] ?? "Other"
  ) as DocumentCategory;
  archiveUploadNotes.value = "";
  archiveUploadTagIds.value = [];
  archiveUploadFolderId.value = folderId;
  archiveUploadError.value = "";
  showArchiveUpload.value = true;
}

function selectArchiveUploadFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  addArchiveUploadSelection(selectionFromFiles(Array.from(input.files ?? [])));
  input.value = "";
}

function selectArchiveUploadDirectory(event: Event) {
  const input = event.target as HTMLInputElement;
  addArchiveUploadSelection(selectionFromFiles(Array.from(input.files ?? [])));
  input.value = "";
}

function normalizedArchiveRelativePath(path: string, fallback = ""): string {
  const parts = path
    .replaceAll("\\", "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..");
  return parts.join("/") || fallback;
}

function selectionFromFiles(files: File[]): ArchiveUploadSelection {
  const folderPaths = new Set<string>();
  const selections = files.map((file) => {
    const relativePath = normalizedArchiveRelativePath(file.webkitRelativePath, file.name);
    const pathParts = relativePath.split("/");
    pathParts.pop();
    for (let index = 1; index <= pathParts.length; index += 1) {
      folderPaths.add(pathParts.slice(0, index).join("/"));
    }
    return { file, relativePath };
  });
  return { files: selections, folderPaths: [...folderPaths] };
}

function archiveFileIdentity(item: ArchiveUploadFile): string {
  return [item.relativePath, item.file.size, item.file.lastModified, item.file.type].join("::");
}

function addArchiveUploadSelection(selection: ArchiveUploadSelection) {
  const existing = new Set(archiveUploadFiles.value.map(archiveFileIdentity));
  const uniqueFiles = selection.files.filter((item) => {
    const identity = archiveFileIdentity(item);
    if (existing.has(identity)) return false;
    existing.add(identity);
    return true;
  });
  archiveUploadFiles.value = [...archiveUploadFiles.value, ...uniqueFiles];
  archiveUploadFolderPaths.value = [...new Set([...archiveUploadFolderPaths.value, ...selection.folderPaths])]
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  archiveUploadError.value = "";
}

function readLegacyFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readLegacyDirectory(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: FileSystemEntry[] = [];
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(entries);
          return;
        }
        entries.push(...batch);
        readBatch();
      }, reject);
    };
    readBatch();
  });
}

async function collectLegacyArchiveEntry(
  entry: FileSystemEntry,
  parentPath: string,
  selection: ArchiveUploadSelection
) {
  const relativePath = normalizedArchiveRelativePath([parentPath, entry.name].filter(Boolean).join("/"), entry.name);
  if (entry.isFile) {
    const file = await readLegacyFile(entry as FileSystemFileEntry);
    selection.files.push({ file, relativePath });
    return;
  }
  if (!entry.isDirectory) return;
  selection.folderPaths.push(relativePath);
  const children = await readLegacyDirectory((entry as FileSystemDirectoryEntry).createReader());
  for (const child of children) await collectLegacyArchiveEntry(child, relativePath, selection);
}

async function archiveSelectionFromDataTransfer(dataTransfer: DataTransfer): Promise<ArchiveUploadSelection> {
  const roots = Array.from(dataTransfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.webkitGetAsEntry?.() ?? null)
    .filter((entry): entry is FileSystemEntry => Boolean(entry));

  if (!roots.length) return selectionFromFiles(Array.from(dataTransfer.files));
  const selection: ArchiveUploadSelection = { files: [], folderPaths: [] };
  for (const root of roots) await collectLegacyArchiveEntry(root, "", selection);
  selection.folderPaths = [...new Set(selection.folderPaths)];
  selection.files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return selection;
}

async function addArchiveUploadFromDataTransfer(dataTransfer: DataTransfer) {
  archiveUploadScanning.value = true;
  archiveUploadError.value = "";
  try {
    const selection = await archiveSelectionFromDataTransfer(dataTransfer);
    if (!selection.files.length && !selection.folderPaths.length) {
      throw new Error("This browser could not read the dropped folder. Try Choose folder instead.");
    }
    addArchiveUploadSelection(selection);
  } catch (error) {
    archiveUploadError.value = error instanceof Error ? error.message : "Unable to read the dropped files or folder.";
  } finally {
    archiveUploadScanning.value = false;
  }
}

function removeArchiveUploadFile(index: number) {
  archiveUploadFiles.value = archiveUploadFiles.value.filter((_, fileIndex) => fileIndex !== index);
}

function clearArchiveUploadFiles() {
  archiveUploadFiles.value = [];
  archiveUploadFolderPaths.value = [];
  if (archiveUploadInput.value) archiveUploadInput.value.value = "";
  if (archiveUploadDirectoryInput.value) archiveUploadDirectoryInput.value.value = "";
}

function archiveDragContainsFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function onArchiveUploadDragEnter(event: DragEvent) {
  if (uploadingArchiveDocuments.value || !archiveDragContainsFiles(event)) return;
  archiveUploadDragging.value = true;
}

function onArchiveUploadDragOver(event: DragEvent) {
  if (uploadingArchiveDocuments.value || !archiveDragContainsFiles(event)) return;
  archiveUploadDragging.value = true;
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

function onArchiveUploadDragLeave(event: DragEvent) {
  const dropZone = event.currentTarget as HTMLElement | null;
  const nextTarget = event.relatedTarget as Node | null;
  if (dropZone && nextTarget && dropZone.contains(nextTarget)) return;
  archiveUploadDragging.value = false;
}

async function onArchiveUploadDrop(event: DragEvent) {
  archiveUploadDragging.value = false;
  if (uploadingArchiveDocuments.value || !event.dataTransfer) return;
  await addArchiveUploadFromDataTransfer(event.dataTransfer);
}

function toggleArchiveUploadTag(tagId: string, checked: boolean) {
  archiveUploadTagIds.value = checked
    ? [...new Set([...archiveUploadTagIds.value, tagId])]
    : archiveUploadTagIds.value.filter((id) => id !== tagId);
}

async function uploadArchiveDocuments() {
  if ((!archiveUploadFiles.value.length && !archiveUploadFolderPaths.value.length) || uploadingArchiveDocuments.value) return;
  uploadingArchiveDocuments.value = true;
  archiveUploadError.value = "";
  let uploaded = 0;
  const uploadedIdentities = new Set<string>();
  try {
    archiveUploadProgress.value = -1;
    const folderByPath = new Map<string, string>();
    const existingByParentAndName = new Map(
      archiveFolders.value.map((folder) => [
        `${folder.parentFolderId ?? "root"}::${folder.name.trim().toLocaleLowerCase()}`,
        folder.folderId
      ])
    );
    const folderPaths = new Set(archiveUploadFolderPaths.value);
    for (const item of archiveUploadFiles.value) {
      const pathParts = item.relativePath.split("/");
      pathParts.pop();
      for (let index = 1; index <= pathParts.length; index += 1) folderPaths.add(pathParts.slice(0, index).join("/"));
    }
    const orderedFolderPaths = [...folderPaths]
      .filter(Boolean)
      .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
    for (const folderPath of orderedFolderPaths) {
      const segments = folderPath.split("/");
      const folderName = segments.at(-1) ?? "";
      if (folderName.length > 120) throw new Error(`Folder name is longer than 120 characters: ${folderName}`);
      const parentPath = segments.slice(0, -1).join("/");
      const parentFolderId = parentPath ? folderByPath.get(parentPath) ?? null : archiveUploadFolderId.value;
      const key = `${parentFolderId ?? "root"}::${folderName.trim().toLocaleLowerCase()}`;
      let folderId = existingByParentAndName.get(key);
      if (!folderId) {
        const folder = await client.createArchiveFolder({ name: folderName, parentFolderId });
        folderId = folder.folderId;
        existingByParentAndName.set(key, folderId);
      }
      folderByPath.set(folderPath, folderId);
    }

    archiveUploadProgress.value = 0;
    for (const item of archiveUploadFiles.value) {
      const pathParts = item.relativePath.split("/");
      pathParts.pop();
      const relativeFolderPath = pathParts.join("/");
      const destinationFolderId = relativeFolderPath
        ? folderByPath.get(relativeFolderPath) ?? archiveUploadFolderId.value
        : archiveUploadFolderId.value;
      const form = new FormData();
      form.append("file", item.file);
      form.append("category", archiveUploadCategory.value);
      if (destinationFolderId) form.append("folderId", destinationFolderId);
      form.append("notes", archiveUploadNotes.value);
      archiveUploadTagIds.value.forEach((tagId) => form.append("tagIds", tagId));
      await client.uploadArchiveDocument(form);
      uploaded += 1;
      archiveUploadProgress.value = uploaded;
      uploadedIdentities.add(archiveFileIdentity(item));
    }
    showArchiveUpload.value = false;
    const folderSummary = orderedFolderPaths.length
      ? ` Folder structure preserved across ${orderedFolderPaths.length} ${orderedFolderPaths.length === 1 ? "folder" : "folders"}.`
      : "";
    toasts.success(uploaded ? "Files added" : "Folders created", uploaded
      ? `${uploaded} ${uploaded === 1 ? "file is" : "files are"} now in your archive.${folderSummary}`
      : `${orderedFolderPaths.length} empty ${orderedFolderPaths.length === 1 ? "folder was" : "folders were"} created.`);
    page.value = 1;
    await reloadArchiveWorkspace();
  } catch (error) {
    archiveUploadFiles.value = archiveUploadFiles.value.filter((item) => !uploadedIdentities.has(archiveFileIdentity(item)));
    const message = error instanceof Error ? error.message : "Unable to upload files";
    archiveUploadError.value = uploaded
      ? `${uploaded} ${uploaded === 1 ? "file was" : "files were"} imported. Retry to continue with the remaining ${archiveUploadFiles.value.length}. ${message}`
      : message;
    toasts.error("Upload failed", archiveUploadError.value);
  } finally {
    uploadingArchiveDocuments.value = false;
  }
}

function canReadDocument(document: DocumentRecord) {
  const extension = document.originalFileName.toLowerCase().split(".").pop() ?? "";
  return document.mimeType === "application/pdf" || ["epub", "md", "markdown", "txt", "text", "html", "htm"].includes(extension);
}

function currentArchiveAudioFilters(): DocumentFilters {
  const locationFilters: DocumentFilters = {
    sort: sortParts.value.sort,
    direction: sortParts.value.direction
  };
  if (archiveLocationMode.value === "folder") locationFilters.folderId = selectedArchiveFolderId.value ?? undefined;
  if (archiveLocationMode.value === "root" || archiveLocationMode.value === "unfiled") locationFilters.unfiled = true;
  return locationFilters;
}

async function loadAllDocumentsForFilters(filters: DocumentFilters) {
  const firstPage = await client.documentsPage(filters, { page: 1, pageSize: 100 });
  const rows = [...firstPage.items];
  for (let nextPage = 2; nextPage <= firstPage.totalPages; nextPage += 1) {
    const result = await client.documentsPage(filters, { page: nextPage, pageSize: 100 });
    rows.push(...result.items);
  }
  return rows;
}

function startArchiveAudioPlayback(document: DocumentRecord) {
  if (!template.value.personalArchive || !isAudioPreviewFile(document.mimeType, document.originalFileName)) return;
  const contextLabel = archiveBreadcrumbs.value.map((entry) => entry.label).join(" / ") || "Archive";

  // Start immediately while the click still carries mobile browser playback permission.
  archiveAudio.setQueue([document], document.documentId, contextLabel, true);
  if (showDocumentDetail.value && selectedDocument.value?.documentId === document.documentId) closeDocumentDetail();

  const expectedDocumentId = document.documentId;
  const filters = currentArchiveAudioFilters();
  void loadAllDocumentsForFilters(filters)
    .then((rows) => {
      const tracks = rows.filter((item) => isAudioPreviewFile(item.mimeType, item.originalFileName));
      archiveAudio.replaceQueuePreservingCurrent(
        tracks.some((item) => item.documentId === expectedDocumentId) ? tracks : [document, ...tracks],
        expectedDocumentId,
        contextLabel
      );
    })
    .catch(() => {
      // The selected file is already playing; a queue-loading failure should not interrupt it.
    });
}

function changeSelectedService() {
  selectedCategory.value = "";
  page.value = 1;
  void loadDocuments();
}

function selectCategory(category: string) {
  selectedCategory.value = category;
  page.value = 1;
  void loadDocuments();
}

function resetDocumentFilters() {
  selectedCaseId.value = ALL_SERVICES;
  selectedCategory.value = "";
  documentSearch.value = "";
  selectedReviewStatus.value = "";
  selectedOrganizationId.value = "";
  selectedTagId.value = "";
  uploadedFrom.value = "";
  uploadedTo.value = "";
  sortOption.value = "uploaded_desc";
  selectedSavedViewId.value = "";
  page.value = 1;
  void loadDocuments();
}

function clearFilter(key: string) {
  if (key === "caseId") selectedCaseId.value = ALL_SERVICES;
  if (key === "category") selectedCategory.value = "";
  if (key === "reviewStatus") selectedReviewStatus.value = "";
  if (key === "organization") selectedOrganizationId.value = "";
  if (key === "tag") selectedTagId.value = "";
  if (key === "uploadedFrom") uploadedFrom.value = "";
  if (key === "uploadedTo") uploadedTo.value = "";
  page.value = 1;
  void loadDocuments();
}

function openDocumentDetail(document: DocumentRecord) {
  selectedDocument.value = document;
  documentFormError.value = "";
  documentVersionError.value = "";
  showDocumentDetail.value = true;
  void loadDocumentVersions(document.documentId);
  void loadArchiveImageSequence(document);
  if (documentIdFromRoute() !== document.documentId) {
    void router.push({
      path: route.path,
      query: { ...route.query, documentId: document.documentId },
      state: {
        [ARCHIVE_DOCUMENT_PREVIEW_STATE]: document.documentId,
        [ARCHIVE_DIRECTORY_HISTORY_STATE]: JSON.stringify(archiveDirectorySnapshot())
      }
    });
  }
}

async function loadArchiveImageSequence(document: DocumentRecord) {
  const requestId = ++archiveImageSequenceRequestId;
  if (!template.value.personalArchive || !isImagePreviewFile(document.mimeType, document.originalFileName)) {
    archiveImageSequence.value = [];
    archiveImageSequenceLoading.value = false;
    return;
  }

  archiveImageSequence.value = [document];
  archiveImageSequenceLoading.value = true;
  try {
    const filters = currentDocumentFilters();
    const firstPage = await client.documentsPage(filters, { page: 1, pageSize: 100 });
    const rows = [...firstPage.items];
    for (let nextPage = 2; nextPage <= firstPage.totalPages; nextPage += 1) {
      const result = await client.documentsPage(filters, { page: nextPage, pageSize: 100 });
      if (requestId !== archiveImageSequenceRequestId) return;
      rows.push(...result.items);
    }
    if (requestId !== archiveImageSequenceRequestId) return;
    const images = rows.filter((item) => isImagePreviewFile(item.mimeType, item.originalFileName));
    archiveImageSequence.value = images.some((item) => item.documentId === document.documentId) ? images : [document];
  } catch {
    if (requestId === archiveImageSequenceRequestId) archiveImageSequence.value = [document];
  } finally {
    if (requestId === archiveImageSequenceRequestId) archiveImageSequenceLoading.value = false;
  }
}

function navigateArchiveImage(document: DocumentRecord) {
  selectedDocument.value = document;
  documentFormError.value = "";
  documentVersionError.value = "";
  showDocumentDetail.value = true;
  void loadDocumentVersions(document.documentId);
  void router.replace({
    path: route.path,
    query: { ...route.query, documentId: document.documentId },
    state: {
      [ARCHIVE_DOCUMENT_PREVIEW_STATE]: document.documentId,
      [ARCHIVE_DIRECTORY_HISTORY_STATE]: JSON.stringify(archiveDirectorySnapshot())
    }
  });
}

function documentIdFromRoute(): string {
  return typeof route.query.documentId === "string" ? route.query.documentId : "";
}

function closeDocumentDetail() {
  showDocumentDetail.value = false;
  archiveImageSequenceRequestId += 1;
  archiveImageSequence.value = [];
  archiveImageSequenceLoading.value = false;
  const documentId = documentIdFromRoute();
  if (!documentId) return;

  if (window.history.state?.[ARCHIVE_DOCUMENT_PREVIEW_STATE] === documentId) {
    router.back();
    return;
  }

  const nextQuery = { ...route.query };
  delete nextQuery.documentId;
  void router.replace({ path: route.path, query: nextQuery });
}

function setDocumentDetailOpen(isOpen: boolean) {
  if (isOpen) {
    showDocumentDetail.value = true;
    return;
  }
  closeDocumentDetail();
}

let documentRouteSyncId = 0;
async function syncDocumentDetailFromRoute() {
  if (!documentRouteReady.value) return;
  const requestId = ++documentRouteSyncId;
  const documentId = documentIdFromRoute();
  if (!documentId) {
    showDocumentDetail.value = false;
    selectedDocument.value = null;
    documentVersions.value = [];
    archiveImageSequenceRequestId += 1;
    archiveImageSequence.value = [];
    archiveImageSequenceLoading.value = false;
    return;
  }

  let document = selectedDocument.value?.documentId === documentId ? selectedDocument.value : null;
  document ??= documents.value.find((item) => item.documentId === documentId) ?? null;
  if (!document) document = await client.document(documentId).catch(() => null);
  if (requestId !== documentRouteSyncId || documentIdFromRoute() !== documentId) return;

  if (!document) {
    showDocumentDetail.value = false;
    selectedDocument.value = null;
    documentVersions.value = [];
    const nextQuery = { ...route.query };
    delete nextQuery.documentId;
    void router.replace({ path: route.path, query: nextQuery });
    return;
  }

  selectedDocument.value = document;
  documentFormError.value = "";
  documentVersionError.value = "";
  showDocumentDetail.value = true;
  void loadDocumentVersions(document.documentId);
  if (isImagePreviewFile(document.mimeType, document.originalFileName)
    && !archiveImageSequence.value.some((item) => item.documentId === document.documentId)) {
    void loadArchiveImageSequence(document);
  }
}

async function loadDocumentVersions(documentId: string) {
  try {
    documentVersions.value = await client.documentVersions(documentId);
  } catch {
    documentVersions.value = selectedDocument.value ? [selectedDocument.value] : [];
  }
}

function documentReviewLabel(status: DocumentReviewStatus) {
  return DOCUMENT_REVIEW_LABELS[status];
}

async function saveDocumentMetadata(input: DocumentUpdateInput) {
  if (!selectedDocument.value) return;
  savingDocument.value = true;
  documentFormError.value = "";
  try {
    const updated = await client.updateDocument(selectedDocument.value.documentId, input);
    selectedDocument.value = updated;
    await loadDocumentVersions(updated.documentId);
    toasts.success("Document metadata saved", `${updated.originalFileName} was updated.`);
    if (template.value.personalArchive) await reloadArchiveWorkspace();
    else await loadDocuments();
  } catch (error) {
    documentFormError.value = error instanceof Error ? error.message : "Unable to update document";
    toasts.error("Unable to update document", documentFormError.value);
  } finally {
    savingDocument.value = false;
  }
}

async function uploadDocumentVersion(payload: { file: File; category: DocumentCategory; notes: string; tagIds: string[] }) {
  if (!selectedDocument.value) return;
  uploadingDocumentVersion.value = true;
  documentVersionError.value = "";
  try {
    const form = new FormData();
    form.append("file", payload.file);
    form.append("category", payload.category);
    form.append("notes", payload.notes);
    payload.tagIds.forEach((tagId) => form.append("tagIds", tagId));
    const result = await client.uploadDocumentVersion(selectedDocument.value.documentId, form);
    selectedDocument.value = result.current;
    documentVersions.value = result.versions;
    toasts.success("New document version uploaded", `${result.current.originalFileName} is now version ${result.current.versionNumber}.`);
    if (template.value.personalArchive) await reloadArchiveWorkspace();
    else await loadDocuments();
  } catch (error) {
    documentVersionError.value = error instanceof Error ? error.message : "Unable to upload new version";
    toasts.error("Version upload failed", documentVersionError.value);
  } finally {
    uploadingDocumentVersion.value = false;
  }
}

async function deleteDocument(document: DocumentRecord) {
  if (!auth.canDeleteDocuments) return;
  const archiveTrash = template.value.personalArchive;
  if (!window.confirm(archiveTrash
    ? `Move ${document.originalFileName} to Archive trash?`
    : `Delete ${document.originalFileName}?`)) return;
  try {
    await client.deleteDocument(document.documentId);
    if (selectedDocument.value?.documentId === document.documentId) {
      closeDocumentDetail();
      selectedDocument.value = null;
      documentVersions.value = [];
    }
    toasts.success(archiveTrash ? "Moved to Archive trash" : "Document deleted", `${document.originalFileName} was removed from active documents.`);
    if (archiveTrash) await reloadArchiveWorkspace();
    else await loadDocuments();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete document";
    toasts.error("Unable to delete document", message);
  }
}

async function restoreArchivedDocument(document: DocumentRecord) {
  try {
    await client.restoreDocument(document.documentId);
    toasts.success("File restored", `${document.originalFileName} is back in the archive.`);
    await reloadArchiveWorkspace();
  } catch (error) {
    toasts.error("Unable to restore file", error instanceof Error ? error.message : "Please try again.");
  }
}

async function purgeArchivedDocument(document: DocumentRecord) {
  if (!window.confirm(`Permanently delete ${document.originalFileName} and every saved version? This cannot be undone.`)) return;
  try {
    await client.purgeDocument(document.documentId);
    toasts.success("File permanently deleted", document.originalFileName);
    await reloadArchiveWorkspace();
  } catch (error) {
    toasts.error("Unable to permanently delete file", error instanceof Error ? error.message : "Please try again.");
  }
}

function toggleDocumentSelection(documentId: string) {
  selectedDocumentIds.value = selectedDocumentIds.value.includes(documentId)
    ? selectedDocumentIds.value.filter((id) => id !== documentId)
    : [...selectedDocumentIds.value, documentId];
}

function toggleCurrentPageSelection() {
  if (currentPageAllSelected.value) {
    const currentIds = new Set(documents.value.map((document) => document.documentId));
    selectedDocumentIds.value = selectedDocumentIds.value.filter((id) => !currentIds.has(id));
  } else {
    selectedDocumentIds.value = Array.from(new Set([...selectedDocumentIds.value, ...documents.value.map((document) => document.documentId)]));
  }
}

function savedViewPayload() {
  return {
    caseId: selectedCaseId.value,
    category: selectedCategory.value,
    q: documentSearch.value,
    reviewStatus: selectedReviewStatus.value,
    partyOrganizationId: selectedOrganizationId.value,
    tagId: selectedTagId.value,
    uploadedFrom: uploadedFrom.value,
    uploadedTo: uploadedTo.value,
    sortOption: sortOption.value
  };
}

function applySavedView() {
  const view = savedViews.value.find((item) => item.savedViewId === selectedSavedViewId.value);
  if (!view) return;
  const filters = view.filters as Record<string, string | undefined>;
  selectedCaseId.value = filters.caseId ?? ALL_SERVICES;
  selectedCategory.value = filters.category ?? "";
  documentSearch.value = filters.q ?? "";
  selectedReviewStatus.value = filters.reviewStatus ?? "";
  selectedOrganizationId.value = filters.partyOrganizationId ?? "";
  selectedTagId.value = filters.tagId ?? "";
  uploadedFrom.value = filters.uploadedFrom ?? "";
  uploadedTo.value = filters.uploadedTo ?? "";
  sortOption.value = filters.sortOption ?? view.sort ?? "uploaded_desc";
  pageSize.value = view.pageSize;
  page.value = 1;
  void loadDocuments();
}

async function saveCurrentView() {
  const name = savedViewName.value.trim();
  if (!name) return;
  try {
    const view = await client.createSavedDirectoryView({
      scope: "documents",
      name,
      filters: savedViewPayload(),
      sort: sortOption.value,
      pageSize: pageSize.value
    });
    savedViews.value = [...savedViews.value, view].sort((a, b) => a.name.localeCompare(b.name));
    selectedSavedViewId.value = view.savedViewId;
    savedViewName.value = "";
    toasts.success("Document view saved", view.name);
  } catch (error) {
    toasts.error("Unable to save view", error instanceof Error ? error.message : "Please try again.");
  }
}

async function deleteSelectedView() {
  const view = savedViews.value.find((item) => item.savedViewId === selectedSavedViewId.value);
  if (!view || !window.confirm(`Delete saved view "${view.name}"?`)) return;
  await client.deleteSavedDirectoryView(view.savedViewId);
  savedViews.value = savedViews.value.filter((item) => item.savedViewId !== view.savedViewId);
  selectedSavedViewId.value = "";
  toasts.success("Document view deleted", view.name);
}

async function runDocumentBulkAction(action: "set-category" | "set-review-status" | "move-folder" | "delete") {
  if (!selectedDocumentIds.value.length) return;
  if (action === "set-category" && !bulkCategory.value) return;
  if (action === "set-review-status" && !bulkReviewStatus.value) return;
  if (action === "move-folder" && bulkFolderId.value === "") return;
  if (action === "delete" && !window.confirm(template.value.personalArchive
    ? `Move ${selectedDocumentIds.value.length} selected files to Archive trash?`
    : `Delete ${selectedDocumentIds.value.length} selected documents?`)) return;
  try {
    const result = await client.bulkDocuments({
      action,
      documentIds: selectedDocumentIds.value,
      category: action === "set-category" ? (bulkCategory.value as DocumentCategory) : undefined,
      reviewStatus: action === "set-review-status" ? (bulkReviewStatus.value as DocumentReviewStatus) : undefined,
      folderId: action === "move-folder" ? (bulkFolderId.value || null) : undefined
    });
    toasts.success("Bulk update complete", `${result.succeeded} of ${result.requested} documents updated.`);
    selectedDocumentIds.value = [];
    bulkFolderId.value = "";
    if (template.value.personalArchive) await reloadArchiveWorkspace();
    else await loadDocuments();
  } catch (error) {
    toasts.error("Bulk update failed", error instanceof Error ? error.message : "Please try again.");
  }
}

let documentFilterTimer: number | undefined;
watch(sortOption, (value) => {
  if (template.value.personalArchive) localStorage.setItem(ARCHIVE_SORT_STORAGE_KEY, value);
});

watch(
  archiveColumnVisibility,
  (value) => localStorage.setItem(ARCHIVE_COLUMNS_STORAGE_KEY, JSON.stringify(value)),
  { deep: true }
);

watch(
  [documentSearch, selectedCategory, selectedOrganizationId, selectedReviewStatus, selectedTagId, uploadedFrom, uploadedTo, sortOption, pageSize],
  () => {
    if (applyingArchiveDirectoryState) return;
    page.value = 1;
    window.clearTimeout(documentFilterTimer);
    documentFilterTimer = window.setTimeout(loadDocuments, 200);
  }
);

watch(
  [documentSearch, selectedCategory, selectedReviewStatus, selectedOrganizationId, selectedTagId, uploadedFrom, uploadedTo, sortOption, selectedSavedViewId, showAdvancedFilters, page, pageSize],
  rememberArchiveDirectoryState,
  { flush: "post" }
);

watch(
  () => [route.query.archiveLocation, route.query.archiveFolder, route.query.category],
  syncArchiveDirectoryFromRoute
);

watch(
  () => route.query.documentId,
  () => {
    void syncDocumentDetailFromRoute();
  }
);

onMounted(async () => {
  const [caseRows, tagRows, savedViewRows] = await Promise.all([
    template.value.personalArchive
      ? Promise.resolve({ items: [] as CaseRecord[] })
      : client.casesPage({ archiveStatus: "all", sort: "number", direction: "desc" }, { pageSize: 100 }),
    client.tags(),
    client.savedDirectoryViews("documents")
  ]);
  cases.value = caseRows.items;
  tags.value = tagRows;
  savedViews.value = savedViewRows;
  if (template.value.personalArchive) {
    await loadArchiveManager();
    applyArchiveDirectoryState(archiveDirectoryStateFromRoute());
    archiveRouteReady.value = true;
    rememberArchiveDirectoryState();
  }
  selectedCaseId.value = ALL_SERVICES;
  if (!template.value.personalArchive && typeof route.query.category === "string" && availableDocumentCategories.value.includes(route.query.category as DocumentCategory)) {
    selectedCategory.value = route.query.category;
  }
  await loadDocuments();
  rememberArchiveDirectoryState();
  documentRouteReady.value = true;
  await syncDocumentDetailFromRoute();
});
</script>

<template>
  <PageHeader
    :class="template.personalArchive ? 'personal-compact-page-header' : ''"
    :eyebrow="template.personalArchive ? 'Private file manager' : 'File manager'"
    :title="template.personalArchive ? t('archive') : t('documents')"
    :description="template.personalArchive
      ? 'Private files, versions, and records.'
      : `Browse ${labels.lowerSingular} documents. Uploads are stored in private file storage while secure records keep metadata, permissions, tags, and audit history.`"
  >
    <div v-if="template.personalArchive" class="personal-page-actions">
      <details class="personal-action-menu" data-dismissible-menu>
        <summary class="btn-secondary flex h-8 cursor-pointer list-none items-center px-2.5 text-xs">
          <Search class="h-3.5 w-3.5" /> Search
          <span v-if="documentSearch" class="h-1.5 w-1.5 rounded-full bg-accent-700" aria-label="Search active" />
        </summary>
        <div class="personal-action-panel">
          <p class="personal-action-panel-heading">Search archive</p>
          <label class="relative block">
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input v-model="documentSearch" class="input h-9 pl-9 pr-9 text-sm" placeholder="Filename, category, notes, or tags..." />
            <button v-if="documentSearch" class="absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-ink-400 hover:bg-ink-50 hover:text-ink-900" type="button" title="Clear search" @click="documentSearch = ''"><X class="h-3.5 w-3.5" /></button>
          </label>
        </div>
      </details>

      <details class="personal-action-menu" data-dismissible-menu>
        <summary class="btn-secondary flex h-8 cursor-pointer list-none items-center px-2.5 text-xs">
          <SlidersHorizontal class="h-3.5 w-3.5" /> Filters
          <span v-if="personalArchiveFilterCount" class="personal-action-count">{{ personalArchiveFilterCount }}</span>
        </summary>
        <div class="personal-action-panel personal-action-panel--wide">
          <p class="personal-action-panel-heading">Filter and sort files</p>
          <div class="grid gap-2 sm:grid-cols-2">
            <select v-model="selectedReviewStatus" class="input h-9 py-1.5 text-sm">
              <option value="">Any review status</option>
              <option v-for="option in documentReviewOptions" :key="option.status" :value="option.status">{{ option.label }}</option>
            </select>
            <div class="flex min-w-0 gap-1.5">
              <select class="input h-9 min-w-0 flex-1 py-1.5 text-sm" :value="documentSortField" aria-label="Sort archive files by" @change="setDocumentSortField">
                <option v-for="field in ARCHIVE_SORT_FIELDS" :key="field" :value="field">{{ ARCHIVE_SORT_LABELS[field] }}</option>
              </select>
              <button class="btn-secondary h-9 shrink-0 px-2.5 text-xs" type="button" :title="`Reverse order. Currently ${documentSortDirectionLabel}.`" @click="toggleDocumentSortDirection">
                <component :is="documentSortIcon" class="h-3.5 w-3.5" /> {{ documentSortDirectionLabel }}
              </button>
            </div>
            <select v-model="selectedTagId" class="input h-9 py-1.5 text-sm">
              <option value="">Any tag</option>
              <option v-for="tag in tags" :key="tag.tagId" :value="tag.tagId">{{ tag.name }}</option>
            </select>
            <select v-model="selectedSavedViewId" class="input h-9 py-1.5 text-sm" @change="applySavedView">
              <option value="">Saved views</option>
              <option v-for="view in savedViews" :key="view.savedViewId" :value="view.savedViewId">{{ view.name }}</option>
            </select>
            <label class="text-xs font-semibold text-ink-500">Uploaded from<input v-model="uploadedFrom" class="input mt-1 h-9 py-1.5 text-sm" type="date" /></label>
            <label class="text-xs font-semibold text-ink-500">Uploaded to<input v-model="uploadedTo" class="input mt-1 h-9 py-1.5 text-sm" type="date" /></label>
          </div>
          <div v-if="activeFilterChips.length" class="mt-3 flex flex-wrap gap-1.5 border-t border-ink-100 pt-3">
            <button v-for="chip in activeFilterChips" :key="chip.key" class="inline-flex max-w-full items-center gap-1 rounded-full bg-accent-50 px-2 py-1 text-xs font-semibold text-accent-950" type="button" :title="`Clear ${chip.label}`" @click="clearFilter(chip.key)">
              <span class="truncate">{{ chip.label }}</span><X class="h-3 w-3 shrink-0" />
            </button>
          </div>
          <div class="mt-3 grid gap-2 border-t border-ink-100 pt-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <input v-model="savedViewName" class="input h-9 text-sm" placeholder="Name current view" />
            <button class="btn-secondary h-9 px-2.5 text-xs" type="button" :disabled="!savedViewName.trim()" @click="saveCurrentView"><Save class="h-3.5 w-3.5" /> Save view</button>
            <button class="btn-secondary h-9 px-2.5 text-xs text-red-700" type="button" :disabled="!selectedSavedViewId" @click="deleteSelectedView"><Trash2 class="h-3.5 w-3.5" /> Delete</button>
          </div>
          <div class="mt-3 flex justify-end border-t border-ink-100 pt-3">
            <button class="btn-secondary h-8 px-2.5 text-xs" type="button" :disabled="!activeFilterCount && !documentSearch && sortOption === 'uploaded_desc'" @click="resetDocumentFilters"><X class="h-3.5 w-3.5" /> Clear all</button>
          </div>
        </div>
      </details>

      <details class="personal-action-menu" data-dismissible-menu>
        <summary class="btn-secondary flex h-8 cursor-pointer list-none items-center px-2.5 text-xs">
          <Settings2 class="h-3.5 w-3.5" /> Display
          <span v-if="archiveColumnProfile === 'music'" class="personal-action-count" aria-label="Music display profile">♪</span>
        </summary>
        <div class="personal-action-panel">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="personal-action-panel-heading mb-1">{{ archiveColumnProfileLabel }} columns</p>
              <p class="text-xs leading-5 text-ink-500">
                Music folders use their own saved layout and hide Review by default.
              </p>
            </div>
            <span class="rounded-full bg-accent-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-accent-900">
              {{ visibleArchiveColumnCount }} shown
            </span>
          </div>
          <div class="mt-3 grid grid-cols-2 gap-1.5" @click.stop>
            <label
              v-for="column in ARCHIVE_COLUMN_OPTIONS"
              :key="column.key"
              class="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm transition hover:bg-ink-50"
            >
              <input
                type="checkbox"
                :checked="isArchiveColumnVisible(column.key)"
                @change="setArchiveColumnVisible(column.key, $event)"
              />
              <span>{{ column.label }}</span>
            </label>
          </div>
          <div class="mt-3 flex items-center justify-between gap-3 border-t border-ink-100 pt-3">
            <p class="text-xs text-ink-500">File name and actions always stay visible.</p>
            <button class="btn-secondary h-8 shrink-0 px-2.5 text-xs" type="button" @click="resetArchiveColumns">
              <RotateCcw class="h-3.5 w-3.5" /> Reset
            </button>
          </div>
        </div>
      </details>

      <details class="personal-action-menu" data-dismissible-menu>
        <summary class="btn-secondary flex h-8 cursor-pointer list-none items-center px-2.5 text-xs">
          <FolderOpen class="h-3.5 w-3.5" /> Categories
          <span v-if="selectedCategory" class="personal-action-count">1</span>
        </summary>
        <div class="personal-action-panel personal-action-panel--wide">
          <p class="personal-action-panel-heading">Category folders</p>
          <div class="grid gap-1 sm:grid-cols-2">
            <button class="flex min-h-10 items-center gap-2 rounded-md px-2.5 text-left text-sm transition hover:bg-ink-50" :class="selectedCategory === '' ? 'bg-accent-50 font-semibold text-accent-950' : ''" type="button" @click="selectCategory('')">
              <FolderOpen class="h-4 w-4 shrink-0 text-accent-800" /><span class="min-w-0 flex-1 truncate">All documents</span><span class="text-xs tabular-nums text-ink-500">{{ documentCandidateCount }}</span>
            </button>
            <button v-for="category in documentCategorySummaries" :key="category.category" class="flex min-h-10 items-center gap-2 rounded-md px-2.5 text-left text-sm transition hover:bg-ink-50" :class="selectedCategory === category.category ? 'bg-accent-50 font-semibold text-accent-950' : ''" type="button" @click="selectCategory(category.category)">
              <FolderCheck v-if="category.complete" class="h-4 w-4 shrink-0 text-emerald-700" />
              <FolderX v-else-if="category.required" class="h-4 w-4 shrink-0 text-amber-700" />
              <FolderOpen v-else class="h-4 w-4 shrink-0 text-ink-400" />
              <span class="min-w-0 flex-1 truncate">{{ category.category }}</span><span class="text-xs tabular-nums text-ink-500">{{ category.count }}</span>
            </button>
          </div>
        </div>
      </details>

      <details class="personal-action-menu" data-dismissible-menu>
        <summary class="btn-secondary flex h-8 cursor-pointer list-none items-center px-2.5 text-xs">
          <BarChart3 class="h-3.5 w-3.5" /> Overview
          <span class="personal-action-count">{{ documentTotalCount }}</span>
        </summary>
        <div class="personal-action-panel">
          <p class="personal-action-panel-heading">Archive overview</p>
          <div class="grid gap-2 text-sm">
            <div class="flex items-center justify-between"><span class="text-ink-500">Matching records</span><strong>{{ totalDocuments }}</strong></div>
            <div class="flex items-center justify-between"><span class="text-ink-500">Shown on this page</span><strong>{{ filteredDocuments.length }}</strong></div>
            <button class="flex items-center justify-between rounded-md px-2 py-1.5 text-left transition hover:bg-amber-50" type="button" @click="selectedReviewStatus = 'needs-review'"><span class="text-ink-500">Needs review</span><strong>{{ reviewAttentionCount }}</strong></button>
          </div>
        </div>
      </details>

      <ArchiveManagementAccess v-if="template.personalArchive && auth.user?.role === 'Admin'" />
      <button v-if="auth.canUpload" class="btn-primary h-8 px-2.5 text-xs" type="button" @click="openArchiveUpload()">
        <Plus class="h-3.5 w-3.5" /> Add files
      </button>
    </div>
  </PageHeader>

  <section v-if="!hasCases" class="panel p-6">
    <div class="max-w-2xl">
      <p class="text-xs font-semibold uppercase tracking-wide text-accent-800">No {{ labels.lowerPlural }} yet</p>
      <h2 class="mt-2 text-xl font-semibold">Create a {{ labels.lowerSingular }} before adding documents</h2>
      <p class="mt-2 text-sm leading-6 text-ink-500">
        Documents are organized inside {{ labels.lowerSingular }} records so each upload stays connected to the right contacts, tasks, assets, and checklist.
      </p>
      <RouterLink class="btn-primary mt-5 inline-flex w-fit" :to="workItemPath()">
        Go to {{ labels.plural }}
      </RouterLink>
    </div>
  </section>

  <template v-else>
    <DirectoryToolbar
      v-if="!template.personalArchive"
      :active-filter-count="activeFilterCount"
      :show-advanced-filters="showAdvancedFilters"
      :selected-count="selectedDocumentCount"
      @toggle-advanced="showAdvancedFilters = !showAdvancedFilters"
      @clear-filters="resetDocumentFilters"
    >
      <template #search>
        <label class="relative block">
          <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            v-model="documentSearch"
            class="input pl-9"
            :placeholder="template.personalArchive ? 'Search filename, category, notes, or tags' : 'Search filename, service, customer, category, notes, or tags'"
          />
        </label>
      </template>

      <template #controls>
        <select v-if="!template.personalArchive" v-model="selectedCaseId" class="input h-11 min-w-[14rem] flex-[2_1_16rem]" @change="changeSelectedService">
          <option :value="ALL_SERVICES">All {{ labels.lowerPlural }}</option>
          <option v-for="caseRecord in cases" :key="caseRecord.caseId" :value="caseRecord.caseId">
            {{ caseRecord.caseNumber }} - {{ caseRecord.propertyAddress }}
          </option>
        </select>
        <select v-model="selectedCategory" class="input h-11 min-w-[11rem] flex-[1_1_12rem]">
          <option value="">Any category</option>
          <option v-for="category in availableDocumentCategories" :key="category" :value="category">{{ category }}</option>
        </select>
        <select v-model="selectedReviewStatus" class="input h-11 min-w-[11rem] flex-[1_1_12rem]">
          <option value="">Any review status</option>
          <option v-for="option in documentReviewOptions" :key="option.status" :value="option.status">
            {{ option.label }}
          </option>
        </select>
        <select v-model="sortOption" class="input h-11 min-w-[11rem] flex-[1_1_12rem]">
          <option value="uploaded_desc">Recently uploaded</option>
          <option value="uploaded_asc">Oldest uploaded</option>
          <option value="fileName_asc">File A-Z</option>
          <option value="fileName_desc">File Z-A</option>
          <option v-if="!template.personalArchive" value="service_asc">{{ labels.singular }} A-Z</option>
          <option v-if="!template.personalArchive" value="customer_asc">Customer A-Z</option>
          <option value="reviewStatus_asc">Review status</option>
        </select>
        <select v-model="selectedSavedViewId" class="input h-11 min-w-[11rem] flex-[1_1_12rem]" @change="applySavedView">
          <option value="">Saved views</option>
          <option v-for="view in savedViews" :key="view.savedViewId" :value="view.savedViewId">{{ view.name }}</option>
        </select>
      </template>

      <template #chips>
        <button
          v-for="chip in activeFilterChips"
          :key="chip.key"
          class="inline-flex max-w-full items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-accent-950 ring-1 ring-accent-100 hover:bg-accent-50"
          type="button"
          :title="`Clear ${chip.label}`"
          @click="clearFilter(chip.key)"
        >
          <span class="truncate">{{ chip.label }}</span>
          <X class="h-3.5 w-3.5 shrink-0" />
        </button>
      </template>

      <template #advanced>
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <select v-if="!template.personalArchive" v-model="selectedOrganizationId" class="input">
            <option value="">Any customer / organization</option>
            <option v-for="organization in organizationOptions" :key="organization.partyOrganizationId" :value="organization.partyOrganizationId">
              {{ organization.name }}
            </option>
          </select>
          <select v-model="selectedTagId" class="input">
            <option value="">Any tag</option>
            <option v-for="tag in tags" :key="tag.tagId" :value="tag.tagId">{{ tag.name }}</option>
          </select>
          <label>
            <span class="mb-1 block text-xs font-semibold uppercase text-ink-500">Uploaded from</span>
            <input v-model="uploadedFrom" class="input" type="date" />
          </label>
          <label>
            <span class="mb-1 block text-xs font-semibold uppercase text-ink-500">Uploaded to</span>
            <input v-model="uploadedTo" class="input" type="date" />
          </label>
        </div>
        <div class="mt-3 grid gap-3 lg:grid-cols-[minmax(14rem,1fr)_auto_auto]">
          <input v-model="savedViewName" class="input" placeholder="Name current document filters as a saved view" />
          <button class="btn-secondary h-11 px-3" type="button" :disabled="!savedViewName.trim()" @click="saveCurrentView">
            <Save class="h-4 w-4" />
            Save view
          </button>
          <button class="btn-secondary h-11 px-3 text-red-700" type="button" :disabled="!selectedSavedViewId" @click="deleteSelectedView">
            <Trash2 class="h-4 w-4" />
            Delete view
          </button>
        </div>
      </template>

      <template #summary>
        <span class="rounded-md border border-ink-200 px-3 py-2"><strong class="text-ink-900">{{ documentTotalCount }}</strong> shown</span>
        <button
          class="rounded-md border border-ink-200 px-3 py-2 text-left transition hover:border-accent-300 hover:bg-accent-50"
          type="button"
          @click="selectedReviewStatus = 'needs-review'"
        >
          <strong class="text-ink-900">{{ reviewAttentionCount }}</strong> need attention
        </button>
        <span class="rounded-md border border-ink-200 px-3 py-2">{{ template.personalArchive ? 'Private archive' : selectedServiceLabel }}</span>
      </template>

      <template #selection>
        <div v-if="auth.canEditDocuments || auth.canDeleteDocuments" class="flex flex-wrap items-center gap-3">
          <span class="font-semibold text-ink-700">{{ selectedDocumentCount }} selected</span>
          <button class="btn-secondary h-9 px-3" type="button" :disabled="!documents.length" @click="toggleCurrentPageSelection">
            {{ currentPageAllSelected ? "Clear page" : "Select page" }}
          </button>
          <select v-model="bulkCategory" class="input h-9 max-w-xs py-1">
            <option value="">Choose category</option>
            <option v-for="category in availableDocumentCategories" :key="category" :value="category">{{ category }}</option>
          </select>
          <button class="btn-secondary h-9 px-3" type="button" :disabled="!selectedDocumentCount || !bulkCategory || !auth.canEditDocuments" @click="runDocumentBulkAction('set-category')">
            Set category
          </button>
          <select v-model="bulkReviewStatus" class="input h-9 max-w-xs py-1">
            <option value="">Choose review status</option>
            <option v-for="option in documentReviewOptions" :key="option.status" :value="option.status">{{ option.label }}</option>
          </select>
          <button class="btn-secondary h-9 px-3" type="button" :disabled="!selectedDocumentCount || !bulkReviewStatus || !auth.canEditDocuments" @click="runDocumentBulkAction('set-review-status')">
            Set review
          </button>
          <button class="btn-secondary h-9 px-3 text-red-700" type="button" :disabled="!selectedDocumentCount || !auth.canDeleteDocuments" @click="runDocumentBulkAction('delete')">
            Delete selected
          </button>
        </div>
      </template>

      <template #errors>
        <p v-if="documentsError" class="text-sm font-semibold text-legal-red">{{ documentsError }}</p>
      </template>
    </DirectoryToolbar>

    <div
      :class="[
        template.personalArchive ? 'archive-browser grid min-h-0 overflow-hidden rounded-xl border lg:min-h-[620px]' : '',
        archiveSidebarResizing ? 'archive-browser--resizing' : ''
      ]"
      :style="template.personalArchive ? { '--archive-sidebar-width': `${archiveSidebarWidth}px` } : undefined"
    >
      <aside v-if="template.personalArchive" id="archive-folder-navigation" class="archive-browser-sidebar flex min-h-0 flex-col border-b p-3 lg:border-b-0">
        <div>
          <p class="archive-browser-label px-2 text-[11px] font-semibold uppercase tracking-[0.14em]">Smart views</p>
          <div class="mt-2 space-y-1">
            <button class="archive-browser-nav-item flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm" :class="archiveLocationMode === 'all' && !selectedCategory ? 'archive-browser-nav-item--active font-semibold' : ''" type="button" @click="selectArchiveLocation('all')">
              <FileText class="h-4 w-4" /><span class="min-w-0 flex-1 truncate">All files</span><span class="text-xs tabular-nums text-ink-400">{{ archiveAllFileCount }}</span>
            </button>
            <button class="archive-browser-nav-item flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm" :class="archiveLocationMode === 'unfiled' ? 'archive-browser-nav-item--active font-semibold' : ''" type="button" @dragover="onArchiveFolderDragOver($event, null)" @dragleave="clearArchiveFolderDropTarget" @drop="onArchiveFolderDrop($event, null)" @click="selectArchiveLocation('unfiled')">
              <FolderX class="h-4 w-4" /><span class="min-w-0 flex-1 truncate">Unfiled</span><span class="text-xs tabular-nums text-ink-400">{{ archiveUnfiledCount }}</span>
            </button>
          </div>
        </div>

        <div class="archive-browser-section mt-5 border-t pt-4">
          <div class="flex items-center justify-between gap-2 px-2">
            <p class="archive-browser-label text-[11px] font-semibold uppercase tracking-[0.14em]">Folders</p>
            <button class="archive-browser-icon-button grid h-7 w-7 place-items-center rounded-md" type="button" title="New top-level folder" @click="openNewArchiveFolder(null)"><FolderPlus class="h-4 w-4" /></button>
          </div>
          <button
            class="archive-browser-nav-item mt-2 flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm"
            :class="[
              archiveLocationMode === 'root' ? 'archive-browser-nav-item--active font-semibold' : '',
              archiveFolderDropTargetId === 'root' ? 'ring-2 ring-accent-400 bg-accent-50' : ''
            ]"
            type="button"
            @dragover="onArchiveFolderDragOver($event, null)"
            @dragleave="clearArchiveFolderDropTarget"
            @drop="onArchiveFolderDrop($event, null)"
            @click="selectArchiveLocation('root')"
          >
            <FolderOpen class="h-4 w-4" /><span class="min-w-0 flex-1 truncate">My archive</span>
          </button>
          <div class="mt-1 space-y-0.5">
            <div
              v-for="entry in flattenedArchiveFolders"
              :key="entry.folder.folderId"
              class="archive-browser-nav-item group flex h-9 items-center rounded-md"
              :class="[
                archiveLocationMode === 'folder' && selectedArchiveFolderId === entry.folder.folderId ? 'archive-browser-nav-item--active' : '',
                archiveFolderDropTargetId === entry.folder.folderId ? 'ring-2 ring-accent-400 bg-accent-50' : ''
              ]"
              :style="{ paddingLeft: `${8 + entry.depth * 16}px` }"
              @dragover="onArchiveFolderDragOver($event, entry.folder.folderId)"
              @dragleave="clearArchiveFolderDropTarget"
              @drop="onArchiveFolderDrop($event, entry.folder.folderId)"
            >
              <button class="grid h-7 w-6 shrink-0 place-items-center" type="button" :aria-label="entry.hasChildren ? 'Toggle subfolders' : 'No subfolders'" @click.stop="entry.hasChildren && toggleArchiveFolderExpanded(entry.folder.folderId)">
                <ChevronDown v-if="entry.hasChildren && expandedArchiveFolderIds.includes(entry.folder.folderId)" class="h-3.5 w-3.5" />
                <ChevronRight v-else-if="entry.hasChildren" class="h-3.5 w-3.5" />
              </button>
              <button class="flex min-w-0 flex-1 items-center gap-2 text-left text-sm" type="button" :title="entry.folder.name" @click="selectArchiveFolder(entry.folder.folderId)">
                <FolderOpen class="h-4 w-4 shrink-0" /><span class="truncate" :class="archiveLocationMode === 'folder' && selectedArchiveFolderId === entry.folder.folderId ? 'font-semibold' : ''">{{ entry.folder.name }}</span>
              </button>
              <div class="mr-1 flex shrink-0 items-center">
                <button v-if="auth.canEditDocuments" class="grid h-7 w-7 place-items-center rounded text-ink-400 hover:bg-ink-100 hover:text-ink-800" type="button" title="Rename or move folder" @click.stop="openRenameArchiveFolder(entry.folder)"><Edit3 class="h-3.5 w-3.5" /></button>
                <button v-if="auth.canDeleteDocuments" class="grid h-7 w-7 place-items-center rounded text-ink-400 hover:bg-red-50 hover:text-red-700" type="button" title="Delete folder and contents" @click.stop="openDeleteArchiveFolder(entry.folder)"><Trash2 class="h-3.5 w-3.5" /></button>
              </div>
            </div>
          </div>
        </div>

        <div class="archive-browser-section mt-5 border-t pt-4">
          <div class="flex items-center justify-between gap-2 px-2">
            <p class="archive-browser-label text-[11px] font-semibold uppercase tracking-[0.14em]">Categories</p>
            <button class="text-xs font-semibold text-accent-800 hover:underline" type="button" @click="showCategoryManager = true">Manage</button>
          </div>
          <div class="mt-2 max-h-44 space-y-0.5 overflow-y-auto">
            <button v-for="category in archiveCategories" :key="category.categoryId" class="archive-browser-nav-item flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm" :class="selectedCategory === category.name ? 'archive-browser-nav-item--active font-semibold' : ''" type="button" @click="selectArchiveCategory(category.name)">
              <FolderCheck class="h-3.5 w-3.5" /><span class="min-w-0 flex-1 truncate">{{ category.name }}</span><span class="text-xs tabular-nums text-ink-400">{{ category.fileCount }}</span>
            </button>
          </div>
        </div>

        <button class="archive-browser-nav-item mt-auto flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm" :class="archiveLocationMode === 'trash' ? 'archive-browser-nav-item--active archive-browser-nav-item--danger font-semibold' : ''" type="button" @click="selectArchiveLocation('trash')">
          <Trash2 class="h-4 w-4" /><span class="min-w-0 flex-1">Archive trash</span><span class="text-xs tabular-nums text-ink-400">{{ archiveTrashCount }}</span>
        </button>
      </aside>

      <button
        v-if="template.personalArchive"
        class="panel-resize-handle archive-browser-resize-handle"
        type="button"
        role="separator"
        aria-orientation="vertical"
        aria-controls="archive-folder-navigation"
        :aria-valuemin="archiveSidebarMinWidth"
        :aria-valuemax="archiveSidebarMaxWidth"
        :aria-valuenow="archiveSidebarWidth"
        aria-label="Resize folder tree"
        title="Drag to resize the folder tree. Double-click to restore the default width."
        @pointerdown="startArchiveSidebarResize"
        @keydown="onArchiveSidebarResizeKeydown"
        @dblclick="resetArchiveSidebarWidth"
      />

      <div class="min-w-0">
        <div v-if="template.personalArchive" class="flex flex-wrap items-center gap-2 border-b border-ink-200 px-4 py-3">
          <nav class="mr-auto flex min-w-0 items-center gap-1 text-sm" aria-label="Archive location">
            <template v-for="(crumb, index) in archiveBreadcrumbs" :key="crumb.id">
              <ChevronRight v-if="index" class="h-3.5 w-3.5 shrink-0 text-ink-300" />
              <button class="max-w-40 truncate rounded px-1.5 py-1 font-semibold text-ink-600 transition hover:bg-ink-50 hover:text-accent-900" type="button" @click="openArchiveBreadcrumb(crumb.id)">{{ crumb.label }}</button>
            </template>
            <span class="ml-2 shrink-0 text-xs text-ink-400">{{ totalDocuments }} files</span>
          </nav>
          <div class="flex min-w-0 items-center gap-1.5" role="group" aria-label="Archive file sorting">
            <label class="sr-only" for="archive-sort-field">Sort files by</label>
            <select id="archive-sort-field" class="input h-8 min-w-28 max-w-36 py-1 text-xs" :value="documentSortField" @change="setDocumentSortField">
              <option v-for="field in ARCHIVE_SORT_FIELDS" :key="field" :value="field">{{ ARCHIVE_SORT_LABELS[field] }}</option>
            </select>
            <button class="btn-secondary h-8 shrink-0 px-2 text-xs" type="button" :title="`Reverse order. Currently ${documentSortDirectionLabel}.`" :aria-label="`Reverse file order. Currently ${documentSortDirectionLabel}.`" @click="toggleDocumentSortDirection">
              <component :is="documentSortIcon" class="h-3.5 w-3.5" />
              <span class="hidden 2xl:inline">{{ documentSortDirectionLabel }}</span>
            </button>
          </div>
          <button v-if="currentArchiveFolder && archiveLocationMode === 'folder' && auth.canEditDocuments" class="btn-secondary h-8 px-2.5 text-xs" type="button" @click="openArchiveFolderMetadataEditor(currentArchiveFolder)"><SlidersHorizontal class="h-3.5 w-3.5" /> Edit metadata</button>
          <button v-if="archiveLocationMode !== 'trash' && auth.canEditDocuments" class="btn-secondary h-8 px-2.5 text-xs" type="button" @click="openNewArchiveFolder()"><FolderPlus class="h-3.5 w-3.5" /> New folder</button>
          <button v-if="archiveLocationMode !== 'trash' && auth.canUpload" class="btn-primary h-8 px-2.5 text-xs" type="button" @click="openArchiveUpload()"><UploadCloud class="h-3.5 w-3.5" /> Add files</button>
        </div>

        <section v-if="template.personalArchive && archiveLocationMode !== 'trash' && (auth.canEditDocuments || auth.canDeleteDocuments)" class="archive-browser-selection border-b p-3" aria-label="Selected file actions">
          <div v-if="auth.canEditDocuments || auth.canDeleteDocuments" class="flex flex-wrap items-center gap-2 text-sm">
            <span class="mr-1 w-28 shrink-0 whitespace-nowrap font-semibold tabular-nums text-ink-700" aria-live="polite">{{ selectedDocumentCount }} selected</span>
            <button class="btn-secondary h-8 w-24 shrink-0 px-2.5 text-xs" type="button" :disabled="!documents.length" @click="toggleCurrentPageSelection">{{ currentPageAllSelected ? "Clear page" : "Select page" }}</button>
            <select v-model="bulkFolderId" :disabled="!selectedDocumentCount || !auth.canEditDocuments" aria-label="Move selected files to" class="input h-8 max-w-48 py-1 text-xs"><option value="">Choose location</option><option :value="null">Unfiled</option><option v-for="folder in archiveFolderSelectOptions" :key="folder.folderId" :value="folder.folderId">{{ folder.label }}</option></select>
            <button class="btn-secondary h-8 px-2.5 text-xs" type="button" :disabled="!selectedDocumentCount || bulkFolderId === '' || !auth.canEditDocuments" @click="runDocumentBulkAction('move-folder')">Move</button>
            <select v-model="bulkCategory" :disabled="!selectedDocumentCount || !auth.canEditDocuments" aria-label="Category for selected files" class="input h-8 max-w-44 py-1 text-xs"><option value="">Choose category</option><option v-for="category in availableDocumentCategories" :key="category" :value="category">{{ category }}</option></select>
            <button class="btn-secondary h-8 px-2.5 text-xs" type="button" :disabled="!selectedDocumentCount || !bulkCategory || !auth.canEditDocuments" @click="runDocumentBulkAction('set-category')">Set category</button>
            <button class="btn-secondary ml-auto h-8 px-2.5 text-xs text-red-700" type="button" :disabled="!selectedDocumentCount || !auth.canDeleteDocuments" @click="runDocumentBulkAction('delete')"><Trash2 class="h-3.5 w-3.5" /> Move to trash</button>
          </div>
        </section>
        <p v-if="template.personalArchive && documentsError" class="border-b border-ink-200 px-4 py-3 text-sm font-semibold text-legal-red">{{ documentsError }}</p>

    <section v-if="!template.personalArchive" class="mb-3 grid gap-3 xl:grid-cols-[1fr_320px]">
      <div class="panel overflow-hidden p-4">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 class="font-semibold">Category folders</h2>
            <p class="mt-1 text-sm text-ink-500">
              {{ template.personalArchive ? "Personal files grouped by purpose." : globalDocumentsMode ? "All documents grouped by category." : `${selectedCase?.caseNumber} documents grouped by category.` }}
            </p>
          </div>
          <span class="rounded-full bg-accent-50 px-3 py-1 text-xs font-semibold text-accent-800">
            {{ documentTotalCount }} {{ documentTotalCount === 1 ? "file" : "files" }} shown
          </span>
        </div>
        <div class="overflow-x-auto">
          <div class="grid min-w-[980px] grid-cols-5 gap-3">
            <button
              class="rounded-md border p-3 text-left transition hover:bg-ink-50"
              :class="selectedCategory === '' ? 'border-accent-500 bg-accent-50' : 'border-ink-200 bg-white'"
              type="button"
              @click="selectCategory('')"
            >
              <FolderOpen class="h-5 w-5 text-accent-800" />
              <p class="mt-3 text-sm font-semibold">All documents</p>
              <p class="mt-1 text-xs text-ink-500">{{ documentCandidateCount }} {{ documentCandidateCount === 1 ? "file" : "files" }}</p>
            </button>
            <button
              v-for="category in documentCategorySummaries"
              :key="category.category"
              class="rounded-md border p-3 text-left transition hover:bg-ink-50"
              :class="selectedCategory === category.category ? 'border-accent-500 bg-accent-50' : 'border-ink-200 bg-white'"
              type="button"
              @click="selectCategory(category.category)"
            >
              <FolderCheck v-if="category.complete" class="h-5 w-5 text-emerald-700" />
              <FolderX v-else-if="category.required" class="h-5 w-5 text-amber-700" />
              <FolderOpen v-else class="h-5 w-5 text-ink-500" />
              <p class="mt-3 text-sm font-semibold">{{ category.category }}</p>
              <p class="mt-1 text-xs text-ink-500">
                {{ category.count }} {{ category.count === 1 ? "file" : "files" }}<span v-if="category.required"> · required</span>
              </p>
            </button>
          </div>
        </div>
      </div>

      <div class="panel p-4">
        <template v-if="!globalDocumentsMode">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h2 class="font-semibold">{{ labels.readinessTitle }}</h2>
              <p class="mt-1 text-sm text-ink-500">{{ readiness?.message }}</p>
            </div>
            <div
              class="grid h-10 w-10 shrink-0 place-items-center rounded-md"
              :class="readiness?.canClose ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'"
            >
              <CheckCircle2 v-if="readiness?.canClose" class="h-5 w-5" />
              <AlertTriangle v-else class="h-5 w-5" />
            </div>
          </div>
          <div class="mt-4 space-y-2 text-sm">
            <div class="flex items-center justify-between">
              <span>Missing required docs</span>
              <strong>{{ readiness?.missingDocumentCategories.length ?? 0 }}</strong>
            </div>
            <div class="flex items-center justify-between">
              <span>Open tasks</span>
              <strong>{{ readiness?.openTasks.length ?? 0 }}</strong>
            </div>
          </div>
        </template>
        <div v-else>
          <h2 class="font-semibold">{{ template.personalArchive ? "Archive overview" : "Global document browser" }}</h2>
          <p class="mt-1 text-sm text-ink-500">
            {{ template.personalArchive
              ? "Search private files by name, category, notes, review state, date, and tags."
              : `Search across all ${labels.lowerPlural}, customers, categories, review states, and tags without first opening a specific record.` }}
          </p>
          <div class="mt-4 grid gap-2 text-sm">
            <div class="flex items-center justify-between">
              <span>Total matching records</span>
              <strong>{{ totalDocuments }}</strong>
            </div>
            <div class="flex items-center justify-between">
              <span>Matching filters</span>
              <strong>{{ filteredDocuments.length }}</strong>
            </div>
            <div class="flex items-center justify-between">
              <span>Needs review</span>
              <strong>{{ reviewAttentionCount }}</strong>
            </div>
          </div>
        </div>
      </div>
    </section>

  <section
    class="overflow-hidden transition"
    :class="[
      template.personalArchive ? '' : 'panel',
      template.personalArchive && archiveFolderDropTargetId !== null ? 'bg-accent-50/30 ring-2 ring-inset ring-accent-300' : ''
    ]"
    @dragover="template.personalArchive && onArchiveCurrentViewDragOver($event)"
    @dragleave="template.personalArchive && clearArchiveFolderDropTarget()"
    @drop="template.personalArchive && onArchiveCurrentViewDrop($event)"
  >
    <div class="overflow-x-auto">
      <table
        class="w-full text-left text-sm"
        :class="template.personalArchive ? 'archive-browser-table table-fixed' : 'min-w-[1280px]'"
        :style="template.personalArchive ? { minWidth: `${archiveTableMinWidth}px` } : undefined"
      >
        <colgroup v-if="template.personalArchive">
          <col class="archive-browser-col-select" />
          <col class="archive-browser-col-file" />
          <col v-if="isArchiveColumnVisible('fileType')" class="archive-browser-col-type" />
          <col v-if="isArchiveColumnVisible('location')" class="archive-browser-col-location" />
          <col v-if="isArchiveColumnVisible('category')" class="archive-browser-col-category" />
          <col v-if="isArchiveColumnVisible('review')" class="archive-browser-col-review" />
          <col v-if="isArchiveColumnVisible('size')" class="archive-browser-col-size" />
          <col v-if="isArchiveColumnVisible('uploaded')" class="archive-browser-col-uploaded" />
          <col class="archive-browser-col-actions" />
        </colgroup>
        <thead class="archive-browser-table-head text-xs uppercase">
          <tr>
            <th class="px-5 py-3">
              <input type="checkbox" :checked="currentPageAllSelected" @change="toggleCurrentPageSelection" />
            </th>
            <th class="px-5 py-3">
              <button v-if="template.personalArchive" class="inline-flex items-center gap-1 hover:text-accent-900" type="button" title="Sort by file name" @click="sortDocumentsFromColumn('fileName')">
                File <component :is="documentSortField === 'fileName' ? documentSortIcon : ArrowUpDown" class="h-3.5 w-3.5" />
              </button>
              <span v-else>File</span>
            </th>
            <th v-if="template.personalArchive && isArchiveColumnVisible('fileType')" class="px-4 py-3"><button class="inline-flex items-center gap-1 hover:text-accent-900" type="button" title="Sort by file type" @click="sortDocumentsFromColumn('fileType')">Type <component :is="documentSortField === 'fileType' ? documentSortIcon : ArrowUpDown" class="h-3.5 w-3.5" /></button></th>
            <th v-if="!template.personalArchive" class="px-5 py-3">{{ labels.singular }}</th>
            <th v-if="!template.personalArchive" class="px-5 py-3">Customer</th>
            <th v-if="template.personalArchive && isArchiveColumnVisible('location')" class="px-4 py-3"><button class="inline-flex items-center gap-1 hover:text-accent-900" type="button" title="Sort by folder location" @click="sortDocumentsFromColumn('folder')">Location <component :is="documentSortField === 'folder' ? documentSortIcon : ArrowUpDown" class="h-3.5 w-3.5" /></button></th>
            <th v-if="!template.personalArchive || isArchiveColumnVisible('category')" class="px-4 py-3">
              <button v-if="template.personalArchive" class="inline-flex items-center gap-1 hover:text-accent-900" type="button" title="Sort by category" @click="sortDocumentsFromColumn('category')">Category <component :is="documentSortField === 'category' ? documentSortIcon : ArrowUpDown" class="h-3.5 w-3.5" /></button>
              <span v-else>Category</span>
            </th>
            <th v-if="!template.personalArchive || isArchiveColumnVisible('review')" class="px-4 py-3">
              <button v-if="template.personalArchive" class="inline-flex items-center gap-1 hover:text-accent-900" type="button" title="Sort by review status" @click="sortDocumentsFromColumn('reviewStatus')">Review <component :is="documentSortField === 'reviewStatus' ? documentSortIcon : ArrowUpDown" class="h-3.5 w-3.5" /></button>
              <span v-else>Review</span>
            </th>
            <th v-if="!template.personalArchive || isArchiveColumnVisible('size')" class="px-4 py-3">
              <button v-if="template.personalArchive" class="inline-flex items-center gap-1 hover:text-accent-900" type="button" title="Sort by file size" @click="sortDocumentsFromColumn('fileSize')">Size <component :is="documentSortField === 'fileSize' ? documentSortIcon : ArrowUpDown" class="h-3.5 w-3.5" /></button>
              <span v-else>Size</span>
            </th>
            <th v-if="!template.personalArchive || isArchiveColumnVisible('uploaded')" class="px-4 py-3">
              <button v-if="template.personalArchive" class="inline-flex items-center gap-1 hover:text-accent-900" type="button" title="Sort by upload date" @click="sortDocumentsFromColumn('uploaded')">Uploaded <component :is="documentSortField === 'uploaded' ? documentSortIcon : ArrowUpDown" class="h-3.5 w-3.5" /></button>
              <span v-else>Uploaded</span>
            </th>
            <th class="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-ink-100">
          <tr v-for="folder in trashedArchiveRoots" :key="folder.folderId" class="archive-browser-folder-row">
            <td class="px-5 py-3"></td>
            <td class="px-5 py-3" colspan="8">
              <div class="flex items-center gap-3">
                <FolderOpen class="h-5 w-5 shrink-0 text-ink-500" />
                <div class="min-w-0 flex-1">
                  <p class="truncate font-semibold">{{ folder.name }}</p>
                  <p class="text-xs text-ink-500">Deleted folder tree · {{ formatDateTime(folder.deletedAt!) }}</p>
                </div>
                <button class="btn-secondary h-8 px-2.5 text-xs" type="button" :disabled="!auth.canEditDocuments" @click="openRestoreArchiveFolder(folder)"><RotateCcw class="h-3.5 w-3.5" /> Restore folder</button>
              </div>
            </td>
          </tr>
          <tr v-for="folder in currentArchiveChildFolders" :key="folder.folderId" class="archive-browser-folder-row">
            <td class="px-5 py-3"></td>
            <td class="px-5 py-3" :colspan="template.personalArchive ? archiveFolderRowColspan : 8">
              <div class="flex items-center gap-3">
                <button class="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-accent-50 text-accent-800" type="button" @click="selectArchiveFolder(folder.folderId)"><FolderOpen class="h-5 w-5" /></button>
                <button class="min-w-0 flex-1 truncate text-left font-semibold text-ink-800 hover:text-accent-900 hover:underline" type="button" @click="selectArchiveFolder(folder.folderId)">{{ folder.name }}</button>
                <span class="text-xs text-ink-400">{{ folder.fileCount }} files</span>
                <button v-if="auth.canEditDocuments" class="grid h-8 w-8 place-items-center rounded-md text-ink-400 hover:bg-white hover:text-accent-800" type="button" aria-label="Edit metadata for files in this folder" title="Edit files metadata" @click="openArchiveFolderMetadataEditor(folder)"><SlidersHorizontal class="h-3.5 w-3.5" /></button>
                <button v-if="auth.canEditDocuments" class="grid h-8 w-8 place-items-center rounded-md text-ink-400 hover:bg-white hover:text-ink-800" type="button" title="Rename or move folder" @click="openRenameArchiveFolder(folder)"><Edit3 class="h-3.5 w-3.5" /></button>
                <button v-if="auth.canDeleteDocuments" class="grid h-8 w-8 place-items-center rounded-md text-ink-400 hover:bg-red-50 hover:text-red-700" type="button" title="Delete folder and contents" @click="openDeleteArchiveFolder(folder)"><Trash2 class="h-3.5 w-3.5" /></button>
              </div>
            </td>
          </tr>
          <tr v-for="document in filteredDocuments" :key="document.documentId" :draggable="template.personalArchive && archiveLocationMode !== 'trash'" class="archive-browser-document-row" @dragstart="onArchiveDocumentDragStart($event, document)">
            <td class="px-5 py-4 align-top">
              <input
                type="checkbox"
                :checked="selectedDocumentIds.includes(document.documentId)"
                @change="toggleDocumentSelection(document.documentId)"
              />
            </td>
            <td class="px-5 py-4">
              <div class="flex items-start gap-3">
                <div class="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-accent-50 text-accent-800">
                  <FileText class="h-5 w-5" />
                </div>
                <div class="min-w-0">
                  <button class="block max-w-full truncate text-left font-semibold text-accent-800 hover:underline" type="button" :disabled="archiveLocationMode === 'trash'" @click="openDocumentDetail(document)">
                    {{ document.originalFileName }}
                  </button>
                  <p class="mt-1 text-xs font-semibold text-ink-400">Version {{ document.versionNumber ?? 1 }}</p>
                  <p class="mt-1 text-xs text-ink-500">{{ document.notes || "No notes" }}</p>
                  <div v-if="document.tags.length" class="mt-2 flex flex-wrap gap-1.5">
                    <span
                      v-for="tag in document.tags"
                      :key="tag.tagId"
                      class="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
                      :style="{ backgroundColor: tag.color }"
                    >
                      {{ tag.name }}
                    </span>
                  </div>
                </div>
              </div>
            </td>
            <td v-if="template.personalArchive && isArchiveColumnVisible('fileType')" class="px-4 py-4 font-semibold uppercase text-ink-500">{{ fileTypeLabel(document.originalFileName, document.mimeType) }}</td>
            <td v-if="!template.personalArchive" class="px-5 py-4">
              <RouterLink v-if="document.caseId && caseForDocument(document)" class="font-semibold text-accent-700 hover:text-accent-900" :to="workItemPath(document.caseId)">
                {{ caseForDocument(document)?.caseNumber }}
              </RouterLink>
              <p v-else class="font-semibold text-ink-500">Unlinked</p>
              <p class="mt-1 max-w-[220px] truncate text-xs text-ink-500">{{ caseForDocument(document)?.propertyAddress ?? "Discussion attachment" }}</p>
            </td>
            <td v-if="!template.personalArchive" class="px-5 py-4">
              <span class="max-w-[220px] truncate text-ink-700">{{ caseForDocument(document)?.customerOrganizationName || "No customer" }}</span>
            </td>
            <td v-if="template.personalArchive && isArchiveColumnVisible('location')" class="px-4 py-4 text-ink-500">{{ document.folderName || "Unfiled" }}</td>
            <td v-if="!template.personalArchive || isArchiveColumnVisible('category')" class="px-4 py-4">{{ document.category }}</td>
            <td v-if="!template.personalArchive || isArchiveColumnVisible('review')" class="px-4 py-4">
              <span
                class="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
                :class="DOCUMENT_REVIEW_CLASSES[document.reviewStatus]"
              >
                {{ documentReviewLabel(document.reviewStatus) }}
              </span>
              <p v-if="document.reviewNotes" class="mt-1 max-w-[220px] truncate text-xs text-ink-500">{{ document.reviewNotes }}</p>
            </td>
            <td v-if="!template.personalArchive || isArchiveColumnVisible('size')" class="px-4 py-4">{{ formatFileSize(document.fileSize) }}</td>
            <td v-if="!template.personalArchive || isArchiveColumnVisible('uploaded')" class="px-4 py-4">
              <p>{{ formatDateTime(document.uploadedAt) }}</p>
              <p class="text-xs text-ink-500">{{ document.uploadedByName }}</p>
            </td>
            <td class="archive-browser-actions-cell px-4 py-4">
              <div v-if="archiveLocationMode === 'trash'" class="archive-browser-row-actions flex justify-end gap-2">
                <button class="btn-secondary h-8 px-2.5 text-xs" type="button" :disabled="!auth.canEditDocuments" @click="restoreArchivedDocument(document)"><RotateCcw class="h-3.5 w-3.5" /> Restore</button>
                <button class="btn-secondary h-8 px-2.5 text-xs text-red-700" type="button" :disabled="!auth.canDeleteDocuments" @click="purgeArchivedDocument(document)"><Trash2 class="h-3.5 w-3.5" /> Delete forever</button>
              </div>
              <div v-else class="archive-browser-row-actions flex justify-end gap-1.5">
                <RouterLink
                  v-if="template.personalArchive && canReadDocument(document)"
                  class="btn-secondary h-8 w-8 shrink-0 p-0"
                  :to="{ path: `/reader/${document.documentId}`, state: { archiveReaderReturn: route.fullPath } }"
                  aria-label="Read file"
                  title="Read"
                >
                  <BookOpen class="h-4 w-4" />
                </RouterLink>
                <button
                  v-if="template.personalArchive && isAudioPreviewFile(document.mimeType, document.originalFileName)"
                  class="btn-secondary h-8 w-8 shrink-0 p-0"
                  type="button"
                  aria-label="Play from this track"
                  title="Play from this track"
                  @click="startArchiveAudioPlayback(document)"
                >
                  <Play class="h-4 w-4" />
                </button>
                <button class="btn-secondary h-8 px-2.5 text-xs" type="button" @click="openDocumentDetail(document)">
                  <Eye class="h-4 w-4" />
                  Details
                </button>
                <a class="btn-secondary h-8 px-2.5 text-xs" :href="`/api/documents/${document.documentId}/download`" aria-label="Download file" title="Download">
                  <Download class="h-4 w-4" />
                </a>
                <button
                  class="btn-secondary h-8 px-2.5 text-xs text-red-700"
                  type="button"
                  aria-label="Move file to trash"
                  title="Move to trash"
                  :disabled="!auth.canDeleteDocuments"
                  @click="deleteDocument(document)"
                >
                  <Trash2 class="h-4 w-4" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="documentsLoading" class="px-5 py-8 text-sm text-ink-500">Loading documents...</p>
      <p v-else-if="!filteredDocuments.length && !currentArchiveChildFolders.length && !trashedArchiveRoots.length" class="px-5 py-10 text-center text-sm text-ink-500">{{ archiveLocationMode === 'trash' ? 'Archive trash is empty.' : 'No documents match the current view.' }}</p>
    </div>
  </section>

  <div v-if="!documentsLoading" class="flex flex-wrap items-center justify-between gap-3 border-t border-ink-200 px-4 py-3 text-sm" :class="template.personalArchive ? '' : 'mt-4 rounded-lg border'">
    <p class="text-ink-500">Page {{ page }} of {{ totalPages }} · {{ totalDocuments }} {{ totalDocuments === 1 ? "document" : "documents" }}</p>
    <div class="flex items-center gap-2">
      <select v-model.number="pageSize" class="input h-9 w-28 py-1">
        <option :value="10">10 / page</option>
        <option :value="25">25 / page</option>
        <option :value="50">50 / page</option>
        <option :value="100">100 / page</option>
      </select>
      <button class="btn-secondary h-9 px-3" type="button" :disabled="page <= 1" @click="page--; loadDocuments()">Previous</button>
      <button class="btn-secondary h-9 px-3" type="button" :disabled="page >= totalPages" @click="page++; loadDocuments()">Next</button>
    </div>
  </div>
      </div>
    </div>

  <DocumentDetailDrawer
    :model-value="showDocumentDetail"
    :document="selectedDocument"
    :available-tags="tags"
    :document-categories="availableDocumentCategories"
    :archive-folders="archiveFolders"
    :show-archive-location="template.personalArchive"
    :can-edit="auth.canEditDocuments"
    :saving="savingDocument"
    :error="documentFormError"
    :versions="documentVersions"
    :uploading-version="uploadingDocumentVersion"
    :version-error="documentVersionError"
    :image-sequence="archiveImageSequence"
    :image-sequence-loading="archiveImageSequenceLoading"
    @update:model-value="setDocumentDetailOpen"
    @save="saveDocumentMetadata"
    @upload-version="uploadDocumentVersion"
    @navigate-image="navigateArchiveImage"
    @play-audio="startArchiveAudioPlayback"
  />

  <div v-if="showArchiveUpload" class="fixed inset-0 z-50 grid place-items-center bg-ink-900/45 p-4" @mousedown.self="showArchiveUpload = false">
    <form class="panel max-h-[90vh] w-full max-w-2xl overflow-y-auto p-5" @submit.prevent="uploadArchiveDocuments">
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-accent-800">Private archive</p>
          <h2 class="mt-1 text-xl font-semibold">Add files or folders</h2>
          <p class="mt-1 text-sm text-ink-500">Import individual files or preserve the complete structure of a folder.</p>
        </div>
        <button class="btn-secondary h-9 px-3" type="button" @click="showArchiveUpload = false"><X class="h-4 w-4" /></button>
      </div>

      <div
        class="mt-5 grid min-h-36 place-items-center rounded-lg border border-dashed p-6 text-center transition duration-150"
        :class="archiveUploadDragging
          ? 'border-accent-700 bg-accent-100 text-accent-950 ring-2 ring-accent-100'
          : 'border-accent-300 bg-accent-50/50 hover:border-accent-500 hover:bg-accent-50'"
        @dragenter.prevent.stop="onArchiveUploadDragEnter"
        @dragover.prevent.stop="onArchiveUploadDragOver"
        @dragleave.prevent.stop="onArchiveUploadDragLeave"
        @drop.prevent.stop="onArchiveUploadDrop"
      >
        <span>
          <UploadCloud class="mx-auto h-7 w-7 text-accent-800 transition-transform duration-150" :class="archiveUploadDragging ? 'scale-110' : ''" />
          <span class="mt-3 block font-semibold">
            {{ archiveUploadScanning ? 'Reading folder…' : archiveUploadDragging ? 'Drop files or folders to import them' : 'Choose files or drag files and folders here' }}
          </span>
          <span class="mt-1 block text-sm" :class="archiveUploadDragging ? 'text-accent-900' : 'text-ink-500'">
            {{ archiveUploadDragging ? 'The original folder structure will be preserved' : 'PDF, EPUB, text, images, office files, audio, video, or archives' }}
          </span>
          <span class="mt-3 flex flex-wrap justify-center gap-2">
            <button
              class="btn-secondary h-9 px-3"
              type="button"
              :disabled="uploadingArchiveDocuments || archiveUploadScanning"
              @click="archiveUploadInput?.click()"
            >
              <FileText class="h-4 w-4" /> Choose files
            </button>
            <button
              class="btn-secondary h-9 px-3"
              type="button"
              :disabled="uploadingArchiveDocuments || archiveUploadScanning"
              @click="archiveUploadDirectoryInput?.click()"
            >
              <FolderPlus class="h-4 w-4" /> Choose folder
            </button>
          </span>
        </span>
        <input ref="archiveUploadInput" class="sr-only" type="file" multiple :disabled="uploadingArchiveDocuments || archiveUploadScanning" @change="selectArchiveUploadFiles" />
        <input
          ref="archiveUploadDirectoryInput"
          class="sr-only"
          type="file"
          multiple
          webkitdirectory
          directory
          :disabled="uploadingArchiveDocuments || archiveUploadScanning"
          @change="selectArchiveUploadDirectory"
        />
      </div>
      <div v-if="archiveUploadFiles.length || archiveUploadFolderPaths.length" class="mt-3 rounded-md border border-ink-200 bg-white">
        <div class="flex items-center justify-between gap-3 border-b border-ink-100 px-3 py-2">
          <p class="text-xs font-semibold uppercase tracking-wide text-ink-500">
            {{ archiveUploadFiles.length }} {{ archiveUploadFiles.length === 1 ? 'file' : 'files' }}
            <span v-if="archiveUploadFolderCount"> · {{ archiveUploadFolderCount }} {{ archiveUploadFolderCount === 1 ? 'folder' : 'folders' }}</span>
            ready
          </p>
          <button class="text-xs font-semibold text-ink-500 transition hover:text-legal-red" type="button" @click="clearArchiveUploadFiles">Clear</button>
        </div>
        <div class="divide-y divide-ink-100 px-3">
          <div v-for="(item, index) in archiveUploadVisibleFiles" :key="archiveFileIdentity(item)" class="flex items-center gap-3 py-2 text-sm">
            <span class="min-w-0 flex-1 truncate font-semibold" :title="item.relativePath">{{ item.relativePath }}</span>
            <span class="shrink-0 text-ink-500">{{ formatFileSize(item.file.size) }}</span>
            <button class="grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-400 transition hover:bg-red-50 hover:text-legal-red" type="button" :aria-label="`Remove ${item.relativePath}`" @click="removeArchiveUploadFile(index)"><X class="h-3.5 w-3.5" /></button>
          </div>
          <p v-if="archiveUploadFiles.length > archiveUploadVisibleFiles.length" class="py-2 text-xs font-semibold text-ink-500">
            {{ archiveUploadFiles.length - archiveUploadVisibleFiles.length }} more files will also be imported.
          </p>
          <p v-if="!archiveUploadFiles.length && archiveUploadFolderPaths.length" class="py-3 text-sm text-ink-500">
            Empty folder structure will be created without uploading files.
          </p>
        </div>
      </div>

      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <label>
          <span class="mb-1 block text-xs font-semibold uppercase text-ink-500">Folder</span>
          <select v-model="archiveUploadFolderId" class="input">
            <option :value="null">My archive / Unfiled</option>
            <option v-for="folder in archiveFolderSelectOptions" :key="folder.folderId" :value="folder.folderId">{{ folder.label }}</option>
          </select>
        </label>
        <label>
          <span class="mb-1 block text-xs font-semibold uppercase text-ink-500">Category</span>
          <select v-model="archiveUploadCategory" class="input">
            <option v-for="category in availableDocumentCategories" :key="category" :value="category">{{ category }}</option>
          </select>
        </label>
        <fieldset class="md:col-span-2">
          <legend class="mb-1 text-xs font-semibold uppercase text-ink-500">Tags</legend>
          <div class="flex min-h-11 flex-wrap gap-2 rounded-md border border-ink-200 bg-white px-3 py-2">
            <label v-for="tag in tags" :key="tag.tagId" class="inline-flex items-center gap-1.5 text-xs font-semibold">
              <input type="checkbox" :checked="archiveUploadTagIds.includes(tag.tagId)" @change="toggleArchiveUploadTag(tag.tagId, ($event.target as HTMLInputElement).checked)" />
              {{ tag.name }}
            </label>
            <span v-if="!tags.length" class="text-xs text-ink-500">No tags configured</span>
          </div>
        </fieldset>
        <label class="md:col-span-2">
          <span class="mb-1 block text-xs font-semibold uppercase text-ink-500">Notes</span>
          <textarea v-model="archiveUploadNotes" class="input min-h-24" placeholder="Source, date, household member, renewal context, or anything that helps you find it later." />
        </label>
      </div>
      <p v-if="archiveUploadError" class="mt-3 text-sm font-semibold text-legal-red">{{ archiveUploadError }}</p>
      <div class="mt-5 flex justify-end gap-2">
        <button class="btn-secondary" type="button" @click="showArchiveUpload = false">Cancel</button>
        <button
          class="btn-primary"
          type="submit"
          :disabled="(!archiveUploadFiles.length && !archiveUploadFolderPaths.length) || uploadingArchiveDocuments || archiveUploadScanning"
        >
          {{ uploadingArchiveDocuments ? archiveUploadProgress < 0 ? "Creating folders…" : `Importing ${archiveUploadProgress} of ${archiveUploadFiles.length}…` : archiveUploadFolderCount ? `Import ${archiveUploadFiles.length} files in ${archiveUploadFolderCount} folders` : `Add ${archiveUploadFiles.length || ""} ${archiveUploadFiles.length === 1 ? "file" : "files"}` }}
        </button>
      </div>
    </form>
  </div>

  <div v-if="archiveFolderPendingRestore" class="fixed inset-0 z-50 grid place-items-center bg-ink-900/45 p-4" @mousedown.self="!restoringArchiveFolder && (archiveFolderPendingRestore = null)" @keydown.esc.prevent.stop="!restoringArchiveFolder && (archiveFolderPendingRestore = null)">
    <form class="panel w-full max-w-md p-5" role="dialog" aria-modal="true" aria-labelledby="archive-folder-restore-title" @submit.prevent="restoreArchiveFolderTree">
      <h2 id="archive-folder-restore-title" class="text-xl font-semibold">Restore folder</h2>
      <p class="mt-2 text-sm leading-6 text-ink-500">Restore the folders and files removed together. Files already in trash before this folder was deleted stay in trash.</p>
      <label class="mt-4 block text-sm font-semibold">Folder name
        <input v-model="archiveRestoreName" class="input mt-1" maxlength="120" required autofocus :disabled="restoringArchiveFolder" />
      </label>
      <label class="mt-4 block text-sm font-semibold">Restore location
        <select v-model="archiveRestoreParent" class="input mt-1" :disabled="restoringArchiveFolder">
          <option value="__original__">Original location</option>
          <option value="">Archive root</option>
          <option v-for="folder in archiveFolderSelectOptions" :key="folder.folderId" :value="folder.folderId">{{ folder.label }}</option>
        </select>
      </label>
      <p v-if="archiveRestoreError" class="mt-3 text-sm text-red-700" role="alert">{{ archiveRestoreError }}</p>
      <div class="mt-5 flex justify-end gap-2">
        <button class="btn-secondary" type="button" :disabled="restoringArchiveFolder" @click="archiveFolderPendingRestore = null">Cancel</button>
        <button class="btn-primary" type="submit" :disabled="restoringArchiveFolder || !archiveRestoreName.trim()">{{ restoringArchiveFolder ? 'Restoring…' : 'Restore folder' }}</button>
      </div>
    </form>
  </div>

  <div v-if="showFolderEditor" class="fixed inset-0 z-50 grid place-items-center bg-ink-900/45 p-4" @mousedown.self="showFolderEditor = false">
    <form class="panel w-full max-w-md p-5" @submit.prevent="saveArchiveFolder">
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-accent-800">Archive folder</p>
          <h2 class="mt-1 text-xl font-semibold">{{ editingArchiveFolder ? 'Edit folder' : 'New folder' }}</h2>
        </div>
        <button class="btn-secondary h-9 px-3" type="button" @click="showFolderEditor = false"><X class="h-4 w-4" /></button>
      </div>
      <label class="mt-5 block text-sm font-semibold">
        Folder name
        <input v-model="archiveFolderName" class="input mt-1" maxlength="120" autofocus placeholder="Example: Family records" />
      </label>
      <label class="mt-4 block text-sm font-semibold">
        Parent folder
        <select v-model="archiveFolderParentId" class="input mt-1">
          <option :value="null">My archive (top level)</option>
          <option v-for="folder in archiveFolderParentOptions" :key="folder.folderId" :value="folder.folderId">{{ folder.label }}</option>
        </select>
      </label>
      <p class="mt-3 text-xs leading-5 text-ink-500">Folders can contain files and other folders. Drag files onto a folder in the left tree to move them.</p>
      <p v-if="archiveFolderError" class="mt-3 text-sm font-semibold text-legal-red">{{ archiveFolderError }}</p>
      <div class="mt-5 flex justify-end gap-2">
        <button class="btn-secondary" type="button" :disabled="savingArchiveFolder" @click="showFolderEditor = false">Cancel</button>
        <button class="btn-primary" type="submit" :disabled="!archiveFolderName.trim() || savingArchiveFolder">{{ savingArchiveFolder ? 'Saving...' : 'Save folder' }}</button>
      </div>
    </form>
  </div>

  <div v-if="archiveFolderMetadataTarget" class="fixed inset-0 z-50 grid place-items-center bg-ink-900/55 p-4" @mousedown.self="closeArchiveFolderMetadataEditor">
    <form class="panel max-h-[92vh] w-full max-w-2xl overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="archive-folder-metadata-title" @submit.prevent="saveArchiveFolderMetadata">
      <div class="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-ink-200 bg-white/95 px-5 py-4 backdrop-blur">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.12em] text-accent-800">Folder metadata</p>
          <h2 id="archive-folder-metadata-title" class="mt-1 text-xl font-semibold">Edit files in “{{ archiveFolderMetadataTarget.name }}”</h2>
          <p class="mt-1 text-sm text-ink-500">Only enabled fields will replace existing metadata.</p>
        </div>
        <button class="btn-secondary h-9 w-9 shrink-0 p-0" type="button" aria-label="Close metadata editor" title="Close" :disabled="archiveFolderMetadataSaving" @click="closeArchiveFolderMetadataEditor"><X class="h-4 w-4" /></button>
      </div>

      <div class="px-5 py-4">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 pb-4">
          <label class="inline-flex items-center gap-2 text-sm font-semibold text-ink-700">
            <input v-model="archiveFolderMetadataIncludeSubfolders" type="checkbox" /> Include subfolders
          </label>
          <p class="text-sm text-ink-500">
            <strong class="text-ink-800">{{ archiveFolderMetadataImpact.fileCount }}</strong>
            {{ archiveFolderMetadataImpact.fileCount === 1 ? 'file' : 'files' }} in
            <strong class="text-ink-800">{{ archiveFolderMetadataImpact.folderCount }}</strong>
            {{ archiveFolderMetadataImpact.folderCount === 1 ? 'folder' : 'folders' }}
          </p>
        </div>

        <div class="divide-y divide-ink-200">
          <div class="grid gap-3 py-4 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-center">
            <label class="inline-flex items-center gap-2 text-sm font-semibold"><input v-model="archiveFolderMetadataApplyCategory" type="checkbox" /> Category</label>
            <select v-model="archiveFolderMetadataCategory" class="input" :disabled="!archiveFolderMetadataApplyCategory">
              <option v-for="category in availableDocumentCategories" :key="category" :value="category">{{ category }}</option>
            </select>
          </div>

          <div class="grid gap-3 py-4 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-center">
            <label class="inline-flex items-center gap-2 text-sm font-semibold"><input v-model="archiveFolderMetadataApplyReviewStatus" type="checkbox" /> Review status</label>
            <select v-model="archiveFolderMetadataReviewStatus" class="input" :disabled="!archiveFolderMetadataApplyReviewStatus">
              <option v-for="option in documentReviewOptions" :key="option.status" :value="option.status">{{ option.label }}</option>
            </select>
          </div>

          <div class="grid gap-3 py-4 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-start">
            <label class="inline-flex items-center gap-2 pt-2 text-sm font-semibold"><input v-model="archiveFolderMetadataApplyTags" type="checkbox" /> Tags</label>
            <fieldset class="flex min-h-11 flex-wrap gap-2 rounded-md border border-ink-200 bg-white px-3 py-2 disabled:opacity-50" :disabled="!archiveFolderMetadataApplyTags">
              <label v-for="tag in tags" :key="tag.tagId" class="inline-flex items-center gap-1.5 text-xs font-semibold">
                <input type="checkbox" :checked="archiveFolderMetadataTagIds.includes(tag.tagId)" @change="toggleArchiveFolderMetadataTag(tag.tagId, ($event.target as HTMLInputElement).checked)" />
                <span class="h-2.5 w-2.5 rounded-full" :style="{ backgroundColor: tag.color }"></span>{{ tag.name }}
              </label>
              <span v-if="!tags.length" class="text-xs text-ink-500">No tags configured. Enable this field to clear existing tags.</span>
            </fieldset>
            <p class="text-xs text-ink-500 sm:col-start-2">Enabling Tags replaces the complete tag set. Leave every tag unchecked to clear tags.</p>
          </div>

          <div class="grid gap-3 py-4 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-start">
            <label class="inline-flex items-center gap-2 pt-2 text-sm font-semibold"><input v-model="archiveFolderMetadataApplyNotes" type="checkbox" /> Notes</label>
            <div>
              <textarea v-model="archiveFolderMetadataNotes" class="input min-h-24 py-2" maxlength="12000" :disabled="!archiveFolderMetadataApplyNotes" placeholder="Shared notes for every file in this folder scope" />
              <p class="mt-1 text-xs text-ink-500">An enabled empty field clears existing notes.</p>
            </div>
          </div>

          <div class="grid gap-3 py-4 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-start">
            <label class="inline-flex items-center gap-2 pt-2 text-sm font-semibold"><input v-model="archiveFolderMetadataApplyReviewNotes" type="checkbox" /> Review notes</label>
            <div>
              <textarea v-model="archiveFolderMetadataReviewNotes" class="input min-h-24 py-2" maxlength="12000" :disabled="!archiveFolderMetadataApplyReviewNotes" placeholder="Shared review note for every file in this folder scope" />
              <p class="mt-1 text-xs text-ink-500">An enabled empty field clears existing review notes.</p>
            </div>
          </div>
        </div>

        <p v-if="archiveFolderMetadataError" class="mt-3 text-sm font-semibold text-legal-red">{{ archiveFolderMetadataError }}</p>
      </div>

      <div class="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-ink-200 bg-white/95 px-5 py-4 backdrop-blur">
        <p class="text-xs text-ink-500">Existing values remain unchanged for every disabled field.</p>
        <div class="ml-auto flex gap-2">
          <button class="btn-secondary" type="button" :disabled="archiveFolderMetadataSaving" @click="closeArchiveFolderMetadataEditor">Cancel</button>
          <button class="btn-primary" type="submit" :disabled="!archiveFolderMetadataHasChanges || !archiveFolderMetadataImpact.fileCount || archiveFolderMetadataSaving">
            {{ archiveFolderMetadataSaving ? 'Applying…' : `Apply to ${archiveFolderMetadataImpact.fileCount} ${archiveFolderMetadataImpact.fileCount === 1 ? 'file' : 'files'}` }}
          </button>
        </div>
      </div>
    </form>
  </div>

  <div v-if="archiveFolderPendingDeletion" class="fixed inset-0 z-50 grid place-items-center bg-ink-900/55 p-4" @mousedown.self="closeDeleteArchiveFolder">
    <section class="panel w-full max-w-md overflow-hidden" role="alertdialog" aria-modal="true" aria-labelledby="archive-folder-delete-title">
      <div class="flex items-start gap-3 border-b border-red-100 bg-red-50/80 px-5 py-4">
        <div class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-100 text-red-700"><AlertTriangle class="h-5 w-5" /></div>
        <div class="min-w-0 flex-1">
          <p class="text-xs font-semibold uppercase tracking-[0.12em] text-red-700">Recursive delete</p>
          <h2 id="archive-folder-delete-title" class="mt-1 text-xl font-semibold text-ink-900">Delete “{{ archiveFolderPendingDeletion.name }}” and its contents?</h2>
        </div>
      </div>
      <div class="px-5 py-4">
        <p class="text-sm leading-6 text-ink-600">
          This moves the folder and all {{ archiveFolderDeleteImpact.subfolderCount }}
          {{ archiveFolderDeleteImpact.subfolderCount === 1 ? 'subfolder' : 'subfolders' }} inside it to Archive trash.
          {{ archiveFolderDeleteImpact.fileCount }} {{ archiveFolderDeleteImpact.fileCount === 1 ? 'file' : 'files' }} will move to Archive trash.
        </p>
        <div class="mt-4 grid grid-cols-2 divide-x divide-ink-200 rounded-lg border border-ink-200 bg-ink-50 py-3 text-center">
          <div><strong class="block text-lg tabular-nums text-ink-900">{{ archiveFolderDeleteImpact.folderCount }}</strong><span class="text-xs text-ink-500">Folders moved to trash</span></div>
          <div><strong class="block text-lg tabular-nums text-ink-900">{{ archiveFolderDeleteImpact.fileCount }}</strong><span class="text-xs text-ink-500">Files moved to trash</span></div>
        </div>
        <p class="mt-3 text-xs leading-5 text-ink-500">Restore the folder from Archive trash to recover its structure and files together.</p>
        <p v-if="archiveFolderDeleteError" class="mt-3 text-sm font-semibold text-legal-red">{{ archiveFolderDeleteError }}</p>
      </div>
      <div class="flex justify-end gap-2 border-t border-ink-100 px-5 py-4">
        <button class="btn-secondary" type="button" :disabled="deletingArchiveFolder" @click="closeDeleteArchiveFolder">Cancel</button>
        <button class="inline-flex h-10 items-center gap-2 rounded-md bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60" type="button" :disabled="deletingArchiveFolder" @click="confirmDeleteArchiveFolder">
          <Trash2 class="h-4 w-4" />{{ deletingArchiveFolder ? 'Deleting…' : 'Delete folder and contents' }}
        </button>
      </div>
    </section>
  </div>

  <div v-if="showCategoryManager" class="fixed inset-0 z-50 grid place-items-center bg-ink-900/45 p-4" @mousedown.self="showCategoryManager = false">
    <section class="panel max-h-[88vh] w-full max-w-2xl overflow-y-auto p-5">
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-accent-800">Archive classification</p>
          <h2 class="mt-1 text-xl font-semibold">Manage categories</h2>
          <p class="mt-1 text-sm text-ink-500">Rename, order, add, or merge categories. Files keep their category when its label is renamed.</p>
        </div>
        <button class="btn-secondary h-9 px-3" type="button" @click="showCategoryManager = false"><X class="h-4 w-4" /></button>
      </div>

      <form class="mt-5 flex gap-2 border-b border-ink-200 pb-4" @submit.prevent="createArchiveCategory">
        <input v-model="newArchiveCategoryName" class="input min-w-0 flex-1" maxlength="80" placeholder="New category name" />
        <button class="btn-primary shrink-0" type="submit" :disabled="!newArchiveCategoryName.trim() || savingArchiveCategoryId === 'new'"><Plus class="h-4 w-4" /> Add</button>
      </form>

      <div class="divide-y divide-ink-100">
        <div v-for="(category, index) in archiveCategories" :key="category.categoryId" class="grid items-center gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <div class="min-w-0">
            <input v-model="archiveCategoryDrafts[category.categoryId]" class="input h-9 text-sm" maxlength="80" @keyup.enter="saveArchiveCategory(category)" />
            <p class="mt-1 text-xs text-ink-400">{{ category.fileCount }} {{ category.fileCount === 1 ? 'file' : 'files' }}{{ category.isSystem ? ' · default category' : '' }}</p>
          </div>
          <div class="flex items-center gap-1">
            <button class="grid h-8 w-8 place-items-center rounded-md border border-ink-200 text-ink-500 hover:bg-ink-50" type="button" title="Move up" :disabled="index === 0 || savingArchiveCategoryId === category.categoryId" @click="moveArchiveCategory(category, -1)"><ArrowUp class="h-3.5 w-3.5" /></button>
            <button class="grid h-8 w-8 place-items-center rounded-md border border-ink-200 text-ink-500 hover:bg-ink-50" type="button" title="Move down" :disabled="index === archiveCategories.length - 1 || savingArchiveCategoryId === category.categoryId" @click="moveArchiveCategory(category, 1)"><ArrowDown class="h-3.5 w-3.5" /></button>
          </div>
          <div class="flex items-center justify-end gap-1">
            <button class="btn-secondary h-8 px-2.5 text-xs" type="button" :disabled="!archiveCategoryDrafts[category.categoryId]?.trim() || archiveCategoryDrafts[category.categoryId]?.trim() === category.name || savingArchiveCategoryId === category.categoryId" @click="saveArchiveCategory(category)">Save</button>
            <button class="grid h-8 w-8 place-items-center rounded-md text-ink-400 hover:bg-red-50 hover:text-red-700" type="button" :title="category.name === 'Other' ? 'Rename Other if you want to replace it' : 'Delete or merge category'" :disabled="archiveCategories.length <= 1 || category.name === 'Other'" @click="requestDeleteArchiveCategory(category)"><Trash2 class="h-3.5 w-3.5" /></button>
          </div>
        </div>
      </div>

      <div v-if="deletingArchiveCategory" class="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
        <h3 class="font-semibold text-red-900">Delete “{{ deletingArchiveCategory.name }}”?</h3>
        <p class="mt-1 text-sm text-red-800">{{ deletingArchiveCategory.fileCount ? `${deletingArchiveCategory.fileCount} files must be moved to another category first.` : 'This empty category can be deleted.' }}</p>
        <select v-if="deletingArchiveCategory.fileCount" v-model="replacementArchiveCategoryId" class="input mt-3">
          <option value="">Choose replacement category</option>
          <option v-for="category in archiveCategories.filter((item) => item.categoryId !== deletingArchiveCategory?.categoryId)" :key="category.categoryId" :value="category.categoryId">{{ category.name }}</option>
        </select>
        <div class="mt-3 flex justify-end gap-2">
          <button class="btn-secondary h-8 px-2.5 text-xs" type="button" @click="deletingArchiveCategory = null">Cancel</button>
          <button class="btn-secondary h-8 px-2.5 text-xs text-red-700" type="button" :disabled="Boolean(deletingArchiveCategory.fileCount && !replacementArchiveCategoryId) || savingArchiveCategoryId === deletingArchiveCategory.categoryId" @click="confirmDeleteArchiveCategory">Delete category</button>
        </div>
      </div>
      <p v-if="archiveCategoryError" class="mt-3 text-sm font-semibold text-legal-red">{{ archiveCategoryError }}</p>
    </section>
  </div>
  </template>
</template>
