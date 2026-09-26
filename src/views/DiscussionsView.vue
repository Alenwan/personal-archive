<script setup lang="ts">
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  ChevronUp,
  CheckSquare,
  Edit3,
  FileText,
  ListChecks,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Pin,
  PinOff,
  Plus,
  Reply,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  X
} from "lucide-vue-next";
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { client } from "../api/client";
import ArchiveManagementAccess from "../components/documents/ArchiveManagementAccess.vue";
import { useArchiveContentManagement } from "../composables/useArchiveContentManagement";
import { useBusinessTemplate, workItemPath } from "../businessTemplate";
import { useDismissibleMenus } from "../composables/useDismissibleMenus";
import DiscussionReplyComposer from "../components/discussion/DiscussionReplyComposer.vue";
import DiscussionLinkedContext from "../components/discussion/DiscussionLinkedContext.vue";
import DiscussionAppearanceMenu from "../components/discussion/DiscussionAppearanceMenu.vue";
import DiscussionEditToolbar from "../components/discussion/DiscussionEditToolbar.vue";
import MarkdownContent from "../components/discussion/MarkdownContent.vue";
import AutoGrowTextarea from "../components/editor/AutoGrowTextarea.vue";
import RichTextEditor from "../components/editor/RichTextEditor.vue";
import MarkdownReaderDialog from "../components/reading/MarkdownReaderDialog.vue";
import PageHeader from "../components/PageHeader.vue";
import { useReadingPreferences } from "../readingPreferences";
import {
  formatDateTime,
  formatFileSize
} from "../shared/format";
import { resolveDiscussionTitle } from "../shared/discussionTitle";
import { isRichTextHtml } from "../shared/richTextContent";
import {
  SERVICE_DISCUSSION_THREAD_STATUSES,
  type CaseRecord,
  type ManagedAsset,
  type PaginatedResult,
  type PublicUser,
  type ServiceDiscussionMessage,
  type ServiceDiscussionAttachment,
  type ServiceDiscussionSortField,
  type ServiceDiscussionSummary,
  type ServiceDiscussionThreadStatus,
  type ServiceDiscussionViewFilter
} from "../shared/types";
import { useAuthStore } from "../stores/auth";
import { useToastStore } from "../stores/toasts";

const DISCUSSIONS_FILTER_STORAGE_KEY = "md3-platform.discussions.filters";
const DISCUSSIONS_DRAFT_STORAGE_KEY = "md3-platform.discussions.new-post-draft";
const DISCUSSIONS_DISPLAY_STORAGE_KEY = "personal-archive.discussions.display-mode";

type DiscussionDisplayMode = "titles" | "preview" | "expanded";
const displayModeOptions: Array<{ id: DiscussionDisplayMode; label: string }> = [
  { id: "titles", label: "Titles" },
  { id: "preview", label: "Preview" },
  { id: "expanded", label: "Expanded" }
];

const personalViewToneClasses: Partial<Record<ServiceDiscussionViewFilter, string>> = {
  all: "summary-coral",
  unread: "summary-aqua",
  pinned: "summary-yellow",
  decisions: "summary-lilac",
  attachments: "summary-sky",
  "needs-action": "summary-peach",
  resolved: "summary-sage"
};

type DiscussionComposerDraft = {
  title: string;
  body: string;
  caseId: string;
  ownerUserId: string;
  mentionedUserIds: string[];
};

function readComposerDraft(): DiscussionComposerDraft {
  try {
    const stored = JSON.parse(window.localStorage.getItem(DISCUSSIONS_DRAFT_STORAGE_KEY) || "{}") as Partial<DiscussionComposerDraft>;
    return {
      title: typeof stored.title === "string" ? stored.title : "",
      body: typeof stored.body === "string" ? stored.body : "",
      caseId: typeof stored.caseId === "string" ? stored.caseId : "",
      ownerUserId: typeof stored.ownerUserId === "string" ? stored.ownerUserId : "",
      mentionedUserIds: Array.isArray(stored.mentionedUserIds)
        ? stored.mentionedUserIds.filter((userId): userId is string => typeof userId === "string")
        : []
    };
  } catch {
    return { title: "", body: "", caseId: "", ownerUserId: "", mentionedUserIds: [] };
  }
}

function readDisplayMode(fallback: DiscussionDisplayMode): DiscussionDisplayMode {
  const stored = window.localStorage.getItem(DISCUSSIONS_DISPLAY_STORAGE_KEY);
  return stored === "titles" || stored === "preview" || stored === "expanded" ? stored : fallback;
}

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const toasts = useToastStore();
const { template, labels } = useBusinessTemplate();
useDismissibleMenus();
const { preferences: readingPreferences } = useReadingPreferences();
const markdownSourceEditorStyle = computed(() => ({
  backgroundColor: readingPreferences.backgroundColor,
  color: readingPreferences.textColor,
  fontFamily: "SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace",
  fontSize: `${Math.max(14, readingPreferences.fontSize - 1)}px`,
  lineHeight: readingPreferences.lineHeight
}));

const storedFilters = (() => {
  try {
    return JSON.parse(window.localStorage.getItem(DISCUSSIONS_FILTER_STORAGE_KEY) || "{}") as Partial<{
      view: ServiceDiscussionViewFilter;
      sort: ServiceDiscussionSortField;
      caseId: string;
    }>;
  } catch {
    return {};
  }
})();
const initialView =
  typeof route.query.view === "string" &&
  [
    "all",
    "my-attention",
    "unread",
    "mentions",
    "pinned",
    "decisions",
    "attachments",
    "unlinked",
    "needs-action",
    "resolved"
  ].includes(route.query.view)
    ? (route.query.view as ServiceDiscussionViewFilter)
    : storedFilters.view ?? "my-attention";

const filters = reactive({
  q: typeof route.query.q === "string" ? route.query.q : "",
  view: initialView as ServiceDiscussionViewFilter,
  sort: storedFilters.sort ?? "newest" as ServiceDiscussionSortField,
  caseId: storedFilters.caseId ?? ""
});
const readingSearchOpen = ref(Boolean(filters.q.trim()));
const readingSearchInput = ref<HTMLInputElement | null>(null);
const page = ref(1);
const pageSize = ref(25);
const displayMode = ref<DiscussionDisplayMode>(readDisplayMode(template.value.personalArchive ? "titles" : "preview"));
const readerMessage = ref<ServiceDiscussionMessage | null>(null);
const messagePage = ref<PaginatedResult<ServiceDiscussionMessage> | null>(null);
const discussionSummary = ref<ServiceDiscussionSummary | null>(null);
const loading = ref(false);
const busy = ref(false);
const formError = ref("");
const showComposer = ref(false);
const users = ref<PublicUser[]>([]);
const services = ref<CaseRecord[]>([]);
const assets = ref<ManagedAsset[]>([]);
const storedComposerDraft = readComposerDraft();
const composerTitle = ref(storedComposerDraft.title);
const composerBody = ref(storedComposerDraft.body);
const composerCaseId = ref(storedComposerDraft.caseId);
const composerThreadOwnerUserId = ref(storedComposerDraft.ownerUserId);
const composerMentionedUserIds = ref<string[]>(storedComposerDraft.mentionedUserIds);
const composerFiles = ref<File[]>([]);
const composerBodyInput = ref<{ focus: () => void } | null>(null);
const composerFileInput = ref<HTMLInputElement | null>(null);
type PendingInlineImage = { token: string; file: File };
const composerInlineImages = ref<PendingInlineImage[]>([]);
const replyTo = ref<ServiceDiscussionMessage | null>(null);
const replyBody = ref("");
const replyThreadOwnerUserId = ref("");
const replyMentionedUserIds = ref<string[]>([]);
const replyFiles = ref<File[]>([]);
const replyInlineImages = ref<PendingInlineImage[]>([]);
const expandedThreadIds = ref<Set<string>>(new Set());
const expandedPostIds = ref<Set<string>>(new Set());
const allowMultipleExpandedPosts = ref(false);
const recentlyPostedMessageId = ref<string | null>(null);
const editingMessageId = ref<string | null>(null);
const editingTitle = ref("");
const editingBody = ref("");
const editingSourceFormat = ref<"markdown" | "rich-text">("markdown");
const editingInlineImages = ref<PendingInlineImage[]>([]);
let loadTimer: ReturnType<typeof setTimeout> | null = null;

