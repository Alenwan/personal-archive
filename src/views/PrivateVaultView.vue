<script setup lang="ts">
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Expand,
  Eye,
  File,
  FileImage,
  FileVideo,
  Files,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  FolderUp,
  Grid2X2,
  Images,
  KeyRound,
  List,
  Lock,
  LockKeyhole,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Move,
  Pencil,
  Plus,
  RotateCcw,
  Scan,
  Search,
  ShieldCheck,
  Star,
  Tags,
  Trash2,
  Undo2,
  UploadCloud,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { client } from "../api/client";
import { useResizablePanel } from "../composables/useResizablePanel";
import {
  createPrivateVaultEncryption,
  createPrivateVaultPasswordMetadata,
  decryptPrivateVaultBlob,
  decryptPrivateVaultFolderMetadata,
  decryptPrivateVaultItemMetadata,
  encryptPrivateVaultFile,
  encryptPrivateVaultFolderMetadata,
  type PrivateVaultKey,
  unlockPrivateVault,
  updatePrivateVaultItemMetadata
} from "../shared/privateVaultEncryption";
import {
  comparePrivateVaultItems,
  createPrivateVaultImageSequence,
  privateVaultSortLabel,
  type PrivateVaultSortDirection,
  type PrivateVaultSortField
} from "../shared/privateVaultOrdering";
import type {
  PrivateVault,
  PrivateVaultFolder,
  PrivateVaultFolderMetadata,
  PrivateVaultItem,
  PrivateVaultItemMetadata
} from "../shared/types";
import { useToastStore } from "../stores/toasts";
import { useAuthStore } from "../stores/auth";
import { useBusinessTemplate } from "../businessTemplate";

interface DisplayVaultItem extends PrivateVaultItem {
  metadata: PrivateVaultItemMetadata | null;
  metadataError?: string;
}

interface DisplayVaultFolder extends PrivateVaultFolder {
  metadata: PrivateVaultFolderMetadata | null;
  metadataError?: string;
}

interface VaultFolderRow {
  folder: DisplayVaultFolder;
  depth: number;
  hasChildren: boolean;
}

interface MoveUndoState {
  items: Array<{ itemId: string; previousFolderId: string | null }>;
  label: string;
}

type PreviewKind = "image" | "video" | "pdf" | "text" | "download";
type VaultSmartView = "all" | "recent" | "favorites" | "images" | "documents" | "unfiled" | "tag" | "trash" | null;
type VaultViewMode = "list" | "grid";

interface VaultDirectoryHistoryState {
  smartView: VaultSmartView;
  folderId: string | null;
  selectedTag: string;
  search: string;
  sortField: PrivateVaultSortField;
  sortDirection: PrivateVaultSortDirection;
  viewMode: VaultViewMode;
}

interface VaultImagePreviewSession {
  itemIds: string[];
  locationLabel: string;
  sortField: PrivateVaultSortField;
  sortDirection: PrivateVaultSortDirection;
}

const VAULT_SORT_FIELDS: readonly PrivateVaultSortField[] = ["name", "location", "updated", "opened", "size", "type"];
const VAULT_DIRECTORY_HISTORY_STATE = "privateVaultDirectoryHistory";
const VAULT_PREVIEW_HISTORY_STATE = "privateVaultPreview";
const VAULT_SIDEBAR_WIDTH_STORAGE_KEY = "personal-archive.private-vault.sidebar-width";
const storedSortField = localStorage.getItem("personal-archive.private-vault.sort-field") as PrivateVaultSortField | null;
const storedSortDirection = localStorage.getItem("personal-archive.private-vault.sort-direction");

const toasts = useToastStore();
const auth = useAuthStore();
const { template } = useBusinessTemplate();
const canWriteVault = computed(() => auth.canMutate && !(template.value.personalArchive && auth.isReadOnly));
const route = useRoute();
const router = useRouter();
const vault = ref<PrivateVault | null>(null);
const vaultKey = shallowRef<PrivateVaultKey | null>(null);
const items = ref<DisplayVaultItem[]>([]);
const vaultFolders = ref<DisplayVaultFolder[]>([]);
const loading = ref(true);
const pageError = ref("");
const unlocking = ref(false);
const unlockPassword = ref("");
const createPassword = ref("");
const confirmCreatePassword = ref("");
const creating = ref(false);
const showReset = ref(false);
const resetAccountPassword = ref("");
const resetPassword = ref("");
const resetPasswordConfirm = ref("");
const resetting = ref(false);
const showPasswordChange = ref(false);
const nextPassword = ref("");
const nextPasswordConfirm = ref("");
const changingPassword = ref(false);
const showTrash = ref(false);
const search = ref("");
const smartView = ref<VaultSmartView>("all");
const selectedTag = ref("");
const currentFolderId = ref<string | null>(null);
const expandedFolderIds = ref<Set<string>>(new Set());
const selectedItemIds = ref<Set<string>>(new Set());
const lastSelectedItemId = ref<string | null>(null);
const sortField = ref<PrivateVaultSortField>(storedSortField && VAULT_SORT_FIELDS.includes(storedSortField) ? storedSortField : "name");
const sortDirection = ref<PrivateVaultSortDirection>(storedSortDirection === "desc" ? "desc" : "asc");
const dragging = ref(false);
const draggingItemIds = ref<string[]>([]);
const draggingFolderId = ref<string | null>(null);
const dragTargetFolderId = ref<string | null | undefined>(undefined);
const fileInput = ref<HTMLInputElement | null>(null);
const folderInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const uploadStatus = ref<{ name: string; index: number; total: number; progress: number } | null>(null);
const previewItem = ref<DisplayVaultItem | null>(null);
const previewKind = ref<PreviewKind>("download");
const previewUrl = ref("");
const previewText = ref("");
const previewVideoError = ref("");
const previewLoading = ref(false);
const previewImageSession = ref<VaultImagePreviewSession | null>(null);
const previewControlsVisible = ref(false);
const previewDialog = ref<HTMLElement | null>(null);
const previewImageScroller = ref<HTMLElement | null>(null);
const previewImageNaturalWidth = ref(0);
const previewImageNaturalHeight = ref(0);
const previewImageScale = ref(1);
const previewImageMode = ref<"width" | "fit" | "custom">("width");
const previewFullscreen = ref(false);
const editItem = ref<DisplayVaultItem | null>(null);
const editFileName = ref("");
const editFolderId = ref<string | null>(null);
const editNote = ref("");
const editTagsInput = ref("");
const savingMetadata = ref(false);
const showFolderDialog = ref(false);
const folderDialogMode = ref<"create" | "edit">("create");
const folderDialogTargetId = ref<string | null>(null);
const folderNameInput = ref("");
const folderParentInput = ref<string | null>(null);
const savingFolder = ref(false);
const showMoveDialog = ref(false);
const moveDestinationId = ref<string | null>(null);
const moveUndo = ref<MoveUndoState | null>(null);
const contextMenu = ref<{ kind: "item" | "folder"; id: string; x: number; y: number } | null>(null);
const secondsUntilLock = ref(0);
const unlockInput = ref<HTMLInputElement | null>(null);
const viewMode = ref<VaultViewMode>(localStorage.getItem("personal-archive.private-vault.view-mode") === "grid" ? "grid" : "list");
const vaultRouteReady = ref(false);
const {
  width: vaultSidebarWidth,
  minWidth: vaultSidebarMinWidth,
  maxWidth: vaultSidebarMaxWidth,
  resizing: vaultSidebarResizing,
  startResize: startVaultSidebarResize,
  resetWidth: resetVaultSidebarWidth,
  onSeparatorKeydown: onVaultSidebarResizeKeydown
} = useResizablePanel({
  storageKey: VAULT_SIDEBAR_WIDTH_STORAGE_KEY,
  defaultWidth: 248,
  minWidth: 216,
  maxWidth: 560
});

watch([sortField, sortDirection], ([field, direction]) => {
  localStorage.setItem("personal-archive.private-vault.sort-field", field);
  localStorage.setItem("personal-archive.private-vault.sort-direction", direction);
});

watch(
  [search, selectedTag, sortField, sortDirection, viewMode],
  rememberVaultDirectoryState,
  { flush: "post" }
);

watch(
  () => [route.query.vaultView, route.query.vaultFolder],
  syncVaultDirectoryFromRoute
);

watch(
  () => route.query.vaultItem,
  () => {
    void syncVaultPreviewFromRoute();
  }
);

let autoLockTimer: ReturnType<typeof setTimeout> | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;
let autoLockDeadline = 0;
let previewRequestVersion = 0;
let previewControlsTimer: ReturnType<typeof setTimeout> | null = null;
let moveUndoTimer: ReturnType<typeof setTimeout> | null = null;
const PRIVATE_VAULT_METADATA_BATCH_SIZE = 500;

const unlocked = computed(() => Boolean(vault.value && vaultKey.value));
const activeItems = computed(() => items.value.filter((item) => !item.deletedAt));
const activeFolders = computed(() => vaultFolders.value.filter((folder) => !folder.deletedAt && folder.metadata));
const folderById = computed(() => new Map(activeFolders.value.map((folder) => [folder.folderId, folder])));

function vaultDirectorySnapshot(): VaultDirectoryHistoryState {
  return {
    smartView: smartView.value,
    folderId: currentFolderId.value,
    selectedTag: selectedTag.value,
    search: search.value,
    sortField: sortField.value,
    sortDirection: sortDirection.value,
    viewMode: viewMode.value
  };
}

function isVaultDirectoryHistoryState(value: unknown): value is VaultDirectoryHistoryState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<VaultDirectoryHistoryState>;
  return (state.smartView === null || ["all", "recent", "favorites", "images", "documents", "unfiled", "tag", "trash"].includes(state.smartView ?? ""))
    && (typeof state.folderId === "string" || state.folderId === null)
    && typeof state.selectedTag === "string"
    && typeof state.search === "string"
    && VAULT_SORT_FIELDS.includes(state.sortField as PrivateVaultSortField)
    && (state.sortDirection === "asc" || state.sortDirection === "desc")
    && (state.viewMode === "list" || state.viewMode === "grid");
}

function vaultDirectoryStateFromRoute(): VaultDirectoryHistoryState {
  const storedValue = window.history.state?.[VAULT_DIRECTORY_HISTORY_STATE];
  let storedState: unknown;
  try {
    storedState = typeof storedValue === "string" ? JSON.parse(storedValue) : storedValue;
  } catch {
    storedState = null;
  }
  const base = isVaultDirectoryHistoryState(storedState) ? storedState : vaultDirectorySnapshot();
  const requestedFolderId = typeof route.query.vaultFolder === "string" ? route.query.vaultFolder : null;
  const requestedView = typeof route.query.vaultView === "string" ? route.query.vaultView : "all";
  if (requestedView === "folder") {
    return {
      ...base,
      smartView: null,
      folderId: requestedFolderId && folderById.value.has(requestedFolderId) ? requestedFolderId : null,
      selectedTag: ""
    };
  }
  const nextSmartView = ["all", "recent", "favorites", "images", "documents", "unfiled", "tag", "trash"].includes(requestedView)
    ? requestedView as Exclude<VaultSmartView, null>
    : "all";
  return {
    ...base,
    smartView: nextSmartView === "tag" && !base.selectedTag ? "all" : nextSmartView,
    folderId: null,
    selectedTag: nextSmartView === "tag" ? base.selectedTag : ""
  };
}

function vaultDirectoryQuery(state: VaultDirectoryHistoryState) {
  const query = { ...route.query };
  delete query.vaultView;
  delete query.vaultFolder;
  delete query.vaultItem;
  if (state.smartView === null) {
    query.vaultView = "folder";
    if (state.folderId) query.vaultFolder = state.folderId;
  } else if (state.smartView !== "all") {
    query.vaultView = state.smartView;
  }
  return query;
}

let applyingVaultDirectoryState = false;
let vaultDirectoryApplyVersion = 0;
async function applyVaultDirectoryState(state: VaultDirectoryHistoryState) {
  applyingVaultDirectoryState = true;
  const applyVersion = ++vaultDirectoryApplyVersion;
  const nextShowsTrash = state.smartView === "trash";
  const reloadForTrash = showTrash.value !== nextShowsTrash;
  contextMenu.value = null;
  clearSelection();
  showTrash.value = nextShowsTrash;
  smartView.value = state.smartView;
  currentFolderId.value = state.folderId;
  selectedTag.value = state.selectedTag;
  search.value = state.search;
  sortField.value = state.sortField;
  sortDirection.value = state.sortDirection;
  viewMode.value = state.viewMode;
  if (state.folderId) {
    for (const part of folderPath(state.folderId)) {
      expandedFolderIds.value = replaceSetValue(expandedFolderIds.value, part.folderId, true);
    }
  }
  if (reloadForTrash) {
    try {
      await reloadItems();
    } catch (error) {
      toasts.error("Files not loaded", error instanceof Error ? error.message : "Unable to load private files.");
    }
  }
  queueMicrotask(() => {
    if (vaultDirectoryApplyVersion === applyVersion) applyingVaultDirectoryState = false;
  });
}

function rememberVaultDirectoryState() {
  if (!vaultRouteReady.value || !unlocked.value || applyingVaultDirectoryState) return;
  window.history.replaceState({
    ...window.history.state,
    [VAULT_DIRECTORY_HISTORY_STATE]: JSON.stringify(vaultDirectorySnapshot())
  }, "");
}

function navigateVaultDirectory(state: VaultDirectoryHistoryState, replace = false) {
  void applyVaultDirectoryState(state);
  const location = {
    path: route.path,
    query: vaultDirectoryQuery(state),
    state: { [VAULT_DIRECTORY_HISTORY_STATE]: JSON.stringify(state) }
  };
  void (replace ? router.replace(location) : router.push(location));
}

function syncVaultDirectoryFromRoute() {
  if (!vaultRouteReady.value || !unlocked.value) return;
  void applyVaultDirectoryState(vaultDirectoryStateFromRoute());
}
const childFoldersByParent = computed(() => {
  const values = new Map<string | null, DisplayVaultFolder[]>();
  for (const folder of activeFolders.value) {
    const requestedParent = folder.metadata?.parentFolderId ?? null;
    const parent = requestedParent && folderById.value.has(requestedParent) ? requestedParent : null;
    const siblings = values.get(parent) ?? [];
    siblings.push(folder);
    values.set(parent, siblings);
  }
  for (const siblings of values.values()) {
    siblings.sort((left, right) => (left.metadata?.name ?? "").localeCompare(right.metadata?.name ?? ""));
  }
  return values;
});
const folderRows = computed<VaultFolderRow[]>(() => {
  const rows: VaultFolderRow[] = [];
  const visited = new Set<string>();
  const append = (parentFolderId: string | null, depth: number) => {
    for (const folder of childFoldersByParent.value.get(parentFolderId) ?? []) {
      if (visited.has(folder.folderId)) continue;
      visited.add(folder.folderId);
      const children = childFoldersByParent.value.get(folder.folderId) ?? [];
      rows.push({ folder, depth, hasChildren: children.length > 0 });
      if (expandedFolderIds.value.has(folder.folderId)) append(folder.folderId, depth + 1);
    }
  };
  append(null, 0);
  return rows;
});
const folderOptions = computed(() => activeFolders.value
  .map((folder) => ({ folder, path: folderPath(folder.folderId).map((part) => part.metadata?.name ?? "").join(" / ") }))
  .sort((left, right) => left.path.localeCompare(right.path)));
const folderParentOptions = computed(() => folderOptions.value
  .filter((option) => folderCanBeParent(option.folder.folderId)));
