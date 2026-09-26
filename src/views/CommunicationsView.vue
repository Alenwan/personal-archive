<script setup lang="ts">
import {
  Archive,
  Ban,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  Clock,
  ExternalLink,
  HardDrive,
  Inbox,
  Link2,
  Mail,
  MessageSquare,
  PhoneCall,
  Plus,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  UserRound,
  Trash2,
  X
} from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { client } from "../api/client";
import { useBusinessTemplate, workItemPath } from "../businessTemplate";
import PageHeader from "../components/PageHeader.vue";
import {
  cleanEmailBody,
  communicationLooksLikeTestRecord,
  communicationSenderLabel,
  communicationPreviewText,
  emailAddressList,
  emailAddressListText,
  emailThreadMessageSenderLabel,
  metadataString,
  parseGmailThreadMessages
} from "../shared/communicationDisplay";
import { contactDisplayName, formatDateTime, formatDateTimeIfValid } from "../shared/format";
import {
  COMMUNICATION_CHANNELS,
  COMMUNICATION_DIRECTIONS,
  COMMUNICATION_SOURCES,
  COMMUNICATION_STATUSES,
  COMMUNICATION_TYPES,
  type CaseRecord,
  type CommunicationChannel,
  type CommunicationFilters,
  type CommunicationInput,
  type CommunicationRecord,
  type CommunicationSource,
  type CommunicationStatus,
  type CommunicationType,
  type Contact,
  type ManagedAsset,
  type PartyOrganization,
  type PublicUser,
  type SavedDirectoryView
} from "../shared/types";
import { useAuthStore } from "../stores/auth";
import { useToastStore } from "../stores/toasts";

type InboxView = "inbox" | "followUp" | "linked" | "archived" | "all";

const DRAFT_STORAGE_PREFIX = "md3-platform.communication-draft.";
const INBOX_VIEWS: InboxView[] = ["inbox", "followUp", "linked", "archived", "all"];
const FILTER_QUERY_KEYS = [
  "q",
  "status",
  "communicationType",
  "direction",
  "source",
  "followUpAssignedTo",
  "followUpDueFrom",
  "followUpDueTo",
  "caseId",
  "partyOrganizationId",
  "contactId",
  "assetId",
  "dateFrom",
  "dateTo"
] as const;

const auth = useAuthStore();
const toasts = useToastStore();
const route = useRoute();
const router = useRouter();
const { labels } = useBusinessTemplate();

const communications = ref<CommunicationRecord[]>([]);
const services = ref<CaseRecord[]>([]);
const contacts = ref<Contact[]>([]);
const organizations = ref<PartyOrganization[]>([]);
const assets = ref<ManagedAsset[]>([]);
const users = ref<PublicUser[]>([]);
const savedViews = ref<SavedDirectoryView[]>([]);
const selectedSavedViewId = ref("");
const savedViewName = ref("");
const showSavedViewEditor = ref(false);
const loading = ref(true);
const page = ref(1);
const pageSize = ref(25);
const totalCommunications = ref(0);
const totalPages = ref(1);
const selectedCommunicationIds = ref<string[]>([]);
const bulkCaseId = ref("");
const saving = ref(false);
const formError = ref("");
const activeChannel = ref<CommunicationChannel>("all");
const activeView = ref<InboxView>("inbox");
const selectedCommunicationId = ref("");
const showLogForm = ref(false);
const showAdvancedFilters = ref(false);
const hideTestRecords = ref(true);
const editingServiceLinkId = ref("");
const pendingCaseLinks = reactive<Record<string, string>>({});
const followUpDrafts = reactive<Record<string, { assignedTo: string; dueDate: string }>>({});
const draftNotice = ref("");
let applyingRouteQuery = false;
let filterRouteSyncTimer: ReturnType<typeof setTimeout> | null = null;
let listReloadTimer: ReturnType<typeof setTimeout> | null = null;

const filters = reactive({
  q: "",
  status: "" as CommunicationStatus | "",
  communicationType: "" as CommunicationType | "",
  direction: "",
  source: "" as CommunicationSource | "",
  followUpAssignedTo: "",
  followUpDueFrom: "",
  followUpDueTo: "",
  caseId: "",
  partyOrganizationId: "",
  contactId: "",
  assetId: "",
  dateFrom: "",
  dateTo: ""
});
const sortOption = ref("occurred_desc");

const sortParts = computed(() => {
  const [sort, sortDirection] = sortOption.value.split("_");
  return {
    sort: (sort || "occurred") as CommunicationFilters["sort"],
    sortDirection: (sortDirection || "desc") as CommunicationFilters["sortDirection"]
  };
});

const communicationFilters = computed<CommunicationFilters>(() => ({
  q: filters.q,
  status: filters.status,
  channel: activeChannel.value,
  communicationType: filters.communicationType,
  direction: filters.direction as CommunicationFilters["direction"],
  source: filters.source,
  followUpAssignedTo: filters.followUpAssignedTo,
  followUpDueFrom: filters.followUpDueFrom,
  followUpDueTo: filters.followUpDueTo,
  caseId: filters.caseId,
  partyOrganizationId: filters.partyOrganizationId,
  contactId: filters.contactId,
  assetId: filters.assetId,
  dateFrom: filters.dateFrom,
  dateTo: filters.dateTo,
  workflowView: activeView.value,
  sort: sortParts.value.sort,
  sortDirection: sortParts.value.sortDirection
}));

const form = reactive<CommunicationInput>({
  caseId: null,
  partyOrganizationId: null,
  contactId: null,
  assetId: null,
  supportingDocumentId: null,
  communicationType: "Call",
  direction: "Inbound",
  source: "Manual",
  status: "Logged",
  followUpAssignedTo: null,
  followUpDueDate: null,
  externalProvider: "",
  externalReference: "",
  externalUrl: "",
  sourceMetadata: {},
  subject: "",
  body: "",
  occurredAt: localDateTimeInputValue()
});

const orderedCommunications = computed(() =>
  communications.value.slice().sort((a, b) => compareCommunications(a, b, activeView.value))
);

const testCommunicationCount = computed(() => orderedCommunications.value.filter(communicationLooksLikeTestRecord).length);

const dayToDayCommunications = computed(() =>
  hideTestRecords.value ? orderedCommunications.value.filter((communication) => !communicationLooksLikeTestRecord(communication)) : orderedCommunications.value
);

const channelOptions = [
  { id: "all" as const, label: "All", helper: "Every communication", icon: Inbox },
  { id: "calls" as const, label: "Calls", helper: "Manual and PBX call records", icon: PhoneCall },
  { id: "emails" as const, label: "Emails", helper: "Gmail, Outlook, and manual email records", icon: Mail },
  { id: "other" as const, label: "Other", helper: "SMS, voicemail, updates, decisions, and notes", icon: MessageSquare }
];

const viewOptions = [
  {
    id: "inbox" as const,
    label: "Inbox",
    helper: "New or logged",
    icon: Inbox
  },
  {
    id: "followUp" as const,
    label: "Needs follow-up",
    helper: "Call back or act",
    icon: Clock
  },
  {
    id: "linked" as const,
    label: "Linked",
    helper: "Filed to services",
    icon: Link2
  },
  {
    id: "archived" as const,
    label: "Archived",
    helper: "Kept, not deleted",
    icon: Archive
  },
  {
    id: "all" as const,
    label: "All",
    helper: "Everything",
    icon: MessageSquare
  }
];

const communicationTypeOptions = computed(() =>
  activeChannel.value === "other"
    ? COMMUNICATION_TYPES.filter((type) => type !== "Call" && type !== "Email")
    : COMMUNICATION_TYPES
);

const showCommunicationTypeFilter = computed(() => activeChannel.value === "all" || activeChannel.value === "other");

const communicationSearchPlaceholder = computed(() => {
  if (activeChannel.value === "calls") return "Search numbers, callers, contacts, services...";
  if (activeChannel.value === "emails") return "Search subjects, senders, recipients, services...";
  if (activeChannel.value === "other") return "Search notes, messages, updates, contacts, services...";
  return "Search mail, calls, contacts, services...";
});

const logCommunicationLabel = computed(() => {
  if (activeChannel.value === "calls") return "Log call";
  if (activeChannel.value === "emails") return "Log email";
  if (activeChannel.value === "other") return "Log note or update";
  return "Log communication";
});

