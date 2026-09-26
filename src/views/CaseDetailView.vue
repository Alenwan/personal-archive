<script setup lang="ts">
import {
  AlertTriangle,
  Archive,
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  ChevronUp,
  CheckCircle2,
  CheckSquare,
  CloudUpload,
  Edit3,
  Eye,
  FileUp,
  FileText,
  FolderCheck,
  FolderOpen,
  FolderX,
  HardDrive,
  KeyRound,
  Link2,
  ListChecks,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Pin,
  PinOff,
  Plus,
  Reply,
  RotateCcw,
  Save,
  Trash2,
  UserCheck,
  UserPlus,
  X
} from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { client } from "../api/client";
import { caseTypeDisplayName, filterCaseTypeTemplates, useBusinessTemplate, workItemPath } from "../businessTemplate";
import { useDismissibleMenus } from "../composables/useDismissibleMenus";
import Breadcrumbs from "../components/Breadcrumbs.vue";
import CommunicationHistoryPanel from "../components/communications/CommunicationHistoryPanel.vue";
import DiscussionAppearanceMenu from "../components/discussion/DiscussionAppearanceMenu.vue";
import DiscussionEditToolbar from "../components/discussion/DiscussionEditToolbar.vue";
import DiscussionLinkedContext from "../components/discussion/DiscussionLinkedContext.vue";
import DiscussionReplyComposer from "../components/discussion/DiscussionReplyComposer.vue";
import MarkdownContent from "../components/discussion/MarkdownContent.vue";
import AutoGrowTextarea from "../components/editor/AutoGrowTextarea.vue";
import DocumentDetailDrawer from "../components/documents/DocumentDetailDrawer.vue";
import MarkdownReaderDialog from "../components/reading/MarkdownReaderDialog.vue";
import PageHeader from "../components/PageHeader.vue";
import ContactCard from "../components/relationships/ContactCard.vue";
import ContactFormModal from "../components/relationships/ContactFormModal.vue";
import ContactRelationshipDrawer from "../components/relationships/ContactRelationshipDrawer.vue";
import StatusBadge from "../components/StatusBadge.vue";
import TagChip from "../components/TagChip.vue";
import { useI18n } from "../i18n";
import { useReadingPreferences } from "../readingPreferences";
import { resolveDiscussionTitle } from "../shared/discussionTitle";
import {
  contactDisplayName,
  dateOnlyString,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatFileSize,
  localDateInputValue
} from "../shared/format";
import {
  CASE_STATUSES,
  PROPERTY_TYPES,
  SERVICE_DISCUSSION_THREAD_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type AssetDocumentLink,
  type CaseContact,
  type CaseInput,
  type CaseReadiness,
  type CaseRecord,
  type CaseTimelineEvent,
  type CaseTimelineEventType,
  type CaseTypeTemplate,
  type CloseCaseResult,
  type CommunicationRecord,
  type CommunicationStatus,
  type Contact,
  type ContactInput,
  type ContactRole,
  type DocumentCategory,
  type DocumentRecord,
  type DocumentReviewStatus,
  type DocumentUpdateInput,
  type KnowledgeItem,
  type ManagedAsset,
  type PartyOrganization,
  type PublicUser,
  type ServiceDiscussionMessage,
  type ServiceDiscussionAttachment,
  type ServiceDiscussionMessageType,
  type ServiceDiscussionThreadStatus,
  type Tag,
  type TaskInput,
  type TaskRecord
} from "../shared/types";
import { useAuthStore } from "../stores/auth";
import { useToastStore } from "../stores/toasts";

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

const COMMUNICATION_DRAFT_STORAGE_PREFIX = "md3-platform.communication-draft.";
const DISCUSSION_SORT_STORAGE_KEY = "md3-platform.discussion-sort-order";
const DISCUSSION_DRAFT_STORAGE_PREFIX = "md3-platform.service-discussion-draft.";
type DiscussionSortOrder = "newest" | "oldest";
type ServiceDiscussionDraft = {
  body: string;
  ownerUserId: string;
  mentionedUserIds: string[];
};

function readServiceDiscussionDraft(serviceId: string): ServiceDiscussionDraft {
  try {
    const stored = JSON.parse(window.localStorage.getItem(`${DISCUSSION_DRAFT_STORAGE_PREFIX}${serviceId}`) || "{}") as Partial<ServiceDiscussionDraft>;
    return {
      body: typeof stored.body === "string" ? stored.body : "",
      ownerUserId: typeof stored.ownerUserId === "string" ? stored.ownerUserId : "",
      mentionedUserIds: Array.isArray(stored.mentionedUserIds)
        ? stored.mentionedUserIds.filter((userId): userId is string => typeof userId === "string")
        : []
    };
  } catch {
    return { body: "", ownerUserId: "", mentionedUserIds: [] };
  }
}

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const toasts = useToastStore();
const { t } = useI18n();
const { template, labels } = useBusinessTemplate();
useDismissibleMenus();
const { preferences: readingPreferences, fontFamily: readingFontFamily } = useReadingPreferences();
const discussionPlainEditorStyle = computed(() => ({
  backgroundColor: readingPreferences.backgroundColor,
  color: readingPreferences.textColor,
  fontFamily: readingFontFamily.value,
  fontSize: `${readingPreferences.fontSize}px`,
  lineHeight: readingPreferences.lineHeight
}));
const defaultContactRole = () => template.value.contactRoleOptions[0] ?? "Other";
const caseId = computed(() => String(route.params.id));
const activeTab = ref("overview");
const caseRecord = ref<CaseRecord | null>(null);
const caseTypes = ref<CaseTypeTemplate[]>([]);
const caseContacts = ref<CaseContact[]>([]);
const allContacts = ref<Contact[]>([]);
const partyOrganizations = ref<PartyOrganization[]>([]);
const documents = ref<DocumentRecord[]>([]);
const relatedKnowledge = ref<KnowledgeItem[]>([]);
const discussionMessages = ref<ServiceDiscussionMessage[]>([]);
const discussionReaderMessage = ref<ServiceDiscussionMessage | null>(null);
const caseAssets = ref<ManagedAsset[]>([]);
const caseAssetDocuments = ref<Record<string, AssetDocumentLink[]>>({});
const readiness = ref<CaseReadiness | null>(null);
const timelineEvents = ref<CaseTimelineEvent[]>([]);
const communications = ref<CommunicationRecord[]>([]);
const timelineFilter = ref<CaseTimelineEventType | "all">("all");
const tasks = ref<TaskRecord[]>([]);
const tags = ref<Tag[]>([]);
const users = ref<PublicUser[]>([]);
const documentCategory = ref("");
const selectedFile = ref<File | null>(null);
const uploadFileInput = ref<HTMLInputElement | null>(null);
const uploadCategory = ref<DocumentCategory>((template.value.documentCategories[0] ?? "Other") as DocumentCategory);
const uploadNotes = ref("");
const selectedUploadTagIds = ref<string[]>([]);
const isUploadDragging = ref(false);
const newNote = ref("");
const busy = ref(false);
const formError = ref("");
const showEditCase = ref(false);
const showContactDetail = ref(false);
const showNewContact = ref(false);
const showDocumentDetail = ref(false);
const showCloseCase = ref(false);
const showArchiveCase = ref(false);
const showRestoreCase = ref(false);
const selectedContact = ref<Contact | null>(null);
const selectedDocument = ref<DocumentRecord | null>(null);
const documentVersions = ref<DocumentRecord[]>([]);
const selectedTagIds = ref<string[]>([]);
const salePriceDollars = ref("");
const selectedContactId = ref("");
const selectedContactRole = ref<ContactRole>(defaultContactRole());
const contactFormError = ref("");
const creatingContact = ref(false);
const documentFormError = ref("");
const savingDocument = ref(false);
const documentVersionError = ref("");
const uploadingDocumentVersion = ref(false);
const closingCase = ref(false);
const archivingCase = ref(false);
const restoringCase = ref(false);
const closeForce = ref(false);
const closeReason = ref("");
const closeError = ref("");
const closeAttempt = ref<CloseCaseResult | null>(null);
const archiveReason = ref("");
const archiveError = ref("");
const restoreReason = ref("");
const restoreError = ref("");
const communicationError = ref("");
const initialDiscussionDraft = readServiceDiscussionDraft(caseId.value);
const discussionBody = ref(initialDiscussionDraft.body);
const discussionReplyToId = ref<string | null>(null);
const discussionFiles = ref<File[]>([]);
const discussionThreadOwnerUserId = ref(initialDiscussionDraft.ownerUserId);
const discussionMentionedUserIds = ref<string[]>(initialDiscussionDraft.mentionedUserIds);
const discussionBodyInput = ref<HTMLTextAreaElement | null>(null);
const discussionFileInput = ref<HTMLInputElement | null>(null);
const discussionReplyBody = ref("");
const discussionReplyFiles = ref<File[]>([]);
const discussionReplyThreadOwnerUserId = ref("");
const discussionReplyMentionedUserIds = ref<string[]>([]);
const discussionBusy = ref(false);
const discussionError = ref("");
const editingDiscussionId = ref<string | null>(null);
const editingDiscussionBody = ref("");
const discussionAttachmentAssetTargets = reactive<Record<string, string>>({});
const expandedDiscussionReplyIds = ref<Set<string>>(new Set());
const expandedDiscussionPostIds = ref<Set<string>>(new Set());
const allowMultipleExpandedDiscussionPosts = ref(false);
const showDiscussionComposer = ref(false);
const recentlyPostedDiscussionMessageId = ref<string | null>(null);
const showServiceBriefing = ref(false);
const discussionDraftCaseId = ref(caseId.value);
const storedDiscussionSortOrder = window.localStorage.getItem(DISCUSSION_SORT_STORAGE_KEY);
const discussionSortOrder = ref<DiscussionSortOrder>(storedDiscussionSortOrder === "oldest" ? "oldest" : "newest");

function discussionReaderTitle(message: ServiceDiscussionMessage) {
  return resolveDiscussionTitle(message.title, message.bodyText, "Service discussion");
}
let discussionPollTimer: number | undefined;

const editForm = reactive<CaseInput>({
  caseNumber: "",
  caseTypeCode: "residential_purchase",
  customerOrganizationId: null,
  propertyAddress: "",
  city: "",
  state: "NY",
  zipCode: "",
  propertyType: "Condo",
  salePriceCents: 0,
  status: "New",
  closingDate: "",
  notes: "",
  tagIds: []
});

const taskForm = reactive<TaskInput>({
  title: "",
  description: "",
  priority: "Normal",
  dueDate: localDateInputValue(),
  assignedTo: null
});

const tabs = computed(() => [
  { id: "overview", label: t("overview") },
  { id: "contacts", label: t("parties") },
  { id: "assets", label: t("assets") },
  { id: "communications", label: "Communications" },
  { id: "discussion", label: "Discussion" },
  { id: "documents", label: t("documents") },
  { id: "timeline", label: `${t("notes")} / Timeline` },
  { id: "tasks", label: "Tasks / Checklist" }
]);

const availableCaseTypes = computed(() => filterCaseTypeTemplates(template.value, caseTypes.value));
const availableContactRoles = computed(() => template.value.contactRoleOptions);
const selectedTags = computed(() => tags.value.filter((tag) => selectedTagIds.value.includes(tag.tagId)));
const activeTabLabel = computed(() => tabs.value.find((tab) => tab.id === activeTab.value)?.label ?? "Overview");
const recordTitle = computed(() => caseRecord.value?.propertyAddress || caseRecord.value?.caseNumber || labels.value.singular);
const recordTypeName = computed(() =>
  caseRecord.value
    ? caseTypeDisplayName(caseRecord.value.caseTypeCode, caseTypes.value, caseRecord.value.caseTypeName || caseRecord.value.propertyType)
    : ""
);
const recordLocationLine = computed(() =>
  [caseRecord.value?.city, [caseRecord.value?.state, caseRecord.value?.zipCode].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ")
);
const breadcrumbs = computed(() => {
  if (!caseRecord.value) return [{ label: labels.value.plural, to: workItemPath() }, { label: labels.value.singular, current: true }];
  return [
    { label: labels.value.plural, to: workItemPath() },
    {
      label: caseRecord.value.caseNumber,
      to: activeTab.value === "overview" ? undefined : workItemPath(caseRecord.value.caseId),
      current: activeTab.value === "overview"
    },
    ...(activeTab.value === "overview" ? [] : [{ label: activeTabLabel.value, current: true }])
  ];
});
const contactDrawerBreadcrumbs = computed(() => [
  { label: labels.value.plural, to: workItemPath() },
  { label: caseRecord.value?.caseNumber ?? labels.value.singular, to: caseRecord.value ? workItemPath(caseRecord.value.caseId) : undefined },
  { label: activeTabLabel.value, current: !selectedContact.value },
  ...(selectedContact.value
    ? [{ label: contactDisplayName(selectedContact.value), current: true }]
    : [])
]);
const documentCategoryCards = computed(() => readiness.value?.documentCategories ?? []);
const availableDocumentCategories = computed(() => {
  const categories = [
    ...template.value.documentCategories,
    ...documentCategoryCards.value.map((category) => category.category)
  ] as DocumentCategory[];
  return [...new Set(categories)];
});
const documentTotalCount = computed(() =>
  documentCategoryCards.value.reduce((total, category) => total + category.count, 0)
);
const selectedUploadFileSize = computed(() => selectedFile.value ? formatFileSize(selectedFile.value.size) : "");
const requiredCategoryRows = computed(() =>
  readiness.value
    ? readiness.value.requiredDocumentCategories.map((category) => ({
        category,
        complete: readiness.value?.presentDocumentCategories.includes(category) ?? false
      }))
    : []
);
const readinessOpenTaskCount = computed(() => readiness.value?.openTasks.length ?? 0);
const readinessMissingDocumentCount = computed(() => readiness.value?.missingDocumentCategories.length ?? 0);
const currentCaseType = computed(() =>
  caseTypes.value.find((caseType) => caseType.code === caseRecord.value?.caseTypeCode)
);
const selectedEditCaseType = computed(() => availableCaseTypes.value.find((caseType) => caseType.code === editForm.caseTypeCode));

watch(availableContactRoles, (roles) => {
  if (!roles.includes(selectedContactRole.value)) selectedContactRole.value = roles[0] ?? "Other";
});
watch(availableDocumentCategories, (categories) => {
  if (!categories.includes(uploadCategory.value)) uploadCategory.value = categories[0] ?? "Other";
  if (documentCategory.value && !categories.includes(documentCategory.value as DocumentCategory)) documentCategory.value = "";
});
const timelineFilterOptions = computed(() => [
  { value: "all" as const, label: "All activity", count: timelineEvents.value.length },
  { value: "note" as const, label: "Notes", count: timelineEvents.value.filter((event) => event.type === "note").length },
  { value: "communication" as const, label: "Communications", count: timelineEvents.value.filter((event) => event.type === "communication").length },
  { value: "case" as const, label: labels.value.singular, count: timelineEvents.value.filter((event) => event.type === "case").length },
  { value: "document" as const, label: "Documents", count: timelineEvents.value.filter((event) => event.type === "document").length },
  { value: "task" as const, label: "Tasks", count: timelineEvents.value.filter((event) => event.type === "task").length },
  { value: "party" as const, label: "Parties", count: timelineEvents.value.filter((event) => event.type === "party").length },
  { value: "asset" as const, label: "Assets", count: timelineEvents.value.filter((event) => event.type === "asset").length },
  { value: "credential" as const, label: "Credentials", count: timelineEvents.value.filter((event) => event.type === "credential").length }
]);
const filteredTimelineEvents = computed(() =>
  timelineFilter.value === "all"
    ? timelineEvents.value
    : timelineEvents.value.filter((event) => event.type === timelineFilter.value)
);
const closeBlockers = computed(() => {
  if (!readiness.value) return [];
  return [
    ...readiness.value.missingDocumentCategories.map((category) => `Missing required document category: ${category}`),
    ...readiness.value.openTasks.map((task) => `Open task: ${task.title}`)
  ];
});
const closeHasBlockers = computed(() => closeBlockers.value.length > 0);
const closeRequiresReason = computed(() => closeHasBlockers.value && closeForce.value);
const caseIsArchived = computed(() => Boolean(caseRecord.value?.deletedAt));
const canSubmitClose = computed(() => {
  if (!auth.canEditCases || closingCase.value || caseRecord.value?.status === "Closed" || caseIsArchived.value) return false;
  if (!closeHasBlockers.value) return true;
  return closeForce.value && closeReason.value.trim().length >= 8;
});
const canSubmitArchive = computed(() => auth.canArchiveCases && !archivingCase.value && Boolean(caseRecord.value) && !caseIsArchived.value);
const canSubmitRestore = computed(() => auth.canArchiveCases && !restoringCase.value && Boolean(caseRecord.value) && caseIsArchived.value);
const editableCaseStatuses = computed(() =>
  CASE_STATUSES.filter((status) => status !== "Closed" || caseRecord.value?.status === "Closed")
);
const canPostDiscussion = computed(() => auth.canAddNotes && !caseIsArchived.value);
const hasDiscussionComposerDraft = computed(() =>
  Boolean(
    discussionBody.value.trim() ||
      discussionThreadOwnerUserId.value ||
      discussionMentionedUserIds.value.length ||
      discussionFiles.value.length
  )
);
const topLevelDiscussionMessages = computed(() =>
  discussionMessages.value
    .filter((message) => !message.parentMessageId)
    .sort(
      (a, b) =>
        Number(b.isPinned) - Number(a.isPinned) ||
        (discussionSortOrder.value === "newest" ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt))
    )
);
const collapsibleDiscussionMessages = computed(() => topLevelDiscussionMessages.value.filter(discussionPostNeedsCollapse));
const hasCollapsedDiscussionPosts = computed(() =>
  collapsibleDiscussionMessages.value.some((message) => !expandedDiscussionPostIds.value.has(message.messageId))
);
const hasExpandedDiscussionPosts = computed(() =>
  collapsibleDiscussionMessages.value.some((message) => expandedDiscussionPostIds.value.has(message.messageId))
);
const pinnedDiscussionMessages = computed(() =>
  discussionMessages.value
    .filter((message) => message.isPinned)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
);
const discussionDecisionMessages = computed(() =>
  discussionMessages.value
    .filter((message) => message.messageType === "decision")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
);
const discussionAttachments = computed(() =>
  discussionMessages.value
    .flatMap((message) => message.attachments.map((attachment) => ({ ...attachment, message })))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
);
const discussionNeedsActionMessages = computed(() =>
  discussionMessages.value
    .filter((message) => !message.parentMessageId)
    .filter((message) => message.threadStatus === "needs-action" || (message.threadStatus !== "resolved" && message.bodyText.includes("?")))
    .sort((a, b) => {
      if (a.threadStatus === "needs-action" && b.threadStatus !== "needs-action") return -1;
      if (b.threadStatus === "needs-action" && a.threadStatus !== "needs-action") return 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    })
);
const discussionStatusCounts = computed(() =>
  SERVICE_DISCUSSION_THREAD_STATUSES.reduce<Record<ServiceDiscussionThreadStatus, number>>((counts, status) => {
    counts[status] = topLevelDiscussionMessages.value.filter((message) => message.threadStatus === status).length;
    return counts;
  }, { open: 0, "needs-action": 0, resolved: 0, archived: 0 })
);
const serviceCoreDocumentLinks = computed(() =>
  caseAssets.value
    .flatMap((asset) => assetDocumentLinksFor(asset.assetId).map((link) => ({ asset, link })))
    .sort((a, b) => Number(b.link.isPinned) - Number(a.link.isPinned) || b.link.updatedAt.localeCompare(a.link.updatedAt))
);
const discussionBriefingHasHighlights = computed(() =>
  Boolean(
    discussionNeedsActionMessages.value.length ||
      pinnedDiscussionMessages.value.length ||
      discussionDecisionMessages.value.length ||
      relatedKnowledge.value.length ||
      serviceCoreDocumentLinks.value.length
  )
);
const selectedDiscussionReplyTo = computed(() =>
  discussionReplyToId.value ? discussionMessages.value.find((message) => message.messageId === discussionReplyToId.value) ?? null : null
);