const messages = computed(() => messagePage.value?.items ?? []);
const visibleMessages = computed(() => messages.value.flatMap((message) => [message, ...threadReplies(message)]));
const collapsibleMessages = computed(() => messages.value.filter(postNeedsCollapse));
const hasCollapsedPosts = computed(() => collapsibleMessages.value.some((message) => !expandedPostIds.value.has(message.messageId)));
const hasExpandedPosts = computed(() => collapsibleMessages.value.some((message) => expandedPostIds.value.has(message.messageId)));
const totalMessages = computed(() => messagePage.value?.total ?? 0);
const totalPages = computed(() => messagePage.value?.totalPages ?? 1);
const canPostDiscussion = computed(() => auth.canAddNotes);
const { canManageContent, setManagementExpiry, managementLabel } = useArchiveContentManagement();
const hasComposerDraft = computed(() =>
  Boolean(
    composerBody.value.trim() ||
      composerTitle.value.trim() ||
      composerCaseId.value ||
      composerThreadOwnerUserId.value ||
      composerMentionedUserIds.value.length ||
      composerFiles.value.length
  )
);
const currentFilterPayload = computed(() => ({
  q: filters.q.trim(),
  view: filters.view,
  sort: filters.sort,
  caseId: filters.caseId || undefined
}));
const viewOptions = computed<Array<{ id: ServiceDiscussionViewFilter; label: string; helper: string }>>(() => {
  if (template.value.personalArchive) {
    return [
      { id: "all", label: "All notes", helper: "Every reading note and topic." },
      { id: "unread", label: "Unread", helper: "Notes you have not finished reading." },
      { id: "pinned", label: "Pinned", helper: "Important notes kept close at hand." },
      { id: "decisions", label: "Highlights", helper: "Passages or ideas marked as highlights." },
      { id: "attachments", label: "With files", helper: "Notes with books, documents, or images." },
      { id: "needs-action", label: "To do", helper: "Notes that need another pass or follow-up." },
      { id: "resolved", label: "Finished", helper: "Reading and notes you have completed." }
    ];
  }
  return [
    { id: "my-attention", label: "My attention", helper: "Unread, mentioned, or assigned threads that still need attention." },
    { id: "all", label: "All", helper: "Every internal discussion thread." },
    { id: "unread", label: "Unread", helper: "Messages not marked read by you." },
    { id: "mentions", label: "Mentions", helper: "Messages where you were mentioned." },
    { id: "pinned", label: "Pinned", helper: "Pinned operational context." },
    { id: "decisions", label: "Decisions", helper: "Messages marked as decisions." },
    { id: "attachments", label: "Attachments", helper: "Messages with files or screenshots." },
    { id: "unlinked", label: "Unlinked", helper: "Team-visible messages not tied to a service yet." },
    { id: "needs-action", label: "Needs action", helper: "Threads that require follow-up." },
    { id: "resolved", label: "Resolved", helper: "Threads already handled." }
  ];
});
const validDiscussionViews = computed(() => new Set(viewOptions.value.map((option) => option.id)));

const summaryTiles = computed(() => template.value.personalArchive
  ? [
      { label: "All notes", value: discussionSummary.value?.all ?? 0, view: "all" as ServiceDiscussionViewFilter, tone: "summary-coral" },
      { label: "Unread", value: discussionSummary.value?.unread ?? 0, view: "unread" as ServiceDiscussionViewFilter, tone: "summary-aqua" },
      { label: "Pinned", value: discussionSummary.value?.pinned ?? 0, view: "pinned" as ServiceDiscussionViewFilter, tone: "summary-yellow" },
      { label: "To do", value: discussionSummary.value?.needsAction ?? 0, view: "needs-action" as ServiceDiscussionViewFilter, tone: "summary-lilac" }
    ]
  : [
      { label: "My attention", value: discussionSummary.value?.myAttention ?? 0, view: "my-attention" as ServiceDiscussionViewFilter, tone: "bg-amber-50 text-amber-900 border-amber-100" },
      { label: "Unread", value: discussionSummary.value?.unread ?? 0, view: "unread" as ServiceDiscussionViewFilter, tone: "bg-blue-50 text-blue-900 border-blue-100" },
      { label: "Mentions", value: discussionSummary.value?.mentions ?? 0, view: "mentions" as ServiceDiscussionViewFilter, tone: "bg-indigo-50 text-indigo-900 border-indigo-100" },
      { label: "Needs action", value: discussionSummary.value?.needsAction ?? 0, view: "needs-action" as ServiceDiscussionViewFilter, tone: "bg-orange-50 text-orange-900 border-orange-100" }
    ]);

function personalViewTone(view: ServiceDiscussionViewFilter) {
  return personalViewToneClasses[view] ?? "";
}

async function toggleReadingSearch() {
  readingSearchOpen.value = !readingSearchOpen.value;
  if (!readingSearchOpen.value) return;
  await nextTick();
  readingSearchInput.value?.focus();
}

function clearReadingSearch() {
  filters.q = "";
  readingSearchOpen.value = false;
}

function serviceOptionLabel(service: CaseRecord) {
  return `${service.caseNumber} - ${service.propertyAddress || service.notes || service.status}`;
}

function discussionThreadStatusLabel(status: ServiceDiscussionThreadStatus) {
  if (status === "needs-action") return template.value.personalArchive ? "To do" : "Needs action";
  if (status === "resolved") return template.value.personalArchive ? "Finished" : "Resolved";
  if (status === "archived") return "Archived";
  return template.value.personalArchive ? "Active" : "Open";
}

function discussionThreadStatusClass(status: ServiceDiscussionThreadStatus) {
  if (status === "needs-action") return "bg-amber-100 text-amber-900";
  if (status === "resolved") return "bg-emerald-100 text-emerald-900";
  if (status === "archived") return "bg-ink-200 text-ink-700";
  return "bg-blue-50 text-blue-900";
}

function discussionActionTitle(message: ServiceDiscussionMessage) {
  return resolveDiscussionTitle(message.title, message.bodyText, "Follow up discussion");
}

function messageTitle(message: ServiceDiscussionMessage) {
  return resolveDiscussionTitle(message.title, message.bodyText, template.value.personalArchive ? "Untitled note" : "Untitled discussion");
}

function discussionLastActivity(message: ServiceDiscussionMessage) {
  return message.replyCount > 0
    ? `Last active ${formatDateTime(message.latestActivityAt ?? message.updatedAt)}`
    : `Posted ${formatDateTime(message.createdAt)}`;
}

function threadReplies(message: ServiceDiscussionMessage) {
  return message.replies ?? messages.value.filter((reply) => reply.parentMessageId === message.messageId);
}

function threadAssetLinks(message: ServiceDiscussionMessage) {
  const seen = new Set<string>();
  return [message, ...threadReplies(message)].flatMap((entry) => entry.assetLinks).filter((link) => {
    if (seen.has(link.assetId)) return false;
    seen.add(link.assetId);
    return true;
  });
}

function threadAttachmentCount(message: ServiceDiscussionMessage) {
  return [message, ...threadReplies(message)].reduce((total, entry) => total + entry.attachments.length, 0);
}

function isThreadExpanded(message: ServiceDiscussionMessage) {
  return expandedThreadIds.value.has(message.messageId);
}

function toggleThread(message: ServiceDiscussionMessage) {
  const next = new Set(expandedThreadIds.value);
  if (next.has(message.messageId)) next.delete(message.messageId);
  else next.add(message.messageId);
  expandedThreadIds.value = next;
}

function postNeedsCollapse(message: ServiceDiscussionMessage) {
  const nonEmptyLines = message.bodyText.split(/\r?\n/).filter((line) => line.trim()).length;
  return message.bodyText.length > 420 || nonEmptyLines > 8 || message.attachments.length > 0;
}

function isPostExpanded(message: ServiceDiscussionMessage) {
  if (displayMode.value === "expanded") return true;
  return !postNeedsCollapse(message) || expandedPostIds.value.has(message.messageId);
}

function discussionPostId(message: ServiceDiscussionMessage) {
  return `discussion-post-${message.messageId}`;
}

function discussionPostContentId(message: ServiceDiscussionMessage) {
  return `discussion-post-content-${message.messageId}`;
}

function interactionPostIds() {
  const protectedIds = new Set<string>();
  if (replyTo.value) protectedIds.add(rootMessageId(replyTo.value));
  if (editingMessageId.value) {
    const editingMessage = visibleMessages.value.find((message) => message.messageId === editingMessageId.value);
    if (editingMessage) protectedIds.add(rootMessageId(editingMessage));
  }
  return protectedIds;
}

function retainFocusedInteractionPosts() {
  if (allowMultipleExpandedPosts.value) return;
  const visibleIds = new Set(collapsibleMessages.value.map((message) => message.messageId));
  const protectedIds = interactionPostIds();
  expandedPostIds.value = new Set(
    [...expandedPostIds.value].filter((expandedId) => !visibleIds.has(expandedId) || protectedIds.has(expandedId))
  );
}

function expandPostId(messageId: string, scrollIntoView = true) {
  retainFocusedInteractionPosts();
  const next = new Set(expandedPostIds.value);
  next.add(messageId);
  expandedPostIds.value = next;

  if (scrollIntoView) {
    void nextTick().then(() => {
      document.getElementById(`discussion-post-${messageId}`)?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start"
      });
    });
  }
}

async function togglePost(message: ServiceDiscussionMessage) {
  const next = new Set(expandedPostIds.value);
  const isCollapsing = next.has(message.messageId);
  if (!isCollapsing) {
    expandPostId(message.messageId);
    return;
  }
  next.delete(message.messageId);
  expandedPostIds.value = next;

  await nextTick();
  document.getElementById(discussionPostId(message))?.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "start"
  });
}

function expandVisiblePosts() {
  allowMultipleExpandedPosts.value = true;
  expandedPostIds.value = new Set([
    ...expandedPostIds.value,
    ...messages.value.filter(postNeedsCollapse).map((message) => message.messageId)
  ]);
}

function collapseVisiblePosts() {
  allowMultipleExpandedPosts.value = false;
  const visibleIds = new Set(messages.value.map((message) => message.messageId));
  expandedPostIds.value = new Set([...expandedPostIds.value].filter((messageId) => !visibleIds.has(messageId)));
}

