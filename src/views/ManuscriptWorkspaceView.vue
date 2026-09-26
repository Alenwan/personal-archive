<script setup lang="ts">
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Download,
  FileText,
  History,
  KeyRound,
  LockKeyhole,
  LogIn,
  LoaderCircle,
  MoreHorizontal,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  PanelTopClose,
  PanelTopOpen,
  Pilcrow,
  Plus,
  Save,
  Settings2,
  ShieldCheck,
  RotateCcw,
  Trash2,
  X
} from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { ApiError, client } from "../api/client";
import ArchiveManagementAccess from "../components/documents/ArchiveManagementAccess.vue";
import { useArchiveContentManagement } from "../composables/useArchiveContentManagement";
import RichTextEditor from "../components/editor/RichTextEditor.vue";
import ManuscriptReaderDialog from "../components/reading/ManuscriptReaderDialog.vue";
import ReadingAppearanceControls from "../components/reading/ReadingAppearanceControls.vue";
import { useDismissibleMenus } from "../composables/useDismissibleMenus";
import { useManuscriptContentsVisibility } from "../composables/useManuscriptContentsVisibility";
import { useReadingPreferences } from "../readingPreferences";
import { useAuthStore } from "../stores/auth";
import { useBusinessTemplate } from "../businessTemplate";
import { useToastStore } from "../stores/toasts";
import {
  deleteManuscriptLocalDraft,
  listManuscriptLocalDrafts,
  readManuscriptLocalDraft,
  writeManuscriptLocalDraft,
  type ManuscriptLocalDraft
} from "../shared/manuscriptLocalDraft";
import {
  createManuscriptEncryption,
  decryptManuscriptBody,
  encryptManuscriptBody,
  rewrapManuscriptKeyWithPassword,
  unlockManuscriptWithPassword,
  type ManuscriptWorkKey
} from "../shared/manuscriptEncryption";
import { takeStagedManuscriptKey } from "../shared/manuscriptUnlockSession";
import {
  MANUSCRIPT_KINDS,
  MANUSCRIPT_STATUSES,
  MANUSCRIPT_CHAPTER_VERSION_RETENTION,
  type Manuscript,
  type ManuscriptBodyEncryptionChapter,
  type ManuscriptBodyEncryptionVersion,
  type ManuscriptChapter,
  type ManuscriptChapterFormat,
  type ManuscriptChapterSummary,
  type ManuscriptChapterVersion,
  type ManuscriptChapterVersionSummary,
  type ManuscriptInput
} from "../shared/types";
import {
  markdownOutline,
  markdownToRichText,
  richTextOutline,
  richTextToMarkdown,
  type ManuscriptOutlineEntry
} from "../shared/manuscriptContent";
import { countTextCharacters, plainTextFromRichText } from "../shared/textMetrics";
import { scrollTextareaOffsetIntoView } from "../shared/textareaPosition";
import { buildManuscriptExport } from "../server/services/manuscriptExport";

type EditorHandle = {
  focus: () => void;
  getScrollProgress: () => number;
  restoreScrollProgress: (progress: number) => void;
  scrollToHeading: (index: number) => boolean;
  replaceInlineImage: (token: string, source: string, alt?: string) => boolean;
  removeInlineImage: (token: string) => boolean;
};

type MarkdownSpellcheckMode = "auto" | "on" | "off";
type BrowserIdleHandle = { id: number; idle: boolean };

const BODY_ANALYSIS_DELAY_MS = 400;
const LONG_MARKDOWN_CHARACTER_THRESHOLD = 50_000;
const MARKDOWN_SPELLCHECK_STORAGE_KEY = "personal-archive.manuscript-markdown-spellcheck";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const draftScope = { instanceId: window.location.origin, userId: auth.user?.userId || "" };
const identityBlocked = computed(() => auth.sessionUncertain || !draftScope.userId || auth.user?.userId !== draftScope.userId);
function requireOriginalEditorAccount() {
  if (identityBlocked.value || !auth.canAddNotes) throw new Error("Verify the original editor account before continuing.");
}
const persistPlaintext = ref(false);
const draftPreferenceKey = `personal-archive.writing-device-consent.${JSON.stringify([draftScope, String(route.params.id ?? "")])}`;
try { persistPlaintext.value = localStorage.getItem(draftPreferenceKey) === "true"; } catch { /* Keep plaintext in memory. */ }
const toasts = useToastStore();
const manuscript = ref<Manuscript | null>(null);
const activeChapter = ref<ManuscriptChapter | null>(null);
const activeChapterId = ref("");
const chapterTitle = ref("");
const chapterBody = ref("");
const chapterFormat = ref<ManuscriptChapterFormat>("rich-text");
const loading = ref(true);
const chapterLoading = ref(false);
const savingMetadata = ref(false);
const deletingManuscript = ref(false);
const exportingManuscript = ref(false);
const error = ref("");
const saveState = ref<"saved" | "unsaved" | "saving" | "uploading" | "error">("saved");
const sessionExpired = ref(false);
const saveConflict = ref(false);
const localDraftSavedAt = ref("");
const recoveredDraftAt = ref("");
const pendingRecoveryDraft = ref<ManuscriptLocalDraft | null>(null);
const pendingImages = ref(0);
const metadataOpen = ref(false);
const chapterVersions = ref<ManuscriptChapterVersionSummary[]>([]);
const versionsLoading = ref(false);
const versionError = ref("");
const selectedVersion = ref<ManuscriptChapterVersion | null>(null);
const versionLoadingId = ref("");
const restoringVersionId = ref("");
const readerOpen = ref(false);
const readerInitialProgress = ref(0);
const encryptionKey = shallowRef<ManuscriptWorkKey | null>(null);
const unlockSecret = ref("");
const unlocking = ref(false);
const unlockError = ref("");
const encryptionDialog = ref<"enable" | "password" | "disable" | "reset" | null>(null);
const accountPassword = ref("");
const encryptionPassword = ref("");
const encryptionPasswordConfirm = ref("");
const encryptionBusy = ref(false);
const encryptionProgress = ref("");
const encryptionError = ref("");
const appearanceOpen = ref(false);
const selectedOutlineKey = ref("");
const editor = ref<EditorHandle | null>(null);
const markdownEditor = ref<HTMLTextAreaElement | null>(null);
const contentsHideButton = ref<HTMLButtonElement | null>(null);
const contentsRestoreButton = ref<HTMLButtonElement | null>(null);
const toolbarHideButton = ref<HTMLButtonElement | null>(null);
const toolbarRestoreButton = ref<HTMLButtonElement | null>(null);
const suppressAutosave = ref(false);
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let maxSaveTimer: ReturnType<typeof setTimeout> | null = null;
let localDraftTimer: ReturnType<typeof setTimeout> | null = null;
let maxLocalDraftTimer: ReturnType<typeof setTimeout> | null = null;
let localDraftIdleHandle: BrowserIdleHandle | null = null;
let bodyAnalysisTimer: ReturnType<typeof setTimeout> | null = null;
let bodyAnalysisIdleHandle: BrowserIdleHandle | null = null;
let bodyAnalysisRevision = 0;
let savePromise: Promise<void> | null = null;
let saveRequestedSource: "autosave" | "manual" | null = null;
let localDraftOperation: Promise<void> = Promise.resolve();
let localDraftWarningShown = false;
let lastSavedTitle = "";
let lastSavedBody = "";
let lastSavedFormat: ManuscriptChapterFormat = "rich-text";
let activeChapterUpdatedAt = "";
let activeChapterRevision = 1;
let preferredEncryptedChapterId = "";
let encryptionIdleTimer: ReturnType<typeof setInterval> | null = null;
let lastEncryptionActivity = Date.now();

const metadata = reactive<ManuscriptInput>({
  title: "",
  kind: "Long document",
  status: "Draft",
  description: ""
});

useDismissibleMenus();
const { contentsOpen } = useManuscriptContentsVisibility();
const { preferences, fontFamily } = useReadingPreferences();
const compactViewport = ref(false);
const mobileContentsOpen = ref(false);
const toolbarOpen = ref(true);
const currentCharacterCount = ref(0);
const outlineEntries = shallowRef<ManuscriptOutlineEntry[]>([]);
const markdownSpellcheckMode = ref<MarkdownSpellcheckMode>(readMarkdownSpellcheckMode());

const manuscriptId = computed(() => String(route.params.id ?? ""));
const { template } = useBusinessTemplate();
const { canManageContent, setManagementExpiry, managementLabel } = useArchiveContentManagement();
const keyOwnerUserId = computed(() => template.value.personalArchive ? manuscript.value?.keyOwnerUserId : manuscript.value?.createdBy);
const canManageEncryption = computed(() => Boolean(keyOwnerUserId.value && keyOwnerUserId.value === auth.user?.userId)
  && auth.canEditDocuments && !identityBlocked.value && !sessionExpired.value);
const chapters = computed(() => manuscript.value?.chapters ?? []);
const activeIndex = computed(() => chapters.value.findIndex((chapter) => chapter.chapterId === activeChapterId.value));
const encryptionLocked = computed(() => Boolean(manuscript.value?.encryptionEnabled && !encryptionKey.value));
const canManageWork = computed(() => (template.value.personalArchive ? auth.canEditDocuments : auth.canAddNotes)
  && canManageContent(manuscript.value?.managementOwnerUserId)
  && !identityBlocked.value && !sessionExpired.value);
const canEdit = computed(() => canManageWork.value && !encryptionLocked.value && !pendingRecoveryDraft.value && !saveConflict.value);
const canCreateChapter = computed(() => auth.canAddNotes && canManageContent(manuscript.value?.managementOwnerUserId)
  && !identityBlocked.value && !sessionExpired.value && !encryptionLocked.value && !pendingRecoveryDraft.value && !saveConflict.value);
const manualSaveDisabled = computed(() => !canEdit.value
  || !activeChapter.value
  || chapterLoading.value
  || pendingImages.value > 0
  || saveState.value === "saving");
const markdownSpellcheckEnabled = computed(() => markdownSpellcheckMode.value === "on"
  || (markdownSpellcheckMode.value === "auto" && chapterBody.value.length < LONG_MARKDOWN_CHARACTER_THRESHOLD));
const markdownSpellcheckTitle = computed(() => markdownSpellcheckMode.value === "auto"
  && chapterBody.value.length >= LONG_MARKDOWN_CHARACTER_THRESHOLD
  ? "Spellcheck is paused automatically for this long document to keep typing responsive."
  : "Choose how browser spellcheck behaves while editing Markdown.");
const versionPreviewText = computed(() => {
  if (!selectedVersion.value) return "";
  return selectedVersion.value.contentFormat === "markdown"
    ? selectedVersion.value.body
    : plainTextFromRichText(selectedVersion.value.body);
});
const singleMarkdownDocument = computed(() => chapterFormat.value === "markdown" && chapters.value.length === 1);
const contentsCount = computed(() => singleMarkdownDocument.value ? outlineEntries.value.length : chapters.value.length);
const contentsPanelOpen = computed(() => compactViewport.value ? mobileContentsOpen.value : contentsOpen.value);
const workspaceSubtitle = computed(() => singleMarkdownDocument.value
  ? `${manuscript.value?.kind ?? "Long document"} · Markdown · ${formatCount(manuscript.value?.characterCount ?? 0)} characters`
  : `${manuscript.value?.kind ?? "Long document"} · ${chapters.value.length} chapters · ${formatCount(manuscript.value?.characterCount ?? 0)} characters`);
const workspaceStyle = computed(() => ({
  "--workspace-surface": preferences.backgroundColor,
  "--workspace-ink": preferences.textColor,
  "--workspace-muted": "color-mix(in srgb, var(--workspace-ink) 64%, var(--workspace-surface))",
  "--workspace-border": "color-mix(in srgb, var(--workspace-ink) 17%, var(--workspace-surface))",
  "--workspace-soft": "color-mix(in srgb, var(--workspace-ink) 4%, var(--workspace-surface))",
  "--workspace-active": "color-mix(in srgb, var(--personal-accent, #4fa69e) 18%, var(--workspace-surface))",
  "--workspace-font": fontFamily.value,
  "--workspace-font-size": `${preferences.fontSize}px`,
  "--workspace-line-height": String(preferences.lineHeight),
  "--workspace-width": `${preferences.contentWidth}px`,
  "--appearance-surface": preferences.backgroundColor,
  "--appearance-ink": preferences.textColor
}));

function formatCount(value: number) {
  return new Intl.NumberFormat().format(value);
}

function readMarkdownSpellcheckMode(): MarkdownSpellcheckMode {
  if (typeof window === "undefined") return "auto";
  try {
    const stored = window.localStorage.getItem(MARKDOWN_SPELLCHECK_STORAGE_KEY);
    return stored === "on" || stored === "off" ? stored : "auto";
  } catch {
    return "auto";
  }
}

function requestBrowserIdle(callback: () => void, timeout = 1_000): BrowserIdleHandle {
  const idleWindow = window as Window & {
    requestIdleCallback?: (task: () => void, options?: { timeout: number }) => number;
  };
  if (idleWindow.requestIdleCallback) {
    return { id: idleWindow.requestIdleCallback(callback, { timeout }), idle: true };
  }
  return { id: window.setTimeout(callback, 0), idle: false };
}

function cancelBrowserIdle(handle: BrowserIdleHandle | null) {
  if (!handle) return;
  if (handle.idle) {
    const idleWindow = window as Window & { cancelIdleCallback?: (id: number) => void };
    idleWindow.cancelIdleCallback?.(handle.id);
  } else {
    window.clearTimeout(handle.id);
  }
}

function cancelBodyAnalysis() {
  bodyAnalysisRevision += 1;
  if (bodyAnalysisTimer) clearTimeout(bodyAnalysisTimer);
  bodyAnalysisTimer = null;
  cancelBrowserIdle(bodyAnalysisIdleHandle);
  bodyAnalysisIdleHandle = null;
}

function applyBodyAnalysis(source: string, format: ManuscriptChapterFormat, revision: number) {
  const characterCount = countTextCharacters(source);
  const entries = format === "markdown" ? markdownOutline(source) : richTextOutline(source);
  if (revision !== bodyAnalysisRevision) return;
  currentCharacterCount.value = characterCount;
  outlineEntries.value = entries;
}

function refreshBodyAnalysisNow() {
  cancelBodyAnalysis();
  const revision = bodyAnalysisRevision;
  applyBodyAnalysis(chapterBody.value, chapterFormat.value, revision);
}

function scheduleBodyAnalysis() {
  cancelBodyAnalysis();
  const revision = bodyAnalysisRevision;
  bodyAnalysisTimer = setTimeout(() => {
    bodyAnalysisTimer = null;
    const source = chapterBody.value;
    const format = chapterFormat.value;
    bodyAnalysisIdleHandle = requestBrowserIdle(() => {
      bodyAnalysisIdleHandle = null;
      applyBodyAnalysis(source, format, revision);
    }, 1_200);
  }, BODY_ANALYSIS_DELAY_MS);
}