function toggleTag(tagId: string, checked: boolean) {
  selectedTagIds.value = checked
    ? [...new Set([...selectedTagIds.value, tagId])]
    : selectedTagIds.value.filter((id) => id !== tagId);
}

function toggleUploadTag(tagId: string, checked: boolean) {
  selectedUploadTagIds.value = checked
    ? [...new Set([...selectedUploadTagIds.value, tagId])]
    : selectedUploadTagIds.value.filter((id) => id !== tagId);
}

function onUploadFileChange(event: Event) {
  selectedFile.value = (event.target as HTMLInputElement).files?.[0] || null;
  isUploadDragging.value = false;
}

function openUploadFilePicker() {
  if (!auth.canUpload || caseIsArchived.value) return;
  if (uploadFileInput.value) {
    uploadFileInput.value.value = "";
  }
  uploadFileInput.value?.click();
}

function clearSelectedUploadFile() {
  selectedFile.value = null;
  isUploadDragging.value = false;
  if (uploadFileInput.value) {
    uploadFileInput.value.value = "";
  }
}

function onUploadDragEnter(event: DragEvent) {
  event.preventDefault();
  if (!auth.canUpload || caseIsArchived.value) return;
  isUploadDragging.value = true;
}

function onUploadDragOver(event: DragEvent) {
  event.preventDefault();
  if (!auth.canUpload || caseIsArchived.value) return;
  isUploadDragging.value = true;
}

function onUploadDragLeave(event: DragEvent) {
  const currentTarget = event.currentTarget as HTMLElement | null;
  const nextTarget = event.relatedTarget as Node | null;
  if (currentTarget && nextTarget && currentTarget.contains(nextTarget)) return;
  isUploadDragging.value = false;
}

function onUploadDrop(event: DragEvent) {
  event.preventDefault();
  if (!auth.canUpload || caseIsArchived.value) return;
  isUploadDragging.value = false;
  selectedFile.value = event.dataTransfer?.files?.[0] ?? null;
  if (uploadFileInput.value) {
    uploadFileInput.value.value = "";
  }
}

function clearDocumentUploadForm() {
  selectedFile.value = null;
  uploadNotes.value = "";
  selectedUploadTagIds.value = [];
  isUploadDragging.value = false;
  if (uploadFileInput.value) {
    uploadFileInput.value.value = "";
  }
}

function contactOptionLabel(contact: Contact) {
  return [
    contactDisplayName(contact),
    contact.jobTitle,
    contact.partyOrganizationName || contact.email
  ]
    .filter(Boolean)
    .join(" · ");
}

function asInputDate(value: string): string {
  const dateOnly = dateOnlyString(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return dateOnly;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString().slice(0, 10);
}

function localDateTimeInputValue(value = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return localDateTimeInputValue(new Date());
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function timelineTone(type: CaseTimelineEventType) {
  if (type === "communication") return "border-purple-100 bg-purple-50 text-purple-950";
  if (type === "document") return "border-blue-100 bg-blue-50 text-blue-900";
  if (type === "task") return "border-emerald-100 bg-emerald-50 text-emerald-900";
  if (type === "party") return "border-teal-100 bg-teal-50 text-teal-900";
  if (type === "asset") return "border-cyan-100 bg-cyan-50 text-cyan-950";
  if (type === "credential") return "border-violet-100 bg-violet-50 text-violet-950";
  if (type === "case") return "border-amber-100 bg-amber-50 text-amber-950";
  if (type === "note") return "border-ink-100 bg-white text-ink-900";
  return "border-ink-100 bg-ink-50 text-ink-700";
}

function timelineTypeLabel(type: CaseTimelineEventType) {
  if (type === "party") return "Party";
  if (type === "case") return labels.value.singular;
  if (type === "credential") return "Credential";
  if (type === "communication") return "Communication";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function documentReviewLabel(status: DocumentReviewStatus) {
  return DOCUMENT_REVIEW_LABELS[status];
}

function discussionReplies(messageId: string) {
  return discussionMessages.value
    .filter((message) => message.parentMessageId === messageId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function discussionReplyCount(messageId: string) {
  return discussionReplies(messageId).length;
}

function discussionThreadAssetLinks(message: ServiceDiscussionMessage) {
  const seen = new Set<string>();
  return [message, ...discussionReplies(message.messageId)].flatMap((entry) => entry.assetLinks).filter((link) => {
    if (seen.has(link.assetId)) return false;
    seen.add(link.assetId);
    return true;
  });
}

function discussionThreadAttachmentCount(message: ServiceDiscussionMessage) {
  return [message, ...discussionReplies(message.messageId)].reduce((total, entry) => total + entry.attachments.length, 0);
}

function discussionThreadLastActivity(message: ServiceDiscussionMessage) {
  const latest = [message, ...discussionReplies(message.messageId)]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return latest ? formatDateTime(latest.updatedAt) : formatDateTime(message.updatedAt);
}

function areDiscussionRepliesExpanded(messageId: string) {
  return expandedDiscussionReplyIds.value.has(messageId);
}

function discussionPostNeedsCollapse(message: ServiceDiscussionMessage) {
  const nonEmptyLines = message.bodyText.split(/\r?\n/).filter((line) => line.trim()).length;
  return message.bodyText.length > 420 || nonEmptyLines > 8 || message.attachments.length > 0;
}

function isDiscussionPostExpanded(message: ServiceDiscussionMessage) {
  return !discussionPostNeedsCollapse(message) || expandedDiscussionPostIds.value.has(message.messageId);
}

function discussionPostId(message: ServiceDiscussionMessage) {
  return `service-discussion-post-${message.messageId}`;
}

function discussionPostContentId(message: ServiceDiscussionMessage) {
  return `service-discussion-post-content-${message.messageId}`;
}

function discussionInteractionPostIds() {
  const protectedIds = new Set<string>();
  if (discussionReplyToId.value) protectedIds.add(discussionReplyToId.value);
  if (editingDiscussionId.value) {
    const editingMessage = discussionMessages.value.find((message) => message.messageId === editingDiscussionId.value);
    if (editingMessage) protectedIds.add(editingMessage.parentMessageId ?? editingMessage.messageId);
  }
  return protectedIds;
}

function retainFocusedDiscussionInteractionPosts() {
  if (allowMultipleExpandedDiscussionPosts.value) return;
  const visibleIds = new Set(collapsibleDiscussionMessages.value.map((message) => message.messageId));
  const protectedIds = discussionInteractionPostIds();
  expandedDiscussionPostIds.value = new Set(
    [...expandedDiscussionPostIds.value].filter(
      (expandedId) => !visibleIds.has(expandedId) || protectedIds.has(expandedId)
    )
  );
}

function expandDiscussionPostId(messageId: string, scrollIntoView = true) {
  retainFocusedDiscussionInteractionPosts();
  const next = new Set(expandedDiscussionPostIds.value);
  next.add(messageId);
  expandedDiscussionPostIds.value = next;

  if (scrollIntoView) {
    void nextTick().then(() => {
      document.getElementById(`service-discussion-post-${messageId}`)?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start"
      });
    });
  }
}

async function toggleDiscussionPost(message: ServiceDiscussionMessage) {
  const next = new Set(expandedDiscussionPostIds.value);
  const isCollapsing = next.has(message.messageId);
  if (!isCollapsing) {
    expandDiscussionPostId(message.messageId);
    return;
  }
  next.delete(message.messageId);
  expandedDiscussionPostIds.value = next;

  await nextTick();
  document.getElementById(discussionPostId(message))?.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "start"
  });
}

function expandDiscussionPosts() {
  allowMultipleExpandedDiscussionPosts.value = true;
  expandedDiscussionPostIds.value = new Set([
    ...expandedDiscussionPostIds.value,
    ...collapsibleDiscussionMessages.value.map((message) => message.messageId)
  ]);
}

function collapseDiscussionPosts() {
  allowMultipleExpandedDiscussionPosts.value = false;
  const visibleIds = new Set(topLevelDiscussionMessages.value.map((message) => message.messageId));
  expandedDiscussionPostIds.value = new Set(
    [...expandedDiscussionPostIds.value].filter((messageId) => !visibleIds.has(messageId))
  );
}

function toggleDiscussionReplies(messageId: string) {
  const next = new Set(expandedDiscussionReplyIds.value);
  if (next.has(messageId)) next.delete(messageId);
  else next.add(messageId);
  expandedDiscussionReplyIds.value = next;
}

function setDiscussionSortOrder(order: DiscussionSortOrder) {
  discussionSortOrder.value = order;
  window.localStorage.setItem(DISCUSSION_SORT_STORAGE_KEY, order);
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

function discussionAttachmentDownloadUrl(documentId: string) {
  return `/api/documents/${documentId}/download`;
}

function discussionMessageTypeLabel(type: ServiceDiscussionMessageType) {
  if (type === "decision") return "Decision";
  if (type === "system") return "System";
  return "Message";
}

function discussionThreadStatusLabel(status: ServiceDiscussionThreadStatus) {
  if (status === "needs-action") return "Needs action";
  if (status === "resolved") return "Resolved";
  if (status === "archived") return "Archived";
  return "Open";
}

function discussionThreadStatusClass(status: ServiceDiscussionThreadStatus) {
  if (status === "needs-action") return "bg-amber-100 text-amber-900";
  if (status === "resolved") return "bg-emerald-100 text-emerald-900";
  if (status === "archived") return "bg-ink-200 text-ink-700";
  return "bg-blue-50 text-blue-900";
}

function discussionActionTitle(message: ServiceDiscussionMessage) {
  const firstLine = message.bodyText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "Follow up discussion";
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
}

function assetOptionLabel(asset: ManagedAsset) {
  return [asset.name, asset.hostname || asset.lanIp || asset.assetType].filter(Boolean).join(" · ");
}

function canEditDiscussionMessage(message: ServiceDiscussionMessage) {
  return auth.canEditCases || message.createdBy === auth.user?.userId;
}

function containsLikelySecret(value: string) {
  return /BEGIN (RSA|OPENSSH|PRIVATE) KEY|password\s*[:=]|passwd\s*[:=]|secret\s*[:=]|api[_ -]?key\s*[:=]|token\s*[:=]/i.test(value);
}

function appendDiscussionFiles(files: File[]) {
  if (!files.length) return;
  discussionFiles.value = [...discussionFiles.value, ...files];
}

function appendDiscussionReplyFiles(files: File[]) {
  if (!files.length) return;
  discussionReplyFiles.value = [...discussionReplyFiles.value, ...files];
}

function onDiscussionFileChange(event: Event) {
  appendDiscussionFiles(Array.from((event.target as HTMLInputElement).files ?? []));
  if (discussionFileInput.value) discussionFileInput.value.value = "";
}

function onDiscussionPaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  if (!files.length) return;
  event.preventDefault();
  appendDiscussionFiles(files);
}

function removePendingDiscussionFile(index: number) {
  discussionFiles.value = discussionFiles.value.filter((_, itemIndex) => itemIndex !== index);
}

function removePendingDiscussionReplyFile(index: number) {
  discussionReplyFiles.value = discussionReplyFiles.value.filter((_, itemIndex) => itemIndex !== index);
}

function persistServiceDiscussionDraft() {
  const storageKey = `${DISCUSSION_DRAFT_STORAGE_PREFIX}${discussionDraftCaseId.value}`;
  if (!discussionBody.value.trim() && !discussionThreadOwnerUserId.value && !discussionMentionedUserIds.value.length) {
    window.localStorage.removeItem(storageKey);
    return;
  }
  window.localStorage.setItem(
    storageKey,
    JSON.stringify({
      body: discussionBody.value,
      ownerUserId: discussionThreadOwnerUserId.value,
      mentionedUserIds: discussionMentionedUserIds.value
    } satisfies ServiceDiscussionDraft)
  );
}

function restoreServiceDiscussionDraft(serviceId: string) {
  const draft = readServiceDiscussionDraft(serviceId);
  discussionBody.value = draft.body;
  discussionThreadOwnerUserId.value = draft.ownerUserId;
  discussionMentionedUserIds.value = draft.mentionedUserIds;
}

function clearServiceDiscussionComposer() {
  discussionBody.value = "";
  discussionFiles.value = [];
  discussionThreadOwnerUserId.value = "";
  discussionMentionedUserIds.value = [];
  window.localStorage.removeItem(`${DISCUSSION_DRAFT_STORAGE_PREFIX}${discussionDraftCaseId.value}`);
  if (discussionFileInput.value) discussionFileInput.value.value = "";
}

function clearServiceDiscussionReply() {
  discussionReplyToId.value = null;
  discussionReplyBody.value = "";
  discussionReplyFiles.value = [];
  discussionReplyThreadOwnerUserId.value = "";
  discussionReplyMentionedUserIds.value = [];
}

async function openServiceDiscussionComposer() {
  if (!canPostDiscussion.value) return;
  clearServiceDiscussionReply();
  showDiscussionComposer.value = true;
  await nextTick();
  discussionBodyInput.value?.focus();
}

function closeServiceDiscussionComposer() {
  showDiscussionComposer.value = false;
}

function toggleServiceDiscussionComposer() {
  if (showDiscussionComposer.value) closeServiceDiscussionComposer();
  else void openServiceDiscussionComposer();
}

function discardServiceDiscussionDraft() {
  if (hasDiscussionComposerDraft.value && !window.confirm("Discard this discussion draft?")) return;
  clearServiceDiscussionComposer();
  showDiscussionComposer.value = false;
}

async function loadDiscussion() {
  try {
    discussionMessages.value = await client.serviceDiscussion(caseId.value);
    discussionError.value = "";
  } catch (error) {
    discussionError.value = error instanceof Error ? error.message : "Unable to load discussion";
  }
}

async function uploadDiscussionFiles(messageId: string, files: File[]) {
  for (const [index, file] of files.entries()) {
    const form = new FormData();
    form.append("file", file);
    form.append("sortOrder", String(index));
    form.append("notes", `Discussion attachment for ${caseRecord.value?.caseNumber ?? labels.value.singular}`);
    await client.uploadServiceDiscussionAttachment(messageId, form);
  }
}

async function submitDiscussionMessage() {
  const isReply = Boolean(discussionReplyToId.value);
  const activeBody = isReply ? discussionReplyBody.value : discussionBody.value;
  const activeFiles = isReply ? discussionReplyFiles.value : discussionFiles.value;
  const activeOwnerUserId = isReply ? discussionReplyThreadOwnerUserId.value : discussionThreadOwnerUserId.value;
  const activeMentionedUserIds = isReply ? discussionReplyMentionedUserIds.value : discussionMentionedUserIds.value;
  const body = activeBody.trim() || (activeFiles.length ? "Attached file(s)." : "");
  if (!body || discussionBusy.value || !canPostDiscussion.value) return;
  if (containsLikelySecret(body)) {
    const confirmed = window.confirm(
      "This message looks like it may contain a password, token, or private key. Save real secrets in Credentials and reference them here instead. Continue posting this discussion message?"
    );
    if (!confirmed) return;
  }
  discussionBusy.value = true;
  discussionError.value = "";
  const files = [...activeFiles];
  const isTopLevelMessage = !discussionReplyToId.value;
  try {
    const message = await client.createServiceDiscussionMessage(caseId.value, {
      bodyText: body,
      parentMessageId: discussionReplyToId.value,
      messageType: "message",
      threadOwnerUserId: activeOwnerUserId || null,
      isPinned: false,
      mentionedUserIds: activeMentionedUserIds
    });
    if (isTopLevelMessage) {
      expandDiscussionPostId(message.messageId, false);
    }
    if (files.length) await uploadDiscussionFiles(message.messageId, files);
    if (isTopLevelMessage) {
      recentlyPostedDiscussionMessageId.value = message.messageId;
      clearServiceDiscussionComposer();
      showDiscussionComposer.value = false;
    } else {
      clearServiceDiscussionReply();
    }
    await loadDiscussion();
    if (isTopLevelMessage) {
      await nextTick();
      document.getElementById(discussionPostId(message))?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start"
      });
      window.setTimeout(() => {
        if (recentlyPostedDiscussionMessageId.value === message.messageId) recentlyPostedDiscussionMessageId.value = null;
      }, 2400);
    }
    toasts.success("Discussion posted", files.length ? "Message and attachments were added." : "Message was added.");
  } catch (error) {
    discussionError.value = error instanceof Error ? error.message : "Unable to post discussion message";
    toasts.error("Unable to post discussion", discussionError.value);
  } finally {
    discussionBusy.value = false;
  }
}

function startDiscussionReply(message: ServiceDiscussionMessage) {
  discussionReplyToId.value = message.parentMessageId ?? message.messageId;
  discussionReplyBody.value = "";
  discussionReplyFiles.value = [];
  discussionReplyThreadOwnerUserId.value = message.threadOwnerUserId ?? "";
  discussionReplyMentionedUserIds.value = [];
  showDiscussionComposer.value = false;
  retainFocusedDiscussionInteractionPosts();
  expandedDiscussionReplyIds.value = new Set([...expandedDiscussionReplyIds.value, message.parentMessageId ?? message.messageId]);
}

function cancelDiscussionReply() {
  clearServiceDiscussionReply();
}

function startEditDiscussion(message: ServiceDiscussionMessage) {
  if (!canEditDiscussionMessage(message) || caseIsArchived.value) return;
  editingDiscussionId.value = message.messageId;
  editingDiscussionBody.value = message.bodyText;
  const rootId = message.parentMessageId ?? message.messageId;
  retainFocusedDiscussionInteractionPosts();
  if (message.parentMessageId) expandedDiscussionReplyIds.value = new Set([...expandedDiscussionReplyIds.value, rootId]);
}

function cancelEditDiscussion() {
  editingDiscussionId.value = null;
  editingDiscussionBody.value = "";
}

