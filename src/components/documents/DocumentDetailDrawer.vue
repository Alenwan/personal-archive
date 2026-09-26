<script setup lang="ts">
import {
  ArrowLeft,
  Download,
  FileText,
  FileUp,
  History,
  Image as ImageIcon,
  ListMusic,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Save,
  X
} from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_REVIEW_STATUSES,
  type ArchiveFolder,
  type DocumentCategory,
  type DocumentRecord,
  type DocumentReviewStatus,
  type DocumentUpdateInput,
  type Tag
} from "../../shared/types";
import { formatDateTime, formatFileSize } from "../../shared/format";
import { isAudioPreviewFile } from "../../shared/audioPreview";
import { isImagePreviewFile } from "../../shared/imagePreview";
import ImagePreviewViewer from "./ImagePreviewViewer.vue";

const REVIEW_STATUS_LABELS: Record<DocumentReviewStatus, string> = {
  "needs-review": "Needs review",
  "in-review": "In review",
  approved: "Approved",
  "needs-info": "Needs information",
  rejected: "Rejected",
  superseded: "Superseded"
};

const REVIEW_STATUS_CLASSES: Record<DocumentReviewStatus, string> = {
  "needs-review": "bg-amber-100 text-amber-900",
  "in-review": "bg-blue-100 text-blue-900",
  approved: "bg-emerald-100 text-emerald-900",
  "needs-info": "bg-yellow-100 text-yellow-900",
  rejected: "bg-red-100 text-red-900",
  superseded: "bg-ink-100 text-ink-700"
};

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    document: DocumentRecord | null;
    availableTags?: Tag[];
    documentCategories?: readonly DocumentCategory[];
    archiveFolders?: readonly ArchiveFolder[];
    showArchiveLocation?: boolean;
    canEdit?: boolean;
    saving?: boolean;
    error?: string;
    versions?: DocumentRecord[];
    uploadingVersion?: boolean;
    versionError?: string;
    imageSequence?: DocumentRecord[];
    imageSequenceLoading?: boolean;
  }>(),
  {
    availableTags: () => [],
    documentCategories: () => DOCUMENT_CATEGORIES,
    archiveFolders: () => [],
    showArchiveLocation: false,
    canEdit: false,
    saving: false,
    error: "",
    versions: () => [],
    uploadingVersion: false,
    versionError: "",
    imageSequence: () => [],
    imageSequenceLoading: false
  }
);

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  save: [payload: DocumentUpdateInput];
  "upload-version": [payload: { file: File; category: DocumentCategory; notes: string; tagIds: string[] }];
  "navigate-image": [document: DocumentRecord];
  "play-audio": [document: DocumentRecord];
}>();

const editMode = ref(false);
const versionMode = ref(false);
const versionFile = ref<File | null>(null);
const detailsCollapsed = ref(false);
const dialogElement = ref<HTMLDialogElement | null>(null);
const previewFrameElement = ref<HTMLIFrameElement | null>(null);
const mediaElement = ref<HTMLMediaElement | null>(null);
const mediaReloadKey = ref(0);
const mediaPreviewError = ref("");
let previewFrameWindow: Window | null = null;
const releasedMediaElements = new WeakSet<HTMLMediaElement>();
const form = reactive<DocumentUpdateInput>({
  category: "Other",
  folderId: null,
  notes: "",
  reviewStatus: "needs-review",
  reviewNotes: "",
  tagIds: []
});
const versionForm = reactive({
  category: "Other" as DocumentCategory,
  notes: "",
  tagIds: [] as string[]
});