function messageMatchesQuery(message: ServiceDiscussionMessage) {
  const query = filters.q.trim().toLocaleLowerCase();
  if (!query) return false;
  return [
    message.messageId,
    message.title,
    message.bodyText,
    message.createdByName,
    message.threadOwnerUserName,
    message.caseNumber,
    message.caseTitle,
    ...message.mentions.map((mention) => mention.userName),
    ...message.attachments.map((attachment) => attachment.document.originalFileName)
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase()
    .includes(query);
}

function threadHasUnread(message: ServiceDiscussionMessage) {
  return [message, ...threadReplies(message)].some((entry) => entry.isUnread);
}

function replyMatchesActiveView(message: ServiceDiscussionMessage) {
  if (filters.view === "unread") return Boolean(message.isUnread);
  if (filters.view === "mentions") return message.mentions.some((mention) => mention.userId === auth.user?.userId);
  if (filters.view === "pinned") return message.isPinned;
  if (filters.view === "decisions") return message.messageType === "decision";
  if (filters.view === "attachments") return message.attachments.length > 0;
  if (filters.view === "my-attention") {
    return Boolean(
      message.isUnread ||
        message.mentions.some((mention) => mention.userId === auth.user?.userId)
    );
  }
  return false;
}

function discussionViewCount(view: ServiceDiscussionViewFilter) {
  const summary = discussionSummary.value;
  if (!summary) return null;
  if (view === "all") return summary.all;
  if (view === "my-attention") return summary.myAttention;
  if (view === "unread") return summary.unread;
  if (view === "mentions") return summary.mentions;
  if (view === "needs-action") return summary.needsAction;
  if (view === "resolved") return summary.resolved;
  if (view === "pinned") return summary.pinned;
  if (view === "decisions") return summary.decisions;
  if (view === "attachments") return summary.attachments;
  if (view === "unlinked") return summary.unlinked;
  return null;
}

function canEditDiscussionMessage(message: ServiceDiscussionMessage) {
  if (template.value.personalArchive) return auth.canAddNotes && canManageContent(message.managementOwnerUserId);
  return auth.canEditCases || message.createdBy === auth.user?.userId;
}

function canEditDiscussionThread(message: ServiceDiscussionMessage) {
  return template.value.personalArchive
    ? canEditDiscussionMessage(message) && (message.replies ?? []).every(canEditDiscussionMessage)
    : canPostDiscussion.value;
}

function canManageMessageFlags(message: ServiceDiscussionMessage) {
  return template.value.personalArchive ? canEditDiscussionMessage(message) : canPostDiscussion.value;
}

function rootMessageId(message: ServiceDiscussionMessage) {
  return message.parentMessageId ?? message.messageId;
}

function discussionAttachmentPreviewUrl(documentId: string) {
  return `/api/documents/${documentId}/preview`;
}

function isDiscussionImageAttachment(attachment: ServiceDiscussionAttachment) {
  return attachment.inlineImage || attachment.document.mimeType.toLowerCase().startsWith("image/") ||
    /\.(?:apng|avif|bmp|cur|dib|gif|heic|heif|ico|j2[ck]|jpe?g|jfif|jp2|jpx|jxl|pjp|pjpeg|png|svg|tiff?|webp)$/i.test(
      attachment.document.originalFileName || attachment.document.fileName
    );
}

function richTextHasContent(value: string) {
  if (/<img\b/i.test(value)) return true;
  const plain = value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .trim();
  return Boolean(plain);
}

function activeInlineImages(body: string, images: PendingInlineImage[]) {
  return images.filter((image) => body.includes(image.token));
}

function bodyWithPendingImages(body: string, images: PendingInlineImage[]) {
  if (!images.length) return body;
  const documentNode = new DOMParser().parseFromString(`<div id="rich-text-root">${body}</div>`, "text/html");
  const root = documentNode.getElementById("rich-text-root");
  if (!root) return body;
  for (const image of images) {
    const node = root.querySelector<HTMLElement>(`[data-inline-image-token="${image.token}"]`);
    if (!node) continue;
    const placeholder = documentNode.createElement("p");
    placeholder.dataset.inlineImageToken = image.token;
    const emphasis = documentNode.createElement("em");
    emphasis.textContent = `Uploading image: ${image.file.name}`;
    placeholder.appendChild(emphasis);
    node.replaceWith(placeholder);
  }
  return root.innerHTML;
}

function bodyWithUploadedImages(
  body: string,
  images: PendingInlineImage[],
  attachments: ServiceDiscussionAttachment[]
) {
  if (!images.length) return body;
  const documentNode = new DOMParser().parseFromString(`<div id="rich-text-root">${body}</div>`, "text/html");
  const root = documentNode.getElementById("rich-text-root");
  if (!root) return body;
  images.forEach((image, index) => {
    const node = root.querySelector<HTMLElement>(`[data-inline-image-token="${image.token}"]`);
    const attachment = attachments[index];
    if (!node || !attachment) return;
    const figure = documentNode.createElement("figure");
    const imageElement = documentNode.createElement("img");
    imageElement.src = discussionAttachmentPreviewUrl(attachment.documentId);
    imageElement.alt = image.file.name;
    const caption = documentNode.createElement("figcaption");
    caption.textContent = image.file.name;
    figure.appendChild(imageElement);
    figure.appendChild(caption);
    node.replaceWith(figure);
  });
  return root.innerHTML;
}

function containsLikelySecret(value: string) {
  return /BEGIN (RSA|OPENSSH|PRIVATE) KEY|password\s*[:=]|passwd\s*[:=]|secret\s*[:=]|api[_ -]?key\s*[:=]|token\s*[:=]/i.test(value);
}

function persistFilters() {
  window.localStorage.setItem(
    DISCUSSIONS_FILTER_STORAGE_KEY,
    JSON.stringify({ view: filters.view, sort: filters.sort, caseId: filters.caseId })
  );
}

async function loadMessages() {
  loading.value = true;
  try {
    const [messagesResult, summaryResult] = await Promise.all([
      client.discussionMessagesPage(currentFilterPayload.value, {
        page: page.value,
        pageSize: pageSize.value
      }),
      client.discussionSummary({
        q: filters.q.trim(),
        caseId: filters.caseId || undefined,
        sort: filters.sort
      })
    ]);
    messagePage.value = messagesResult;
    discussionSummary.value = summaryResult;
    const contextualThreads = messagesResult.items
      .filter((message) =>
        threadReplies(message).some((reply) => messageMatchesQuery(reply) || replyMatchesActiveView(reply))
      )
      .map((message) => message.messageId);
    expandedThreadIds.value = new Set([...expandedThreadIds.value, ...contextualThreads]);
    persistFilters();
    formError.value = "";
  } catch (error) {
    formError.value = error instanceof Error ? error.message : "Unable to load discussions";
  } finally {
    loading.value = false;
  }
}

function queueLoad(resetPage = true) {
  if (resetPage) page.value = 1;
  if (loadTimer) clearTimeout(loadTimer);
  loadTimer = setTimeout(() => void loadMessages(), 200);
}

async function loadLookups() {
  const [userRows, serviceRows, assetRows] = await Promise.all([
    client.users(),
    client.cases({ archiveStatus: "active", sort: "updated", direction: "desc" }),
    client.assets({ sort: "name", direction: "asc" })
  ]);
  users.value = userRows;
  services.value = serviceRows;
  assets.value = assetRows;
}

function appendFiles(files: File[]) {
  composerFiles.value = [...composerFiles.value, ...files];
}

function appendComposerInlineImage(payload: PendingInlineImage) {
  composerInlineImages.value = [...composerInlineImages.value, payload];
}

function appendReplyFiles(files: File[]) {
  replyFiles.value = [...replyFiles.value, ...files];
}

function appendReplyInlineImage(payload: PendingInlineImage) {
  replyInlineImages.value = [...replyInlineImages.value, payload];
}

function appendEditingInlineImage(payload: PendingInlineImage) {
  editingInlineImages.value = [...editingInlineImages.value, payload];
}

function onFileChange(event: Event) {
  appendFiles(Array.from((event.target as HTMLInputElement).files ?? []));
  if (composerFileInput.value) composerFileInput.value.value = "";
}

function onPaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files ?? []);
  if (!files.length) return;
  event.preventDefault();
  appendFiles(files);
}

function removePendingFile(index: number) {
  composerFiles.value = composerFiles.value.filter((_, itemIndex) => itemIndex !== index);
}

function removePendingReplyFile(index: number) {
  replyFiles.value = replyFiles.value.filter((_, itemIndex) => itemIndex !== index);
}