const tagRows = computed(() => {
  const counts = new Map<string, number>();
  for (const item of activeItems.value) {
    for (const tag of item.metadata?.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => left.name.localeCompare(right.name));
});
const currentFolder = computed(() => currentFolderId.value ? folderById.value.get(currentFolderId.value) ?? null : null);
const breadcrumbFolders = computed(() => currentFolderId.value ? folderPath(currentFolderId.value) : []);
const visibleChildFolders = computed(() => {
  if (showTrash.value || smartView.value !== null) return [];
  return [...(childFoldersByParent.value.get(currentFolderId.value) ?? [])].sort((left, right) => compareFolders(left, right));
});
const visibleItems = computed(() => {
  const query = search.value.trim().toLowerCase();
  const filtered = items.value.filter((item) => {
    const metadata = item.metadata;
    if (!metadata) return smartView.value === "all" && !query;
    const folderName = metadata.folderId ? folderById.value.get(metadata.folderId)?.metadata?.name ?? "" : metadata.folder;
    if (smartView.value === null && (metadata.folderId ?? null) !== currentFolderId.value) return false;
    if (smartView.value === "favorites" && !metadata.favorite) return false;
    if (smartView.value === "recent" && !metadata.lastOpenedAt) return false;
    if (smartView.value === "images" && !metadata.mimeType.startsWith("image/")) return false;
    if (smartView.value === "documents" && metadata.mimeType.startsWith("image/")) return false;
    if (smartView.value === "unfiled" && (metadata.folderId || metadata.folder)) return false;
    if (smartView.value === "tag" && !metadata.tags?.includes(selectedTag.value)) return false;
    if (query && ![metadata.fileName, folderName, metadata.note, metadata.mimeType, ...(metadata.tags ?? [])]
      .join(" ")
      .toLowerCase()
      .includes(query)) return false;
    return true;
  });
  return filtered.sort((left, right) => compareItems(left, right));
});
const previewImageSequence = computed(() => (previewImageSession.value?.itemIds ?? []).flatMap((itemId) => {
  const item = items.value.find((candidate) => candidate.itemId === itemId && !candidate.deletedAt);
  return item?.metadata && detectPreviewKind(item.metadata) === "image" ? [item] : [];
}));
const previewImageIndex = computed(() => previewItem.value
  ? previewImageSequence.value.findIndex((item) => item.itemId === previewItem.value?.itemId)
  : -1);
const previewPreviousImage = computed(() => previewImageIndex.value > 0
  ? previewImageSequence.value[previewImageIndex.value - 1] ?? null
  : null);
const previewNextImage = computed(() => previewImageIndex.value >= 0
  ? previewImageSequence.value[previewImageIndex.value + 1] ?? null
  : null);
const previewImagePosition = computed(() => previewImageIndex.value >= 0
  ? { current: previewImageIndex.value + 1, total: previewImageSequence.value.length }
  : null);
const previewImageOrderLabel = computed(() => previewImageSession.value
  ? `${previewImageSession.value.locationLabel} · ${privateVaultSortLabel(previewImageSession.value.sortField, previewImageSession.value.sortDirection)}`
  : "");
const previewZoomLabel = computed(() => `${Math.round(previewImageScale.value * 100)}%`);
const previewImageStyle = computed(() => previewImageNaturalWidth.value && previewImageNaturalHeight.value
  ? {
      width: `${previewImageNaturalWidth.value * previewImageScale.value}px`,
      height: `${previewImageNaturalHeight.value * previewImageScale.value}px`
    }
  : undefined);
const selectedItems = computed(() => items.value.filter((item) => selectedItemIds.value.has(item.itemId)));
const allVisibleSelected = computed(() => visibleItems.value.length > 0
  && visibleItems.value.every((item) => selectedItemIds.value.has(item.itemId)));
const currentLocationLabel = computed(() => {
  if (currentFolder.value?.metadata) return currentFolder.value.metadata.name;
  if (smartView.value === "tag") return `Tag: ${selectedTag.value}`;
  return ({
    all: "All private files",
    recent: "Recent",
    favorites: "Favorites",
    images: "Images",
    documents: "Documents",
    unfiled: "Unfiled",
    tag: "Tag",
    trash: "Private trash"
  } as Record<Exclude<VaultSmartView, null>, string>)[smartView.value ?? "all"];
});
const sortDirectionLabel = computed(() => {
  if (sortField.value === "updated" || sortField.value === "opened") {
    return sortDirection.value === "asc" ? "Oldest first" : "Newest first";
  }
  if (sortField.value === "size") return sortDirection.value === "asc" ? "Smallest first" : "Largest first";
  return sortDirection.value === "asc" ? "A–Z" : "Z–A";
});
const sortDirectionTitle = computed(() => `${sortDirectionLabel.value}. Click to reverse the order.`);
const activeSortIcon = computed(() => sortDirection.value === "asc" ? ArrowUp : ArrowDown);
const contextItem = computed(() => contextMenu.value?.kind === "item"
  ? items.value.find((item) => item.itemId === contextMenu.value?.id) ?? null
  : null);
const contextFolder = computed(() => contextMenu.value?.kind === "folder"
  ? folderById.value.get(contextMenu.value.id) ?? null
  : null);
const autoLockLabel = computed(() => {
  const minutes = Math.floor(secondsUntilLock.value / 60);
  const seconds = secondsUntilLock.value % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
});

function randomUuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** power;
  return `${amount >= 10 || power === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[power]}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function extension(fileName: string): string {
  const match = fileName.match(/\.([A-Za-z0-9]{1,8})$/);
  return match?.[1]?.toUpperCase() ?? "FILE";
}

function itemIcon(item: DisplayVaultItem) {
  const mimeType = item.metadata?.mimeType ?? "";
  if (mimeType.startsWith("image/")) return FileImage;
  if (mimeType.startsWith("video/") || /\.(?:mp4|m4v|webm|ogv|ogg|mov)$/i.test(item.metadata?.fileName ?? "")) return FileVideo;
  if (mimeType.startsWith("text/") || /(?:markdown|json|xml|pdf)/i.test(mimeType)) return FileText;
  return File;
}

function videoMimeType(metadata: PrivateVaultItemMetadata): string | null {
  if (metadata.mimeType.startsWith("video/")) return metadata.mimeType;
  const fileName = metadata.fileName.toLowerCase();
  if (/\.(?:mp4|m4v)$/.test(fileName)) return "video/mp4";
  if (/\.webm$/.test(fileName)) return "video/webm";
  if (/\.(?:ogv|ogg)$/.test(fileName)) return "video/ogg";
  if (/\.mov$/.test(fileName)) return "video/quicktime";
  return null;
}

function detectPreviewKind(metadata: PrivateVaultItemMetadata): PreviewKind {
  if (metadata.mimeType.startsWith("image/") && metadata.mimeType !== "image/svg+xml") return "image";
  if (videoMimeType(metadata)) return "video";
  if (metadata.mimeType === "application/pdf" || /\.pdf$/i.test(metadata.fileName)) return "pdf";
  if ((metadata.mimeType.startsWith("text/") || /(?:json|xml|markdown)/i.test(metadata.mimeType)) && metadata.size <= 5 * 1024 * 1024) {
    return "text";
  }
  return "download";
}

function folderPath(folderId: string): DisplayVaultFolder[] {
  const path: DisplayVaultFolder[] = [];
  const visited = new Set<string>();
  let current = folderById.value.get(folderId) ?? null;
  while (current?.metadata && !visited.has(current.folderId)) {
    visited.add(current.folderId);
    path.unshift(current);
    current = current.metadata.parentFolderId
      ? folderById.value.get(current.metadata.parentFolderId) ?? null
      : null;
  }
  return path;
}

function folderName(folderId: string | null | undefined): string {
  if (!folderId) return "Unfiled";
  return folderById.value.get(folderId)?.metadata?.name ?? "Unavailable folder";
}

function compareFolders(left: DisplayVaultFolder, right: DisplayVaultFolder): number {
  const leftMetadata = left.metadata;
  const rightMetadata = right.metadata;
  if (!leftMetadata || !rightMetadata) return leftMetadata ? -1 : rightMetadata ? 1 : 0;
  const result = sortField.value === "updated" || sortField.value === "opened"
    ? new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime()
    : leftMetadata.name.localeCompare(rightMetadata.name, undefined, { numeric: true, sensitivity: "base" });
  return sortDirection.value === "asc" ? result : -result;
}

function compareItems(left: DisplayVaultItem, right: DisplayVaultItem): number {
  return comparePrivateVaultItems(left, right, sortField.value, sortDirection.value, folderName);
}

function replaceSetValue(source: Set<string>, value: string, selected: boolean): Set<string> {
  const next = new Set(source);
  if (selected) next.add(value);
  else next.delete(value);
  return next;
}

function normalizeTags(value: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const rawTag of value.split(/[,，\n]/)) {
    const tag = rawTag.trim().replace(/^#+/, "").slice(0, 80);
    const normalized = tag.toLocaleLowerCase();
    if (!tag || seen.has(normalized)) continue;
    seen.add(normalized);
    tags.push(tag);
    if (tags.length === 30) break;
  }
  return tags;
}

function setViewMode(mode: VaultViewMode) {
  viewMode.value = mode;
  localStorage.setItem("personal-archive.private-vault.view-mode", mode);
}

function toggleSortDirection() {
  sortDirection.value = sortDirection.value === "asc" ? "desc" : "asc";
}

function sortFromColumn(field: Extract<PrivateVaultSortField, "name" | "location" | "size" | "updated">) {
  if (sortField.value === field) {
    toggleSortDirection();
    return;
  }
  sortField.value = field;
  sortDirection.value = field === "updated" ? "desc" : "asc";
}

function clearSelection() {
  selectedItemIds.value = new Set();
  lastSelectedItemId.value = null;
}

function toggleFolderExpanded(folderId: string) {
  expandedFolderIds.value = replaceSetValue(
    expandedFolderIds.value,
    folderId,
    !expandedFolderIds.value.has(folderId)
  );
}

function isFormControl(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable);
}

function clearAutoLockTimers() {
  if (autoLockTimer) clearTimeout(autoLockTimer);
  if (countdownTimer) clearInterval(countdownTimer);
  autoLockTimer = null;
  countdownTimer = null;
  autoLockDeadline = 0;
  secondsUntilLock.value = 0;
}

function armAutoLock() {
  if (!unlocked.value || !vault.value) return;
  clearAutoLockTimers();
  autoLockDeadline = Date.now() + vault.value.autoLockMinutes * 60_000;
  const updateCountdown = () => {
    secondsUntilLock.value = Math.max(0, Math.ceil((autoLockDeadline - Date.now()) / 1000));
  };
  updateCountdown();
  countdownTimer = setInterval(updateCountdown, 1000);
  autoLockTimer = setTimeout(() => lockVault(true), vault.value.autoLockMinutes * 60_000);
}

function registerActivity() {
  if (unlocked.value) armAutoLock();
}

function onWindowKeydown(event: KeyboardEvent) {
  registerActivity();
  if (previewItem.value && previewKind.value === "image" && !isFormControl(event.target)) {
    if (event.key === "ArrowLeft" && previewPreviousImage.value) {
      event.preventDefault();
      void showAdjacentImage(-1);
      return;
    }
    if (event.key === "ArrowRight" && previewNextImage.value) {
      event.preventDefault();
      void showAdjacentImage(1);
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomPreviewImage(1.25);
      return;
    }
    if (event.key === "-") {
      event.preventDefault();
      zoomPreviewImage(1 / 1.25);
      return;
    }
    if (event.key === "0") {
      event.preventDefault();
      fitPreviewImageToWindow();
      return;
    }
    if (event.key === "1") {
      event.preventDefault();
      showPreviewImageActualSize();
      return;
    }
    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      void togglePreviewFullscreen();
      return;
    }
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a" && unlocked.value && !isFormControl(event.target)) {
    event.preventDefault();
    selectedItemIds.value = new Set(visibleItems.value.map((item) => item.itemId));
    return;
  }
  if (event.key === "Delete" && selectedItems.value.length && !isFormControl(event.target)) {
    event.preventDefault();
    void trashSelectedItems();
    return;
  }
  if (event.key === "F2" && selectedItems.value.length === 1 && !isFormControl(event.target)) {
    event.preventDefault();
    beginEdit(selectedItems.value[0]);
    return;
  }
  if (event.key === "Enter" && selectedItems.value.length === 1 && !isFormControl(event.target)) {
    event.preventDefault();
    void openPreview(selectedItems.value[0]);
    return;
  }
  if (event.key !== "Escape") return;
  if (contextMenu.value) contextMenu.value = null;
  else if (showMoveDialog.value) showMoveDialog.value = false;
  else if (showFolderDialog.value) closeFolderDialog();
  else if (previewItem.value) closePreview();
  else if (editItem.value) closeEdit();
  else if (showPasswordChange.value) closePasswordChange();
  else if (showReset.value) closeReset();
  else clearSelection();
}

function releasePreviewContent() {
  previewRequestVersion += 1;
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = "";
  previewText.value = "";
  previewVideoError.value = "";
  previewLoading.value = false;
}

function onPreviewVideoReady() {
  previewVideoError.value = "";
}

function onPreviewVideoError() {
  previewVideoError.value = "This browser cannot play the video's format or codec. MP4 (H.264/AAC) and WebM have the broadest support.";
}

function clearPreviewControlsTimer() {
  if (previewControlsTimer) clearTimeout(previewControlsTimer);
  previewControlsTimer = null;
}

function hidePreviewControls() {
  clearPreviewControlsTimer();
  previewControlsVisible.value = false;
}

function keepPreviewControlsVisible() {
  clearPreviewControlsTimer();
  if (previewKind.value === "image" && previewImageSequence.value.length > 1) {
    previewControlsVisible.value = true;
  }
}

function revealPreviewControls() {
  clearPreviewControlsTimer();
  if (previewKind.value !== "image" || previewImageSequence.value.length <= 1) {
    previewControlsVisible.value = false;
    return;
  }
  previewControlsVisible.value = true;
  previewControlsTimer = setTimeout(() => {
    previewControlsVisible.value = false;
    previewControlsTimer = null;
  }, 1300);
}

const MIN_PREVIEW_IMAGE_SCALE = 0.05;
const MAX_PREVIEW_IMAGE_SCALE = 8;
const PREVIEW_SCROLL_LOCK_CLASS = "private-vault-preview-open";

function clampPreviewImageScale(value: number) {
  return Math.min(MAX_PREVIEW_IMAGE_SCALE, Math.max(MIN_PREVIEW_IMAGE_SCALE, value));
}

function lockPreviewPageScroll(locked: boolean) {
  document.documentElement.classList.toggle(PREVIEW_SCROLL_LOCK_CLASS, locked);
  document.body.classList.toggle(PREVIEW_SCROLL_LOCK_CLASS, locked);
}

function resetPreviewImageState(preserveView = false) {
  previewImageNaturalWidth.value = 0;
  previewImageNaturalHeight.value = 0;
  if (!preserveView) {
    previewImageScale.value = 1;
    previewImageMode.value = "width";
  }
  previewTouchStartDistance = 0;
}

function previewFitScale(mode: "width" | "fit") {
  const scroller = previewImageScroller.value;
  if (!scroller || !previewImageNaturalWidth.value || !previewImageNaturalHeight.value) return 1;
  const availableWidth = Math.max(1, scroller.clientWidth - 32);
  const availableHeight = Math.max(1, scroller.clientHeight - 32);
  const widthScale = availableWidth / previewImageNaturalWidth.value;
  if (mode === "width") return Math.min(1, widthScale);
  return Math.min(1, widthScale, availableHeight / previewImageNaturalHeight.value);
}

function applyPreviewImageScale(nextScale: number, preserveCenter = true) {
  const scroller = previewImageScroller.value;
  const previousWidth = scroller?.scrollWidth ?? 0;
  const previousHeight = scroller?.scrollHeight ?? 0;
  const centerX = scroller && previousWidth > 0
    ? (scroller.scrollLeft + scroller.clientWidth / 2) / previousWidth
    : 0.5;
  const centerY = scroller && previousHeight > 0
    ? (scroller.scrollTop + scroller.clientHeight / 2) / previousHeight
    : 0.5;
  previewImageScale.value = clampPreviewImageScale(nextScale);
  void nextTick(() => {
    if (!scroller) return;
    requestAnimationFrame(() => {
      if (preserveCenter) {
        scroller.scrollLeft = centerX * scroller.scrollWidth - scroller.clientWidth / 2;
        scroller.scrollTop = centerY * scroller.scrollHeight - scroller.clientHeight / 2;
      } else {
        scroller.scrollLeft = 0;
        scroller.scrollTop = 0;
      }
    });
  });
}

function fitPreviewImageToWidth() {
  previewImageMode.value = "width";
  applyPreviewImageScale(previewFitScale("width"), false);
}

function fitPreviewImageToWindow() {
  previewImageMode.value = "fit";
  applyPreviewImageScale(previewFitScale("fit"), false);
}

function showPreviewImageActualSize() {
  previewImageMode.value = "custom";
  applyPreviewImageScale(1, false);
}

function zoomPreviewImage(factor: number) {
  previewImageMode.value = "custom";
  applyPreviewImageScale(previewImageScale.value * factor);
  revealPreviewControls();
}

function onPreviewImageLoad(event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  previewImageNaturalWidth.value = image.naturalWidth;
  previewImageNaturalHeight.value = image.naturalHeight;
  void nextTick(() => {
    if (previewImageMode.value === "width") fitPreviewImageToWidth();
    else if (previewImageMode.value === "fit") fitPreviewImageToWindow();
    else applyPreviewImageScale(previewImageScale.value, false);
  });
  revealPreviewControls();
}

function onPreviewImageWheel(event: WheelEvent) {
  revealPreviewControls();
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  zoomPreviewImage(event.deltaY < 0 ? 1.12 : 1 / 1.12);
}

let previewTouchStartDistance = 0;
let previewTouchStartScale = 1;

function previewTouchDistance(touches: TouchList) {
  const first = touches.item(0);
  const second = touches.item(1);
  return first && second ? Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY) : 0;
}

function onPreviewImageTouchStart(event: TouchEvent) {
  revealPreviewControls();
  if (event.touches.length !== 2) return;
  previewTouchStartDistance = previewTouchDistance(event.touches);
  previewTouchStartScale = previewImageScale.value;
}

function onPreviewImageTouchMove(event: TouchEvent) {
  if (event.touches.length !== 2 || previewTouchStartDistance <= 0) return;
  event.preventDefault();
  const distance = previewTouchDistance(event.touches);
  previewImageMode.value = "custom";
  applyPreviewImageScale(previewTouchStartScale * distance / previewTouchStartDistance);
}

function onPreviewImageTouchEnd(event: TouchEvent) {
  if (event.touches.length < 2) previewTouchStartDistance = 0;
}

function togglePreviewImageSize() {
  if (Math.abs(previewImageScale.value - 1) < 0.01) fitPreviewImageToWindow();
  else showPreviewImageActualSize();
}

async function togglePreviewFullscreen() {
  const dialog = previewDialog.value;
  if (!dialog) return;
  try {
    if (document.fullscreenElement === dialog) await document.exitFullscreen();
    else await dialog.requestFullscreen();
  } catch (error) {
    toasts.error("Full screen unavailable", error instanceof Error ? error.message : "The browser did not allow full screen mode.");
  }
}

function onPreviewFullscreenChange() {
  previewFullscreen.value = document.fullscreenElement === previewDialog.value;
  void nextTick(() => {
    if (previewImageMode.value === "width") fitPreviewImageToWidth();
    else if (previewImageMode.value === "fit") fitPreviewImageToWindow();
  });
}

function onPreviewWindowResize() {
  if (previewKind.value !== "image") return;
  if (previewImageMode.value === "width") fitPreviewImageToWidth();
  else if (previewImageMode.value === "fit") fitPreviewImageToWindow();
}

function dismissPreview() {
  if (document.fullscreenElement === previewDialog.value) void document.exitFullscreen().catch(() => undefined);
  releasePreviewContent();
  hidePreviewControls();
  resetPreviewImageState();
  previewItem.value = null;
  previewImageSession.value = null;
  lockPreviewPageScroll(false);
}

function vaultPreviewItemIdFromRoute(): string {
  return typeof route.query.vaultItem === "string" ? route.query.vaultItem : "";
}

function updateVaultPreviewRoute(itemId: string, replace = false) {
  if (vaultPreviewItemIdFromRoute() === itemId) return;
  const location = {
    path: route.path,
    query: { ...route.query, vaultItem: itemId },
    state: {
      [VAULT_PREVIEW_HISTORY_STATE]: itemId,
      [VAULT_DIRECTORY_HISTORY_STATE]: JSON.stringify(vaultDirectorySnapshot())
    }
  };
  void (replace ? router.replace(location) : router.push(location));
}

function closePreview() {
  const itemId = previewItem.value?.itemId ?? vaultPreviewItemIdFromRoute();
  dismissPreview();
  if (!itemId || vaultPreviewItemIdFromRoute() !== itemId) return;
  if (window.history.state?.[VAULT_PREVIEW_HISTORY_STATE] === itemId) {
    router.back();
    return;
  }
  const query = { ...route.query };
  delete query.vaultItem;
  void router.replace({ path: route.path, query, state: { [VAULT_DIRECTORY_HISTORY_STATE]: JSON.stringify(vaultDirectorySnapshot()) } });
}

async function syncVaultPreviewFromRoute() {
  if (!vaultRouteReady.value || !unlocked.value) return;
  const itemId = vaultPreviewItemIdFromRoute();
  if (!itemId) {
    if (previewItem.value) dismissPreview();
    return;
  }
  if (previewItem.value?.itemId === itemId) return;
  const item = items.value.find((candidate) => candidate.itemId === itemId && !candidate.deletedAt);
  if (item?.metadata) {
    const preserveImageSequence = detectPreviewKind(item.metadata) === "image"
      && previewImageSession.value?.itemIds.includes(itemId) === true;
    await openPreview(item, { preserveImageSequence, routeMode: "none" });
    return;
  }
  const query = { ...route.query };
  delete query.vaultItem;
  void router.replace({ path: route.path, query, state: { [VAULT_DIRECTORY_HISTORY_STATE]: JSON.stringify(vaultDirectorySnapshot()) } });
}

function closeEdit() {
  editItem.value = null;
  editFileName.value = "";
  editFolderId.value = null;
  editNote.value = "";
  editTagsInput.value = "";
}

function closeFolderDialog() {
  showFolderDialog.value = false;
  folderDialogTargetId.value = null;
  folderNameInput.value = "";
  folderParentInput.value = null;
}

function closeContextMenu() {
  contextMenu.value = null;
}

function closePasswordChange() {
  showPasswordChange.value = false;
  nextPassword.value = "";
  nextPasswordConfirm.value = "";
}

function closeReset() {
  showReset.value = false;
  resetAccountPassword.value = "";
  resetPassword.value = "";
  resetPasswordConfirm.value = "";
}

function lockVault(showNotice = false) {
  clearAutoLockTimers();
  dismissPreview();
  closeEdit();
  closePasswordChange();
  closeReset();
  closeFolderDialog();
  showMoveDialog.value = false;
  contextMenu.value = null;
  if (vaultKey.value) vaultKey.value.fill(0);
  vaultKey.value = null;
  items.value = [];
  vaultFolders.value = [];
  clearSelection();
  search.value = "";
  selectedTag.value = "";
  smartView.value = "all";
  currentFolderId.value = null;
  expandedFolderIds.value = new Set();
  showTrash.value = false;
  moveUndo.value = null;
  if (moveUndoTimer) clearTimeout(moveUndoTimer);
  moveUndoTimer = null;
  unlockPassword.value = "";
  if (showNotice) toasts.success("Private vault locked", "The in-memory decryption key was cleared.");
  void nextTick(() => unlockInput.value?.focus());
}

function decryptItemRecords(records: PrivateVaultItem[], key: PrivateVaultKey): DisplayVaultItem[] {
  return records.map((item) => {
    try {
      return { ...item, metadata: decryptPrivateVaultItemMetadata(key, item) };
    } catch (error) {
      return {
        ...item,
        metadata: null,
        metadataError: error instanceof Error ? error.message : "Unable to decrypt file metadata."
      };
    }
  });
}

function decryptFolderRecords(records: PrivateVaultFolder[], key: PrivateVaultKey): DisplayVaultFolder[] {
  return records.map((folder) => {
    try {
      return { ...folder, metadata: decryptPrivateVaultFolderMetadata(key, folder) };
    } catch (error) {
      return {
        ...folder,
        metadata: null,
        metadataError: error instanceof Error ? error.message : "Unable to decrypt folder metadata."
      };
    }
  });
}

async function reloadItems() {
  const key = vaultKey.value;
  if (!key) return;
  const records = await client.privateVaultItems(showTrash.value);
  items.value = decryptItemRecords(records, key);
}

async function reloadFolders() {
  const key = vaultKey.value;
  if (!key) return;
  const records = await client.privateVaultFolders(false);
  vaultFolders.value = decryptFolderRecords(records, key);
}

async function updateItemMetadataInBatches(
  updates: Array<{ itemId: string; encryptedMetadata: string }>
): Promise<PrivateVaultItem[]> {
  const records: PrivateVaultItem[] = [];
  for (let index = 0; index < updates.length; index += PRIVATE_VAULT_METADATA_BATCH_SIZE) {
    records.push(...await client.updatePrivateVaultItemMetadataBatch(
      updates.slice(index, index + PRIVATE_VAULT_METADATA_BATCH_SIZE)
    ));
  }
  return records;
}

async function loadVault() {
  loading.value = true;
  pageError.value = "";
  try {
    vault.value = (await client.privateVault()).vault;
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : "Unable to load the private vault.";
  } finally {
    loading.value = false;
  }
}

async function createVault() {
  if (!canWriteVault.value) return;
  pageError.value = "";
  if (!createPassword.value) {
    pageError.value = "Enter a private vault password.";
    return;
  }
  if (createPassword.value !== confirmCreatePassword.value) {
    pageError.value = "The private vault passwords do not match.";
    return;
  }
  creating.value = true;
  let createdKey: PrivateVaultKey | null = null;
  try {
    const encryption = await createPrivateVaultEncryption(createPassword.value);
    createdKey = encryption.vaultKey;
    const response = await client.createPrivateVault({
      metadata: encryption.metadata,
      recoveryVaultKey: encryption.recoveryVaultKey
    });
    vault.value = response.vault;
    vaultKey.value = createdKey;
    createdKey = null;
    createPassword.value = "";
    confirmCreatePassword.value = "";
    items.value = [];
    vaultFolders.value = [];
    armAutoLock();
    await applyVaultDirectoryState(vaultDirectoryStateFromRoute());
    await syncVaultPreviewFromRoute();
    queueMicrotask(rememberVaultDirectoryState);
    toasts.success("Private vault created", "Files and file names will be encrypted before upload.");
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : "Unable to create the private vault.";
  } finally {
    createdKey?.fill(0);
    creating.value = false;
  }
}

async function unlockVault() {
  if (!vault.value || unlocking.value) return;
  unlocking.value = true;
  pageError.value = "";
  let key: PrivateVaultKey | null = null;
  try {
    key = await unlockPrivateVault(vault.value, unlockPassword.value);
    const [records, folderRecords] = await Promise.all([
      client.privateVaultItems(false),
      client.privateVaultFolders(false)
    ]);
    items.value = decryptItemRecords(records, key);
    vaultFolders.value = decryptFolderRecords(folderRecords, key);
    vaultKey.value = key;
    key = null;
    unlockPassword.value = "";
    try {
      if (canWriteVault.value) await migrateLegacyFolders();
    } catch (error) {
      await Promise.all([reloadItems(), reloadFolders()]).catch(() => undefined);
      toasts.error("Some folders need attention", error instanceof Error ? error.message : "Legacy folders were not converted.");
    }
    await applyVaultDirectoryState(vaultDirectoryStateFromRoute());
    await syncVaultPreviewFromRoute();
    queueMicrotask(rememberVaultDirectoryState);
    armAutoLock();
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : "Unable to unlock the private vault.";
  } finally {
    key?.fill(0);
    unlocking.value = false;
  }
}

async function changeAutoLock(event: Event) {
  if (!canWriteVault.value) return;
  const minutes = Number((event.target as HTMLSelectElement).value) as 5 | 10 | 30;
  try {
    const response = await client.updatePrivateVaultSettings(minutes);
    vault.value = response.vault;
    armAutoLock();
  } catch (error) {
    toasts.error("Setting not saved", error instanceof Error ? error.message : "Unable to change auto-lock time.");
  }
}

async function changeVaultPassword() {
  if (!canWriteVault.value) return;
  const key = vaultKey.value;
  if (!key || changingPassword.value) return;
  if (!nextPassword.value) {
    pageError.value = "Enter a new private vault password.";
    return;
  }
  if (nextPassword.value !== nextPasswordConfirm.value) {
    pageError.value = "The new private vault passwords do not match.";
    return;
  }
  changingPassword.value = true;
  pageError.value = "";
  try {
    const metadata = await createPrivateVaultPasswordMetadata(key, nextPassword.value);
    vault.value = (await client.updatePrivateVaultPassword(metadata)).vault;
    closePasswordChange();
    toasts.success("Password changed", "Existing encrypted files did not need to be uploaded again.");
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : "Unable to change the private vault password.";
  } finally {
    changingPassword.value = false;
  }
}

async function resetVaultPassword() {
  if (!canWriteVault.value) return;
  if (resetting.value) return;
  if (!resetPassword.value) {
    pageError.value = "Enter a new private vault password.";
    return;
  }
  if (resetPassword.value !== resetPasswordConfirm.value) {
    pageError.value = "The new private vault passwords do not match.";
    return;
  }
  resetting.value = true;
  pageError.value = "";
  try {
    vault.value = (await client.resetPrivateVaultPassword({
      currentAccountPassword: resetAccountPassword.value,
      newVaultPassword: resetPassword.value
    })).vault;
    closeReset();
    lockVault(false);
    toasts.success("Private vault password reset", "Use the new password to unlock the vault.");
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : "Unable to reset the private vault password.";
  } finally {
    resetting.value = false;
  }
}

function siblingFolderNameExists(name: string, parentFolderId: string | null, exceptFolderId: string | null = null): boolean {
  const normalized = name.trim().toLocaleLowerCase();
  return activeFolders.value.some((folder) => folder.folderId !== exceptFolderId
    && (folder.metadata?.parentFolderId ?? null) === parentFolderId
    && folder.metadata?.name.trim().toLocaleLowerCase() === normalized);
}

async function createFolderRecord(
  name: string,
  parentFolderId: string | null,
  options: { silent?: boolean } = {}
): Promise<DisplayVaultFolder> {
  const key = vaultKey.value;
  const currentVault = vault.value;
  if (!key || !currentVault) throw new Error("Unlock the private vault before creating folders.");
  const folderId = randomUuid();
  const metadata: PrivateVaultFolderMetadata = { name: name.trim(), parentFolderId, favorite: false };
  const encryptedMetadata = encryptPrivateVaultFolderMetadata(key, currentVault.vaultId, folderId, metadata);
  const record = await client.createPrivateVaultFolder({ folderId, encryptionVersion: 1, encryptedMetadata });
  const displayFolder: DisplayVaultFolder = { ...record, metadata };
  vaultFolders.value = [...vaultFolders.value, displayFolder];
  if (parentFolderId) {
    expandedFolderIds.value = replaceSetValue(expandedFolderIds.value, parentFolderId, true);
  }
  if (!options.silent) toasts.success("Folder created", metadata.name);
  return displayFolder;
}

async function migrateLegacyFolders() {
  const key = vaultKey.value;
  if (!key) return;
  const legacyItems = items.value.filter((item) => item.metadata?.folder && !item.metadata.folderId);
  if (!legacyItems.length) return;
  const folderByLegacyName = new Map<string, DisplayVaultFolder>();
  for (const folder of activeFolders.value) {
    if (folder.metadata?.parentFolderId === null) {
      folderByLegacyName.set(folder.metadata.name.toLocaleLowerCase(), folder);
    }
  }
  for (const item of legacyItems) {
    const name = item.metadata?.folder.trim();
    if (!name) continue;
    const normalized = name.toLocaleLowerCase();
    if (!folderByLegacyName.has(normalized)) {
      folderByLegacyName.set(normalized, await createFolderRecord(name, null, { silent: true }));
    }
  }
  const updates = legacyItems.flatMap((item) => {
    if (!item.metadata) return [];
    const folder = folderByLegacyName.get(item.metadata.folder.trim().toLocaleLowerCase());
    if (!folder) return [];
    const metadata: PrivateVaultItemMetadata = { ...item.metadata, folder: "", folderId: folder.folderId };
    return [{ item, metadata, encryptedMetadata: updatePrivateVaultItemMetadata(key, item, metadata) }];
  });
  if (!updates.length) return;
  const records = await updateItemMetadataInBatches(
    updates.map((update) => ({ itemId: update.item.itemId, encryptedMetadata: update.encryptedMetadata }))
  );
  const recordById = new Map(records.map((record) => [record.itemId, record]));
  items.value = items.value.map((item) => {
    const update = updates.find((candidate) => candidate.item.itemId === item.itemId);
    const record = recordById.get(item.itemId);
    return update && record ? { ...record, metadata: update.metadata } : item;
  });
  toasts.success("Folders upgraded", `${updates.length} existing files now use encrypted folders.`);
}

function beginCreateFolder(parentFolderId = smartView.value === null ? currentFolderId.value : null) {
  folderDialogMode.value = "create";
  folderDialogTargetId.value = null;
  folderNameInput.value = "";
  folderParentInput.value = parentFolderId;
  showFolderDialog.value = true;
  pageError.value = "";
}

function beginCreateSubfolder(folder: DisplayVaultFolder) {
  const parentFolderId = folder.folderId;
  contextMenu.value = null;
  beginCreateFolder(parentFolderId);
}

function beginEditFolder(folder: DisplayVaultFolder) {
  if (!folder.metadata) return;
  folderDialogMode.value = "edit";
  folderDialogTargetId.value = folder.folderId;
  folderNameInput.value = folder.metadata.name;
  folderParentInput.value = folder.metadata.parentFolderId;
  showFolderDialog.value = true;
  contextMenu.value = null;
  pageError.value = "";
}

function isFolderDescendant(candidateFolderId: string, ancestorFolderId: string): boolean {
  const visited = new Set<string>();
  let current = folderById.value.get(candidateFolderId) ?? null;
  while (current?.metadata && !visited.has(current.folderId)) {
    if (current.folderId === ancestorFolderId) return true;
    visited.add(current.folderId);
    current = current.metadata.parentFolderId
      ? folderById.value.get(current.metadata.parentFolderId) ?? null
      : null;
  }
  return false;
}

function folderCanBeParent(candidateFolderId: string): boolean {
  const targetId = folderDialogTargetId.value;
  return !targetId || (candidateFolderId !== targetId && !isFolderDescendant(candidateFolderId, targetId));
}

async function updateFolderMetadata(folder: DisplayVaultFolder, metadata: PrivateVaultFolderMetadata): Promise<DisplayVaultFolder> {
  const key = vaultKey.value;
  if (!key) throw new Error("Unlock the private vault before organizing folders.");
  const encryptedMetadata = encryptPrivateVaultFolderMetadata(key, folder.vaultId, folder.folderId, metadata);
  const record = await client.updatePrivateVaultFolderMetadata(folder.folderId, encryptedMetadata);
  const updated: DisplayVaultFolder = { ...record, metadata };
  const index = vaultFolders.value.findIndex((candidate) => candidate.folderId === folder.folderId);
  if (index !== -1) vaultFolders.value[index] = updated;
  return updated;
}

async function saveFolder() {
  if (!canWriteVault.value) return;
  if (savingFolder.value) return;
  const name = folderNameInput.value.trim();
  if (!name) {
    pageError.value = "Folder name is required.";
    return;
  }
  if (/[\\/]/.test(name)) {
    pageError.value = "Folder names cannot contain / or \\.";
    return;
  }
  if (siblingFolderNameExists(name, folderParentInput.value, folderDialogTargetId.value)) {
    pageError.value = "A folder with this name already exists here.";
    return;
  }
  savingFolder.value = true;
  pageError.value = "";
  try {
    if (folderDialogMode.value === "create") {
      const folder = await createFolderRecord(name, folderParentInput.value);
      selectFolder(folder.folderId);
    } else {
      const folder = folderDialogTargetId.value ? folderById.value.get(folderDialogTargetId.value) : null;
      if (!folder?.metadata) throw new Error("The folder is unavailable.");
      await updateFolderMetadata(folder, { ...folder.metadata, name, parentFolderId: folderParentInput.value });
      if (folderParentInput.value) {
        expandedFolderIds.value = replaceSetValue(expandedFolderIds.value, folderParentInput.value, true);
      }
      toasts.success("Folder updated", name);
    }
    closeFolderDialog();
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : "Unable to save the folder.";
  } finally {
    savingFolder.value = false;
  }
}

async function moveFolderTo(
  folderId: string,
  parentFolderId: string | null,
  silent = false,
  throwOnError = false
): Promise<boolean> {
  const folder = folderById.value.get(folderId);
  if (!folder?.metadata) {
    if (throwOnError) throw new Error("The folder is unavailable.");
    return false;
  }
  if (folderId === parentFolderId) return true;
  if (parentFolderId && isFolderDescendant(parentFolderId, folderId)) {
    const error = new Error("A folder cannot be moved inside itself or one of its subfolders.");
    if (throwOnError) throw error;
    toasts.error("Folder not moved", error.message);
    return false;
  }
  if (siblingFolderNameExists(folder.metadata.name, parentFolderId, folderId)) {
    const error = new Error("A folder with this name already exists at the destination.");
    if (throwOnError) throw error;
    toasts.error("Folder not moved", error.message);
    return false;
  }
  try {
    await updateFolderMetadata(folder, { ...folder.metadata, parentFolderId });
    if (parentFolderId) expandedFolderIds.value = replaceSetValue(expandedFolderIds.value, parentFolderId, true);
    if (!silent) toasts.success("Folder moved", `${folder.metadata.name} is now in ${folderName(parentFolderId)}.`);
    return true;
  } catch (error) {
    if (throwOnError) throw error;
    toasts.error("Folder not moved", error instanceof Error ? error.message : "Unable to move this folder.");
    return false;
  }
}

async function deleteFolder(folder: DisplayVaultFolder) {
  if (!canWriteVault.value) return;
  if (!folder.metadata) return;
  const parentFolderId = folder.metadata.parentFolderId;
  const directItems = items.value.filter((item) => item.metadata?.folderId === folder.folderId);
  const directChildren = activeFolders.value.filter((candidate) => candidate.metadata?.parentFolderId === folder.folderId);
  const message = directItems.length || directChildren.length
    ? `Remove “${folder.metadata.name}”? Its ${directItems.length} files and ${directChildren.length} subfolders will move to ${folderName(parentFolderId)}.`
    : `Remove the empty folder “${folder.metadata.name}”?`;
  if (!window.confirm(message)) return;
  try {
    if (directItems.length) await moveItemsToFolder(directItems.map((item) => item.itemId), parentFolderId, false, true);
    for (const child of directChildren) await moveFolderTo(child.folderId, parentFolderId, true, true);
    await client.trashPrivateVaultFolder(folder.folderId);
    await client.purgePrivateVaultFolder(folder.folderId);
    vaultFolders.value = vaultFolders.value.filter((candidate) => candidate.folderId !== folder.folderId);
    if (currentFolderId.value === folder.folderId) selectFolder(parentFolderId, true);
    toasts.success("Folder removed", "Its files and subfolders were preserved.");
  } catch (error) {
    toasts.error("Folder not removed", error instanceof Error ? error.message : "Unable to remove this folder.");
  }
}

function selectSmartView(view: Exclude<VaultSmartView, null>) {
  navigateVaultDirectory({
    ...vaultDirectorySnapshot(),
    smartView: view,
    folderId: null,
    selectedTag: "",
    search: ""
  });
}

function selectTag(tag: string) {
  navigateVaultDirectory({
    ...vaultDirectorySnapshot(),
    smartView: "tag",
    folderId: null,
    selectedTag: tag,
    search: ""
  });
}

function selectFolder(folderId: string | null, replace = false) {
  if (folderId && !folderById.value.has(folderId)) return;
  navigateVaultDirectory({
    ...vaultDirectorySnapshot(),
    smartView: null,
    folderId,
    selectedTag: "",
    search: ""
  }, replace);
}

async function uploadPreparedFiles(entries: Array<{ file: File; destinationFolderId: string | null }>) {
  if (!canWriteVault.value) return;
  const key = vaultKey.value;
  const currentVault = vault.value;
  if (!key || !currentVault || !entries.length) return;
  let completed = 0;
  let failed = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const { file, destinationFolderId } = entries[index];
    const itemId = randomUuid();
    uploadStatus.value = { name: file.name, index: index + 1, total: entries.length, progress: 0 };
    try {
      const encrypted = await encryptPrivateVaultFile(key, currentVault.vaultId, itemId, file, {
        folder: "",
        folderId: destinationFolderId,
        onProgress: (progress) => {
          if (uploadStatus.value) uploadStatus.value.progress = progress;
          armAutoLock();
        }
      });
      const form = new FormData();
      form.append("itemId", itemId);
      form.append("encryptionVersion", "1");
      form.append("encryptedMetadata", encrypted.encryptedMetadata);
      form.append("wrappedFileKey", encrypted.wrappedFileKey);
      form.append("file", encrypted.encryptedFile, `${itemId}.pav`);
      await client.uploadPrivateVaultItem(form);
      completed += 1;
    } catch (error) {
      failed += 1;
      toasts.error(`Could not add ${file.name}`, error instanceof Error ? error.message : "Encryption or upload failed.");
    }
  }
  await reloadItems();
  if (completed) toasts.success("Private upload complete", `${completed} encrypted ${completed === 1 ? "file" : "files"} stored.`);
  if (failed && !completed) pageError.value = "No files were uploaded. Review the error messages and try again.";
}

function finishUpload() {
  uploading.value = false;
  uploadStatus.value = null;
  if (fileInput.value) fileInput.value.value = "";
  if (folderInput.value) folderInput.value.value = "";
  armAutoLock();
}

async function uploadFiles(
  fileList: FileList | File[],
  destinationFolderId = smartView.value === null ? currentFolderId.value : null
) {
  const files = Array.from(fileList);
  if (!vaultKey.value || !vault.value || uploading.value || !files.length) return;
  uploading.value = true;
  pageError.value = "";
  try {
    await uploadPreparedFiles(files.map((file) => ({ file, destinationFolderId })));
  } finally {
    finishUpload();
  }
}

function matchingFolder(name: string, parentFolderId: string | null): DisplayVaultFolder | null {
  const normalized = name.trim().toLocaleLowerCase();
  return activeFolders.value.find((folder) => (folder.metadata?.parentFolderId ?? null) === parentFolderId
    && folder.metadata?.name.trim().toLocaleLowerCase() === normalized) ?? null;
}

async function ensureFolderPath(parts: string[], baseFolderId: string | null): Promise<string | null> {
  let parentFolderId = baseFolderId;
  for (const rawPart of parts) {
    const name = rawPart.trim().slice(0, 200);
    if (!name || name === "." || name === ".." || /[\\/]/.test(name)) continue;
    const existing = matchingFolder(name, parentFolderId);
    if (existing) {
      parentFolderId = existing.folderId;
      continue;
    }
    const folder = await createFolderRecord(name, parentFolderId, { silent: true });
    parentFolderId = folder.folderId;
  }
  return parentFolderId;
}

async function uploadFolderFiles(fileList: FileList | File[]) {
  const files = Array.from(fileList);
  if (!vaultKey.value || !vault.value || uploading.value || !files.length) return;
  const baseFolderId = smartView.value === null ? currentFolderId.value : null;
  uploading.value = true;
  pageError.value = "";
  try {
    const entries: Array<{ file: File; destinationFolderId: string | null }> = [];
    for (const file of files) {
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      const parts = relativePath.split("/").filter(Boolean);
      const destinationFolderId = await ensureFolderPath(parts.slice(0, -1), baseFolderId);
      entries.push({ file, destinationFolderId });
    }
    await uploadPreparedFiles(entries);
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : "The folder could not be prepared for encrypted upload.";
    toasts.error("Folder upload not completed", pageError.value);
  } finally {
    finishUpload();
  }
}

function dragHasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function onWorkspaceDrag(event: DragEvent) {
  if (!canWriteVault.value) return;
  if (dragHasFiles(event)) dragging.value = true;
}

function onDrop(event: DragEvent) {
  if (!canWriteVault.value) return;
  dragging.value = false;
  if (event.dataTransfer?.files.length) {
    void uploadFiles(event.dataTransfer.files, smartView.value === null ? currentFolderId.value : null);
  }
}

function resetDragState() {
  dragging.value = false;
  draggingItemIds.value = [];
  draggingFolderId.value = null;
  dragTargetFolderId.value = undefined;
}

function onItemDragStart(event: DragEvent, item: DisplayVaultItem) {
  if (!canWriteVault.value) { event.preventDefault(); return; }
  if (!selectedItemIds.value.has(item.itemId)) selectedItemIds.value = new Set([item.itemId]);
  draggingItemIds.value = selectedItems.value.map((candidate) => candidate.itemId);
  event.dataTransfer?.setData("application/x-personal-vault-items", draggingItemIds.value.join(","));
  event.dataTransfer?.setData("text/plain", `${draggingItemIds.value.length} private vault item(s)`);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}

function onFolderDragStart(event: DragEvent, folder: DisplayVaultFolder) {
  if (!canWriteVault.value) { event.preventDefault(); return; }
  draggingFolderId.value = folder.folderId;
  event.dataTransfer?.setData("application/x-personal-vault-folder", folder.folderId);
  event.dataTransfer?.setData("text/plain", folder.metadata?.name ?? "Private vault folder");
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}

function onFolderDragOver(event: DragEvent, folderId: string | null) {
  if (!canWriteVault.value) return;
  event.preventDefault();
  event.stopPropagation();
  dragTargetFolderId.value = folderId;
  if (event.dataTransfer) event.dataTransfer.dropEffect = dragHasFiles(event) ? "copy" : "move";
}

function onFolderDragLeave(event: DragEvent, folderId: string | null) {
  event.stopPropagation();
  if (dragTargetFolderId.value === folderId) dragTargetFolderId.value = undefined;
}

function onFolderDrop(event: DragEvent, folderId: string | null) {
  if (!canWriteVault.value) { event.preventDefault(); return; }
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer?.files.length) {
    void uploadFiles(event.dataTransfer.files, folderId);
  } else if (draggingItemIds.value.length) {
    void moveItemsToFolder(draggingItemIds.value, folderId);
  } else if (draggingFolderId.value) {
    void moveFolderTo(draggingFolderId.value, folderId);
  }
  resetDragState();
}

async function decryptedBlob(item: DisplayVaultItem): Promise<Blob> {
  const key = vaultKey.value;
  if (!key || !item.metadata) throw new Error("Unlock the private vault before opening this file.");
  const encrypted = await client.privateVaultItemBlob(item.itemId);
  armAutoLock();
  const blob = decryptPrivateVaultBlob(key, item, encrypted, item.metadata);
  void markRecentlyOpened(item);
  return blob;
}

async function markRecentlyOpened(item: DisplayVaultItem) {
  if (!canWriteVault.value) return;
  const key = vaultKey.value;
  if (!key || !item.metadata) return;
  const previous = item.metadata.lastOpenedAt ? new Date(item.metadata.lastOpenedAt).getTime() : 0;
  if (Date.now() - previous < 30_000) return;
  const metadata: PrivateVaultItemMetadata = { ...item.metadata, lastOpenedAt: new Date().toISOString() };
  try {
    const encryptedMetadata = updatePrivateVaultItemMetadata(key, item, metadata);
    const record = await client.updatePrivateVaultItemMetadata(item.itemId, encryptedMetadata);
    const index = items.value.findIndex((candidate) => candidate.itemId === item.itemId);
    if (index !== -1) items.value[index] = { ...record, metadata };
  } catch {
    // Recent-use metadata is best effort and must never block opening a file.
  }
}

async function openPreview(
  item: DisplayVaultItem,
  options: { preserveImageSequence?: boolean; routeMode?: "push" | "replace" | "none" } = {}
) {
  if (!item.metadata) {
    toasts.error("File metadata unavailable", item.metadataError ?? "This file cannot be opened.");
    return;
  }
  const nextPreviewKind = detectPreviewKind(item.metadata);
  const preserveImageSequence = options.preserveImageSequence === true
    && nextPreviewKind === "image"
    && previewImageSession.value?.itemIds.includes(item.itemId) === true;
  const preserveImageView = preserveImageSequence && previewKind.value === "image";
  releasePreviewContent();
  if (nextPreviewKind === "image") {
    if (!preserveImageSequence) {
      previewImageSession.value = {
        itemIds: createPrivateVaultImageSequence(
          visibleItems.value,
          item.itemId,
          (candidate) => candidate.metadata !== null && detectPreviewKind(candidate.metadata) === "image"
        ),
        locationLabel: currentLocationLabel.value,
        sortField: sortField.value,
        sortDirection: sortDirection.value
      };
    }
  } else {
    previewImageSession.value = null;
  }
  previewItem.value = item;
  if (options.routeMode !== "none") updateVaultPreviewRoute(item.itemId, options.routeMode === "replace");
  previewKind.value = nextPreviewKind;
  previewLoading.value = true;
  lockPreviewPageScroll(true);
  resetPreviewImageState(preserveImageView);
  if (nextPreviewKind === "image") revealPreviewControls();
  const requestVersion = previewRequestVersion;
  try {
    const blob = await decryptedBlob(item);
    if (requestVersion !== previewRequestVersion || !vaultKey.value) return;
    if (previewKind.value === "text") {
      const text = await blob.text();
      if (requestVersion !== previewRequestVersion || !vaultKey.value) return;
      previewText.value = text;
    } else if (previewKind.value !== "download") {
      const inferredVideoType = previewKind.value === "video" ? videoMimeType(item.metadata) : null;
      const previewBlob = inferredVideoType && !blob.type.startsWith("video/")
        ? new Blob([blob], { type: inferredVideoType })
        : blob;
      const url = URL.createObjectURL(previewBlob);
      if (requestVersion !== previewRequestVersion || !vaultKey.value) {
        URL.revokeObjectURL(url);
        return;
      }
      previewUrl.value = url;
    }
  } catch (error) {
    if (requestVersion !== previewRequestVersion) return;
    toasts.error("Private file could not be opened", error instanceof Error ? error.message : "Decryption failed.");
    closePreview();
  } finally {
    if (requestVersion === previewRequestVersion) previewLoading.value = false;
  }
}

async function showAdjacentImage(direction: -1 | 1) {
  if (previewLoading.value) return;
  const target = direction === -1 ? previewPreviousImage.value : previewNextImage.value;
  if (!target) return;
  await openPreview(target, { preserveImageSequence: true, routeMode: "replace" });
  revealPreviewControls();
}

async function downloadItem(item: DisplayVaultItem) {
  if (!item.metadata) return;
  try {
    const blob = await decryptedBlob(item);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = item.metadata.fileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    toasts.error("Download failed", error instanceof Error ? error.message : "Unable to decrypt the file.");
  }
}

function selectItem(item: DisplayVaultItem, event: MouseEvent) {
  if (event.shiftKey && lastSelectedItemId.value) {
    const start = visibleItems.value.findIndex((candidate) => candidate.itemId === lastSelectedItemId.value);
    const end = visibleItems.value.findIndex((candidate) => candidate.itemId === item.itemId);
    if (start !== -1 && end !== -1) {
      const next = new Set(selectedItemIds.value);
      const [from, to] = start < end ? [start, end] : [end, start];
      for (const candidate of visibleItems.value.slice(from, to + 1)) next.add(candidate.itemId);
      selectedItemIds.value = next;
      return;
    }
  }
  if (event.metaKey || event.ctrlKey) {
    selectedItemIds.value = replaceSetValue(
      selectedItemIds.value,
      item.itemId,
      !selectedItemIds.value.has(item.itemId)
    );
  } else {
    selectedItemIds.value = new Set([item.itemId]);
  }
  lastSelectedItemId.value = item.itemId;
}

function toggleItemSelection(itemId: string, selected: boolean) {
  selectedItemIds.value = replaceSetValue(selectedItemIds.value, itemId, selected);
  lastSelectedItemId.value = itemId;
}

function toggleSelectAll() {
  if (allVisibleSelected.value) clearSelection();
  else selectedItemIds.value = new Set(visibleItems.value.map((item) => item.itemId));
}

function applyUpdatedItemRecords(
  updates: Array<{ item: DisplayVaultItem; metadata: PrivateVaultItemMetadata }>,
  records: PrivateVaultItem[]
) {
  const recordById = new Map(records.map((record) => [record.itemId, record]));
  const metadataById = new Map(updates.map((update) => [update.item.itemId, update.metadata]));
  items.value = items.value.map((item) => {
    const record = recordById.get(item.itemId);
    const metadata = metadataById.get(item.itemId);
    return record && metadata ? { ...record, metadata } : item;
  });
}

async function moveItemsToFolder(
  itemIds: string[],
  destinationFolderId: string | null,
  offerUndo = true,
  throwOnError = false
): Promise<boolean> {
  const key = vaultKey.value;
  if (!key) {
    if (throwOnError) throw new Error("Unlock the private vault before moving files.");
    return false;
  }
  const uniqueIds = [...new Set(itemIds)];
  const updates = uniqueIds.flatMap((itemId) => {
    const item = items.value.find((candidate) => candidate.itemId === itemId);
    if (!item?.metadata || (item.metadata.folderId ?? null) === destinationFolderId) return [];
    const metadata: PrivateVaultItemMetadata = { ...item.metadata, folder: "", folderId: destinationFolderId };
    return [{ item, metadata, encryptedMetadata: updatePrivateVaultItemMetadata(key, item, metadata) }];
  });
  if (!updates.length) return true;
  try {
    const records = await updateItemMetadataInBatches(
      updates.map((update) => ({ itemId: update.item.itemId, encryptedMetadata: update.encryptedMetadata }))
    );
    applyUpdatedItemRecords(updates, records);
    clearSelection();
    if (offerUndo) {
      moveUndo.value = {
        items: updates.map((update) => ({
          itemId: update.item.itemId,
          previousFolderId: update.item.metadata?.folderId ?? null
        })),
        label: `${updates.length} ${updates.length === 1 ? "file" : "files"} moved to ${folderName(destinationFolderId)}`
      };
      if (moveUndoTimer) clearTimeout(moveUndoTimer);
      moveUndoTimer = setTimeout(() => { moveUndo.value = null; }, 10_000);
    }
    toasts.success("Files moved", `${updates.length} ${updates.length === 1 ? "file is" : "files are"} now in ${folderName(destinationFolderId)}.`);
    return true;
  } catch (error) {
    await reloadItems().catch(() => undefined);
    if (throwOnError) throw error;
    toasts.error("Files not moved", error instanceof Error ? error.message : "Unable to move the selected files.");
    return false;
  }
}

async function undoLastMove() {
  const key = vaultKey.value;
  const undo = moveUndo.value;
  if (!key || !undo) return;
  const updates = undo.items.flatMap(({ itemId, previousFolderId }) => {
    const item = items.value.find((candidate) => candidate.itemId === itemId);
    if (!item?.metadata) return [];
    const metadata: PrivateVaultItemMetadata = { ...item.metadata, folder: "", folderId: previousFolderId };
    return [{ item, metadata, encryptedMetadata: updatePrivateVaultItemMetadata(key, item, metadata) }];
  });
  moveUndo.value = null;
  if (moveUndoTimer) clearTimeout(moveUndoTimer);
  moveUndoTimer = null;
  try {
    const records = await updateItemMetadataInBatches(
      updates.map((update) => ({ itemId: update.item.itemId, encryptedMetadata: update.encryptedMetadata }))
    );
    applyUpdatedItemRecords(updates, records);
    toasts.success("Move undone", "The files returned to their previous folders.");
  } catch (error) {
    await reloadItems().catch(() => undefined);
    toasts.error("Move not undone", error instanceof Error ? error.message : "Unable to restore the previous locations.");
  }
}

function openMoveDialog(itemIds = selectedItems.value.map((item) => item.itemId)) {
  if (!itemIds.length) return;
  selectedItemIds.value = new Set(itemIds);
  moveDestinationId.value = smartView.value === null ? currentFolderId.value : null;
  showMoveDialog.value = true;
  contextMenu.value = null;
}

async function confirmMoveDialog() {
  const ids = selectedItems.value.map((item) => item.itemId);
  showMoveDialog.value = false;
  await moveItemsToFolder(ids, moveDestinationId.value);
}

async function toggleFavorite(item: DisplayVaultItem) {
  if (!canWriteVault.value) return;
  const key = vaultKey.value;
  if (!key || !item.metadata) return;
  const metadata: PrivateVaultItemMetadata = { ...item.metadata, favorite: !item.metadata.favorite };
  try {
    const encryptedMetadata = updatePrivateVaultItemMetadata(key, item, metadata);
    const record = await client.updatePrivateVaultItemMetadata(item.itemId, encryptedMetadata);
    const index = items.value.findIndex((candidate) => candidate.itemId === item.itemId);
    if (index !== -1) items.value[index] = { ...record, metadata };
  } catch (error) {
    toasts.error("Favorite not changed", error instanceof Error ? error.message : "Unable to update this file.");
  }
}

function openItemContextMenu(event: MouseEvent, item: DisplayVaultItem) {
  if (!selectedItemIds.value.has(item.itemId)) selectedItemIds.value = new Set([item.itemId]);
  contextMenu.value = {
    kind: "item",
    id: item.itemId,
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 224)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 260))
  };
}

function openFolderContextMenu(event: MouseEvent, folder: DisplayVaultFolder) {
  contextMenu.value = {
    kind: "folder",
    id: folder.folderId,
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 224)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 220))
  };
}

async function trashSelectedItems() {
  if (!canWriteVault.value) return;
  const selected = selectedItems.value.filter((item) => item.metadata);
  if (!selected.length) return;
  const label = selected.length === 1 ? `“${selected[0].metadata?.fileName}”` : `${selected.length} selected files`;
  if (!window.confirm(`Move ${label} to the private vault trash?`)) return;
  try {
    await Promise.all(selected.map((item) => client.trashPrivateVaultItem(item.itemId)));
    const ids = new Set(selected.map((item) => item.itemId));
    items.value = items.value.filter((item) => !ids.has(item.itemId));
    clearSelection();
    toasts.success("Moved to private trash", `${selected.length} encrypted ${selected.length === 1 ? "file was" : "files were"} retained in trash.`);
  } catch (error) {
    await reloadItems();
    toasts.error("Files not moved", error instanceof Error ? error.message : "Unable to move all selected files to trash.");
  }
}

function beginEdit(item: DisplayVaultItem) {
  if (!item.metadata) return;
  editItem.value = item;
  editFileName.value = item.metadata.fileName;
  editFolderId.value = item.metadata.folderId ?? null;
  editNote.value = item.metadata.note;
  editTagsInput.value = (item.metadata.tags ?? []).join(", ");
  contextMenu.value = null;
}

async function saveMetadata() {
  if (!canWriteVault.value) return;
  const key = vaultKey.value;
  const item = editItem.value;
  if (!key || !item?.metadata || savingMetadata.value) return;
  const nextMetadata: PrivateVaultItemMetadata = {
    ...item.metadata,
    fileName: editFileName.value.trim() || item.metadata.fileName,
    folder: "",
    folderId: editFolderId.value,
    tags: normalizeTags(editTagsInput.value),
    note: editNote.value.trim()
  };
  savingMetadata.value = true;
  try {
    const encryptedMetadata = updatePrivateVaultItemMetadata(key, item, nextMetadata);
    const updated = await client.updatePrivateVaultItemMetadata(item.itemId, encryptedMetadata);
    const index = items.value.findIndex((candidate) => candidate.itemId === item.itemId);
    if (index !== -1) items.value[index] = { ...updated, metadata: nextMetadata };
    closeEdit();
    toasts.success("Private file details saved", "The updated name and notes remain encrypted.");
  } catch (error) {
    toasts.error("Details not saved", error instanceof Error ? error.message : "Unable to update encrypted metadata.");
  } finally {
    savingMetadata.value = false;
  }
}

async function trashItem(item: DisplayVaultItem) {
  if (!canWriteVault.value) return;
  if (!item.metadata || !window.confirm(`Move “${item.metadata.fileName}” to the private vault trash?`)) return;
  try {
    await client.trashPrivateVaultItem(item.itemId);
    items.value = items.value.filter((candidate) => candidate.itemId !== item.itemId);
    toasts.success("Moved to private trash", "The encrypted object is retained until permanent deletion.");
  } catch (error) {
    toasts.error("File not moved", error instanceof Error ? error.message : "Unable to move this file to trash.");
  }
}

async function restoreItem(item: DisplayVaultItem) {
  if (!canWriteVault.value) return;
  try {
    await client.restorePrivateVaultItem(item.itemId);
    items.value = items.value.filter((candidate) => candidate.itemId !== item.itemId);
    toasts.success("Private file restored", "The file is back in the active vault.");
  } catch (error) {
    toasts.error("File not restored", error instanceof Error ? error.message : "Unable to restore this file.");
  }
}

async function purgeItem(item: DisplayVaultItem) {
  if (!canWriteVault.value) return;
  const fileName = item.metadata?.fileName ?? "this encrypted file";
  if (!window.confirm(`Permanently delete “${fileName}”? This removes the current MinIO object and cannot be undone.`)) return;
  try {
    await client.purgePrivateVaultItem(item.itemId);
    items.value = items.value.filter((candidate) => candidate.itemId !== item.itemId);
    toasts.success("Private file permanently deleted", "The active encrypted object was removed from storage.");
  } catch (error) {
    toasts.error("File not deleted", error instanceof Error ? error.message : "Unable to permanently delete this file.");
  }
}

onMounted(() => {
  vaultRouteReady.value = true;
  void loadVault();
  for (const eventName of ["pointerdown", "touchstart", "scroll"] as const) {
    window.addEventListener(eventName, registerActivity, { passive: true });
  }
  window.addEventListener("keydown", onWindowKeydown);
  window.addEventListener("resize", onPreviewWindowResize);
  window.addEventListener("click", closeContextMenu);
  document.addEventListener("fullscreenchange", onPreviewFullscreenChange);
});

onBeforeUnmount(() => {
  for (const eventName of ["pointerdown", "touchstart", "scroll"] as const) {
    window.removeEventListener(eventName, registerActivity);
  }
  window.removeEventListener("keydown", onWindowKeydown);
  window.removeEventListener("resize", onPreviewWindowResize);
  window.removeEventListener("click", closeContextMenu);
  document.removeEventListener("fullscreenchange", onPreviewFullscreenChange);
  if (moveUndoTimer) clearTimeout(moveUndoTimer);
  clearPreviewControlsTimer();
  lockVault(false);
});
</script>

<template>
  <section class="vault-page" :class="{ 'vault-is-unlocked': unlocked }">
    <header v-if="!loading" class="vault-workspace-header">
      <div>
        <p class="vault-eyebrow"><ShieldCheck /> PRIVATE STORAGE</p>
        <h1>Private vault</h1>
        <p>Password-protected files, images, and private notes.</p>
      </div>
      <div v-if="unlocked" class="vault-session-actions">
        <label class="vault-auto-lock">
          <span>Auto-lock</span>
          <select :value="vault?.autoLockMinutes" :disabled="!canWriteVault" @change="changeAutoLock">
            <option :value="5">5 min</option>
            <option :value="10">10 min</option>
            <option :value="30">30 min</option>
          </select>
        </label>
        <span class="vault-countdown"><Lock />{{ autoLockLabel }}</span>
        <button v-if="canWriteVault" type="button" class="vault-secondary-action" @click="showPasswordChange = true; pageError = ''">
          <KeyRound /> Password
        </button>
        <button type="button" class="vault-lock-button" @click="lockVault(true)">
          <Lock /> Lock now
        </button>
      </div>
      <span v-else-if="vault" class="vault-header-status"><Lock /> Locked</span>
    </header>

    <p v-if="vault && !canWriteVault">Read access only. You can unlock, preview and download your existing files.</p>
    <div v-if="loading" class="vault-loading">
      <LockKeyhole class="h-7 w-7" />
      <span>Checking private vault…</span>
    </div>

    <p v-else-if="!vault && !canWriteVault" class="vault-loading">This account can read an existing private vault. Creating a vault requires write access.</p>
    <template v-else-if="!vault">
      <div class="vault-onboarding">
        <div class="vault-onboarding-copy">
          <p class="vault-eyebrow"><ShieldCheck /> PRIVATE STORAGE</p>
          <h2>Create your private vault</h2>
          <p class="vault-lead">
            File contents, names, folders, and notes are encrypted in this browser before they reach private storage.
          </p>
          <div class="vault-security-lines">
            <p><span>01</span> MinIO receives encrypted objects only.</p>
            <p><span>02</span> The vault locks when you leave this page or after inactivity.</p>
            <p><span>03</span> Your account password can authorize a vault-password reset.</p>
          </div>
        </div>
        <form class="vault-create-form" @submit.prevent="createVault">
          <div class="vault-lock-mark"><LockKeyhole /></div>
          <h2>Set a separate password</h2>
          <p>Choose a password for this vault. Normal unlocks happen entirely in this browser.</p>
          <label>
            Private vault password
            <input v-model="createPassword" name="private-vault-create-password" autocomplete="new-password" type="password" required autofocus />
          </label>
          <label>
            Confirm password
            <input v-model="confirmCreatePassword" name="private-vault-create-password-confirmation" autocomplete="new-password" type="password" required />
          </label>
          <p v-if="pageError" class="vault-error"><AlertTriangle />{{ pageError }}</p>
          <button class="vault-primary-action" type="submit" :disabled="creating">
            <ShieldCheck />{{ creating ? "Creating encrypted vault…" : "Create private vault" }}
          </button>
        </form>
      </div>
    </template>

    <template v-else-if="!unlocked">
      <div class="vault-lock-screen">
        <div class="vault-lock-visual" aria-hidden="true">
          <div class="vault-lock-ring"><LockKeyhole /></div>
          <strong>Vault locked</strong>
          <span>Names and previews are hidden.</span>
        </div>
        <form class="vault-unlock-form" @submit.prevent="unlockVault">
          <p class="vault-eyebrow"><Lock /> LOCAL DECRYPTION</p>
          <h2>Unlock private vault</h2>
          <p class="vault-lead">Enter the vault password to decrypt file names and open your private files in this tab.</p>
          <label>
            Vault password
            <input
              ref="unlockInput"
              v-model="unlockPassword"
              name="private-vault-unlock-password"
              autocomplete="off"
              data-1p-ignore
              data-lpignore="true"
              type="password"
              autofocus
            />
          </label>
          <p v-if="pageError" class="vault-error"><AlertTriangle />{{ pageError }}</p>
          <button class="vault-primary-action" type="submit" :disabled="unlocking || !unlockPassword">
            <KeyRound />{{ unlocking ? "Deriving key…" : "Unlock private vault" }}
          </button>
          <button v-if="canWriteVault" class="vault-text-action" type="button" @click="showReset = true; pageError = ''">
            Forgot the vault password?
          </button>
          <p class="vault-lock-note">Refreshing, signing out, or leaving this page clears the decryption key.</p>
        </form>
      </div>
    </template>

    <template v-else>
      <div
        class="vault-workspace"
        :class="{ 'vault-workspace--resizing': vaultSidebarResizing }"
        :style="{ '--vault-folder-rail-width': `${vaultSidebarWidth}px` }"
      >
        <aside id="private-vault-folder-navigation" class="vault-folder-rail">
          <div class="vault-rail-heading"><span>Smart views</span></div>
          <button :class="{ active: smartView === 'all' }" type="button" @click="selectSmartView('all')">
            <Files /> <span>All private files</span><small>{{ activeItems.length }}</small>
          </button>
          <button :class="{ active: smartView === 'recent' }" type="button" @click="selectSmartView('recent')">
            <Clock3 /> <span>Recent</span>
          </button>
          <button :class="{ active: smartView === 'favorites' }" type="button" @click="selectSmartView('favorites')">
            <Star /> <span>Favorites</span>
          </button>
          <button :class="{ active: smartView === 'images' }" type="button" @click="selectSmartView('images')">
            <Images /> <span>Images</span>
          </button>
          <button :class="{ active: smartView === 'documents' }" type="button" @click="selectSmartView('documents')">
            <FileText /> <span>Documents</span>
          </button>

          <div class="vault-rail-heading vault-folder-heading">
            <span>Folders</span>
            <span>{{ activeFolders.length }}</span>
            <button v-if="canWriteVault" type="button" title="New folder" @click="beginCreateFolder()"><FolderPlus /></button>
          </div>
          <div class="vault-folder-tree" role="tree" aria-label="Private folders">
            <div
              class="vault-tree-row vault-root-row"
              :class="{ active: smartView === null && currentFolderId === null, 'drop-target': dragTargetFolderId === null }"
              role="treeitem"
              :aria-level="1"
              aria-expanded="true"
              @dragover="onFolderDragOver($event, null)"
              @dragleave="onFolderDragLeave($event, null)"
              @drop="onFolderDrop($event, null)"
            >
              <span class="vault-tree-indent" />
              <button type="button" @click="selectFolder(null)"><FolderOpen /><span>My vault</span></button>
            </div>
            <div
              v-for="row in folderRows"
              :key="row.folder.folderId"
              class="vault-tree-row vault-child-row"
              :class="{
                active: currentFolderId === row.folder.folderId && smartView === null,
                'drop-target': dragTargetFolderId === row.folder.folderId
              }"
              :style="{ '--folder-depth': row.depth + 1 }"
              role="treeitem"
              :aria-level="row.depth + 2"
              :aria-expanded="row.hasChildren ? expandedFolderIds.has(row.folder.folderId) : undefined"
              :draggable="canWriteVault"
              @dragstart="onFolderDragStart($event, row.folder)"
              @dragend="resetDragState"
              @dragover="onFolderDragOver($event, row.folder.folderId)"
              @dragleave="onFolderDragLeave($event, row.folder.folderId)"
              @drop="onFolderDrop($event, row.folder.folderId)"
              @contextmenu.prevent="openFolderContextMenu($event, row.folder)"
            >
              <button
                class="vault-tree-toggle"
                type="button"
                :disabled="!row.hasChildren"
                :aria-label="row.hasChildren ? (expandedFolderIds.has(row.folder.folderId) ? 'Collapse folder' : 'Expand folder') : undefined"
                @click="toggleFolderExpanded(row.folder.folderId)"
              >
                <ChevronDown v-if="row.hasChildren && expandedFolderIds.has(row.folder.folderId)" />
                <ChevronRight v-else-if="row.hasChildren" />
              </button>
              <button class="vault-tree-open" type="button" :title="row.folder.metadata?.name ?? 'Encrypted folder unavailable'" @click="selectFolder(row.folder.folderId)">
                <Folder /><span>{{ row.folder.metadata?.name ?? 'Encrypted folder unavailable' }}</span>
              </button>
              <button class="vault-tree-more" type="button" title="Folder actions" @click.stop="openFolderContextMenu($event, row.folder)">
                <MoreHorizontal />
              </button>
            </div>
          </div>

          <button :class="{ active: smartView === 'unfiled' }" type="button" @click="selectSmartView('unfiled')">
            <FolderInput /> <span>Unfiled</span>
          </button>
          <template v-if="tagRows.length">
            <div class="vault-rail-heading vault-tag-heading"><span>Tags</span><span>{{ tagRows.length }}</span></div>
            <button
              v-for="tag in tagRows"
              :key="tag.name"
              :class="{ active: smartView === 'tag' && selectedTag === tag.name }"
              type="button"
              @click="selectTag(tag.name)"
            >
              <Tags /> <span>#{{ tag.name }}</span><small>{{ tag.count }}</small>
            </button>
          </template>
          <div class="vault-rail-spacer" />
          <button :class="{ active: smartView === 'trash' }" type="button" @click="selectSmartView('trash')">
            <Trash2 /> <span>Private trash</span>
          </button>
          <p>Trash keeps encrypted objects until you permanently delete them.</p>
        </aside>

        <button
          class="panel-resize-handle vault-panel-resize"
          type="button"
          role="separator"
          aria-orientation="vertical"
          aria-controls="private-vault-folder-navigation"
          :aria-valuemin="vaultSidebarMinWidth"
          :aria-valuemax="vaultSidebarMaxWidth"
          :aria-valuenow="vaultSidebarWidth"
          aria-label="Resize private folder tree"
          title="Drag to resize the folder tree. Double-click to restore the default width."
          @pointerdown="startVaultSidebarResize"
          @keydown="onVaultSidebarResizeKeydown"
          @dblclick="resetVaultSidebarWidth"
        />

        <main
          class="vault-file-workspace"
          :class="{ 'is-dragging': dragging }"
          @dragenter.prevent="onWorkspaceDrag"
          @dragover.prevent="onWorkspaceDrag"
          @dragleave.self="dragging = false"
          @drop.prevent="onDrop"
        >
          <div class="vault-location-bar">
            <div class="vault-breadcrumbs" aria-label="Current private vault location">
              <template v-if="smartView === null">
                <button type="button" @click="selectFolder(null)"><FolderOpen /> My vault</button>
                <template v-for="folder in breadcrumbFolders" :key="folder.folderId">
                  <ChevronRight />
                  <button type="button" @click="selectFolder(folder.folderId)">{{ folder.metadata?.name }}</button>
                </template>
              </template>
              <strong v-else>{{ currentLocationLabel }}</strong>
            </div>
            <span>{{ visibleItems.length }} {{ visibleItems.length === 1 ? 'file' : 'files' }}</span>
          </div>

          <div v-if="!showTrash" class="vault-selection-toolbar" aria-label="Selected private file actions">
            <strong aria-live="polite">{{ selectedItems.length }} selected</strong>
            <button v-if="canWriteVault" type="button" :disabled="!selectedItems.length" @click="openMoveDialog()"><Move /> Move to…</button>
            <button v-if="canWriteVault" type="button" :disabled="!selectedItems.length" @click="trashSelectedItems"><Trash2 /> Trash</button>
            <button type="button" :disabled="!selectedItems.length" @click="clearSelection"><X /> Clear</button>
          </div>
          <div class="vault-file-toolbar">
            <div class="vault-search"><Search /><input v-model="search" type="search" placeholder="Search this view" /></div>
            <div class="vault-toolbar-actions">
              <div class="vault-sort-controls" role="group" aria-label="Private file sorting">
                <span class="vault-sort-label">Sort</span>
                <select v-model="sortField" aria-label="Sort private files by">
                  <option value="name">Name</option>
                  <option value="location">Location</option>
                  <option value="updated">Modified</option>
                  <option value="opened">Last opened</option>
                  <option value="size">Size</option>
                  <option value="type">File type</option>
                </select>
                <button class="vault-sort-direction" type="button" :title="sortDirectionTitle" :aria-label="sortDirectionTitle" @click="toggleSortDirection">
                  <component :is="activeSortIcon" />
                  <span>{{ sortDirectionLabel }}</span>
                </button>
              </div>
              <div class="vault-view-switch" role="group" aria-label="Private file view">
                <button type="button" title="List view" :aria-pressed="viewMode === 'list'" :class="{ active: viewMode === 'list' }" @click="setViewMode('list')"><List /></button>
                <button type="button" title="Grid view" :aria-pressed="viewMode === 'grid'" :class="{ active: viewMode === 'grid' }" @click="setViewMode('grid')"><Grid2X2 /></button>
              </div>
              <button v-if="!showTrash && canWriteVault" class="vault-secondary-action compact" type="button" @click="beginCreateFolder()">
                <FolderPlus /> New folder
              </button>
              <button v-if="!showTrash && canWriteVault" class="vault-secondary-action compact" type="button" :disabled="uploading" @click="folderInput?.click()">
                <FolderUp /> Upload folder
              </button>
              <button v-if="!showTrash && canWriteVault" class="vault-primary-action compact" type="button" :disabled="uploading" @click="fileInput?.click()">
                <UploadCloud />{{ uploading ? 'Encrypting…' : 'Add files' }}
              </button>
              <input v-if="canWriteVault" ref="fileInput" class="sr-only" type="file" multiple @change="uploadFiles(($event.target as HTMLInputElement).files ?? [])" />
              <input
                v-if="canWriteVault"
                ref="folderInput"
                class="sr-only"
                type="file"
                multiple
                webkitdirectory
                directory
                @change="uploadFolderFiles(($event.target as HTMLInputElement).files ?? [])"
              />
            </div>
          </div>

          <div v-if="moveUndo" class="vault-undo-bar">
            <span>{{ moveUndo.label }}</span><button type="button" @click="undoLastMove"><Undo2 /> Undo</button>
          </div>

          <div v-if="uploadStatus" class="vault-upload-status">
            <div>
              <span>Encrypting {{ uploadStatus.index }} of {{ uploadStatus.total }}</span>
              <strong>{{ uploadStatus.name }}</strong>
            </div>
            <div class="vault-progress"><span :style="{ width: `${Math.round(uploadStatus.progress * 100)}%` }" /></div>
          </div>

          <div v-if="dragging" class="vault-drop-message">
            <UploadCloud />
            <strong>Drop to encrypt and store</strong>
            <span>Original files never pass through the server unencrypted.</span>
          </div>

          <div
            v-else-if="visibleChildFolders.length || visibleItems.length"
            class="vault-file-grid"
            :class="{ 'is-tile-view': viewMode === 'grid' }"
          >
            <div class="vault-file-columns">
              <input type="checkbox" :checked="allVisibleSelected" aria-label="Select all visible files" @change="toggleSelectAll" />
              <button
                class="vault-column-sort vault-column-sort--name"
                :class="{ active: sortField === 'name' }"
                type="button"
                @click="sortFromColumn('name')"
              >Name <component :is="sortField === 'name' ? activeSortIcon : ArrowUpDown" /></button>
              <button
                class="vault-column-sort"
                :class="{ active: sortField === 'location' }"
                type="button"
                @click="sortFromColumn('location')"
              >Location <component :is="sortField === 'location' ? activeSortIcon : ArrowUpDown" /></button>
              <button
                class="vault-column-sort vault-column-sort--size"
                :class="{ active: sortField === 'size' }"
                type="button"
                @click="sortFromColumn('size')"
              >Size <component :is="sortField === 'size' ? activeSortIcon : ArrowUpDown" /></button>
              <button
                class="vault-column-sort"
                :class="{ active: sortField === 'updated' }"
                type="button"
                @click="sortFromColumn('updated')"
              >Modified <component :is="sortField === 'updated' ? activeSortIcon : ArrowUpDown" /></button>
              <span />
            </div>
            <article
              v-for="folder in visibleChildFolders"
              :key="folder.folderId"
              class="vault-file-item vault-folder-item"
              :class="{ 'drop-target': dragTargetFolderId === folder.folderId }"
              :draggable="canWriteVault"
              @dragstart="onFolderDragStart($event, folder)"
              @dragend="resetDragState"
              @dragover="onFolderDragOver($event, folder.folderId)"
              @dragleave="onFolderDragLeave($event, folder.folderId)"
              @drop="onFolderDrop($event, folder.folderId)"
              @contextmenu.prevent="openFolderContextMenu($event, folder)"
            >
              <span />
              <button class="vault-file-open" type="button" @dblclick="selectFolder(folder.folderId)" @click="selectFolder(folder.folderId)">
                <span class="vault-file-icon"><Folder /></span>
                <span class="vault-file-copy"><strong>{{ folder.metadata?.name }}</strong><span>Encrypted folder</span></span>
              </button>
              <span class="vault-file-location">{{ folderName(folder.metadata?.parentFolderId) }}</span>
              <span>—</span><span>{{ formatDate(folder.updatedAt) }}</span>
              <div class="vault-file-actions">
                <button type="button" title="Folder actions" @click.stop="openFolderContextMenu($event, folder)"><MoreHorizontal /></button>
              </div>
            </article>
            <article
              v-for="item in visibleItems"
              :key="item.itemId"
              class="vault-file-item"
              :class="{ selected: selectedItemIds.has(item.itemId) }"
              :draggable="!showTrash && canWriteVault"
              @click="selectItem(item, $event)"
              @dblclick="openPreview(item)"
              @dragstart="onItemDragStart($event, item)"
              @dragend="resetDragState"
              @contextmenu.prevent="openItemContextMenu($event, item)"
            >
              <input
                type="checkbox"
                :checked="selectedItemIds.has(item.itemId)"
                :aria-label="`Select ${item.metadata?.fileName ?? 'private file'}`"
                @click.stop
                @change="toggleItemSelection(item.itemId, ($event.target as HTMLInputElement).checked)"
              />
              <button class="vault-file-open" type="button" :disabled="!item.metadata" @click.stop="selectItem(item, $event)" @dblclick.stop="openPreview(item)">
                <span class="vault-file-icon">
                  <component :is="itemIcon(item)" />
                  <small>{{ item.metadata ? extension(item.metadata.fileName) : "ERR" }}</small>
                </span>
                <span class="vault-file-copy">
                  <strong>{{ item.metadata?.fileName ?? "Encrypted metadata unavailable" }}</strong>
                  <span v-if="item.metadata">{{ item.metadata.mimeType || 'Unknown type' }}</span>
                  <span v-else>{{ item.metadataError }}</span>
                  <span v-if="item.metadata?.tags?.length" class="vault-item-tags">
                    <small v-for="tag in item.metadata.tags.slice(0, 3)" :key="tag">#{{ tag }}</small>
                    <small v-if="item.metadata.tags.length > 3">+{{ item.metadata.tags.length - 3 }}</small>
                  </span>
                </span>
              </button>
              <span class="vault-file-location">{{ folderName(item.metadata?.folderId) }}</span>
              <span>{{ item.metadata ? formatBytes(item.metadata.size) : '—' }}</span>
              <span>{{ formatDate(item.updatedAt) }}</span>
              <div class="vault-file-actions">
                <template v-if="!showTrash">
                  <button
                    v-if="canWriteVault"
                    :class="{ favorite: item.metadata?.favorite }"
                    type="button"
                    :title="item.metadata?.favorite ? 'Remove favorite' : 'Favorite'"
                    :aria-pressed="item.metadata?.favorite === true"
                    :disabled="!item.metadata"
                    @click.stop="toggleFavorite(item)"
                  ><Star /></button>
                  <button type="button" title="Preview" :disabled="!item.metadata" @click.stop="openPreview(item)"><Eye /></button>
                  <button type="button" title="More actions" :disabled="!item.metadata" @click.stop="openItemContextMenu($event, item)"><MoreHorizontal /></button>
                </template>
                <template v-else>
                  <button v-if="canWriteVault" type="button" title="Restore" @click.stop="restoreItem(item)"><RotateCcw /></button>
                  <button v-if="canWriteVault" class="danger" type="button" title="Delete permanently" @click.stop="purgeItem(item)"><Trash2 /></button>
                </template>
              </div>
            </article>
          </div>

          <div v-else class="vault-empty-state">
            <div><component :is="showTrash ? Trash2 : LockKeyhole" /></div>
            <h2>{{ showTrash ? 'Private trash is empty' : search ? 'No private files match' : `Nothing in ${currentLocationLabel}` }}</h2>
            <p v-if="!showTrash && !search && canWriteVault">Drop files here, create a folder, or add encrypted files.</p>
            <button v-if="!showTrash && !search && canWriteVault" class="vault-secondary-action" type="button" @click="fileInput?.click()">
              <UploadCloud /> Choose files
            </button>
          </div>
        </main>
      </div>
    </template>
  </section>

  <div
    v-if="contextMenu"
    class="vault-context-menu"
    :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
    role="menu"
    @click.stop
    @pointerdown.stop
  >
    <template v-if="contextItem">
      <button type="button" @click="openPreview(contextItem); contextMenu = null"><Eye /> Open preview</button>
      <button type="button" @click="downloadItem(contextItem); contextMenu = null"><Download /> Download</button>
      <button v-if="canWriteVault" type="button" @click="toggleFavorite(contextItem); contextMenu = null"><Star />{{ contextItem.metadata?.favorite ? 'Remove favorite' : 'Add favorite' }}</button>
      <button v-if="canWriteVault" type="button" @click="openMoveDialog([contextItem.itemId])"><Move /> Move to…</button>
      <button v-if="canWriteVault" type="button" @click="beginEdit(contextItem)"><Pencil /> Rename & details</button>
      <button v-if="canWriteVault" class="danger" type="button" @click="trashItem(contextItem); contextMenu = null"><Trash2 /> Move to trash</button>
    </template>
    <template v-else-if="contextFolder">
      <button type="button" @click="selectFolder(contextFolder.folderId); contextMenu = null"><FolderOpen /> Open folder</button>
      <button v-if="canWriteVault" type="button" @click="beginCreateSubfolder(contextFolder)"><FolderPlus /> New subfolder</button>
      <button v-if="canWriteVault" type="button" @click="beginEditFolder(contextFolder)"><Pencil /> Rename or move</button>
      <button v-if="canWriteVault" class="danger" type="button" @click="deleteFolder(contextFolder); contextMenu = null"><Trash2 /> Remove folder</button>
    </template>
  </div>

  <div v-if="showReset" class="vault-modal-backdrop" @mousedown.self="closeReset">
    <form class="vault-modal" @submit.prevent="resetVaultPassword">
      <button class="vault-modal-close" type="button" aria-label="Close" @click="closeReset"><X /></button>
      <p class="vault-eyebrow"><KeyRound /> ACCOUNT RECOVERY</p>
      <h2>Reset vault password</h2>
      <p>Your account password authorizes the server to rewrap the existing vault key. Files are not decrypted or uploaded again.</p>
      <label>Current account password<input v-model="resetAccountPassword" type="password" autocomplete="current-password" /></label>
      <label>New vault password<input v-model="resetPassword" type="password" autocomplete="new-password" required /></label>
      <label>Confirm new vault password<input v-model="resetPasswordConfirm" type="password" autocomplete="new-password" required /></label>
      <p v-if="pageError" class="vault-error"><AlertTriangle />{{ pageError }}</p>
      <button class="vault-primary-action" type="submit" :disabled="resetting">
        <KeyRound />{{ resetting ? "Resetting…" : "Reset vault password" }}
      </button>
    </form>
  </div>

  <div v-if="showPasswordChange" class="vault-modal-backdrop" @mousedown.self="closePasswordChange">
    <form class="vault-modal" @submit.prevent="changeVaultPassword">
      <button class="vault-modal-close" type="button" aria-label="Close" @click="closePasswordChange"><X /></button>
      <p class="vault-eyebrow"><KeyRound /> VAULT SETTINGS</p>
      <h2>Change vault password</h2>
      <p>Only the encrypted key envelope changes. Existing private files remain in place.</p>
      <label>New vault password<input v-model="nextPassword" type="password" autocomplete="new-password" required /></label>
      <label>Confirm new vault password<input v-model="nextPasswordConfirm" type="password" autocomplete="new-password" required /></label>
      <p v-if="pageError" class="vault-error"><AlertTriangle />{{ pageError }}</p>
      <button class="vault-primary-action" type="submit" :disabled="changingPassword">
        <ShieldCheck />{{ changingPassword ? "Changing…" : "Change password" }}
      </button>
    </form>
  </div>

  <div v-if="editItem" class="vault-modal-backdrop" @mousedown.self="closeEdit">
    <form class="vault-modal" @submit.prevent="saveMetadata">
      <button class="vault-modal-close" type="button" aria-label="Close" @click="closeEdit"><X /></button>
      <p class="vault-eyebrow"><Pencil /> ENCRYPTED DETAILS</p>
      <h2>Organize private file</h2>
      <p>The name, folder, and note are encrypted again before they are saved.</p>
      <label>File name<input v-model="editFileName" type="text" maxlength="500" /></label>
      <label>Folder
        <select v-model="editFolderId">
          <option :value="null">Unfiled</option>
          <option v-for="option in folderOptions" :key="option.folder.folderId" :value="option.folder.folderId">{{ option.path }}</option>
        </select>
      </label>
      <label>Tags
        <input v-model="editTagsInput" type="text" maxlength="2400" placeholder="family, identity, 2026" />
        <small class="vault-field-hint">Separate encrypted tags with commas. Up to 30 tags are kept.</small>
      </label>
      <label>Private note<textarea v-model="editNote" rows="4" maxlength="5000" /></label>
      <button class="vault-primary-action" type="submit" :disabled="savingMetadata">
        <ShieldCheck />{{ savingMetadata ? "Encrypting details…" : "Save encrypted details" }}
      </button>
    </form>
  </div>

  <div v-if="showFolderDialog" class="vault-modal-backdrop" @mousedown.self="closeFolderDialog">
    <form class="vault-modal" @submit.prevent="saveFolder">
      <button class="vault-modal-close" type="button" aria-label="Close" @click="closeFolderDialog"><X /></button>
      <p class="vault-eyebrow"><FolderPlus /> ENCRYPTED FOLDER</p>
      <h2>{{ folderDialogMode === 'create' ? 'Create a private folder' : 'Rename or move folder' }}</h2>
      <p>The folder name and its parent location are encrypted before they are saved.</p>
      <label>Folder name<input v-model="folderNameInput" type="text" maxlength="200" autofocus /></label>
      <label>Parent folder
        <select v-model="folderParentInput">
          <option :value="null">My vault</option>
          <option
            v-for="option in folderParentOptions"
            :key="option.folder.folderId"
            :value="option.folder.folderId"
          >{{ option.path }}</option>
        </select>
      </label>
      <p v-if="pageError" class="vault-error"><AlertTriangle />{{ pageError }}</p>
      <button class="vault-primary-action" type="submit" :disabled="savingFolder">
        <FolderPlus />{{ savingFolder ? 'Encrypting folder…' : folderDialogMode === 'create' ? 'Create folder' : 'Save folder' }}
      </button>
    </form>
  </div>

  <div v-if="showMoveDialog" class="vault-modal-backdrop" @mousedown.self="showMoveDialog = false">
    <form class="vault-modal" @submit.prevent="confirmMoveDialog">
      <button class="vault-modal-close" type="button" aria-label="Close" @click="showMoveDialog = false"><X /></button>
      <p class="vault-eyebrow"><Move /> MOVE FILES</p>
      <h2>Choose a destination</h2>
      <p>Only encrypted file metadata changes. File contents remain in place.</p>
      <label>Destination
        <select v-model="moveDestinationId" autofocus>
          <option :value="null">Unfiled</option>
          <option v-for="option in folderOptions" :key="option.folder.folderId" :value="option.folder.folderId">{{ option.path }}</option>
        </select>
      </label>
      <button class="vault-primary-action" type="submit"><Move /> Move {{ selectedItems.length }} {{ selectedItems.length === 1 ? 'file' : 'files' }}</button>
    </form>
  </div>

  <div
    v-if="previewItem"
    class="vault-preview-backdrop"
    @mousedown.self="closePreview"
    @wheel.self.prevent
    @touchmove.self.prevent
  >
    <section ref="previewDialog" class="vault-preview" role="dialog" aria-modal="true" :aria-label="previewItem.metadata?.fileName">
      <header>
        <div class="vault-preview-heading">
          <p class="vault-eyebrow"><ShieldCheck /> DECRYPTED PREVIEW</p>
          <h2>{{ previewItem.metadata?.fileName }}</h2>
        </div>
        <div v-if="previewKind === 'image'" class="vault-preview-toolbar" role="toolbar" aria-label="Image controls">
          <button type="button" title="Zoom out (−)" aria-label="Zoom out" :disabled="previewLoading" @click="zoomPreviewImage(1 / 1.25)"><ZoomOut /></button>
          <span class="vault-preview-zoom" aria-live="polite">{{ previewZoomLabel }}</span>
          <button type="button" title="Zoom in (+)" aria-label="Zoom in" :disabled="previewLoading" @click="zoomPreviewImage(1.25)"><ZoomIn /></button>
          <i aria-hidden="true" />
          <button type="button" title="Fit to window (0)" aria-label="Fit to window" :disabled="previewLoading" @click="fitPreviewImageToWindow"><Scan /></button>
          <button type="button" title="Actual size (1)" aria-label="Actual size" :disabled="previewLoading" @click="showPreviewImageActualSize"><Expand /></button>
          <i aria-hidden="true" />
          <button
            type="button"
            :title="previewFullscreen ? 'Exit full screen (F)' : 'Full screen (F)'"
            :aria-label="previewFullscreen ? 'Exit full screen' : 'Full screen'"
            @click="togglePreviewFullscreen"
          >
            <Minimize2 v-if="previewFullscreen" />
            <Maximize2 v-else />
          </button>
        </div>
        <div class="vault-preview-actions">
          <button type="button" title="Download" @click="downloadItem(previewItem)"><Download /></button>
          <button type="button" title="Close" @click="closePreview"><X /></button>
        </div>
      </header>
      <div
        class="vault-preview-body"
        :class="{ 'is-image-preview': previewKind === 'image', 'is-video-preview': previewKind === 'video' }"
        @pointermove="revealPreviewControls"
        @pointerleave="hidePreviewControls"
      >
        <div v-if="previewLoading" class="vault-preview-message"><LockKeyhole />Decrypting private file…</div>
        <div
          v-else-if="previewKind === 'image' && previewUrl"
          ref="previewImageScroller"
          class="vault-preview-image-scroll"
          role="region"
          tabindex="0"
          aria-label="Scrollable image preview"
          @wheel.stop="onPreviewImageWheel"
          @scroll.passive="revealPreviewControls"
          @touchstart="onPreviewImageTouchStart"
          @touchmove="onPreviewImageTouchMove"
          @touchend="onPreviewImageTouchEnd"
          @touchcancel="onPreviewImageTouchEnd"
        >
          <img
            :key="previewItem.itemId"
            :src="previewUrl"
            :alt="previewItem.metadata?.fileName"
            :style="previewImageStyle"
            draggable="false"
            @dblclick="togglePreviewImageSize"
            @load="onPreviewImageLoad"
          />
        </div>
        <div v-else-if="previewKind === 'video' && previewUrl" class="vault-preview-video-stage">
          <video
            v-if="!previewVideoError"
            :key="previewItem.itemId"
            :src="previewUrl"
            :aria-label="`Video preview: ${previewItem.metadata?.fileName ?? 'private video'}`"
            controls
            controlslist="nodownload"
            playsinline
            preload="metadata"
            @loadedmetadata="onPreviewVideoReady"
            @error="onPreviewVideoError"
          />
          <div v-else class="vault-preview-message">
            <FileVideo />
            <strong>Video preview is not available in this browser.</strong>
            <span>{{ previewVideoError }}</span>
            <button class="vault-primary-action compact" type="button" @click="downloadItem(previewItem)"><Download />Download original</button>
          </div>
        </div>
        <iframe v-else-if="previewKind === 'pdf' && previewUrl" :src="previewUrl" title="Private PDF preview" />
        <pre v-else-if="previewKind === 'text'">{{ previewText }}</pre>
        <div v-else class="vault-preview-message">
          <File />
          <strong>Preview is not available for this file type.</strong>
          <span>Download decrypts the original file in this browser.</span>
          <button class="vault-primary-action compact" type="button" @click="downloadItem(previewItem)"><Download />Download original</button>
        </div>
        <template v-if="previewKind === 'image' && previewImageSequence.length > 1">
          <button
            class="vault-preview-nav is-previous"
            :class="{ 'is-visible': previewControlsVisible }"
            type="button"
            :disabled="previewLoading || !previewPreviousImage"
            :aria-label="previewPreviousImage ? `Previous image: ${previewPreviousImage.metadata?.fileName}` : 'No previous image'"
            title="Previous image (Left arrow)"
            @pointerenter="keepPreviewControlsVisible"
            @pointerleave="revealPreviewControls"
            @focus="keepPreviewControlsVisible"
            @blur="revealPreviewControls"
            @click="showAdjacentImage(-1)"
          ><ChevronLeft /></button>
          <button
            class="vault-preview-nav is-next"
            :class="{ 'is-visible': previewControlsVisible }"
            type="button"
            :disabled="previewLoading || !previewNextImage"
            :aria-label="previewNextImage ? `Next image: ${previewNextImage.metadata?.fileName}` : 'No next image'"
            title="Next image (Right arrow)"
            @pointerenter="keepPreviewControlsVisible"
            @pointerleave="revealPreviewControls"
            @focus="keepPreviewControlsVisible"
            @blur="revealPreviewControls"
            @click="showAdjacentImage(1)"
          ><ChevronRight /></button>
        </template>
      </div>
      <footer>
        <span v-if="previewKind === 'image'" class="vault-preview-order" :title="`Preview order locked: ${previewImageOrderLabel}`">
          Order locked · {{ previewImageOrderLabel }}
        </span>
        <span v-else>Closing this preview revokes its temporary browser URL.</span>
        <strong v-if="previewKind === 'image' && previewImagePosition" aria-live="polite">
          {{ previewImagePosition.current }} / {{ previewImagePosition.total }}
        </strong>
        <span v-if="previewKind === 'image'">Drag to move · Pinch or Ctrl/⌘ + scroll to zoom<span v-if="previewImageSequence.length > 1"> · ← → images</span></span>
        <span v-if="previewKind === 'video'">Local playback · Native controls · Full screen available</span>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.vault-page {
  --vault-bg: #101713;
  --vault-panel: #17201b;
  --vault-panel-strong: #202b25;
  --vault-line: rgba(224, 235, 224, 0.14);
  --vault-muted: #9caaa0;
  --vault-ink: #f2f5ed;
  --vault-accent: #b9e3bd;
  min-height: calc(100svh - 2.5rem);
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--personal-border, #d5d3c9) 70%, transparent);
  border-radius: 1.25rem;
  background: var(--vault-bg);
  color: var(--vault-ink);
  box-shadow: 0 24px 70px rgba(12, 19, 15, 0.16);
}

.vault-loading {
  min-height: 65vh;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 1rem;
  color: var(--vault-muted);
}

.vault-onboarding,
.vault-lock-screen {
  min-height: calc(100svh - 2.5rem);
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(22rem, 0.75fr);
}

.vault-onboarding-copy,
.vault-lock-visual {
  padding: clamp(3rem, 7vw, 7rem);
  display: flex;
  flex-direction: column;
  justify-content: center;
  border-right: 1px solid var(--vault-line);
}

.vault-eyebrow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 1rem;
  color: var(--vault-accent);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.16em;
}

.vault-eyebrow svg { width: 1rem; height: 1rem; }
.vault-onboarding h1,
.vault-lock-screen h1,
.vault-workspace-header h1 {
  margin: 0;
  max-width: 13ch;
  color: var(--vault-ink);
  font-size: clamp(2.5rem, 6vw, 5.8rem);
  font-weight: 740;
  letter-spacing: -0.055em;
  line-height: 0.96;
}

.vault-lead {
  max-width: 42rem;
  margin: 1.5rem 0 0;
  color: #bdc7be;
  font-size: clamp(1rem, 1.5vw, 1.2rem);
  line-height: 1.7;
}

.vault-security-lines {
  margin-top: clamp(3rem, 7vh, 6rem);
  border-top: 1px solid var(--vault-line);
}

.vault-security-lines p {
  display: grid;
  grid-template-columns: 3rem 1fr;
  gap: 1rem;
  margin: 0;
  padding: 1rem 0;
  border-bottom: 1px solid var(--vault-line);
  color: #c9d1ca;
}

.vault-security-lines span { color: var(--vault-accent); font-variant-numeric: tabular-nums; }

.vault-create-form,
.vault-unlock-form {
  padding: clamp(2rem, 5vw, 5rem);
  display: flex;
  flex-direction: column;
  justify-content: center;
  background: var(--vault-panel);
}

.vault-lock-mark,
.vault-lock-ring {
  width: 5.5rem;
  height: 5.5rem;
  display: grid;
  place-items: center;
  margin-bottom: 2rem;
  border: 1px solid rgba(185, 227, 189, 0.45);
  border-radius: 50%;
  color: var(--vault-accent);
  animation: vault-arrive 420ms ease-out both;
}

.vault-lock-mark svg,
.vault-lock-ring svg { width: 2rem; height: 2rem; }
.vault-create-form h2,
.vault-unlock-form h2,
.vault-modal h2 { margin: 0; font-size: 1.65rem; letter-spacing: -0.025em; }
.vault-create-form > p,
.vault-unlock-form > p,
.vault-modal > p { color: var(--vault-muted); line-height: 1.6; }

.vault-page label,
.vault-modal label {
  display: grid;
  gap: 0.45rem;
  margin-top: 1rem;
  color: #cdd5ce;
  font-size: 0.78rem;
  font-weight: 700;
}

.vault-page input,
.vault-page select,
.vault-modal input,
.vault-modal textarea {
  width: 100%;
  border: 1px solid var(--vault-line);
  border-radius: 0.75rem;
  background: rgba(255, 255, 255, 0.055);
  color: var(--vault-ink);
  outline: none;
  transition: border-color 160ms ease, background 160ms ease;
}

.vault-page input,
.vault-modal input,
.vault-modal textarea { padding: 0.8rem 0.9rem; }
.vault-page select { padding: 0.48rem 2rem 0.48rem 0.7rem; }
.vault-page input:focus,
.vault-page select:focus,
.vault-modal input:focus,
.vault-modal textarea:focus {
  border-color: rgba(185, 227, 189, 0.72);
  background: rgba(255, 255, 255, 0.08);
}

.vault-primary-action,
.vault-secondary-action,
.vault-lock-button,
.vault-icon-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  border-radius: 0.75rem;
  font-weight: 760;
  transition: transform 150ms ease, background 150ms ease, border-color 150ms ease;
}

.vault-primary-action {
  min-height: 3rem;
  margin-top: 1.25rem;
  padding: 0.75rem 1rem;
  background: var(--vault-accent);
  color: #17201a;
}

.vault-primary-action.compact { min-height: 2.55rem; margin-top: 0; padding: 0.6rem 0.85rem; }
.vault-primary-action:hover:not(:disabled),
.vault-secondary-action:hover,
.vault-lock-button:hover,
.vault-icon-action:hover { transform: translateY(-1px); }
.vault-primary-action:disabled { opacity: 0.55; cursor: wait; }
.vault-primary-action svg,
.vault-secondary-action svg,
.vault-lock-button svg,
.vault-icon-action svg { width: 1rem; height: 1rem; }
.vault-text-action { margin-top: 1rem; color: var(--vault-accent); font-size: 0.85rem; font-weight: 700; text-align: left; }
.vault-lock-note { margin-top: 2.5rem !important; padding-top: 1rem; border-top: 1px solid var(--vault-line); font-size: 0.76rem; }

.vault-error {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  margin-top: 1rem !important;
  padding: 0.8rem;
  border: 1px solid rgba(238, 144, 126, 0.26);
  border-radius: 0.75rem;
  background: rgba(119, 44, 35, 0.24);
  color: #ffd3ca !important;
  font-size: 0.82rem;
}

.vault-error svg { width: 1rem; height: 1rem; flex: none; margin-top: 0.1rem; }
.vault-lock-visual { align-items: center; text-align: center; background: #0c120f; }
.vault-lock-visual .vault-lock-ring { width: clamp(9rem, 18vw, 15rem); height: clamp(9rem, 18vw, 15rem); margin: 0; }
.vault-lock-visual .vault-lock-ring svg { width: clamp(3rem, 7vw, 6rem); height: clamp(3rem, 7vw, 6rem); }
.vault-lock-visual > span { margin-top: 2rem; color: #728078; font-size: 0.7rem; font-weight: 800; letter-spacing: 0.2em; }
.vault-unlock-form h1 { font-size: clamp(2.6rem, 5vw, 4.6rem); }

.vault-workspace-header {
  min-height: 10.5rem;
  padding: 2rem 2.25rem;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 2rem;
  border-bottom: 1px solid var(--vault-line);
  background: #0d1410;
  animation: vault-rise 300ms ease-out both;
}

.vault-workspace-header h1 { max-width: none; font-size: clamp(2.4rem, 4vw, 4rem); }
.vault-workspace-header > div > p:last-child { margin: 0.65rem 0 0; color: var(--vault-muted); }
.vault-session-actions { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 0.6rem; }
.vault-auto-lock { display: flex !important; grid-auto-flow: column; align-items: center; gap: 0.5rem !important; margin: 0 !important; }
.vault-auto-lock span { color: var(--vault-muted); }
.vault-countdown { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.55rem 0.7rem; color: var(--vault-accent); font-size: 0.76rem; font-variant-numeric: tabular-nums; }
.vault-countdown svg { width: 0.85rem; height: 0.85rem; }
.vault-secondary-action,
.vault-lock-button,
.vault-icon-action { min-height: 2.55rem; padding: 0.55rem 0.8rem; border: 1px solid var(--vault-line); color: var(--vault-ink); }
.vault-secondary-action:hover,
.vault-icon-action:hover { background: rgba(255, 255, 255, 0.07); border-color: rgba(185, 227, 189, 0.35); }
.vault-lock-button { background: var(--vault-accent); color: #17201a; border-color: transparent; }
.vault-icon-action { width: 2.55rem; padding: 0; }

.vault-workspace { min-height: calc(100svh - 13rem); display: grid; grid-template-columns: 15rem minmax(0, 1fr); }
.vault-folder-rail { min-height: 100%; padding: 1.2rem 0.9rem; display: flex; flex-direction: column; border-right: 1px solid var(--vault-line); background: #131b17; }
.vault-rail-heading { display: flex; justify-content: space-between; padding: 0.55rem 0.65rem 0.85rem; color: var(--vault-muted); font-size: 0.7rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
.vault-folder-rail button { display: flex; align-items: center; gap: 0.7rem; min-height: 2.6rem; padding: 0.55rem 0.65rem; border-radius: 0.65rem; color: #aeb9b0; text-align: left; font-size: 0.84rem; font-weight: 650; transition: background 140ms ease, color 140ms ease; }
.vault-folder-rail button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vault-folder-rail button svg { width: 1rem; height: 1rem; flex: none; }
.vault-folder-rail button:hover { color: var(--vault-ink); background: rgba(255, 255, 255, 0.045); }
.vault-folder-rail button.active { color: #162019; background: var(--vault-accent); }
.vault-folder-rail p { margin: 0.75rem 0.65rem; color: #6f7d74; font-size: 0.7rem; line-height: 1.55; }
.vault-rail-spacer { flex: 1; min-height: 2rem; }

.vault-file-workspace { position: relative; min-width: 0; padding: 1.25rem 1.4rem 2rem; background: var(--vault-panel); transition: background 150ms ease; }
.vault-file-workspace.is-dragging { background: #1c2a21; }
.vault-file-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; padding-bottom: 1.1rem; border-bottom: 1px solid var(--vault-line); }
.vault-search { width: min(31rem, 100%); flex: 1 1 18rem; position: relative; }
.vault-search svg { position: absolute; left: 0.8rem; top: 50%; width: 1rem; height: 1rem; color: var(--vault-muted); transform: translateY(-50%); }
.vault-search input { height: 2.55rem; padding-left: 2.4rem; }
.vault-toolbar-actions { display: flex; flex: 1 1 auto; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 0.55rem; }
.vault-upload-status { display: grid; grid-template-columns: minmax(0, 1fr) minmax(10rem, 20rem); gap: 1.5rem; align-items: center; margin: 1rem 0; padding: 0.9rem 1rem; border: 1px solid rgba(185, 227, 189, 0.26); border-radius: 0.8rem; background: rgba(185, 227, 189, 0.055); }
.vault-upload-status div:first-child { min-width: 0; display: grid; gap: 0.2rem; }
.vault-upload-status span { color: var(--vault-muted); font-size: 0.72rem; }
.vault-upload-status strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.85rem; }
.vault-progress { height: 0.35rem; overflow: hidden; border-radius: 1rem; background: rgba(255, 255, 255, 0.08); }
.vault-progress span { display: block; height: 100%; border-radius: inherit; background: var(--vault-accent); transition: width 120ms linear; }

.vault-drop-message { position: absolute; inset: 1.25rem; z-index: 5; display: grid; place-content: center; justify-items: center; gap: 0.65rem; border: 1px dashed rgba(185, 227, 189, 0.62); border-radius: 1rem; background: rgba(16, 23, 19, 0.94); color: var(--vault-accent); text-align: center; }
.vault-drop-message svg { width: 2.5rem; height: 2.5rem; }
.vault-drop-message span { color: var(--vault-muted); font-size: 0.8rem; }
.vault-file-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr)); gap: 0; padding-top: 0.6rem; }
.vault-file-item { min-width: 0; padding: 0.8rem 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; border-bottom: 1px solid var(--vault-line); }
.vault-file-item:nth-child(odd) { padding-right: 1rem; }
.vault-file-item:nth-child(even) { padding-left: 1rem; border-left: 1px solid var(--vault-line); }
.vault-file-open { min-width: 0; display: flex; align-items: center; gap: 0.8rem; text-align: left; }
.vault-file-open:disabled { cursor: not-allowed; opacity: 0.65; }
.vault-file-icon { width: 3rem; height: 3.4rem; flex: none; display: grid; place-items: center; position: relative; border: 1px solid var(--vault-line); border-radius: 0.55rem; background: rgba(255, 255, 255, 0.035); color: var(--vault-accent); transition: background 150ms ease, border-color 150ms ease; }
.vault-file-open:hover .vault-file-icon { border-color: rgba(185, 227, 189, 0.42); background: rgba(185, 227, 189, 0.08); }
.vault-file-icon svg { width: 1.35rem; height: 1.35rem; }
.vault-file-icon small { position: absolute; right: 0.25rem; bottom: 0.2rem; color: #77847b; font-size: 0.48rem; font-weight: 900; }
.vault-file-copy { min-width: 0; display: grid; gap: 0.25rem; }
.vault-file-copy strong { overflow: hidden; color: var(--vault-ink); font-size: 0.84rem; text-overflow: ellipsis; white-space: nowrap; }
.vault-file-copy > span { overflow: hidden; color: var(--vault-muted); font-size: 0.68rem; text-overflow: ellipsis; white-space: nowrap; }
.vault-file-copy em { display: flex; align-items: center; gap: 0.25rem; overflow: hidden; color: #89a18e; font-size: 0.65rem; font-style: normal; text-overflow: ellipsis; white-space: nowrap; }
.vault-file-copy em svg { width: 0.7rem; height: 0.7rem; flex: none; }
.vault-file-actions { display: flex; align-items: center; opacity: 0; transform: translateX(0.25rem); transition: opacity 150ms ease, transform 150ms ease; }
.vault-file-item:hover .vault-file-actions,
.vault-file-item:focus-within .vault-file-actions { opacity: 1; transform: none; }
.vault-file-actions button { width: 2rem; height: 2rem; display: grid; place-items: center; border-radius: 0.45rem; color: var(--vault-muted); }
.vault-file-actions button:hover { color: var(--vault-ink); background: rgba(255, 255, 255, 0.07); }
.vault-file-actions button.danger:hover { color: #ffb2a4; background: rgba(135, 50, 39, 0.25); }
.vault-file-actions button:disabled { opacity: 0.35; cursor: not-allowed; }
.vault-file-actions svg { width: 0.9rem; height: 0.9rem; }
.vault-empty-state { min-height: 25rem; display: grid; place-content: center; justify-items: center; text-align: center; color: var(--vault-muted); }
.vault-empty-state > div { width: 4.5rem; height: 4.5rem; display: grid; place-items: center; margin-bottom: 1.2rem; border: 1px solid var(--vault-line); border-radius: 50%; color: var(--vault-accent); }
.vault-empty-state svg { width: 1.6rem; height: 1.6rem; }
.vault-empty-state h2 { margin: 0; color: var(--vault-ink); font-size: 1.1rem; }
.vault-empty-state p { max-width: 28rem; margin: 0.55rem 0 1rem; font-size: 0.8rem; line-height: 1.6; }

.vault-modal-backdrop,
.vault-preview-backdrop { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 1rem; background: rgba(7, 11, 8, 0.74); backdrop-filter: blur(8px); }
.vault-modal { --vault-line: rgba(224, 235, 224, 0.14); --vault-ink: #f2f5ed; --vault-muted: #9caaa0; --vault-accent: #b9e3bd; width: min(34rem, 100%); max-height: 92svh; overflow-y: auto; position: relative; padding: 2rem; border: 1px solid rgba(185, 227, 189, 0.24); border-radius: 1rem; background: #17201b; color: var(--vault-ink); box-shadow: 0 28px 90px rgba(0, 0, 0, 0.42); animation: vault-rise 180ms ease-out both; }
.vault-modal-close { position: absolute; top: 1rem; right: 1rem; width: 2.4rem; height: 2.4rem; display: grid; place-items: center; border: 1px solid var(--vault-line); border-radius: 0.65rem; color: var(--vault-muted); }
.vault-modal-close:hover { color: var(--vault-ink); background: rgba(255, 255, 255, 0.06); }
.vault-modal-close svg { width: 1rem; height: 1rem; }

.vault-preview { --vault-line: rgba(224, 235, 224, 0.14); --vault-ink: #f2f5ed; --vault-muted: #9caaa0; --vault-accent: #b9e3bd; width: min(74rem, 100%); height: min(88svh, 60rem); display: grid; grid-template-rows: auto minmax(0, 1fr) auto; overflow: hidden; border: 1px solid rgba(185, 227, 189, 0.2); border-radius: 1rem; background: #101713; color: var(--vault-ink); box-shadow: 0 30px 100px rgba(0, 0, 0, 0.55); animation: vault-rise 180ms ease-out both; }
.vault-preview header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem 1.2rem; border-bottom: 1px solid var(--vault-line); }
.vault-preview header .vault-eyebrow { margin-bottom: 0.25rem; }
.vault-preview h2 { max-width: 65vw; margin: 0; overflow: hidden; font-size: 1rem; text-overflow: ellipsis; white-space: nowrap; }
.vault-preview header > div:last-child { display: flex; gap: 0.45rem; }
.vault-preview header button { width: 2.4rem; height: 2.4rem; display: grid; place-items: center; border: 1px solid var(--vault-line); border-radius: 0.55rem; color: var(--vault-muted); }
.vault-preview header button:hover { color: var(--vault-ink); background: rgba(255, 255, 255, 0.06); }
.vault-preview header svg { width: 1rem; height: 1rem; }
.vault-preview-body { min-height: 0; display: grid; place-items: center; position: relative; overflow: auto; background: #090d0b; }
.vault-preview-body img { max-width: 100%; max-height: 100%; object-fit: contain; }
.vault-preview-video-stage { width: 100%; height: 100%; min-height: 0; display: grid; place-items: center; overflow: hidden; background: #050706; }
.vault-preview-video-stage video { width: 100%; height: 100%; max-width: 100%; max-height: 100%; background: #000; object-fit: contain; }
.vault-preview-body iframe { width: 100%; height: 100%; border: 0; background: white; }
.vault-preview-body pre { width: 100%; min-height: 100%; margin: 0; padding: 1.5rem; overflow: auto; color: #dce5dd; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.84rem; line-height: 1.65; white-space: pre-wrap; word-break: break-word; }
.vault-preview-message { display: grid; place-content: center; justify-items: center; gap: 0.7rem; padding: 2rem; color: var(--vault-muted); text-align: center; }
.vault-preview-message > svg { width: 2.4rem; height: 2.4rem; color: var(--vault-accent); }
.vault-preview-message strong { color: var(--vault-ink); }
.vault-preview footer { padding: 0.7rem 1rem; border-top: 1px solid var(--vault-line); color: #6f7b72; font-size: 0.65rem; text-align: center; }

@keyframes vault-arrive {
  from { opacity: 0; transform: scale(0.86) rotate(-4deg); }
  to { opacity: 1; transform: scale(1) rotate(0); }
}

@keyframes vault-rise {
  from { opacity: 0; transform: translateY(0.5rem); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 900px) {
  .vault-page { min-height: calc(100svh - 7rem); border-radius: 0.9rem; }
  .vault-onboarding,
  .vault-lock-screen { min-height: auto; grid-template-columns: 1fr; }
  .vault-onboarding-copy,
  .vault-lock-visual { min-height: 45svh; padding: 2.2rem 1.5rem; border-right: 0; border-bottom: 1px solid var(--vault-line); }
  .vault-create-form,
  .vault-unlock-form { padding: 2rem 1.5rem 2.5rem; }
  .vault-workspace-header { align-items: flex-start; flex-direction: column; padding: 1.4rem; }
  .vault-session-actions { justify-content: flex-start; }
  .vault-workspace { display: block; }
  .vault-folder-rail { min-height: 0; flex-direction: row; align-items: center; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--vault-line); }
  .vault-folder-rail button { flex: none; }
  .vault-folder-rail p,
  .vault-rail-heading,
  .vault-rail-spacer { display: none; }
  .vault-file-toolbar { align-items: stretch; flex-direction: column; }
  .vault-search { width: 100%; }
  .vault-toolbar-actions { justify-content: flex-end; }
  .vault-file-grid { grid-template-columns: 1fr; }
  .vault-file-item:nth-child(odd),
  .vault-file-item:nth-child(even) { padding-left: 0; padding-right: 0; border-left: 0; }
  .vault-file-actions { opacity: 1; transform: none; }
  .vault-upload-status { grid-template-columns: 1fr; }
}

@media (prefers-reduced-motion: reduce) {
  .vault-page *,
  .vault-modal,
  .vault-preview,
  .vault-preview * { animation: none !important; transition-duration: 0.01ms !important; }
}
</style>

<style scoped>
/* Personal Archive-aligned visual layer. */
.vault-page {
  --vault-bg: transparent;
  --vault-panel: var(--personal-surface, #fff);
  --vault-panel-strong: var(--personal-accent-soft, #dff0ec);
  --vault-line: var(--personal-border, #deded7);
  --vault-muted: var(--personal-muted, #6a6f69);
  --vault-ink: var(--personal-text, #20201d);
  --vault-accent: var(--personal-accent, #397f75);
  min-height: calc(100svh - 8rem);
  overflow: visible;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--vault-ink);
  box-shadow: none;
}

.vault-workspace-header {
  min-height: 0;
  align-items: center;
  gap: 0.65rem 1rem;
  margin-bottom: 0.75rem;
  padding: 0 0 0.65rem;
  border-bottom: 1px solid var(--vault-line);
  background: transparent;
  animation: vault-rise 180ms ease-out both;
}
.vault-workspace-header > div:first-child { min-width: 15rem; flex: 1 1 22rem; }
.vault-workspace-header h1 { max-width: none; color: var(--vault-ink); font-size: clamp(1.45rem, 2vw, 1.85rem); font-weight: 760; letter-spacing: -0.035em; line-height: 1.1; }
.vault-workspace-header > div > p:last-child { margin-top: 0.2rem; color: var(--vault-muted); font-size: 0.78rem; line-height: 1.15rem; }
.vault-eyebrow { margin-bottom: 0.25rem; color: var(--personal-accent-strong, #245e56); font-size: 0.68rem; letter-spacing: 0.1em; }
.vault-eyebrow svg { width: 0.85rem; height: 0.85rem; }
.vault-header-status { display: inline-flex; align-items: center; gap: 0.35rem; border: 1px solid var(--vault-line); border-radius: 999px; background: var(--vault-panel); padding: 0.38rem 0.65rem; color: var(--vault-muted); font-size: 0.72rem; font-weight: 700; }
.vault-header-status svg { width: 0.8rem; height: 0.8rem; }

.vault-onboarding { width: min(100%, 68rem); min-height: 0; margin: 1.5rem auto 0; grid-template-columns: minmax(0, 1fr) minmax(20rem, 25rem); align-items: start; gap: clamp(1.5rem, 4vw, 4rem); }
.vault-onboarding-copy { padding: 1rem 0; border: 0; }
.vault-onboarding-copy h2, .vault-create-form h2, .vault-unlock-form h2, .vault-modal h2 { margin: 0; color: var(--vault-ink); font-size: 1.2rem; font-weight: 760; letter-spacing: -0.025em; }
.vault-onboarding-copy h2 { margin-top: 0.35rem; font-size: clamp(1.45rem, 2vw, 1.85rem); }
.vault-lead, .vault-create-form > p, .vault-unlock-form > p, .vault-modal > p { color: var(--vault-muted); font-size: 0.82rem; line-height: 1.55; }
.vault-lead { margin-top: 0.55rem; }
.vault-security-lines { margin-top: 1.35rem; border-top-color: var(--vault-line); }
.vault-security-lines p { grid-template-columns: 1.75rem 1fr; gap: 0.7rem; padding: 0.75rem 0; border-bottom-color: var(--vault-line); color: var(--vault-muted); font-size: 0.78rem; }
.vault-security-lines span { display: grid; width: 1.35rem; height: 1.35rem; place-items: center; border-radius: 0.4rem; background: var(--personal-accent-soft, #dff0ec); color: var(--personal-accent-strong, #245e56); font-size: 0.62rem; font-weight: 800; }

.vault-create-form, .vault-unlock-form { justify-content: flex-start; border: 1px solid var(--vault-line); border-radius: 0.85rem; background: var(--vault-panel); padding: 1.25rem; box-shadow: 0 8px 24px color-mix(in srgb, var(--vault-ink) 7%, transparent); }
.vault-lock-mark, .vault-lock-ring { width: 2.75rem; height: 2.75rem; margin-bottom: 0.9rem; border: 0; border-radius: 0.7rem; background: var(--personal-accent-soft, #dff0ec); color: var(--personal-accent-strong, #245e56); animation: none; }
.vault-lock-mark svg, .vault-lock-ring svg { width: 1.2rem; height: 1.2rem; }
.vault-lock-screen { width: min(100%, 46rem); min-height: 0; margin: 1rem auto 0; grid-template-columns: 11rem minmax(20rem, 1fr); overflow: hidden; border: 1px solid var(--vault-line); border-radius: 0.85rem; background: var(--vault-panel); }
.vault-lock-visual { display: grid; grid-template-columns: 2.4rem minmax(0, 1fr); align-content: center; align-items: center; gap: 0.15rem 0.7rem; border-right: 1px solid var(--vault-line); background: color-mix(in srgb, var(--personal-accent-soft, #dff0ec) 55%, var(--vault-panel)); padding: 1.15rem 1rem; text-align: left; }
.vault-lock-visual .vault-lock-ring { grid-row: 1 / span 2; width: 2.4rem; height: 2.4rem; margin: 0; }
.vault-lock-visual .vault-lock-ring svg { width: 1.2rem; height: 1.2rem; }
.vault-lock-visual strong { color: var(--vault-ink); font-size: 0.9rem; }
.vault-lock-visual > span { margin: 0; color: var(--vault-muted); font-size: 0.7rem; font-weight: 400; letter-spacing: 0; line-height: 1.35; }
.vault-unlock-form { justify-content: center; border: 0; border-radius: 0; padding: 1.5rem; box-shadow: none; }

.vault-page label, .vault-modal label { color: var(--vault-ink); font-size: 0.75rem; }
.vault-page input, .vault-page select, .vault-modal input, .vault-modal textarea { border-color: var(--vault-line); border-radius: 0.55rem; background: var(--vault-panel); color: var(--vault-ink); }
.vault-page input, .vault-modal input, .vault-modal textarea { padding: 0.65rem 0.75rem; }
.vault-page input:focus, .vault-page select:focus, .vault-modal input:focus, .vault-modal textarea:focus { border-color: var(--vault-accent); background: var(--vault-panel); box-shadow: 0 0 0 3px color-mix(in srgb, var(--vault-accent) 14%, transparent); }

.vault-primary-action, .vault-secondary-action, .vault-lock-button, .vault-icon-action { min-height: 2.5rem; border-radius: 0.55rem; padding: 0.55rem 0.8rem; font-size: 0.78rem; transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease; }
.vault-primary-action, .vault-lock-button { border: 1px solid var(--vault-accent); background: var(--vault-accent); color: var(--personal-accent-contrast, #fff); }
.vault-primary-action { width: 100%; margin-top: 1rem; }
.vault-primary-action.compact { width: auto; min-height: 2.25rem; margin-top: 0; padding: 0.45rem 0.7rem; }
.vault-primary-action:hover:not(:disabled), .vault-lock-button:hover { border-color: var(--personal-accent-strong, #245e56); background: var(--personal-accent-strong, #245e56); transform: none; }
.vault-secondary-action, .vault-icon-action { border-color: var(--vault-line); background: var(--vault-panel); color: var(--vault-ink); }
.vault-secondary-action:hover, .vault-icon-action:hover { border-color: var(--vault-accent); background: var(--personal-accent-soft, #dff0ec); color: var(--personal-accent-strong, #245e56); transform: none; }
.vault-text-action { color: var(--personal-accent-strong, #245e56); font-size: 0.76rem; }
.vault-text-action:hover { text-decoration: underline; text-underline-offset: 0.18rem; }
.vault-lock-note { margin-top: 1.15rem !important; border-top-color: var(--vault-line); font-size: 0.7rem !important; }
.vault-error { border-color: #edc7c3; background: #fff4f2; color: #a3362f !important; }

.vault-session-actions { gap: 0.35rem; }
.vault-auto-lock span { color: var(--vault-muted); font-size: 0.7rem; }
.vault-auto-lock select { width: auto; min-height: 2.25rem; font-size: 0.72rem; }
.vault-countdown { min-width: 3.9rem; justify-content: center; padding: 0 0.35rem; color: var(--personal-accent-strong, #245e56); }

.vault-workspace { --panel-resize-accent: var(--vault-accent); --panel-resize-line: var(--vault-line); --panel-resize-surface: var(--vault-panel); min-height: 34rem; position: relative; grid-template-columns: var(--vault-folder-rail-width, 15.5rem) minmax(0, 1fr); overflow: hidden; border: 1px solid var(--vault-line); border-radius: 0.8rem; background: var(--vault-panel); }
.vault-folder-rail { padding: 0.8rem 0.65rem; border-right-color: var(--vault-line); background: color-mix(in srgb, var(--personal-accent-soft, #dff0ec) 32%, var(--vault-panel)); }
.vault-rail-heading { padding: 0.4rem 0.55rem 0.65rem; color: var(--vault-muted); font-size: 0.65rem; }
.vault-folder-rail button { min-height: 2.25rem; gap: 0.55rem; border-radius: 0.5rem; padding: 0.45rem 0.55rem; color: var(--vault-muted); font-size: 0.76rem; }
.vault-folder-rail button:hover { background: color-mix(in srgb, var(--personal-accent-soft, #dff0ec) 58%, transparent); color: var(--vault-ink); }
.vault-folder-rail button.active { background: var(--personal-accent-soft, #dff0ec); color: var(--personal-accent-strong, #245e56); }
.vault-folder-rail p { color: var(--vault-muted); }

.vault-folder-rail > button { width: 100%; }
.vault-folder-rail > button span { min-width: 0; flex: 1; }
.vault-folder-rail > button small { margin-left: auto; color: inherit; font-size: 0.64rem; opacity: 0.72; }
.vault-folder-heading { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 0.35rem; margin-top: 0.65rem; padding-bottom: 0.4rem; border-top: 1px solid color-mix(in srgb, var(--vault-line) 75%, transparent); padding-top: 0.75rem; }
.vault-folder-heading > button { width: 1.7rem; min-height: 1.7rem; display: grid; place-items: center; padding: 0; border-radius: 0.4rem; color: var(--vault-muted); }
.vault-folder-heading > button:hover { background: var(--personal-accent-soft, #dff0ec); color: var(--personal-accent-strong, #245e56); }
.vault-folder-heading > button svg { width: 0.85rem; height: 0.85rem; }
.vault-folder-tree { position: relative; }
.vault-tree-row { --folder-depth: 0; position: relative; min-width: 0; display: grid; grid-template-columns: 1.35rem minmax(0, 1fr) 1.7rem; align-items: center; min-height: 2.15rem; padding-left: calc(var(--folder-depth) * 0.8rem); border-radius: 0.5rem; color: var(--vault-muted); transition: background-color 130ms ease, color 130ms ease, box-shadow 130ms ease; }
.vault-child-row::before { content: ""; position: absolute; z-index: 0; left: calc((var(--folder-depth) - 0.48) * 0.8rem); top: -0.2rem; width: 0.56rem; height: 1.28rem; border-left: 1px solid color-mix(in srgb, var(--vault-muted) 42%, transparent); border-bottom: 1px solid color-mix(in srgb, var(--vault-muted) 42%, transparent); border-bottom-left-radius: 0.3rem; pointer-events: none; }
.vault-child-row > * { position: relative; z-index: 1; }
.vault-tree-row:hover { background: color-mix(in srgb, var(--personal-accent-soft, #dff0ec) 48%, transparent); color: var(--vault-ink); }
.vault-tree-row.active { background: var(--personal-accent-soft, #dff0ec); color: var(--personal-accent-strong, #245e56); }
.vault-tree-row.drop-target, .vault-file-item.drop-target { background: color-mix(in srgb, var(--personal-accent-soft, #dff0ec) 86%, var(--vault-panel)); box-shadow: inset 0 0 0 1px var(--vault-accent); }
.vault-tree-row > button { min-width: 0; min-height: 2rem; margin: 0; border-radius: 0.4rem; padding: 0.35rem 0.25rem; background: transparent; color: inherit; }
.vault-tree-row > button:hover { background: transparent; color: inherit; }
.vault-tree-toggle { display: grid !important; place-items: center; }
.vault-tree-toggle:disabled { opacity: 0; }
.vault-tree-toggle svg, .vault-tree-more svg { width: 0.78rem !important; height: 0.78rem !important; }
.vault-tree-open { display: flex !important; gap: 0.45rem !important; }
.vault-tree-open span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vault-tree-more { display: grid !important; place-items: center; opacity: 0; }
.vault-tree-row:hover .vault-tree-more, .vault-tree-row:focus-within .vault-tree-more { opacity: 1; }
.vault-root-row { grid-template-columns: 1.35rem minmax(0, 1fr); font-weight: 720; }
.vault-tree-indent { display: block; }

.vault-file-workspace { padding: 1rem 1.1rem 1.5rem; background: var(--vault-panel); }
.vault-file-workspace.is-dragging { background: color-mix(in srgb, var(--personal-accent-soft, #dff0ec) 38%, var(--vault-panel)); }
.vault-file-toolbar { padding-bottom: 0.8rem; border-bottom-color: var(--vault-line); }
.vault-search input { height: 2.25rem; font-size: 0.76rem; }
.vault-location-bar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; min-height: 2rem; padding: 0 0 0.7rem; border-bottom: 1px solid var(--vault-line); color: var(--vault-muted); font-size: 0.7rem; }
.vault-breadcrumbs { min-width: 0; display: flex; align-items: center; gap: 0.25rem; }
.vault-breadcrumbs > svg { width: 0.72rem; height: 0.72rem; flex: none; color: var(--vault-muted); }
.vault-breadcrumbs button, .vault-breadcrumbs strong { min-width: 0; display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.25rem 0.35rem; border-radius: 0.35rem; color: var(--vault-ink); font-size: 0.75rem; font-weight: 700; white-space: nowrap; }
.vault-breadcrumbs button:hover { background: var(--personal-accent-soft, #dff0ec); color: var(--personal-accent-strong, #245e56); }
.vault-breadcrumbs button svg { width: 0.8rem; height: 0.8rem; }
.vault-file-toolbar { padding-top: 0.7rem; }
.vault-sort-controls { min-height: 2.25rem; display: inline-flex; align-items: stretch; overflow: hidden; border: 1px solid var(--vault-line); border-radius: 0.55rem; background: var(--vault-panel); }
.vault-sort-label { display: inline-flex; align-items: center; padding-left: 0.65rem; color: var(--vault-muted); font-size: 0.64rem; font-weight: 750; letter-spacing: 0.03em; text-transform: uppercase; }
.vault-toolbar-actions .vault-sort-controls select { width: auto; min-width: 6.5rem; min-height: 2.15rem; border: 0; border-radius: 0; padding: 0.35rem 1.65rem 0.35rem 0.45rem; background: transparent; font-size: 0.72rem; box-shadow: none; }
.vault-sort-direction { min-height: 2.15rem; display: inline-flex; align-items: center; gap: 0.35rem; border-left: 1px solid var(--vault-line); padding: 0.35rem 0.6rem; color: var(--vault-ink); font-size: 0.68rem; font-weight: 720; white-space: nowrap; transition: background-color 130ms ease, color 130ms ease; }
.vault-sort-direction:hover { background: var(--personal-accent-soft, #dff0ec); color: var(--personal-accent-strong, #245e56); }
.vault-sort-direction svg { width: 0.78rem; height: 0.78rem; flex: none; }
.vault-secondary-action.compact { min-height: 2.25rem; padding: 0.45rem 0.7rem; }
.vault-selection-toolbar { min-height: 3.15rem; display: flex; align-items: center; gap: 0.45rem; margin-top: 0.7rem; padding: 0.55rem 0.65rem; border-bottom: 1px solid var(--vault-line); background: color-mix(in srgb, var(--personal-accent-soft, #dff0ec) 45%, var(--vault-panel)); }
.vault-selection-toolbar strong { min-width: 7rem; flex-shrink: 0; white-space: nowrap; margin-right: auto; color: var(--vault-ink); font-size: 0.76rem; }
.vault-selection-toolbar button { min-height: 2rem; display: inline-flex; align-items: center; gap: 0.35rem; border: 1px solid var(--vault-line); border-radius: 0.45rem; padding: 0.35rem 0.55rem; background: var(--vault-panel); color: var(--vault-ink); font-size: 0.7rem; }
.vault-selection-toolbar button:hover { border-color: var(--vault-accent); color: var(--personal-accent-strong, #245e56); }
.vault-selection-toolbar button:disabled { opacity: 0.45; cursor: default; }
.vault-selection-toolbar svg { width: 0.78rem; height: 0.78rem; }
.vault-undo-bar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin: 0.65rem 0 0; border: 1px solid color-mix(in srgb, var(--vault-accent) 32%, var(--vault-line)); border-radius: 0.55rem; padding: 0.5rem 0.65rem; background: color-mix(in srgb, var(--personal-accent-soft, #dff0ec) 42%, var(--vault-panel)); color: var(--vault-muted); font-size: 0.72rem; animation: vault-rise 160ms ease-out both; }
.vault-undo-bar button { display: inline-flex; align-items: center; gap: 0.35rem; color: var(--personal-accent-strong, #245e56); font-weight: 750; }
.vault-undo-bar svg { width: 0.8rem; height: 0.8rem; }
.vault-upload-status { border-color: color-mix(in srgb, var(--vault-accent) 28%, var(--vault-line)); background: color-mix(in srgb, var(--personal-accent-soft, #dff0ec) 34%, var(--vault-panel)); }
.vault-upload-status span { color: var(--vault-muted); }
.vault-progress { background: color-mix(in srgb, var(--vault-line) 70%, transparent); }
.vault-drop-message { border-color: var(--vault-accent); background: color-mix(in srgb, var(--personal-accent-soft, #dff0ec) 82%, var(--vault-panel)); color: var(--personal-accent-strong, #245e56); }
.vault-drop-message span { color: var(--vault-muted); }

.vault-file-grid { display: block; padding-top: 0.35rem; }
.vault-file-columns, .vault-file-item, .vault-file-item:nth-child(odd), .vault-file-item:nth-child(even) { min-width: 0; display: grid; grid-template-columns: 1.25rem minmax(12rem, 1fr) minmax(7rem, 0.45fr) 5rem 8.5rem 6.5rem; align-items: center; gap: 0.65rem; padding: 0.45rem 0.35rem; border-left: 0; border-bottom: 1px solid var(--vault-line); }
.vault-file-columns { min-height: 2.3rem; color: var(--vault-muted); font-size: 0.62rem; font-weight: 750; letter-spacing: 0.04em; text-transform: uppercase; }
.vault-file-columns input, .vault-file-item > input { width: 0.9rem; height: 0.9rem; accent-color: var(--vault-accent); }
.vault-column-sort { min-width: 0; display: inline-flex; align-items: center; justify-self: start; gap: 0.25rem; color: inherit; font: inherit; letter-spacing: inherit; text-transform: inherit; transition: color 130ms ease; }
.vault-column-sort:hover, .vault-column-sort.active { color: var(--personal-accent-strong, #245e56); }
.vault-column-sort svg { width: 0.65rem; height: 0.65rem; flex: none; opacity: 0.62; }
.vault-column-sort.active svg { opacity: 1; }
.vault-column-sort--name { padding-left: 2.95rem; }
.vault-column-sort--size { width: 100%; justify-content: flex-end; }
.vault-file-item > :nth-child(4) { text-align: right; }
.vault-file-item, .vault-file-item:nth-child(odd), .vault-file-item:nth-child(even) { min-height: 3.9rem; transition: background-color 140ms ease, box-shadow 140ms ease; }
.vault-file-item:hover { padding-left: 0.35rem; background: color-mix(in srgb, var(--personal-accent-soft, #dff0ec) 30%, transparent); }
.vault-file-item.selected { background: color-mix(in srgb, var(--personal-accent-soft, #dff0ec) 68%, transparent); }
.vault-file-item[draggable="true"] { cursor: default; }
.vault-file-icon { width: 2.15rem; height: 2.35rem; border: 0; border-radius: 0.5rem; background: var(--personal-accent-soft, #dff0ec); color: var(--personal-accent-strong, #245e56); }
.vault-folder-item .vault-file-icon { height: 2.15rem; }
.vault-folder-item .vault-file-icon svg { width: 1.15rem; height: 1.15rem; }
.vault-file-open:hover .vault-file-icon { border: 0; background: var(--personal-accent-soft, #dff0ec); }
.vault-file-location, .vault-file-item > span { min-width: 0; overflow: hidden; color: var(--vault-muted); font-size: 0.68rem; text-overflow: ellipsis; white-space: nowrap; }
.vault-file-copy strong { color: var(--vault-ink); }
.vault-file-copy > span { color: var(--vault-muted); }
.vault-file-copy em { color: var(--personal-accent-strong, #245e56); }
.vault-file-actions button { color: var(--vault-muted); }
.vault-file-actions button:hover { background: var(--personal-accent-soft, #dff0ec); color: var(--personal-accent-strong, #245e56); }
.vault-file-actions button.favorite { color: #9b7521; }
.vault-file-actions button.favorite svg { fill: currentColor; }
.vault-file-actions button.danger:hover { background: #fff0ee; color: #b43a32; }
.vault-empty-state { color: var(--vault-muted); }
.vault-empty-state > div { width: 3rem; height: 3rem; margin-bottom: 0.8rem; border: 0; border-radius: 0.7rem; background: var(--personal-accent-soft, #dff0ec); color: var(--personal-accent-strong, #245e56); }
.vault-empty-state h2 { color: var(--vault-ink); }

.vault-context-menu { position: fixed; z-index: 120; width: 13rem; overflow: hidden; border: 1px solid var(--personal-border, #deded7); border-radius: 0.65rem; background: var(--personal-surface, #fff); padding: 0.3rem; color: var(--personal-text, #20201d); box-shadow: 0 16px 44px color-mix(in srgb, var(--personal-text, #20201d) 22%, transparent); animation: vault-rise 120ms ease-out both; }
.vault-context-menu button { width: 100%; min-height: 2.15rem; display: flex; align-items: center; gap: 0.55rem; border-radius: 0.4rem; padding: 0.4rem 0.55rem; color: inherit; font-size: 0.72rem; text-align: left; }
.vault-context-menu button:hover { background: var(--personal-accent-soft, #dff0ec); color: var(--personal-accent-strong, #245e56); }
.vault-context-menu button.danger { color: #a3362f; }
.vault-context-menu button.danger:hover { background: #fff0ee; color: #a3362f; }
.vault-context-menu svg { width: 0.85rem; height: 0.85rem; }

.vault-modal-backdrop, .vault-preview-backdrop { background: color-mix(in srgb, var(--personal-text, #20201d) 28%, transparent); backdrop-filter: blur(4px); }
.vault-modal, .vault-preview { --vault-line: var(--personal-border, #deded7); --vault-ink: var(--personal-text, #20201d); --vault-muted: var(--personal-muted, #6a6f69); --vault-accent: var(--personal-accent, #397f75); --vault-surface: var(--personal-surface, #fff); border-color: var(--vault-line); border-radius: 0.85rem; background: var(--vault-surface); color: var(--vault-ink); box-shadow: 0 22px 60px color-mix(in srgb, var(--vault-ink) 20%, transparent); }
.vault-modal select { width: 100%; min-height: 2.55rem; border: 1px solid var(--vault-line); border-radius: 0.55rem; background: var(--vault-surface); padding: 0.55rem 2rem 0.55rem 0.7rem; color: var(--vault-ink); }
.vault-modal { width: min(32rem, 100%); padding: 1.25rem; }
.vault-modal-close { border-color: var(--vault-line); color: var(--vault-muted); }
.vault-modal-close:hover { border-color: var(--vault-accent); background: var(--personal-accent-soft, #dff0ec); color: var(--personal-accent-strong, #245e56); }
.vault-preview { width: min(72rem, 100%); height: min(88svh, 58rem); }
.vault-preview:fullscreen { width: 100vw; height: 100vh; max-width: none; max-height: none; border: 0; border-radius: 0; }
.vault-preview header { padding: 0.8rem 1rem; border-bottom-color: var(--vault-line); }
.vault-preview-heading { min-width: 0; flex: 1 1 auto; }
.vault-preview h2, .vault-preview-message strong { color: var(--vault-ink); }
.vault-preview header button { flex: none; border-color: var(--vault-line); color: var(--vault-muted); }
.vault-preview header button:hover { border-color: var(--vault-accent); background: var(--personal-accent-soft, #dff0ec); color: var(--personal-accent-strong, #245e56); }
.vault-preview header button:disabled { cursor: not-allowed; opacity: 0.35; }
.vault-preview-toolbar { display: flex; flex: 0 1 auto; align-items: center; gap: 0.25rem; overflow-x: auto; border: 1px solid color-mix(in srgb, var(--vault-line) 80%, transparent); border-radius: 0.65rem; padding: 0.22rem; scrollbar-width: none; }
.vault-preview-toolbar::-webkit-scrollbar { display: none; }
.vault-preview-toolbar button { width: 2rem; height: 2rem; border: 0; }
.vault-preview-toolbar i { width: 1px; height: 1.15rem; flex: none; background: var(--vault-line); }
.vault-preview-zoom { min-width: 3.2rem; color: var(--vault-muted); font-size: 0.68rem; font-style: normal; font-variant-numeric: tabular-nums; font-weight: 750; text-align: center; }
.vault-preview-actions { display: flex; flex: none; gap: 0.45rem; }
.vault-preview-body { background: color-mix(in srgb, var(--vault-line) 25%, var(--vault-surface)); }
.vault-preview-body pre { background: var(--vault-surface); color: var(--vault-ink); }
.vault-preview-message { color: var(--vault-muted); }
.vault-preview-message > svg { color: var(--vault-accent); }
.vault-preview footer { border-top-color: var(--vault-line); color: var(--vault-muted); }
.vault-preview-body.is-image-preview { overflow: hidden; }
.vault-preview-body.is-video-preview { overflow: hidden; background: #050706; }
.vault-preview-video-stage .vault-preview-message { width: 100%; height: 100%; }
.vault-preview-image-scroll { width: 100%; height: 100%; min-height: 0; display: flex; align-items: safe center; justify-content: safe center; overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable both-edges; touch-action: pan-x pan-y; }
.vault-preview-body.is-image-preview img { max-width: none; max-height: none; flex: none; object-fit: contain; user-select: none; animation: vault-preview-image-arrive 160ms ease-out both; }
.vault-preview-nav { width: 2.85rem; height: 2.85rem; display: grid; place-items: center; position: absolute; z-index: 2; top: 50%; border: 1px solid color-mix(in srgb, var(--vault-line) 68%, transparent); border-radius: 50%; background: color-mix(in srgb, var(--vault-surface) 62%, transparent); color: var(--vault-ink); box-shadow: 0 6px 18px color-mix(in srgb, var(--vault-ink) 10%, transparent); opacity: 0; pointer-events: none; transform: translateY(-50%) scale(0.96); backdrop-filter: blur(10px); transition: opacity 180ms ease, border-color 140ms ease, background-color 140ms ease, transform 180ms ease; }
.vault-preview-nav.is-previous { left: 0.85rem; }
.vault-preview-nav.is-next { right: 0.85rem; }
.vault-preview-nav.is-visible { opacity: 0.58; pointer-events: auto; transform: translateY(-50%) scale(1); }
.vault-preview-nav.is-visible:hover:not(:disabled), .vault-preview-nav:focus-visible { border-color: color-mix(in srgb, var(--vault-accent) 48%, var(--vault-line)); background: color-mix(in srgb, var(--vault-surface) 78%, transparent); color: var(--personal-accent-strong, #245e56); opacity: 0.9; pointer-events: auto; }
.vault-preview-nav.is-previous:hover:not(:disabled) { transform: translate(-0.1rem, -50%); }
.vault-preview-nav.is-next:hover:not(:disabled) { transform: translate(0.1rem, -50%); }
.vault-preview-nav.is-visible:disabled { cursor: default; opacity: 0.16; pointer-events: none; box-shadow: none; }
.vault-preview-nav svg { width: 1.15rem; height: 1.15rem; }
.vault-preview footer { min-height: 2.4rem; display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 0.9rem; text-align: left; }
.vault-preview footer > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vault-preview footer > span:last-child { text-align: right; }
.vault-preview footer strong { color: var(--vault-ink); font-size: 0.72rem; font-variant-numeric: tabular-nums; letter-spacing: 0.04em; }

@keyframes vault-preview-image-arrive {
  from { opacity: 0.35; transform: scale(0.992); }
  to { opacity: 1; transform: scale(1); }
}

:global(html.private-vault-preview-open),
:global(body.private-vault-preview-open) { overflow: hidden !important; overscroll-behavior: none; }

@media (max-width: 900px) {
  .vault-page { min-height: calc(100svh - 7rem); }
  .vault-workspace-header > div:first-child { min-width: 0; flex: none; width: 100%; }
  .vault-onboarding { min-height: 0; grid-template-columns: 1fr; gap: 1rem; margin-top: 0.75rem; }
  .vault-onboarding-copy { min-height: 0; padding: 0; border: 0; }
  .vault-lock-screen { width: min(100%, 34rem); min-height: 0; grid-template-columns: 1fr; margin-top: 0.75rem; }
  .vault-lock-visual { min-height: 0; grid-template-columns: 2.25rem minmax(0, 1fr); gap: 0.1rem 0.7rem; padding: 0.75rem 1rem; border-right: 0; border-bottom: 1px solid var(--vault-line); }
  .vault-lock-visual .vault-lock-ring { width: 2.25rem; height: 2.25rem; }
  .vault-lock-visual strong { font-size: 0.82rem; }
  .vault-lock-visual > span { font-size: 0.68rem; }
  .vault-create-form, .vault-unlock-form { padding: 1.1rem; }
  .vault-workspace-header { padding: 0 0 0.65rem; }
  .vault-workspace { grid-template-columns: 1fr; }
  .vault-panel-resize { display: none; }
  .vault-folder-rail { max-height: 18rem; display: flex; flex-direction: column; align-items: stretch; overflow: auto; border-right: 0; border-bottom: 1px solid var(--vault-line); }
  .vault-folder-rail > button { flex: none; }
  .vault-folder-rail p, .vault-folder-heading { display: grid; }
  .vault-rail-spacer { display: none; }
  .vault-file-toolbar { align-items: stretch; }
  .vault-toolbar-actions { flex-wrap: wrap; }
  .vault-file-columns, .vault-file-item, .vault-file-item:nth-child(odd), .vault-file-item:nth-child(even) { grid-template-columns: 1.25rem minmax(10rem, 1fr) minmax(6rem, 0.35fr) 4.5rem 7.5rem auto; }
  .vault-preview-backdrop { padding: 0; }
  .vault-preview { width: 100%; height: 100dvh; max-height: none; border: 0; border-radius: 0; }
  .vault-preview header { flex-wrap: wrap; gap: 0.55rem; padding: max(0.55rem, env(safe-area-inset-top)) 0.65rem 0.55rem; }
  .vault-preview-heading { flex-basis: calc(100% - 6rem); }
  .vault-preview-toolbar { order: 3; width: 100%; justify-content: flex-start; }
  .vault-preview-toolbar button,
  .vault-preview header .vault-preview-actions button { width: 2.75rem; height: 2.75rem; }
  .vault-preview-nav { opacity: 0.7; pointer-events: auto; }
  .vault-preview footer { grid-template-columns: auto minmax(0, 1fr); padding-bottom: max(0.7rem, env(safe-area-inset-bottom)); }
  .vault-preview footer > span:first-child:not(.vault-preview-order) { display: none; }
  .vault-preview footer > .vault-preview-order { grid-column: 1 / -1; text-align: center; }
}

@media (max-width: 700px) {
  .vault-location-bar { align-items: flex-start; }
  .vault-location-bar > span { display: none; }
  .vault-breadcrumbs { overflow-x: auto; }
  .vault-file-toolbar { flex-direction: column; }
  .vault-toolbar-actions { justify-content: flex-start; }
  .vault-search { width: 100%; }
  .vault-selection-toolbar { flex-wrap: wrap; }
  .vault-selection-toolbar strong { width: 100%; }
  .vault-file-columns, .vault-file-item, .vault-file-item:nth-child(odd), .vault-file-item:nth-child(even) { grid-template-columns: 1.25rem minmax(0, 1fr) auto; gap: 0.5rem; }
  .vault-file-columns > :nth-child(3), .vault-file-columns > :nth-child(4), .vault-file-columns > :nth-child(5),
  .vault-file-item > :nth-child(3), .vault-file-item > :nth-child(4), .vault-file-item > :nth-child(5) { display: none; }
  .vault-file-actions { opacity: 1; transform: none; }
  .vault-preview-nav { width: 2.65rem; height: 2.65rem; }
  .vault-preview-nav.is-previous { left: 0.5rem; }
  .vault-preview-nav.is-next { right: 0.5rem; }
}

@media (max-width: 520px) {
  .vault-session-actions { width: 100%; }
  .vault-auto-lock { width: 100%; justify-content: space-between; }
  .vault-countdown { margin-right: auto; }
  .vault-secondary-action, .vault-lock-button { flex: 1; }
  .vault-file-workspace { padding: 0.8rem; }
  .vault-sort-controls { flex: 1 1 14rem; }
  .vault-toolbar-actions .vault-sort-controls select { min-width: 0; flex: 1; }
  .vault-secondary-action.compact, .vault-primary-action.compact { flex: 1 1 8rem; }
}

.vault-tag-heading { margin-top: 0.65rem; padding-top: 0.75rem; border-top: 1px solid color-mix(in srgb, var(--vault-line) 75%, transparent); }
.vault-view-switch { display: inline-flex; overflow: hidden; border: 1px solid var(--vault-line); border-radius: 0.5rem; background: var(--vault-panel); }
.vault-view-switch button { width: 2.15rem; min-height: 2.15rem; display: grid; place-items: center; color: var(--vault-muted); transition: background-color 130ms ease, color 130ms ease; }
.vault-view-switch button + button { border-left: 1px solid var(--vault-line); }
.vault-view-switch button:hover, .vault-view-switch button.active { background: var(--personal-accent-soft, #dff0ec); color: var(--personal-accent-strong, #245e56); }
.vault-view-switch svg { width: 0.85rem; height: 0.85rem; }
.vault-field-hint { color: var(--vault-muted); font-size: 0.65rem; font-weight: 450; line-height: 1.45; }
.vault-item-tags { display: flex; flex-wrap: wrap; gap: 0.25rem; overflow: visible !important; white-space: normal !important; }
.vault-item-tags small { border-radius: 999px; background: color-mix(in srgb, var(--personal-accent-soft, #dff0ec) 74%, transparent); padding: 0.1rem 0.35rem; color: var(--personal-accent-strong, #245e56); font-size: 0.56rem; font-weight: 750; }

.vault-file-grid.is-tile-view { display: grid; grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr)); align-content: start; gap: 0.65rem; padding-top: 0.8rem; }
.vault-file-grid.is-tile-view .vault-file-columns { display: none; }
.vault-file-grid.is-tile-view .vault-file-item,
.vault-file-grid.is-tile-view .vault-file-item:nth-child(odd),
.vault-file-grid.is-tile-view .vault-file-item:nth-child(even) {
  min-height: 11rem;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.45rem;
  padding: 0.7rem;
  border: 1px solid var(--vault-line);
  border-radius: 0.65rem;
  background: var(--vault-panel);
  transition: border-color 140ms ease, background-color 140ms ease, transform 140ms ease, box-shadow 140ms ease;
}
.vault-file-grid.is-tile-view .vault-file-item:hover { border-color: color-mix(in srgb, var(--vault-accent) 52%, var(--vault-line)); background: color-mix(in srgb, var(--personal-accent-soft, #dff0ec) 24%, var(--vault-panel)); transform: translateY(-1px); }
.vault-file-grid.is-tile-view .vault-file-item.selected { border-color: var(--vault-accent); background: color-mix(in srgb, var(--personal-accent-soft, #dff0ec) 58%, var(--vault-panel)); box-shadow: 0 5px 16px color-mix(in srgb, var(--vault-ink) 7%, transparent); }
.vault-file-grid.is-tile-view .vault-file-item > input { position: absolute; z-index: 1; top: 0.7rem; left: 0.7rem; }
.vault-file-grid.is-tile-view .vault-file-item > span { display: none; }
.vault-file-grid.is-tile-view .vault-file-open { flex: 1; flex-direction: column; justify-content: center; gap: 0.65rem; padding: 0.7rem 0.25rem 0.2rem; text-align: center; }
.vault-file-grid.is-tile-view .vault-file-icon { width: 3.35rem; height: 3.65rem; border-radius: 0.65rem; }
.vault-file-grid.is-tile-view .vault-folder-item .vault-file-icon { height: 3.35rem; }
.vault-file-grid.is-tile-view .vault-file-icon svg { width: 1.45rem; height: 1.45rem; }
.vault-file-grid.is-tile-view .vault-file-copy { width: 100%; justify-items: center; }
.vault-file-grid.is-tile-view .vault-file-copy strong { width: 100%; white-space: normal; overflow-wrap: anywhere; line-height: 1.3; }
.vault-file-grid.is-tile-view .vault-file-copy > span:not(.vault-item-tags) { max-width: 100%; }
.vault-file-grid.is-tile-view .vault-item-tags { justify-content: center; }
.vault-file-grid.is-tile-view .vault-file-actions { width: 100%; justify-content: center; opacity: 1; transform: none; }

@media (max-width: 520px) {
  .vault-view-switch { order: -1; }
  .vault-file-grid.is-tile-view { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .vault-file-grid.is-tile-view .vault-file-item,
  .vault-file-grid.is-tile-view .vault-file-item:nth-child(odd),
  .vault-file-grid.is-tile-view .vault-file-item:nth-child(even) { min-height: 10rem; }
}
</style>