const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;
const TEXT_PREVIEW_MIME_TYPES = new Set([
  "application/csv",
  "application/json",
  "application/xml",
  "application/x-ndjson",
  "text/csv",
  "text/markdown",
  "text/plain",
  "text/tab-separated-values",
  "text/xml"
]);
const TEXT_PREVIEW_EXTENSIONS = new Set(["csv", "json", "log", "md", "text", "tsv", "txt", "xml"]);
const OFFICE_PREVIEW_MIME_TYPES = new Set([
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);
const OFFICE_PREVIEW_EXTENSIONS = new Set(["doc", "docm", "docx", "ppt", "pptm", "pptx", "xls", "xlsm", "xlsx"]);

const previewUrl = computed(() => (props.document ? `/api/documents/${props.document.documentId}/preview` : ""));
const downloadUrl = computed(() => (props.document ? `/api/documents/${props.document.documentId}/download` : ""));
const mimeType = computed(() => props.document?.mimeType.toLowerCase() ?? "");
const lowerFileName = computed(() => props.document?.fileName.toLowerCase() ?? "");
const fileExtension = computed(() => lowerFileName.value.split(".").pop() ?? "");
const isImage = computed(() => isImagePreviewFile(props.document?.mimeType, props.document?.originalFileName));
const isPdf = computed(() => mimeType.value === "application/pdf" || lowerFileName.value.endsWith(".pdf"));
const isAudio = computed(() => isAudioPreviewFile(props.document?.mimeType, props.document?.originalFileName));
const isVideo = computed(() => mimeType.value.startsWith("video/"));
const mediaElementKey = computed(() => `${props.document?.documentId ?? "media"}-${mediaReloadKey.value}`);
const isTextPreview = computed(() => {
  if (mimeType.value.includes("html")) return false;
  return (
    TEXT_PREVIEW_MIME_TYPES.has(mimeType.value) ||
    (mimeType.value.startsWith("text/") && mimeType.value !== "text/html") ||
    TEXT_PREVIEW_EXTENSIONS.has(fileExtension.value)
  );
});
const isTextPreviewTooLarge = computed(() => isTextPreview.value && (props.document?.fileSize ?? 0) > TEXT_PREVIEW_MAX_BYTES);
const isOfficeDocument = computed(() => OFFICE_PREVIEW_MIME_TYPES.has(mimeType.value) || OFFICE_PREVIEW_EXTENSIONS.has(fileExtension.value));
const canInlinePreview = computed(() => isPdf.value || isImage.value || isAudio.value || isVideo.value || (isTextPreview.value && !isTextPreviewTooLarge.value));
const textPreview = ref("");
const textPreviewLoading = ref(false);
const textPreviewError = ref("");
let textPreviewRequestId = 0;
const sortedVersions = computed(() =>
  [...props.versions].sort((a, b) => (b.versionNumber ?? 1) - (a.versionNumber ?? 1) || b.uploadedAt.localeCompare(a.uploadedAt))
);
const visibleVersions = computed(() => sortedVersions.value.length ? sortedVersions.value : props.document ? [props.document] : []);
const versionCount = computed(() => sortedVersions.value.length || (props.document ? 1 : 0));
const imageSequenceIndex = computed(() =>
  props.document ? props.imageSequence.findIndex((item) => item.documentId === props.document?.documentId) : -1
);
const previousImage = computed(() => imageSequenceIndex.value > 0 ? props.imageSequence[imageSequenceIndex.value - 1] : null);
const nextImage = computed(() =>
  imageSequenceIndex.value >= 0 && imageSequenceIndex.value < props.imageSequence.length - 1
    ? props.imageSequence[imageSequenceIndex.value + 1]
    : null
);
const imageSequencePosition = computed(() => imageSequenceIndex.value >= 0 ? imageSequenceIndex.value + 1 : 0);
const availableDocumentCategories = computed(() => props.documentCategories.length ? props.documentCategories : DOCUMENT_CATEGORIES);
const archiveFolderOptions = computed(() => {
  const byId = new Map(props.archiveFolders.map((folder) => [folder.folderId, folder]));
  const pathFor = (folder: ArchiveFolder) => {
    const parts = [folder.name];
    const visited = new Set([folder.folderId]);
    let parentId = folder.parentFolderId ?? null;
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      parts.unshift(parent.name);
      parentId = parent.parentFolderId ?? null;
    }
    return parts.join(" / ");
  };
  return props.archiveFolders
    .map((folder) => ({ folderId: folder.folderId, label: pathFor(folder) }))
    .sort((a, b) => a.label.localeCompare(b.label));
});

function hydrate() {
  form.category = props.document?.category ?? "Other";
  form.folderId = props.document?.folderId ?? null;
  form.notes = props.document?.notes ?? "";
  form.reviewStatus = props.document?.reviewStatus ?? "needs-review";
  form.reviewNotes = props.document?.reviewNotes ?? "";
  form.tagIds = props.document?.tags.map((tag) => tag.tagId) ?? [];
  versionForm.category = props.document?.category ?? "Other";
  versionForm.notes = "";
  versionForm.tagIds = props.document?.tags.map((tag) => tag.tagId) ?? [];
  versionFile.value = null;
  editMode.value = false;
  versionMode.value = false;
}

function releaseMedia() {
  const media = mediaElement.value;
  if (!media) return;
  releasedMediaElements.add(media);
  media.pause();
  media.removeAttribute("src");
  media.load();
}