function persistComposerDraft() {
  if (!hasComposerDraft.value || (!composerTitle.value.trim() && !composerBody.value.trim() && !composerCaseId.value && !composerThreadOwnerUserId.value && !composerMentionedUserIds.value.length)) {
    window.localStorage.removeItem(DISCUSSIONS_DRAFT_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(
    DISCUSSIONS_DRAFT_STORAGE_KEY,
    JSON.stringify({
      title: composerTitle.value,
      body: composerBody.value,
      caseId: composerCaseId.value,
      ownerUserId: composerThreadOwnerUserId.value,
      mentionedUserIds: composerMentionedUserIds.value
    } satisfies DiscussionComposerDraft)
  );
}

function clearComposer() {
  composerTitle.value = "";
  composerBody.value = "";
  composerCaseId.value = "";
  composerThreadOwnerUserId.value = "";
  composerMentionedUserIds.value = [];
  composerFiles.value = [];
  composerInlineImages.value = [];
  window.localStorage.removeItem(DISCUSSIONS_DRAFT_STORAGE_KEY);
  if (composerFileInput.value) composerFileInput.value.value = "";
}

function clearReply() {
  replyTo.value = null;
  replyBody.value = "";
  replyThreadOwnerUserId.value = "";
  replyMentionedUserIds.value = [];
  replyFiles.value = [];
  replyInlineImages.value = [];
}

function cancelReply() {
  clearReply();
}

function closeComposer() {
  showComposer.value = false;
}

function discardComposerDraft() {
  if (hasComposerDraft.value && !window.confirm("Discard this discussion draft?")) return;
  clearComposer();
  showComposer.value = false;
}

async function openComposer() {
  if (!canPostDiscussion.value) return;
  clearReply();
  showComposer.value = true;
  await nextTick();
  composerBodyInput.value?.focus();
}

async function uploadFiles(messageId: string, files: File[], startIndex = 0) {
  const attachments: ServiceDiscussionAttachment[] = [];
  for (const [index, file] of files.entries()) {
    const form = new FormData();
    form.append("file", file);
    form.append("sortOrder", String(startIndex + index));
    form.append("notes", "Discussion attachment");
    attachments.push(await client.uploadServiceDiscussionAttachment(messageId, form));
  }
  return attachments;
}

async function submitDiscussion() {
  const isReply = Boolean(replyTo.value);
  const activeBody = isReply ? replyBody.value : composerBody.value;
  const activeFiles = isReply ? replyFiles.value : composerFiles.value;
  const inlineImages = activeInlineImages(activeBody, isReply ? replyInlineImages.value : composerInlineImages.value);
  const activeOwnerUserId = isReply ? replyThreadOwnerUserId.value : composerThreadOwnerUserId.value;
  const activeMentionedUserIds = isReply ? replyMentionedUserIds.value : composerMentionedUserIds.value;
  const body = richTextHasContent(activeBody) ? activeBody.trim() : activeFiles.length ? "<p>Attached file(s).</p>" : "";
  if (!body || busy.value || !canPostDiscussion.value) return;
  if (!isReply && template.value.personalArchive && !composerTitle.value.trim()) {
    formError.value = "Add a title before saving this note.";
    return;
  }
  if (containsLikelySecret(body)) {
    const confirmed = window.confirm(
      "This message looks like it may contain a password, token, or private key. Save real secrets in Credentials and reference them here instead. Continue posting this discussion message?"
    );
    if (!confirmed) return;
  }
  busy.value = true;
  formError.value = "";
  const files = [...activeFiles];
  try {
    const message = await client.createDiscussionMessage({
      title: isReply ? null : composerTitle.value.trim() || null,
      bodyText: bodyWithPendingImages(body, inlineImages),
      caseId: replyTo.value ? replyTo.value.caseId ?? null : composerCaseId.value || null,
      parentMessageId: replyTo.value ? rootMessageId(replyTo.value) : null,
      messageType: "message",
      threadOwnerUserId: activeOwnerUserId || null,
      isPinned: false,
      mentionedUserIds: activeMentionedUserIds
    });
    if (files.length) await uploadFiles(message.messageId, files);
    if (inlineImages.length) {
      const inlineAttachments = await uploadFiles(
        message.messageId,
        inlineImages.map((image) => image.file),
        files.length
      );
      await client.updateServiceDiscussionMessage(message.messageId, {
        bodyText: bodyWithUploadedImages(body, inlineImages, inlineAttachments)
      });
    }
    if (isReply) {
      clearReply();
    } else {
      expandPostId(message.messageId, false);
      recentlyPostedMessageId.value = message.messageId;
      clearComposer();
      showComposer.value = false;
      filters.view = "all";
      filters.sort = "newest";
      filters.caseId = message.caseId ?? "";
      page.value = 1;
    }
    await loadMessages();
    if (!isReply) {
      await nextTick();
      document.getElementById(discussionPostId(message))?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start"
      });
      window.setTimeout(() => {
        if (recentlyPostedMessageId.value === message.messageId) recentlyPostedMessageId.value = null;
      }, 2400);
    }
    toasts.success("Discussion posted", files.length ? "Message and attachments were added." : "Message was added.");
  } catch (error) {
    formError.value = error instanceof Error ? error.message : "Unable to post discussion";
    toasts.error("Unable to post discussion", formError.value);
  } finally {
    busy.value = false;
  }
}

function startReply(message: ServiceDiscussionMessage) {
  const root = message.parentMessageId
    ? messages.value.find((candidate) => candidate.messageId === message.parentMessageId) ?? message
    : message;
  replyTo.value = root;
  replyBody.value = "";
  replyThreadOwnerUserId.value = message.threadOwnerUserId ?? "";
  replyMentionedUserIds.value = [];
  replyFiles.value = [];
  showComposer.value = false;
  retainFocusedInteractionPosts();
  expandedThreadIds.value = new Set([...expandedThreadIds.value, rootMessageId(message)]);
}

function toggleNewDiscussion() {
  if (showComposer.value) closeComposer();
  else void openComposer();
}

function startEdit(message: ServiceDiscussionMessage) {
  if (!canEditDiscussionMessage(message)) return;
  editingMessageId.value = message.messageId;
  editingTitle.value = message.parentMessageId ? "" : messageTitle(message);
  editingBody.value = message.bodyText;
  editingSourceFormat.value = isRichTextHtml(message.bodyText) ? "rich-text" : "markdown";
  editingInlineImages.value = [];
  const rootId = rootMessageId(message);
  retainFocusedInteractionPosts();
  if (message.parentMessageId) expandedThreadIds.value = new Set([...expandedThreadIds.value, rootId]);
}

function cancelEdit() {
  editingMessageId.value = null;
  editingTitle.value = "";
  editingBody.value = "";
  editingSourceFormat.value = "markdown";
  editingInlineImages.value = [];
}

async function saveEdit(message: ServiceDiscussionMessage) {
  const body = editingBody.value.trim();
  if (!richTextHasContent(body) || (!message.parentMessageId && !editingTitle.value.trim()) || busy.value || !canEditDiscussionMessage(message)) return;
  busy.value = true;
  try {
    const inlineImages = activeInlineImages(body, editingInlineImages.value);
    await client.updateServiceDiscussionMessage(message.messageId, {
      title: message.parentMessageId ? undefined : editingTitle.value.trim(),
      bodyText: bodyWithPendingImages(body, inlineImages)
    });
    if (inlineImages.length) {
      const inlineAttachments = await uploadFiles(
        message.messageId,
        inlineImages.map((image) => image.file),
        message.attachments.length
      );
      await client.updateServiceDiscussionMessage(message.messageId, {
        bodyText: bodyWithUploadedImages(body, inlineImages, inlineAttachments)
      });
    }
    cancelEdit();
    await loadMessages();
    toasts.success("Discussion updated", "The message was saved.");
  } catch (error) {
    toasts.error("Unable to update discussion", error instanceof Error ? error.message : "Update failed");
  } finally {
    busy.value = false;
  }
}

async function togglePinned(message: ServiceDiscussionMessage) {
  if (!canManageMessageFlags(message) || busy.value) return;
  busy.value = true;
  try {
    await client.updateServiceDiscussionMessage(message.messageId, { isPinned: !message.isPinned });
    await loadMessages();
  } catch (error) {
    toasts.error("Unable to update pin", error instanceof Error ? error.message : "Pin update failed");
  } finally {
    busy.value = false;
  }
}

async function toggleDecision(message: ServiceDiscussionMessage) {
  if (!canManageMessageFlags(message) || busy.value) return;
  busy.value = true;
  try {
    await client.updateServiceDiscussionMessage(message.messageId, {
      messageType: message.messageType === "decision" ? "message" : "decision"
    });
    await loadMessages();
  } catch (error) {
    toasts.error("Unable to update decision", error instanceof Error ? error.message : "Decision update failed");
  } finally {
    busy.value = false;
  }
}

async function deleteMessage(message: ServiceDiscussionMessage) {
  if (!canEditDiscussionMessage(message) || busy.value) return;
  if (!window.confirm("Remove this discussion message? Attachments will remain in Documents.")) return;
  busy.value = true;
  try {
    await client.deleteServiceDiscussionMessage(message.messageId);
    await loadMessages();
    toasts.success("Discussion message removed", "The message was removed from the feed.");
  } catch (error) {
    toasts.error("Unable to remove message", error instanceof Error ? error.message : "Delete failed");
  } finally {
    busy.value = false;
  }
}

async function createKnowledge(message: ServiceDiscussionMessage) {
  if (!auth.canAddNotes || busy.value) return;
  busy.value = true;
  try {
    const knowledge = await client.createKnowledgeFromDiscussionMessage(message.messageId, { type: "Service lesson" });
    toasts.success("Knowledge created", `${knowledge.title} was added as a draft.`);
    void router.push(`/knowledge/${knowledge.knowledgeId}`);
  } catch (error) {
    toasts.error("Unable to create knowledge", error instanceof Error ? error.message : "Knowledge creation failed");
  } finally {
    busy.value = false;
  }
}

async function createRunbook(message: ServiceDiscussionMessage) {
  if (!auth.canAddNotes || busy.value) return;
  busy.value = true;
  try {
    const knowledge = await client.createKnowledgeFromDiscussionMessage(message.messageId, {
      type: "Runbook",
      summary: "Runbook draft promoted from service discussion."
    });
    toasts.success("Runbook draft created", `${knowledge.title} is ready in Knowledge.`);
    void router.push(`/knowledge/${knowledge.knowledgeId}`);
  } catch (error) {
    toasts.error("Unable to create runbook", error instanceof Error ? error.message : "Runbook creation failed");
  } finally {
    busy.value = false;
  }
}

async function createNote(message: ServiceDiscussionMessage) {
  if (!auth.canAddNotes || busy.value) return;
  if (!message.caseId) {
    toasts.error("Link service first", "Create a service note after this discussion thread is linked to a service.");
    return;
  }
  busy.value = true;
  try {
    await client.createNoteFromDiscussionMessage(message.messageId);
    toasts.success("Note created", "The discussion was copied into the service notes.");
  } catch (error) {
    toasts.error("Unable to create note", error instanceof Error ? error.message : "Note creation failed");
  } finally {
    busy.value = false;
  }
}

async function createTask(message: ServiceDiscussionMessage) {
  if (!auth.canCreateTasks || busy.value) return;
  if (!message.caseId) {
    toasts.error("Link service first", "Create a task after this discussion thread is linked to a service.");
    return;
  }
  busy.value = true;
  try {
    const task = await client.createTaskFromDiscussionMessage(message.messageId, {
      title: discussionActionTitle(message),
      priority: message.threadStatus === "needs-action" ? "High" : "Normal",
      dueDate: new Date().toISOString().slice(0, 10),
      assignedTo: message.threadOwnerUserId ?? auth.user?.userId ?? null
    });
    await client.updateServiceDiscussionMessage(message.messageId, {
      threadStatus: "needs-action",
      threadOwnerUserId: task.assignedTo ?? message.threadOwnerUserId ?? auth.user?.userId ?? null
    });
    await loadMessages();
    toasts.success("Task created", `${task.title} was added to ${message.caseNumber ?? "the linked service"}.`);
  } catch (error) {
    toasts.error("Unable to create task", error instanceof Error ? error.message : "Task creation failed");
  } finally {
    busy.value = false;
  }
}