async function saveDiscussionEdit(message: ServiceDiscussionMessage) {
  const body = editingDiscussionBody.value.trim();
  if (!body || discussionBusy.value || !canEditDiscussionMessage(message) || caseIsArchived.value) return;
  if (containsLikelySecret(body)) {
    const confirmed = window.confirm(
      "This edit looks like it may contain a password, token, or private key. Save real secrets in Credentials and reference them here instead. Continue saving?"
    );
    if (!confirmed) return;
  }
  discussionBusy.value = true;
  discussionError.value = "";
  try {
    await client.updateServiceDiscussionMessage(message.messageId, { bodyText: body });
    cancelEditDiscussion();
    await loadDiscussion();
    toasts.success("Discussion updated", "Your message was saved.");
  } catch (error) {
    discussionError.value = error instanceof Error ? error.message : "Unable to update discussion message";
    toasts.error("Unable to update discussion", discussionError.value);
  } finally {
    discussionBusy.value = false;
  }
}

async function toggleDiscussionPinned(message: ServiceDiscussionMessage) {
  if (!canPostDiscussion.value || discussionBusy.value) return;
  discussionBusy.value = true;
  discussionError.value = "";
  try {
    await client.updateServiceDiscussionMessage(message.messageId, { isPinned: !message.isPinned });
    await loadDiscussion();
  } catch (error) {
    discussionError.value = error instanceof Error ? error.message : "Unable to update pinned state";
    toasts.error("Unable to update pin", discussionError.value);
  } finally {
    discussionBusy.value = false;
  }
}

async function toggleDiscussionDecision(message: ServiceDiscussionMessage) {
  if (!canPostDiscussion.value || discussionBusy.value) return;
  discussionBusy.value = true;
  discussionError.value = "";
  try {
    await client.updateServiceDiscussionMessage(message.messageId, {
      messageType: message.messageType === "decision" ? "message" : "decision"
    });
    await loadDiscussion();
  } catch (error) {
    discussionError.value = error instanceof Error ? error.message : "Unable to update decision state";
    toasts.error("Unable to update decision", discussionError.value);
  } finally {
    discussionBusy.value = false;
  }
}

async function deleteDiscussionMessage(message: ServiceDiscussionMessage) {
  if (!canEditDiscussionMessage(message) || caseIsArchived.value || discussionBusy.value) return;
  if (!window.confirm("Remove this discussion message? Attachments will remain in Documents.")) return;
  discussionBusy.value = true;
  discussionError.value = "";
  try {
    await client.deleteServiceDiscussionMessage(message.messageId);
    await loadDiscussion();
    toasts.success("Discussion message removed", "The message was removed from the discussion.");
  } catch (error) {
    discussionError.value = error instanceof Error ? error.message : "Unable to remove discussion message";
    toasts.error("Unable to remove message", discussionError.value);
  } finally {
    discussionBusy.value = false;
  }
}

async function createKnowledgeFromDiscussion(
  message: ServiceDiscussionMessage,
  type: KnowledgeItem["type"] = "Service lesson",
  attachment?: ServiceDiscussionMessage["attachments"][number]
) {
  if (!auth.canAddNotes || discussionBusy.value) return;
  discussionBusy.value = true;
  discussionError.value = "";
  try {
    const knowledge = await client.createKnowledgeFromDiscussionMessage(message.messageId, {
      type,
      attachmentId: attachment?.attachmentId ?? null,
      summary: type === "Runbook" ? "Runbook draft promoted from service discussion." : undefined
    });
    if (!relatedKnowledge.value.some((item) => item.knowledgeId === knowledge.knowledgeId)) {
      relatedKnowledge.value = [knowledge, ...relatedKnowledge.value];
    }
    toasts.success(type === "Runbook" ? "Runbook draft created" : "Knowledge created", `${knowledge.title} was added as a draft.`);
  } catch (error) {
    discussionError.value = error instanceof Error ? error.message : "Unable to create knowledge from discussion";
    toasts.error("Unable to create knowledge", discussionError.value);
  } finally {
    discussionBusy.value = false;
  }
}

async function createNoteFromDiscussion(
  message: ServiceDiscussionMessage,
  attachment?: ServiceDiscussionMessage["attachments"][number]
) {
  if (!auth.canAddNotes || discussionBusy.value || !message.caseId) return;
  discussionBusy.value = true;
  discussionError.value = "";
  try {
    const note = await client.createNoteFromDiscussionMessage(message.messageId, {
      attachmentId: attachment?.attachmentId ?? null
    });
    toasts.success("Note created", `Discussion copied to Notes / Timeline at ${formatDateTime(note.createdAt)}.`);
  } catch (error) {
    discussionError.value = error instanceof Error ? error.message : "Unable to create note from discussion";
    toasts.error("Unable to create note", discussionError.value);
  } finally {
    discussionBusy.value = false;
  }
}

async function updateDiscussionThreadStatus(message: ServiceDiscussionMessage, status: ServiceDiscussionThreadStatus) {
  if (!canPostDiscussion.value || discussionBusy.value || message.threadStatus === status) return;
  discussionBusy.value = true;
  discussionError.value = "";
  try {
    await client.updateServiceDiscussionMessage(message.messageId, { threadStatus: status });
    await loadDiscussion();
    toasts.success("Discussion status updated", `Thread marked ${discussionThreadStatusLabel(status).toLowerCase()}.`);
  } catch (error) {
    discussionError.value = error instanceof Error ? error.message : "Unable to update discussion status";
    toasts.error("Unable to update status", discussionError.value);
  } finally {
    discussionBusy.value = false;
  }
}

async function updateDiscussionThreadOwner(message: ServiceDiscussionMessage, userId: string) {
  if (!canPostDiscussion.value || discussionBusy.value || (message.threadOwnerUserId ?? "") === userId) return;
  discussionBusy.value = true;
  discussionError.value = "";
  try {
    await client.updateServiceDiscussionMessage(message.messageId, { threadOwnerUserId: userId || null });
    await loadDiscussion();
    const ownerName = users.value.find((user) => user.userId === userId)?.name ?? "Unassigned";
    toasts.success("Discussion owner updated", `Thread owner set to ${ownerName}.`);
  } catch (error) {
    discussionError.value = error instanceof Error ? error.message : "Unable to update discussion owner";
    toasts.error("Unable to update owner", discussionError.value);
  } finally {
    discussionBusy.value = false;
  }
}

async function createTaskFromDiscussion(message: ServiceDiscussionMessage) {
  if (!auth.canCreateTasks || discussionBusy.value || !message.caseId) return;
  discussionBusy.value = true;
  discussionError.value = "";
  try {
    const task = await client.createTaskFromDiscussionMessage(message.messageId, {
      title: discussionActionTitle(message),
      priority: message.threadStatus === "needs-action" ? "High" : "Normal",
      dueDate: localDateInputValue(),
      assignedTo: message.threadOwnerUserId ?? auth.user?.userId ?? null
    });
    tasks.value = [task, ...tasks.value.filter((item) => item.taskId !== task.taskId)];
    await client.updateServiceDiscussionMessage(message.messageId, {
      threadStatus: "needs-action",
      threadOwnerUserId: task.assignedTo ?? message.threadOwnerUserId ?? auth.user?.userId ?? null
    });
    await loadDiscussion();
    toasts.success("Task created", `${task.title} was added to Tasks / Checklist.`);
  } catch (error) {
    discussionError.value = error instanceof Error ? error.message : "Unable to create task from discussion";
    toasts.error("Unable to create task", discussionError.value);
  } finally {
    discussionBusy.value = false;
  }
}

async function onServiceDiscussionContextSaved() {
  await loadDiscussion();
  toasts.success("Linked context updated", "The discussion and its asset context are now aligned.");
}

function onServiceDiscussionContextError(message: string) {
  discussionError.value = message;
  toasts.error("Unable to update linked context", message);
}

async function promoteDiscussionAttachment(
  message: ServiceDiscussionMessage,
  attachment: ServiceDiscussionMessage["attachments"][number]
) {
  const assetId = discussionAttachmentAssetTargets[attachment.attachmentId];
  if (!assetId || discussionBusy.value) return;
  discussionBusy.value = true;
  discussionError.value = "";
  try {
    await client.promoteDiscussionAttachmentToAssetDocument(message.messageId, attachment.attachmentId, {
      assetId,
      relationship: "Runbook",
      note: `Promoted from discussion: ${discussionActionTitle(message)}`,
      isPinned: true
    });
    discussionAttachmentAssetTargets[attachment.attachmentId] = "";
    await load();
    toasts.success("Core document linked", `${attachment.document.originalFileName} is now pinned to the selected asset.`);
  } catch (error) {
    discussionError.value = error instanceof Error ? error.message : "Unable to promote attachment";
    toasts.error("Unable to promote attachment", discussionError.value);
  } finally {
    discussionBusy.value = false;
  }
}

async function load() {
  const includeArchived = route.query.includeArchived === "true";
  const [workspace, linkedAssets] = await Promise.all([
    client.caseWorkspace(caseId.value, {
      includeArchived,
      category: documentCategory.value
    }),
    client.assets({ caseId: caseId.value, sort: "updated", direction: "desc" })
  ]);
  caseRecord.value = workspace.case;
  caseTypes.value = workspace.caseTypes;
  caseContacts.value = workspace.caseContacts;
  documents.value = workspace.documents;
  relatedKnowledge.value = workspace.knowledge;
  discussionMessages.value = workspace.discussion;
  readiness.value = workspace.readiness;
  timelineEvents.value = workspace.timeline;
  communications.value = workspace.communications;
  tasks.value = workspace.tasks;
  tags.value = workspace.tags;
  allContacts.value = workspace.contacts;
  partyOrganizations.value = workspace.partyOrganizations;
  users.value = workspace.users;
  caseAssets.value = linkedAssets;
  const assetDocumentEntries = await Promise.all(
    linkedAssets.map(async (linkedAsset) => [
      linkedAsset.assetId,
      await client.assetDocuments(linkedAsset.assetId).catch(() => [])
    ] as const)
  );
  caseAssetDocuments.value = Object.fromEntries(assetDocumentEntries);
  if (selectedDocument.value) {
    selectedDocument.value =
      workspace.documents.find((document) => document.documentId === selectedDocument.value?.documentId) ?? selectedDocument.value;
    void loadDocumentVersions(selectedDocument.value.documentId);
  }
  if (!workspace.contacts.some((contact) => contact.contactId === selectedContactId.value)) {
    selectedContactId.value = workspace.contacts[0]?.contactId ?? "";
  }
  syncRouteQuery();
}

function assetDocumentLinksFor(assetId: string): AssetDocumentLink[] {
  return caseAssetDocuments.value[assetId] ?? [];
}

function openServiceAssets() {
  void router.push({ path: "/managed-assets", query: { serviceId: caseId.value } });
}

function openNewServiceAsset() {
  void router.push({ path: "/managed-assets", query: { serviceId: caseId.value, create: "1" } });
}

function openLinkedAsset(assetId: string) {
  void router.push({ path: `/managed-assets/${assetId}`, query: { serviceId: caseId.value } });
}

function syncRouteQuery() {
  const tab = typeof route.query.tab === "string" ? route.query.tab : "";
  if (tabs.value.some((item) => item.id === tab)) {
    activeTab.value = tab;
  } else if (activeTab.value !== "overview" && !tab) {
    activeTab.value = "overview";
  }

  const documentId = typeof route.query.documentId === "string" ? route.query.documentId : "";
  if (!documentId) return;
  const document = documents.value.find((item) => item.documentId === documentId);
  if (!document) return;
  activeTab.value = "documents";
  selectedDocument.value = document;
  documentFormError.value = "";
  documentVersionError.value = "";
  showDocumentDetail.value = true;
  void loadDocumentVersions(document.documentId);
}

function setActiveTab(tab: string) {
  if (!tabs.value.some((item) => item.id === tab)) return;
  activeTab.value = tab;
  const nextQuery = { ...route.query };
  delete nextQuery.documentId;
  if (tab === "overview") {
    delete nextQuery.tab;
  } else {
    nextQuery.tab = tab;
  }
  void router.replace({ path: route.path, query: nextQuery });
}

async function loadDocumentVersions(documentId: string) {
  try {
    documentVersions.value = await client.documentVersions(documentId);
  } catch {
    documentVersions.value = selectedDocument.value ? [selectedDocument.value] : [];
  }
}

function openEditCase() {
  if (!caseRecord.value || caseIsArchived.value) return;
  Object.assign(editForm, {
    caseNumber: caseRecord.value.caseNumber,
    caseTypeCode: caseRecord.value.caseTypeCode,
    customerOrganizationId: caseRecord.value.customerOrganizationId ?? null,
    propertyAddress: caseRecord.value.propertyAddress,
    city: caseRecord.value.city,
    state: caseRecord.value.state,
    zipCode: caseRecord.value.zipCode,
    propertyType: caseRecord.value.propertyType,
    salePriceCents: caseRecord.value.salePriceCents,
    status: caseRecord.value.status,
    closingDate: asInputDate(caseRecord.value.closingDate),
    notes: caseRecord.value.notes,
    tagIds: caseRecord.value.tags.map((tag) => tag.tagId)
  });
  if (!availableCaseTypes.value.some((caseType) => caseType.code === editForm.caseTypeCode)) {
    editForm.caseTypeCode = availableCaseTypes.value[0]?.code ?? template.value.defaultWorkItemTypeCode;
  }
  selectedTagIds.value = caseRecord.value.tags.map((tag) => tag.tagId);
  salePriceDollars.value = String(Math.round(caseRecord.value.salePriceCents / 100));
  formError.value = "";
  showEditCase.value = true;
}

function openContactDetail(contact: Contact) {
  selectedContact.value = contact;
  showContactDetail.value = true;
}

function updateContactInState(contact: Contact) {
  selectedContact.value = contact;
  allContacts.value = allContacts.value.map((item) => (item.contactId === contact.contactId ? contact : item));
  caseContacts.value = caseContacts.value.map((item) =>
    item.contactId === contact.contactId ? { ...item, contact } : item
  );
}

function openNewContactForCase() {
  contactFormError.value = "";
  showNewContact.value = true;
}

function openDocumentDetail(document: DocumentRecord) {
  selectedDocument.value = document;
  documentFormError.value = "";
  showDocumentDetail.value = true;
}

function openCloseCase() {
  closeForce.value = false;
  closeReason.value = "";
  closeError.value = "";
  closeAttempt.value = null;
  showCloseCase.value = true;
}

function openArchiveCase() {
  archiveReason.value = "";
  archiveError.value = "";
  showArchiveCase.value = true;
}

function openRestoreCase() {
  restoreReason.value = "";
  restoreError.value = "";
  showRestoreCase.value = true;
}

async function selectDocumentCategory(category: string) {
  documentCategory.value = category;
  await load();
}

async function saveCase() {
  if (!caseRecord.value) return;
  busy.value = true;
  formError.value = "";
  try {
    caseRecord.value = await client.updateCase(caseRecord.value.caseId, {
      ...editForm,
      salePriceCents: Math.round(Number(salePriceDollars.value || "0") * 100),
      tagIds: selectedTagIds.value
    });
    showEditCase.value = false;
    await load();
  } catch (error) {
    formError.value = error instanceof Error ? error.message : labels.value.updatedError;
  } finally {
    busy.value = false;
  }
}

async function attachContact() {
  if (!selectedContactId.value || caseIsArchived.value) return;
  busy.value = true;
  formError.value = "";
  try {
    await client.addCaseContact(caseId.value, { contactId: selectedContactId.value, role: selectedContactRole.value });
    await load();
  } catch (error) {
    formError.value = error instanceof Error ? error.message : "Unable to attach contact";
  } finally {
    busy.value = false;
  }
}

async function removeCaseContact(item: CaseContact) {
  if (caseIsArchived.value || busy.value) return;
  const contactName = contactDisplayName(item.contact);
  const confirmed = window.confirm(
    `Remove ${contactName} as ${item.role} from this ${labels.value.lowerSingular}? The contact record will stay in Contacts.`
  );
  if (!confirmed) return;
  busy.value = true;
  formError.value = "";
  try {
    await client.removeCaseContact(caseId.value, item.contactId, item.role);
    toasts.success("Party removed", `${contactName} was removed from this ${labels.value.lowerSingular}.`);
    await load();
  } catch (error) {
    formError.value = error instanceof Error ? error.message : "Unable to remove party";
    toasts.error("Unable to remove party", formError.value);
  } finally {
    busy.value = false;
  }
}

async function createAndAttachContact(payload: { contact: ContactInput; role?: ContactRole }) {
  if (caseIsArchived.value) return;
  creatingContact.value = true;
  contactFormError.value = "";
  try {
    const contact = await client.createContact(payload.contact);
    selectedContactId.value = contact.contactId;
    selectedContactRole.value = payload.role ?? selectedContactRole.value;
    await client.addCaseContact(caseId.value, { contactId: contact.contactId, role: selectedContactRole.value });
    showNewContact.value = false;
    await load();
  } catch (error) {
    contactFormError.value = error instanceof Error ? error.message : "Unable to create and attach contact";
  } finally {
    creatingContact.value = false;
  }
}

function addPartyOrganization(organization: PartyOrganization) {
  if (partyOrganizations.value.some((item) => item.partyOrganizationId === organization.partyOrganizationId)) return;
  partyOrganizations.value = [...partyOrganizations.value, organization].sort((a, b) => a.name.localeCompare(b.name));
}

async function uploadDocument() {
  if (!selectedFile.value || caseIsArchived.value) return;
  busy.value = true;
  formError.value = "";
  try {
    const form = new FormData();
    form.append("file", selectedFile.value);
    form.append("category", uploadCategory.value);
    form.append("notes", uploadNotes.value);
    selectedUploadTagIds.value.forEach((tagId) => form.append("tagIds", tagId));
    const uploaded = await client.uploadDocument(caseId.value, form);
    clearDocumentUploadForm();
    toasts.success("Document uploaded", `${uploaded.originalFileName} was stored and indexed.`);
    await load();
  } catch (error) {
    formError.value = error instanceof Error ? error.message : "Unable to upload document";
    toasts.error("Upload failed", formError.value);
  } finally {
    busy.value = false;
  }
}

async function deleteDocument(document: DocumentRecord) {
  if (caseIsArchived.value) return;
  if (!window.confirm(`Delete ${document.originalFileName}?`)) return;
  await client.deleteDocument(document.documentId);
  if (selectedDocument.value?.documentId === document.documentId) {
    showDocumentDetail.value = false;
    selectedDocument.value = null;
    documentVersions.value = [];
  }
  await load();
}

async function saveDocumentMetadata(input: DocumentUpdateInput) {
  if (!selectedDocument.value || caseIsArchived.value) return;
  savingDocument.value = true;
  documentFormError.value = "";
  try {
    const updated = await client.updateDocument(selectedDocument.value.documentId, input);
    selectedDocument.value = updated;
    await loadDocumentVersions(updated.documentId);
    toasts.success("Document metadata saved", `${updated.originalFileName} was updated.`);
    await load();
  } catch (error) {
    documentFormError.value = error instanceof Error ? error.message : "Unable to update document";
    toasts.error("Unable to update document", documentFormError.value);
  } finally {
    savingDocument.value = false;
  }
}

async function uploadDocumentVersion(payload: { file: File; category: DocumentCategory; notes: string; tagIds: string[] }) {
  if (!selectedDocument.value || caseIsArchived.value) return;
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
    await load();
  } catch (error) {
    documentVersionError.value = error instanceof Error ? error.message : "Unable to upload new version";
    toasts.error("Version upload failed", documentVersionError.value);
  } finally {
    uploadingDocumentVersion.value = false;
  }
}