function retryMedia() {
  releaseMedia();
  mediaPreviewError.value = "";
  mediaReloadKey.value += 1;
}

function playAudioQueue() {
  if (!props.document) return;
  releaseMedia();
  emit("play-audio", props.document);
}

function onMediaReady() {
  mediaPreviewError.value = "";
}

function onMediaError(event: Event) {
  if (event.currentTarget instanceof HTMLMediaElement && releasedMediaElements.has(event.currentTarget)) return;
  mediaPreviewError.value = "This media file could not be loaded. Close other media previews or try again.";
}

function close() {
  if (props.saving) return;
  releaseMedia();
  emit("update:modelValue", false);
}

function isFormControl(target: EventTarget | null) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable);
}

function navigateImage(direction: -1 | 1) {
  const target = direction < 0 ? previousImage.value : nextImage.value;
  if (target) emit("navigate-image", target);
}

async function syncNativeDialog(isOpen: boolean) {
  if (!isOpen) {
    if (dialogElement.value?.open) dialogElement.value.close();
    return;
  }
  await nextTick();
  if (dialogElement.value && !dialogElement.value.open) dialogElement.value.showModal();
}

function onWindowKeydown(event: KeyboardEvent) {
  if (!props.modelValue) return;
  if (isImage.value && !isFormControl(event.target)) {
    if (event.key === "ArrowLeft" && previousImage.value) {
      event.preventDefault();
      navigateImage(-1);
      return;
    }
    if (event.key === "ArrowRight" && nextImage.value) {
      event.preventDefault();
      navigateImage(1);
      return;
    }
  }
  if (event.key !== "Escape") return;
  event.preventDefault();
  close();
}

function detachPreviewFrameKeydown() {
  try {
    previewFrameWindow?.removeEventListener("keydown", onWindowKeydown, true);
  } catch {
    // Browser-native preview surfaces can be isolated even when their source URL is local.
  }
  previewFrameWindow = null;
}

function attachPreviewFrameKeydown() {
  detachPreviewFrameKeydown();
  try {
    previewFrameWindow = previewFrameElement.value?.contentWindow ?? null;
    previewFrameWindow?.addEventListener("keydown", onWindowKeydown, true);
  } catch {
    previewFrameWindow = null;
  }
}

function showDetailsPanel() {
  editMode.value = false;
  versionMode.value = false;
}

function showEditPanel() {
  editMode.value = true;
  versionMode.value = false;
}

function showVersionPanel() {
  versionMode.value = true;
  editMode.value = false;
}

function submit() {
  emit("save", {
    category: form.category,
    folderId: form.folderId ?? null,
    notes: form.notes ?? "",
    reviewStatus: form.reviewStatus,
    reviewNotes: form.reviewNotes ?? "",
    tagIds: form.tagIds ?? []
  });
}

function documentReviewLabel(status?: DocumentReviewStatus) {
  return REVIEW_STATUS_LABELS[status ?? "needs-review"];
}

function toggleTag(tagId: string, checked: boolean) {
  const current = form.tagIds ?? [];
  form.tagIds = checked ? [...new Set([...current, tagId])] : current.filter((id) => id !== tagId);
}

function toggleVersionTag(tagId: string, checked: boolean) {
  const current = versionForm.tagIds;
  versionForm.tagIds = checked ? [...new Set([...current, tagId])] : current.filter((id) => id !== tagId);
}

function onVersionFileChange(event: Event) {
  versionFile.value = (event.target as HTMLInputElement).files?.[0] ?? null;
}

function submitVersion() {
  if (!versionFile.value) return;
  emit("upload-version", {
    file: versionFile.value,
    category: versionForm.category,
    notes: versionForm.notes,
    tagIds: versionForm.tagIds
  });
}

async function loadTextPreview() {
  const requestId = ++textPreviewRequestId;
  textPreview.value = "";
  textPreviewError.value = "";
  textPreviewLoading.value = false;
  if (!props.modelValue || !props.document || !isTextPreview.value || isTextPreviewTooLarge.value) return;

  textPreviewLoading.value = true;
  try {
    const response = await fetch(previewUrl.value);
    if (!response.ok) throw new Error(`Preview failed with status ${response.status}`);
    const text = await response.text();
    if (requestId === textPreviewRequestId) textPreview.value = text;
  } catch (error) {
    if (requestId === textPreviewRequestId) {
      textPreviewError.value = error instanceof Error ? error.message : "Text preview failed.";
    }
  } finally {
    if (requestId === textPreviewRequestId) textPreviewLoading.value = false;
  }
}