async function updateThreadStatus(message: ServiceDiscussionMessage, status: ServiceDiscussionThreadStatus) {
  if (!canEditDiscussionThread(message) || busy.value || message.threadStatus === status) return;
  busy.value = true;
  try {
    await client.updateServiceDiscussionMessage(message.messageId, { threadStatus: status });
    await loadMessages();
    toasts.success("Discussion status updated", `Thread marked ${discussionThreadStatusLabel(status).toLowerCase()}.`);
  } catch (error) {
    toasts.error("Unable to update status", error instanceof Error ? error.message : "Status update failed");
  } finally {
    busy.value = false;
  }
}

async function updateThreadOwner(message: ServiceDiscussionMessage, userId: string) {
  if (!canEditDiscussionThread(message) || busy.value || (message.threadOwnerUserId ?? "") === userId) return;
  busy.value = true;
  try {
    await client.updateServiceDiscussionMessage(message.messageId, { threadOwnerUserId: userId || null });
    await loadMessages();
    const ownerName = users.value.find((user) => user.userId === userId)?.name ?? "Unassigned";
    toasts.success("Owner updated", `Thread owner set to ${ownerName}.`);
  } catch (error) {
    toasts.error("Unable to update owner", error instanceof Error ? error.message : "Owner update failed");
  } finally {
    busy.value = false;
  }
}

async function markRead(message: ServiceDiscussionMessage) {
  if (busy.value) return;
  busy.value = true;
  try {
    const unreadMessages = [message, ...threadReplies(message)].filter((entry) => entry.isUnread);
    await Promise.all(unreadMessages.map((entry) => client.markDiscussionMessageRead(entry.messageId)));
    await loadMessages();
  } catch (error) {
    toasts.error("Unable to mark read", error instanceof Error ? error.message : "Read receipt failed");
  } finally {
    busy.value = false;
  }
}

async function markVisibleRead() {
  busy.value = true;
  try {
    const result = await client.markDiscussionsRead(currentFilterPayload.value);
    await loadMessages();
    toasts.success("Discussions marked read", `${result.count} unread messages were updated.`);
  } catch (error) {
    toasts.error("Unable to mark discussions read", error instanceof Error ? error.message : "Read receipt failed");
  } finally {
    busy.value = false;
  }
}

function openService(caseId: string) {
  void router.push(workItemPath(caseId, "tab=discussion"));
}

function openAsset(assetId: string) {
  void router.push(`/managed-assets/${assetId}`);
}

function discussionReaderTitle(message: ServiceDiscussionMessage) {
  return messageTitle(message);
}

function openReader(message: ServiceDiscussionMessage) {
  readerMessage.value = message;
}

async function editReaderMessage() {
  const message = readerMessage.value;
  if (!message || !canEditDiscussionMessage(message)) return;
  readerMessage.value = null;
  startEdit(message);
  await nextTick();
  document.getElementById(discussionPostId(message))?.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "start"
  });
}

async function onDiscussionContextSaved() {
  await loadMessages();
  toasts.success("Linked context updated", "Service, assets, replies, and attachments are now aligned.");
}

function onDiscussionContextError(message: string) {
  toasts.error("Unable to update linked context", message);
}

watch(() => ({ ...filters }), () => queueLoad(true), { deep: true });
watch(page, () => void loadMessages());
watch(
  () => route.query.view,
  (value) => {
    if (typeof value === "string" && validDiscussionViews.value.has(value as ServiceDiscussionViewFilter)) {
      filters.view = value as ServiceDiscussionViewFilter;
    }
  }
);
watch(
  () => route.query.q,
  (value) => {
    filters.q = typeof value === "string" ? value : "";
  }
);
watch(
  [composerTitle, composerBody, composerCaseId, composerThreadOwnerUserId, composerMentionedUserIds],
  persistComposerDraft,
  { deep: true }
);
watch(displayMode, (mode) => window.localStorage.setItem(DISCUSSIONS_DISPLAY_STORAGE_KEY, mode));

onMounted(() => {
  void Promise.all([loadLookups(), loadMessages()]);
});
</script>