async function closeCase() {
  if (!caseRecord.value) return;
  closingCase.value = true;
  closeError.value = "";
  try {
    const result = await client.closeCase(caseRecord.value.caseId, {
      force: closeForce.value,
      reason: closeReason.value.trim()
    });
    closeAttempt.value = result;
    readiness.value = result.readiness;
    if (!result.ok) {
      closeError.value = result.message;
      return;
    }
    caseRecord.value = result.case;
    showCloseCase.value = false;
    closeForce.value = false;
    closeReason.value = "";
    await load();
  } catch (error) {
    closeError.value = error instanceof Error ? error.message : labels.value.closeError;
  } finally {
    closingCase.value = false;
  }
}

async function archiveCase() {
  if (!caseRecord.value) return;
  archivingCase.value = true;
  archiveError.value = "";
  try {
    const caseNumber = caseRecord.value.caseNumber;
    await client.archiveCase(caseRecord.value.caseId, { reason: archiveReason.value.trim() });
    showArchiveCase.value = false;
    toasts.success(labels.value.archiveSuccessTitle, labels.value.archiveSuccessMessage(caseNumber));
    await router.push(workItemPath());
  } catch (error) {
    archiveError.value = error instanceof Error ? error.message : labels.value.archivedError;
    toasts.error("Archive failed", archiveError.value);
  } finally {
    archivingCase.value = false;
  }
}

async function restoreCase() {
  if (!caseRecord.value) return;
  restoringCase.value = true;
  restoreError.value = "";
  try {
    const restored = await client.restoreCase(caseRecord.value.caseId, { reason: restoreReason.value.trim() });
    showRestoreCase.value = false;
    toasts.success(labels.value.restoreSuccessTitle, labels.value.restoreSuccessMessage(restored.caseNumber));
    await router.replace(workItemPath(restored.caseId));
    await load();
  } catch (error) {
    restoreError.value = error instanceof Error ? error.message : labels.value.restoredError;
    toasts.error("Restore failed", restoreError.value);
  } finally {
    restoringCase.value = false;
  }
}

function reviewCloseBlockers(tab: string) {
  setActiveTab(tab);
  showCloseCase.value = false;
}

async function addNote() {
  if (!newNote.value.trim() || caseIsArchived.value) return;
  await client.createNote(caseId.value, newNote.value.trim());
  newNote.value = "";
  toasts.success(labels.value.noteSuccess, labels.value.noteSuccessMessage);
  await load();
}

async function updateCommunicationStatus(communication: CommunicationRecord, status: CommunicationStatus) {
  if (!auth.canAddNotes) return;
  try {
    await client.updateCommunication(communication.communicationId, {
      status,
      followUpAssignedTo: status === "Needs follow-up" ? communication.followUpAssignedTo ?? auth.user?.userId ?? null : null,
      followUpDueDate: status === "Needs follow-up" ? communication.followUpDueDate ?? null : null
    });
    toasts.success("Communication updated", `Status set to ${status}.`);
    await load();
  } catch (error) {
    communicationError.value = error instanceof Error ? error.message : "Unable to update communication";
    toasts.error("Unable to update communication", communicationError.value);
  }
}

function openServiceCommunicationLog() {
  if (!caseRecord.value) return;
  const draftId = crypto.randomUUID();
  sessionStorage.setItem(
    `${COMMUNICATION_DRAFT_STORAGE_PREFIX}${draftId}`,
    JSON.stringify({
      caseId: caseRecord.value.caseId,
      partyOrganizationId: caseRecord.value.customerOrganizationId ?? null,
      contactId: null,
      assetId: null,
      supportingDocumentId: null,
      communicationType: "Call",
      direction: "Inbound",
      source: "Manual",
      status: "Linked",
      externalProvider: "",
      externalReference: "",
      externalUrl: "",
      sourceMetadata: {},
      subject: "",
      body: "",
      occurredAt: localDateTimeInputValue(),
      draftNotice: `Prepared for ${labels.value.singular} ${caseRecord.value.caseNumber}. The record will be linked when saved.`
    })
  );
  void router.push(`/communications?draft=${draftId}`);
}

function createKnowledgeFromService() {
  void router.push(`/knowledge?sourceServiceId=${caseId.value}`);
}

function openKnowledgeItem(knowledge: KnowledgeItem) {
  void router.push(`/knowledge/${knowledge.knowledgeId}`);
}

async function createTask() {
  if (!taskForm.title.trim() || caseIsArchived.value) return;
  busy.value = true;
  formError.value = "";
  try {
    await client.createTask(caseId.value, {
      title: taskForm.title.trim(),
      description: taskForm.description.trim(),
      priority: taskForm.priority ?? "Normal",
      dueDate: taskForm.dueDate,
      assignedTo: taskForm.assignedTo || null
    });
    Object.assign(taskForm, {
      title: "",
      description: "",
      priority: "Normal",
      dueDate: localDateInputValue(),
      assignedTo: null
    });
    await load();
  } catch (error) {
    formError.value = error instanceof Error ? error.message : "Unable to create task";
  } finally {
    busy.value = false;
  }
}

async function updateTask(task: TaskRecord, patch: Partial<TaskInput> & { status?: TaskRecord["status"] }) {
  if (caseIsArchived.value) return;
  await client.updateTask(caseId.value, task.taskId, patch);
  await load();
}

function resetRouteScopedUiState() {
  showContactDetail.value = false;
  selectedContact.value = null;
  showEditCase.value = false;
  showNewContact.value = false;
  showDocumentDetail.value = false;
  showCloseCase.value = false;
  showArchiveCase.value = false;
  showRestoreCase.value = false;
  formError.value = "";
  contactFormError.value = "";
  documentFormError.value = "";
  closeError.value = "";
  archiveError.value = "";
  restoreError.value = "";
  communicationError.value = "";
  discussionError.value = "";
  closeAttempt.value = null;
  closeForce.value = false;
  closeReason.value = "";
  archiveReason.value = "";
  restoreReason.value = "";
  selectedDocument.value = null;
  clearDocumentUploadForm();
  newNote.value = "";
  discussionBody.value = "";
  discussionFiles.value = [];
  discussionThreadOwnerUserId.value = "";
  discussionMentionedUserIds.value = [];
  clearServiceDiscussionReply();
  expandedDiscussionReplyIds.value = new Set();
  expandedDiscussionPostIds.value = new Set();
  allowMultipleExpandedDiscussionPosts.value = false;
  showDiscussionComposer.value = false;
  recentlyPostedDiscussionMessageId.value = null;
  showServiceBriefing.value = false;
  editingDiscussionId.value = null;
  editingDiscussionBody.value = "";
  if (discussionFileInput.value) discussionFileInput.value.value = "";
}

function startDiscussionPolling() {
  window.clearInterval(discussionPollTimer);
  discussionPollTimer = window.setInterval(() => {
    if (activeTab.value === "discussion") void loadDiscussion();
  }, 15000);
}

onMounted(async () => {
  await load();
  startDiscussionPolling();
});

onBeforeUnmount(() => {
  window.clearInterval(discussionPollTimer);
});

watch(caseId, async (serviceId) => {
  resetRouteScopedUiState();
  discussionDraftCaseId.value = serviceId;
  restoreServiceDiscussionDraft(serviceId);
  await load();
});

watch(() => route.query, syncRouteQuery, { deep: true });

watch(activeTab, (tab) => {
  if (tab === "discussion") void loadDiscussion();
});

watch(
  [discussionBody, discussionThreadOwnerUserId, discussionMentionedUserIds],
  persistServiceDiscussionDraft,
  { deep: true }
);
</script>