function cancelLocalDraftIdle() {
  cancelBrowserIdle(localDraftIdleHandle);
  localDraftIdleHandle = null;
}

function persistLocalDraftWhenIdle() {
  if (localDraftIdleHandle) return;
  localDraftIdleHandle = requestBrowserIdle(() => {
    localDraftIdleHandle = null;
    void persistLocalDraft();
  }, 1_000);
}

function formatDraftTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(date);
}

function saveSourceLabel(source: ManuscriptChapterVersionSummary["saveSource"]) {
  if (source === "autosave") return "Auto-save";
  if (source === "restore") return "Restored";
  return "Manual save";
}

function currentDraftSnapshot(): ManuscriptLocalDraft | null {
  if (!activeChapter.value) return null;
  return {
    manuscriptId: manuscriptId.value,
    chapterId: activeChapter.value.chapterId,
    title: chapterTitle.value,
    body: chapterBody.value,
    contentFormat: chapterFormat.value,
    baseUpdatedAt: activeChapterUpdatedAt,
    savedAt: new Date().toISOString()
  };
}

function runLocalDraftOperation(operation: () => Promise<void>) {
  localDraftOperation = localDraftOperation.catch(() => undefined).then(operation);
  return localDraftOperation;
}

async function persistLocalDraft() {
  cancelLocalDraftIdle();
  if (suppressAutosave.value) return;
  if (saveState.value === "saved"
    && chapterTitle.value.trim() === lastSavedTitle
    && chapterBody.value.trim() === lastSavedBody
    && chapterFormat.value === lastSavedFormat) return;
  if (localDraftTimer) clearTimeout(localDraftTimer);
  if (maxLocalDraftTimer) clearTimeout(maxLocalDraftTimer);
  localDraftTimer = null;
  maxLocalDraftTimer = null;
  const draft = currentDraftSnapshot();
  if (!draft) return;
  try {
    const storedDraft = manuscript.value?.encryptionEnabled
      ? {
          ...draft,
          body: await encryptManuscriptBody(
            encryptionKey.value ?? (() => { throw new Error("Unlock the work before protecting its local draft."); })(),
            draft.manuscriptId,
            draft.chapterId,
            draft.body
          ),
          encrypted: true
        }
      : { ...draft, encrypted: false };
    await runLocalDraftOperation(async () => { await writeManuscriptLocalDraft(storedDraft, draftScope, persistPlaintext.value); });
    if (activeChapterId.value === draft.chapterId) localDraftSavedAt.value = draft.savedAt;
  } catch (draftError) {
    if (!localDraftWarningShown) {
      localDraftWarningShown = true;
      toasts.error("Local draft protection is unavailable", draftError instanceof Error ? draftError.message : "Copy your work before leaving this page.");
    }
  }
}

function queueLocalDraft() {
  if (suppressAutosave.value || !activeChapter.value) return;
  cancelLocalDraftIdle();
  if (localDraftTimer) clearTimeout(localDraftTimer);
  localDraftTimer = setTimeout(() => {
    localDraftTimer = null;
    persistLocalDraftWhenIdle();
  }, 5_000);
  if (!maxLocalDraftTimer) {
    maxLocalDraftTimer = setTimeout(() => {
      maxLocalDraftTimer = null;
      persistLocalDraftWhenIdle();
    }, 15_000);
  }
}

function clearAutosaveTimers() {
  if (saveTimer) clearTimeout(saveTimer);
  if (maxSaveTimer) clearTimeout(maxSaveTimer);
  saveTimer = null;
  maxSaveTimer = null;
}

async function clearCurrentLocalDraft(chapterId: string) {
  cancelLocalDraftIdle();
  if (localDraftTimer) clearTimeout(localDraftTimer);
  if (maxLocalDraftTimer) clearTimeout(maxLocalDraftTimer);
  localDraftTimer = null;
  maxLocalDraftTimer = null;
  await runLocalDraftOperation(() => deleteManuscriptLocalDraft(manuscriptId.value, chapterId, draftScope));
  if (activeChapterId.value === chapterId) localDraftSavedAt.value = "";
}