<template>
  <PageHeader
    :class="template.personalArchive ? 'reading-notes-header' : ''"
    :eyebrow="template.personalArchive ? '' : 'MD3 discussions'"
    :title="template.personalArchive ? 'Reading & Notes' : 'Discussions'"
    :description="template.personalArchive
      ? 'Notes, reading, and source files.'
      : 'Review messages that need attention, mentions, decisions, service context, and discussion attachments from one operational feed.'"
  >
    <div class="reading-notes-actions flex flex-wrap items-center gap-1.5">
      <ArchiveManagementAccess v-if="template.personalArchive && auth.user?.role === 'Admin'" @change="setManagementExpiry" />
      <DiscussionAppearanceMenu :compact="template.personalArchive" align="left" />
      <button
        v-if="template.personalArchive"
        class="btn-secondary h-8 px-2.5 text-xs"
        :class="readingSearchOpen || filters.q ? 'border-accent-300 bg-accent-50 text-accent-950' : ''"
        type="button"
        :aria-expanded="readingSearchOpen"
        aria-controls="reading-notes-search"
        @click="toggleReadingSearch"
      >
        <Search class="h-3.5 w-3.5" />
        Search
        <span v-if="filters.q" class="h-1.5 w-1.5 rounded-full bg-accent-700" aria-label="Search filter active" />
      </button>
      <details v-if="template.personalArchive" class="relative" data-dismissible-menu>
        <summary class="btn-secondary flex h-8 cursor-pointer list-none items-center px-2.5 text-xs">
          <SlidersHorizontal class="h-3.5 w-3.5" />
          View
        </summary>
        <div class="absolute right-0 z-30 mt-2 w-72 rounded-md border border-ink-200 bg-white p-3 text-left text-ink-900 shadow-xl">
          <label class="block text-xs font-semibold text-ink-600">
            Sort
            <select v-model="filters.sort" class="input mt-1 h-9 w-full py-1.5 text-xs">
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="recent">Recently active</option>
            </select>
          </label>
          <fieldset class="mt-3">
            <legend class="text-xs font-semibold text-ink-600">Layout</legend>
            <div class="mt-1 inline-flex h-9 w-full items-center rounded-md border border-ink-200 bg-ink-50 p-1" aria-label="Note display mode">
              <button
                v-for="mode in displayModeOptions"
                :key="mode.id"
                class="h-7 flex-1 rounded px-2 text-xs font-semibold transition"
                :class="displayMode === mode.id ? 'bg-white text-accent-950 shadow-sm' : 'text-ink-500 hover:text-ink-900'"
                type="button"
                :aria-pressed="displayMode === mode.id"
                @click="displayMode = mode.id"
              >{{ mode.label }}</button>
            </div>
          </fieldset>
          <div v-if="displayMode === 'preview'" class="mt-3 grid grid-cols-2 gap-2">
            <button class="btn-secondary h-8 px-2 text-xs" type="button" :disabled="!hasCollapsedPosts" @click="expandVisiblePosts">
              <ChevronsDown class="h-3.5 w-3.5" /> Expand
            </button>
            <button class="btn-secondary h-8 px-2 text-xs" type="button" :disabled="!hasExpandedPosts && !allowMultipleExpandedPosts" @click="collapseVisiblePosts">
              <ChevronsUp class="h-3.5 w-3.5" /> Collapse
            </button>
          </div>
          <button class="btn-secondary mt-3 h-9 w-full justify-center px-3 text-xs" type="button" :disabled="busy || !visibleMessages.some((message) => message.isUnread)" @click="markVisibleRead">
            <CheckSquare class="h-3.5 w-3.5" />
            Mark visible read
          </button>
        </div>
      </details>
      <button
        class="btn-secondary px-3"
        :class="template.personalArchive ? 'h-8 text-xs' : 'h-10'"
        type="button"
        :title="template.personalArchive ? 'Refresh notes' : undefined"
        :aria-label="template.personalArchive ? 'Refresh notes' : undefined"
        :disabled="loading"
        @click="loadMessages"
      >
        <RotateCcw :class="template.personalArchive ? 'h-3.5 w-3.5' : 'h-4 w-4'" />
        <span v-if="!template.personalArchive">Refresh</span>
      </button>
      <span
        v-if="hasComposerDraft && !showComposer"
        class="inline-flex items-center rounded-md bg-amber-50 px-3 text-xs font-semibold text-amber-900 ring-1 ring-amber-100"
        :class="template.personalArchive ? 'h-8' : 'h-10'"
      >
        Draft
      </span>
      <button
        class="px-3"
        :class="[showComposer ? 'btn-secondary' : 'btn-primary', template.personalArchive ? 'h-8 text-xs' : 'h-10']"
        type="button"
        :disabled="!canPostDiscussion"
        @click="toggleNewDiscussion"
      >
        <Plus v-if="!showComposer" :class="template.personalArchive ? 'h-3.5 w-3.5' : 'h-4 w-4'" />
        <X v-else :class="template.personalArchive ? 'h-3.5 w-3.5' : 'h-4 w-4'" />
        {{ showComposer ? "Close editor" : hasComposerDraft ? "Continue draft" : template.personalArchive ? "New topic" : "New post" }}
      </button>
    </div>
  </PageHeader>

  <section v-if="!template.personalArchive" class="reading-summary mb-4 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(10rem,1fr))]">
    <button
      v-for="tile in summaryTiles"
      :key="tile.label"
      class="reading-summary-item rounded-md border px-3 py-2 text-left transition hover:bg-white"
      :class="tile.tone"
      type="button"
      @click="filters.view = tile.view"
    >
      <span class="block text-xs font-semibold uppercase tracking-wide">{{ tile.label }}</span>
      <span class="mt-1 block text-xl font-semibold">{{ tile.value }}</span>
    </button>
  </section>

  <section v-if="showComposer" class="panel discussion-composer mb-4 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="flex items-start gap-3">
        <div class="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-accent-50 text-accent-900">
          <MessageSquare class="h-5 w-5" />
        </div>
        <div>
          <h2 class="font-semibold">{{ template.personalArchive ? "New note or topic" : "New post" }}</h2>
          <p class="mt-1 text-sm text-ink-500">{{ template.personalArchive ? "Capture a thought, start a reading note, or attach source material." : "Choose a service or leave it unlinked for team-wide context." }}</p>
        </div>
      </div>
      <button class="rounded-md p-2 text-ink-500 transition hover:bg-ink-50 hover:text-ink-900" type="button" title="Close editor" @click="closeComposer">
        <X class="h-4 w-4" />
      </button>
    </div>

    <div class="mt-3 grid gap-3" :class="template.personalArchive ? '' : 'lg:grid-cols-[minmax(0,1fr)_18rem]'">
      <div class="space-y-2">
        <input
          v-if="template.personalArchive"
          v-model="composerTitle"
          class="input h-11 text-base font-semibold"
          maxlength="200"
          placeholder="Title"
          :disabled="!canPostDiscussion || busy"
          aria-label="Note title"
        />
        <RichTextEditor
          ref="composerBodyInput"
          v-model="composerBody"
          :disabled="!canPostDiscussion || busy"
          :placeholder="template.personalArchive ? 'Write freely, format the page, or insert an image at the cursor…' : 'Share an update, decision, screenshot, or file.'"
          min-height="21rem"
          autofocus
          @insert-image="appendComposerInlineImage"
        />
      </div>
      <div v-if="!template.personalArchive" class="grid gap-2">
        <select v-model="composerCaseId" class="input" :disabled="!canPostDiscussion || busy">
          <option value="">Unlinked discussion</option>
          <option v-for="service in services" :key="service.caseId" :value="service.caseId">{{ serviceOptionLabel(service) }}</option>
        </select>
        <select v-model="composerThreadOwnerUserId" class="input" :disabled="!canPostDiscussion || busy">
          <option value="">No owner</option>
          <option v-for="user in users" :key="user.userId" :value="user.userId">Owner: {{ user.name }}</option>
        </select>
        <select v-model="composerMentionedUserIds" class="input h-24 py-2" multiple :disabled="!canPostDiscussion || busy">
          <option v-for="user in users" :key="user.userId" :value="user.userId">@{{ user.name }}</option>
        </select>
      </div>
    </div>

    <div v-if="composerFiles.length" class="mt-3 flex flex-wrap gap-2">
      <span
        v-for="(file, index) in composerFiles"
        :key="`${file.name}-${file.size}-${index}`"
        class="inline-flex max-w-full items-center gap-2 rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-700"
      >
        <Paperclip class="h-3.5 w-3.5 shrink-0 text-ink-400" />
        <span class="max-w-[220px] truncate">{{ file.name }}</span>
        <span class="shrink-0 text-ink-400">{{ formatFileSize(file.size) }}</span>
        <button class="rounded p-0.5 text-ink-400 hover:bg-ink-100 hover:text-ink-900" type="button" @click="removePendingFile(index)">
          <X class="h-3.5 w-3.5" />
        </button>
      </span>
    </div>

    <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <input ref="composerFileInput" class="hidden" type="file" multiple :disabled="!canPostDiscussion || !auth.canUpload || busy" @change="onFileChange" />
        <button class="btn-secondary h-9 px-3" type="button" :disabled="!canPostDiscussion || !auth.canUpload || busy" @click="composerFileInput?.click()">
          <Paperclip class="h-4 w-4" />
          Attach
        </button>
        <span class="text-xs text-ink-500">
          {{ template.personalArchive ? "Attach source files or reading material." : "Keep passwords in Credentials." }}
        </span>
      </div>
      <div class="flex flex-wrap items-center justify-end gap-2">
        <button v-if="hasComposerDraft" class="btn-secondary h-9 px-3 text-legal-red" type="button" :disabled="busy" @click="discardComposerDraft">
          <Trash2 class="h-4 w-4" />
          Discard draft
        </button>
        <button class="btn-secondary h-9 px-3" type="button" :disabled="busy" @click="closeComposer">Close</button>
        <button class="btn-primary h-9 px-3" type="button" :disabled="!canPostDiscussion || busy || (template.personalArchive && !composerTitle.trim()) || (!richTextHasContent(composerBody) && !composerFiles.length)" @click="submitDiscussion">
          <MessageSquare class="h-4 w-4" />
          {{ template.personalArchive ? "Save note" : "Post" }}
        </button>
      </div>
    </div>
    <p v-if="formError" class="mt-2 text-sm font-semibold text-legal-red">{{ formError }}</p>
  </section>

  <section v-if="template.personalArchive" class="reading-compact-controls mb-3">
    <label v-if="readingSearchOpen" id="reading-notes-search" class="reading-inline-search relative mb-2 block max-w-xl">
      <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      <input
        ref="readingSearchInput"
        v-model="filters.q"
        class="input h-9 pl-9 pr-9 text-sm"
        placeholder="Search notes, files, or authors..."
      />
      <button
        class="absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-ink-400 transition hover:bg-ink-50 hover:text-ink-900"
        type="button"
        title="Clear and close search"
        aria-label="Clear and close search"
        @click="clearReadingSearch"
      >
        <X class="h-3.5 w-3.5" />
      </button>
    </label>
    <div class="reading-filter-strip flex gap-1.5 overflow-x-auto pb-0.5">
      <button
        v-for="option in viewOptions"
        :key="option.id"
        class="reading-filter-chip shrink-0 rounded-md border px-2.5 py-1.5 text-left text-xs transition"
        :class="[personalViewTone(option.id), filters.view === option.id ? 'reading-filter-chip--active' : '']"
        type="button"
        :title="option.helper"
        :aria-pressed="filters.view === option.id"
        @click="filters.view = option.id"
      >
        <span class="font-semibold">{{ option.label }}</span>
        <span v-if="discussionViewCount(option.id) !== null" class="ml-1.5 tabular-nums opacity-70">{{ discussionViewCount(option.id) }}</span>
      </button>
    </div>
  </section>

  <section v-else class="panel discussion-filters mb-4 p-3">
    <div class="flex flex-col gap-2 lg:flex-row lg:items-center">
      <label class="relative block min-w-0 flex-1">
        <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input
          v-model="filters.q"
          class="input pl-9"
          placeholder="Search discussions, services, files, authors..."
        />
      </label>
      <select v-model="filters.caseId" class="input min-w-0">
        <option value="">Any service</option>
        <option v-for="service in services" :key="service.caseId" :value="service.caseId">{{ serviceOptionLabel(service) }}</option>
      </select>
      <select v-model="filters.sort" class="input min-w-0 lg:w-44">
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="recent">Recently active</option>
      </select>
      <button class="btn-secondary h-10 shrink-0 px-3" type="button" :disabled="busy || !visibleMessages.some((message) => message.isUnread)" @click="markVisibleRead">
        Mark visible read
      </button>
    </div>
    <div class="mt-3 flex flex-wrap items-end justify-between gap-2">
      <div class="flex flex-wrap gap-2">
        <button
          v-for="option in viewOptions"
          :key="option.id"
          class="rounded-md border px-3 py-2 text-left text-sm transition"
          :class="filters.view === option.id ? 'border-accent-700 bg-accent-50 text-accent-950' : 'border-ink-200 bg-white text-ink-700 hover:bg-ink-50'"
          type="button"
          :title="option.helper"
          @click="filters.view = option.id"
        >
          <span class="font-semibold">{{ option.label }}</span>
          <span v-if="discussionViewCount(option.id) !== null" class="ml-2 text-xs text-ink-500">{{ discussionViewCount(option.id) }}</span>
        </button>
      </div>
      <div class="flex shrink-0 items-center gap-1.5">
        <button
          class="btn-secondary h-9 px-3 text-xs"
          type="button"
          :aria-pressed="allowMultipleExpandedPosts"
          :disabled="!hasCollapsedPosts"
          title="Expand all visible posts and allow multiple posts to stay open"
          @click="expandVisiblePosts"
        >
          <ChevronsDown class="h-3.5 w-3.5" />
          Expand posts
        </button>
        <button
          class="btn-secondary h-9 px-3 text-xs"
          type="button"
          :disabled="!hasExpandedPosts && !allowMultipleExpandedPosts"
          title="Collapse visible posts and return to single-post mode"
          @click="collapseVisiblePosts"
        >
          <ChevronsUp class="h-3.5 w-3.5" />
          Collapse posts
        </button>
      </div>
    </div>
  </section>

  <section class="space-y-3">
    <div v-if="loading" class="panel p-8 text-center text-sm text-ink-500">{{ template.personalArchive ? "Loading notes…" : "Loading discussions..." }}</div>
    <div v-else-if="!messages.length" class="panel empty-reading-state p-8 text-center text-sm text-ink-500">{{ template.personalArchive ? "No notes or reading topics match this view." : "No discussion threads match this view." }}</div>
    <article
      v-for="message in messages"
      v-else
      :id="discussionPostId(message)"
      :key="message.messageId"
      class="scroll-mt-32 rounded-md border bg-white lg:scroll-mt-20"
      :class="[
        message.messageType === 'decision' ? 'border-emerald-200' : message.isPinned ? 'border-accent-200' : threadHasUnread(message) ? 'border-blue-200' : 'border-ink-200',
        recentlyPostedMessageId === message.messageId ? 'ring-2 ring-accent-300 ring-offset-2' : ''
      ]"
    >
      <button
        v-if="template.personalArchive && displayMode === 'titles' && editingMessageId !== message.messageId"
        class="group flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-ink-50/70"
        type="button"
        @click="openReader(message)"
      >
        <span v-if="threadHasUnread(message)" class="h-2 w-2 shrink-0 rounded-full bg-blue-500" title="Unread" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-semibold text-ink-950">{{ messageTitle(message) }}</span>
          <span class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-400">
            <span>{{ formatDateTime(message.createdAt) }}</span>
            <span v-if="message.isPinned" class="inline-flex items-center gap-1 text-accent-900"><Pin class="h-3 w-3" />Pinned</span>
            <span v-if="message.attachments.length" class="inline-flex items-center gap-1"><Paperclip class="h-3 w-3" />{{ message.attachments.length }}</span>
            <span v-if="message.replyCount">{{ message.replyCount }} replies</span>
          </span>
        </span>
        <ChevronRight class="h-4 w-4 shrink-0 text-ink-300 transition group-hover:translate-x-0.5 group-hover:text-accent-800" />
      </button>
      <div v-else class="p-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <div class="min-w-0 flex-1">
            <button class="block max-w-full truncate text-left text-lg font-semibold text-ink-950 transition hover:text-accent-900" type="button" @click="openReader(message)">
              {{ messageTitle(message) }}
            </button>
            <div class="mt-1 flex flex-wrap items-center gap-2">
              <strong class="text-sm text-ink-900">{{ message.createdByName }}</strong>
              <span v-if="template.personalArchive" class="text-xs text-ink-400">{{ managementLabel(message.managementOwnerUserId) }}</span>
              <span class="text-xs text-ink-400">{{ formatDateTime(message.createdAt) }}</span>
              <span class="text-xs text-ink-400">{{ discussionLastActivity(message) }}</span>
              <span v-if="threadHasUnread(message)" class="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-900">Unread</span>
              <span v-if="message.isPinned" class="inline-flex items-center gap-1 rounded-full bg-accent-50 px-2 py-0.5 text-xs font-semibold text-accent-900">
                <Pin class="h-3 w-3" /> Pinned
              </span>
              <span v-if="message.messageType === 'decision'" class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900">
                <CheckSquare class="h-3 w-3" /> Decision
              </span>
              <span class="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold" :class="discussionThreadStatusClass(message.threadStatus)">
                {{ discussionThreadStatusLabel(message.threadStatus) }}
              </span>
              <span v-for="mention in message.mentions" :key="mention.userId" class="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-900">
                @{{ mention.userName }}
              </span>
            </div>
          </div>
          <div class="grid w-full grid-cols-2 gap-1.5 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end">
            <select
              v-if="!template.personalArchive"
              class="input h-8 min-w-0 w-full py-1 text-xs sm:w-36"
              :value="message.threadOwnerUserId ?? ''"
              :disabled="!canEditDiscussionThread(message) || busy"
              title="Thread owner"
              @change="updateThreadOwner(message, ($event.target as HTMLSelectElement).value)"
            >
              <option value="">Unassigned</option>
              <option v-for="user in users" :key="user.userId" :value="user.userId">{{ user.name }}</option>
            </select>
            <select
              class="input h-8 min-w-0 w-full py-1 text-xs sm:w-32"
              :value="message.threadStatus"
              :disabled="!canEditDiscussionThread(message) || busy"
              title="Thread status"
              @change="updateThreadStatus(message, ($event.target as HTMLSelectElement).value as ServiceDiscussionThreadStatus)"
            >
              <option v-for="status in SERVICE_DISCUSSION_THREAD_STATUSES" :key="status" :value="status">{{ discussionThreadStatusLabel(status) }}</option>
            </select>
          </div>
        </div>

        <DiscussionLinkedContext
          v-if="!template.personalArchive"
          :message="message"
          :asset-links="threadAssetLinks(message)"
          :services="services"
          :assets="assets"
          :editable="canPostDiscussion && !busy"
          :thread-message-count="1 + threadReplies(message).length"
          :attachment-count="threadAttachmentCount(message)"
          @saved="onDiscussionContextSaved"
          @error="onDiscussionContextError"
          @open-service="openService"
          @open-asset="openAsset"
        />

        <div v-if="editingMessageId === message.messageId" class="mt-3 space-y-2">
          <p v-if="!canEditDiscussionMessage(message)" class="text-sm" role="status">Editing is paused. Restore management access to save these changes.</p>
          <DiscussionEditToolbar
            :label="editingSourceFormat === 'markdown' ? 'Editing Markdown source' : 'Editing rich text'"
            :busy="busy"
            :save-disabled="!canEditDiscussionMessage(message) || !editingTitle.trim() || !richTextHasContent(editingBody)"
            @cancel="cancelEdit"
            @save="saveEdit(message)"
          />
          <input
            v-if="!message.parentMessageId"
            v-model="editingTitle"
            class="input h-11 text-base font-semibold"
            maxlength="200"
            placeholder="Title"
            :disabled="busy || !canEditDiscussionMessage(message)"
            aria-label="Note title"
          />
          <AutoGrowTextarea
            v-if="editingSourceFormat === 'markdown'"
            v-model="editingBody"
            class="textarea min-h-96 whitespace-pre-wrap break-words"
            :style="markdownSourceEditorStyle"
            :disabled="busy || !canEditDiscussionMessage(message)"
            autofocus
            spellcheck="false"
          />
          <RichTextEditor v-else v-model="editingBody" :disabled="busy || !canEditDiscussionMessage(message)" min-height="24rem" auto-grow autofocus @insert-image="appendEditingInlineImage" />
        </div>
        <template v-else>
          <div
            v-if="displayMode === 'preview' && postNeedsCollapse(message)"
            class="-mx-1 mt-3 flex min-h-10 items-center justify-between gap-3 border-y border-ink-100 bg-white/95 px-2 py-1.5 backdrop-blur"
            :class="isPostExpanded(message) ? 'sticky top-[6.25rem] z-10 shadow-[0_6px_14px_rgba(37,37,26,0.06)] lg:top-0' : ''"
          >
            <span class="text-xs font-semibold uppercase text-ink-500">
              {{ isPostExpanded(message) ? "Full post" : "Post preview" }}
            </span>
            <button
              class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold text-accent-900 transition hover:bg-accent-50"
              type="button"
              :aria-controls="discussionPostContentId(message)"
              :aria-expanded="isPostExpanded(message)"
              @click="togglePost(message)"
            >
              <ChevronUp v-if="isPostExpanded(message)" class="h-3.5 w-3.5" />
              <ChevronDown v-else class="h-3.5 w-3.5" />
              {{ isPostExpanded(message) ? "Collapse post" : "Show full post" }}
              <span v-if="!isPostExpanded(message) && message.attachments.length" class="text-ink-500">
                · {{ message.attachments.length }} {{ message.attachments.length === 1 ? "attachment" : "attachments" }}
              </span>
            </button>
          </div>
          <MarkdownContent
            :id="discussionPostContentId(message)"
            class="mt-3 text-sm leading-6 text-ink-700"
            :collapsed="!isPostExpanded(message)"
            :source="message.bodyText"
          />
        </template>

        <div v-if="message.attachments.length && (isPostExpanded(message) || editingMessageId === message.messageId)" class="mt-3 grid gap-2 sm:grid-cols-2">
          <a
            v-for="attachment in message.attachments"
            :key="attachment.attachmentId"
            class="rounded-md border border-ink-200 bg-ink-50 p-2 text-sm transition hover:border-accent-200 hover:bg-accent-50"
            :href="discussionAttachmentPreviewUrl(attachment.documentId)"
            target="_blank"
            rel="noreferrer"
          >
            <img v-if="isDiscussionImageAttachment(attachment)" class="mb-2 aspect-video w-full rounded-md border border-ink-100 object-contain" :src="discussionAttachmentPreviewUrl(attachment.documentId)" :alt="attachment.document.originalFileName" />
            <span v-else class="mb-2 grid h-16 w-full place-items-center rounded-md border border-ink-100 bg-white text-ink-500"><FileText class="h-6 w-6" /></span>
            <span class="block truncate font-semibold text-ink-900">{{ attachment.document.originalFileName }}</span>
            <span class="mt-0.5 block text-xs text-ink-500">{{ formatFileSize(attachment.document.fileSize) }}</span>
          </a>
        </div>

        <div v-if="displayMode === 'preview' && editingMessageId !== message.messageId && postNeedsCollapse(message) && isPostExpanded(message)" class="mt-3 flex justify-end border-t border-ink-100 pt-2">
          <button
            class="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold text-ink-600 transition hover:bg-ink-50 hover:text-accent-900"
            type="button"
            :aria-controls="discussionPostContentId(message)"
            aria-expanded="true"
            @click="togglePost(message)"
          >
            <ChevronUp class="h-3.5 w-3.5" />
            Collapse and return to post
          </button>
        </div>

        <div class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-3">
          <div class="flex flex-wrap items-center gap-1.5">
            <button class="btn-secondary h-8 px-2.5 text-xs" type="button" @click="openReader(message)">
              <BookOpen class="h-3.5 w-3.5" /> Read
            </button>
            <DiscussionAppearanceMenu compact align="left" />
            <button class="btn-secondary h-8 px-2.5 text-xs" type="button" :disabled="!canPostDiscussion || busy" @click="startReply(message)">
              <Reply class="h-3.5 w-3.5" /> Reply
            </button>
            <button
              v-if="message.replyCount"
              class="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-xs font-semibold text-ink-600 transition hover:bg-ink-50"
              type="button"
              @click="toggleThread(message)"
            >
              <ChevronDown v-if="isThreadExpanded(message)" class="h-3.5 w-3.5" />
              <ChevronRight v-else class="h-3.5 w-3.5" />
              {{ isThreadExpanded(message) ? "Hide replies" : `${message.replyCount} replies` }}
            </button>
            <button v-if="threadHasUnread(message)" class="h-8 rounded-md px-2.5 text-xs font-semibold text-blue-800 hover:bg-blue-50" type="button" :disabled="busy" @click="markRead(message)">Mark thread read</button>
          </div>
          <details class="relative" data-dismissible-menu>
            <summary class="btn-secondary flex h-8 cursor-pointer list-none items-center px-2.5 text-xs">
              <MoreHorizontal class="h-4 w-4" /> More
            </summary>
            <div class="absolute right-0 z-20 mt-1 grid w-48 rounded-md border border-ink-200 bg-white p-1 shadow-lg">
              <button class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold hover:bg-ink-50" type="button" :disabled="!canManageMessageFlags(message) || busy" @click="togglePinned(message)"><PinOff v-if="message.isPinned" class="h-3.5 w-3.5" /><Pin v-else class="h-3.5 w-3.5" />{{ message.isPinned ? "Unpin" : "Pin" }}</button>
              <button class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold hover:bg-ink-50" type="button" :disabled="!canManageMessageFlags(message) || busy" @click="toggleDecision(message)"><CheckSquare class="h-3.5 w-3.5" />{{ message.messageType === "decision" ? "Mark as message" : "Mark as decision" }}</button>
              <button class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold hover:bg-ink-50" type="button" :disabled="!auth.canAddNotes || busy" @click="createKnowledge(message)"><BookOpen class="h-3.5 w-3.5" />Create knowledge</button>
              <button v-if="!template.personalArchive" class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold hover:bg-ink-50" type="button" :disabled="!auth.canAddNotes || busy" @click="createRunbook(message)"><BookOpen class="h-3.5 w-3.5" />Create runbook</button>
              <button v-if="!template.personalArchive" class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold hover:bg-ink-50" type="button" :disabled="!auth.canAddNotes || busy || !message.caseId" @click="createNote(message)"><FileText class="h-3.5 w-3.5" />Create note</button>
              <button v-if="!template.personalArchive" class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold hover:bg-ink-50" type="button" :disabled="!auth.canCreateTasks || busy || !message.caseId" @click="createTask(message)"><ListChecks class="h-3.5 w-3.5" />Create task</button>
              <button v-if="canEditDiscussionMessage(message)" class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold hover:bg-ink-50" type="button" :disabled="busy" @click="startEdit(message)"><Edit3 class="h-3.5 w-3.5" />Edit</button>
              <button v-if="canEditDiscussionMessage(message)" class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold text-red-700 hover:bg-red-50" type="button" :disabled="busy" @click="deleteMessage(message)"><Trash2 class="h-3.5 w-3.5" />Delete</button>
            </div>
          </details>
        </div>
      </div>

      <div v-if="displayMode !== 'titles' && message.replyCount && isThreadExpanded(message)" class="border-t border-ink-100 bg-ink-50/50 px-4 py-3">
        <div class="border-l-2 border-ink-200 pl-3 sm:pl-4">
          <div
            v-for="reply in threadReplies(message)"
            :key="reply.messageId"
            class="relative border-b border-ink-100 py-3 first:pt-0 last:border-b-0 last:pb-0"
            :class="messageMatchesQuery(reply) ? 'rounded-r-md bg-amber-50/70 pr-2' : ''"
          >
            <span class="absolute -left-[1.08rem] top-5 h-2 w-2 rounded-full border-2 border-white bg-ink-300 sm:-left-[1.33rem]" />
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div class="flex min-w-0 flex-wrap items-center gap-2">
                <strong class="text-sm text-ink-900">{{ reply.createdByName }}</strong>
                <span class="text-xs text-ink-400">{{ formatDateTime(reply.createdAt) }}</span>
                <span v-if="reply.editedAt" class="text-xs text-ink-400">edited</span>
                <span v-if="reply.isUnread" class="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-900">Unread</span>
                <span v-if="reply.messageType === 'decision'" class="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900">Decision</span>
                <span v-for="mention in reply.mentions" :key="mention.userId" class="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-900">@{{ mention.userName }}</span>
              </div>
              <details class="relative" data-dismissible-menu>
                <summary class="grid h-7 w-7 cursor-pointer list-none place-items-center rounded-md text-ink-500 hover:bg-white" title="Reply actions"><MoreHorizontal class="h-4 w-4" /></summary>
                <div class="absolute right-0 z-20 mt-1 grid w-44 rounded-md border border-ink-200 bg-white p-1 shadow-lg">
                  <button class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold hover:bg-ink-50" type="button" :disabled="!canPostDiscussion || busy" @click="startReply(reply)"><Reply class="h-3.5 w-3.5" />Reply in thread</button>
                  <button class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold hover:bg-ink-50" type="button" :disabled="!canManageMessageFlags(reply) || busy" @click="toggleDecision(reply)"><CheckSquare class="h-3.5 w-3.5" />{{ reply.messageType === "decision" ? "Mark as message" : "Mark as decision" }}</button>
                  <button class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold hover:bg-ink-50" type="button" :disabled="!auth.canAddNotes || busy" @click="createKnowledge(reply)"><BookOpen class="h-3.5 w-3.5" />Create knowledge</button>
                  <button v-if="!template.personalArchive" class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold hover:bg-ink-50" type="button" :disabled="!auth.canAddNotes || busy" @click="createRunbook(reply)"><BookOpen class="h-3.5 w-3.5" />Create runbook</button>
                  <button v-if="canEditDiscussionMessage(reply)" class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold hover:bg-ink-50" type="button" :disabled="busy" @click="startEdit(reply)"><Edit3 class="h-3.5 w-3.5" />Edit</button>
                  <button v-if="canEditDiscussionMessage(reply)" class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold text-red-700 hover:bg-red-50" type="button" :disabled="busy" @click="deleteMessage(reply)"><Trash2 class="h-3.5 w-3.5" />Delete</button>
                </div>
              </details>
            </div>
            <div v-if="editingMessageId === reply.messageId" class="mt-2 space-y-2">
              <DiscussionEditToolbar :label="editingSourceFormat === 'markdown' ? 'Editing Markdown reply' : 'Editing rich text reply'" :busy="busy" :save-disabled="!canEditDiscussionMessage(reply) || !richTextHasContent(editingBody)" @cancel="cancelEdit" @save="saveEdit(reply)" />
              <AutoGrowTextarea
                v-if="editingSourceFormat === 'markdown'"
                v-model="editingBody"
                class="textarea min-h-72 whitespace-pre-wrap break-words"
                :style="markdownSourceEditorStyle"
                :disabled="busy || !canEditDiscussionMessage(reply)"
                autofocus
                spellcheck="false"
              />
              <RichTextEditor v-else v-model="editingBody" :disabled="busy || !canEditDiscussionMessage(reply)" min-height="18rem" auto-grow compact autofocus @insert-image="appendEditingInlineImage" />
            </div>
            <MarkdownContent v-else class="mt-2 text-sm leading-6 text-ink-700" :source="reply.bodyText" />
            <div v-if="reply.attachments.length" class="mt-2 grid gap-2 sm:grid-cols-2">
              <a v-for="attachment in reply.attachments" :key="attachment.attachmentId" class="rounded-md border border-ink-200 bg-white p-2 text-sm hover:border-accent-200" :href="discussionAttachmentPreviewUrl(attachment.documentId)" target="_blank" rel="noreferrer">
                <img v-if="isDiscussionImageAttachment(attachment)" class="mb-2 aspect-video w-full rounded-md border border-ink-100 object-contain" :src="discussionAttachmentPreviewUrl(attachment.documentId)" :alt="attachment.document.originalFileName" />
                <span class="block truncate font-semibold text-ink-900">{{ attachment.document.originalFileName }}</span>
                <span class="text-xs text-ink-500">{{ formatFileSize(attachment.document.fileSize) }}</span>
              </a>
            </div>
          </div>
        </div>
      </div>

      <DiscussionReplyComposer
        v-if="displayMode !== 'titles' && replyTo && rootMessageId(replyTo) === message.messageId"
        v-model="replyBody"
        v-model:owner-user-id="replyThreadOwnerUserId"
        v-model:mentioned-user-ids="replyMentionedUserIds"
        class="border-t border-ink-100 px-4 pb-4"
        :parent="message"
        :files="replyFiles"
        :users="users"
        :disabled="!canPostDiscussion"
        :can-upload="auth.canUpload"
        :busy="busy"
        @add-files="appendReplyFiles"
        @insert-image="appendReplyInlineImage"
        @remove-file="removePendingReplyFile"
        @submit="submitDiscussion"
        @cancel="cancelReply"
      />
    </article>
  </section>

  <div class="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-ink-500">
    <span>Page {{ messagePage?.page ?? page }} of {{ totalPages }} · {{ totalMessages }} {{ template.personalArchive ? "notes" : "threads" }}</span>
    <div class="flex gap-2">
      <button class="btn-secondary h-9 px-3" type="button" :disabled="page <= 1 || loading" @click="page--">Previous</button>
      <button class="btn-secondary h-9 px-3" type="button" :disabled="page >= totalPages || loading" @click="page++">Next</button>
    </div>
  </div>
  <MarkdownReaderDialog
    :model-value="Boolean(readerMessage)"
    :source="readerMessage?.bodyText ?? ''"
    :title="readerMessage ? discussionReaderTitle(readerMessage) : 'Topic note'"
    :editable="Boolean(readerMessage && canEditDiscussionMessage(readerMessage))"
    @edit="editReaderMessage"
    @update:model-value="(value) => { if (!value) readerMessage = null; }"
  />
</template>