watch(
  () => props.document,
  (document, previousDocument) => {
    if (document?.documentId !== previousDocument?.documentId) {
      releaseMedia();
      mediaPreviewError.value = "";
      mediaReloadKey.value = 0;
    }
    hydrate();
  }
);
watch(
  () => props.modelValue,
  (isOpen) => {
    if (isOpen) {
      hydrate();
      detailsCollapsed.value = window.matchMedia("(max-width: 900px)").matches;
    } else {
      releaseMedia();
    }
    void syncNativeDialog(isOpen);
  }
);
watch(
  () => [props.modelValue, previousImage.value?.documentId, nextImage.value?.documentId] as const,
  ([isOpen]) => {
    if (!isOpen || !isImage.value) return;
    for (const adjacent of [previousImage.value, nextImage.value]) {
      if (!adjacent) continue;
      const preload = new Image();
      preload.src = `/api/documents/${adjacent.documentId}/preview`;
    }
  },
  { immediate: true }
);
watch(
  () => [props.modelValue, props.document?.documentId, isTextPreview.value, isTextPreviewTooLarge.value] as const,
  () => {
    void loadTextPreview();
  }
);

onMounted(() => {
  window.addEventListener("keydown", onWindowKeydown, true);
  void syncNativeDialog(props.modelValue);
});

onBeforeUnmount(() => {
  releaseMedia();
  window.removeEventListener("keydown", onWindowKeydown, true);
  detachPreviewFrameKeydown();
  if (dialogElement.value?.open) dialogElement.value.close();
});
</script>