function downloadDraft(draft = currentDraftSnapshot()) {
  if (!draft) return;
  const extension = draft.contentFormat === "markdown" ? "md" : "html";
  const safeTitle = (draft.title.trim() || "writing-draft").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([draft.body], { type: "text/plain;charset=utf-8" }));
  link.download = `${safeTitle}.${extension}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

async function hideContents() {
  if (compactViewport.value) mobileContentsOpen.value = false;
  else contentsOpen.value = false;
  await nextTick();
  contentsRestoreButton.value?.focus();
}

async function showContents() {
  if (compactViewport.value) mobileContentsOpen.value = true;
  else contentsOpen.value = true;
  await nextTick();
  contentsHideButton.value?.focus();
}

async function hideToolbar() {
  appearanceOpen.value = false;
  toolbarOpen.value = false;
  await nextTick();
  toolbarRestoreButton.value?.focus();
}

async function showToolbar() {
  toolbarOpen.value = true;
  await nextTick();
  toolbarHideButton.value?.focus();
}

function dismissMobileContents() {
  if (compactViewport.value) mobileContentsOpen.value = false;
}

function updateCompactViewport() {
  compactViewport.value = window.matchMedia("(max-width: 780px)").matches;
  if (!compactViewport.value) mobileContentsOpen.value = false;
}

async function selectChapterFromContents(chapterId: string) {
  await loadChapter(chapterId, true, 0);
  dismissMobileContents();
}

function hydrateMetadata(record: Manuscript) {
  Object.assign(metadata, {
    title: record.title,
    kind: record.kind,
    status: record.status,
    description: record.description
  });
}

async function loadManuscript(preferredChapterId?: string) {
  loading.value = true;
  error.value = "";
  try {
    const record = await client.manuscript(manuscriptId.value);
    manuscript.value = record;
    hydrateMetadata(record);
    const target = record.chapters.find((chapter) => chapter.chapterId === preferredChapterId)
      ?? record.chapters[0];
    if (record.encryptionEnabled) {
      preferredEncryptedChapterId = target?.chapterId ?? "";
      encryptionKey.value?.fill(0);
      const stagedKey = takeStagedManuscriptKey(record.manuscriptId);
      if (stagedKey && target) {
        encryptionKey.value = stagedKey;
        lastEncryptionActivity = Date.now();
        try {
          await loadChapter(target.chapterId, false, undefined, true);
        } catch (chapterError) {
          stagedKey.fill(0);
          encryptionKey.value = null;
          throw chapterError;
        }
      } else {
        stagedKey?.fill(0);
        encryptionKey.value = null;
        activeChapter.value = null;
        activeChapterId.value = "";
        chapterBody.value = "";
      }
    } else if (target) {
      await loadChapter(target.chapterId, false);
    }
  } catch (loadError) {
    error.value = loadError instanceof Error ? loadError.message : "Unable to load this work";
  } finally {
    loading.value = false;
  }
}

async function refreshManuscript() {
  const record = await client.manuscript(manuscriptId.value);
  manuscript.value = record;
  hydrateMetadata(record);
  return record;
}

function clampProgress(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function editorProgress() {
  if (chapterFormat.value === "markdown" && markdownEditor.value) {
    const maximum = Math.max(0, markdownEditor.value.scrollHeight - markdownEditor.value.clientHeight);
    return maximum > 4 ? clampProgress(markdownEditor.value.scrollTop / maximum) : 0;
  }
  return editor.value?.getScrollProgress() ?? 0;
}

async function restoreEditorProgress(progress: number) {
  const normalized = clampProgress(progress);
  await nextTick();
  requestAnimationFrame(() => {
    if (chapterFormat.value === "markdown" && markdownEditor.value) {
      const maximum = Math.max(0, markdownEditor.value.scrollHeight - markdownEditor.value.clientHeight);
      markdownEditor.value.scrollTop = maximum * normalized;
      return;
    }
    editor.value?.restoreScrollProgress(normalized);
  });
}

async function loadChapter(chapterId: string, saveCurrent = true, targetProgress?: number, force = false) {
  if (chapterLoading.value) return;
  if (chapterId === activeChapterId.value && !force) {
    if (targetProgress !== undefined) await restoreEditorProgress(targetProgress);
    return;
  }
  if (saveCurrent && !(await saveChapterNow())) return;
  chapterLoading.value = true;
  error.value = "";
  try {
    const chapter = await client.manuscriptChapter(manuscriptId.value, chapterId);
    const workKey = encryptionKey.value;
    if (manuscript.value?.encryptionEnabled && !workKey) throw new Error("Unlock this work before loading its body.");
    const body = manuscript.value?.encryptionEnabled
      ? await decryptManuscriptBody(workKey!, manuscriptId.value, chapterId, chapter.body)
      : chapter.body;
    const storedLocalDraft = await readManuscriptLocalDraft(manuscriptId.value, chapterId, draftScope);
    const localDraft = storedLocalDraft && manuscript.value?.encryptionEnabled && storedLocalDraft.encrypted
      ? {
          ...storedLocalDraft,
          body: await decryptManuscriptBody(workKey!, manuscriptId.value, chapterId, storedLocalDraft.body),
          encrypted: false
        }
      : storedLocalDraft;
    if (identityBlocked.value) return;
    const decryptedChapter = { ...chapter, body };
    suppressAutosave.value = true;
    activeChapter.value = decryptedChapter;
    activeChapterId.value = chapter.chapterId;
    chapterTitle.value = chapter.title;
    chapterBody.value = body;
    chapterFormat.value = chapter.contentFormat ?? "rich-text";
    selectedOutlineKey.value = "";
    lastSavedTitle = chapter.title;
    lastSavedBody = body;
    lastSavedFormat = chapter.contentFormat ?? "rich-text";
    activeChapterUpdatedAt = chapter.updatedAt;
    activeChapterRevision = chapter.revision;
    sessionExpired.value = false;
    saveConflict.value = false;
    recoveredDraftAt.value = "";
    pendingRecoveryDraft.value = null;
    saveState.value = "saved";
    const draftDiffers = localDraft
      && (localDraft.title !== chapter.title || localDraft.body !== body || localDraft.contentFormat !== (chapter.contentFormat ?? "rich-text"));
    let restoredLocalDraft = false;
    if (draftDiffers && localDraft.baseUpdatedAt === chapter.updatedAt) {
      chapterTitle.value = localDraft.title;
      chapterBody.value = localDraft.body;
      chapterFormat.value = localDraft.contentFormat;
      localDraftSavedAt.value = localDraft.savedAt;
      recoveredDraftAt.value = localDraft.savedAt;
      saveState.value = "unsaved";
      restoredLocalDraft = true;
    } else if (draftDiffers) {
      pendingRecoveryDraft.value = localDraft;
      localDraftSavedAt.value = localDraft.savedAt;
    } else if (localDraft) {
      await clearCurrentLocalDraft(chapter.chapterId);
    } else {
      localDraftSavedAt.value = "";
    }
    refreshBodyAnalysisNow();
    await nextTick();
    if (targetProgress !== undefined) await restoreEditorProgress(targetProgress);
    suppressAutosave.value = false;
    if (restoredLocalDraft) {
      toasts.info("Unsaved local draft recovered", `Protected ${formatDraftTime(localDraft!.savedAt)}. Saving it back to the server now.`);
      queueLocalDraft();
      queueAutosave();
    }
  } catch (chapterError) {
    suppressAutosave.value = false;
    if (force) saveConflict.value = true;
    error.value = chapterError instanceof Error ? chapterError.message : "Unable to load chapter";
  } finally {
    chapterLoading.value = false;
  }
}

async function reviewSaveConflict() {
  if (!activeChapterId.value) return;
  await persistLocalDraft();
  const chapterId = activeChapterId.value;
  saveConflict.value = false;
  await loadChapter(chapterId, false, undefined, true);
}

async function restorePendingLocalDraft() {
  const draft = pendingRecoveryDraft.value;
  if (!draft || draft.chapterId !== activeChapterId.value) return;
  suppressAutosave.value = true;
  chapterTitle.value = draft.title;
  chapterBody.value = draft.body;
  chapterFormat.value = draft.contentFormat;
  recoveredDraftAt.value = draft.savedAt;
  pendingRecoveryDraft.value = null;
  saveState.value = "unsaved";
  refreshBodyAnalysisNow();
  await nextTick();
  suppressAutosave.value = false;
  queueLocalDraft();
  queueAutosave();
}

async function discardPendingLocalDraft() {
  const draft = pendingRecoveryDraft.value;
  if (!draft) return;
  await runLocalDraftOperation(() => deleteManuscriptLocalDraft(draft.manuscriptId, draft.chapterId, draftScope));
  pendingRecoveryDraft.value = null;
  localDraftSavedAt.value = "";
}

async function retrySaveAfterSignIn() {
  try {
    await auth.loadSession();
    if (identityBlocked.value || !auth.canAddNotes) {
      sessionExpired.value = true;
      toasts.error("Writing remains paused", "Sign in with the account that opened this editor and confirm it still has editing access.");
      return;
    }
    sessionExpired.value = false;
    await saveChapterNow();
  } catch (sessionError) {
    sessionExpired.value = true;
    toasts.error("Unable to check the session", sessionError instanceof Error ? sessionError.message : "Please try again.");
  }
}

async function openReader() {
  readerInitialProgress.value = editorProgress();
  if (!(await saveChapterNow())) return;
  readerOpen.value = true;
}

async function returnToEditor(position: { chapterId: string; progress: number }) {
  readerOpen.value = false;
  await loadChapter(position.chapterId, true, position.progress);
}

function queueAutosave() {
  if (suppressAutosave.value || !activeChapter.value) return;
  if (!savePromise) saveState.value = pendingImages.value ? "uploading" : "unsaved";
  if (!canEdit.value) { clearAutosaveTimers(); return; }
  if (saveTimer) clearTimeout(saveTimer);
  if (pendingImages.value) return;
  saveTimer = setTimeout(() => { void saveChapterNow("autosave"); }, 5_000);
  if (!maxSaveTimer) maxSaveTimer = setTimeout(() => { void saveChapterNow("autosave"); }, 60_000);
}

function editorMatches(title: string, body: string, contentFormat: ManuscriptChapterFormat) {
  return chapterTitle.value.trim() === title && chapterBody.value.trim() === body && chapterFormat.value === contentFormat;
}

async function saveQueuedChapterSnapshots() {
  while (saveRequestedSource && activeChapter.value && !pendingImages.value) {
    if (!canEdit.value) { saveRequestedSource = null; await persistLocalDraft(); return; }
    const saveSource = saveRequestedSource;
    saveRequestedSource = null;
    clearAutosaveTimers();
    const chapterId = activeChapter.value.chapterId;
    const enteredTitle = chapterTitle.value.trim() || "Untitled chapter";
    const saveOutline = singleMarkdownDocument.value && /^(?:Chapter\s+1|Untitled chapter)$/i.test(enteredTitle)
      ? markdownOutline(chapterBody.value)
      : outlineEntries.value;
    const firstMarkdownHeading = saveOutline.find((entry) => entry.level === 1) ?? saveOutline[0];
    const title = singleMarkdownDocument.value && /^(?:Chapter\s+1|Untitled chapter)$/i.test(enteredTitle) && firstMarkdownHeading
      ? firstMarkdownHeading.label
      : enteredTitle;
    if (chapterTitle.value.trim() !== title) chapterTitle.value = title;
    const body = chapterBody.value.trim();
    const contentFormat = chapterFormat.value;
    if (title === lastSavedTitle && body === lastSavedBody && contentFormat === lastSavedFormat) {
      if (editorMatches(title, body, contentFormat)) {
        saveState.value = "saved";
        await clearCurrentLocalDraft(chapterId);
      }
      continue;
    }
    saveState.value = "saving";
    try {
      const serverBody = manuscript.value?.encryptionEnabled
        ? await encryptManuscriptBody(
            encryptionKey.value ?? (() => { throw new Error("Unlock this work before saving."); })(),
            manuscriptId.value,
            chapterId,
            body
          )
        : body;
      const savedSummary = await client.updateManuscriptChapter(manuscriptId.value, chapterId, {
        title,
        body: serverBody,
        characterCount: countTextCharacters(body),
        contentFormat,
        expectedRevision: activeChapterRevision,
        saveSource
      }, draftScope.userId);
      if (identityBlocked.value) { await persistLocalDraft(); return; }
      const saved: ManuscriptChapter = { ...savedSummary, body };
      lastSavedTitle = saved.title;
      lastSavedBody = body;
      lastSavedFormat = saved.contentFormat;
      activeChapterUpdatedAt = saved.updatedAt;
      activeChapterRevision = saved.revision;
      activeChapter.value = saved;
      sessionExpired.value = false;
      saveConflict.value = false;
      error.value = "";
      const summaryIndex = manuscript.value?.chapters.findIndex((chapter) => chapter.chapterId === saved.chapterId) ?? -1;
      if (manuscript.value && summaryIndex >= 0) {
        const oldCount = manuscript.value.chapters[summaryIndex].characterCount;
        manuscript.value.chapters[summaryIndex] = savedSummary;
        manuscript.value.characterCount += saved.characterCount - oldCount;
        manuscript.value.updatedAt = saved.updatedAt;
      }
      if (editorMatches(title, body, contentFormat)) {
        saveState.value = "saved";
        recoveredDraftAt.value = "";
        await clearCurrentLocalDraft(chapterId);
      } else {
        saveState.value = "unsaved";
        queueAutosave();
      }
    } catch (saveError) {
      saveState.value = "error";
      error.value = saveError instanceof Error ? saveError.message : "Unable to save chapter";
      const expired = saveError instanceof ApiError && [401, 403].includes(saveError.status);
      const conflicted = saveError instanceof ApiError && saveError.status === 409;
      if (conflicted) {
        saveConflict.value = true;
        sessionExpired.value = false;
        toasts.error("Newer server copy detected — local draft protected", "Review both copies before choosing what to save.");
      } else if (expired && !sessionExpired.value) {
        toasts.error("Saving paused — draft kept in this tab", "Sign in with the original account in a new tab, then retry. Do not refresh this tab.");
      } else if (!expired) {
        toasts.error("Save failed — draft kept locally", error.value);
      }
      if (!conflicted) sessionExpired.value = expired;
      await persistLocalDraft();
      return;
    }
  }
}

async function saveChapterNow(source: "autosave" | "manual" = "manual"): Promise<boolean> {
  if (!activeChapter.value) return true;
  if (pendingImages.value || pendingRecoveryDraft.value || saveConflict.value) return false;
  if (!canEdit.value) { await persistLocalDraft(); return saveState.value === "saved" && !identityBlocked.value; }
  if (!saveRequestedSource || source === "manual") saveRequestedSource = source;
  if (!savePromise) {
    savePromise = saveQueuedChapterSnapshots();
    try {
      await savePromise;
    } finally {
      savePromise = null;
    }
  } else {
    await savePromise;
  }
  return saveState.value === "saved";
}

async function insertImage(payload: { token: string; file: File }) {
  pendingImages.value += 1;
  saveState.value = "uploading";
  try {
    const form = new FormData();
    form.append("file", payload.file);
    form.append("category", "Books & Reading");
    form.append("notes", `Inline image for manuscript ${manuscriptId.value}, chapter ${activeChapterId.value}`);
    if (template.value.personalArchive) form.append("manuscriptId", manuscriptId.value);
    if (!canEdit.value) throw new Error("Sign in with the original editor account before uploading.");
    const document = await client.uploadArchiveDocument(form, draftScope.userId);
    if (identityBlocked.value) return;
    editor.value?.replaceInlineImage(payload.token, `/api/documents/${document.documentId}/preview`, payload.file.name);
  } catch (uploadError) {
    editor.value?.removeInlineImage(payload.token);
    toasts.error("Image was not inserted", uploadError instanceof Error ? uploadError.message : "Upload failed");
  } finally {
    pendingImages.value = Math.max(0, pendingImages.value - 1);
    queueAutosave();
  }
}

async function setChapterFormat(format: ManuscriptChapterFormat) {
  if (!canEdit.value || format === chapterFormat.value) return;
  if (chapterBody.value.trim()) {
    const confirmed = window.confirm(
      format === "markdown"
        ? "Convert this chapter to Markdown? Headings, lists, links, and images will be translated where possible."
        : "Convert this chapter to rich text? The Markdown source will become formatted content."
    );
    if (!confirmed) return;
  }
  suppressAutosave.value = true;
  chapterBody.value = format === "markdown"
    ? richTextToMarkdown(chapterBody.value)
    : markdownToRichText(chapterBody.value);
  chapterFormat.value = format;
  selectedOutlineKey.value = "";
  await nextTick();
  suppressAutosave.value = false;
  queueAutosave();
  if (format === "markdown") markdownEditor.value?.focus();
  else editor.value?.focus();
}

async function jumpToOutline(entry: ManuscriptOutlineEntry) {
  selectedOutlineKey.value = entry.key;
  await nextTick();
  if (chapterFormat.value === "markdown" && markdownEditor.value && entry.sourceStart !== undefined) {
    const textarea = markdownEditor.value;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(entry.sourceStart, entry.sourceEnd ?? entry.sourceStart);
    scrollTextareaOffsetIntoView(textarea, entry.sourceStart);
    dismissMobileContents();
    return;
  }
  editor.value?.scrollToHeading(entry.headingIndex);
  dismissMobileContents();
}

async function createChapter() {
  if (!canCreateChapter.value) return;
  if (!(await saveChapterNow())) return;
  try {
    const chapterId = crypto.randomUUID();
    const body = manuscript.value?.encryptionEnabled
      ? await encryptManuscriptBody(
          encryptionKey.value ?? (() => { throw new Error("Unlock this work before adding a chapter."); })(),
          manuscriptId.value,
          chapterId,
          ""
        )
      : "";
    requireOriginalEditorAccount();
    const chapter = await client.createManuscriptChapter(manuscriptId.value, {
      chapterId,
      title: `Chapter ${chapters.value.length + 1}`,
      body,
      characterCount: 0,
      contentFormat: chapterFormat.value
    });
    await refreshManuscript();
    await loadChapter(chapter.chapterId, false);
    await nextTick();
    editor.value?.focus();
  } catch (createError) {
    toasts.error("Unable to add chapter", createError instanceof Error ? createError.message : "Please try again.");
  }
}

async function deleteChapter(chapter: ManuscriptChapterSummary) {
  if (!canManageWork.value) return;
  if (!manuscript.value || manuscript.value.chapterCount <= 1) {
    toasts.error("Keep one chapter", "A long-form work must have at least one chapter.");
    return;
  }
  if (!window.confirm(`Remove “${chapter.title}”? It will be archived and no longer shown.`)) return;
  const index = chapters.value.findIndex((item) => item.chapterId === chapter.chapterId);
  try {
    requireOriginalEditorAccount();
    await client.deleteManuscriptChapter(manuscriptId.value, chapter.chapterId);
    const record = await refreshManuscript();
    if (chapter.chapterId === activeChapterId.value) {
      const next = record.chapters[Math.min(index, record.chapters.length - 1)];
      if (next) await loadChapter(next.chapterId, false);
    }
  } catch (deleteError) {
    toasts.error("Unable to remove chapter", deleteError instanceof Error ? deleteError.message : "Please try again.");
  }
}

async function moveChapter(chapter: ManuscriptChapterSummary, direction: -1 | 1) {
  if (!canManageWork.value) return;
  const from = chapters.value.findIndex((item) => item.chapterId === chapter.chapterId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= chapters.value.length) return;
  const neighbour = chapters.value[to];
  try {
    if (!(await saveChapterNow("manual"))) return;
    await Promise.all([
      client.updateManuscriptChapter(manuscriptId.value, chapter.chapterId, { sortOrder: neighbour.sortOrder }),
      client.updateManuscriptChapter(manuscriptId.value, neighbour.chapterId, { sortOrder: chapter.sortOrder })
    ]);
    const record = await refreshManuscript();
    const activeSummary = record.chapters.find((item) => item.chapterId === activeChapterId.value);
    if (activeSummary && activeChapter.value) {
      activeChapter.value = { ...activeChapter.value, ...activeSummary };
      activeChapterRevision = activeSummary.revision;
      activeChapterUpdatedAt = activeSummary.updatedAt;
    }
  } catch (moveError) {
    toasts.error("Unable to move chapter", moveError instanceof Error ? moveError.message : "Please try again.");
  }
}

async function loadVersionHistory() {
  if (!activeChapter.value) return;
  const chapterId = activeChapter.value.chapterId;
  versionsLoading.value = true;
  versionError.value = "";
  try {
    const versions = await client.manuscriptChapterVersions(manuscriptId.value, chapterId, 50);
    if (activeChapterId.value !== chapterId) return;
    chapterVersions.value = versions;
    if (selectedVersion.value && !versions.some((version) => version.versionId === selectedVersion.value?.versionId)) {
      selectedVersion.value = null;
    }
  } catch (versionsError) {
    versionError.value = versionsError instanceof Error ? versionsError.message : "Unable to load version history";
  } finally {
    versionsLoading.value = false;
  }
}

async function openDetails() {
  metadataOpen.value = true;
  chapterVersions.value = [];
  selectedVersion.value = null;
  await loadVersionHistory();
}

async function previewVersion(version: ManuscriptChapterVersionSummary) {
  versionLoadingId.value = version.versionId;
  versionError.value = "";
  try {
    const loaded = await client.manuscriptChapterVersion(
      version.manuscriptId,
      version.chapterId,
      version.versionId
    );
    selectedVersion.value = manuscript.value?.encryptionEnabled
      ? {
          ...loaded,
          body: await decryptManuscriptBody(
            encryptionKey.value ?? (() => { throw new Error("Unlock this work before reading its history."); })(),
            loaded.manuscriptId,
            loaded.chapterId,
            loaded.body
          )
        }
      : loaded;
  } catch (previewError) {
    versionError.value = previewError instanceof Error ? previewError.message : "Unable to load this version";
  } finally {
    versionLoadingId.value = "";
  }
}

async function restoreVersion(version: ManuscriptChapterVersionSummary) {
  if (!canEdit.value || !activeChapter.value || restoringVersionId.value) return;
  if (!window.confirm(`Restore revision ${version.revision} of “${version.title}”? The current server copy will remain in version history.`)) return;
  if (!(await saveChapterNow("manual"))) {
    if (saveConflict.value) metadataOpen.value = false;
    return;
  }
  restoringVersionId.value = version.versionId;
  versionError.value = "";
  try {
    requireOriginalEditorAccount();
    const restored = await client.restoreManuscriptChapterVersion(
      manuscriptId.value,
      activeChapter.value.chapterId,
      version.versionId,
      activeChapterRevision
    );
    const restoredBody = manuscript.value?.encryptionEnabled
      ? await decryptManuscriptBody(
          encryptionKey.value ?? (() => { throw new Error("Unlock this work before restoring its history."); })(),
          restored.manuscriptId,
          restored.chapterId,
          restored.body
        )
      : restored.body;
    const decryptedRestored = { ...restored, body: restoredBody };
    suppressAutosave.value = true;
    const previousCount = manuscript.value?.chapters.find((chapter) => chapter.chapterId === restored.chapterId)?.characterCount ?? 0;
    const { body: _body, ...summary } = restored;
    chapterTitle.value = restored.title;
    chapterBody.value = restoredBody;
    chapterFormat.value = restored.contentFormat;
    activeChapter.value = decryptedRestored;
    lastSavedTitle = restored.title;
    lastSavedBody = restoredBody;
    lastSavedFormat = restored.contentFormat;
    activeChapterUpdatedAt = restored.updatedAt;
    activeChapterRevision = restored.revision;
    saveState.value = "saved";
    saveConflict.value = false;
    sessionExpired.value = false;
    selectedOutlineKey.value = "";
    if (manuscript.value) {
      const summaryIndex = manuscript.value.chapters.findIndex((chapter) => chapter.chapterId === restored.chapterId);
      if (summaryIndex >= 0) manuscript.value.chapters[summaryIndex] = summary;
      manuscript.value.characterCount += restored.characterCount - previousCount;
      manuscript.value.updatedAt = restored.updatedAt;
    }
    await clearCurrentLocalDraft(restored.chapterId);
    await nextTick();
    suppressAutosave.value = false;
    selectedVersion.value = null;
    await loadVersionHistory();
    toasts.success("Previous version restored", `Revision ${version.revision} is now the current part.`);
  } catch (restoreError) {
    suppressAutosave.value = false;
    const conflicted = restoreError instanceof ApiError && restoreError.status === 409;
    if (conflicted) {
      saveState.value = "error";
      saveConflict.value = true;
      metadataOpen.value = false;
      await persistLocalDraft();
      toasts.error("Newer server copy detected — restore stopped", "Your local draft was protected. Review both copies before continuing.");
    } else {
      versionError.value = restoreError instanceof Error ? restoreError.message : "Unable to restore this version";
      toasts.error("Version was not restored", versionError.value);
    }
  } finally {
    restoringVersionId.value = "";
  }
}

async function saveMetadata() {
  if (!canManageWork.value || !manuscript.value || !metadata.title.trim()) return;
  savingMetadata.value = true;
  try {
    requireOriginalEditorAccount();
    const record = await client.updateManuscript(manuscript.value.manuscriptId, {
      title: metadata.title.trim(),
      kind: metadata.kind,
      status: metadata.status,
      description: metadata.description?.trim() ?? ""
    });
    manuscript.value = record;
    hydrateMetadata(record);
    metadataOpen.value = false;
    toasts.success("Work details saved", record.title);
  } catch (metadataError) {
    toasts.error("Unable to save details", metadataError instanceof Error ? metadataError.message : "Please try again.");
  } finally {
    savingMetadata.value = false;
  }
}

async function unlockEncryptedWork() {
  if (!manuscript.value?.encryptionEnabled || unlocking.value || !unlockSecret.value) return;
  unlocking.value = true;
  unlockError.value = "";
  try {
    const key = await unlockManuscriptWithPassword(manuscript.value, unlockSecret.value);
    encryptionKey.value = key;
    lastEncryptionActivity = Date.now();
    const target = preferredEncryptedChapterId || manuscript.value.chapters[0]?.chapterId;
    if (target) await loadChapter(target, false, undefined, true);
    unlockSecret.value = "";
    toasts.success("Work unlocked", "Its body is decrypted only in this browser tab.");
  } catch (unlockFailure) {
    encryptionKey.value?.fill(0);
    encryptionKey.value = null;
    unlockError.value = unlockFailure instanceof Error ? unlockFailure.message : "Unable to unlock this work.";
  } finally {
    unlocking.value = false;
  }
}

async function lockEncryptedWork(reason: "manual" | "idle" = "manual") {
  if (!manuscript.value?.encryptionEnabled || !encryptionKey.value) return;
  const saved = !activeChapter.value || await saveChapterNow("manual");
  if (!saved && !pendingRecoveryDraft.value) await persistLocalDraft();
  preferredEncryptedChapterId = activeChapterId.value || preferredEncryptedChapterId;
  readerOpen.value = false;
  selectedVersion.value = null;
  activeChapter.value = null;
  activeChapterId.value = "";
  chapterTitle.value = "";
  chapterBody.value = "";
  pendingRecoveryDraft.value = null;
  recoveredDraftAt.value = "";
  encryptionKey.value.fill(0);
  encryptionKey.value = null;
  unlockError.value = "";
  if (!saved) toasts.info("Work locked", "The unsaved draft remains encrypted in this browser for recovery after the next unlock.");
  if (reason === "idle") toasts.info("Work locked", "The decrypted key was cleared after 30 minutes without activity.");
}

function openEncryptionDialog(mode: "enable" | "password" | "disable" | "reset") {
  if (!canManageEncryption.value) return;
  encryptionDialog.value = mode;
  accountPassword.value = "";
  encryptionPassword.value = "";
  encryptionPasswordConfirm.value = "";
  encryptionError.value = "";
  encryptionProgress.value = "";
}

async function transformAllManuscriptBodies(key: ManuscriptWorkKey, encrypt: boolean): Promise<{
  chapters: ManuscriptBodyEncryptionChapter[];
  versions: ManuscriptBodyEncryptionVersion[];
}> {
  if (!manuscript.value) throw new Error("Work not loaded.");
  const transformedChapters: ManuscriptBodyEncryptionChapter[] = [];
  const transformedVersions: ManuscriptBodyEncryptionVersion[] = [];
  for (const [index, summary] of manuscript.value.chapters.entries()) {
    encryptionProgress.value = `${encrypt ? "Encrypting" : "Decrypting"} part ${index + 1} of ${manuscript.value.chapters.length}…`;
    const chapter = await client.manuscriptChapter(manuscriptId.value, summary.chapterId);
    transformedChapters.push({
      chapterId: chapter.chapterId,
      expectedRevision: chapter.revision,
      body: encrypt
        ? await encryptManuscriptBody(key, manuscriptId.value, chapter.chapterId, chapter.body)
        : await decryptManuscriptBody(key, manuscriptId.value, chapter.chapterId, chapter.body)
    });
    const versions = await client.manuscriptChapterVersions(
      manuscriptId.value,
      chapter.chapterId,
      MANUSCRIPT_CHAPTER_VERSION_RETENTION
    );
    for (const versionSummary of versions) {
      const version = await client.manuscriptChapterVersion(
        manuscriptId.value,
        chapter.chapterId,
        versionSummary.versionId
      );
      transformedVersions.push({
        versionId: version.versionId,
        chapterId: version.chapterId,
        body: encrypt
          ? await encryptManuscriptBody(key, manuscriptId.value, version.chapterId, version.body)
          : await decryptManuscriptBody(key, manuscriptId.value, version.chapterId, version.body)
      });
    }
  }
  return { chapters: transformedChapters, versions: transformedVersions };
}

async function rewriteLocalDraftEncryption(
  drafts: ManuscriptLocalDraft[],
  key: ManuscriptWorkKey,
  encrypt: boolean
) {
  try {
    for (const draft of drafts) {
      if (encrypt && draft.encrypted) continue;
      if (!encrypt && !draft.encrypted) continue;
      await writeManuscriptLocalDraft({
        ...draft,
        body: encrypt
          ? await encryptManuscriptBody(key, draft.manuscriptId, draft.chapterId, draft.body)
          : await decryptManuscriptBody(key, draft.manuscriptId, draft.chapterId, draft.body),
        encrypted: encrypt
      }, draftScope, persistPlaintext.value);
    }
  } catch (draftError) {
    toasts.error(
      "A local draft could not be converted",
      draftError instanceof Error ? draftError.message : "The server copy was converted successfully."
    );
  }
}

async function applyEncryptionChange() {
  if (!canManageEncryption.value || !manuscript.value || encryptionBusy.value || !encryptionDialog.value) return;
  encryptionError.value = "";
  const mode = encryptionDialog.value;
  if (mode === "enable" || mode === "password" || mode === "reset") {
    if (!encryptionPassword.value) {
      encryptionError.value = "Enter an encryption password.";
      return;
    }
    if (encryptionPassword.value !== encryptionPasswordConfirm.value) {
      encryptionError.value = "The two passwords do not match.";
      return;
    }
  }
  if (mode === "disable" && !encryptionPassword.value) {
    encryptionError.value = "Enter the current encryption password to remove protection.";
    return;
  }
  if (mode === "reset" && !accountPassword.value) {
    encryptionError.value = "Enter your current account password.";
    return;
  }
  encryptionBusy.value = true;
  try {
    if (!(await saveChapterNow("manual"))) throw new Error("Save or resolve the current draft before changing encryption.");
    if (mode === "enable") {
      const drafts = await listManuscriptLocalDrafts(manuscriptId.value, draftScope);
      const created = await createManuscriptEncryption(encryptionPassword.value);
      const bodies = await transformAllManuscriptBodies(created.workKey, true);
      encryptionProgress.value = "Committing encrypted bodies and protected history…";
      requireOriginalEditorAccount();
      const record = await client.enableManuscriptEncryption(manuscriptId.value, {
        ...bodies,
        metadata: created.metadata,
        recoveryWorkKey: created.recoveryWorkKey
      });
      manuscript.value = record;
      encryptionKey.value = created.workKey;
      lastEncryptionActivity = Date.now();
      await rewriteLocalDraftEncryption(drafts, created.workKey, true);
      encryptionDialog.value = null;
      encryptionPassword.value = "";
      encryptionPasswordConfirm.value = "";
      toasts.success("Body encryption enabled", "If you forget this password, verify your account password to reset it.");
      return;
    }
    if (mode === "password") {
      const key = encryptionKey.value;
      if (!key) throw new Error("Unlock this work before changing its password.");
      const metadata = await rewrapManuscriptKeyWithPassword(
        key,
        encryptionPassword.value
      );
      requireOriginalEditorAccount();
      manuscript.value = await client.updateManuscriptEncryptionKey(manuscriptId.value, metadata);
      encryptionDialog.value = null;
      toasts.success("Encryption password changed", "The body key and encrypted content were not replaced.");
      return;
    }
    if (mode === "reset") {
      requireOriginalEditorAccount();
      manuscript.value = await client.resetManuscriptEncryptionPassword(manuscriptId.value, {
        currentAccountPassword: accountPassword.value,
        newEncryptionPassword: encryptionPassword.value
      });
      accountPassword.value = "";
      encryptionPassword.value = "";
      encryptionPasswordConfirm.value = "";
      encryptionDialog.value = null;
      unlockSecret.value = "";
      unlockError.value = "";
      toasts.success("Encryption password reset", "Use the new encryption password to unlock this work.");
      return;
    }
    const verifiedKey = await unlockManuscriptWithPassword(manuscript.value, encryptionPassword.value);
    const drafts = await listManuscriptLocalDrafts(manuscriptId.value, draftScope);
    const bodies = await transformAllManuscriptBodies(verifiedKey, false);
    encryptionProgress.value = "Committing decrypted bodies and history…";
    requireOriginalEditorAccount();
    const record = await client.disableManuscriptEncryption(manuscriptId.value, bodies);
    manuscript.value = record;
    await rewriteLocalDraftEncryption(drafts, verifiedKey, false);
    verifiedKey.fill(0);
    encryptionKey.value?.fill(0);
    encryptionKey.value = null;
    encryptionDialog.value = null;
    toasts.success("Body encryption removed", "Current and historical bodies are stored normally again.");
  } catch (changeError) {
    encryptionError.value = changeError instanceof Error ? changeError.message : "Encryption could not be changed.";
  } finally {
    encryptionBusy.value = false;
    encryptionProgress.value = "";
  }
}

async function decryptReaderChapterBody(chapter: ManuscriptChapter) {
  if (!manuscript.value?.encryptionEnabled) return chapter;
  if (!encryptionKey.value) throw new Error("Unlock this work before reading it.");
  return {
    ...chapter,
    body: await decryptManuscriptBody(encryptionKey.value, chapter.manuscriptId, chapter.chapterId, chapter.body)
  };
}

async function exportManuscript() {
  if (!manuscript.value || exportingManuscript.value) return;
  exportingManuscript.value = true;
  try {
    if (activeChapter.value && auth.canAddNotes) {
      const saved = await saveChapterNow("manual");
      if (!saved) {
        toasts.error("Export stopped", "Save or resolve the protected local draft before exporting the whole work.");
        return;
      }
    }
    if (!manuscript.value.encryptionEnabled) {
      const link = document.createElement("a");
      link.href = `/api/manuscripts/${encodeURIComponent(manuscript.value.manuscriptId)}/export`;
      link.download = "";
      document.body.appendChild(link);
      link.click();
      link.remove();
      toasts.info("Preparing portable export", "The ZIP includes the complete work, chapter files, HTML, metadata, and embedded Archive images.");
      return;
    }
    if (!encryptionKey.value) throw new Error("Unlock this work before exporting it.");
    if (!window.confirm("This export will be a normal, unencrypted ZIP. Anyone with the ZIP can read the body. Continue?")) return;
    const decryptedChapters: ManuscriptChapter[] = [];
    for (const summary of manuscript.value.chapters) {
      const encryptedChapter = await client.manuscriptChapter(manuscriptId.value, summary.chapterId);
      decryptedChapters.push(await decryptReaderChapterBody(encryptedChapter));
    }
    const result = await buildManuscriptExport({
      manuscript: manuscript.value,
      chapters: decryptedChapters,
      loadAsset: async (documentId) => {
        try {
          const [documentRecord, response] = await Promise.all([
            client.document(documentId),
            fetch(`/api/documents/${encodeURIComponent(documentId)}/preview`, { credentials: "include" })
          ]);
          if (!response.ok) return null;
          return { document: documentRecord, body: new Uint8Array(await response.arrayBuffer()) };
        } catch {
          return null;
        }
      }
    });
    const link = document.createElement("a");
    if (identityBlocked.value) throw new Error("Verify the original account before downloading this export.");
    link.href = URL.createObjectURL(new Blob([result.body], { type: "application/zip" }));
    link.download = result.fileName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
    toasts.success("Portable export ready", "The downloaded ZIP is unencrypted.");
  } catch (exportError) {
    toasts.error("Export failed", exportError instanceof Error ? exportError.message : "Please try again.");
  } finally {
    exportingManuscript.value = false;
  }
}

async function deleteManuscript() {
  if (!canManageWork.value || !manuscript.value || deletingManuscript.value) return;
  const title = manuscript.value.title;
  if (!window.confirm(`Delete “${title}” and remove all of its chapters from Long writing?`)) return;
  deletingManuscript.value = true;
  try {
    requireOriginalEditorAccount();
    await client.deleteManuscript(manuscript.value.manuscriptId);
    clearAutosaveTimers();
    if (localDraftTimer) clearTimeout(localDraftTimer);
    if (maxLocalDraftTimer) clearTimeout(maxLocalDraftTimer);
    localDraftTimer = null;
    maxLocalDraftTimer = null;
    saveState.value = "saved";
    metadataOpen.value = false;
    toasts.success("Work deleted", title);
    await router.replace("/manuscripts");
  } catch (deleteError) {
    deletingManuscript.value = false;
    toasts.error("Unable to delete work", deleteError instanceof Error ? deleteError.message : "Please try again.");
  }
}

function selectRelativeChapter(offset: -1 | 1) {
  const target = chapters.value[activeIndex.value + offset];
  if (target) void loadChapter(target.chapterId, true, 0);
}

function onKeydown(event: KeyboardEvent) {
  if (encryptionKey.value) lastEncryptionActivity = Date.now();
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void saveChapterNow();
  }
  if (event.key === "Escape" && metadataOpen.value) metadataOpen.value = false;
  else if (event.key === "Escape" && compactViewport.value && mobileContentsOpen.value) {
    void hideContents();
  }
}

function onEncryptionActivity() {
  if (encryptionKey.value) lastEncryptionActivity = Date.now();
}

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (saveState.value !== "saved" || pendingImages.value || pendingRecoveryDraft.value) {
    event.preventDefault();
    event.returnValue = "";
  }
}

function onVisibilityChange() {
  if (document.visibilityState === "hidden") void persistLocalDraft();
}

function onPageHide() {
  void persistLocalDraft();
}

function onDraftPreferenceChange(event: StorageEvent) {
  if (event.key === draftPreferenceKey || event.key === null) persistPlaintext.value = event.newValue === "true";
}

watch([chapterTitle, chapterBody, chapterFormat], () => {
  queueLocalDraft();
  queueAutosave();
});

watch([chapterBody, chapterFormat], scheduleBodyAnalysis);

watch(identityBlocked, (blocked) => {
  if (!blocked) return;
  clearAutosaveTimers();
  sessionExpired.value = true;
  readerOpen.value = false;
  metadataOpen.value = false;
  void persistLocalDraft();
});

watch(persistPlaintext, async (allowed) => {
  try { localStorage.setItem(draftPreferenceKey, String(allowed)); } catch { /* Choice still applies in this tab. */ }
  try {
    const drafts = await listManuscriptLocalDrafts(manuscriptId.value, draftScope);
    for (const draft of drafts) {
      if (!draft.encrypted) await runLocalDraftOperation(async () => { await writeManuscriptLocalDraft(draft, draftScope, allowed); });
    }
    await persistLocalDraft();
  } catch (draftError) {
    toasts.error("Device draft setting could not be fully applied", draftError instanceof Error ? draftError.message : "Keep this tab open and retry.");
  }
});

watch(markdownSpellcheckMode, (mode) => {
  try {
    window.localStorage.setItem(MARKDOWN_SPELLCHECK_STORAGE_KEY, mode);
  } catch {
    // The preference remains active for this tab when browser storage is unavailable.
  }
});

onMounted(() => {
  updateCompactViewport();
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("resize", updateCompactViewport, { passive: true });
  window.addEventListener("beforeunload", onBeforeUnload);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("storage", onDraftPreferenceChange);
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pointerdown", onEncryptionActivity, { passive: true });
  encryptionIdleTimer = setInterval(() => {
    if (encryptionKey.value && Date.now() - lastEncryptionActivity >= 30 * 60 * 1000) {
      void lockEncryptedWork("idle");
    }
  }, 60_000);
  void loadManuscript(typeof route.query.chapter === "string" ? route.query.chapter : undefined);
});

onBeforeUnmount(() => {
  clearAutosaveTimers();
  cancelBodyAnalysis();
  cancelLocalDraftIdle();
  if (localDraftTimer) clearTimeout(localDraftTimer);
  if (maxLocalDraftTimer) clearTimeout(maxLocalDraftTimer);
  void persistLocalDraft();
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("resize", updateCompactViewport);
  window.removeEventListener("beforeunload", onBeforeUnload);
  window.removeEventListener("pagehide", onPageHide);
  window.removeEventListener("storage", onDraftPreferenceChange);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("pointerdown", onEncryptionActivity);
  if (encryptionIdleTimer) clearInterval(encryptionIdleTimer);
  encryptionKey.value?.fill(0);
  encryptionKey.value = null;
});

onBeforeRouteLeave(async () => {
  if (deletingManuscript.value) return true;
  if (pendingImages.value) {
    toasts.error("Image is still uploading", "Wait for the upload to finish before leaving this chapter.");
    return false;
  }
  // A changed identity must not trap an already saved editor on logout.
  if (saveState.value === "saved" && !pendingRecoveryDraft.value
    && chapterTitle.value.trim() === lastSavedTitle
    && chapterBody.value.trim() === lastSavedBody
    && chapterFormat.value === lastSavedFormat) return true;
  return await saveChapterNow();
});
</script>

<template>
  <div class="manuscript-workspace" :style="workspaceStyle">
    <div v-if="identityBlocked" class="workspace-state" role="alert">
      <LockKeyhole /><p>Writing is paused because the signed-in account may have changed. Your draft remains in this tab.</p>
      <p>Sign in with the account that opened this editor. Do not refresh or close this tab.</p>
      <a class="btn-secondary" href="/login" target="_blank" rel="noopener">Sign in</a>
      <button class="btn-primary" type="button" @click="retrySaveAfterSignIn">Verify account and resume</button>
    </div>
    <div v-else-if="loading" class="workspace-state"><LoaderCircle class="animate-spin" /> Loading writing workspace…</div>
    <div v-else-if="!manuscript" class="workspace-state workspace-state--error">
      <FileText />
      <p>{{ error || "This long-form work could not be found." }}</p>
      <button class="btn-secondary" type="button" @click="router.push('/manuscripts')">Back to Long writing</button>
    </div>

    <template v-else>
      <header v-if="toolbarOpen" class="workspace-toolbar">
        <button class="workspace-icon-button" type="button" title="Back to Long writing" @click="router.push('/manuscripts')"><ArrowLeft /></button>
        <div class="workspace-title">
          <strong><LockKeyhole v-if="manuscript.encryptionEnabled" />{{ manuscript.title }}</strong>
          <span>{{ workspaceSubtitle }}</span>
          <span v-if="template.personalArchive">{{ managementLabel(manuscript.managementOwnerUserId) }}</span>
        </div>
        <span class="workspace-toolbar-break" aria-hidden="true" />
        <ArchiveManagementAccess v-if="template.personalArchive && auth.user?.role === 'Admin'" @change="setManagementExpiry" />
        <button
          v-if="manuscript.encryptionEnabled && !encryptionLocked"
          class="workspace-button"
          type="button"
          title="Lock and clear the decrypted key from this tab"
          aria-label="Lock encrypted work"
          @click="lockEncryptedWork('manual')"
        ><LockKeyhole /><span class="workspace-button-label">Lock</span></button>
        <button
          class="workspace-button workspace-button--save"
          type="button"
          title="Save current part now (Ctrl/Cmd+S)"
          aria-label="Save current part now"
          :disabled="manualSaveDisabled"
          @click="saveChapterNow('manual')"
        >
          <LoaderCircle v-if="saveState === 'saving' || saveState === 'uploading'" class="animate-spin" />
          <Save v-else />
          <span class="workspace-button-label">{{ saveState === "saving" ? "Saving…" : saveState === "uploading" ? "Uploading…" : saveState === "error" ? "Retry save" : "Save" }}</span>
        </button>
        <div class="save-indicator" :class="`save-indicator--${saveState}`">
          <LoaderCircle v-if="saveState === 'saving' || saveState === 'uploading'" class="animate-spin" />
          <Check v-else-if="saveState === 'saved'" />
          <Save v-else />
          <span>{{ saveState === "uploading" ? "Uploading image" : saveState === "saving" ? "Saving" : saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed" : "Unsaved" }}</span>
        </div>
        <button class="workspace-button" :class="{ 'workspace-button--active': appearanceOpen }" type="button" title="Adjust writing appearance" aria-label="Adjust writing appearance" @click="appearanceOpen = !appearanceOpen"><Palette /><span class="workspace-button-label">Appearance</span></button>
        <button class="workspace-button" type="button" title="Open reading mode" aria-label="Open reading mode" :disabled="!activeChapter" @click="openReader"><BookOpen /><span class="workspace-button-label">Read</span></button>
        <button
          class="workspace-button"
          type="button"
          title="Export the complete work as a portable ZIP"
          :disabled="exportingManuscript || chapterLoading || pendingImages > 0 || Boolean(pendingRecoveryDraft) || saveConflict"
          @click="exportManuscript"
        >
          <LoaderCircle v-if="exportingManuscript" class="animate-spin" />
          <Download v-else /><span class="workspace-button-label">Export</span>
        </button>
        <button class="workspace-button" type="button" title="Open work details" aria-label="Open work details" @click="openDetails"><Settings2 /><span class="workspace-button-label">Details</span></button>
        <button ref="toolbarHideButton" class="workspace-button workspace-toolbar-hide" type="button" title="Hide writing tools" aria-label="Hide writing tools" :aria-expanded="true" @click="hideToolbar"><PanelTopClose /><span class="workspace-button-label">Focus</span></button>
      </header>

      <button
        v-else
        ref="toolbarRestoreButton"
        class="workspace-toolbar-restore"
        type="button"
        title="Show writing tools"
        aria-label="Show writing tools"
        :aria-expanded="false"
        @click="showToolbar"
      ><PanelTopOpen /><span>Tools</span></button>

      <ReadingAppearanceControls v-if="toolbarOpen && appearanceOpen" compact wrap-presets class="workspace-appearance" />

      <section v-if="encryptionLocked" class="encryption-lock-screen">
        <div class="encryption-lock-mark"><LockKeyhole /></div>
        <div>
          <span>ENCRYPTED BODY</span>
          <h2>Unlock “{{ manuscript.title }}”</h2>
          <p>Titles, chapter names, and counts remain visible. The body and its saved versions are decrypted only inside this tab.</p>
        </div>
        <form @submit.prevent="unlockEncryptedWork">
          <label>
            <span>Encryption password</span>
            <input
              v-model="unlockSecret"
              class="input"
              type="password"
              autocomplete="current-password"
              autofocus
              placeholder="Enter encryption password"
            />
          </label>
          <p v-if="unlockError" class="version-error">{{ unlockError }}</p>
          <p v-if="!keyOwnerUserId">The existing password still unlocks this work. Password recovery is unavailable until key ownership has been reviewed.</p>
          <div class="encryption-lock-actions">
            <button v-if="canManageEncryption" class="text-button" type="button" @click="openEncryptionDialog('reset')">
              Forgot encryption password?
            </button>
            <button class="btn-primary" type="submit" :disabled="unlocking || !unlockSecret">
              <LoaderCircle v-if="unlocking" class="animate-spin" /><KeyRound v-else />
              {{ unlocking ? "Unlocking…" : "Unlock" }}
            </button>
          </div>
        </form>
      </section>

      <section v-if="!manuscript.encryptionEnabled" class="draft-protection-banner">
        <label><input v-model="persistPlaintext" type="checkbox" /> Save unencrypted drafts on this device</label>
        <span>{{ persistPlaintext ? "Device copies may be accessible to people using this browser. Turning this off removes device copies for this work, keeping them in this tab." : "Drafts stay in this tab until saved. Keep the tab open or download a copy before closing it." }}</span>
      </section>

      <section v-if="!encryptionLocked && pendingRecoveryDraft" class="draft-protection-banner draft-protection-banner--warning" role="alert">
        <AlertTriangle />
        <div>
          <strong>An unsaved local draft is available</strong>
          <span>The server copy changed after this draft was protected at {{ formatDraftTime(pendingRecoveryDraft.savedAt) }}. Choose which copy to keep before editing.</span>
        </div>
        <button class="workspace-button" type="button" @click="restorePendingLocalDraft">Restore local draft</button>
        <button class="workspace-button" type="button" @click="downloadDraft(pendingRecoveryDraft)"><Download /> Download</button>
        <button class="workspace-button" type="button" @click="discardPendingLocalDraft">Use server copy</button>
      </section>

      <section v-else-if="!encryptionLocked && sessionExpired" class="draft-protection-banner draft-protection-banner--error" role="alert">
        <AlertTriangle />
        <div>
          <strong>Saving is paused — keep this tab open</strong>
          <span>Sign in with the original account in a new tab, then retry. Unless device saving is enabled, unencrypted drafts remain only in this tab.</span>
        </div>
        <a class="workspace-button" href="/login" target="_blank" rel="noopener"><LogIn /> Sign in</a>
        <button class="workspace-button" type="button" @click="retrySaveAfterSignIn">Retry save</button>
        <button class="workspace-button" type="button" @click="downloadDraft()"><Download /> Download</button>
      </section>

      <section v-else-if="!encryptionLocked && saveConflict" class="draft-protection-banner draft-protection-banner--warning" role="alert">
        <AlertTriangle />
        <div>
          <strong>A newer server copy is available — your local draft was not overwritten</strong>
          <span>Review the server copy and the protected local draft before choosing which one to keep.</span>
        </div>
        <button class="workspace-button" type="button" @click="reviewSaveConflict">Review copies</button>
        <button class="workspace-button" type="button" @click="downloadDraft()"><Download /> Download local draft</button>
      </section>

      <section v-else-if="!encryptionLocked && saveState === 'error'" class="draft-protection-banner draft-protection-banner--error" role="alert">
        <AlertTriangle />
        <div>
          <strong>Server save failed — keep this tab open or download a copy</strong>
          <span>{{ error || "Check the connection and retry before leaving this page." }}</span>
        </div>
        <button class="workspace-button" type="button" @click="saveChapterNow('manual')">Retry save</button>
        <button class="workspace-button" type="button" @click="downloadDraft()"><Download /> Download</button>
      </section>

      <section v-else-if="!encryptionLocked && recoveredDraftAt" class="draft-protection-banner" role="status">
        <Check />
        <div>
          <strong>Recovered the locally protected draft</strong>
          <span>Draft from {{ formatDraftTime(recoveredDraftAt) }} restored; it will remain local until the server confirms a save.</span>
        </div>
        <button class="workspace-button" type="button" @click="downloadDraft()"><Download /> Download</button>
      </section>

      <div v-if="!encryptionLocked" class="workspace-grid" :class="{ 'workspace-grid--contents-hidden': !contentsPanelOpen, 'workspace-grid--focus': !toolbarOpen }">
        <button
          v-if="contentsPanelOpen"
          class="contents-mobile-backdrop"
          type="button"
          tabindex="-1"
          aria-label="Close contents"
          @click="hideContents"
        />
        <aside v-if="contentsPanelOpen" class="chapter-sidebar">
          <div class="chapter-sidebar-heading">
            <div class="chapter-sidebar-title">
              <span>Contents</span><strong>{{ contentsCount }}</strong>
              <button
                ref="contentsHideButton"
                class="contents-toggle"
                type="button"
                title="Hide contents"
                aria-label="Hide contents"
                :aria-expanded="true"
                @click="hideContents"
              ><PanelLeftClose /></button>
            </div>
            <button type="button" :title="singleMarkdownDocument ? 'Add document part' : 'Add chapter'" :disabled="!canCreateChapter" @click="createChapter"><Plus /></button>
          </div>
          <nav class="chapter-list" aria-label="Manuscript chapters and headings">
            <div v-if="singleMarkdownDocument" class="document-outline">
              <button
                v-for="entry in outlineEntries"
                :key="entry.key"
                type="button"
                :class="{ active: selectedOutlineKey === entry.key }"
                :style="{ paddingLeft: `${Math.min(Math.max(entry.level - 1, 0), 4) * 12 + 10}px` }"
                :title="entry.label"
                @click="jumpToOutline(entry)"
              ><small>H{{ entry.level }}</small><span>{{ entry.label }}</span></button>
              <p v-if="!outlineEntries.length">输入 <code>#标题</code> 或 <code># 标题</code> 即可生成目录。</p>
            </div>
            <template v-else v-for="(chapter, index) in chapters" :key="chapter.chapterId">
            <div class="chapter-group">
              <div
                class="chapter-item"
                :class="{ 'chapter-item--active': chapter.chapterId === activeChapterId }"
              >
                <button class="chapter-select" type="button" @click="selectChapterFromContents(chapter.chapterId)">
                  <small>{{ String(index + 1).padStart(2, "0") }}</small>
                  <span><strong>{{ chapter.title }}</strong><em>{{ formatCount(chapter.characterCount) }} characters · {{ chapter.contentFormat === "markdown" ? "Markdown" : "Rich text" }}</em></span>
                </button>
                <details data-dismissible-menu class="chapter-menu">
                  <summary title="Chapter options"><MoreHorizontal /></summary>
                  <div class="chapter-menu-popover">
                    <button type="button" :disabled="!canManageWork || index === 0" @click="moveChapter(chapter, -1)"><ArrowUp /> Move up</button>
                    <button type="button" :disabled="!canManageWork || index === chapters.length - 1" @click="moveChapter(chapter, 1)"><ArrowDown /> Move down</button>
                    <button class="danger" type="button" :disabled="!canManageWork || chapters.length <= 1" @click="deleteChapter(chapter)"><Trash2 /> Remove</button>
                  </div>
                </details>
              </div>
              <div v-if="chapter.chapterId === activeChapterId && outlineEntries.length" class="chapter-outline">
                <button
                  v-for="entry in outlineEntries"
                  :key="entry.key"
                  type="button"
                  :class="{ active: selectedOutlineKey === entry.key }"
                  :style="{ paddingLeft: `${Math.min(Math.max(entry.level - 1, 0), 4) * 11 + 11}px` }"
                  :title="entry.label"
                  @click="jumpToOutline(entry)"
                ><small>H{{ entry.level }}</small><span>{{ entry.label }}</span></button>
              </div>
            </div>
            </template>
          </nav>
          <button class="add-chapter-button" type="button" :disabled="!canCreateChapter" @click="createChapter"><Plus /> {{ singleMarkdownDocument ? "Add part" : "Add chapter" }}</button>
        </aside>

        <button
          v-else
          ref="contentsRestoreButton"
          class="contents-restore-tab"
          type="button"
          title="Show contents"
          aria-label="Show contents"
          :aria-expanded="false"
          @click="showContents"
        ><PanelLeftOpen /><span>Contents</span></button>

        <main class="writing-pane">
          <div v-if="chapterLoading" class="chapter-loading"><LoaderCircle class="animate-spin" /> Loading chapter…</div>
          <template v-else-if="activeChapter">
            <div v-if="!singleMarkdownDocument" class="chapter-heading">
              <input v-model="chapterTitle" maxlength="240" :disabled="!canEdit" aria-label="Chapter title" />
              <div class="chapter-heading-meta">
                <div>
                  <span>{{ formatCount(currentCharacterCount) }} characters</span>
                  <span>Chapter {{ activeIndex + 1 }} of {{ chapters.length }}</span>
                  <span>{{ outlineEntries.length }} headings</span>
                </div>
                <div class="format-switch" aria-label="Chapter editing format">
                  <button type="button" :class="{ active: chapterFormat === 'rich-text' }" :disabled="!canEdit" @click="setChapterFormat('rich-text')"><Pilcrow /> Rich text</button>
                  <button type="button" :class="{ active: chapterFormat === 'markdown' }" :disabled="!canEdit" @click="setChapterFormat('markdown')"><Code2 /> Markdown</button>
                </div>
              </div>
            </div>
            <RichTextEditor
              v-if="chapterFormat === 'rich-text'"
              ref="editor"
              v-model="chapterBody"
              class="chapter-editor"
              :disabled="!canEdit"
              :show-appearance="false"
              min-height="calc(100vh - 19rem)"
              placeholder="Begin this chapter…"
              @insert-image="insertImage"
            />
            <div v-else class="markdown-editor">
              <div class="markdown-editor-toolbar">
                <Code2 /><strong>Markdown</strong><span>#标题 and # 标题 both build the outline.</span>
                <label class="markdown-spellcheck" :title="markdownSpellcheckTitle">
                  <span>Spellcheck</span>
                  <select v-model="markdownSpellcheckMode" aria-label="Markdown spellcheck mode">
                    <option value="auto">Auto</option>
                    <option value="on">On</option>
                    <option value="off">Off</option>
                  </select>
                </label>
                <div v-if="singleMarkdownDocument" class="markdown-document-meta">
                  <span>{{ formatCount(currentCharacterCount) }} characters</span>
                  <span>{{ outlineEntries.length }} headings</span>
                </div>
                <div v-if="singleMarkdownDocument" class="format-switch" aria-label="Chapter editing format">
                  <button type="button" :disabled="!canEdit" @click="setChapterFormat('rich-text')"><Pilcrow /> Rich text</button>
                  <button type="button" class="active" :disabled="!canEdit" @click="setChapterFormat('markdown')"><Code2 /> Markdown</button>
                </div>
              </div>
              <textarea
                ref="markdownEditor"
                v-model="chapterBody"
                :disabled="!canEdit"
                wrap="soft"
                :spellcheck="markdownSpellcheckEnabled"
                :autocorrect="markdownSpellcheckEnabled ? 'on' : 'off'"
                aria-label="Markdown chapter source"
                placeholder="# Chapter heading&#10;&#10;Begin writing in Markdown…"
              />
            </div>
            <footer v-if="chapters.length > 1" class="chapter-footer">
              <button class="workspace-button" type="button" :disabled="activeIndex <= 0" @click="selectRelativeChapter(-1)"><ChevronLeft /> Previous</button>
              <span>Changes save automatically · ⌘S saves now</span>
              <button class="workspace-button" type="button" :disabled="activeIndex >= chapters.length - 1" @click="selectRelativeChapter(1)">Next <ChevronRight /></button>
            </footer>
          </template>
        </main>
      </div>

      <ManuscriptReaderDialog
        v-model="readerOpen"
        :manuscript="manuscript"
        :initial-chapter-id="activeChapterId"
        :initial-progress="readerInitialProgress"
        :editable="canEdit"
        :transform-chapter="decryptReaderChapterBody"
        @close="returnToEditor"
        @edit="returnToEditor"
      />

      <div v-if="metadataOpen" class="details-backdrop" @mousedown.self="metadataOpen = false">
        <form class="details-dialog" @submit.prevent="saveMetadata">
          <div class="details-heading">
            <div><span>Work details</span><h2>Organise this long-form work</h2></div>
            <button type="button" title="Close" @click="metadataOpen = false"><X /></button>
          </div>
          <label><span>Title</span><input v-model="metadata.title" class="input" required maxlength="240" /></label>
          <div class="grid gap-3 sm:grid-cols-2">
            <label><span>Type</span><select v-model="metadata.kind" class="input"><option v-for="kind in MANUSCRIPT_KINDS" :key="kind" :value="kind">{{ kind }}</option></select></label>
            <label><span>Status</span><select v-model="metadata.status" class="input"><option v-for="status in MANUSCRIPT_STATUSES" :key="status" :value="status">{{ status }}</option></select></label>
          </div>
          <label><span>Description</span><textarea v-model="metadata.description" class="input min-h-28" maxlength="5000" /></label>
          <section class="encryption-details">
            <div class="encryption-details-icon"><ShieldCheck v-if="manuscript.encryptionEnabled" /><LockKeyhole v-else /></div>
            <div>
              <strong>{{ manuscript.encryptionEnabled ? "Body encryption is on" : "Body encryption is off" }}</strong>
              <span v-if="manuscript.encryptionEnabled">Current bodies, local drafts, and previous-version bodies are encrypted. Titles, counts, and Archive images are not encrypted. Only the confirmed key owner can reset the encryption password using their account password.</span>
              <span v-else>Add a separate password for this work’s body and previous versions.</span>
              <span v-if="!keyOwnerUserId">Key ownership needs a maintenance review before encryption settings or password recovery are available.</span>
              <span v-else-if="!canManageEncryption">Encryption settings are available to the confirmed key owner with editing permission.</span>
            </div>
            <div class="encryption-details-actions">
              <button v-if="!manuscript.encryptionEnabled" type="button" :disabled="!canManageEncryption || Boolean(pendingRecoveryDraft || saveConflict)" @click="openEncryptionDialog('enable')"><KeyRound /> Enable</button>
              <template v-else>
                <button type="button" :disabled="encryptionLocked || !canManageEncryption || Boolean(pendingRecoveryDraft || saveConflict)" @click="openEncryptionDialog('password')"><KeyRound /> Change password</button>
                <button type="button" :disabled="encryptionLocked || !canManageEncryption || Boolean(pendingRecoveryDraft || saveConflict)" @click="openEncryptionDialog('disable')"><LockKeyhole /> Remove</button>
              </template>
            </div>
          </section>
          <section class="version-history">
            <div class="version-history-heading">
              <History />
              <div>
                <strong>Previous versions · current part</strong>
                <span>{{ activeChapter?.title ?? "No part selected" }} · up to {{ MANUSCRIPT_CHAPTER_VERSION_RETENTION }} protected versions are retained</span>
              </div>
              <button type="button" :disabled="versionsLoading || !activeChapter" @click="loadVersionHistory">
                <LoaderCircle v-if="versionsLoading" class="animate-spin" />
                <History v-else /> Refresh
              </button>
            </div>
            <p v-if="versionError" class="version-error">{{ versionError }}</p>
            <div v-if="versionsLoading && !chapterVersions.length" class="version-empty"><LoaderCircle class="animate-spin" /> Loading protected versions…</div>
            <p v-else-if="!chapterVersions.length" class="version-empty">No previous version yet. A snapshot is added before manual changes and periodically before auto-saved changes.</p>
            <div v-else class="version-list">
              <article v-for="version in chapterVersions" :key="version.versionId" :class="{ active: selectedVersion?.versionId === version.versionId }">
                <button class="version-summary" type="button" @click="previewVersion(version)">
                  <LoaderCircle v-if="versionLoadingId === version.versionId" class="animate-spin" />
                  <FileText v-else />
                  <span>
                    <strong>Revision {{ version.revision }} · {{ version.title }}</strong>
                    <small>{{ formatDraftTime(version.savedAt) }} · {{ saveSourceLabel(version.saveSource) }} · {{ formatCount(version.characterCount) }} characters<span v-if="version.savedByName"> · {{ version.savedByName }}</span></small>
                  </span>
                </button>
                <button class="version-restore" type="button" :disabled="restoringVersionId === version.versionId || !canEdit" @click="restoreVersion(version)">
                  <LoaderCircle v-if="restoringVersionId === version.versionId" class="animate-spin" />
                  <RotateCcw v-else /> Restore
                </button>
              </article>
            </div>
            <div v-if="selectedVersion" class="version-preview">
              <div><strong>Revision {{ selectedVersion.revision }} preview</strong><button type="button" @click="selectedVersion = null"><X /> Close preview</button></div>
              <pre>{{ versionPreviewText }}</pre>
            </div>
          </section>
          <div class="details-danger-zone">
            <div><strong>Delete this work</strong><span>Remove it and all of its chapters from Long writing.</span></div>
            <button class="delete-work-button" type="button" :disabled="!canManageWork || deletingManuscript" @click="deleteManuscript"><Trash2 /> {{ deletingManuscript ? "Deleting…" : "Delete work" }}</button>
          </div>
          <div class="details-actions">
            <span class="flex-1" />
            <button class="btn-secondary" type="button" @click="metadataOpen = false">Cancel</button>
            <button class="btn-primary" type="submit" :disabled="!canManageWork || savingMetadata || !metadata.title.trim()">{{ savingMetadata ? "Saving…" : "Save details" }}</button>
          </div>
        </form>
      </div>

      <div v-if="encryptionDialog" class="details-backdrop" @mousedown.self="encryptionDialog = null">
        <form class="encryption-dialog" @submit.prevent="applyEncryptionChange">
          <div class="details-heading">
            <div>
              <span>Body encryption</span>
              <h2>{{ encryptionDialog === "enable" ? "Protect this work" : encryptionDialog === "password" ? "Change encryption password" : encryptionDialog === "reset" ? "Reset a forgotten password" : "Remove body encryption" }}</h2>
            </div>
            <button type="button" title="Close" :disabled="encryptionBusy" @click="encryptionDialog = null"><X /></button>
          </div>
          <p v-if="encryptionDialog === 'enable'">This browser will encrypt every current body and saved-version body before the database is updated. Titles, counts, and images stay searchable and are not encrypted.</p>
          <p v-else-if="encryptionDialog === 'password'">This changes only the password that unlocks the work key. The body and its history are not re-encrypted.</p>
          <p v-else-if="encryptionDialog === 'reset'">Verify the password for your signed-in account, then choose a new encryption password. The protected body and its history stay unchanged.</p>
          <p v-else>Every body and saved-version body will be stored normally again. Enter the current encryption password to confirm.</p>
          <label v-if="encryptionDialog === 'reset'">
            <span>Current account password</span>
            <input v-model="accountPassword" class="input" type="password" autocomplete="current-password" required autofocus />
          </label>
          <label>
            <span>{{ encryptionDialog === "disable" ? "Current encryption password" : "New encryption password" }}</span>
            <input v-model="encryptionPassword" class="input" type="password" :autocomplete="encryptionDialog === 'disable' ? 'current-password' : 'new-password'" required :autofocus="encryptionDialog !== 'reset'" />
          </label>
          <label v-if="encryptionDialog !== 'disable'">
            <span>Confirm password</span>
            <input v-model="encryptionPasswordConfirm" class="input" type="password" autocomplete="new-password" required />
          </label>
          <p v-if="encryptionProgress" class="encryption-progress"><LoaderCircle class="animate-spin" />{{ encryptionProgress }}</p>
          <p v-if="encryptionError" class="version-error">{{ encryptionError }}</p>
          <div class="details-actions">
            <span class="flex-1" />
            <button class="btn-secondary" type="button" :disabled="encryptionBusy" @click="encryptionDialog = null">Cancel</button>
            <button class="btn-primary" type="submit" :disabled="encryptionBusy">
              <LoaderCircle v-if="encryptionBusy" class="animate-spin" />
              {{ encryptionBusy ? "Working…" : encryptionDialog === "disable" ? "Remove encryption" : encryptionDialog === "password" ? "Change password" : encryptionDialog === "reset" ? "Reset password" : "Encrypt body" }}
            </button>
          </div>
        </form>
      </div>
    </template>
  </div>
</template>

<style scoped>
.manuscript-workspace { position: relative; min-height: calc(100vh - .9rem); overflow: hidden; border: 1px solid var(--workspace-border); border-radius: .55rem; background: var(--workspace-surface); color: var(--workspace-ink); font-family: var(--workspace-font); box-shadow: 0 5px 18px color-mix(in srgb, var(--workspace-ink) 5%, transparent); transition: background-color 160ms ease, border-color 160ms ease, color 160ms ease, box-shadow 160ms ease; }
.workspace-toolbar { display: flex; min-height: 3rem; align-items: center; gap: .3rem; border-bottom: 1px solid var(--workspace-border); padding: .3rem .4rem; background: color-mix(in srgb, var(--workspace-surface) 96%, var(--workspace-ink)); }
.workspace-toolbar-break { display: none; }
.workspace-icon-button, .workspace-button { display: inline-flex; height: 2rem; align-items: center; justify-content: center; gap: .34rem; border: 1px solid var(--workspace-border); border-radius: .4rem; background: transparent; padding: 0 .55rem; color: inherit; font-size: .68rem; font-weight: 750; }
.workspace-icon-button { width: 2rem; padding: 0; }
.workspace-icon-button svg, .workspace-button svg { display: block; width: .85rem; height: .85rem; flex: 0 0 auto; }
.workspace-icon-button:hover, .workspace-button:hover, .workspace-button--active { background: color-mix(in srgb, var(--workspace-ink) 7%, var(--workspace-surface)); }
.workspace-button:disabled { opacity: .38; }
.workspace-button--save { border-color: color-mix(in srgb, var(--personal-accent, #4fa69e) 55%, var(--workspace-border)); background: var(--workspace-active); }
.workspace-button--save:hover:not(:disabled) { background: color-mix(in srgb, var(--personal-accent, #4fa69e) 26%, var(--workspace-surface)); }
.workspace-title { min-width: 0; flex: 1; }
.workspace-title strong, .workspace-title span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.workspace-title strong { font-size: .82rem; }
.workspace-title strong { display: flex; align-items: center; gap: .3rem; }
.workspace-title strong svg { width: .72rem; height: .72rem; flex: 0 0 auto; color: var(--personal-accent, #4fa69e); }
.workspace-title span { margin-top: .04rem; color: var(--workspace-muted); font-size: .6rem; }
.save-indicator { display: inline-flex; min-width: 4.7rem; align-items: center; justify-content: center; gap: .3rem; color: var(--workspace-muted); font-size: .62rem; font-weight: 750; }
.save-indicator svg { width: .85rem; height: .85rem; }
.save-indicator--error { color: #b5322c; }
.workspace-toolbar-restore { position: fixed; z-index: 52; top: .75rem; right: .75rem; display: inline-flex; height: 2.5rem; align-items: center; justify-content: center; gap: .4rem; border: 1px solid var(--workspace-border); border-radius: 999px; background: color-mix(in srgb, var(--workspace-surface) 92%, transparent); padding: 0 .85rem; color: var(--workspace-ink); box-shadow: 0 7px 22px color-mix(in srgb, var(--workspace-ink) 16%, transparent); font-size: .64rem; font-weight: 800; backdrop-filter: blur(9px); transition: background-color 130ms ease, box-shadow 130ms ease, transform 130ms ease; }
.workspace-toolbar-restore:hover, .workspace-toolbar-restore:focus-visible { background: var(--workspace-active); box-shadow: 0 9px 26px color-mix(in srgb, var(--workspace-ink) 20%, transparent); outline: none; transform: translateY(-1px); }
.workspace-toolbar-restore svg { display: block; width: .86rem; height: .86rem; flex: 0 0 auto; }
.workspace-appearance { border-bottom-color: var(--workspace-border); background: var(--workspace-surface); }
.draft-protection-banner { display: grid; grid-template-columns: auto minmax(14rem, 1fr) repeat(3, auto); align-items: center; gap: .55rem; border-bottom: 1px solid color-mix(in srgb, #2f7d68 40%, var(--workspace-border)); padding: .55rem .7rem; background: color-mix(in srgb, #dff5e9 62%, var(--workspace-surface)); color: color-mix(in srgb, #174c3f 74%, var(--workspace-ink)); }
.draft-protection-banner > svg { width: 1rem; height: 1rem; }
.draft-protection-banner > div { min-width: 0; }
.draft-protection-banner strong, .draft-protection-banner span { display: block; }
.draft-protection-banner strong { font-size: .72rem; }
.draft-protection-banner span { margin-top: .08rem; font-size: .63rem; line-height: 1.35; }
.draft-protection-banner .workspace-button { white-space: nowrap; text-decoration: none; }
.draft-protection-banner--warning { border-bottom-color: color-mix(in srgb, #b47b19 45%, var(--workspace-border)); background: color-mix(in srgb, #fff0c7 70%, var(--workspace-surface)); color: color-mix(in srgb, #6f4408 80%, var(--workspace-ink)); }
.draft-protection-banner--error { border-bottom-color: color-mix(in srgb, #b5322c 45%, var(--workspace-border)); background: color-mix(in srgb, #ffe1dd 72%, var(--workspace-surface)); color: color-mix(in srgb, #82251f 82%, var(--workspace-ink)); }
.workspace-grid { position: relative; display: grid; min-height: calc(100vh - 4rem); grid-template-columns: 215px minmax(0, 1fr); transition: grid-template-columns 180ms ease; }
.workspace-grid--contents-hidden { grid-template-columns: minmax(0, 1fr); }
.workspace-grid--focus { min-height: calc(100vh - .9rem); }
.contents-mobile-backdrop { display: none; }
.chapter-sidebar { display: flex; min-height: 0; flex-direction: column; border-right: 1px solid var(--workspace-border); background: var(--workspace-soft); }
.chapter-sidebar-heading { display: flex; align-items: center; justify-content: space-between; padding: .45rem .45rem .3rem; }
.chapter-sidebar-heading div { display: flex; align-items: center; gap: .45rem; color: var(--workspace-muted); font-size: .68rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.chapter-sidebar-heading strong { display: grid; min-width: 1.2rem; height: 1.2rem; place-items: center; border-radius: 999px; background: color-mix(in srgb, var(--workspace-ink) 8%, transparent); font-size: .56rem; }
.chapter-sidebar-heading button { display: grid; width: 1.65rem; height: 1.65rem; place-items: center; border-radius: .35rem; }
.chapter-sidebar-heading button:hover { background: color-mix(in srgb, var(--workspace-ink) 8%, transparent); }
.chapter-sidebar-heading svg { width: .9rem; height: .9rem; }
.chapter-sidebar-heading .contents-toggle { width: 1.45rem; height: 1.45rem; margin-left: -.12rem; color: var(--workspace-muted); }
.chapter-sidebar-heading .contents-toggle:hover { color: var(--workspace-ink); }
.contents-restore-tab { position: absolute; z-index: 8; top: .55rem; left: 0; display: flex; width: 1.9rem; height: 6.1rem; flex-direction: column; align-items: center; justify-content: center; gap: .4rem; border: 1px solid var(--workspace-border); border-left: 0; border-radius: 0 .4rem .4rem 0; background: color-mix(in srgb, var(--workspace-surface) 92%, var(--workspace-ink)); color: var(--workspace-muted); box-shadow: 2px 4px 12px color-mix(in srgb, var(--workspace-ink) 8%, transparent); transition: width 130ms ease, color 130ms ease, background-color 130ms ease; }
.contents-restore-tab:hover, .contents-restore-tab:focus-visible { width: 2.15rem; background: var(--workspace-active); color: var(--workspace-ink); outline: none; }
.contents-restore-tab svg { width: .82rem; height: .82rem; flex: 0 0 auto; }
.contents-restore-tab span { writing-mode: vertical-rl; font-size: .57rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
.chapter-list { min-height: 0; flex: 1; overflow-y: auto; padding: 0 .25rem .3rem; }
.chapter-group + .chapter-group { margin-top: .12rem; }
.chapter-item { position: relative; display: flex; align-items: center; border-radius: .4rem; }
.chapter-item:hover { background: color-mix(in srgb, var(--workspace-ink) 5%, transparent); }
.chapter-item--active { background: var(--workspace-active); }
.chapter-select { display: flex; min-width: 0; flex: 1; align-items: flex-start; gap: .4rem; padding: .42rem .25rem .42rem .4rem; text-align: left; }
.chapter-select > small { width: 1.2rem; flex: 0 0 auto; padding-top: .08rem; color: var(--workspace-muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .58rem; }
.chapter-select > span { min-width: 0; }
.chapter-select strong, .chapter-select em { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chapter-select strong { font-size: .75rem; font-weight: 750; }
.chapter-select em { margin-top: .16rem; color: var(--workspace-muted); font-size: .6rem; font-style: normal; }
.chapter-outline { margin: .06rem .15rem .2rem 1.25rem; border-left: 1px solid var(--workspace-border); }
.chapter-outline button { display: flex; width: 100%; min-width: 0; align-items: center; gap: .3rem; border-radius: .3rem; padding-top: .25rem; padding-right: .2rem; padding-bottom: .25rem; color: var(--workspace-muted); text-align: left; }
.chapter-outline button:hover, .chapter-outline button.active { background: color-mix(in srgb, var(--workspace-ink) 6%, transparent); color: var(--workspace-ink); }
.chapter-outline small { flex: 0 0 auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .5rem; opacity: .62; }
.chapter-outline span { overflow: hidden; min-width: 0; text-overflow: ellipsis; white-space: nowrap; font-size: .64rem; font-weight: 650; }
.document-outline { padding: .05rem 0; }
.document-outline button { display: flex; width: 100%; min-width: 0; align-items: center; gap: .35rem; border-radius: .3rem; padding-top: .32rem; padding-right: .3rem; padding-bottom: .32rem; color: var(--workspace-muted); text-align: left; }
.document-outline button:hover, .document-outline button.active { background: color-mix(in srgb, var(--workspace-ink) 6%, transparent); color: var(--workspace-ink); }
.document-outline small { flex: 0 0 auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .5rem; opacity: .62; }
.document-outline span { overflow: hidden; min-width: 0; text-overflow: ellipsis; white-space: nowrap; font-size: .67rem; font-weight: 680; }
.document-outline p { margin: .35rem .45rem; color: var(--workspace-muted); font-size: .62rem; line-height: 1.5; }
.document-outline code { border-radius: .2rem; background: color-mix(in srgb, var(--workspace-ink) 7%, transparent); padding: .04rem .18rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.chapter-menu { position: relative; flex: 0 0 auto; }
.chapter-menu > summary { display: grid; width: 1.8rem; height: 1.8rem; cursor: pointer; list-style: none; place-items: center; border-radius: .45rem; opacity: 0; }
.chapter-menu > summary::-webkit-details-marker { display: none; }
.chapter-item:hover .chapter-menu > summary, .chapter-item--active .chapter-menu > summary, .chapter-menu[open] > summary, .chapter-menu > summary:focus { opacity: 1; }
.chapter-menu svg { width: .85rem; height: .85rem; }
.chapter-menu-popover { position: absolute; z-index: 12; top: 2rem; right: 0; width: 9.2rem; border: 1px solid var(--workspace-border); border-radius: .65rem; background: var(--workspace-surface); padding: .3rem; box-shadow: 0 14px 34px color-mix(in srgb, var(--workspace-ink) 18%, transparent); }
.chapter-menu-popover button { display: flex; width: 100%; align-items: center; gap: .48rem; border-radius: .42rem; padding: .45rem .5rem; font-size: .7rem; font-weight: 700; }
.chapter-menu-popover button:hover { background: color-mix(in srgb, var(--workspace-ink) 7%, transparent); }
.chapter-menu-popover button:disabled { opacity: .35; }
.chapter-menu-popover .danger { color: #bd302b; }
.add-chapter-button { display: flex; align-items: center; justify-content: center; gap: .35rem; border-top: 1px solid var(--workspace-border); padding: .5rem; color: var(--workspace-muted); font-size: .64rem; font-weight: 750; }
.add-chapter-button svg { width: .85rem; height: .85rem; }
.writing-pane { min-width: 0; padding: .45rem .55rem; background: var(--workspace-surface); }
.chapter-heading { max-width: var(--workspace-width); margin: 0 auto .35rem; }
.chapter-heading input { width: 100%; border: 0; background: transparent; color: inherit; font-size: clamp(1.15rem, 1.8vw, 1.5rem); font-weight: 800; letter-spacing: -.025em; outline: none; }
.chapter-heading input:focus { text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--personal-accent, #4fa69e) 55%, transparent); text-underline-offset: .22rem; }
.chapter-heading-meta { display: flex; align-items: center; justify-content: space-between; gap: .55rem; margin-top: .12rem; color: var(--workspace-muted); font-size: .6rem; }
.chapter-heading-meta > div:first-child { display: flex; flex-wrap: wrap; gap: .7rem; }
.format-switch { display: inline-flex; flex: 0 0 auto; gap: .08rem; border: 1px solid var(--workspace-border); border-radius: .35rem; background: var(--workspace-soft); padding: .08rem; }
.format-switch button { display: inline-flex; height: 1.5rem; align-items: center; gap: .25rem; border-radius: .25rem; padding: 0 .4rem; color: var(--workspace-muted); font-size: .58rem; font-weight: 750; }
.format-switch button:hover, .format-switch button.active { background: var(--workspace-surface); color: var(--workspace-ink); box-shadow: 0 1px 4px color-mix(in srgb, var(--workspace-ink) 10%, transparent); }
.format-switch button:disabled { opacity: .45; }
.format-switch svg { width: .72rem; height: .72rem; }
.chapter-editor, .markdown-editor { max-width: var(--workspace-width); margin: 0 auto; }
.manuscript-workspace :deep(.chapter-editor) { border-color: var(--workspace-border); border-radius: .55rem; background: var(--workspace-surface); box-shadow: none; }
.manuscript-workspace :deep(.chapter-editor .rich-editor-toolbar) { border-color: var(--workspace-border); background: var(--workspace-soft); }
.manuscript-workspace :deep(.chapter-editor .rich-editor-style), .manuscript-workspace :deep(.chapter-editor .rich-editor-tool), .manuscript-workspace :deep(.chapter-editor .rich-editor-colour) { color: var(--workspace-ink); }
.manuscript-workspace :deep(.chapter-editor .rich-editor-divider) { background: var(--workspace-border); }
.markdown-editor { overflow: hidden; border: 1px solid var(--workspace-border); border-radius: .5rem; background: var(--workspace-surface); box-shadow: none; }
.markdown-editor:focus-within { border-color: color-mix(in srgb, var(--personal-accent, #4fa69e) 72%, var(--workspace-border)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--personal-accent, #4fa69e) 15%, transparent); }
.markdown-editor-toolbar { display: flex; min-height: 2.15rem; align-items: center; gap: .35rem; border-bottom: 1px solid var(--workspace-border); background: var(--workspace-soft); padding: .22rem .45rem; }
.markdown-editor-toolbar svg { width: .85rem; height: .85rem; }
.markdown-editor-toolbar strong { font-size: .68rem; }
.markdown-editor-toolbar > span { color: var(--workspace-muted); font-size: .57rem; }
.markdown-spellcheck { display: inline-flex; height: 1.5rem; margin-left: auto; align-items: center; gap: .28rem; border: 1px solid var(--workspace-border); border-radius: .3rem; background: var(--workspace-surface); padding: 0 .18rem 0 .38rem; color: var(--workspace-muted); white-space: nowrap; }
.markdown-spellcheck span { font-size: .54rem; font-weight: 750; }
.markdown-spellcheck select { border: 0; background: transparent; color: var(--workspace-ink); font-size: .56rem; font-weight: 750; outline: none; }
.markdown-document-meta { display: flex; gap: .55rem; white-space: nowrap; }
.markdown-document-meta span { color: var(--workspace-muted); font-size: .56rem; }
.markdown-editor textarea { display: block; width: 100%; min-width: 0; max-width: 100%; min-height: calc(100vh - 7rem); resize: vertical; overflow-wrap: anywhere; border: 0; background: var(--workspace-surface); padding: .72rem .85rem; color: var(--workspace-ink); font-family: var(--workspace-font); font-size: var(--workspace-font-size); line-height: var(--workspace-line-height); outline: none; tab-size: 2; white-space: pre-wrap; word-break: break-word; }
.markdown-editor textarea::placeholder { color: var(--workspace-muted); }
.chapter-footer { display: flex; max-width: var(--workspace-width); align-items: center; justify-content: space-between; gap: .55rem; margin: .35rem auto 0; color: var(--workspace-muted); font-size: .6rem; }
.chapter-loading, .workspace-state { display: flex; min-height: 20rem; align-items: center; justify-content: center; gap: .55rem; color: var(--workspace-muted); font-size: .78rem; }
.chapter-loading svg, .workspace-state svg { width: 1rem; height: 1rem; }
.workspace-state { min-height: calc(100vh - 5rem); flex-direction: column; }
.workspace-state--error svg { width: 2rem; height: 2rem; }
.details-backdrop { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; background: rgba(18, 27, 24, .46); padding: 1rem; backdrop-filter: blur(5px); }
.details-dialog { width: min(100%, 44rem); max-height: calc(100vh - 2rem); overflow-y: auto; border: 1px solid var(--workspace-border); border-radius: 1rem; background: var(--workspace-surface); color: var(--workspace-ink); padding: 1.2rem; box-shadow: 0 28px 80px rgba(24, 35, 31, .22); }
.details-heading { display: flex; align-items: start; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
.details-heading span { color: var(--workspace-muted); font-size: .67rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
.details-heading h2 { margin-top: .15rem; font-size: 1.18rem; font-weight: 800; }
.details-heading button { display: grid; width: 2.2rem; height: 2.2rem; place-items: center; border: 1px solid var(--workspace-border); border-radius: .6rem; }
.details-heading svg { width: 1rem; height: 1rem; }
.details-dialog label { display: block; margin-bottom: .8rem; }
.details-dialog label > span { display: block; margin-bottom: .32rem; color: var(--workspace-muted); font-size: .67rem; font-weight: 800; text-transform: uppercase; }
.version-history { margin: .25rem 0 .85rem; border-top: 1px solid var(--workspace-border); padding-top: .8rem; }
.version-history-heading { display: flex; align-items: center; gap: .55rem; }
.version-history-heading > svg { width: 1rem; height: 1rem; flex: 0 0 auto; color: var(--workspace-muted); }
.version-history-heading > div { min-width: 0; flex: 1; }
.version-history-heading strong, .version-history-heading span { display: block; }
.version-history-heading strong { font-size: .75rem; }
.version-history-heading span { margin-top: .08rem; color: var(--workspace-muted); font-size: .62rem; }
.version-history-heading button, .version-preview button { display: inline-flex; height: 1.9rem; flex: 0 0 auto; align-items: center; gap: .3rem; border: 1px solid var(--workspace-border); border-radius: .42rem; padding: 0 .5rem; color: var(--workspace-muted); font-size: .62rem; font-weight: 750; }
.version-history-heading button:hover, .version-preview button:hover { background: var(--workspace-soft); color: var(--workspace-ink); }
.version-history-heading button:disabled { opacity: .45; }
.version-history-heading button svg, .version-preview button svg { width: .75rem; height: .75rem; }
.version-error { margin-top: .55rem; border-radius: .45rem; background: color-mix(in srgb, #b5322c 9%, var(--workspace-surface)); padding: .45rem .55rem; color: #a92d29; font-size: .65rem; }
.version-empty { display: flex; min-height: 3.5rem; align-items: center; justify-content: center; gap: .4rem; margin-top: .55rem; border: 1px dashed var(--workspace-border); border-radius: .55rem; padding: .8rem; color: var(--workspace-muted); font-size: .65rem; text-align: center; }
.version-empty svg { width: .85rem; height: .85rem; }
.version-list { max-height: 14rem; overflow-y: auto; margin-top: .55rem; border: 1px solid var(--workspace-border); border-radius: .55rem; }
.version-list article { display: flex; align-items: center; gap: .4rem; padding: .28rem; }
.version-list article + article { border-top: 1px solid var(--workspace-border); }
.version-list article.active { background: var(--workspace-active); }
.version-summary { display: flex; min-width: 0; flex: 1; align-items: center; gap: .45rem; border-radius: .4rem; padding: .35rem .4rem; text-align: left; }
.version-summary:hover { background: var(--workspace-soft); }
.version-summary > svg { width: .85rem; height: .85rem; flex: 0 0 auto; color: var(--workspace-muted); }
.version-summary > span { min-width: 0; }
.version-summary strong, .version-summary small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.version-summary strong { font-size: .68rem; }
.version-summary small { margin-top: .12rem; color: var(--workspace-muted); font-size: .57rem; }
.version-restore { display: inline-flex; height: 1.8rem; flex: 0 0 auto; align-items: center; gap: .28rem; border: 1px solid var(--workspace-border); border-radius: .38rem; padding: 0 .42rem; color: var(--workspace-muted); font-size: .6rem; font-weight: 750; }
.version-restore:hover:not(:disabled) { background: var(--workspace-surface); color: var(--workspace-ink); }
.version-restore:disabled { opacity: .4; }
.version-restore svg { width: .72rem; height: .72rem; }
.version-preview { margin-top: .55rem; border: 1px solid var(--workspace-border); border-radius: .55rem; background: var(--workspace-soft); padding: .55rem; }
.version-preview > div { display: flex; align-items: center; justify-content: space-between; gap: .5rem; margin-bottom: .45rem; }
.version-preview > div > strong { font-size: .68rem; }
.version-preview pre { max-height: 16rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; border-radius: .42rem; background: var(--workspace-surface); padding: .65rem; color: var(--workspace-ink); font-family: var(--workspace-font); font-size: .68rem; line-height: 1.55; }
.details-actions { display: flex; align-items: center; gap: .5rem; margin-top: .3rem; }
.details-danger-zone { display: flex; align-items: center; gap: 1rem; margin: .2rem 0 .85rem; border-top: 1px solid var(--workspace-border); border-bottom: 1px solid var(--workspace-border); padding: .72rem 0; }
.details-danger-zone > div { min-width: 0; flex: 1; }
.details-danger-zone strong, .details-danger-zone span { display: block; }
.details-danger-zone strong { color: #a92d29; font-size: .74rem; }
.details-danger-zone span { margin-top: .12rem; color: var(--workspace-muted); font-size: .64rem; }
.delete-work-button { display: inline-flex; height: 2rem; flex: 0 0 auto; align-items: center; gap: .4rem; border: 1px solid color-mix(in srgb, #b72f2a 35%, var(--workspace-border)); border-radius: .42rem; padding: 0 .65rem; color: #b72f2a; font-size: .68rem; font-weight: 780; }
.delete-work-button:hover { background: color-mix(in srgb, #b72f2a 8%, var(--workspace-surface)); }
.delete-work-button:disabled { cursor: wait; opacity: .55; }
.delete-work-button svg { width: .85rem; height: .85rem; }
.encryption-lock-screen { display: grid; width: min(44rem, calc(100% - 2rem)); grid-template-columns: auto 1fr; gap: 1rem 1.2rem; margin: clamp(2.5rem, 9vh, 7rem) auto; border: 1px solid var(--workspace-border); border-radius: .85rem; background: var(--workspace-soft); padding: clamp(1.25rem, 3vw, 2.2rem); box-shadow: 0 16px 50px color-mix(in srgb, var(--workspace-ink) 10%, transparent); }
.encryption-lock-mark { display: grid; width: 3rem; height: 3rem; place-items: center; border-radius: .75rem; background: var(--workspace-active); color: color-mix(in srgb, var(--personal-accent, #4fa69e) 78%, var(--workspace-ink)); }
.encryption-lock-mark svg { width: 1.4rem; height: 1.4rem; }
.encryption-lock-screen > div:nth-child(2) > span { color: var(--workspace-muted); font-size: .58rem; font-weight: 850; letter-spacing: .16em; }
.encryption-lock-screen h2 { margin: .18rem 0 .35rem; font-size: 1.25rem; }
.encryption-lock-screen p, .encryption-dialog > p { color: var(--workspace-muted); font-size: .7rem; line-height: 1.55; }
.encryption-lock-screen form { grid-column: 2; }
.encryption-lock-screen label > span, .encryption-dialog label > span { display: block; margin-bottom: .28rem; color: var(--workspace-muted); font-size: .62rem; font-weight: 760; }
.encryption-lock-actions { display: flex; align-items: center; justify-content: space-between; gap: .7rem; margin-top: .65rem; }
.encryption-lock-actions .btn-primary, .encryption-dialog .btn-primary { display: inline-flex; align-items: center; gap: .35rem; }
.encryption-lock-actions svg, .encryption-dialog button svg { width: .85rem; height: .85rem; }
.text-button { color: var(--workspace-muted); font-size: .66rem; text-decoration: underline; text-underline-offset: 2px; }
.encryption-details { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: .65rem; border: 1px solid var(--workspace-border); border-radius: .6rem; background: var(--workspace-soft); padding: .65rem; }
.encryption-details-icon { display: grid; width: 2.1rem; height: 2.1rem; place-items: center; border-radius: .5rem; background: var(--workspace-active); color: var(--personal-accent, #4fa69e); }
.encryption-details-icon svg { width: 1rem; height: 1rem; }
.encryption-details strong, .encryption-details span { display: block; }
.encryption-details strong { font-size: .7rem; }
.encryption-details span { margin-top: .12rem; color: var(--workspace-muted); font-size: .59rem; line-height: 1.45; }
.encryption-details-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .35rem; }
.encryption-details-actions button { display: inline-flex; height: 1.8rem; align-items: center; gap: .3rem; border: 1px solid var(--workspace-border); border-radius: .4rem; padding: 0 .48rem; font-size: .6rem; font-weight: 760; }
.encryption-details-actions button:hover:not(:disabled) { background: var(--workspace-surface); }
.encryption-details-actions button:disabled { opacity: .4; }
.encryption-details-actions svg { width: .7rem; height: .7rem; }
.encryption-dialog { width: min(34rem, calc(100vw - 2rem)); max-height: calc(100vh - 2rem); overflow-y: auto; border: 1px solid var(--workspace-border); border-radius: .8rem; background: var(--workspace-surface); padding: 1rem; color: var(--workspace-ink); box-shadow: 0 22px 70px rgba(18, 23, 30, .3); }
.encryption-dialog > label { display: block; margin-top: .75rem; }
.encryption-progress { display: flex; align-items: center; gap: .4rem; margin-top: .7rem; color: var(--workspace-muted); font-size: .66rem; }
.encryption-progress svg { width: .8rem; height: .8rem; }
@media (max-width: 780px) {
  .manuscript-workspace { width: 100%; max-width: 100%; min-height: calc(100dvh - .9rem); overflow-x: clip; }
  .workspace-toolbar { flex-wrap: wrap; align-content: center; gap: .3rem; padding: max(.38rem, env(safe-area-inset-top)) max(.38rem, env(safe-area-inset-right)) .38rem max(.38rem, env(safe-area-inset-left)); }
  .workspace-title { min-width: 0; flex: 1 1 0; }
  .workspace-toolbar-break { display: block; height: 0; flex: 0 0 100%; }
  .workspace-toolbar :is(.workspace-icon-button, .workspace-button) { width: 2.15rem; min-width: 2.15rem; height: 2.15rem; gap: 0; padding: 0; line-height: 0; }
  .workspace-toolbar :is(.workspace-icon-button, .workspace-button) > svg { width: 1rem; height: 1rem; }
  .workspace-button-label { display: none; }
  .save-indicator { min-width: 2.15rem; height: 2.15rem; line-height: 0; }
  .save-indicator span { display: none; }
  .workspace-toolbar-restore { top: auto; right: auto; bottom: max(.75rem, env(safe-area-inset-bottom)); left: max(.75rem, env(safe-area-inset-left)); }
  .draft-protection-banner { grid-template-columns: auto minmax(0, 1fr); }
  .draft-protection-banner .workspace-button { grid-column: 2; justify-self: start; }
  .workspace-grid, .workspace-grid--contents-hidden { width: 100%; min-width: 0; grid-template-columns: minmax(0, 1fr); }
  .workspace-grid--focus { min-height: calc(100dvh - .9rem); }
  .contents-restore-tab { position: fixed; z-index: 52; top: auto; right: max(.75rem, env(safe-area-inset-right)); bottom: max(.75rem, env(safe-area-inset-bottom)); left: auto; width: auto; height: 2.5rem; flex-direction: row; gap: .4rem; border: 1px solid var(--workspace-border); border-radius: 999px; background: color-mix(in srgb, var(--workspace-surface) 92%, transparent); padding: 0 .85rem; color: var(--workspace-ink); box-shadow: 0 7px 22px color-mix(in srgb, var(--workspace-ink) 16%, transparent); backdrop-filter: blur(9px); }
  .contents-restore-tab:hover, .contents-restore-tab:focus-visible { width: auto; }
  .contents-restore-tab span { writing-mode: horizontal-tb; font-size: .64rem; }
  .contents-mobile-backdrop { position: fixed; z-index: 54; inset: 0; display: block; width: 100%; height: 100dvh; border: 0; background: color-mix(in srgb, var(--workspace-ink) 28%, transparent); padding: 0; backdrop-filter: blur(2px); }
  .chapter-sidebar { position: fixed; z-index: 55; inset: 0 auto 0 0; width: min(88vw, 22rem); max-width: calc(100vw - 2.75rem); max-height: none; border-right: 1px solid var(--workspace-border); border-bottom: 0; padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); box-shadow: 12px 0 34px color-mix(in srgb, var(--workspace-ink) 24%, transparent); }
  .chapter-sidebar-heading { min-height: 3.2rem; padding: .65rem .7rem .45rem; }
  .chapter-sidebar-heading .contents-toggle { width: 2.1rem; height: 2.1rem; }
  .chapter-list { display: block; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; padding: .15rem .5rem .65rem; }
  .chapter-group { min-width: 0; }
  .chapter-group + .chapter-group { margin-top: .2rem; }
  .chapter-select { min-height: 3rem; padding: .55rem .4rem; }
  .chapter-menu > summary { opacity: 1; }
  .chapter-outline { display: block; margin-bottom: .45rem; }
  .chapter-outline button, .document-outline button { min-height: 2.35rem; }
  .document-outline { min-width: 0; }
  .add-chapter-button { display: flex; min-height: 2.9rem; }
  .writing-pane, .chapter-heading, .chapter-editor, .markdown-editor, .chapter-footer { width: 100%; min-width: 0; max-width: 100%; }
  .writing-pane { padding: .38rem; }
  .markdown-editor { overflow-x: clip; }
  .markdown-editor textarea { min-height: calc(100dvh - 10.5rem); padding: .72rem .68rem; }
  .workspace-grid--focus .markdown-editor textarea { min-height: calc(100dvh - 6.5rem); }
  .chapter-heading-meta { align-items: flex-start; flex-direction: column; }
  .markdown-editor-toolbar > span, .markdown-document-meta { display: none; }
  .chapter-footer > span { display: none; }
  .details-backdrop { align-items: end; padding: 0; }
  .details-dialog, .encryption-dialog { width: 100%; max-height: calc(100dvh - .75rem); border-radius: 1rem 1rem 0 0; padding-right: max(1rem, env(safe-area-inset-right)); padding-bottom: max(1rem, env(safe-area-inset-bottom)); padding-left: max(1rem, env(safe-area-inset-left)); }
  .encryption-lock-screen { width: calc(100% - 1rem); grid-template-columns: 1fr; margin: 1rem auto; padding: 1rem; }
  .encryption-lock-screen form { grid-column: 1; }
  .encryption-lock-actions { align-items: stretch; flex-direction: column-reverse; }
}
</style>