const filteredCommunications = computed(() => {
  const q = filters.q.trim().toLowerCase();
  return dayToDayCommunications.value
    .filter((communication) => {
      if (!communicationMatchesChannel(communication, activeChannel.value)) return false;
      if (activeView.value === "inbox" && !isInboxCommunication(communication)) return false;
      if (activeView.value === "followUp" && communication.status !== "Needs follow-up") return false;
      if (activeView.value === "linked" && (communication.status === "Ignored / Spam" || !communication.caseId)) return false;
      if (activeView.value === "archived" && communication.status !== "Ignored / Spam") return false;
      if (filters.status && communication.status !== filters.status) return false;
      if (filters.communicationType && communication.communicationType !== filters.communicationType) return false;
      if (filters.direction && communication.direction !== filters.direction) return false;
      if (filters.source && communication.source !== filters.source) return false;
      if (filters.followUpAssignedTo && communication.followUpAssignedTo !== filters.followUpAssignedTo) return false;
      if (filters.followUpDueFrom && (!communication.followUpDueDate || communication.followUpDueDate < filters.followUpDueFrom)) return false;
      if (filters.followUpDueTo && (!communication.followUpDueDate || communication.followUpDueDate > filters.followUpDueTo)) return false;
      if (filters.caseId && communication.caseId !== filters.caseId) return false;
      if (filters.partyOrganizationId && communication.partyOrganizationId !== filters.partyOrganizationId) return false;
      if (filters.contactId && communication.contactId !== filters.contactId) return false;
      if (filters.assetId && communication.assetId !== filters.assetId) return false;
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
          metadataString(communication, "snippet"),
          emailAddressListText(emailAddressList(communication, "from")),
          emailAddressListText(emailAddressList(communication, "to")),
          metadataString(communication, "callerNumber"),
          metadataString(communication, "destination")
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => compareCommunications(a, b, activeView.value));
});

const selectedCommunication = computed<CommunicationRecord | null>(() => {
  if (!filteredCommunications.value.length) return null;
  return (
    filteredCommunications.value.find((communication) => communication.communicationId === selectedCommunicationId.value) ??
    filteredCommunications.value[0]
  );
});

const selectedGmailThreadMessages = computed(() =>
  selectedCommunication.value ? parseGmailThreadMessages(selectedCommunication.value) : []
);
const selectedCommunicationCount = computed(() => selectedCommunicationIds.value.length);
const currentPageAllSelected = computed(
  () =>
    filteredCommunications.value.length > 0 &&
    filteredCommunications.value.every((communication) => selectedCommunicationIds.value.includes(communication.communicationId))
);

const activeFilterCount = computed(
  () =>
    [
      filters.q,
      filters.status,
      filters.communicationType,
      filters.direction,
      filters.source,
      filters.followUpAssignedTo,
      filters.followUpDueFrom,
      filters.followUpDueTo,
      filters.caseId,
      filters.partyOrganizationId,
      filters.contactId,
      filters.assetId,
      filters.dateFrom,
      filters.dateTo
    ].filter(Boolean).length
);

type CommunicationFilterKey = keyof typeof filters;

const activeFilterChips = computed<Array<{ key: CommunicationFilterKey; label: string }>>(() => {
  const chips: Array<{ key: CommunicationFilterKey; label: string }> = [];
  const service = services.value.find((item) => item.caseId === filters.caseId);
  const organization = organizations.value.find((item) => item.partyOrganizationId === filters.partyOrganizationId);
  const contact = contacts.value.find((item) => item.contactId === filters.contactId);
  const asset = assets.value.find((item) => item.assetId === filters.assetId);
  const followUpOwner = users.value.find((item) => item.userId === filters.followUpAssignedTo);

  if (filters.q) chips.push({ key: "q", label: `Search: ${filters.q}` });
  if (filters.status) chips.push({ key: "status", label: `Status: ${statusLabel(filters.status)}` });
  if (filters.communicationType) chips.push({ key: "communicationType", label: `Type: ${filters.communicationType}` });
  if (filters.direction) chips.push({ key: "direction", label: `Direction: ${filters.direction}` });
  if (filters.source) chips.push({ key: "source", label: `Source: ${filters.source}` });
  if (filters.followUpAssignedTo) chips.push({ key: "followUpAssignedTo", label: `Owner: ${followUpOwner?.name ?? filters.followUpAssignedTo}` });
  if (filters.followUpDueFrom) chips.push({ key: "followUpDueFrom", label: `Due from: ${filters.followUpDueFrom}` });
  if (filters.followUpDueTo) chips.push({ key: "followUpDueTo", label: `Due to: ${filters.followUpDueTo}` });
  if (filters.caseId) chips.push({ key: "caseId", label: `Service: ${service ? serviceOptionLabel(service) : filters.caseId}` });
  if (filters.partyOrganizationId) chips.push({ key: "partyOrganizationId", label: `Organization: ${organization?.name ?? filters.partyOrganizationId}` });
  if (filters.contactId) chips.push({ key: "contactId", label: `Contact: ${contact ? contactOptionLabel(contact) : filters.contactId}` });
  if (filters.assetId) chips.push({ key: "assetId", label: `Asset: ${asset ? `${asset.name} · ${asset.assetType}` : filters.assetId}` });
  if (filters.dateFrom) chips.push({ key: "dateFrom", label: `From: ${filters.dateFrom}` });
  if (filters.dateTo) chips.push({ key: "dateTo", label: `To: ${filters.dateTo}` });
  return chips;
});

watch(
  () => form.caseId,
  (caseId) => {
    if (caseId && form.status === "New") form.status = "Linked";
  }
);

watch(
  filteredCommunications,
  (rows) => {
    if (!rows.length) {
      selectedCommunicationId.value = "";
      return;
    }
    if (!selectedCommunicationId.value || !rows.some((communication) => communication.communicationId === selectedCommunicationId.value)) {
      selectedCommunicationId.value = rows[0].communicationId;
    }
  },
  { immediate: true }
);

function localDateTimeInputValue(value: Date | string = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return localDateTimeInputValue(new Date());
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function dateTimeInputToIso(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function todayDate(): string {
  return localDateTimeInputValue().slice(0, 10);
}

function compareCommunications(a: CommunicationRecord, b: CommunicationRecord, view: InboxView): number {
  if (view === "followUp") {
    const aDue = a.followUpDueDate || "9999-12-31";
    const bDue = b.followUpDueDate || "9999-12-31";
    if (aDue !== bDue) return aDue.localeCompare(bDue);
  }
  return b.occurredAt.localeCompare(a.occurredAt) || b.createdAt.localeCompare(a.createdAt);
}

function isInboxCommunication(communication: CommunicationRecord): boolean {
  return communication.status === "New" || communication.status === "Logged";
}

function channelForCommunication(communication: CommunicationRecord): CommunicationChannel {
  if (communication.communicationType === "Call") return "calls";
  if (communication.communicationType === "Email") return "emails";
  return "other";
}

function communicationMatchesChannel(communication: CommunicationRecord, channel: CommunicationChannel): boolean {
  return channel === "all" || channelForCommunication(communication) === channel;
}

function communicationTypeMatchesChannel(type: CommunicationType, channel: CommunicationChannel): boolean {
  if (channel === "all") return true;
  if (channel === "calls") return type === "Call";
  if (channel === "emails") return type === "Email";
  return type !== "Call" && type !== "Email";
}

function defaultCommunicationTypeForChannel(channel: CommunicationChannel): CommunicationType {
  if (channel === "emails") return "Email";
  if (channel === "other") return "Internal Note";
  return "Call";
}

function communicationIcon(communication: CommunicationRecord) {
  if (communication.communicationType === "Email") return Mail;
  if (communication.communicationType === "Call" || communication.source === "Asterisk / PBX") return PhoneCall;
  return MessageSquare;
}

function statusClass(status: CommunicationStatus) {
  if (status === "Needs follow-up") return "bg-amber-100 text-amber-900";
  if (status === "Linked") return "bg-teal-100 text-teal-900";
  if (status === "Ignored / Spam") return "bg-red-100 text-red-900";
  if (status === "New") return "bg-blue-100 text-blue-900";
  return "bg-ink-100 text-ink-700";
}

function statusLabel(status: CommunicationStatus) {
  if (status === "Ignored / Spam") return "Archived";
  return status;
}

function isFollowUpOverdue(communication: CommunicationRecord): boolean {
  return communication.status === "Needs follow-up" && Boolean(communication.followUpDueDate && communication.followUpDueDate < todayDate());
}

function followUpSummary(communication: CommunicationRecord): string {
  return [
    communication.followUpAssignedToName ? `Owner: ${communication.followUpAssignedToName}` : "No owner",
    communication.followUpDueDate ? `Due: ${communication.followUpDueDate}` : "No due date"
  ].join(" · ");
}

function senderLabel(communication: CommunicationRecord): string {
  return communicationSenderLabel(communication);
}

function messageSenderLabel(communication: CommunicationRecord, rawSender: string): string {
  return emailThreadMessageSenderLabel(communication, rawSender);
}

function secondaryLabel(communication: CommunicationRecord): string {
  const parts = [
    communication.contactName,
    communication.partyOrganizationName,
    communication.caseNumber,
    communication.assetName,
    communication.externalProvider || communication.source
  ].filter(Boolean);
  return [...new Set(parts)].join(" · ");
}

function sourceMetadataText(communication: CommunicationRecord) {
  const callerNumber = metadataString(communication, "callerNumber");
  const destination = metadataString(communication, "destination");
  return [callerNumber, destination].filter(Boolean).join(" -> ");
}

function emailHeaderRows(communication: CommunicationRecord) {
  const emailDate = metadataString(communication, "date");
  return [
    ["From", emailAddressListText(emailAddressList(communication, "from"))],
    ["To", emailAddressListText(emailAddressList(communication, "to"))],
    ["Cc", emailAddressListText(emailAddressList(communication, "cc"))],
    ["Date", emailDate ? formatDateTimeIfValid(emailDate) : formatDateTime(communication.occurredAt)]
  ].filter(([, value]) => value);
}

function callDetailRows(communication: CommunicationRecord) {
  const startedAt = metadataString(communication, "startedAt");
  const answeredAt = metadataString(communication, "answeredAt");
  const endedAt = metadataString(communication, "endedAt");
  return [
    ["Caller", metadataString(communication, "callerNumber")],
    ["Raw caller", metadataString(communication, "rawCallerNumber")],
    ["Destination", metadataString(communication, "destination")],
    ["Extension", metadataString(communication, "extension")],
    ["Call status", metadataString(communication, "status")],
    ["Started", startedAt ? formatDateTimeIfValid(startedAt) : ""],
    ["Answered", answeredAt ? formatDateTimeIfValid(answeredAt) : ""],
    ["Ended", endedAt ? formatDateTimeIfValid(endedAt) : ""]
  ].filter(([, value]) => value);
}

function sourceDetailRows(communication: CommunicationRecord) {
  return [
    ["Source", communication.source],
    ["Provider", communication.externalProvider],
    ["External reference", communication.externalReference],
    ["Gmail thread ID", metadataString(communication, "gmailThreadId")],
    ["Gmail message ID", metadataString(communication, "gmailMessageId")],
    ["RFC message ID", metadataString(communication, "rfcMessageId")],
    ["Caller number", metadataString(communication, "callerNumber")],
    ["Destination", metadataString(communication, "destination")],
    ["PBX call ID", metadataString(communication, "callId")]
  ].filter(([, value]) => value);
}

function metadataJson(communication: CommunicationRecord): string {
  return JSON.stringify(communication.sourceMetadata ?? {}, null, 2);
}

function emptyBodyText(communication: CommunicationRecord): string {
  if (communication.source === "Asterisk / PBX") return "No call note has been added yet.";
  if (communication.source === "Gmail") return "No email body was saved for this communication.";
  return "No message body was saved for this communication.";
}

function routeQueryString(key: string): string {
  const value = route.query[key];
  return typeof value === "string" ? value : "";
}

function routeFilterQuery() {
  const query: Record<string, string> = {};
  for (const key of FILTER_QUERY_KEYS) {
    const value = routeQueryString(key);
    if (value) query[key] = value;
  }
  const view = routeQueryString("view") as InboxView;
  if (INBOX_VIEWS.includes(view) && view !== "inbox") query.view = view;
  const channel = routeQueryString("channel") as CommunicationChannel;
  if (COMMUNICATION_CHANNELS.includes(channel) && channel !== "all") query.channel = channel;
  return query;
}

function queriesMatch(first: Record<string, string>, second: Record<string, string>) {
  const keys = [...new Set([...Object.keys(first), ...Object.keys(second)])];
  return keys.every((key) => first[key] === second[key]);
}

function applyFiltersFromRoute() {
  applyingRouteQuery = true;
  activeChannel.value = "all";
  activeView.value = "inbox";
  Object.assign(filters, {
    q: "",
    status: "",
    communicationType: "",
    direction: "",
    source: "",
    followUpAssignedTo: "",
    followUpDueFrom: "",
    followUpDueTo: "",
    caseId: "",
    partyOrganizationId: "",
    contactId: "",
    assetId: "",
    dateFrom: "",
    dateTo: ""
  });

  const view = routeQueryString("view") as InboxView;
  if (INBOX_VIEWS.includes(view)) activeView.value = view;
  const channel = routeQueryString("channel") as CommunicationChannel;
  if (COMMUNICATION_CHANNELS.includes(channel)) activeChannel.value = channel;

  const routeFilters = {
    q: routeQueryString("q"),
    status: routeQueryString("status") as CommunicationStatus | "",
    communicationType: routeQueryString("communicationType") as CommunicationType | "",
    direction: routeQueryString("direction"),
    source: routeQueryString("source") as CommunicationSource | "",
    followUpAssignedTo: routeQueryString("followUpAssignedTo"),
    followUpDueFrom: routeQueryString("followUpDueFrom"),
    followUpDueTo: routeQueryString("followUpDueTo"),
    caseId: routeQueryString("caseId"),
    partyOrganizationId: routeQueryString("partyOrganizationId"),
    contactId: routeQueryString("contactId"),
    assetId: routeQueryString("assetId"),
    dateFrom: routeQueryString("dateFrom"),
    dateTo: routeQueryString("dateTo")
  };

  for (const [key, value] of Object.entries(routeFilters)) {
    if (value) (filters as Record<string, string>)[key] = value;
  }

  if (!COMMUNICATION_CHANNELS.includes(channel) && routeFilters.communicationType) {
    activeChannel.value =
      routeFilters.communicationType === "Call" ? "calls" : routeFilters.communicationType === "Email" ? "emails" : "other";
  }
  if (filters.communicationType && !communicationTypeMatchesChannel(filters.communicationType, activeChannel.value)) {
    filters.communicationType = "";
  }

  showAdvancedFilters.value = Boolean(
    routeFilters.status ||
      routeFilters.followUpAssignedTo ||
      routeFilters.followUpDueFrom ||
      routeFilters.followUpDueTo ||
      routeFilters.caseId ||
      routeFilters.partyOrganizationId ||
      routeFilters.contactId ||
      routeFilters.assetId ||
      routeFilters.dateFrom ||
      routeFilters.dateTo
  );
  setTimeout(() => {
    applyingRouteQuery = false;
  }, 0);
}

function preferredViewForCommunication(communication: CommunicationRecord): InboxView {
  if (communication.status === "Ignored / Spam") return "archived";
  if (communication.status === "Needs follow-up") return "followUp";
  if (communication.caseId) return "linked";
  return "inbox";
}

function serviceOptionLabel(service: CaseRecord) {
  return [service.caseNumber, service.propertyAddress].filter(Boolean).join(" · ");
}

function contactOptionLabel(contact: Contact) {
  return [contactDisplayName(contact), contact.partyOrganizationName, contact.phone].filter(Boolean).join(" · ");
}

function resolvedStatus(communication: CommunicationRecord): CommunicationStatus {
  return communication.caseId ? "Linked" : "Logged";
}

function nextActionText(communication: CommunicationRecord): string {
  if (communication.status === "Ignored / Spam") {
    return "This record is archived and hidden from daily views. Restore it only if it needs attention again.";
  }
  if (communication.status === "Needs follow-up") {
    const followUp = followUpSummary(communication);
    return communication.caseId
      ? `Follow-up is still open. ${followUp}. After handling it, mark it reviewed or change the service if it was filed incorrectly.`
      : `Follow-up is still open. ${followUp}. After handling it, mark it reviewed or link it if the related service becomes clear.`;
  }
  if (communication.caseId) {
    return "This record is filed to a service. Add follow-up if work remains, or change the service if it was filed incorrectly.";
  }
  if (communication.status === "New") {
    return "New unlinked record. Review it, then mark it reviewed, follow up, archive it, or link it when the service is clear.";
  }
  return "Reviewed but unlinked. It can stay in Communications, be archived, or be linked later if a service becomes clear.";
}

function resetForm() {
  Object.assign(form, {
    caseId: null,
    partyOrganizationId: null,
    contactId: null,
    assetId: null,
    supportingDocumentId: null,
    communicationType: defaultCommunicationTypeForChannel(activeChannel.value),
    direction: "Inbound",
    source: "Manual",
    status: "Logged",
    followUpAssignedTo: null,
    followUpDueDate: null,
    externalProvider: "",
    externalReference: "",
    externalUrl: "",
    sourceMetadata: {},
    subject: "",
    body: "",
    occurredAt: localDateTimeInputValue()
  });
  draftNotice.value = "";
}

function openManualCommunicationLog() {
  resetForm();
  formError.value = "";
  showLogForm.value = true;
}

function closeLogForm() {
  resetForm();
  formError.value = "";
  showLogForm.value = false;
}

function applyDraftFromRoute() {
  const focusedId = typeof route.query.focus === "string" ? route.query.focus : "";
  if (focusedId) {
    const explicitView = INBOX_VIEWS.includes(routeQueryString("view") as InboxView);
    const explicitChannel = COMMUNICATION_CHANNELS.includes(routeQueryString("channel") as CommunicationChannel);
    selectedCommunicationId.value = focusedId;
    const focused = communications.value.find((communication) => communication.communicationId === focusedId);
    if (focused?.caseId) pendingCaseLinks[focused.communicationId] = focused.caseId;
    if (focused && !explicitView) activeView.value = preferredViewForCommunication(focused);
    if (focused && !explicitChannel) activeChannel.value = channelForCommunication(focused);
  }

  const draftId = typeof route.query.draft === "string" ? route.query.draft : "";
  if (!draftId) return;
  const raw = sessionStorage.getItem(`${DRAFT_STORAGE_PREFIX}${draftId}`);
  if (!raw) return;
  try {
    const draft = JSON.parse(raw) as Partial<CommunicationInput> & { draftNotice?: string };
    Object.assign(form, {
      ...form,
      ...draft,
      occurredAt: localDateTimeInputValue(draft.occurredAt ?? new Date())
    });
    draftNotice.value = draft.draftNotice ?? "Prepared from PBX call.";
    formError.value = "";
    showLogForm.value = true;
    sessionStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${draftId}`);
    void router.replace({ path: "/communications" });
  } catch {
    sessionStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${draftId}`);
  }
}

async function load() {
  loading.value = true;
  try {
    const [communicationPage, servicePage, contactPage, organizationPage, assetPage, userRows, savedViewRows] = await Promise.all([
      client.communicationsPage(communicationFilters.value, { page: page.value, pageSize: pageSize.value }),
      client.casesPage({ archiveStatus: "all", sort: "number", direction: "desc" }, { pageSize: 100 }),
      client.contactsPage({}, { pageSize: 100 }),
      client.partyOrganizationsPage({ sort: "name", direction: "asc" }, { pageSize: 100 }),
      client.assetsPage({ sort: "name", direction: "asc" }, { pageSize: 100 }),
      client.users(),
      client.savedDirectoryViews("communications")
    ]);
    communications.value = communicationPage.items;
    totalCommunications.value = communicationPage.total;
    totalPages.value = communicationPage.totalPages;
    page.value = communicationPage.page;
    services.value = servicePage.items;
    contacts.value = contactPage.items;
    organizations.value = organizationPage.items;
    assets.value = assetPage.items;
    users.value = userRows;
    savedViews.value = savedViewRows;
    selectedCommunicationIds.value = selectedCommunicationIds.value.filter((id) =>
      communicationPage.items.some((communication) => communication.communicationId === id)
    );
    for (const communication of communicationPage.items) {
      pendingCaseLinks[communication.communicationId] = communication.caseId ?? "";
      followUpDrafts[communication.communicationId] = {
        assignedTo: communication.followUpAssignedTo ?? auth.user?.userId ?? "",
        dueDate: communication.followUpDueDate ?? ""
      };
    }
    applyDraftFromRoute();
  } finally {
    loading.value = false;
  }
}

async function saveCommunication() {
  if (!form.subject.trim()) return;
  saving.value = true;
  formError.value = "";
  try {
    const communication = await client.createGlobalCommunication({
      ...form,
      caseId: form.caseId || null,
      partyOrganizationId: form.partyOrganizationId || null,
      contactId: form.contactId || null,
      assetId: form.assetId || null,
      supportingDocumentId: form.supportingDocumentId || null,
      followUpAssignedTo: form.status === "Needs follow-up" ? form.followUpAssignedTo || null : null,
      followUpDueDate: form.status === "Needs follow-up" ? form.followUpDueDate || null : null,
      externalProvider: form.externalProvider?.trim() ?? "",
      externalReference: form.externalReference?.trim() ?? "",
      externalUrl: form.externalUrl?.trim() ?? "",
      subject: form.subject.trim(),
      body: form.body.trim(),
      occurredAt: dateTimeInputToIso(form.occurredAt)
    });
    toasts.success("Communication logged", "The communication is now in the inbox.");
    closeLogForm();
    await load();
    focusCommunicationRecord(communication);
  } catch (error) {
    formError.value = error instanceof Error ? error.message : "Unable to save communication";
    toasts.error("Unable to save communication", formError.value);
  } finally {
    saving.value = false;
  }
}

async function updateStatus(communication: CommunicationRecord, status: CommunicationStatus) {
  const updated = await client.updateCommunication(communication.communicationId, {
    status,
    followUpAssignedTo: status === "Needs follow-up" ? communication.followUpAssignedTo ?? auth.user?.userId ?? null : null,
    followUpDueDate: status === "Needs follow-up" ? communication.followUpDueDate ?? null : null
  });
  if (status === "Ignored / Spam") {
    toasts.success("Communication archived", "The record is kept and can be restored from Archived or All.");
  } else {
    toasts.success("Communication updated", `Status set to ${status}.`);
  }
  await load();
  focusCommunicationRecord(updated);
}

async function saveFollowUp(communication: CommunicationRecord) {
  const draft = followUpDrafts[communication.communicationId] ?? {
    assignedTo: communication.followUpAssignedTo ?? auth.user?.userId ?? "",
    dueDate: communication.followUpDueDate ?? ""
  };
  const updated = await client.updateCommunication(communication.communicationId, {
    status: "Needs follow-up",
    followUpAssignedTo: draft.assignedTo || null,
    followUpDueDate: draft.dueDate || null
  });
  toasts.success("Follow-up saved", "The communication is now tracked in Needs follow-up.");
  await load();
  focusCommunicationRecord(updated);
}

async function saveServiceLink(communication: CommunicationRecord) {
  const caseId = pendingCaseLinks[communication.communicationId] || null;
  const updated = await client.updateCommunication(communication.communicationId, {
    caseId,
    status: caseId ? "Linked" : "Logged"
  });
  editingServiceLinkId.value = "";
  toasts.success(caseId ? "Linked to service" : "Service link cleared", "The communication record was updated.");
  await load();
  focusCommunicationRecord(updated);
}

function startServiceLinkEdit(communication: CommunicationRecord) {
  pendingCaseLinks[communication.communicationId] = communication.caseId ?? "";
  editingServiceLinkId.value = communication.communicationId;
}

function cancelServiceLinkEdit(communication: CommunicationRecord) {
  pendingCaseLinks[communication.communicationId] = communication.caseId ?? "";
  editingServiceLinkId.value = "";
}

function clearFilters() {
  Object.assign(filters, {
    q: "",
    status: "",
    communicationType: "",
    direction: "",
    source: "",
    followUpAssignedTo: "",
    followUpDueFrom: "",
    followUpDueTo: "",
    caseId: "",
    partyOrganizationId: "",
    contactId: "",
    assetId: "",
    dateFrom: "",
    dateTo: ""
  });
  sortOption.value = "occurred_desc";
  page.value = 1;
  selectedSavedViewId.value = "";
  savedViewName.value = "";
  showSavedViewEditor.value = false;
  showAdvancedFilters.value = false;
  const query = currentCommunicationQuery();
  void router.replace({ path: "/communications", query });
}

function clearFilter(key: CommunicationFilterKey) {
  (filters as unknown as Record<CommunicationFilterKey, string>)[key] = "";
}

function currentFilterQuery() {
  const query: Record<string, string> = {};
  for (const key of FILTER_QUERY_KEYS) {
    const value = String(filters[key] ?? "").trim();
    if (value) query[key] = value;
  }
  return query;
}

function currentCommunicationQuery() {
  const query = currentFilterQuery();
  if (activeView.value !== "inbox") query.view = activeView.value;
  if (activeChannel.value !== "all") query.channel = activeChannel.value;
  return query;
}

function scheduleFilterRouteSync() {
  if (applyingRouteQuery) return;
  if (filterRouteSyncTimer) clearTimeout(filterRouteSyncTimer);
  filterRouteSyncTimer = setTimeout(() => {
    filterRouteSyncTimer = null;
    const query = currentCommunicationQuery();
    if (!queriesMatch(query, routeFilterQuery())) {
      void router.replace({ path: "/communications", query });
    }
  }, 250);
}

function selectView(view: InboxView) {
  activeView.value = view;
  page.value = 1;
  const query = currentCommunicationQuery();
  void router.replace({ path: "/communications", query });
}

function selectChannel(channel: CommunicationChannel) {
  activeChannel.value = channel;
  if (filters.communicationType && !communicationTypeMatchesChannel(filters.communicationType, channel)) {
    filters.communicationType = "";
  }
  page.value = 1;
  selectedCommunicationIds.value = [];
  const query = currentCommunicationQuery();
  void router.replace({ path: "/communications", query });
}

function selectCommunication(communicationId: string) {
  focusCommunication(communicationId);
}

function focusCommunication(communicationId: string, view?: InboxView) {
  if (view) activeView.value = view;
  selectedCommunicationId.value = communicationId;
  const query = currentCommunicationQuery();
  query.focus = communicationId;
  void router.replace({
    path: "/communications",
    query
  });
}

function clearConflictingFocusFilters(communication: CommunicationRecord) {
  if (filters.status && filters.status !== communication.status) filters.status = "";
  if (filters.communicationType && filters.communicationType !== communication.communicationType) filters.communicationType = "";
  if (filters.direction && filters.direction !== communication.direction) filters.direction = "";
  if (filters.source && filters.source !== communication.source) filters.source = "";
  if (filters.followUpAssignedTo && filters.followUpAssignedTo !== (communication.followUpAssignedTo ?? "")) filters.followUpAssignedTo = "";
  if (filters.followUpDueFrom && (!communication.followUpDueDate || communication.followUpDueDate < filters.followUpDueFrom)) filters.followUpDueFrom = "";
  if (filters.followUpDueTo && (!communication.followUpDueDate || communication.followUpDueDate > filters.followUpDueTo)) filters.followUpDueTo = "";
  if (filters.caseId && filters.caseId !== (communication.caseId ?? "")) filters.caseId = "";
  if (filters.partyOrganizationId && filters.partyOrganizationId !== (communication.partyOrganizationId ?? "")) filters.partyOrganizationId = "";
  if (filters.contactId && filters.contactId !== (communication.contactId ?? "")) filters.contactId = "";
  if (filters.assetId && filters.assetId !== (communication.assetId ?? "")) filters.assetId = "";
  if (filters.dateFrom && communication.occurredAt.slice(0, 10) < filters.dateFrom) filters.dateFrom = "";
  if (filters.dateTo && communication.occurredAt.slice(0, 10) > filters.dateTo) filters.dateTo = "";
}

function focusCommunicationRecord(communication: CommunicationRecord) {
  clearConflictingFocusFilters(communication);
  activeChannel.value = channelForCommunication(communication);
  focusCommunication(communication.communicationId, preferredViewForCommunication(communication));
}

function savedViewPayload() {
  return {
    channel: activeChannel.value,
    view: activeView.value,
    q: filters.q,
    status: filters.status,
    communicationType: filters.communicationType,
    direction: filters.direction,
    source: filters.source,
    followUpAssignedTo: filters.followUpAssignedTo,
    followUpDueFrom: filters.followUpDueFrom,
    followUpDueTo: filters.followUpDueTo,
    caseId: filters.caseId,
    partyOrganizationId: filters.partyOrganizationId,
    contactId: filters.contactId,
    assetId: filters.assetId,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    sortOption: sortOption.value
  };
}

function applySavedView() {
  const view = savedViews.value.find((item) => item.savedViewId === selectedSavedViewId.value);
  if (!view) return;
  savedViewName.value = "";
  showSavedViewEditor.value = false;
  const savedFilters = view.filters as Record<string, string | undefined>;
  activeChannel.value = COMMUNICATION_CHANNELS.includes(savedFilters.channel as CommunicationChannel)
    ? (savedFilters.channel as CommunicationChannel)
    : "all";
  activeView.value = INBOX_VIEWS.includes(savedFilters.view as InboxView) ? (savedFilters.view as InboxView) : "inbox";
  Object.assign(filters, {
    q: savedFilters.q ?? "",
    status: savedFilters.status ?? "",
    communicationType: savedFilters.communicationType ?? "",
    direction: savedFilters.direction ?? "",
    source: savedFilters.source ?? "",
    followUpAssignedTo: savedFilters.followUpAssignedTo ?? "",
    followUpDueFrom: savedFilters.followUpDueFrom ?? "",
    followUpDueTo: savedFilters.followUpDueTo ?? "",
    caseId: savedFilters.caseId ?? "",
    partyOrganizationId: savedFilters.partyOrganizationId ?? "",
    contactId: savedFilters.contactId ?? "",
    assetId: savedFilters.assetId ?? "",
    dateFrom: savedFilters.dateFrom ?? "",
    dateTo: savedFilters.dateTo ?? ""
  });
  sortOption.value = savedFilters.sortOption ?? view.sort ?? "occurred_desc";
  pageSize.value = view.pageSize;
  page.value = 1;
  const query = currentCommunicationQuery();
  void router.replace({ path: "/communications", query });
}

async function saveCurrentView() {
  const name = savedViewName.value.trim();
  if (!name) return;
  try {
    const view = await client.createSavedDirectoryView({
      scope: "communications",
      name,
      filters: savedViewPayload(),
      sort: sortOption.value,
      pageSize: pageSize.value
    });
    savedViews.value = [...savedViews.value, view].sort((a, b) => a.name.localeCompare(b.name));
    selectedSavedViewId.value = view.savedViewId;
    savedViewName.value = "";
    showSavedViewEditor.value = false;
    toasts.success("Communication view saved", view.name);
  } catch (error) {
    toasts.error("Unable to save view", error instanceof Error ? error.message : "Please try again.");
  }
}

async function deleteSelectedView() {
  if (!selectedSavedViewId.value) return;
  const view = savedViews.value.find((item) => item.savedViewId === selectedSavedViewId.value);
  if (!view || !window.confirm(`Delete saved view "${view.name}"?`)) return;
  await client.deleteSavedDirectoryView(view.savedViewId);
  savedViews.value = savedViews.value.filter((item) => item.savedViewId !== view.savedViewId);
  selectedSavedViewId.value = "";
  showSavedViewEditor.value = false;
  toasts.success("Communication view deleted", view.name);
}

function toggleSavedViewEditor() {
  showSavedViewEditor.value = !showSavedViewEditor.value;
  if (!showSavedViewEditor.value) savedViewName.value = "";
}

function toggleCommunicationSelection(communicationId: string) {
  selectedCommunicationIds.value = selectedCommunicationIds.value.includes(communicationId)
    ? selectedCommunicationIds.value.filter((id) => id !== communicationId)
    : [...selectedCommunicationIds.value, communicationId];
}

function toggleCurrentPageSelection() {
  if (currentPageAllSelected.value) {
    const currentIds = new Set(filteredCommunications.value.map((communication) => communication.communicationId));
    selectedCommunicationIds.value = selectedCommunicationIds.value.filter((id) => !currentIds.has(id));
  } else {
    selectedCommunicationIds.value = Array.from(
      new Set([...selectedCommunicationIds.value, ...filteredCommunications.value.map((communication) => communication.communicationId)])
    );
  }
}

async function runCommunicationBulkAction(action: "archive" | "restore" | "follow-up" | "clear-follow-up" | "link-service") {
  if (!selectedCommunicationIds.value.length) return;
  if (action === "link-service" && !bulkCaseId.value) return;
  try {
    const result = await client.bulkCommunications({
      action:
        action === "follow-up" ? "assign-follow-up" : action === "clear-follow-up" ? "clear-follow-up" : action === "link-service" ? "link-service" : "set-status",
      communicationIds: selectedCommunicationIds.value,
      status: action === "archive" ? "Ignored / Spam" : action === "restore" ? "Logged" : undefined,
      followUpAssignedTo: action === "follow-up" ? auth.user?.userId ?? null : undefined,
      caseId: action === "link-service" ? bulkCaseId.value : undefined
    });
    toasts.success("Bulk communication update complete", `${result.succeeded} of ${result.requested} records updated.`);
    selectedCommunicationIds.value = [];
    await load();
  } catch (error) {
    toasts.error("Bulk communication update failed", error instanceof Error ? error.message : "Please try again.");
  }
}

function scheduleListReload(resetPage = true) {
  if (applyingRouteQuery) return;
  if (resetPage) page.value = 1;
  if (listReloadTimer) clearTimeout(listReloadTimer);
  listReloadTimer = setTimeout(() => {
    listReloadTimer = null;
    void load();
  }, 220);
}

onMounted(() => {
  applyFiltersFromRoute();
  void load();
});
onBeforeUnmount(() => {
  if (filterRouteSyncTimer) clearTimeout(filterRouteSyncTimer);
  if (listReloadTimer) clearTimeout(listReloadTimer);
});

watch(
  () => FILTER_QUERY_KEYS.map((key) => String(filters[key] ?? "")).join("\u001F"),
  () => {
    scheduleFilterRouteSync();
    scheduleListReload();
  }
);

watch([activeChannel, activeView, sortOption], () => {
  scheduleListReload();
});

watch([pageSize], () => {
  scheduleListReload();
});

watch(
  () => route.query,
  () => {
    if (!queriesMatch(currentCommunicationQuery(), routeFilterQuery())) {
      applyFiltersFromRoute();
      setTimeout(() => scheduleListReload(), 0);
    }
    applyDraftFromRoute();
  },
  { deep: true }
);
</script>

<template>
  <PageHeader
    eyebrow="MD3 communications"
    title="Communications"
    description="Review Gmail archives, PBX calls, SMS notes, vendor updates, and follow-ups in one familiar inbox."
  >
    <button
      class="btn-primary h-10 px-4"
      type="button"
      :disabled="!auth.canAddNotes"
      @click="showLogForm ? closeLogForm() : openManualCommunicationLog()"
    >
      <X v-if="showLogForm" class="h-4 w-4" />
      <Plus v-else class="h-4 w-4" />
      {{ showLogForm ? "Close form" : logCommunicationLabel }}
    </button>
  </PageHeader>

  <form v-if="showLogForm" class="panel mb-4 space-y-4 p-4" @submit.prevent="saveCommunication">
    <div class="flex items-start justify-between gap-3">
      <div class="flex items-start gap-3">
        <div class="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-accent-50 text-accent-900">
          <MessageSquare class="h-5 w-5" />
        </div>
        <div>
          <h2 class="font-semibold">Log communication</h2>
          <p class="mt-1 text-sm text-ink-500">Manual entry stays available, but imported Gmail and PBX records should usually start in the inbox.</p>
        </div>
      </div>
      <button class="btn-secondary h-9 px-3" type="button" @click="closeLogForm">
        <X class="h-4 w-4" />
      </button>
    </div>

    <div v-if="draftNotice" class="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-900">
      {{ draftNotice }}
    </div>

    <div class="grid gap-3 md:grid-cols-4">
      <label class="block text-sm font-semibold">
        Type
        <select v-model="form.communicationType" class="input mt-1" :disabled="!auth.canAddNotes">
          <option v-for="type in COMMUNICATION_TYPES" :key="type" :value="type">{{ type }}</option>
        </select>
      </label>
      <label class="block text-sm font-semibold">
        Direction
        <select v-model="form.direction" class="input mt-1" :disabled="!auth.canAddNotes">
          <option v-for="direction in COMMUNICATION_DIRECTIONS" :key="direction" :value="direction">{{ direction }}</option>
        </select>
      </label>
      <label class="block text-sm font-semibold">
        Status
        <select v-model="form.status" class="input mt-1" :disabled="!auth.canAddNotes">
          <option v-for="status in COMMUNICATION_STATUSES" :key="status" :value="status">{{ statusLabel(status) }}</option>
        </select>
      </label>
      <label class="block text-sm font-semibold">
        Occurred at
        <input v-model="form.occurredAt" class="input mt-1" type="datetime-local" :disabled="!auth.canAddNotes" required />
      </label>
    </div>

    <div v-if="form.status === 'Needs follow-up'" class="grid gap-3 rounded-md border border-amber-200 bg-amber-50/60 p-3 md:grid-cols-2">
      <label class="block text-sm font-semibold">
        Follow-up owner
        <select v-model="form.followUpAssignedTo" class="input mt-1 bg-white" :disabled="!auth.canAddNotes">
          <option :value="null">Unassigned</option>
          <option v-for="user in users" :key="user.userId" :value="user.userId">{{ user.name }}</option>
        </select>
      </label>
      <label class="block text-sm font-semibold">
        Follow-up due date
        <input v-model="form.followUpDueDate" class="input mt-1 bg-white" type="date" :disabled="!auth.canAddNotes" />
      </label>
    </div>

    <div class="grid gap-3 lg:grid-cols-[1fr_1.4fr]">
      <label class="block text-sm font-semibold">
        Subject
        <input v-model="form.subject" class="input mt-1" :disabled="!auth.canAddNotes" placeholder="Short summary" required />
      </label>
      <label class="block text-sm font-semibold">
        Notes
        <textarea
          v-model="form.body"
          class="input mt-1 min-h-24"
          :disabled="!auth.canAddNotes"
          placeholder="What happened, what was promised, or what should happen next."
        />
      </label>
    </div>

    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <label class="block text-sm font-semibold">
        Contact
        <select v-model="form.contactId" class="input mt-1" :disabled="!auth.canAddNotes">
          <option :value="null">None</option>
          <option v-for="contact in contacts" :key="contact.contactId" :value="contact.contactId">{{ contactOptionLabel(contact) }}</option>
        </select>
      </label>
      <label class="block text-sm font-semibold">
        Organization
        <select v-model="form.partyOrganizationId" class="input mt-1" :disabled="!auth.canAddNotes">
          <option :value="null">None</option>
          <option v-for="organization in organizations" :key="organization.partyOrganizationId" :value="organization.partyOrganizationId">{{ organization.name }}</option>
        </select>
      </label>
      <label class="block text-sm font-semibold">
        Service
        <select v-model="form.caseId" class="input mt-1" :disabled="!auth.canAddNotes">
          <option :value="null">Unlinked</option>
          <option v-for="service in services" :key="service.caseId" :value="service.caseId">{{ serviceOptionLabel(service) }}</option>
        </select>
      </label>
      <label class="block text-sm font-semibold">
        Asset
        <select v-model="form.assetId" class="input mt-1" :disabled="!auth.canAddNotes">
          <option :value="null">None</option>
          <option v-for="asset in assets" :key="asset.assetId" :value="asset.assetId">{{ asset.name }} · {{ asset.assetType }}</option>
        </select>
      </label>
    </div>

    <details class="rounded-md border border-ink-200 p-3">
      <summary class="cursor-pointer text-sm font-semibold">Advanced source details</summary>
      <div class="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label class="block text-sm font-semibold">
          Source
          <select v-model="form.source" class="input mt-1" :disabled="!auth.canAddNotes">
            <option v-for="source in COMMUNICATION_SOURCES" :key="source" :value="source">{{ source }}</option>
          </select>
        </label>
        <label class="block text-sm font-semibold">
          Provider
          <input v-model="form.externalProvider" class="input mt-1" :disabled="!auth.canAddNotes" placeholder="Gmail, Issabel, carrier portal" />
        </label>
        <label class="block text-sm font-semibold">
          External reference
          <input v-model="form.externalReference" class="input mt-1" :disabled="!auth.canAddNotes" placeholder="Message ID, call ID, ticket ID" />
        </label>
        <label class="block text-sm font-semibold">
          External link
          <input v-model="form.externalUrl" class="input mt-1" :disabled="!auth.canAddNotes" placeholder="https://..." />
        </label>
      </div>
    </details>

    <p v-if="formError" class="text-sm font-semibold text-legal-red">{{ formError }}</p>
    <div class="flex justify-end gap-2">
      <button class="btn-secondary" type="button" @click="showLogForm = false">Cancel</button>
      <button class="btn-primary" type="submit" :disabled="!auth.canAddNotes || saving || !form.subject.trim()">
        <Save class="h-4 w-4" />
        {{ saving ? "Saving..." : "Save communication" }}
      </button>
    </div>
  </form>

  <div class="mb-3 border-b border-ink-200">
    <nav class="-mb-px flex gap-5 overflow-x-auto" aria-label="Communication channels">
      <button
        v-for="option in channelOptions"
        :key="option.id"
        class="flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-1 py-2 text-sm font-semibold transition"
        :class="activeChannel === option.id ? 'border-accent-800 text-accent-900' : 'border-transparent text-ink-500 hover:border-ink-300 hover:text-ink-800'"
        type="button"
        :title="option.helper"
        :aria-current="activeChannel === option.id ? 'page' : undefined"
        @click="selectChannel(option.id)"
      >
        <component :is="option.icon" class="h-4 w-4" />
        {{ option.label }}
        <span v-if="activeChannel === option.id" class="rounded-full bg-accent-50 px-2 py-0.5 text-xs text-accent-900">{{ totalCommunications }}</span>
      </button>
    </nav>
  </div>

  <div class="mb-4 flex flex-wrap items-center gap-1.5" aria-label="Communication status views">
    <span class="mr-1 text-xs font-semibold uppercase text-ink-500">Status</span>
    <button
      v-for="option in viewOptions"
      :key="option.id"
      class="flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-semibold transition"
      :class="activeView === option.id ? 'border-accent-800 bg-accent-900 text-white' : 'border-ink-200 bg-white text-ink-600 hover:border-accent-300 hover:text-ink-900'"
      type="button"
      :title="option.helper"
      @click="selectView(option.id)"
    >
      <component :is="option.icon" class="h-4 w-4" />
      {{ option.label }}
    </button>
  </div>

  <section class="grid gap-3 xl:grid-cols-[minmax(24rem,0.72fr)_minmax(0,1.28fr)]">
    <aside class="panel overflow-hidden">
      <div class="border-b border-ink-100 p-3">
        <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <label class="relative block">
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input v-model="filters.q" class="input h-10 pl-9" :placeholder="communicationSearchPlaceholder" />
          </label>
          <button class="btn-secondary h-10 px-3" type="button" @click="showAdvancedFilters = !showAdvancedFilters">
            <SlidersHorizontal class="h-4 w-4" />
            Filters
            <span v-if="activeFilterCount" class="rounded-full bg-accent-50 px-2 py-0.5 text-xs font-semibold text-accent-800">{{ activeFilterCount }}</span>
          </button>
        </div>
        <div class="mt-2 flex flex-wrap gap-2">
          <select v-if="showCommunicationTypeFilter" v-model="filters.communicationType" class="input h-9 min-w-36 flex-1 py-1 text-sm">
            <option value="">{{ activeChannel === "other" ? "Any other type" : "Any type" }}</option>
            <option v-for="type in communicationTypeOptions" :key="type" :value="type">{{ type }}</option>
          </select>
          <select v-model="filters.direction" class="input h-9 min-w-36 flex-1 py-1 text-sm">
            <option value="">Any direction</option>
            <option v-for="direction in COMMUNICATION_DIRECTIONS" :key="direction" :value="direction">{{ direction }}</option>
          </select>
          <select v-model="filters.source" class="input h-9 min-w-36 flex-1 py-1 text-sm">
            <option value="">Any source</option>
            <option v-for="source in COMMUNICATION_SOURCES" :key="source" :value="source">{{ source }}</option>
          </select>
          <select v-model="sortOption" class="input h-9 min-w-36 flex-1 py-1 text-sm">
            <option value="occurred_desc">Newest first</option>
            <option value="occurred_asc">Oldest first</option>
            <option value="updated_desc">Recently updated</option>
            <option value="subject_asc">Subject A-Z</option>
            <option value="status_asc">Status A-Z</option>
            <option value="type_asc">Type A-Z</option>
            <option value="contact_asc">Contact A-Z</option>
            <option value="organization_asc">Organization A-Z</option>
            <option value="service_asc">Service A-Z</option>
          </select>
          <select v-model="selectedSavedViewId" class="input h-9 min-w-40 flex-[1.15] py-1 text-sm" @change="applySavedView">
            <option value="">Saved views</option>
            <option v-for="view in savedViews" :key="view.savedViewId" :value="view.savedViewId">{{ view.name }}</option>
          </select>
          <button class="btn-secondary h-9 shrink-0 px-3 text-sm" type="button" @click="toggleSavedViewEditor">
            <Save class="h-4 w-4" />
            {{ showSavedViewEditor ? "Cancel" : "Save view" }}
          </button>
          <button
            v-if="selectedSavedViewId"
            class="btn-secondary h-9 shrink-0 px-3 text-sm text-red-700"
            type="button"
            @click="deleteSelectedView"
          >
            <Trash2 class="h-4 w-4" />
            Delete
          </button>
        </div>
        <form
          v-if="showSavedViewEditor"
          class="mt-2 grid gap-2 rounded-md border border-ink-100 bg-ink-50 p-2 sm:grid-cols-[minmax(0,1fr)_auto]"
          @submit.prevent="saveCurrentView"
        >
          <input
            v-model="savedViewName"
            class="input h-9 min-w-0 py-1 text-sm"
            placeholder="Name this view"
            aria-label="Saved view name"
            autofocus
          />
          <button class="btn-primary h-9 px-3 text-sm" type="submit" :disabled="!savedViewName.trim()">
            <Save class="h-4 w-4" />
            Save current view
          </button>
        </form>
        <div v-if="selectedCommunicationCount" class="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-accent-100 bg-accent-50/60 p-3 text-sm">
          <span class="font-semibold text-ink-700">{{ selectedCommunicationCount }} selected</span>
          <button class="btn-secondary h-9 px-3" type="button" :disabled="!filteredCommunications.length" @click="toggleCurrentPageSelection">
            {{ currentPageAllSelected ? "Clear page" : "Select page" }}
          </button>
          <button class="btn-secondary h-9 px-3" type="button" @click="runCommunicationBulkAction('follow-up')">
            Follow up
          </button>
          <button class="btn-secondary h-9 px-3" type="button" @click="runCommunicationBulkAction(activeView === 'archived' ? 'restore' : 'archive')">
            {{ activeView === "archived" ? "Restore" : "Archive" }}
          </button>
          <select v-model="bulkCaseId" class="input h-9 max-w-xs py-1">
            <option value="">Choose service to link</option>
            <option v-for="service in services" :key="service.caseId" :value="service.caseId">{{ serviceOptionLabel(service) }}</option>
          </select>
          <button
            class="btn-secondary h-9 px-3"
            type="button"
            :disabled="!bulkCaseId"
            @click="runCommunicationBulkAction('link-service')"
          >
            Link selected to service
          </button>
        </div>
        <div v-if="activeFilterCount" class="mt-2 rounded-md border border-accent-100 bg-accent-50/60 px-3 py-2 text-sm">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="font-semibold text-accent-900">
              Showing {{ filteredCommunications.length }} filtered {{ filteredCommunications.length === 1 ? "record" : "records" }}.
            </span>
            <button class="font-semibold text-accent-800 hover:underline" type="button" @click="clearFilters">
              Clear filters
            </button>
          </div>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <button
              v-for="chip in activeFilterChips"
              :key="chip.key"
              class="inline-flex max-w-full items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-accent-900 ring-1 ring-accent-100 hover:bg-accent-50"
              type="button"
              :title="`Clear ${chip.label}`"
              @click="clearFilter(chip.key)"
            >
              <span class="truncate">{{ chip.label }}</span>
              <X class="h-3.5 w-3.5 shrink-0" />
            </button>
          </div>
        </div>
        <div v-if="testCommunicationCount" class="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-ink-200 bg-ink-50 px-3 py-2 text-sm">
          <label class="flex items-center gap-2 font-semibold text-ink-700">
            <input v-model="hideTestRecords" type="checkbox" />
            Hide smoke/test records
          </label>
          <span class="text-ink-500">
            {{ testCommunicationCount }} preserved {{ testCommunicationCount === 1 ? "record" : "records" }}
            {{ hideTestRecords ? "hidden from day-to-day views." : "shown in this view." }}
          </span>
        </div>
        <div v-if="showAdvancedFilters" class="mt-2 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(10rem,1fr))]">
          <select v-model="filters.status" class="input min-w-0">
            <option value="">Any status</option>
            <option v-for="status in COMMUNICATION_STATUSES" :key="status" :value="status">{{ statusLabel(status) }}</option>
          </select>
          <select v-model="filters.caseId" class="input min-w-0">
            <option value="">Any service</option>
            <option v-for="service in services" :key="service.caseId" :value="service.caseId">{{ serviceOptionLabel(service) }}</option>
          </select>
          <select v-model="filters.partyOrganizationId" class="input min-w-0">
            <option value="">Any organization</option>
            <option v-for="organization in organizations" :key="organization.partyOrganizationId" :value="organization.partyOrganizationId">{{ organization.name }}</option>
          </select>
          <select v-model="filters.contactId" class="input min-w-0">
            <option value="">Any contact</option>
            <option v-for="contact in contacts" :key="contact.contactId" :value="contact.contactId">{{ contactOptionLabel(contact) }}</option>
          </select>
          <select v-model="filters.assetId" class="input min-w-0">
            <option value="">Any asset</option>
            <option v-for="asset in assets" :key="asset.assetId" :value="asset.assetId">{{ asset.name }} · {{ asset.assetType }}</option>
          </select>
          <select v-model="filters.followUpAssignedTo" class="input min-w-0">
            <option value="">Any follow-up owner</option>
            <option v-for="user in users" :key="user.userId" :value="user.userId">{{ user.name }}</option>
          </select>
          <div class="grid gap-2 sm:col-span-2 sm:grid-cols-2">
            <label class="text-xs font-semibold text-ink-500">
              Follow-up from
              <input v-model="filters.followUpDueFrom" class="input mt-1 min-w-0" type="date" :max="filters.followUpDueTo || undefined" />
            </label>
            <label class="text-xs font-semibold text-ink-500">
              Follow-up to
              <input v-model="filters.followUpDueTo" class="input mt-1 min-w-0" type="date" :min="filters.followUpDueFrom || undefined" />
            </label>
          </div>
          <div class="grid gap-2 sm:col-span-2 sm:grid-cols-2">
            <label class="text-xs font-semibold text-ink-500">
              From
              <input v-model="filters.dateFrom" class="input mt-1 min-w-0" type="date" :max="filters.dateTo || undefined" />
            </label>
            <label class="text-xs font-semibold text-ink-500">
              To
              <input v-model="filters.dateTo" class="input mt-1 min-w-0" type="date" :min="filters.dateFrom || undefined" />
            </label>
          </div>
        </div>
      </div>

      <div class="max-h-[760px] overflow-y-auto">
        <div v-if="loading" class="p-8 text-center text-sm text-ink-500">Loading communications...</div>
        <div v-else-if="filteredCommunications.length" class="divide-y divide-ink-100">
          <button
            v-for="communication in filteredCommunications"
            :key="communication.communicationId"
            class="block w-full px-4 py-3 text-left transition hover:bg-ink-50"
            :class="selectedCommunication?.communicationId === communication.communicationId ? 'bg-accent-50/70' : ''"
            type="button"
            @click="selectCommunication(communication.communicationId)"
          >
            <div class="flex items-start gap-3">
              <span class="pt-2" @click.stop>
                <input
                  type="checkbox"
                  :checked="selectedCommunicationIds.includes(communication.communicationId)"
                  @change.stop="toggleCommunicationSelection(communication.communicationId)"
                  @click.stop
                />
              </span>
              <div class="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-50 text-accent-900">
                <component :is="communicationIcon(communication)" class="h-4 w-4" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between gap-3">
                  <p class="truncate font-semibold text-ink-950">{{ senderLabel(communication) }}</p>
                  <p class="shrink-0 text-xs text-ink-500">{{ formatDateTime(communication.occurredAt) }}</p>
                </div>
                <p class="mt-1 truncate text-sm font-semibold text-ink-800">{{ communication.subject }}</p>
                <p class="mt-1 line-clamp-2 text-sm text-ink-500">
                  {{ communicationPreviewText(communication) || secondaryLabel(communication) || "No preview available." }}
                </p>
                <div class="mt-2 flex flex-wrap items-center gap-1.5">
                  <span :class="['rounded-full px-2 py-0.5 text-xs font-semibold', statusClass(communication.status)]">
                    {{ statusLabel(communication.status) }}
                  </span>
                  <span class="rounded-full bg-ink-100 px-2 py-0.5 text-xs font-semibold text-ink-700">{{ communication.communicationType }}</span>
                  <span v-if="communication.source !== 'Manual'" class="rounded-full bg-purple-50 px-2 py-0.5 text-xs font-semibold text-purple-900">
                    {{ communication.source }}
                  </span>
                  <span v-if="communication.caseId" class="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-900">
                    {{ communication.caseNumber }}
                  </span>
                  <span
                    v-if="communication.status === 'Needs follow-up'"
                    class="rounded-full px-2 py-0.5 text-xs font-semibold"
                    :class="isFollowUpOverdue(communication) ? 'bg-red-100 text-red-900' : 'bg-amber-100 text-amber-900'"
                  >
                    {{ followUpSummary(communication) }}
                  </span>
                </div>
              </div>
            </div>
          </button>
        </div>
        <div v-else class="p-8 text-center text-sm text-ink-500">No communications match this view.</div>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 p-3 text-xs text-ink-500">
        <span>Page {{ page }} of {{ totalPages }} · {{ totalCommunications }} records</span>
        <div class="flex items-center gap-2">
          <select v-model.number="pageSize" class="input h-9 w-28 py-1 text-sm">
            <option :value="10">10 / page</option>
            <option :value="25">25 / page</option>
            <option :value="50">50 / page</option>
            <option :value="100">100 / page</option>
          </select>
          <button class="btn-secondary h-9 px-3 text-sm" type="button" :disabled="page <= 1" @click="page--; load()">Previous</button>
          <button class="btn-secondary h-9 px-3 text-sm" type="button" :disabled="page >= totalPages" @click="page++; load()">Next</button>
        </div>
      </div>
    </aside>

    <section class="panel min-h-[620px] overflow-hidden">
      <div v-if="!selectedCommunication" class="grid h-full min-h-[520px] place-items-center p-8 text-center text-sm text-ink-500">
        Select a communication to read it.
      </div>

      <template v-else>
        <div class="border-b border-ink-100 p-5">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0">
              <div class="mb-3 flex flex-wrap items-center gap-2">
                <span :class="['rounded-full px-2.5 py-1 text-xs font-semibold', statusClass(selectedCommunication.status)]">
                  {{ statusLabel(selectedCommunication.status) }}
                </span>
                <span class="rounded-full bg-accent-50 px-2.5 py-1 text-xs font-semibold uppercase text-accent-900">
                  {{ selectedCommunication.communicationType }}
                </span>
                <span class="rounded-full bg-ink-100 px-2.5 py-1 text-xs font-semibold text-ink-700">{{ selectedCommunication.direction }}</span>
                <span v-if="selectedCommunication.source !== 'Manual'" class="rounded-full bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-900">
                  {{ selectedCommunication.source }}
                </span>
              </div>
              <h2 class="break-words text-2xl font-semibold text-ink-950">{{ selectedCommunication.subject }}</h2>
              <p class="mt-2 text-sm text-ink-500">
                {{ senderLabel(selectedCommunication) }} · {{ formatDateTime(selectedCommunication.occurredAt) }}
              </p>
              <p v-if="sourceMetadataText(selectedCommunication)" class="mt-1 text-sm font-semibold text-ink-500">{{ sourceMetadataText(selectedCommunication) }}</p>
            </div>
            <div class="flex flex-wrap justify-end gap-2">
              <button
                v-if="selectedCommunication.status !== 'Needs follow-up' && selectedCommunication.status !== 'Ignored / Spam'"
                class="btn-secondary h-9 px-3"
                type="button"
                @click="saveFollowUp(selectedCommunication)"
              >
                <Clock class="h-4 w-4" />
                Follow up
              </button>
              <button
                v-if="selectedCommunication.status === 'Ignored / Spam'"
                class="btn-secondary h-9 px-3"
                type="button"
                @click="updateStatus(selectedCommunication, resolvedStatus(selectedCommunication))"
              >
                <RotateCcw class="h-4 w-4" />
                Restore
              </button>
              <button
                v-else-if="selectedCommunication.status !== resolvedStatus(selectedCommunication)"
                class="btn-secondary h-9 px-3"
                type="button"
                @click="updateStatus(selectedCommunication, resolvedStatus(selectedCommunication))"
              >
                <CheckCircle2 class="h-4 w-4" />
                Mark reviewed
              </button>
              <button
                v-if="selectedCommunication.status !== 'Ignored / Spam'"
                class="btn-secondary h-9 px-3 text-legal-red hover:border-red-200 hover:bg-red-50"
                type="button"
                @click="updateStatus(selectedCommunication, 'Ignored / Spam')"
              >
                <Ban class="h-4 w-4" />
                Archive
              </button>
              <a
                v-if="selectedCommunication.externalUrl"
                class="btn-secondary h-9 px-3"
                :href="selectedCommunication.externalUrl"
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink class="h-4 w-4" />
                {{ selectedCommunication.source === "Gmail" ? "Open in Gmail" : "Open external record" }}
              </a>
            </div>
          </div>
        </div>

        <div class="max-h-[760px] overflow-y-auto p-5">
          <div v-if="selectedCommunication.status === 'Ignored / Spam'" class="mb-4 rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-900">
            This record is archived, not deleted. Use Restore to bring it back into the working inbox.
          </div>

          <section v-if="selectedCommunication.source === 'Gmail'" class="mb-4 rounded-md border border-ink-200">
            <div v-for="row in emailHeaderRows(selectedCommunication)" :key="row[0]" class="grid gap-2 border-b border-ink-100 px-4 py-2 text-sm last:border-b-0 md:grid-cols-[5rem_1fr]">
              <span class="font-semibold text-ink-500">{{ row[0] }}</span>
              <span class="break-words text-ink-800">{{ row[1] }}</span>
            </div>
          </section>

          <section v-else-if="selectedCommunication.source === 'Asterisk / PBX' && callDetailRows(selectedCommunication).length" class="mb-4 rounded-md border border-ink-200">
            <div class="border-b border-ink-100 px-4 py-3">
              <h3 class="font-semibold text-ink-900">Call details</h3>
              <p class="mt-1 text-sm text-ink-500">Captured automatically from the read-only PBX listener.</p>
            </div>
            <div class="grid gap-0 md:grid-cols-2">
              <div
                v-for="row in callDetailRows(selectedCommunication)"
                :key="row[0]"
                class="border-b border-ink-100 px-4 py-2 text-sm odd:md:border-r"
              >
                <span class="block text-xs font-semibold uppercase text-ink-500">{{ row[0] }}</span>
                <span class="mt-0.5 block break-words text-ink-800">{{ row[1] }}</span>
              </div>
            </div>
          </section>

          <div class="mb-4 flex flex-wrap gap-2 text-xs font-semibold text-ink-600">
            <RouterLink
              v-if="selectedCommunication.caseId"
              class="rounded-full bg-teal-50 px-2.5 py-1 text-teal-900 hover:underline"
              :to="workItemPath(selectedCommunication.caseId, 'tab=communications')"
            >
              <BriefcaseBusiness class="mr-1 inline h-3.5 w-3.5" />
              {{ selectedCommunication.caseNumber }} · {{ selectedCommunication.caseTitle }}
            </RouterLink>
            <RouterLink v-if="selectedCommunication.contactId" class="rounded-full bg-ink-50 px-2.5 py-1 hover:underline" :to="`/contacts/${selectedCommunication.contactId}`">
              <UserRound class="mr-1 inline h-3.5 w-3.5" />
              {{ selectedCommunication.contactName }}
            </RouterLink>
            <RouterLink
              v-if="selectedCommunication.partyOrganizationId"
              class="rounded-full bg-ink-50 px-2.5 py-1 hover:underline"
              :to="`/organizations/${selectedCommunication.partyOrganizationId}`"
            >
              <Building2 class="mr-1 inline h-3.5 w-3.5" />
              {{ selectedCommunication.partyOrganizationName }}
            </RouterLink>
            <RouterLink v-if="selectedCommunication.assetId" class="rounded-full bg-ink-50 px-2.5 py-1 hover:underline" :to="`/managed-assets/${selectedCommunication.assetId}`">
              <HardDrive class="mr-1 inline h-3.5 w-3.5" />
              {{ selectedCommunication.assetName }}
            </RouterLink>
          </div>

          <section
            v-if="selectedCommunication.status !== 'Ignored / Spam' && followUpDrafts[selectedCommunication.communicationId]"
            class="mb-4 rounded-md border p-4"
            :class="selectedCommunication.status === 'Needs follow-up' ? 'border-amber-200 bg-amber-50/50' : 'border-ink-200 bg-white'"
          >
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 class="font-semibold text-ink-900">Follow-up</h3>
                <p class="mt-1 text-sm text-ink-500">
                  Keep small call-back or reply reminders here. Create a service task only when the follow-up becomes real work.
                </p>
              </div>
              <span
                v-if="selectedCommunication.status === 'Needs follow-up'"
                class="rounded-full px-2.5 py-1 text-xs font-semibold"
                :class="isFollowUpOverdue(selectedCommunication) ? 'bg-red-100 text-red-900' : 'bg-amber-100 text-amber-900'"
              >
                {{ isFollowUpOverdue(selectedCommunication) ? "Overdue" : "Open follow-up" }}
              </span>
            </div>
            <div class="mt-3 grid gap-3 md:grid-cols-[1fr_12rem_auto]">
              <label class="block text-sm font-semibold">
                Owner
                <select v-model="followUpDrafts[selectedCommunication.communicationId].assignedTo" class="input mt-1 bg-white" :disabled="!auth.canAddNotes">
                  <option value="">Unassigned</option>
                  <option v-for="user in users" :key="user.userId" :value="user.userId">{{ user.name }}</option>
                </select>
              </label>
              <label class="block text-sm font-semibold">
                Due date
                <input v-model="followUpDrafts[selectedCommunication.communicationId].dueDate" class="input mt-1 bg-white" type="date" :disabled="!auth.canAddNotes" />
              </label>
              <div class="flex items-end">
                <button class="btn-secondary h-10 px-3" type="button" :disabled="!auth.canAddNotes" @click="saveFollowUp(selectedCommunication)">
                  <Clock class="h-4 w-4" />
                  Save follow-up
                </button>
              </div>
            </div>
          </section>

          <section v-if="selectedCommunication.source === 'Gmail' && selectedGmailThreadMessages.length" class="mb-4 space-y-3">
            <article
              v-for="message in selectedGmailThreadMessages"
              :key="message.key"
              class="overflow-hidden rounded-md border border-ink-200 bg-white"
            >
              <div class="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 bg-ink-50/70 px-4 py-3">
                <div class="min-w-0">
                  <p class="text-xs font-semibold uppercase text-accent-700">Message {{ message.index }}</p>
                  <p class="mt-1 break-words text-sm font-semibold text-ink-900" :title="message.from">
                    {{ messageSenderLabel(selectedCommunication, message.from) }}
                  </p>
                  <p v-if="message.to" class="mt-0.5 break-words text-xs text-ink-500">To: {{ message.to }}</p>
                </div>
                <p class="shrink-0 text-xs font-semibold text-ink-500">{{ formatDateTimeIfValid(message.timestamp) }}</p>
              </div>
              <div class="whitespace-pre-wrap break-words px-4 py-3 text-base leading-7 text-ink-800">
                {{ message.body || "No message body." }}
              </div>
            </article>
          </section>

          <section v-else-if="selectedCommunication.source === 'Gmail'" class="mb-4 overflow-hidden rounded-md border border-ink-200 bg-white">
            <div class="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 bg-ink-50/70 px-4 py-3">
              <div class="min-w-0">
                <p class="text-xs font-semibold uppercase text-accent-700">Email message</p>
                <p class="mt-1 break-words text-sm font-semibold text-ink-900">{{ senderLabel(selectedCommunication) }}</p>
              </div>
              <p class="shrink-0 text-xs font-semibold text-ink-500">{{ formatDateTime(selectedCommunication.occurredAt) }}</p>
            </div>
            <div class="whitespace-pre-wrap break-words px-4 py-3 text-base leading-7 text-ink-800">
              {{ cleanEmailBody(selectedCommunication) || emptyBodyText(selectedCommunication) }}
            </div>
          </section>

          <article v-else class="max-w-none whitespace-pre-wrap break-words rounded-md bg-white text-base leading-7 text-ink-800">
            {{ cleanEmailBody(selectedCommunication) || emptyBodyText(selectedCommunication) }}
          </article>

          <details class="mt-5 rounded-md border border-ink-200 p-3">
            <summary class="cursor-pointer text-sm font-semibold">Source details</summary>
            <dl class="mt-3 grid gap-2 text-sm md:grid-cols-[10rem_1fr]">
              <template v-for="row in sourceDetailRows(selectedCommunication)" :key="row[0]">
                <dt class="font-semibold text-ink-500">{{ row[0] }}</dt>
                <dd class="break-words text-ink-800">{{ row[1] }}</dd>
              </template>
            </dl>
            <pre class="mt-3 max-h-64 overflow-auto rounded-md bg-ink-950 p-3 text-xs leading-5 text-white">{{ metadataJson(selectedCommunication) }}</pre>
          </details>

          <div class="sticky bottom-0 -mx-5 mt-5 border-t border-ink-100 bg-white/95 px-5 py-3 shadow-[0_-10px_24px_rgba(37,37,26,0.06)] backdrop-blur">
            <div
              v-if="editingServiceLinkId === selectedCommunication.communicationId"
              class="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto]"
            >
              <select v-model="pendingCaseLinks[selectedCommunication.communicationId]" class="input h-10">
                <option value="">Unlinked service</option>
                <option v-for="service in services" :key="service.caseId" :value="service.caseId">{{ serviceOptionLabel(service) }}</option>
              </select>
              <button class="btn-primary h-10 px-3" type="button" @click="saveServiceLink(selectedCommunication)">
                <Save class="h-4 w-4" />
                Save service link
              </button>
              <button class="btn-secondary h-10 px-3" type="button" @click="cancelServiceLinkEdit(selectedCommunication)">
                Cancel
              </button>
            </div>
            <div v-else class="flex flex-wrap items-center justify-between gap-3">
              <p class="text-sm text-ink-600">
                {{ nextActionText(selectedCommunication) }}
              </p>
              <div class="flex flex-wrap justify-end gap-2">
                <button
                  v-if="selectedCommunication.status !== 'Needs follow-up' && selectedCommunication.status !== 'Ignored / Spam'"
                  class="btn-secondary h-9 px-3"
                  type="button"
                  @click="saveFollowUp(selectedCommunication)"
                >
                  <Clock class="h-4 w-4" />
                  Follow up
                </button>
                <button
                  v-if="selectedCommunication.status === 'Ignored / Spam'"
                  class="btn-secondary h-9 px-3"
                  type="button"
                  @click="updateStatus(selectedCommunication, resolvedStatus(selectedCommunication))"
                >
                  <RotateCcw class="h-4 w-4" />
                  Restore
                </button>
                <button
                  v-else-if="selectedCommunication.status !== resolvedStatus(selectedCommunication)"
                  class="btn-secondary h-9 px-3"
                  type="button"
                  @click="updateStatus(selectedCommunication, resolvedStatus(selectedCommunication))"
                >
                  <CheckCircle2 class="h-4 w-4" />
                  Mark reviewed
                </button>
                <button class="btn-secondary h-9 px-3" type="button" @click="startServiceLinkEdit(selectedCommunication)">
                  <Link2 class="h-4 w-4" />
                  {{ selectedCommunication.caseId ? "Change service" : "Link to service" }}
                </button>
                <button
                  v-if="selectedCommunication.status !== 'Ignored / Spam'"
                  class="btn-secondary h-9 px-3 text-legal-red hover:border-red-200 hover:bg-red-50"
                  type="button"
                  @click="updateStatus(selectedCommunication, 'Ignored / Spam')"
                >
                  <Ban class="h-4 w-4" />
                  Archive
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </section>
  </section>
</template>