<template>
  <dialog
    v-if="modelValue && document"
    ref="dialogElement"
    class="document-detail-dialog fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-ink-900/45 p-0"
    :aria-label="`Document preview: ${document.originalFileName}`"
    @cancel.prevent="close"
    @mousedown.self="close"
  >
    <aside class="document-detail-panel ml-auto flex h-full w-full max-w-[min(1600px,calc(100vw-1.5rem))] flex-col overflow-hidden bg-white shadow-soft">
      <header class="document-detail-header flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
        <div class="min-w-0">
          <p class="text-xs font-semibold uppercase tracking-wide text-accent-800">Document profile</p>
          <h2 class="mt-1 truncate text-lg font-semibold">{{ document.originalFileName }}</h2>
          <div class="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-500">
            <span>{{ document.category }} · {{ formatFileSize(document.fileSize) }}</span>
            <span class="rounded-full bg-ink-100 px-2.5 py-0.5 text-xs font-semibold text-ink-700">
              v{{ document.versionNumber ?? 1 }}
            </span>
            <span
              class="rounded-full px-2.5 py-0.5 text-xs font-semibold"
              :class="REVIEW_STATUS_CLASSES[document.reviewStatus]"
            >
              {{ documentReviewLabel(document.reviewStatus) }}
            </span>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <button
            class="btn-secondary h-9 px-3"
            type="button"
            :title="detailsCollapsed ? 'Show document details' : 'Hide document details'"
            @click="detailsCollapsed = !detailsCollapsed"
          >
            <PanelRightOpen v-if="detailsCollapsed" class="h-4 w-4" />
            <PanelRightClose v-else class="h-4 w-4" />
            <span class="hidden sm:inline">{{ detailsCollapsed ? "Show details" : "Hide details" }}</span>
          </button>
          <button class="btn-secondary h-9 px-3" type="button" aria-label="Close document preview" @click="close">
            <X class="h-4 w-4" />
          </button>
        </div>
      </header>

      <div
        class="grid min-h-0 flex-1"
        :class="detailsCollapsed ? 'grid-cols-1 overflow-hidden' : 'overflow-y-auto lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden'"
      >
        <section class="document-preview-stage flex min-h-[70vh] bg-ink-50 p-4 lg:min-h-0">
          <div class="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-ink-200 bg-white">
            <iframe
              v-if="isPdf"
              ref="previewFrameElement"
              class="h-full min-h-0 w-full flex-1"
              :src="previewUrl"
              title="Document preview"
              @load="attachPreviewFrameKeydown"
            />
            <ImagePreviewViewer
              v-else-if="isImage"
              :src="previewUrl"
              :alt="document.originalFileName"
              :download-url="downloadUrl"
              :sequence-position="imageSequencePosition"
              :sequence-total="imageSequence.length"
              :sequence-loading="imageSequenceLoading"
              :previous-label="previousImage?.originalFileName"
              :next-label="nextImage?.originalFileName"
              @previous="navigateImage(-1)"
              @next="navigateImage(1)"
            />
            <div v-else-if="isVideo" class="grid min-h-0 flex-1 place-items-center overflow-auto bg-ink-900 p-4">
              <div class="grid max-h-full max-w-full gap-3">
                <video
                  :key="mediaElementKey"
                  ref="mediaElement"
                  class="max-h-full max-w-full rounded-md"
                  :src="previewUrl"
                  controls
                  preload="metadata"
                  playsinline
                  @loadedmetadata="onMediaReady"
                  @canplay="onMediaReady"
                  @error="onMediaError"
                />
                <div v-if="mediaPreviewError" class="rounded-md bg-white/95 p-3 text-center text-sm text-red-700">
                  <p>{{ mediaPreviewError }}</p>
                  <button class="btn-secondary mt-2 h-9 px-3" type="button" @click="retryMedia">Try again</button>
                </div>
              </div>
            </div>
            <div v-else-if="isAudio" class="grid min-h-0 flex-1 place-items-center overflow-auto p-8">
              <div class="w-full max-w-xl rounded-lg border border-ink-200 bg-white p-6 shadow-soft">
                <h3 class="mb-4 font-semibold">{{ document.originalFileName }}</h3>
                <audio
                  :key="mediaElementKey"
                  ref="mediaElement"
                  class="w-full"
                  :src="previewUrl"
                  controls
                  preload="metadata"
                  @loadedmetadata="onMediaReady"
                  @canplay="onMediaReady"
                  @error="onMediaError"
                />
                <div class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-4">
                  <p class="max-w-sm text-sm leading-5 text-ink-500">
                    Start the Archive player to continue through the music in this folder after closing this preview.
                  </p>
                  <button class="btn-primary shrink-0" type="button" @click="playAudioQueue">
                    <ListMusic class="h-4 w-4" />
                    Play folder
                  </button>
                </div>
                <div v-if="mediaPreviewError" class="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
                  <p>{{ mediaPreviewError }}</p>
                  <button class="btn-secondary mt-2 h-9 px-3" type="button" @click="retryMedia">Try again</button>
                </div>
              </div>
            </div>
            <div v-else-if="isTextPreview" class="min-h-0 flex-1 overflow-auto bg-white p-4">
              <div v-if="isTextPreviewTooLarge" class="grid min-h-full place-items-center text-center">
                <div>
                  <div class="mx-auto grid h-14 w-14 place-items-center rounded-md bg-accent-50 text-accent-800">
                    <FileText class="h-7 w-7" />
                  </div>
                  <h3 class="mt-4 font-semibold">Text preview is limited to 1 MB</h3>
                  <p class="mt-2 max-w-sm text-sm text-ink-500">
                    Download the original file to review larger text, CSV, JSON, XML, or log files.
                  </p>
                  <a class="btn-primary mt-4" :href="downloadUrl">
                    <Download class="h-4 w-4" />
                    Download file
                  </a>
                </div>
              </div>
              <div v-else-if="textPreviewLoading" class="grid min-h-full place-items-center text-sm font-semibold text-ink-500">
                Loading text preview...
              </div>
              <div v-else-if="textPreviewError" class="grid min-h-full place-items-center text-center">
                <div>
                  <h3 class="font-semibold text-legal-red">Text preview failed</h3>
                  <p class="mt-2 max-w-sm text-sm text-ink-500">{{ textPreviewError }}</p>
                  <a class="btn-primary mt-4" :href="downloadUrl">
                    <Download class="h-4 w-4" />
                    Download file
                  </a>
                </div>
              </div>
              <pre v-else class="min-h-full whitespace-pre-wrap break-words rounded-md bg-ink-50 p-4 font-mono text-sm leading-6 text-ink-900">{{ textPreview }}</pre>
            </div>
            <div v-else-if="isOfficeDocument" class="grid min-h-0 flex-1 place-items-center p-8 text-center">
              <div>
                <div class="mx-auto grid h-14 w-14 place-items-center rounded-md bg-accent-50 text-accent-800">
                  <FileText class="h-7 w-7" />
                </div>
                <h3 class="mt-4 font-semibold">Office preview planned for local deployment</h3>
                <p class="mt-2 max-w-md text-sm text-ink-500">
                  Word, Excel, and PowerPoint preview requires the document conversion service, which is planned for the local deployment version. You can download the original file now.
                </p>
                <a class="btn-primary mt-4" :href="downloadUrl">
                  <Download class="h-4 w-4" />
                  Download file
                </a>
              </div>
            </div>
            <div v-else class="grid min-h-0 flex-1 place-items-center p-8 text-center">
              <div>
                <div class="mx-auto grid h-14 w-14 place-items-center rounded-md bg-accent-50 text-accent-800">
                  <FileText class="h-7 w-7" />
                </div>
                <h3 class="mt-4 font-semibold">Preview not available for this file type</h3>
                <p class="mt-2 max-w-sm text-sm text-ink-500">
                  Download the file to review it in the correct desktop application. PDF, image, text, CSV, audio, and video previews are shown inline when supported by the browser.
                </p>
                <a class="btn-primary mt-4" :href="downloadUrl">
                  <Download class="h-4 w-4" />
                  Download file
                </a>
              </div>
            </div>
          </div>
        </section>

        <aside v-if="!detailsCollapsed" class="flex min-h-0 flex-col border-t border-ink-200 lg:border-l lg:border-t-0">
          <div v-if="!editMode && !versionMode" class="min-h-0 flex-1 overflow-y-auto p-5">
            <div class="flex flex-wrap gap-2">
              <a class="btn-secondary" :href="downloadUrl">
                <Download class="h-4 w-4" />
                Download
              </a>
              <button
                class="btn-secondary"
                type="button"
                :disabled="!canEdit"
                :title="canEdit ? 'Edit document metadata' : 'Only Admin and Manager can edit document metadata'"
                @click="showEditPanel"
              >
                <Pencil class="h-4 w-4" />
                Edit metadata
              </button>
              <button
                class="btn-secondary"
                type="button"
                :disabled="!canEdit"
                :title="canEdit ? 'Upload a replacement version while preserving history' : 'Only Admin and Manager can upload a new version'"
                @click="showVersionPanel"
              >
                <FileUp class="h-4 w-4" />
                New version
              </button>
            </div>

            <dl class="mt-6 space-y-4 text-sm">
              <div>
                <dt class="text-xs font-semibold uppercase text-ink-500">Version</dt>
                <dd class="mt-1 font-medium">
                  Current version {{ document.versionNumber ?? 1 }} of {{ versionCount }}
                </dd>
                <dd v-if="document.supersededAt" class="mt-1 text-ink-500">
                  Superseded {{ formatDateTime(document.supersededAt) }}
                </dd>
              </div>
              <div>
                <dt class="text-xs font-semibold uppercase text-ink-500">Storage</dt>
                <dd class="mt-1 break-all font-medium">{{ document.r2ObjectKey }}</dd>
              </div>
              <div>
                <dt class="text-xs font-semibold uppercase text-ink-500">MIME type</dt>
                <dd class="mt-1 font-medium">{{ document.mimeType || "application/octet-stream" }}</dd>
              </div>
              <div>
                <dt class="text-xs font-semibold uppercase text-ink-500">Uploaded</dt>
                <dd class="mt-1 font-medium">{{ formatDateTime(document.uploadedAt) }}</dd>
                <dd class="mt-1 text-ink-500">{{ document.uploadedByName }}</dd>
              </div>
              <div>
                <dt class="text-xs font-semibold uppercase text-ink-500">Review</dt>
                <dd class="mt-2">
                  <span
                    class="rounded-full px-3 py-1 text-xs font-semibold"
                    :class="REVIEW_STATUS_CLASSES[document.reviewStatus]"
                  >
                    {{ documentReviewLabel(document.reviewStatus) }}
                  </span>
                </dd>
                <dd v-if="document.reviewedAt" class="mt-2 text-ink-500">
                  {{ formatDateTime(document.reviewedAt) }}
                  <span v-if="document.reviewedByName"> · {{ document.reviewedByName }}</span>
                </dd>
                <dd class="mt-2 whitespace-pre-wrap font-medium">{{ document.reviewNotes || "No review notes" }}</dd>
              </div>
              <div>
                <dt class="text-xs font-semibold uppercase text-ink-500">Tags</dt>
                <dd class="mt-2 flex flex-wrap gap-2">
                  <span v-if="!document.tags.length" class="text-ink-500">No tags</span>
                  <span
                    v-for="tag in document.tags"
                    :key="tag.tagId"
                    class="rounded-full px-3 py-1 text-xs font-semibold text-white"
                    :style="{ backgroundColor: tag.color }"
                  >
                    {{ tag.name }}
                  </span>
                </dd>
              </div>
              <div>
                <dt class="text-xs font-semibold uppercase text-ink-500">Notes</dt>
                <dd class="mt-1 whitespace-pre-wrap font-medium">{{ document.notes || "No notes" }}</dd>
              </div>
            </dl>

            <section class="mt-6 border-t border-ink-200 pt-5">
              <div class="mb-3 flex items-center justify-between gap-3">
                <div class="flex items-center gap-2">
                  <History class="h-4 w-4 text-accent-800" />
                  <h3 class="text-sm font-semibold">Version history</h3>
                </div>
                <span class="rounded-full bg-ink-100 px-2.5 py-0.5 text-xs font-semibold text-ink-700">
                  {{ versionCount }} versions
                </span>
              </div>
              <div class="space-y-2">
                <div
                  v-for="version in visibleVersions"
                  :key="version.documentId"
                  class="rounded-md border border-ink-200 bg-white p-3 text-sm"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <p class="font-semibold">
                        v{{ version.versionNumber ?? 1 }}
                        <span v-if="version.isCurrentVersion" class="ml-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800">
                          Current
                        </span>
                      </p>
                      <p class="mt-1 truncate text-xs text-ink-500">{{ version.originalFileName }}</p>
                    </div>
                    <a class="text-xs font-semibold text-accent-800 hover:underline" :href="`/api/documents/${version.documentId}/download`">
                      Download
                    </a>
                  </div>
                  <p class="mt-2 text-xs text-ink-500">
                    {{ formatDateTime(version.uploadedAt) }} · {{ version.uploadedByName }}
                  </p>
                  <p v-if="version.notes" class="mt-2 text-xs text-ink-700">{{ version.notes }}</p>
                </div>
                <p v-if="!visibleVersions.length" class="text-sm text-ink-500">No version history loaded yet.</p>
              </div>
            </section>

            <div v-if="canInlinePreview" class="mt-6 rounded-md bg-accent-50 p-3 text-sm text-accent-900">
              <div class="flex items-start gap-2">
                <ImageIcon class="mt-0.5 h-4 w-4 shrink-0" />
                <p>Preview is streamed through the protected API route. Private file storage remains protected.</p>
              </div>
            </div>
          </div>

          <form v-else-if="editMode" class="flex min-h-0 flex-1 flex-col" @submit.prevent="submit">
            <div class="shrink-0 border-b border-ink-200 p-5">
              <button class="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-accent-800 hover:underline" type="button" @click="showDetailsPanel">
                <ArrowLeft class="h-4 w-4" />
                Back to details
              </button>
              <h3 class="text-base font-semibold">Edit metadata</h3>
              <p class="mt-1 text-sm leading-5 text-ink-500">Update location, category, notes, tags, and review status for this document.</p>
            </div>
            <div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              <label v-if="showArchiveLocation" class="block text-sm font-semibold">
                Folder
                <select v-model="form.folderId" class="input mt-1">
                  <option :value="null">Unfiled</option>
                  <option v-for="folder in archiveFolderOptions" :key="folder.folderId" :value="folder.folderId">{{ folder.label }}</option>
                </select>
              </label>
              <label class="block text-sm font-semibold">
                Category
                <select v-model="form.category" class="input mt-1">
                  <option v-for="category in availableDocumentCategories" :key="category" :value="category">{{ category }}</option>
                </select>
              </label>
              <label class="block text-sm font-semibold">
                Notes
                <textarea v-model="form.notes" class="textarea mt-1" placeholder="Document purpose, source, review notes, or follow-up needed." />
              </label>
              <label class="block text-sm font-semibold">
                Review status
                <select v-model="form.reviewStatus" class="input mt-1">
                  <option v-for="status in DOCUMENT_REVIEW_STATUSES" :key="status" :value="status">
                    {{ documentReviewLabel(status) }}
                  </option>
                </select>
              </label>
              <label class="block text-sm font-semibold">
                Review notes
                <textarea v-model="form.reviewNotes" class="textarea mt-1" placeholder="Approval context, missing information, rejection reason, or replacement note." />
              </label>
              <fieldset>
                <legend class="text-sm font-semibold">Tags</legend>
                <div class="mt-1 grid max-h-40 gap-2 overflow-y-auto rounded-md border border-ink-200 bg-white p-3">
                  <label
                    v-for="tag in availableTags"
                    :key="tag.tagId"
                    class="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-50"
                  >
                    <span class="flex min-w-0 items-center gap-2">
                      <span class="h-2.5 w-2.5 shrink-0 rounded-full" :style="{ backgroundColor: tag.color }" />
                      <span class="truncate">{{ tag.name }}</span>
                    </span>
                    <input
                      class="h-4 w-4 rounded border-ink-300 text-accent-700 focus:ring-accent-500"
                      type="checkbox"
                      :checked="(form.tagIds ?? []).includes(tag.tagId)"
                      @change="toggleTag(tag.tagId, ($event.target as HTMLInputElement).checked)"
                    />
                  </label>
                  <p v-if="!availableTags.length" class="text-sm text-ink-500">No tags available yet.</p>
                </div>
              </fieldset>
              <p v-if="error" class="text-sm font-semibold text-legal-red">{{ error }}</p>
            </div>
            <div class="flex shrink-0 justify-end gap-2 border-t border-ink-200 bg-white p-4">
              <button class="btn-secondary" type="button" :disabled="saving" @click="showDetailsPanel">Cancel</button>
              <button class="btn-primary" type="submit" :disabled="saving">
                <Save class="h-4 w-4" />
                {{ saving ? "Saving..." : "Save metadata" }}
              </button>
            </div>
          </form>

          <form v-else class="flex min-h-0 flex-1 flex-col" @submit.prevent="submitVersion">
            <div class="shrink-0 border-b border-ink-200 p-5">
              <button class="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-accent-800 hover:underline" type="button" @click="showDetailsPanel">
                <ArrowLeft class="h-4 w-4" />
                Back to details
              </button>
              <div class="flex items-start gap-2">
                <div class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-blue-50 text-blue-800">
                  <FileUp class="h-4 w-4" />
                </div>
                <div>
                  <h3 class="text-base font-semibold">Upload new version</h3>
                  <p class="mt-1 text-sm leading-5 text-ink-500">
                    The current file remains in version history. Lists and reports will use the new current version.
                  </p>
                </div>
              </div>
            </div>
            <div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              <input class="input" type="file" :disabled="uploadingVersion" @change="onVersionFileChange" />
              <label class="block text-sm font-semibold">
                Category
                <select v-model="versionForm.category" class="input mt-1" :disabled="uploadingVersion">
                  <option v-for="category in availableDocumentCategories" :key="category" :value="category">{{ category }}</option>
                </select>
              </label>
              <label class="block text-sm font-semibold">
                Version notes
                <textarea
                  v-model="versionForm.notes"
                  class="textarea mt-1"
                  :disabled="uploadingVersion"
                  placeholder="What changed in this version, source, or review context."
                />
              </label>
              <fieldset>
                <legend class="text-sm font-semibold">Version tags</legend>
                <div class="mt-1 grid max-h-40 gap-2 overflow-y-auto rounded-md border border-ink-200 bg-white p-3">
                  <label
                    v-for="tag in availableTags"
                    :key="tag.tagId"
                    class="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-50"
                  >
                    <span class="flex min-w-0 items-center gap-2">
                      <span class="h-2.5 w-2.5 shrink-0 rounded-full" :style="{ backgroundColor: tag.color }" />
                      <span class="truncate">{{ tag.name }}</span>
                    </span>
                    <input
                      class="h-4 w-4 rounded border-ink-300 text-accent-700 focus:ring-accent-500"
                      type="checkbox"
                      :checked="versionForm.tagIds.includes(tag.tagId)"
                      :disabled="uploadingVersion"
                      @change="toggleVersionTag(tag.tagId, ($event.target as HTMLInputElement).checked)"
                    />
                  </label>
                  <p v-if="!availableTags.length" class="text-sm text-ink-500">No tags available yet.</p>
                </div>
              </fieldset>
              <p v-if="versionError" class="text-sm font-semibold text-legal-red">{{ versionError }}</p>
            </div>
            <div class="flex shrink-0 justify-end gap-2 border-t border-ink-200 bg-white p-4">
              <button class="btn-secondary" type="button" :disabled="uploadingVersion" @click="showDetailsPanel">Cancel</button>
              <button class="btn-primary" type="submit" :disabled="!versionFile || uploadingVersion">
                <FileUp class="h-4 w-4" />
                {{ uploadingVersion ? "Uploading..." : "Upload version" }}
              </button>
            </div>
          </form>
        </aside>
      </div>
    </aside>
  </dialog>
</template>

<style scoped>
.document-detail-dialog::backdrop {
  background: transparent;
}

@media (max-width: 900px) {
  .document-detail-panel {
    max-width: 100vw;
  }

  .document-detail-header {
    gap: 0.75rem;
    padding: 0.75rem;
  }

  .document-preview-stage {
    min-height: 0;
    padding: 0;
  }

  .document-preview-stage > div {
    border: 0;
    border-radius: 0;
  }
}
</style>