<template>
  <div v-if="caseRecord">
    <Breadcrumbs :items="breadcrumbs" />

    <PageHeader :eyebrow="caseRecord.caseNumber" :title="recordTitle" :description="caseRecord.notes">
      <div class="flex flex-wrap items-center gap-2">
        <StatusBadge :status="caseRecord.status" />
        <TagChip v-for="tag in caseRecord.tags" :key="tag.tagId" :tag="tag" />
        <span v-if="caseIsArchived" class="inline-flex h-9 items-center gap-2 rounded-md bg-ink-100 px-3 text-sm font-semibold text-ink-600">
          <Archive class="h-4 w-4" />
          Archived
        </span>
        <button
          v-if="caseIsArchived"
          class="btn-primary h-9 px-3"
          :disabled="!canSubmitRestore"
          :title="auth.canArchiveCases ? `${labels.restoreAction} to active views` : t('readonlyNotice')"
          @click="openRestoreCase"
        >
          <RotateCcw class="h-4 w-4" />
          {{ labels.restoreAction }}
        </button>
        <button
          v-if="!caseIsArchived && caseRecord.status !== 'Closed'"
          class="h-9 px-3"
          :class="readiness?.canClose ? 'btn-primary' : 'btn-secondary'"
          :disabled="!auth.canEditCases"
          :title="auth.canEditCases ? `Run ${labels.readinessTitle.toLowerCase()} check` : t('readonlyNotice')"
          @click="openCloseCase"
        >
          <CheckCircle2 class="h-4 w-4" />
          {{ labels.completeAction }}
        </button>
        <button
          v-if="!caseIsArchived"
          class="btn-secondary h-9 px-3"
          :disabled="!auth.canEditCases"
          :title="auth.canEditCases ? `Edit ${labels.lowerSingular}` : t('readonlyNotice')"
          @click="openEditCase"
        >
          <Edit3 class="h-4 w-4" />
          Edit
        </button>
        <button
          v-if="!caseIsArchived"
          class="btn-secondary h-9 px-3 text-legal-red hover:border-red-200 hover:bg-red-50"
          :disabled="!auth.canArchiveCases"
          :title="auth.canArchiveCases ? labels.archiveAction : t('readonlyNotice')"
          @click="openArchiveCase"
        >
          <Archive class="h-4 w-4" />
          {{ labels.archiveAction }}
        </button>
      </div>
    </PageHeader>

    <div v-if="caseIsArchived" class="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="flex items-start gap-2.5">
          <Archive class="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p class="font-semibold">{{ labels.archivedNoticeTitle }}</p>
            <p class="mt-1">
              {{ labels.archivedNoticeDescription }}
              <span v-if="caseRecord.deletedAt">Archived {{ formatDateTime(caseRecord.deletedAt) }}.</span>
            </p>
          </div>
        </div>
        <button class="btn-secondary h-9 px-3" type="button" :disabled="!canSubmitRestore" @click="openRestoreCase">
          <RotateCcw class="h-4 w-4" />
          {{ labels.restoreAction }}
        </button>
      </div>
    </div>

    <div class="mb-3 overflow-x-auto border-b border-ink-200">
      <nav class="flex min-w-max gap-1">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="border-b-2 px-3 py-2 text-sm font-semibold transition"
          :class="activeTab === tab.id ? 'border-accent-700 text-accent-800' : 'border-transparent text-ink-500 hover:text-ink-900'"
          @click="setActiveTab(tab.id)"
        >
          {{ tab.label }}
        </button>
      </nav>
    </div>

    <section v-if="activeTab === 'overview'" class="grid items-start gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
      <div class="panel p-4">
        <h2 class="mb-3 font-semibold">{{ labels.singular }} details</h2>
        <dl class="grid gap-3 sm:grid-cols-2">
          <div>
            <dt class="text-xs uppercase text-ink-500">{{ labels.typeLabel }}</dt>
            <dd class="mt-1 font-semibold">{{ recordTypeName }}</dd>
            <dd v-if="currentCaseType?.description" class="mt-1 text-xs leading-5 text-ink-500">{{ currentCaseType.description }}</dd>
          </div>
          <div v-if="template.showPropertyType">
            <dt class="text-xs uppercase text-ink-500">{{ t("property") }}</dt>
            <dd class="mt-1 font-semibold">{{ caseRecord.propertyType }}</dd>
          </div>
          <div v-if="template.showCustomerOrganization && caseRecord.customerOrganizationName">
            <dt class="text-xs uppercase text-ink-500">Customer / Organization</dt>
            <dd class="mt-1 font-semibold">{{ caseRecord.customerOrganizationName }}</dd>
          </div>
          <div v-if="template.showValueField">
            <dt class="text-xs uppercase text-ink-500">{{ labels.valueLabel }}</dt>
            <dd class="mt-1 font-semibold">{{ formatCurrency(caseRecord.salePriceCents) }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase text-ink-500">{{ labels.targetDateLabel }}</dt>
            <dd class="mt-1 font-semibold">{{ formatDate(caseRecord.closingDate) }}</dd>
          </div>
          <div v-if="recordLocationLine">
            <dt class="text-xs uppercase text-ink-500">{{ labels.locationDescriptionLabel }}</dt>
            <dd class="mt-1 font-semibold">{{ recordLocationLine }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase text-ink-500">{{ t("updated") }}</dt>
            <dd class="mt-1 font-semibold">{{ formatDateTime(caseRecord.updatedAt) }}</dd>
          </div>
        </dl>
      </div>
      <div class="panel p-4">
        <div class="mb-3 flex items-start justify-between gap-2">
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
        <div class="grid gap-2 sm:grid-cols-2">
          <div class="rounded-md border border-ink-200 p-2.5">
            <p class="text-xs font-semibold uppercase text-ink-500">Missing required docs</p>
            <p class="mt-2 text-2xl font-semibold">{{ readinessMissingDocumentCount }}</p>
          </div>
          <div class="rounded-md border border-ink-200 p-2.5">
            <p class="text-xs font-semibold uppercase text-ink-500">Open tasks</p>
            <p class="mt-2 text-2xl font-semibold">{{ readinessOpenTaskCount }}</p>
          </div>
        </div>
        <div class="mt-3 space-y-2">
          <div v-for="item in requiredCategoryRows" :key="item.category" class="flex items-center justify-between gap-3 text-sm">
            <span>{{ item.category }}</span>
            <span class="inline-flex items-center gap-2 font-semibold" :class="item.complete ? 'text-emerald-700' : 'text-amber-700'">
              <CheckCircle2 v-if="item.complete" class="h-4 w-4" />
              <AlertTriangle v-else class="h-4 w-4" />
              {{ item.complete ? "Present" : "Missing" }}
            </span>
          </div>
          <p v-if="!readiness?.closingReadinessEnabled" class="text-sm text-ink-500">
            This workspace can still store documents, notes, contacts, and tasks, but it does not enforce closing blockers.
          </p>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <button class="btn-secondary h-9 px-3" type="button" @click="setActiveTab('documents')">Review documents</button>
          <button class="btn-secondary h-9 px-3" type="button" @click="setActiveTab('tasks')">Review tasks</button>
          <button
            v-if="!caseIsArchived && caseRecord.status !== 'Closed'"
            class="h-9 px-3"
            :class="readiness?.canClose ? 'btn-primary' : 'btn-secondary'"
            type="button"
            :disabled="!auth.canEditCases"
            @click="openCloseCase"
          >
            <CheckCircle2 class="h-4 w-4" />
            {{ labels.completeAction }}
          </button>
        </div>
      </div>
      <div class="panel p-4">
        <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div class="flex items-start gap-3">
            <div class="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-accent-50 text-accent-900">
              <BookOpen class="h-5 w-5" />
            </div>
            <div>
              <h2 class="font-semibold">Related knowledge</h2>
              <p class="mt-1 text-sm text-ink-500">
                Runbooks, lessons, and troubleshooting notes linked to this {{ labels.lowerSingular }}.
              </p>
            </div>
          </div>
          <button class="btn-secondary h-9 px-3" type="button" :disabled="!auth.canAddNotes || caseIsArchived" @click="createKnowledgeFromService">
            <Plus class="h-4 w-4" />
            New knowledge
          </button>
        </div>
        <div class="space-y-2">
          <button
            v-for="knowledge in relatedKnowledge"
            :key="knowledge.knowledgeId"
            class="flex w-full items-center justify-between gap-3 rounded-md border border-ink-200 px-3 py-2 text-left text-sm transition hover:border-accent-300 hover:bg-accent-50"
            type="button"
            @click="openKnowledgeItem(knowledge)"
          >
            <span class="min-w-0">
              <span class="block truncate font-semibold text-ink-900">{{ knowledge.title }}</span>
              <span class="mt-0.5 block truncate text-xs text-ink-500">
                {{ [knowledge.type, knowledge.status, knowledge.component].filter(Boolean).join(" · ") }}
              </span>
            </span>
            <ArrowUpRight class="h-4 w-4 shrink-0 text-ink-400" />
          </button>
          <p v-if="!relatedKnowledge.length" class="rounded-md border border-dashed border-ink-200 p-3 text-sm text-ink-500">
            No knowledge has been linked to this {{ labels.lowerSingular }} yet.
          </p>
        </div>
      </div>
    </section>

    <section v-if="activeTab === 'contacts'" class="space-y-3">
      <div class="panel p-3">
        <div class="grid gap-2 lg:grid-cols-[1fr_220px_auto]">
          <select v-model="selectedContactId" class="input" :disabled="!auth.canEditCases || caseIsArchived">
            <option value="">Select reusable contact</option>
            <option v-for="contact in allContacts" :key="contact.contactId" :value="contact.contactId">
              {{ contactOptionLabel(contact) }}
            </option>
          </select>
          <select v-model="selectedContactRole" class="input" :disabled="!auth.canEditCases || caseIsArchived">
            <option v-for="role in availableContactRoles" :key="role" :value="role">{{ role }}</option>
          </select>
          <button class="btn-primary" :disabled="!auth.canEditCases || caseIsArchived || !selectedContactId || busy" @click="attachContact">
            <Plus class="h-4 w-4" />
            Attach party
          </button>
        </div>
        <div class="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-2">
          <p class="text-sm text-ink-500">If this contact is not in the directory yet, create it here and attach it to this {{ labels.lowerSingular }}.</p>
          <button
            class="btn-secondary h-9 px-3"
            :disabled="!auth.canManageContacts || !auth.canEditCases || caseIsArchived"
            :title="auth.canManageContacts && auth.canEditCases && !caseIsArchived ? `Create and attach a new contact to this ${labels.lowerSingular}` : t('readonlyNotice')"
            @click="openNewContactForCase"
          >
            <UserPlus class="h-4 w-4" />
            New contact
          </button>
        </div>
        <p v-if="formError" class="mt-2 text-sm font-semibold text-legal-red">{{ formError }}</p>
      </div>

      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <ContactCard
          v-for="item in caseContacts"
          :key="`${item.contactId}-${item.role}`"
          :contact="item.contact"
          :role="item.role"
          :removable="auth.canEditCases && !caseIsArchived"
          :remove-disabled="busy"
          :remove-label="`Remove from ${labels.lowerSingular}`"
          @open-related="openContactDetail(item.contact)"
          @remove="removeCaseContact(item)"
        />
      </div>
    </section>

    <section v-if="activeTab === 'assets'" class="space-y-3">
      <div class="panel p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="font-semibold">Linked assets</h2>
            <p class="mt-1 text-sm text-ink-500">
              Devices, lines, accounts, servers, gateways, SIMs, and numbers managed for this service.
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button class="btn-secondary h-9 px-3" type="button" @click="openServiceAssets">
              <HardDrive class="h-4 w-4" />
              Manage assets
            </button>
            <button
              class="btn-primary h-9 px-3"
              type="button"
              :disabled="!auth.canManageAssets || caseIsArchived"
              :title="auth.canManageAssets && !caseIsArchived ? `Create an asset linked to this ${labels.lowerSingular}` : t('readonlyNotice')"
              @click="openNewServiceAsset"
            >
              <Plus class="h-4 w-4" />
              New asset
            </button>
          </div>
        </div>
      </div>

      <div class="panel overflow-hidden">
        <div class="overflow-x-auto">
          <table class="min-w-[1100px] w-full text-left text-sm">
            <thead class="bg-ink-50 text-xs uppercase text-ink-500">
              <tr>
                <th class="px-4 py-3">Asset</th>
                <th class="px-4 py-3">Type</th>
                <th class="px-4 py-3">Status</th>
                <th class="px-4 py-3">Identifiers</th>
                <th class="px-4 py-3">Credentials</th>
                <th class="px-4 py-3">Core docs</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-ink-100">
              <tr
                v-for="linkedAsset in caseAssets"
                :key="linkedAsset.assetId"
                class="cursor-pointer transition hover:bg-ink-50"
                tabindex="0"
                @click="openLinkedAsset(linkedAsset.assetId)"
                @keydown.enter.prevent="openLinkedAsset(linkedAsset.assetId)"
                @keydown.space.prevent="openLinkedAsset(linkedAsset.assetId)"
              >
                <td class="px-4 py-3">
                  <p class="font-semibold text-accent-800">{{ linkedAsset.name }}</p>
                  <p v-if="linkedAsset.partyOrganizationName" class="text-xs text-ink-500">{{ linkedAsset.partyOrganizationName }}</p>
                </td>
                <td class="px-4 py-3 text-ink-700">{{ linkedAsset.assetType }}</td>
                <td class="px-4 py-3">
                  <StatusBadge :status="linkedAsset.status" />
                </td>
                <td class="px-4 py-3 text-ink-600">
                  {{ [linkedAsset.hostname, linkedAsset.lanIp, linkedAsset.phoneNumber, linkedAsset.serialNumber].filter(Boolean).join(" · ") }}
                </td>
                <td class="px-4 py-3 text-ink-700">
                  <KeyRound class="mr-1 inline h-4 w-4 text-ink-400" />
                  {{ linkedAsset.credentialCount }}
                </td>
                <td class="px-4 py-3">
                  <div v-if="assetDocumentLinksFor(linkedAsset.assetId).length" class="space-y-1">
                    <a
                      v-for="link in assetDocumentLinksFor(linkedAsset.assetId).slice(0, 2)"
                      :key="link.assetDocumentLinkId"
                      class="flex max-w-[260px] items-center gap-1.5 text-xs font-semibold text-accent-800 hover:text-accent-950"
                      :href="`/api/documents/${link.document.documentId}/download`"
                      @click.stop
                    >
                      <FileText class="h-3.5 w-3.5 shrink-0" />
                      <span class="truncate">{{ link.relationship }} · {{ link.document.originalFileName }}</span>
                    </a>
                    <p v-if="assetDocumentLinksFor(linkedAsset.assetId).length > 2" class="text-xs text-ink-500">
                      +{{ assetDocumentLinksFor(linkedAsset.assetId).length - 2 }} more
                    </p>
                  </div>
                  <span v-else class="text-xs text-ink-400">None</span>
                </td>
              </tr>
              <tr v-if="!caseAssets.length">
                <td class="px-4 py-6 text-ink-500" colspan="6">
                  No assets are linked to this {{ labels.lowerSingular }} yet. Use New asset to create one with this {{ labels.lowerSingular }} linked automatically.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section v-if="activeTab === 'communications'" class="grid items-start gap-3 xl:grid-cols-[minmax(320px,0.72fr)_minmax(0,1.28fr)]">
      <div class="panel space-y-4 p-4">
        <div class="flex items-start gap-3">
          <div class="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-accent-50 text-accent-900">
            <MessageSquare class="h-5 w-5" />
          </div>
          <div>
            <h2 class="font-semibold">Log communication</h2>
            <p class="mt-1 text-sm text-ink-500">
              Communications are managed from the global inbox. This view only shows records linked to this {{ labels.lowerSingular }}.
            </p>
          </div>
        </div>

        <button
          class="btn-primary w-full"
          type="button"
          :disabled="!auth.canAddNotes || caseIsArchived"
          @click="openServiceCommunicationLog"
        >
          <Plus class="h-4 w-4" />
          Log communication for this {{ labels.lowerSingular }}
        </button>
        <button class="btn-secondary w-full" type="button" @click="caseRecord && router.push(`/communications?view=all&caseId=${caseRecord.caseId}`)">
          Open communications inbox
        </button>
      </div>

      <CommunicationHistoryPanel
        :communications="communications"
        title="Communication history"
        :description="`${communications.length} records attached to this ${labels.lowerSingular}.`"
        :empty-text="`No communications have been recorded for this ${labels.lowerSingular} yet.`"
        max-height-class="max-h-[720px]"
        :show-service-link="false"
        :inbox-link="caseRecord ? `/communications?view=all&caseId=${caseRecord.caseId}` : '/communications'"
        :can-manage="auth.canAddNotes"
        @status-change="updateCommunicationStatus"
      />
    </section>

    <section v-if="activeTab === 'discussion'" class="flex min-w-0 flex-col gap-3">
      <div class="min-w-0 space-y-3">
        <div class="panel p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="flex items-start gap-3">
              <div class="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-accent-50 text-accent-900">
                <MessageSquare class="h-5 w-5" />
              </div>
              <div>
                <h2 class="font-semibold">Service discussion</h2>
                <p class="mt-1 text-sm text-ink-500">{{ discussionMessages.length }} messages linked to this {{ labels.lowerSingular }}.</p>
              </div>
            </div>
            <div class="flex flex-wrap items-center justify-end gap-2">
              <DiscussionAppearanceMenu />
              <span v-if="hasDiscussionComposerDraft && !showDiscussionComposer" class="inline-flex h-9 items-center rounded-md bg-amber-50 px-3 text-xs font-semibold text-amber-900 ring-1 ring-amber-100">
                Draft
              </span>
              <button
                class="h-9 px-3"
                :class="showDiscussionComposer ? 'btn-secondary' : 'btn-primary'"
                type="button"
                :disabled="!canPostDiscussion"
                @click="toggleServiceDiscussionComposer"
              >
                <X v-if="showDiscussionComposer" class="h-4 w-4" />
                <Plus v-else class="h-4 w-4" />
                {{ showDiscussionComposer ? "Close editor" : hasDiscussionComposerDraft ? "Continue draft" : "New post" }}
              </button>
              <div class="inline-flex rounded-md border border-ink-200 bg-white p-1">
                <button
                  class="h-7 rounded px-3 text-sm font-semibold transition"
                  :class="discussionSortOrder === 'newest' ? 'bg-accent-900 text-white' : 'text-ink-600 hover:bg-ink-50'"
                  type="button"
                  @click="setDiscussionSortOrder('newest')"
                >
                  Newest
                </button>
                <button
                  class="h-7 rounded px-3 text-sm font-semibold transition"
                  :class="discussionSortOrder === 'oldest' ? 'bg-accent-900 text-white' : 'text-ink-600 hover:bg-ink-50'"
                  type="button"
                  @click="setDiscussionSortOrder('oldest')"
                >
                  Oldest
                </button>
              </div>
              <div class="inline-flex items-center gap-1">
                <button
                  class="btn-secondary h-9 px-2.5 text-xs"
                  type="button"
                  :aria-pressed="allowMultipleExpandedDiscussionPosts"
                  :disabled="!hasCollapsedDiscussionPosts"
                  title="Expand all visible posts and allow multiple posts to stay open"
                  @click="expandDiscussionPosts"
                >
                  <ChevronsDown class="h-3.5 w-3.5" />
                  Expand posts
                </button>
                <button
                  class="btn-secondary h-9 px-2.5 text-xs"
                  type="button"
                  :disabled="!hasExpandedDiscussionPosts && !allowMultipleExpandedDiscussionPosts"
                  title="Collapse visible posts and return to single-post mode"
                  @click="collapseDiscussionPosts"
                >
                  <ChevronsUp class="h-3.5 w-3.5" />
                  Collapse posts
                </button>
              </div>
              <button class="btn-secondary h-9 px-3" type="button" :disabled="discussionBusy" @click="loadDiscussion">
                <RotateCcw class="h-4 w-4" />
                Refresh
              </button>
            </div>
          </div>

          <div v-if="showDiscussionComposer" class="mt-4 border-t border-ink-100 pt-4">
          <div class="flex items-center justify-between gap-3">
            <label class="text-sm font-semibold text-ink-700" for="service-discussion-body">New post</label>
            <button class="rounded-md p-1.5 text-ink-500 transition hover:bg-ink-50 hover:text-ink-900" type="button" title="Close editor" @click="closeServiceDiscussionComposer">
              <X class="h-4 w-4" />
            </button>
          </div>
          <div class="mt-2">
            <textarea
              ref="discussionBodyInput"
              id="service-discussion-body"
              v-model="discussionBody"
              class="textarea min-h-28"
              :style="discussionPlainEditorStyle"
              :disabled="!canPostDiscussion || discussionBusy"
              placeholder="Share an update, troubleshooting note, decision, screenshot, or file for this service."
              title="Supports Markdown formatting"
              @paste="onDiscussionPaste"
              @keydown.meta.enter.prevent="submitDiscussionMessage"
              @keydown.ctrl.enter.prevent="submitDiscussionMessage"
            />
          </div>
          <div class="mt-3 grid gap-3 md:grid-cols-[16rem_minmax(0,1fr)]">
            <label class="block text-sm font-semibold text-ink-700">
              Owner
              <select v-model="discussionThreadOwnerUserId" class="input mt-1" :disabled="!canPostDiscussion || discussionBusy">
                <option value="">No owner</option>
                <option v-for="user in users" :key="user.userId" :value="user.userId">{{ user.name }}</option>
              </select>
            </label>
            <label class="block text-sm font-semibold text-ink-700">
              Mentions
              <select v-model="discussionMentionedUserIds" class="input mt-1 h-24 py-2" multiple :disabled="!canPostDiscussion || discussionBusy">
                <option v-for="user in users" :key="user.userId" :value="user.userId">@{{ user.name }}</option>
              </select>
            </label>
          </div>

          <div v-if="discussionFiles.length" class="mt-3 flex flex-wrap gap-2">
            <span
              v-for="(file, index) in discussionFiles"
              :key="`${file.name}-${file.size}-${index}`"
              class="inline-flex max-w-full items-center gap-2 rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-700"
            >
              <Paperclip class="h-3.5 w-3.5 shrink-0 text-ink-400" />
              <span class="max-w-[220px] truncate">{{ file.name }}</span>
              <span class="shrink-0 text-ink-400">{{ formatFileSize(file.size) }}</span>
              <button class="rounded p-0.5 text-ink-400 hover:bg-ink-100 hover:text-ink-900" type="button" @click="removePendingDiscussionFile(index)">
                <X class="h-3.5 w-3.5" />
              </button>
            </span>
          </div>

          <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-2">
              <input
                ref="discussionFileInput"
                class="hidden"
                type="file"
                multiple
                :disabled="!canPostDiscussion || !auth.canUpload || discussionBusy"
                @change="onDiscussionFileChange"
              />
              <button
                class="btn-secondary h-9 px-3"
                type="button"
                :disabled="!canPostDiscussion || !auth.canUpload || discussionBusy"
                @click="discussionFileInput?.click()"
              >
                <Paperclip class="h-4 w-4" />
                Attach
              </button>
              <span class="text-xs text-ink-500">Keep passwords in Credentials.</span>
            </div>
            <div class="flex flex-wrap items-center justify-end gap-2">
              <button v-if="hasDiscussionComposerDraft" class="btn-secondary h-9 px-3 text-legal-red" type="button" :disabled="discussionBusy" @click="discardServiceDiscussionDraft">
                <Trash2 class="h-4 w-4" />
                Discard draft
              </button>
              <button class="btn-secondary h-9 px-3" type="button" :disabled="discussionBusy" @click="closeServiceDiscussionComposer">Close</button>
              <button
                class="btn-primary h-9 px-3"
                type="button"
                :disabled="!canPostDiscussion || discussionBusy || (!discussionBody.trim() && !discussionFiles.length)"
                @click="submitDiscussionMessage"
              >
                <MessageSquare class="h-4 w-4" />
                Post
              </button>
            </div>
          </div>
          <p v-if="discussionError" class="mt-2 text-sm font-semibold text-legal-red">{{ discussionError }}</p>
          <p v-if="caseIsArchived" class="mt-2 text-xs text-ink-500">Archived {{ labels.lowerPlural }} preserve discussion history but do not accept new posts until restored.</p>
          </div>
        </div>

        <div v-if="topLevelDiscussionMessages.length" class="min-w-0 space-y-3">
          <article
            v-for="message in topLevelDiscussionMessages"
            :id="discussionPostId(message)"
            :key="message.messageId"
            class="min-w-0 scroll-mt-32 rounded-md border bg-white p-4 lg:scroll-mt-20"
            :class="[
              message.messageType === 'decision' ? 'border-emerald-200' : message.isPinned ? 'border-accent-200' : 'border-ink-200',
              recentlyPostedDiscussionMessageId === message.messageId ? 'ring-2 ring-accent-300 ring-offset-2' : ''
            ]"
          >
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
	                  <strong class="text-sm text-ink-900">{{ message.createdByName }}</strong>
	                  <span class="text-xs text-ink-400">{{ formatDateTime(message.createdAt) }}</span>
	                  <span class="text-xs text-ink-400">Last active {{ discussionThreadLastActivity(message) }}</span>
	                  <span v-if="discussionReplyCount(message.messageId)" class="rounded-full bg-ink-100 px-2 py-0.5 text-xs font-semibold text-ink-600">
	                    {{ discussionReplyCount(message.messageId) }} replies
	                  </span>
	                  <span class="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-ink-600 ring-1 ring-ink-200">
	                    <UserCheck class="h-3 w-3" />
	                    {{ message.threadOwnerUserName ? `Owner: ${message.threadOwnerUserName}` : "Unassigned" }}
	                  </span>
	                  <span v-if="message.editedAt" class="text-xs text-ink-400">edited</span>
                  <span v-if="message.isPinned" class="inline-flex items-center gap-1 rounded-full bg-accent-50 px-2 py-0.5 text-xs font-semibold text-accent-900">
                    <Pin class="h-3 w-3" />
                    Pinned
                  </span>
                  <span
                    class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
                    :class="message.messageType === 'decision' ? 'bg-emerald-100 text-emerald-900' : 'bg-ink-100 text-ink-600'"
                  >
                    <CheckSquare v-if="message.messageType === 'decision'" class="h-3 w-3" />
                    {{ discussionMessageTypeLabel(message.messageType) }}
                  </span>
                  <span class="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold" :class="discussionThreadStatusClass(message.threadStatus)">
                    {{ discussionThreadStatusLabel(message.threadStatus) }}
                  </span>
                  <span
                    v-for="mention in message.mentions"
                    :key="mention.userId"
                    class="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-900"
                  >
                    @{{ mention.userName }}
                  </span>
                </div>
              </div>
              <div class="flex flex-wrap items-center justify-end gap-1.5">
                <button class="btn-secondary h-8 px-2.5 text-xs" type="button" @click="discussionReaderMessage = message">
                  <BookOpen class="h-3.5 w-3.5" />
                  Read
                </button>
                <DiscussionAppearanceMenu compact />
                <button class="btn-secondary h-8 px-2.5 text-xs" type="button" :disabled="!canPostDiscussion || discussionBusy" @click="startDiscussionReply(message)">
                  <Reply class="h-3.5 w-3.5" />
                  Reply
                </button>
                <select
                  class="input h-8 w-32 py-1 text-xs"
                  :value="message.threadOwnerUserId ?? ''"
                  :disabled="!canPostDiscussion || discussionBusy"
                  title="Thread owner"
                  @change="updateDiscussionThreadOwner(message, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="">Unassigned</option>
                  <option v-for="user in users" :key="user.userId" :value="user.userId">{{ user.name }}</option>
                </select>
                <select
                  class="input h-8 w-32 py-1 text-xs"
                  :value="message.threadStatus"
                  :disabled="!canPostDiscussion || discussionBusy"
                  title="Thread status"
                  @change="updateDiscussionThreadStatus(message, ($event.target as HTMLSelectElement).value as ServiceDiscussionThreadStatus)"
                >
                  <option value="open">Open</option>
                  <option value="needs-action">Needs action</option>
                  <option value="resolved">Resolved</option>
                  <option value="archived">Archived</option>
                </select>
                <details class="relative" data-dismissible-menu>
                  <summary class="btn-secondary flex h-8 cursor-pointer list-none items-center px-2.5 text-xs"><MoreHorizontal class="h-4 w-4" />More</summary>
                  <div class="absolute right-0 z-20 mt-1 grid w-48 rounded-md border border-ink-200 bg-white p-1 shadow-lg">
                    <button class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold hover:bg-ink-50" type="button" :disabled="!canPostDiscussion || discussionBusy" @click="toggleDiscussionPinned(message)"><PinOff v-if="message.isPinned" class="h-3.5 w-3.5" /><Pin v-else class="h-3.5 w-3.5" />{{ message.isPinned ? "Unpin" : "Pin" }}</button>
                    <button class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold hover:bg-ink-50" type="button" :disabled="!canPostDiscussion || discussionBusy" @click="toggleDiscussionDecision(message)"><CheckSquare class="h-3.5 w-3.5" />{{ message.messageType === "decision" ? "Mark as message" : "Mark as decision" }}</button>
                    <button class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold hover:bg-ink-50" type="button" :disabled="!auth.canAddNotes || discussionBusy" @click="createKnowledgeFromDiscussion(message)"><BookOpen class="h-3.5 w-3.5" />Create knowledge</button>
                    <button class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold hover:bg-ink-50" type="button" :disabled="!auth.canAddNotes || discussionBusy" @click="createKnowledgeFromDiscussion(message, 'Runbook')"><BookOpen class="h-3.5 w-3.5" />Create runbook</button>
                    <button class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold hover:bg-ink-50" type="button" :disabled="!auth.canAddNotes || discussionBusy" @click="createNoteFromDiscussion(message)"><FileText class="h-3.5 w-3.5" />Create note</button>
                    <button class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold hover:bg-ink-50" type="button" :disabled="!auth.canCreateTasks || discussionBusy" @click="createTaskFromDiscussion(message)"><ListChecks class="h-3.5 w-3.5" />Create task</button>
                    <button v-if="canEditDiscussionMessage(message)" class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold hover:bg-ink-50" type="button" :disabled="caseIsArchived || discussionBusy" @click="startEditDiscussion(message)"><Edit3 class="h-3.5 w-3.5" />Edit</button>
                    <button v-if="canEditDiscussionMessage(message)" class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold text-red-700 hover:bg-red-50" type="button" :disabled="caseIsArchived || discussionBusy" @click="deleteDiscussionMessage(message)"><Trash2 class="h-3.5 w-3.5" />Delete</button>
                  </div>
                </details>
              </div>
            </div>

            <DiscussionLinkedContext
              :message="message"
              :asset-links="discussionThreadAssetLinks(message)"
              :services="caseRecord ? [caseRecord] : []"
              :assets="caseAssets"
              :editable="canPostDiscussion && !discussionBusy"
              lock-service
              :thread-message-count="1 + discussionReplyCount(message.messageId)"
              :attachment-count="discussionThreadAttachmentCount(message)"
              @saved="onServiceDiscussionContextSaved"
              @error="onServiceDiscussionContextError"
              @open-asset="openLinkedAsset"
            />

            <div v-if="editingDiscussionId === message.messageId" class="mt-3 space-y-2">
              <DiscussionEditToolbar :busy="discussionBusy" :save-disabled="!editingDiscussionBody.trim()" @cancel="cancelEditDiscussion" @save="saveDiscussionEdit(message)" />
              <AutoGrowTextarea v-model="editingDiscussionBody" class="textarea min-h-96" :style="discussionPlainEditorStyle" :disabled="discussionBusy" autofocus />
            </div>
            <template v-else>
              <div
                v-if="discussionPostNeedsCollapse(message)"
                class="-mx-1 mt-3 flex min-h-10 items-center justify-between gap-3 border-y border-ink-100 bg-white/95 px-2 py-1.5 backdrop-blur"
                :class="isDiscussionPostExpanded(message) ? 'sticky top-[6.25rem] z-10 shadow-[0_6px_14px_rgba(37,37,26,0.06)] lg:top-0' : ''"
              >
                <span class="text-xs font-semibold uppercase text-ink-500">
                  {{ isDiscussionPostExpanded(message) ? "Full post" : "Post preview" }}
                </span>
                <button
                  class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold text-accent-900 transition hover:bg-accent-50"
                  type="button"
                  :aria-controls="discussionPostContentId(message)"
                  :aria-expanded="isDiscussionPostExpanded(message)"
                  @click="toggleDiscussionPost(message)"
                >
                  <ChevronUp v-if="isDiscussionPostExpanded(message)" class="h-3.5 w-3.5" />
                  <ChevronDown v-else class="h-3.5 w-3.5" />
                  {{ isDiscussionPostExpanded(message) ? "Collapse post" : "Show full post" }}
                  <span v-if="!isDiscussionPostExpanded(message) && message.attachments.length" class="text-ink-500">
                    · {{ message.attachments.length }} {{ message.attachments.length === 1 ? "attachment" : "attachments" }}
                  </span>
                </button>
              </div>
              <MarkdownContent
                :id="discussionPostContentId(message)"
                class="mt-3 text-sm leading-6 text-ink-700"
                :collapsed="!isDiscussionPostExpanded(message)"
                :source="message.bodyText"
              />
            </template>

            <div v-if="message.attachments.length && isDiscussionPostExpanded(message)" class="mt-3 grid gap-2 sm:grid-cols-2">
              <div
                v-for="attachment in message.attachments"
                :key="attachment.attachmentId"
                class="rounded-md border border-ink-200 bg-ink-50 p-2 text-sm transition hover:border-accent-200 hover:bg-accent-50"
              >
                <a :href="discussionAttachmentPreviewUrl(attachment.documentId)" target="_blank" rel="noreferrer">
                  <img
                    v-if="isDiscussionImageAttachment(attachment)"
                    class="mb-2 aspect-video w-full rounded-md border border-ink-100 object-cover"
                    :src="discussionAttachmentPreviewUrl(attachment.documentId)"
                    :alt="attachment.document.originalFileName"
                  />
                  <span v-else class="mb-2 grid h-16 w-full place-items-center rounded-md border border-ink-100 bg-white text-ink-500">
                    <FileText class="h-6 w-6" />
                  </span>
                  <span class="block truncate font-semibold text-ink-900">{{ attachment.document.originalFileName }}</span>
                  <span class="mt-0.5 block text-xs text-ink-500">{{ formatFileSize(attachment.document.fileSize) }}</span>
                </a>
	                <div v-if="caseAssets.length" class="mt-2 flex gap-2">
	                  <select v-model="discussionAttachmentAssetTargets[attachment.attachmentId]" class="input h-8 min-w-0 flex-1 py-1 text-xs" :disabled="discussionBusy">
	                    <option value="">Promote to asset core docs</option>
	                    <option v-for="asset in caseAssets" :key="asset.assetId" :value="asset.assetId">{{ assetOptionLabel(asset) }}</option>
	                  </select>
	                  <button class="btn-secondary h-8 px-2.5 text-xs" type="button" :disabled="discussionBusy || !discussionAttachmentAssetTargets[attachment.attachmentId]" @click="promoteDiscussionAttachment(message, attachment)">
	                    Core doc
	                  </button>
	                </div>
	                <div class="mt-2 flex flex-wrap gap-2">
	                  <button class="btn-secondary h-8 px-2.5 text-xs" type="button" :disabled="!auth.canAddNotes || discussionBusy" @click="createKnowledgeFromDiscussion(message, 'Runbook', attachment)">
	                    Runbook
	                  </button>
	                  <button class="btn-secondary h-8 px-2.5 text-xs" type="button" :disabled="!auth.canAddNotes || discussionBusy" @click="createKnowledgeFromDiscussion(message, 'Service lesson', attachment)">
	                    Knowledge
	                  </button>
	                  <button class="btn-secondary h-8 px-2.5 text-xs" type="button" :disabled="!auth.canAddNotes || discussionBusy" @click="createNoteFromDiscussion(message, attachment)">
	                    Note
	                  </button>
	                </div>
	              </div>
            </div>

            <div v-if="editingDiscussionId !== message.messageId && discussionPostNeedsCollapse(message) && isDiscussionPostExpanded(message)" class="mt-3 flex justify-end border-t border-ink-100 pt-2">
              <button
                class="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold text-ink-600 transition hover:bg-ink-50 hover:text-accent-900"
                type="button"
                :aria-controls="discussionPostContentId(message)"
                aria-expanded="true"
                @click="toggleDiscussionPost(message)"
              >
                <ChevronUp class="h-3.5 w-3.5" />
                Collapse and return to post
              </button>
            </div>

	            <div v-if="discussionReplyCount(message.messageId)" class="mt-4">
	              <button class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-ink-600 hover:bg-ink-50" type="button" @click="toggleDiscussionReplies(message.messageId)">
	                <ChevronDown v-if="areDiscussionRepliesExpanded(message.messageId)" class="h-3.5 w-3.5" />
	                <ChevronRight v-else class="h-3.5 w-3.5" />
	                {{ areDiscussionRepliesExpanded(message.messageId) ? "Hide replies" : `Show ${discussionReplyCount(message.messageId)} replies` }}
	              </button>
	            </div>

	            <div v-if="discussionReplyCount(message.messageId) && areDiscussionRepliesExpanded(message.messageId)" class="mt-2 border-l-2 border-ink-200 pl-3 sm:pl-4">
              <article
                v-for="reply in discussionReplies(message.messageId)"
                :key="reply.messageId"
                class="relative border-b border-ink-100 py-3 first:pt-1 last:border-b-0 last:pb-0"
              >
	            <span class="absolute -left-[1.08rem] top-5 h-2 w-2 rounded-full border-2 border-white bg-ink-300 sm:-left-[1.33rem]" />
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <strong class="text-sm text-ink-900">{{ reply.createdByName }}</strong>
                      <span class="text-xs text-ink-400">{{ formatDateTime(reply.createdAt) }}</span>
                      <span v-if="reply.editedAt" class="text-xs text-ink-400">edited</span>
                      <span
                        v-if="reply.messageType === 'decision'"
                        class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900"
                      >
                        <CheckSquare class="h-3 w-3" />
                        Decision
                      </span>
	                      <span class="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold" :class="discussionThreadStatusClass(reply.threadStatus)">
	                        {{ discussionThreadStatusLabel(reply.threadStatus) }}
	                      </span>
	                      <span class="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-ink-600 ring-1 ring-ink-200">
	                        <UserCheck class="h-3 w-3" />
	                        {{ reply.threadOwnerUserName ? `Owner: ${reply.threadOwnerUserName}` : "Unassigned" }}
	                      </span>
	                      <span
                        v-for="mention in reply.mentions"
                        :key="mention.userId"
                        class="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-900"
                      >
                        @{{ mention.userName }}
                      </span>
                    </div>
                  </div>
	                  <details class="relative" data-dismissible-menu>
	                    <summary class="grid h-7 w-7 cursor-pointer list-none place-items-center rounded-md text-ink-500 hover:bg-white" title="Reply actions"><MoreHorizontal class="h-4 w-4" /></summary>
	                    <div class="absolute right-0 z-20 mt-1 grid w-48 rounded-md border border-ink-200 bg-white p-1 shadow-lg">
	                      <button class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold hover:bg-ink-50" type="button" :disabled="!canPostDiscussion || discussionBusy" @click="startDiscussionReply(reply)"><Reply class="h-3.5 w-3.5" />Reply in thread</button>
	                      <button class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold hover:bg-ink-50" type="button" :disabled="!canPostDiscussion || discussionBusy" @click="toggleDiscussionDecision(reply)"><CheckSquare class="h-3.5 w-3.5" />{{ reply.messageType === "decision" ? "Mark as message" : "Mark as decision" }}</button>
	                      <button class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold hover:bg-ink-50" type="button" :disabled="!auth.canAddNotes || discussionBusy" @click="createKnowledgeFromDiscussion(reply)"><BookOpen class="h-3.5 w-3.5" />Create knowledge</button>
	                      <button class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold hover:bg-ink-50" type="button" :disabled="!auth.canAddNotes || discussionBusy" @click="createKnowledgeFromDiscussion(reply, 'Runbook')"><BookOpen class="h-3.5 w-3.5" />Create runbook</button>
	                      <button class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold hover:bg-ink-50" type="button" :disabled="!auth.canAddNotes || discussionBusy" @click="createNoteFromDiscussion(reply)"><FileText class="h-3.5 w-3.5" />Create note</button>
	                      <button class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold hover:bg-ink-50" type="button" :disabled="!auth.canCreateTasks || discussionBusy" @click="createTaskFromDiscussion(reply)"><ListChecks class="h-3.5 w-3.5" />Create task</button>
	                      <button v-if="canEditDiscussionMessage(reply)" class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold hover:bg-ink-50" type="button" :disabled="caseIsArchived || discussionBusy" @click="startEditDiscussion(reply)"><Edit3 class="h-3.5 w-3.5" />Edit</button>
	                      <button v-if="canEditDiscussionMessage(reply)" class="flex items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold text-red-700 hover:bg-red-50" type="button" :disabled="caseIsArchived || discussionBusy" @click="deleteDiscussionMessage(reply)"><Trash2 class="h-3.5 w-3.5" />Delete</button>
	                    </div>
	                  </details>
                </div>
                <div v-if="editingDiscussionId === reply.messageId" class="mt-3 space-y-2">
                  <DiscussionEditToolbar label="Editing reply" :busy="discussionBusy" :save-disabled="!editingDiscussionBody.trim()" @cancel="cancelEditDiscussion" @save="saveDiscussionEdit(reply)" />
                  <AutoGrowTextarea v-model="editingDiscussionBody" class="textarea min-h-72" :style="discussionPlainEditorStyle" :disabled="discussionBusy" autofocus />
                </div>
                <MarkdownContent v-else class="mt-2 text-sm leading-6 text-ink-700" :source="reply.bodyText" />

                <div v-if="reply.attachments.length" class="mt-3 grid gap-2 sm:grid-cols-2">
                  <div
                    v-for="attachment in reply.attachments"
                    :key="attachment.attachmentId"
                    class="rounded-md border border-ink-200 bg-white p-2 text-sm transition hover:border-accent-200 hover:bg-accent-50"
                  >
                    <a :href="discussionAttachmentPreviewUrl(attachment.documentId)" target="_blank" rel="noreferrer">
                      <img
                        v-if="isDiscussionImageAttachment(attachment)"
                        class="mb-2 aspect-video w-full rounded-md border border-ink-100 object-cover"
                        :src="discussionAttachmentPreviewUrl(attachment.documentId)"
                        :alt="attachment.document.originalFileName"
                      />
                      <span v-else class="mb-2 grid h-16 w-full place-items-center rounded-md border border-ink-100 bg-ink-50 text-ink-500">
                        <FileText class="h-6 w-6" />
                      </span>
                      <span class="block truncate font-semibold text-ink-900">{{ attachment.document.originalFileName }}</span>
                      <span class="mt-0.5 block text-xs text-ink-500">{{ formatFileSize(attachment.document.fileSize) }}</span>
                    </a>
	                    <div v-if="caseAssets.length" class="mt-2 flex gap-2">
	                      <select v-model="discussionAttachmentAssetTargets[attachment.attachmentId]" class="input h-8 min-w-0 flex-1 py-1 text-xs" :disabled="discussionBusy">
	                        <option value="">Promote to asset core docs</option>
	                        <option v-for="asset in caseAssets" :key="asset.assetId" :value="asset.assetId">{{ assetOptionLabel(asset) }}</option>
	                      </select>
	                      <button class="btn-secondary h-8 px-2.5 text-xs" type="button" :disabled="discussionBusy || !discussionAttachmentAssetTargets[attachment.attachmentId]" @click="promoteDiscussionAttachment(reply, attachment)">
	                        Core doc
	                      </button>
	                    </div>
	                    <div class="mt-2 flex flex-wrap gap-2">
	                      <button class="btn-secondary h-8 px-2.5 text-xs" type="button" :disabled="!auth.canAddNotes || discussionBusy" @click="createKnowledgeFromDiscussion(reply, 'Runbook', attachment)">
	                        Runbook
	                      </button>
	                      <button class="btn-secondary h-8 px-2.5 text-xs" type="button" :disabled="!auth.canAddNotes || discussionBusy" @click="createKnowledgeFromDiscussion(reply, 'Service lesson', attachment)">
	                        Knowledge
	                      </button>
	                      <button class="btn-secondary h-8 px-2.5 text-xs" type="button" :disabled="!auth.canAddNotes || discussionBusy" @click="createNoteFromDiscussion(reply, attachment)">
	                        Note
	                      </button>
	                    </div>
	                  </div>
	            </div>
		          </article>
	            </div>
	            <DiscussionReplyComposer
	              v-if="selectedDiscussionReplyTo?.messageId === message.messageId"
	              v-model="discussionReplyBody"
	              v-model:owner-user-id="discussionReplyThreadOwnerUserId"
	              v-model:mentioned-user-ids="discussionReplyMentionedUserIds"
	              :parent="message"
	              :files="discussionReplyFiles"
	              :users="users"
	              :disabled="!canPostDiscussion"
	              :can-upload="auth.canUpload"
	              :busy="discussionBusy"
	              @add-files="appendDiscussionReplyFiles"
	              @remove-file="removePendingDiscussionReplyFile"
	              @submit="submitDiscussionMessage"
	              @cancel="cancelDiscussionReply"
	            />
	            <p v-if="selectedDiscussionReplyTo?.messageId === message.messageId && discussionError" class="mt-2 text-sm font-semibold text-legal-red">{{ discussionError }}</p>
	          </article>
        </div>
        <div v-else class="panel border-dashed p-8 text-center text-sm text-ink-500">
          No discussion messages have been added to this {{ labels.lowerSingular }} yet.
        </div>
      </div>

      <aside class="order-first min-w-0">
        <div class="panel overflow-visible">
          <button
            class="flex w-full flex-col gap-3 px-4 py-3 text-left transition hover:bg-ink-50 sm:flex-row sm:items-center sm:justify-between"
            type="button"
            :aria-expanded="showServiceBriefing"
            aria-controls="service-discussion-briefing-details"
            @click="showServiceBriefing = !showServiceBriefing"
          >
            <span class="min-w-0">
              <span class="flex items-center gap-2">
                <BookOpen class="h-4 w-4 shrink-0 text-accent-800" />
                <span class="font-semibold text-ink-900">Service briefing</span>
                <span class="rounded-full bg-accent-50 px-2 py-0.5 text-xs font-semibold text-accent-900">{{ discussionMessages.length }} messages</span>
              </span>
              <span class="mt-0.5 hidden text-xs text-ink-500 lg:block">Pinned context, decisions, action threads, knowledge, and linked asset documents.</span>
            </span>
            <span class="flex flex-wrap items-center gap-1.5">
              <span class="rounded-md bg-ink-100 px-2 py-1 text-xs font-semibold text-ink-700">Open {{ discussionStatusCounts.open }}</span>
              <span class="rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">Needs action {{ discussionStatusCounts["needs-action"] }}</span>
              <span class="rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-900">Resolved {{ discussionStatusCounts.resolved }}</span>
              <span class="rounded-md border border-ink-200 bg-white px-2 py-1 text-xs font-semibold text-ink-700">Core docs {{ serviceCoreDocumentLinks.length }}</span>
              <span class="ml-1 inline-flex items-center gap-1 text-xs font-semibold text-accent-900">
                {{ showServiceBriefing ? "Hide details" : "Show details" }}
                <ChevronUp v-if="showServiceBriefing" class="h-3.5 w-3.5" />
                <ChevronDown v-else class="h-3.5 w-3.5" />
              </span>
            </span>
          </button>

          <div v-if="showServiceBriefing" id="service-discussion-briefing-details" class="border-t border-ink-100 px-4 py-4">
            <p v-if="!discussionBriefingHasHighlights" class="text-sm text-ink-500">
              No highlighted discussion context yet. Pin a message, mark a decision, assign an action, or link knowledge and core documents when they become important.
            </p>
            <div v-else class="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              <div v-if="discussionNeedsActionMessages.length">
                <h3 class="text-sm font-semibold">Open questions</h3>
                <div class="mt-2 space-y-2">
                <button
                  v-for="message in discussionNeedsActionMessages.slice(0, 4)"
                  :key="message.messageId"
                  class="w-full rounded-md border border-amber-100 bg-amber-50/70 px-3 py-2 text-left text-sm transition hover:bg-amber-50"
                  type="button"
                  @click="startDiscussionReply(message)"
                >
                  <span class="block truncate font-semibold text-ink-900">{{ message.bodyText }}</span>
                  <span class="mt-0.5 block text-xs text-amber-800">{{ discussionThreadStatusLabel(message.threadStatus) }} · {{ message.createdByName }}</span>
                </button>
                </div>
              </div>

              <div v-if="pinnedDiscussionMessages.length">
                <h3 class="text-sm font-semibold">Pinned</h3>
                <div class="mt-2 space-y-2">
                <button
                  v-for="message in pinnedDiscussionMessages.slice(0, 4)"
                  :key="message.messageId"
                  class="w-full rounded-md border border-ink-200 px-3 py-2 text-left text-sm transition hover:border-accent-200 hover:bg-accent-50"
                  type="button"
                  @click="startDiscussionReply(message)"
                >
                  <span class="block truncate font-semibold text-ink-900">{{ message.bodyText }}</span>
                  <span class="mt-0.5 block text-xs text-ink-500">{{ message.createdByName }} · {{ formatDateTime(message.createdAt) }}</span>
                </button>
                </div>
              </div>

              <div v-if="discussionDecisionMessages.length">
                <h3 class="text-sm font-semibold">Decisions</h3>
                <div class="mt-2 space-y-2">
                <button
                  v-for="message in discussionDecisionMessages.slice(0, 4)"
                  :key="message.messageId"
                  class="w-full rounded-md border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-left text-sm transition hover:bg-emerald-50"
                  type="button"
                  @click="createKnowledgeFromDiscussion(message)"
                >
                  <span class="block truncate font-semibold text-ink-900">{{ message.bodyText }}</span>
                  <span class="mt-0.5 block text-xs text-emerald-800">{{ message.createdByName }} · Draft knowledge ready</span>
                </button>
                </div>
              </div>

              <div v-if="relatedKnowledge.length">
                <h3 class="text-sm font-semibold">Related knowledge</h3>
                <div class="mt-2 space-y-2">
                <button
                  v-for="knowledge in relatedKnowledge.slice(0, 4)"
                  :key="knowledge.knowledgeId"
                  class="w-full rounded-md border border-ink-200 px-3 py-2 text-left text-sm transition hover:border-accent-200 hover:bg-accent-50"
                  type="button"
                  @click="openKnowledgeItem(knowledge)"
                >
                  <span class="block truncate font-semibold text-ink-900">{{ knowledge.title }}</span>
                  <span class="mt-0.5 block text-xs text-ink-500">{{ knowledge.type }} · {{ knowledge.status }}</span>
                </button>
                </div>
              </div>

              <div v-if="serviceCoreDocumentLinks.length">
                <h3 class="text-sm font-semibold">Asset core docs</h3>
                <div class="mt-2 space-y-2">
                <a
                  v-for="item in serviceCoreDocumentLinks.slice(0, 6)"
                  :key="item.link.assetDocumentLinkId"
                  class="flex items-center gap-2 rounded-md border border-ink-200 px-3 py-2 text-sm transition hover:border-accent-200 hover:bg-accent-50"
                  :href="discussionAttachmentDownloadUrl(item.link.documentId)"
                >
                  <FileText class="h-4 w-4 shrink-0 text-accent-800" />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate font-semibold text-ink-900">{{ item.link.document.originalFileName }}</span>
                    <span class="mt-0.5 block truncate text-xs text-ink-500">{{ item.asset.name }} · {{ item.link.relationship }}</span>
                  </span>
                </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </section>

    <section v-if="activeTab === 'documents'" class="space-y-3">
      <div class="panel p-4">
        <div class="space-y-3">
          <input
            ref="uploadFileInput"
            class="hidden"
            type="file"
            :disabled="!auth.canUpload || caseIsArchived"
            @change="onUploadFileChange"
          />
          <div
            v-if="selectedFile"
            class="min-h-[148px] rounded-md border p-4 transition"
            :class="[
              isUploadDragging ? 'border-accent-600 bg-accent-100 text-accent-950 ring-2 ring-accent-100' : 'border-accent-500 bg-accent-50 text-accent-950',
              !auth.canUpload || caseIsArchived ? 'opacity-60' : ''
            ]"
            @dragenter="onUploadDragEnter"
            @dragover="onUploadDragOver"
            @dragleave="onUploadDragLeave"
            @drop="onUploadDrop"
          >
            <div class="flex h-full min-h-[116px] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div class="flex min-w-0 items-center gap-4">
                <div class="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-accent-700 shadow-sm">
                  <CheckCircle2 class="h-7 w-7" />
                </div>
                <div class="min-w-0">
                  <p class="text-sm font-semibold uppercase tracking-wide text-accent-800">
                    {{ isUploadDragging ? "Drop to replace file" : "File ready to upload" }}
                  </p>
                  <p class="mt-1 break-all text-lg font-semibold text-ink-950">{{ selectedFile.name }}</p>
                  <p class="mt-1 text-sm text-accent-900">{{ selectedUploadFileSize }}</p>
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <button
                  class="btn-secondary h-9 px-3"
                  type="button"
                  :disabled="!auth.canUpload || caseIsArchived"
                  @click="openUploadFilePicker"
                >
                  Change file
                </button>
                <button
                  class="btn-secondary h-9 w-9 px-0 text-legal-red hover:border-red-200 hover:bg-red-50"
                  type="button"
                  :disabled="!auth.canUpload || caseIsArchived"
                  aria-label="Remove selected file"
                  @click="clearSelectedUploadFile"
                >
                  <X class="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
          <div
            v-else
            class="grid min-h-[148px] cursor-pointer place-items-center rounded-md border border-dashed p-5 text-center transition"
            :class="[
              isUploadDragging ? 'border-accent-600 bg-accent-50 text-accent-950 ring-2 ring-accent-100' : 'border-ink-300 bg-white text-ink-700 hover:border-accent-500 hover:bg-ink-50',
              !auth.canUpload || caseIsArchived ? 'cursor-not-allowed opacity-60 hover:border-ink-300 hover:bg-white' : ''
            ]"
            role="button"
            :tabindex="!auth.canUpload || caseIsArchived ? -1 : 0"
            :aria-disabled="!auth.canUpload || caseIsArchived"
            @click="openUploadFilePicker"
            @keydown.enter.prevent="openUploadFilePicker"
            @keydown.space.prevent="openUploadFilePicker"
            @dragenter="onUploadDragEnter"
            @dragover="onUploadDragOver"
            @dragleave="onUploadDragLeave"
            @drop="onUploadDrop"
          >
            <div>
              <CloudUpload class="mx-auto h-8 w-8 text-ink-500" />
              <p class="mt-3 text-base font-semibold">
                {{ isUploadDragging ? "Drop file to attach" : "Browse for files or drag them here" }}
              </p>
              <p class="mt-1 text-sm text-ink-500">
                Choose a category, notes, and tags before uploading.
              </p>
            </div>
          </div>
          <div class="grid gap-2 lg:grid-cols-[220px_minmax(220px,1fr)_auto]">
            <select v-model="uploadCategory" class="input" :disabled="!auth.canUpload || caseIsArchived">
              <option v-for="category in availableDocumentCategories" :key="category" :value="category">{{ category }}</option>
            </select>
            <input
              v-model="uploadNotes"
              class="input"
              placeholder="Upload notes"
              :disabled="!auth.canUpload || caseIsArchived"
            />
            <button
              class="btn-primary"
              type="button"
              :disabled="!selectedFile || busy || !auth.canUpload || caseIsArchived"
              @click="uploadDocument"
            >
              <FileUp class="h-4 w-4" />
              {{ selectedFile ? "Upload 1 file" : t("upload") }}
            </button>
          </div>
        </div>
        <div
          class="mt-2 rounded-md border border-accent-100 bg-accent-50 p-2.5 text-sm text-accent-900"
        >
          <strong>Upload limit.</strong>
          <span class="ml-1">
            This workspace does not set an application-level file size cap. Very large uploads may still take longer to process.
          </span>
        </div>
        <fieldset class="mt-2 rounded-md border border-ink-200 bg-ink-50/60 p-2.5">
          <legend class="px-1 text-sm font-semibold">Document tags</legend>
          <div class="flex flex-wrap gap-1.5">
            <label
              v-for="tag in tags"
              :key="tag.tagId"
              class="inline-flex cursor-pointer items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-700"
              :class="selectedUploadTagIds.includes(tag.tagId) ? 'ring-2 ring-accent-100' : ''"
            >
              <input
                class="h-3.5 w-3.5 rounded border-ink-300 text-accent-700 focus:ring-accent-500"
                type="checkbox"
                :disabled="!auth.canUpload || caseIsArchived"
                :checked="selectedUploadTagIds.includes(tag.tagId)"
                @change="toggleUploadTag(tag.tagId, ($event.target as HTMLInputElement).checked)"
              />
              <span class="h-2.5 w-2.5 rounded-full" :style="{ backgroundColor: tag.color }" />
              {{ tag.name }}
            </label>
          </div>
          <p v-if="!tags.length" class="text-sm text-ink-500">No tags available yet.</p>
        </fieldset>
        <p v-if="formError" class="mt-2 text-sm font-semibold text-legal-red">{{ formError }}</p>
      </div>
      <div class="flex items-center gap-2">
        <select v-model="documentCategory" class="input max-w-xs" @change="load">
          <option value="">All document categories</option>
          <option v-for="category in availableDocumentCategories" :key="category" :value="category">{{ category }}</option>
        </select>
      </div>
      <div class="grid gap-3 xl:grid-cols-[1fr_320px]">
        <div class="panel overflow-hidden p-3">
          <div class="mb-2 flex items-center justify-between gap-2">
            <div>
              <h2 class="font-semibold">Category folders</h2>
              <p class="mt-1 text-sm text-ink-500">Use categories like folders while keeping each file attached to this {{ labels.lowerSingular }}.</p>
            </div>
            <span class="rounded-full bg-accent-50 px-3 py-1 text-xs font-semibold text-accent-800">{{ documentTotalCount }} files</span>
          </div>
          <div class="overflow-x-auto">
            <div class="grid min-w-[900px] grid-cols-5 gap-2">
              <button
                class="rounded-md border p-2.5 text-left transition hover:bg-ink-50"
                :class="documentCategory === '' ? 'border-accent-500 bg-accent-50' : 'border-ink-200 bg-white'"
                type="button"
                @click="selectDocumentCategory('')"
              >
                <FolderOpen class="h-5 w-5 text-accent-800" />
                <p class="mt-2 text-sm font-semibold">All documents</p>
                <p class="mt-1 text-xs text-ink-500">{{ documentTotalCount }} files</p>
              </button>
              <button
                v-for="category in documentCategoryCards"
                :key="category.category"
                class="rounded-md border p-2.5 text-left transition hover:bg-ink-50"
                :class="documentCategory === category.category ? 'border-accent-500 bg-accent-50' : 'border-ink-200 bg-white'"
                type="button"
                @click="selectDocumentCategory(category.category)"
              >
                <FolderCheck v-if="category.complete" class="h-5 w-5 text-emerald-700" />
                <FolderX v-else-if="category.required" class="h-5 w-5 text-amber-700" />
                <FolderOpen v-else class="h-5 w-5 text-ink-500" />
                <p class="mt-2 text-sm font-semibold">{{ category.category }}</p>
                <p class="mt-1 text-xs text-ink-500">
                  {{ category.count }} files<span v-if="category.required"> · required</span>
                </p>
              </button>
            </div>
          </div>
        </div>
        <div class="panel p-3">
          <div class="flex items-start gap-2.5">
            <div
              class="grid h-9 w-9 shrink-0 place-items-center rounded-md"
              :class="readiness?.canClose ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'"
            >
              <ListChecks class="h-5 w-5" />
            </div>
            <div>
              <h2 class="font-semibold">Document readiness</h2>
              <p class="mt-1 text-sm text-ink-500">{{ readiness?.message }}</p>
            </div>
          </div>
          <div class="mt-3 space-y-1.5 text-sm">
            <div class="flex items-center justify-between">
              <span>Required categories missing</span>
              <strong>{{ readinessMissingDocumentCount }}</strong>
            </div>
            <div class="flex items-center justify-between">
              <span>Open tasks before close</span>
              <strong>{{ readinessOpenTaskCount }}</strong>
            </div>
            <div class="flex items-center justify-between">
              <span>Checklist progress</span>
              <strong>{{ readiness?.completedTasks ?? 0 }}/{{ readiness?.totalTasks ?? 0 }}</strong>
            </div>
          </div>
        </div>
      </div>
      <div class="panel overflow-hidden">
        <div class="overflow-x-auto">
        <table class="min-w-[1060px] w-full text-left text-sm">
          <thead class="bg-ink-50 text-xs uppercase text-ink-500">
            <tr>
              <th class="px-5 py-3">File</th>
              <th class="px-5 py-3">Category</th>
              <th class="px-5 py-3">Review</th>
              <th class="px-5 py-3">Size</th>
              <th class="px-5 py-3">Uploaded</th>
              <th class="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-ink-100">
            <tr v-for="document in documents" :key="document.documentId">
              <td class="px-5 py-4">
                <button class="text-left font-semibold text-accent-800 hover:underline" type="button" @click="openDocumentDetail(document)">
                  {{ document.originalFileName }}
                </button>
                <p class="mt-0.5 text-xs font-semibold text-ink-400">Version {{ document.versionNumber ?? 1 }}</p>
                <p class="text-xs text-ink-500">{{ document.notes }}</p>
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
              </td>
              <td class="px-5 py-4">{{ document.category }}</td>
              <td class="px-5 py-4">
                <span
                  class="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
                  :class="DOCUMENT_REVIEW_CLASSES[document.reviewStatus]"
                >
                  {{ documentReviewLabel(document.reviewStatus) }}
                </span>
                <p v-if="document.reviewNotes" class="mt-1 max-w-[220px] truncate text-xs text-ink-500">{{ document.reviewNotes }}</p>
              </td>
              <td class="px-5 py-4">{{ formatFileSize(document.fileSize) }}</td>
              <td class="px-5 py-4">
                <p>{{ formatDateTime(document.uploadedAt) }}</p>
                <p class="text-xs text-ink-500">{{ document.uploadedByName }}</p>
              </td>
              <td class="px-5 py-4">
                <div class="flex justify-end gap-2">
                  <button class="btn-secondary h-9 px-3" type="button" @click="openDocumentDetail(document)">
                    <Eye class="h-4 w-4" />
                    Details
                  </button>
                  <a class="btn-secondary h-9 px-3" :href="`/api/documents/${document.documentId}/download`">
                    {{ t("download") }}
                  </a>
                  <button class="btn-secondary h-9 px-3 text-red-700" :disabled="!auth.canDeleteDocuments || caseIsArchived" @click="deleteDocument(document)">
                    <Trash2 class="h-4 w-4" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>
    </section>

    <section v-if="activeTab === 'timeline'" class="grid gap-3 xl:grid-cols-[1fr_0.58fr]">
      <div class="panel overflow-hidden">
        <div class="border-b border-ink-100 p-4">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 class="font-semibold">{{ labels.timelineTitle }}</h2>
              <p class="mt-1 text-sm text-ink-500">{{ labels.timelineDescription }}</p>
            </div>
            <span class="rounded-full bg-accent-100 px-3 py-1 text-sm font-semibold text-accent-900">{{ timelineEvents.length }} events</span>
          </div>
          <div class="mt-3 flex gap-2 overflow-x-auto pb-1">
            <button
              v-for="option in timelineFilterOptions"
              :key="option.value"
              class="h-9 shrink-0 rounded-full border px-3 text-sm font-semibold transition"
              :class="timelineFilter === option.value ? 'border-accent-700 bg-accent-700 text-white' : 'border-ink-200 bg-white text-ink-600 hover:border-accent-300'"
              type="button"
              @click="timelineFilter = option.value"
            >
              {{ option.label }}
              <span class="ml-1 opacity-75">{{ option.count }}</span>
            </button>
          </div>
        </div>

        <div class="max-h-[720px] overflow-y-auto p-4">
          <div v-if="filteredTimelineEvents.length" class="space-y-3">
            <article
              v-for="event in filteredTimelineEvents"
              :key="event.eventId"
              class="rounded-md border p-3"
              :class="timelineTone(event.type)"
            >
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="rounded-full bg-white/70 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em]">
                      {{ timelineTypeLabel(event.type) }}
                    </span>
                    <span v-if="event.action" class="text-xs font-semibold text-ink-500">{{ event.action }}</span>
                  </div>
                  <h3 class="mt-3 font-semibold text-ink-950">{{ event.title }}</h3>
                </div>
                <p class="text-right text-xs leading-5 text-ink-500">
                  {{ formatDateTime(event.createdAt) }}<br />
                  {{ event.createdByName }}
                </p>
              </div>
              <p class="mt-3 whitespace-pre-wrap text-sm leading-6 text-ink-700">{{ event.description }}</p>
            </article>
          </div>
          <div v-else class="rounded-md border border-dashed border-ink-200 p-8 text-center text-sm text-ink-500">
            No timeline events match this filter yet.
          </div>
        </div>
      </div>

      <div class="space-y-3">
        <div class="panel p-4">
          <h2 class="mb-3 font-semibold">Add note</h2>
          <textarea v-model="newNote" class="textarea" :disabled="!auth.canAddNotes || caseIsArchived" :placeholder="`Record a call, document request, or ${labels.lowerSingular} update.`" />
          <button class="btn-primary mt-3 w-full" :disabled="!auth.canAddNotes || caseIsArchived || !newNote.trim()" @click="addNote">Add note</button>
          <p v-if="caseIsArchived" class="mt-3 text-xs text-ink-500">Archived {{ labels.lowerPlural }} preserve timeline history but do not accept new notes until restored.</p>
        </div>

        <div class="panel p-4">
          <h2 class="font-semibold">Timeline sources</h2>
          <dl class="mt-3 space-y-2 text-sm">
            <div class="flex items-start justify-between gap-3">
              <dt class="text-ink-500">Manual notes</dt>
              <dd class="font-semibold">{{ timelineEvents.filter((event) => event.type === "note").length }}</dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-ink-500">Communications</dt>
              <dd class="font-semibold">{{ timelineEvents.filter((event) => event.type === "communication").length }}</dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-ink-500">Document events</dt>
              <dd class="font-semibold">{{ timelineEvents.filter((event) => event.type === "document").length }}</dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-ink-500">Workflow events</dt>
              <dd class="font-semibold">{{ timelineEvents.filter((event) => event.type === "case" || event.type === "task" || event.type === "party").length }}</dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-ink-500">Asset events</dt>
              <dd class="font-semibold">{{ timelineEvents.filter((event) => event.type === "asset").length }}</dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-ink-500">Credential audit</dt>
              <dd class="font-semibold">{{ timelineEvents.filter((event) => event.type === "credential").length }}</dd>
            </div>
          </dl>
          <p class="mt-3 text-xs leading-5 text-ink-500">This view is generated from normalized notes plus audit log records; it can later support exports, client reports, and compliance review.</p>
        </div>
      </div>
    </section>

    <section v-if="activeTab === 'tasks'" class="space-y-3">
      <div class="panel p-3">
        <div class="overflow-x-auto">
        <form class="grid min-w-[1060px] gap-3 lg:grid-cols-[1fr_1fr_150px_170px_180px_auto]" @submit.prevent="createTask">
          <input v-model="taskForm.title" class="input" placeholder="New task title" :disabled="!auth.canCreateTasks || caseIsArchived" required />
          <input v-model="taskForm.description" class="input" placeholder="Description" :disabled="!auth.canCreateTasks || caseIsArchived" />
          <select v-model="taskForm.priority" class="input" :disabled="!auth.canCreateTasks || caseIsArchived">
            <option v-for="priority in TASK_PRIORITIES" :key="priority" :value="priority">{{ priority }}</option>
          </select>
          <input v-model="taskForm.dueDate" class="input" type="date" :disabled="!auth.canCreateTasks || caseIsArchived" required />
          <select v-model="taskForm.assignedTo" class="input" :disabled="!auth.canCreateTasks || caseIsArchived">
            <option :value="null">Unassigned</option>
            <option v-for="user in users" :key="user.userId" :value="user.userId">{{ user.name }}</option>
          </select>
          <button class="btn-primary" type="submit" :disabled="!auth.canCreateTasks || caseIsArchived || busy || !taskForm.title.trim()">
            <Plus class="h-4 w-4" />
            Add task
          </button>
        </form>
        </div>
        <p v-if="formError" class="mt-2 text-sm font-semibold text-legal-red">{{ formError }}</p>
      </div>

      <div class="panel overflow-hidden">
        <div class="overflow-x-auto">
        <table class="min-w-[980px] w-full text-left text-sm">
          <thead class="bg-ink-50 text-xs uppercase text-ink-500">
            <tr>
              <th class="px-5 py-3">Task</th>
              <th class="px-5 py-3">Priority</th>
              <th class="px-5 py-3">Due</th>
              <th class="px-5 py-3">Assigned</th>
              <th class="px-5 py-3">Status</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-ink-100">
            <tr v-for="task in tasks" :key="task.taskId">
              <td class="px-5 py-4">
                <p class="font-semibold">{{ task.title }}</p>
                <p class="text-xs text-ink-500">{{ task.description }}</p>
              </td>
              <td class="px-5 py-4">
                <select class="input w-36" :value="task.priority" :disabled="!auth.canUpdateTasks || caseIsArchived" @change="updateTask(task, { priority: ($event.target as HTMLSelectElement).value as TaskRecord['priority'] })">
                  <option v-for="priority in TASK_PRIORITIES" :key="priority" :value="priority">{{ priority }}</option>
                </select>
              </td>
              <td class="px-5 py-4">
                <input
                  class="input w-40"
                  type="date"
                  :value="task.dueDate"
                  :disabled="!auth.canUpdateTasks || caseIsArchived"
                  @change="updateTask(task, { dueDate: ($event.target as HTMLInputElement).value })"
                />
              </td>
              <td class="px-5 py-4">
                <select
                  class="input w-44"
                  :value="task.assignedTo ?? ''"
                  :disabled="!auth.canUpdateTasks || caseIsArchived"
                  @change="updateTask(task, { assignedTo: ($event.target as HTMLSelectElement).value || null })"
                >
                  <option value="">Unassigned</option>
                  <option v-for="user in users" :key="user.userId" :value="user.userId">{{ user.name }}</option>
                </select>
              </td>
              <td class="px-5 py-4">
                <select class="input w-44" :value="task.status" :disabled="!auth.canUpdateTasks || caseIsArchived" @change="updateTask(task, { status: ($event.target as HTMLSelectElement).value as TaskRecord['status'] })">
                  <option v-for="status in TASK_STATUSES" :key="status" :value="status">{{ status }}</option>
                </select>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>
    </section>

    <ContactRelationshipDrawer
      v-model="showContactDetail"
      :contact="selectedContact"
      :breadcrumb-items="contactDrawerBreadcrumbs"
      :party-organizations="partyOrganizations"
      @contact-updated="updateContactInState"
      @organization-created="addPartyOrganization"
    />

    <DocumentDetailDrawer
      v-model="showDocumentDetail"
      :document="selectedDocument"
      :available-tags="tags"
      :document-categories="availableDocumentCategories"
      :can-edit="auth.canEditDocuments && !caseIsArchived"
      :saving="savingDocument"
      :error="documentFormError"
      :versions="documentVersions"
      :uploading-version="uploadingDocumentVersion"
      :version-error="documentVersionError"
      @save="saveDocumentMetadata"
      @upload-version="uploadDocumentVersion"
    />

    <ContactFormModal
      v-model="showNewContact"
      title="New party contact"
      :description="`Create a reusable contact and attach it to this ${labels.lowerSingular} without leaving the page.`"
      submit-label="Create and attach party"
      :saving="creatingContact"
      :error="contactFormError"
      :show-role="true"
      :initial-role="selectedContactRole"
      :party-organizations="partyOrganizations"
      @organization-created="addPartyOrganization"
      @submit="createAndAttachContact"
    />

    <div v-if="showCloseCase" class="fixed inset-0 z-50 overflow-y-auto bg-ink-900/45 px-4 py-6">
      <div class="mx-auto max-w-3xl rounded-lg bg-white shadow-soft">
        <div class="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
          <div>
            <p class="text-xs font-semibold uppercase tracking-wide text-accent-800">{{ labels.completeAction }} workflow</p>
            <h2 class="mt-1 text-lg font-semibold">{{ caseRecord.caseNumber }}</h2>
            <p class="mt-1 text-sm text-ink-500">{{ labels.readinessDescription }}</p>
          </div>
          <button class="btn-secondary h-9 px-3" type="button" :disabled="closingCase" @click="showCloseCase = false">
            <X class="h-4 w-4" />
          </button>
        </div>

        <div class="space-y-5 px-5 py-5">
          <div
            class="rounded-md border p-4"
            :class="closeHasBlockers ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-emerald-200 bg-emerald-50 text-emerald-950'"
          >
            <div class="flex items-start gap-3">
              <AlertTriangle v-if="closeHasBlockers" class="mt-0.5 h-5 w-5 shrink-0" />
              <CheckCircle2 v-else class="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <h3 class="font-semibold">{{ closeHasBlockers ? "Completion blockers found" : "Ready to complete" }}</h3>
                <p class="mt-1 text-sm">
                  {{
                    closeHasBlockers
                      ? "The system found required document or checklist items that should be resolved before completion."
                      : "Required document categories are present and all checklist tasks are complete."
                  }}
                </p>
              </div>
            </div>
          </div>

          <div class="grid gap-3 sm:grid-cols-3">
            <div class="rounded-md border border-ink-200 p-3">
              <p class="text-xs font-semibold uppercase text-ink-500">Missing docs</p>
              <p class="mt-2 text-2xl font-semibold">{{ readinessMissingDocumentCount }}</p>
            </div>
            <div class="rounded-md border border-ink-200 p-3">
              <p class="text-xs font-semibold uppercase text-ink-500">Open tasks</p>
              <p class="mt-2 text-2xl font-semibold">{{ readinessOpenTaskCount }}</p>
            </div>
            <div class="rounded-md border border-ink-200 p-3">
              <p class="text-xs font-semibold uppercase text-ink-500">Checklist</p>
              <p class="mt-2 text-2xl font-semibold">{{ readiness?.completedTasks ?? 0 }}/{{ readiness?.totalTasks ?? 0 }}</p>
            </div>
          </div>

          <div v-if="closeHasBlockers" class="rounded-md border border-ink-200">
            <div class="border-b border-ink-100 px-4 py-3">
              <h3 class="font-semibold">Items to resolve</h3>
            </div>
            <ul class="max-h-56 divide-y divide-ink-100 overflow-y-auto text-sm">
              <li v-for="blocker in closeBlockers" :key="blocker" class="flex items-start gap-2 px-4 py-3">
                <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <span>{{ blocker }}</span>
              </li>
            </ul>
          </div>

          <label v-if="closeHasBlockers" class="flex items-start gap-3 rounded-md border border-ink-200 p-4 text-sm font-semibold">
            <input
              v-model="closeForce"
              class="mt-0.5 h-4 w-4 rounded border-ink-300 text-accent-700 focus:ring-accent-500"
              type="checkbox"
            />
            <span>
              {{ labels.forceCompleteAction }} with exception reason
              <span class="mt-1 block font-normal text-ink-500">
                Use this only when a manager has approved completion despite missing documents or open tasks.
              </span>
            </span>
          </label>

          <label v-if="closeRequiresReason" class="block text-sm font-semibold">
            Exception reason
            <textarea
              v-model="closeReason"
              class="textarea mt-1"
              placeholder="Example: Manager approved completion with a follow-up task still pending."
            />
            <span class="mt-1 block text-xs font-normal text-ink-500">At least 8 characters. This reason will be saved to the {{ labels.lowerSingular }} timeline and audit log.</span>
          </label>

          <p v-if="closeError || closeAttempt?.message" class="text-sm font-semibold" :class="closeAttempt?.ok ? 'text-emerald-700' : 'text-legal-red'">
            {{ closeError || closeAttempt?.message }}
          </p>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 border-t border-ink-200 px-5 py-4">
          <div class="flex flex-wrap gap-2">
            <button v-if="closeHasBlockers" class="btn-secondary h-9 px-3" type="button" @click="reviewCloseBlockers('documents')">
              Review documents
            </button>
            <button v-if="closeHasBlockers" class="btn-secondary h-9 px-3" type="button" @click="reviewCloseBlockers('tasks')">
              Review tasks
            </button>
          </div>
          <div class="flex gap-2">
            <button class="btn-secondary" type="button" :disabled="closingCase" @click="showCloseCase = false">Cancel</button>
            <button class="btn-primary" type="button" :disabled="!canSubmitClose" @click="closeCase">
              <CheckCircle2 class="h-4 w-4" />
              {{ closingCase ? "Saving..." : closeHasBlockers ? labels.forceCompleteAction : labels.completeAction }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showArchiveCase" class="fixed inset-0 z-50 overflow-y-auto bg-ink-900/45 px-4 py-6">
      <div class="mx-auto max-w-2xl rounded-lg bg-white shadow-soft">
        <div class="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
          <div>
            <p class="text-xs font-semibold uppercase tracking-wide text-legal-red">{{ labels.archiveAction }}</p>
            <h2 class="mt-1 text-lg font-semibold">{{ caseRecord.caseNumber }}</h2>
            <p class="mt-1 text-sm text-ink-500">Remove this {{ labels.lowerSingular }} from active views while preserving database records and audit history.</p>
          </div>
          <button class="btn-secondary h-9 px-3" type="button" :disabled="archivingCase" @click="showArchiveCase = false">
            <X class="h-4 w-4" />
          </button>
        </div>

        <div class="space-y-4 px-5 py-5">
          <div class="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <div class="flex items-start gap-3">
              <AlertTriangle class="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <h3 class="font-semibold">This is a soft archive, not a hard database delete.</h3>
                <p class="mt-1">
                  The {{ labels.lowerSingular }} will disappear from normal lists and dashboard counts. Related contacts, documents, notes, tasks, assets, and audit logs remain available for future recovery or reporting.
                </p>
              </div>
            </div>
          </div>

          <label class="block text-sm font-semibold">
            Archive reason
            <textarea
              v-model="archiveReason"
              class="textarea mt-1"
              :placeholder="`Example: Duplicate test ${labels.lowerSingular} created during demo setup.`"
            />
            <span class="mt-1 block text-xs font-normal text-ink-500">Optional, but recommended. This will be saved to the audit log and {{ labels.lowerSingular }} timeline.</span>
          </label>

          <p v-if="archiveError" class="text-sm font-semibold text-legal-red">{{ archiveError }}</p>
        </div>

        <div class="flex flex-wrap items-center justify-end gap-2 border-t border-ink-200 px-5 py-4">
          <button class="btn-secondary" type="button" :disabled="archivingCase" @click="showArchiveCase = false">Cancel</button>
          <button class="btn-primary bg-legal-red hover:bg-red-800" type="button" :disabled="!canSubmitArchive" @click="archiveCase">
            <Archive class="h-4 w-4" />
            {{ archivingCase ? "Archiving..." : labels.archiveAction }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="showRestoreCase" class="fixed inset-0 z-50 overflow-y-auto bg-ink-900/45 px-4 py-6">
      <div class="mx-auto max-w-2xl rounded-lg bg-white shadow-soft">
        <div class="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
          <div>
            <p class="text-xs font-semibold uppercase tracking-wide text-accent-800">{{ labels.restoreAction }}</p>
            <h2 class="mt-1 text-lg font-semibold">{{ caseRecord.caseNumber }}</h2>
            <p class="mt-1 text-sm text-ink-500">Return this preserved {{ labels.lowerSingular }} to active views so users can continue managing it.</p>
          </div>
          <button class="btn-secondary h-9 px-3" type="button" :disabled="restoringCase" @click="showRestoreCase = false">
            <X class="h-4 w-4" />
          </button>
        </div>

        <div class="space-y-4 px-5 py-5">
          <div class="rounded-md border border-accent-100 bg-accent-50 p-4 text-sm text-accent-950">
            <div class="flex items-start gap-3">
              <RotateCcw class="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <h3 class="font-semibold">The {{ labels.lowerSingular }} record and related data will be preserved.</h3>
                <p class="mt-1">
                  Restoring clears the archive timestamp, brings the {{ labels.lowerSingular }} back into normal lists and dashboard counts, and writes a timeline/audit entry.
                </p>
              </div>
            </div>
          </div>

          <label class="block text-sm font-semibold">
            Restore reason
            <textarea
              v-model="restoreReason"
              class="textarea mt-1"
              placeholder="Example: Duplicate was reviewed and this file is the correct active record."
            />
            <span class="mt-1 block text-xs font-normal text-ink-500">Optional, but useful for future audit review.</span>
          </label>

          <p v-if="restoreError" class="text-sm font-semibold text-legal-red">{{ restoreError }}</p>
        </div>

        <div class="flex flex-wrap items-center justify-end gap-2 border-t border-ink-200 px-5 py-4">
          <button class="btn-secondary" type="button" :disabled="restoringCase" @click="showRestoreCase = false">Cancel</button>
          <button class="btn-primary" type="button" :disabled="!canSubmitRestore" @click="restoreCase">
            <RotateCcw class="h-4 w-4" />
            {{ restoringCase ? "Restoring..." : labels.restoreAction }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="showEditCase" class="fixed inset-0 z-50 overflow-y-auto bg-ink-900/45 px-4 py-6">
      <div class="mx-auto max-w-4xl rounded-lg bg-white shadow-soft">
        <div class="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
          <div>
            <h2 class="text-lg font-semibold">{{ labels.editTitle }}</h2>
            <p class="mt-1 text-sm text-ink-500">{{ labels.editDescription }}</p>
          </div>
          <button class="btn-secondary h-9 px-3" @click="showEditCase = false">
            <X class="h-4 w-4" />
          </button>
        </div>

        <form class="space-y-5 px-5 py-5" @submit.prevent="saveCase">
          <div class="grid gap-3 md:grid-cols-3">
            <label class="text-sm font-semibold">
              {{ labels.numberLabel }}
              <input v-model="editForm.caseNumber" class="input mt-1" required />
            </label>
            <label class="text-sm font-semibold md:col-span-2">
              {{ labels.titleLabel }}
              <input v-model="editForm.propertyAddress" class="input mt-1" required />
            </label>
            <label class="text-sm font-semibold md:col-span-3">
              {{ labels.typeLabel }}
              <select v-model="editForm.caseTypeCode" class="input mt-1">
                <option v-for="caseType in availableCaseTypes" :key="caseType.code" :value="caseType.code">{{ caseType.name }}</option>
              </select>
              <span class="mt-1 block text-xs font-normal text-ink-500">
                {{ selectedEditCaseType?.description || "Controls required document categories and default checklist behavior." }}
              </span>
            </label>
            <label v-if="template.showCustomerOrganization" class="text-sm font-semibold md:col-span-3">
              Customer / Organization
              <select v-model="editForm.customerOrganizationId" class="input mt-1">
                <option :value="null">Unlinked / internal</option>
                <option v-for="organization in partyOrganizations" :key="organization.partyOrganizationId" :value="organization.partyOrganizationId">
                  {{ organization.name }}
                </option>
              </select>
              <span class="mt-1 block text-xs font-normal text-ink-500">Leave unlinked for internal MD3 infrastructure services.</span>
            </label>
            <label class="text-sm font-semibold">
              City
              <input v-model="editForm.city" class="input mt-1" :required="template.requireCityStateZip" />
            </label>
            <label class="text-sm font-semibold">
              State
              <input v-model="editForm.state" class="input mt-1" maxlength="2" :required="template.requireCityStateZip" />
            </label>
            <label class="text-sm font-semibold">
              ZIP code
              <input v-model="editForm.zipCode" class="input mt-1" :required="template.requireCityStateZip" />
            </label>
            <label v-if="template.showPropertyType" class="text-sm font-semibold">
              Property type
              <select v-model="editForm.propertyType" class="input mt-1">
                <option v-for="type in PROPERTY_TYPES" :key="type" :value="type">{{ type }}</option>
              </select>
            </label>
            <label v-if="template.showValueField" class="text-sm font-semibold">
              {{ labels.valueLabel }}
              <input v-model="salePriceDollars" class="input mt-1" inputmode="decimal" />
            </label>
            <label class="text-sm font-semibold">
              {{ labels.targetDateLabel }}
              <input v-model="editForm.closingDate" class="input mt-1" type="date" required />
            </label>
            <label class="text-sm font-semibold">
              Status
              <select v-model="editForm.status" class="input mt-1">
                <option v-for="status in editableCaseStatuses" :key="status" :value="status">{{ status }}</option>
              </select>
              <span v-if="caseRecord.status !== 'Closed'" class="mt-1 block text-xs font-normal text-ink-500">
                Use the {{ labels.completeAction }} workflow to set status to Closed.
              </span>
            </label>
            <fieldset class="md:col-span-2">
              <legend class="text-sm font-semibold">Tags</legend>
              <div class="mt-1 grid max-h-36 gap-2 overflow-y-auto rounded-md border border-ink-200 bg-white p-3 sm:grid-cols-2">
                <label v-for="tag in tags" :key="tag.tagId" class="flex items-center gap-2 text-sm font-medium text-ink-700">
                  <input
                    class="h-4 w-4 rounded border-ink-300 text-accent-700 focus:ring-accent-500"
                    type="checkbox"
                    :checked="selectedTagIds.includes(tag.tagId)"
                    @change="toggleTag(tag.tagId, ($event.target as HTMLInputElement).checked)"
                  />
                  <span>{{ tag.name }}</span>
                </label>
              </div>
            </fieldset>
          </div>

          <div v-if="selectedTags.length" class="flex flex-wrap gap-2">
            <TagChip v-for="tag in selectedTags" :key="tag.tagId" :tag="tag" />
          </div>

          <label class="block text-sm font-semibold">
            Notes
            <textarea v-model="editForm.notes" class="textarea mt-1" />
          </label>

          <p v-if="formError" class="text-sm font-semibold text-legal-red">{{ formError }}</p>

          <div class="flex justify-end gap-2 border-t border-ink-200 pt-4">
            <button class="btn-secondary" type="button" @click="showEditCase = false">Cancel</button>
            <button class="btn-primary" type="submit" :disabled="busy">
              <Save class="h-4 w-4" />
              {{ busy ? "Saving..." : "Save changes" }}
            </button>
          </div>
        </form>
      </div>
    </div>
    <MarkdownReaderDialog
      :model-value="Boolean(discussionReaderMessage)"
      :source="discussionReaderMessage?.bodyText ?? ''"
      :title="discussionReaderMessage ? discussionReaderTitle(discussionReaderMessage) : 'Service discussion'"
      @update:model-value="(value) => { if (!value) discussionReaderMessage = null; }"
    />
  </div>
</template>
