<script setup lang="ts">
import {
  Archive,
  ArrowLeft,
  Building2,
  BriefcaseBusiness,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Edit3,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  HardDrive,
  KeyRound,
  Link2,
  MessageSquare,
  Paperclip,
  Pin,
  PinOff,
  Plus,
  Save,
  Trash2,
  Unlink,
  Upload,
  X
} from "lucide-vue-next";
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { client } from "../api/client";
import { useBusinessTemplate, workItemPath } from "../businessTemplate";
import Breadcrumbs from "../components/Breadcrumbs.vue";
import CommunicationHistoryPanel from "../components/communications/CommunicationHistoryPanel.vue";
import MarkdownContent from "../components/discussion/MarkdownContent.vue";
import PageHeader from "../components/PageHeader.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { useI18n } from "../i18n";
import { isHttpUrl } from "../shared/assetFilters";
import { formatDate, formatDateTime, formatFileSize } from "../shared/format";
import {
  ASSET_DOCUMENT_RELATIONSHIPS,
  ASSET_STATUSES,
  ASSET_TYPES,
  CREDENTIAL_TYPES,
  DOCUMENT_CATEGORIES,
  type AssetDocumentLink,
  type AssetDocumentLinkInput,
  type AssetCredential,
  type AssetCredentialInput,
  type CaseRecord,
  type CommunicationRecord,
  type CommunicationStatus,
  type DocumentCategory,
  type DocumentRecord,
  type ManagedAsset,
  type ManagedAssetInput,
  type PartyOrganization,
  type ServiceDiscussionMessage
} from "../shared/types";
import { useAuthStore } from "../stores/auth";
import { useToastStore } from "../stores/toasts";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const toasts = useToastStore();
const { t } = useI18n();
const { template, labels } = useBusinessTemplate();
const COMMUNICATION_DRAFT_STORAGE_PREFIX = "md3-platform.communication-draft.";
const assetId = computed(() => String(route.params.id));
const asset = ref<ManagedAsset | null>(null);
const credentials = ref<AssetCredential[]>([]);
const assetDocuments = ref<AssetDocumentLink[]>([]);
const serviceDocuments = ref<DocumentRecord[]>([]);
const organizations = ref<PartyOrganization[]>([]);
const services = ref<CaseRecord[]>([]);
const allAssets = ref<ManagedAsset[]>([]);
const communications = ref<CommunicationRecord[]>([]);
const relatedDiscussions = ref<ServiceDiscussionMessage[]>([]);
const relatedDiscussionTotal = ref(0);
const loading = ref(true);
const saving = ref(false);
const credentialSaving = ref(false);
const assetDocumentSaving = ref(false);
const error = ref("");
const credentialError = ref("");
const assetDocumentError = ref("");
const relatedDiscussionError = ref("");
const relatedDiscussionBusy = ref(false);
const showEditAsset = ref(false);
const showCredentialForm = ref(false);
const editingCredential = ref<AssetCredential | null>(null);
const revealedSecrets = ref<Record<string, { secret: string; privateNotes: string; revealedAt: string }>>({});
const documentLinkSearch = ref("");
const assetDocumentFileInput = ref<HTMLInputElement | null>(null);
const assetUploadFile = ref<File | null>(null);
const assetDocumentEntryMode = ref<"link" | "upload">("link");
const editingAssetDocumentLinkId = ref("");
const isAssetDocumentDragging = ref(false);
const showAllRelatedDiscussions = ref(false);
const focusedCredentialId = computed(() => {
  const value = route.query.credentialId;
  return typeof value === "string" ? value : "";
});

const assetForm = reactive<ManagedAssetInput>({
  partyOrganizationId: null,
  caseId: null,
  parentAssetId: null,
  name: "",
  assetType: "Other",
  status: "Active",
  manufacturer: "",
  model: "",
  serialNumber: "",
  macAddress: "",
  imei: "",
  iccid: "",
  phoneNumber: "",
  extension: "",
  hostname: "",
  lanIp: "",
  wanIp: "",
  installedLocation: "",
  installedAt: null,
  lastServiceAt: null,
  notes: ""
});

const credentialForm = reactive<AssetCredentialInput>({
  label: "",
  credentialType: "Admin login",
  username: "",
  loginUrl: "",
  host: "",
  notes: "",
  secret: "",
  privateNotes: "",
  lastVerifiedAt: null,
  rotationDueAt: null
});

const documentLinkForm = reactive<AssetDocumentLinkInput>({
  documentId: "",
  relationship: "Runbook",
  note: "",
  isPinned: true,
  sortOrder: 0
});

const assetUploadForm = reactive({
  category: (template.value.documentCategories[0] ?? "Other") as DocumentCategory,
  notes: "",
  relationship: "Runbook",
  note: "",
  isPinned: true
});

const assetDocumentEditForm = reactive({
  relationship: "Runbook",
  note: "",
  isPinned: false
});

const breadcrumbs = computed(() => {
  if (asset.value?.caseId) {
    return [
      { label: labels.value.plural, to: "/services" },
      {
        label: [asset.value.caseNumber, asset.value.caseTitle].filter(Boolean).join(" · "),
        to: workItemPath(asset.value.caseId)
      },
      { label: t("assets"), to: workItemPath(asset.value.caseId, "tab=assets") },
      { label: asset.value.name, current: true }
    ];
  }
  return [
    { label: t("assets"), to: "/managed-assets" },
    { label: asset.value?.name ?? "Asset", current: true }
  ];
});

const identityRows = computed(() => {
  if (!asset.value) return [];
  return [
    ["Manufacturer", asset.value.manufacturer],
    ["Model", asset.value.model],
    ["Serial number", asset.value.serialNumber],
    ["MAC address", asset.value.macAddress],
    ["IMEI", asset.value.imei],
    ["ICCID", asset.value.iccid]
  ].filter(([, value]) => value);
});

const networkRows = computed(() => {
  if (!asset.value) return [];
  return [
    ["Hostname", asset.value.hostname],
    ["LAN IP", asset.value.lanIp],
    [isHttpUrl(asset.value.wanIp) ? "Web UI / Management URL" : template.value.endpointLabel, asset.value.wanIp],
    ["Phone number", asset.value.phoneNumber],
    ["Extension", asset.value.extension],
    ["Installed location", asset.value.installedLocation]
  ].filter(([, value]) => value);
});

const availableDocumentCategories = computed<readonly DocumentCategory[]>(() => {
  const categories = template.value.documentCategories.length ? template.value.documentCategories : DOCUMENT_CATEGORIES;
  return categories as readonly DocumentCategory[];
});

const assetDocumentRelationshipOptions = computed(() => ASSET_DOCUMENT_RELATIONSHIPS);

const assetUploadFileSize = computed(() => (assetUploadFile.value ? formatFileSize(assetUploadFile.value.size) : ""));

const linkedDocumentIds = computed(() => new Set(assetDocuments.value.map((link) => link.documentId)));

const documentCandidates = computed(() => {
  const q = documentLinkSearch.value.trim().toLowerCase();
  return serviceDocuments.value
    .filter((document) => !linkedDocumentIds.value.has(document.documentId))
    .filter((document) => {
      if (!q) return true;
      return [
        document.originalFileName,
        document.fileName,
        document.category,
        document.notes,
        document.caseNumber,
        document.caseTitle,
        ...document.tags.map((tag) => tag.name)
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    })
    .slice(0, 25);
});

const pinnedAssetDocuments = computed(() => assetDocuments.value.filter((link) => link.isPinned));

const visibleRelatedDiscussions = computed(() =>
  showAllRelatedDiscussions.value ? relatedDiscussions.value : relatedDiscussions.value.slice(0, 3)
);

function linkedDiscussionMessages(thread: ServiceDiscussionMessage) {
  return [thread, ...(thread.replies ?? [])].filter((message) =>
    message.assetLinks.some((link) => link.assetId === assetId.value)
  );
}

function relatedDiscussionPreviewMessage(thread: ServiceDiscussionMessage) {
  return linkedDiscussionMessages(thread)[0] ?? thread;
}

function relatedDiscussionAttachmentCount(thread: ServiceDiscussionMessage) {
  return [thread, ...(thread.replies ?? [])].reduce((count, message) => count + message.attachments.length, 0);
}

function relatedDiscussionAssetLink(message: ServiceDiscussionMessage) {
  return message.assetLinks.find((link) => link.assetId === assetId.value) ?? null;
}

function relatedDiscussionStatusLabel(status: ServiceDiscussionMessage["threadStatus"]) {
  if (status === "needs-action") return "Needs action";
  if (status === "resolved") return "Resolved";
  if (status === "archived") return "Archived";
  return "Open";
}

function relatedDiscussionStatusClass(status: ServiceDiscussionMessage["threadStatus"]) {
  if (status === "needs-action") return "bg-amber-100 text-amber-900";
  if (status === "resolved") return "bg-emerald-100 text-emerald-900";
  if (status === "archived") return "bg-ink-200 text-ink-700";
  return "bg-blue-50 text-blue-900";
}

function relatedDiscussionLastActivity(thread: ServiceDiscussionMessage) {
  return formatDateTime(thread.latestActivityAt ?? thread.updatedAt);
}

function openRelatedDiscussion(message: ServiceDiscussionMessage) {
  void router.push({
    path: "/discussions",
    query: { view: "all", q: message.messageId }
  });
}

async function loadRelatedDiscussions(targetAssetId = assetId.value) {
  relatedDiscussionError.value = "";
  try {
    const result = await client.discussionMessagesPage(
      { assetId: targetAssetId, view: "all", sort: "recent" },
      { page: 1, pageSize: 100 }
    );
    relatedDiscussions.value = result.items;
    relatedDiscussionTotal.value = result.total;
  } catch (err) {
    relatedDiscussions.value = [];
    relatedDiscussionTotal.value = 0;
    relatedDiscussionError.value = err instanceof Error ? err.message : "Unable to load related discussions";
  }
}

async function unlinkRelatedDiscussion(message: ServiceDiscussionMessage) {
  if (!auth.canAddNotes || relatedDiscussionBusy.value) return;
  const link = relatedDiscussionAssetLink(message);
  if (!link) return;
  if (!window.confirm("Remove this discussion link from the asset? The discussion and its attachments will stay unchanged.")) return;
  relatedDiscussionBusy.value = true;
  relatedDiscussionError.value = "";
  try {
    await client.unlinkDiscussionMessageAsset(message.messageId, link.assetId);
    await loadRelatedDiscussions(link.assetId);
    toasts.success("Discussion unlinked", "The message remains available in Discussions.");
  } catch (err) {
    relatedDiscussionError.value = err instanceof Error ? err.message : "Unable to unlink discussion";
    toasts.error("Unable to unlink discussion", relatedDiscussionError.value);
  } finally {
    relatedDiscussionBusy.value = false;
  }
}

function syncDocumentLinkSelection() {
  if (documentLinkForm.documentId && documentCandidates.value.some((document) => document.documentId === documentLinkForm.documentId)) {
    return;
  }
  documentLinkForm.documentId = documentCandidates.value[0]?.documentId ?? "";
}

function assignAssetForm(record: ManagedAsset) {
  Object.assign(assetForm, {
    partyOrganizationId: record.partyOrganizationId ?? null,
    caseId: record.caseId ?? null,
    parentAssetId: record.parentAssetId ?? null,
    name: record.name,
    assetType: record.assetType,
    status: record.status,
    manufacturer: record.manufacturer,
    model: record.model,
    serialNumber: record.serialNumber,
    macAddress: record.macAddress,
    imei: record.imei,
    iccid: record.iccid,
    phoneNumber: record.phoneNumber,
    extension: record.extension,
    hostname: record.hostname,
    lanIp: record.lanIp,
    wanIp: record.wanIp,
    installedLocation: record.installedLocation,
    installedAt: record.installedAt ?? null,
    lastServiceAt: record.lastServiceAt ?? null,
    notes: record.notes
  });
  error.value = "";
}

function resetCredentialForm() {
  Object.assign(credentialForm, {
    label: "",
    credentialType: "Admin login",
    username: "",
    loginUrl: "",
    host: "",
    notes: "",
    secret: "",
    privateNotes: "",
    lastVerifiedAt: null,
    rotationDueAt: null
  });
  credentialError.value = "";
}

async function loadAssetDocumentContext(record: ManagedAsset) {
  const [links, documentsResult] = await Promise.all([
    client.assetDocuments(record.assetId),
    record.caseId
      ? client.documents(record.caseId)
      : client.documentsPage({ sort: "uploaded", direction: "desc" }, { pageSize: 100 }).then((page) => page.items)
  ]);
  assetDocuments.value = links;
  serviceDocuments.value = documentsResult;
  if (editingAssetDocumentLinkId.value && !links.some((link) => link.assetDocumentLinkId === editingAssetDocumentLinkId.value)) {
    cancelAssetDocumentLinkEdit();
  }
  syncDocumentLinkSelection();
}

function resetDocumentLinkForm() {
  Object.assign(documentLinkForm, {
    documentId: "",
    relationship: "Runbook",
    note: "",
    isPinned: true,
    sortOrder: 0
  });
  documentLinkSearch.value = "";
  syncDocumentLinkSelection();
}

function clearAssetUploadFile() {
  assetUploadFile.value = null;
  isAssetDocumentDragging.value = false;
  if (assetDocumentFileInput.value) assetDocumentFileInput.value.value = "";
}

function resetAssetUploadForm() {
  clearAssetUploadFile();
  Object.assign(assetUploadForm, {
    category: availableDocumentCategories.value[0] ?? "Other",
    notes: "",
    relationship: "Runbook",
    note: "",
    isPinned: true
  });
}

function openAssetDocumentFilePicker() {
  if (!auth.canUpload || !asset.value?.caseId) return;
  if (assetDocumentFileInput.value) assetDocumentFileInput.value.value = "";
  assetDocumentFileInput.value?.click();
}

function onAssetDocumentFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) {
    assetUploadFile.value = file;
    assetDocumentError.value = "";
  }
  isAssetDocumentDragging.value = false;
}

function onAssetDocumentDragEnter(event: DragEvent) {
  event.preventDefault();
  if (!auth.canUpload || !asset.value?.caseId || assetDocumentSaving.value) return;
  isAssetDocumentDragging.value = true;
}

function onAssetDocumentDragOver(event: DragEvent) {
  event.preventDefault();
  if (!auth.canUpload || !asset.value?.caseId || assetDocumentSaving.value) return;
  isAssetDocumentDragging.value = true;
}

function onAssetDocumentDragLeave(event: DragEvent) {
  const currentTarget = event.currentTarget as HTMLElement | null;
  const nextTarget = event.relatedTarget as Node | null;
  if (currentTarget && nextTarget && currentTarget.contains(nextTarget)) return;
  isAssetDocumentDragging.value = false;
}

function onAssetDocumentDrop(event: DragEvent) {
  event.preventDefault();
  if (!auth.canUpload || !asset.value?.caseId || assetDocumentSaving.value) return;
  isAssetDocumentDragging.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file) {
    assetUploadFile.value = file;
    assetDocumentError.value = "";
  }
  if (assetDocumentFileInput.value) assetDocumentFileInput.value.value = "";
}

async function focusCredentialFromRoute() {
  const credentialId = focusedCredentialId.value;
  if (!credentialId || loading.value || !credentials.value.some((item) => item.credentialId === credentialId)) return;
  await nextTick();
  document.getElementById(`credential-${credentialId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function load() {
  loading.value = true;
  try {
    const [assetRecord, organizationRows, serviceRows, assetRows, communicationRows] = await Promise.all([
      client.asset(assetId.value),
      client.partyOrganizationsPage({ sort: "name", direction: "asc" }, { pageSize: 100 }),
      client.casesPage({ archiveStatus: "all", sort: "number", direction: "desc" }, { pageSize: 100 }),
      client.assetsPage({ sort: "name", direction: "asc" }, { pageSize: 100 }),
      client.communicationsPage({ assetId: assetId.value, sort: "occurred", sortDirection: "desc" }, { pageSize: 12 })
    ]);
    asset.value = assetRecord;
    organizations.value = organizationRows.items;
    services.value = serviceRows.items;
    allAssets.value = assetRows.items.filter((item) => item.assetId !== assetRecord.assetId);
    communications.value = communicationRows.items;
    const [credentialRows] = await Promise.all([
      client.assetCredentials(assetRecord.assetId),
      loadAssetDocumentContext(assetRecord),
      loadRelatedDiscussions(assetRecord.assetId)
    ]);
    credentials.value = credentialRows;
  } finally {
    loading.value = false;
  }
  await focusCredentialFromRoute();
}

function openEditAsset() {
  if (!asset.value) return;
  assignAssetForm(asset.value);
  showEditAsset.value = true;
}

function openNewCredential() {
  editingCredential.value = null;
  resetCredentialForm();
  showCredentialForm.value = true;
}

function openEditCredential(credential: AssetCredential) {
  editingCredential.value = credential;
  Object.assign(credentialForm, {
    label: credential.label,
    credentialType: credential.credentialType,
    username: credential.username,
    loginUrl: credential.loginUrl,
    host: credential.host,
    notes: credential.notes,
    secret: "",
    privateNotes: "",
    lastVerifiedAt: credential.lastVerifiedAt ?? null,
    rotationDueAt: credential.rotationDueAt ?? null
  });
  credentialError.value = "";
  showCredentialForm.value = true;
}

async function saveAsset() {
  if (!asset.value || saving.value) return;
  saving.value = true;
  error.value = "";
  try {
    asset.value = await client.updateAsset(asset.value.assetId, { ...assetForm, name: assetForm.name.trim() });
    showEditAsset.value = false;
    toasts.success("Asset saved", `${asset.value.name} was updated.`);
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to save asset";
    toasts.error("Unable to save asset", error.value);
  } finally {
    saving.value = false;
  }
}

async function archiveAsset() {
  if (!asset.value || !window.confirm(`Archive ${asset.value.name}? Credentials remain in the database but the asset is removed from active views.`)) return;
  await client.deleteAsset(asset.value.assetId);
  toasts.success("Asset archived", `${asset.value.name} was removed from active views.`);
  await router.push("/managed-assets");
}

async function saveCredential() {
  if (!asset.value || credentialSaving.value || !credentialForm.label.trim()) return;
  credentialSaving.value = true;
  credentialError.value = "";
  try {
    if (editingCredential.value) {
      const payload: Partial<AssetCredentialInput> = {
        label: credentialForm.label.trim(),
        credentialType: credentialForm.credentialType,
        username: credentialForm.username,
        loginUrl: credentialForm.loginUrl,
        host: credentialForm.host,
        notes: credentialForm.notes,
        lastVerifiedAt: credentialForm.lastVerifiedAt,
        rotationDueAt: credentialForm.rotationDueAt
      };
      if (credentialForm.secret !== "") payload.secret = credentialForm.secret;
      if (credentialForm.privateNotes !== "") payload.privateNotes = credentialForm.privateNotes;
      await client.updateAssetCredential(editingCredential.value.credentialId, payload);
      toasts.success("Credential saved", `${credentialForm.label} was updated.`);
    } else {
      await client.createAssetCredential(asset.value.assetId, {
        ...credentialForm,
        label: credentialForm.label.trim()
      });
      toasts.success("Credential added", `${credentialForm.label} is encrypted and attached to this asset.`);
    }
    showCredentialForm.value = false;
    resetCredentialForm();
    credentials.value = await client.assetCredentials(asset.value.assetId);
  } catch (err) {
    credentialError.value = err instanceof Error ? err.message : "Unable to save credential";
    toasts.error("Unable to save credential", credentialError.value);
  } finally {
    credentialSaving.value = false;
  }
}

async function refreshAssetDocuments() {
  if (!asset.value) return;
  await loadAssetDocumentContext(asset.value);
}

function openEditAssetDocumentLink(link: AssetDocumentLink) {
  editingAssetDocumentLinkId.value = link.assetDocumentLinkId;
  Object.assign(assetDocumentEditForm, {
    relationship: link.relationship || "Other",
    note: link.note,
    isPinned: link.isPinned
  });
  assetDocumentError.value = "";
}

function cancelAssetDocumentLinkEdit() {
  editingAssetDocumentLinkId.value = "";
  Object.assign(assetDocumentEditForm, {
    relationship: "Runbook",
    note: "",
    isPinned: false
  });
}

async function linkExistingDocument() {
  if (!asset.value || assetDocumentSaving.value || !documentLinkForm.documentId) return;
  assetDocumentSaving.value = true;
  assetDocumentError.value = "";
  try {
    const selected = serviceDocuments.value.find((document) => document.documentId === documentLinkForm.documentId);
    await client.linkAssetDocument(asset.value.assetId, {
      ...documentLinkForm,
      note: documentLinkForm.note?.trim() ?? ""
    });
    toasts.success("Core document linked", selected?.originalFileName ?? "Document linked to this asset.");
    resetDocumentLinkForm();
    await refreshAssetDocuments();
  } catch (err) {
    assetDocumentError.value = err instanceof Error ? err.message : "Unable to link document";
    toasts.error("Unable to link document", assetDocumentError.value);
  } finally {
    assetDocumentSaving.value = false;
  }
}

async function uploadAndLinkAssetDocument() {
  if (!asset.value || !asset.value.caseId || !assetUploadFile.value || assetDocumentSaving.value) return;
  assetDocumentSaving.value = true;
  assetDocumentError.value = "";
  try {
    const form = new FormData();
    form.append("file", assetUploadFile.value);
    form.append("category", assetUploadForm.category);
    form.append("notes", assetUploadForm.notes);
    const uploaded = await client.uploadDocument(asset.value.caseId, form);
    await client.linkAssetDocument(asset.value.assetId, {
      documentId: uploaded.documentId,
      relationship: assetUploadForm.relationship,
      note: assetUploadForm.note.trim(),
      isPinned: assetUploadForm.isPinned,
      sortOrder: 0
    });
    toasts.success("Document uploaded", `${uploaded.originalFileName} was uploaded and linked.`);
    resetAssetUploadForm();
    await refreshAssetDocuments();
  } catch (err) {
    assetDocumentError.value = err instanceof Error ? err.message : "Unable to upload and link document";
    toasts.error("Upload failed", assetDocumentError.value);
  } finally {
    assetDocumentSaving.value = false;
  }
}

async function updateAssetDocumentLink(link: AssetDocumentLink, patch: { relationship?: string; note?: string; isPinned?: boolean }) {
  if (!auth.canManageAssets || assetDocumentSaving.value) return;
  assetDocumentSaving.value = true;
  assetDocumentError.value = "";
  try {
    const updated = await client.updateAssetDocumentLink(link.assetDocumentLinkId, patch);
    assetDocuments.value = assetDocuments.value
      .map((item) => (item.assetDocumentLinkId === updated.assetDocumentLinkId ? updated : item))
      .sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return b.updatedAt.localeCompare(a.updatedAt);
      });
    toasts.success("Core document updated", updated.document.originalFileName);
  } catch (err) {
    assetDocumentError.value = err instanceof Error ? err.message : "Unable to update document link";
    toasts.error("Unable to update link", assetDocumentError.value);
  } finally {
    assetDocumentSaving.value = false;
  }
}

async function saveAssetDocumentLink(link: AssetDocumentLink) {
  await updateAssetDocumentLink(link, {
    relationship: assetDocumentEditForm.relationship,
    note: assetDocumentEditForm.note.trim(),
    isPinned: assetDocumentEditForm.isPinned
  });
  if (!assetDocumentError.value) cancelAssetDocumentLinkEdit();
}

async function removeAssetDocumentLink(link: AssetDocumentLink) {
  if (!auth.canManageAssets || assetDocumentSaving.value) return;
  if (!window.confirm(`Remove ${link.document.originalFileName} from this asset? The document itself will stay in Documents.`)) return;
  assetDocumentSaving.value = true;
  assetDocumentError.value = "";
  try {
    await client.deleteAssetDocumentLink(link.assetDocumentLinkId);
    assetDocuments.value = assetDocuments.value.filter((item) => item.assetDocumentLinkId !== link.assetDocumentLinkId);
    if (editingAssetDocumentLinkId.value === link.assetDocumentLinkId) cancelAssetDocumentLinkEdit();
    syncDocumentLinkSelection();
    toasts.success("Core document removed", link.document.originalFileName);
  } catch (err) {
    assetDocumentError.value = err instanceof Error ? err.message : "Unable to remove document link";
    toasts.error("Unable to remove link", assetDocumentError.value);
  } finally {
    assetDocumentSaving.value = false;
  }
}

async function revealCredential(credential: AssetCredential) {
  const result = await client.revealAssetCredential(credential.credentialId);
  revealedSecrets.value = {
    ...revealedSecrets.value,
    [credential.credentialId]: result
  };
  toasts.success("Credential revealed", `${credential.label} was decrypted for this session.`);
}

async function copyTextToClipboard(value: string): Promise<boolean> {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall back below for browsers that expose the API but block this origin.
    }
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  textArea.setSelectionRange(0, textArea.value.length);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textArea);
  }
}

async function copyCredential(credential: AssetCredential) {
  try {
    const result = await client.copyAssetCredential(credential.credentialId);
    revealedSecrets.value = {
      ...revealedSecrets.value,
      [credential.credentialId]: result
    };
    const copied = await copyTextToClipboard(result.secret);
    if (copied) {
      toasts.success("Credential copied", `${credential.label} secret was copied to the clipboard.`);
    } else {
      toasts.error(
        "Clipboard blocked",
        "The secret was revealed below. Select it manually or use HTTPS to enable direct clipboard copy."
      );
    }
  } catch (err) {
    toasts.error("Unable to copy credential", err instanceof Error ? err.message : "The credential could not be copied.");
  }
}

function hideCredential(credentialId: string) {
  const next = { ...revealedSecrets.value };
  delete next[credentialId];
  revealedSecrets.value = next;
}

async function deleteCredential(credential: AssetCredential) {
  if (!window.confirm(`Delete credential ${credential.label}?`)) return;
  await client.deleteAssetCredential(credential.credentialId);
  if (asset.value) credentials.value = await client.assetCredentials(asset.value.assetId);
  hideCredential(credential.credentialId);
  toasts.success("Credential deleted", `${credential.label} was removed from active credential views.`);
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
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to update communication";
    error.value = message;
    toasts.error("Unable to update communication", message);
  }
}

function openAssetCommunicationLog() {
  if (!asset.value) return;
  const draftId = crypto.randomUUID();
  sessionStorage.setItem(
    `${COMMUNICATION_DRAFT_STORAGE_PREFIX}${draftId}`,
    JSON.stringify({
      caseId: asset.value.caseId ?? null,
      partyOrganizationId: asset.value.partyOrganizationId ?? null,
      contactId: null,
      assetId: asset.value.assetId,
      supportingDocumentId: null,
      communicationType: "Call",
      direction: "Inbound",
      source: "Manual",
      status: asset.value.caseId ? "Linked" : "Logged",
      externalProvider: "",
      externalReference: "",
      externalUrl: "",
      sourceMetadata: {},
      subject: "",
      body: "",
      occurredAt: new Date().toISOString(),
      draftNotice: `Prepared for asset ${asset.value.name}. Add notes, adjust service or organization links if needed, then save.`
    })
  );
  void router.push(`/communications?draft=${draftId}`);
}

onMounted(load);
watch(assetId, load);
watch(focusedCredentialId, () => void focusCredentialFromRoute());
watch(documentCandidates, syncDocumentLinkSelection);
watch(
  availableDocumentCategories,
  (categories) => {
    if (!categories.includes(assetUploadForm.category)) {
      assetUploadForm.category = categories[0] ?? "Other";
    }
  },
  { immediate: true }
);
</script>

<template>
  <div v-if="loading" class="panel p-5 text-sm text-ink-500">Loading asset...</div>

  <div v-else-if="asset">
    <Breadcrumbs :items="breadcrumbs" />
    <PageHeader :eyebrow="asset.assetType" :title="asset.name" :description="asset.notes">
      <div class="flex flex-wrap items-center gap-2">
        <RouterLink
          v-if="asset.caseId"
          class="btn-secondary h-9 px-3"
          :to="workItemPath(asset.caseId, 'tab=assets')"
          :title="`Back to ${asset.caseNumber ?? labels.singular} assets`"
        >
          <ArrowLeft class="h-4 w-4" />
          Back to service assets
        </RouterLink>
        <StatusBadge :status="asset.status" />
        <button
          class="btn-secondary h-9 px-3"
          :disabled="!auth.canManageAssets"
          :title="auth.canManageAssets ? 'Edit asset' : t('readonlyNotice')"
          @click="openEditAsset"
        >
          <Edit3 class="h-4 w-4" />
          Edit
        </button>
        <button
          class="btn-secondary h-9 px-3 text-legal-red hover:border-red-200 hover:bg-red-50"
          :disabled="!auth.canManageAssets"
          :title="auth.canManageAssets ? 'Archive asset' : t('readonlyNotice')"
          @click="archiveAsset"
        >
          <Archive class="h-4 w-4" />
          Archive
        </button>
      </div>
    </PageHeader>

    <section class="grid min-w-0 items-start gap-3 xl:grid-cols-2">
      <div class="min-w-0 space-y-3">
        <div class="panel p-4">
          <div class="mb-3 flex items-center gap-3">
            <div class="grid h-10 w-10 place-items-center rounded-md bg-accent-50 text-accent-900">
              <HardDrive class="h-5 w-5" />
            </div>
            <div>
              <h2 class="font-semibold">Asset profile</h2>
              <p class="text-sm text-ink-500">Core ownership and operational context.</p>
            </div>
          </div>
          <dl class="space-y-3 text-sm">
            <div v-if="asset.partyOrganizationName" class="flex items-start gap-2">
              <Building2 class="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
              <div>
                <dt class="text-xs uppercase text-ink-500">Organization</dt>
                <dd class="font-semibold">{{ asset.partyOrganizationName }}</dd>
              </div>
            </div>
            <div v-if="asset.caseNumber" class="flex items-start gap-2">
              <BriefcaseBusiness class="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
              <div>
                <dt class="text-xs uppercase text-ink-500">Linked {{ labels.lowerSingular }}</dt>
                <dd class="font-semibold">
                  <RouterLink class="text-accent-700 hover:text-accent-900" :to="workItemPath(asset.caseId || undefined)">
                    {{ asset.caseNumber }} · {{ asset.caseTitle }}
                  </RouterLink>
                </dd>
              </div>
            </div>
            <div v-if="asset.parentAssetName" class="flex items-start gap-2">
              <HardDrive class="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
              <div>
                <dt class="text-xs uppercase text-ink-500">Hosted on / Runs on</dt>
                <dd class="font-semibold">
                  <RouterLink class="text-accent-700 hover:text-accent-900" :to="`/managed-assets/${asset.parentAssetId}`">
                    {{ asset.parentAssetName }}
                  </RouterLink>
                </dd>
              </div>
            </div>
            <div v-if="asset.installedAt">
              <dt class="text-xs uppercase text-ink-500">Installed</dt>
              <dd class="font-semibold">{{ formatDate(asset.installedAt) }}</dd>
            </div>
            <div v-if="asset.lastServiceAt">
              <dt class="text-xs uppercase text-ink-500">Last service</dt>
              <dd class="font-semibold">{{ formatDate(asset.lastServiceAt) }}</dd>
            </div>
            <div>
              <dt class="text-xs uppercase text-ink-500">Updated</dt>
              <dd class="font-semibold">{{ formatDateTime(asset.updatedAt) }}</dd>
            </div>
          </dl>
        </div>

        <div class="panel p-4">
          <h2 class="mb-3 font-semibold">Identifiers</h2>
          <dl v-if="identityRows.length" class="grid gap-3 text-sm sm:grid-cols-2">
            <div v-for="[label, value] in identityRows" :key="label">
              <dt class="text-xs uppercase text-ink-500">{{ label }}</dt>
              <dd class="mt-1 break-words font-semibold">{{ value }}</dd>
            </div>
          </dl>
          <p v-else class="text-sm text-ink-500">No hardware identifiers saved yet.</p>
        </div>

        <div class="panel p-4">
          <h2 class="mb-3 font-semibold">Network and service details</h2>
          <dl v-if="networkRows.length" class="grid gap-3 text-sm sm:grid-cols-2">
            <div v-for="[label, value] in networkRows" :key="label">
              <dt class="text-xs uppercase text-ink-500">{{ label }}</dt>
              <dd class="mt-1 break-words font-semibold">{{ value }}</dd>
            </div>
          </dl>
          <p v-else class="text-sm text-ink-500">No network, number, or location details saved yet.</p>
        </div>

        <div id="credentials" class="panel scroll-mt-4 overflow-hidden">
          <div class="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 p-4">
            <div class="flex items-start gap-3">
              <div class="grid h-10 w-10 place-items-center rounded-md bg-accent-50 text-accent-900">
                <KeyRound class="h-5 w-5" />
              </div>
              <div>
                <h2 class="font-semibold">Credentials</h2>
                <p class="text-sm text-ink-500">Encrypted passwords, portal logins, SIP secrets, keys, and private notes.</p>
              </div>
            </div>
            <button
              class="btn-primary h-9 px-3"
              :disabled="!auth.canManageAssets"
              :title="auth.canManageAssets ? 'Add credential' : t('readonlyNotice')"
              @click="openNewCredential"
            >
              <Plus class="h-4 w-4" />
              Add credential
            </button>
          </div>

          <div class="divide-y divide-ink-100">
            <article
              v-for="credential in credentials"
              :id="`credential-${credential.credentialId}`"
              :key="credential.credentialId"
              class="scroll-mt-4 p-4 transition-colors"
              :class="focusedCredentialId === credential.credentialId ? 'bg-accent-50 ring-1 ring-inset ring-accent-300' : ''"
            >
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <h3 class="font-semibold text-ink-900">{{ credential.label }}</h3>
                    <span class="rounded-full bg-ink-100 px-2.5 py-1 text-xs font-semibold text-ink-700">
                      {{ credential.credentialType }}
                    </span>
                  </div>
                  <p class="mt-1 text-sm text-ink-500">
                    <span v-if="credential.username">User: {{ credential.username }}</span>
                    <span v-if="credential.host"> · Host: {{ credential.host }}</span>
                    <span v-if="credential.loginUrl"> · {{ credential.loginUrl }}</span>
                  </p>
                  <p v-if="credential.notes" class="mt-2 whitespace-pre-wrap text-sm text-ink-600">{{ credential.notes }}</p>
                </div>
                <div class="flex flex-wrap justify-end gap-2">
                  <button
                    v-if="auth.canRevealCredentials && !revealedSecrets[credential.credentialId]"
                    class="btn-secondary h-9 px-3"
                    type="button"
                    @click="revealCredential(credential)"
                  >
                    <Eye class="h-4 w-4" />
                    Reveal
                  </button>
                  <button
                    v-if="auth.canRevealCredentials"
                    class="btn-secondary h-9 px-3"
                    type="button"
                    title="Copy encrypted secret/password"
                    @click="copyCredential(credential)"
                  >
                    <Copy class="h-4 w-4" />
                    Copy secret
                  </button>
                  <button
                    v-if="revealedSecrets[credential.credentialId]"
                    class="btn-secondary h-9 px-3"
                    type="button"
                    @click="hideCredential(credential.credentialId)"
                  >
                    <EyeOff class="h-4 w-4" />
                    Hide
                  </button>
                  <button
                    class="btn-secondary h-9 px-3"
                    type="button"
                    :disabled="!auth.canManageAssets"
                    @click="openEditCredential(credential)"
                  >
                    <Edit3 class="h-4 w-4" />
                    Edit
                  </button>
                  <button
                    class="btn-secondary h-9 px-3 text-legal-red hover:border-red-200 hover:bg-red-50"
                    type="button"
                    :disabled="!auth.canManageAssets"
                    @click="deleteCredential(credential)"
                  >
                    <Trash2 class="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div v-if="revealedSecrets[credential.credentialId]" class="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                <p class="text-xs font-semibold uppercase">Decrypted for this browser session</p>
                <p class="mt-2 break-all font-mono text-sm">{{ revealedSecrets[credential.credentialId].secret || "(empty secret)" }}</p>
                <p v-if="revealedSecrets[credential.credentialId].privateNotes" class="mt-2 whitespace-pre-wrap text-sm">
                  {{ revealedSecrets[credential.credentialId].privateNotes }}
                </p>
              </div>
              <p v-else-if="!auth.canRevealCredentials" class="mt-3 text-sm text-ink-500">
                Your role can view credential metadata but cannot reveal or copy encrypted secrets.
              </p>
            </article>

            <div v-if="!credentials.length" class="p-5 text-sm text-ink-500">
              No credentials yet. Add them manually from the old info files when the data is verified.
            </div>
          </div>
        </div>
      </div>

      <div class="min-w-0 space-y-3">
        <div class="panel overflow-hidden">
          <div class="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 p-4">
            <div class="flex items-start gap-3">
              <div class="grid h-10 w-10 place-items-center rounded-md bg-accent-50 text-accent-900">
                <FileText class="h-5 w-5" />
              </div>
              <div>
                <h2 class="font-semibold">Core documents</h2>
                <p class="text-sm text-ink-500">
                  {{ assetDocuments.length }} linked<span v-if="pinnedAssetDocuments.length"> · {{ pinnedAssetDocuments.length }} pinned</span>
                </p>
              </div>
            </div>
          </div>

          <div class="divide-y divide-ink-100">
            <article v-for="link in assetDocuments" :key="link.assetDocumentLinkId" class="p-4">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <div class="flex min-w-0 items-start gap-3">
                    <div class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-ink-50 text-accent-800">
                      <FileText class="h-4 w-4" />
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="flex min-w-0 flex-wrap items-center gap-2">
                        <a
                          class="min-w-0 break-words font-semibold text-accent-800 hover:text-accent-900"
                          :href="`/api/documents/${link.document.documentId}/preview`"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {{ link.document.originalFileName }}
                        </a>
                        <span class="rounded-full bg-ink-100 px-2.5 py-1 text-xs font-semibold text-ink-700">
                          {{ link.relationship }}
                        </span>
                        <span v-if="link.isPinned" class="inline-flex items-center gap-1 rounded-full bg-accent-50 px-2.5 py-1 text-xs font-semibold text-accent-800">
                          <Pin class="h-3.5 w-3.5" />
                          Pinned to asset
                        </span>
                      </div>
                      <p class="mt-1 text-xs text-ink-500">
                        {{ link.document.category }} · {{ formatFileSize(link.document.fileSize) }} · {{ formatDateTime(link.document.uploadedAt) }}
                      </p>
                      <p v-if="link.note" class="mt-3 whitespace-pre-wrap rounded-md bg-ink-50 px-3 py-2 text-sm text-ink-700">
                        <span class="mb-1 block text-xs font-semibold uppercase text-ink-500">Asset note</span>
                        {{ link.note }}
                      </p>
                    </div>
                  </div>

                  <div
                    v-if="editingAssetDocumentLinkId === link.assetDocumentLinkId"
                    class="mt-4 border-t border-ink-100 pt-4"
                  >
                    <div class="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
                      <label class="block">
                        <span class="mb-1 block text-xs font-semibold uppercase text-ink-500">Relationship</span>
                        <select
                          v-model="assetDocumentEditForm.relationship"
                          class="input h-10 py-1 text-sm"
                          :disabled="!auth.canManageAssets || assetDocumentSaving"
                        >
                          <option v-for="relationship in assetDocumentRelationshipOptions" :key="relationship" :value="relationship">
                            {{ relationship }}
                          </option>
                        </select>
                      </label>
                      <label class="block">
                        <span class="mb-1 block text-xs font-semibold uppercase text-ink-500">Asset note</span>
                        <textarea
                          v-model="assetDocumentEditForm.note"
                          class="input min-h-20 resize-y py-2 text-sm"
                          placeholder="Why this document matters for this asset"
                          :disabled="!auth.canManageAssets || assetDocumentSaving"
                        ></textarea>
                      </label>
                    </div>
                    <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <label class="flex h-9 items-center gap-2 rounded-md border border-ink-200 bg-white px-3 text-sm font-semibold">
                        <input v-model="assetDocumentEditForm.isPinned" type="checkbox" :disabled="!auth.canManageAssets || assetDocumentSaving" />
                        Pin to asset
                      </label>
                      <div class="flex flex-wrap justify-end gap-2">
                        <button class="btn-secondary h-9 px-3" type="button" :disabled="assetDocumentSaving" @click="cancelAssetDocumentLinkEdit">
                          <X class="h-4 w-4" />
                          Cancel
                        </button>
                        <button
                          class="btn-primary h-9 px-3"
                          type="button"
                          :disabled="!auth.canManageAssets || assetDocumentSaving"
                          @click="saveAssetDocumentLink(link)"
                        >
                          <Save class="h-4 w-4" />
                          Save
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="flex shrink-0 flex-wrap justify-end gap-2">
                  <button
                    class="btn-secondary h-9 w-9 px-0"
                    type="button"
                    :disabled="!auth.canManageAssets || assetDocumentSaving"
                    :title="link.isPinned ? 'Unpin from asset' : 'Pin to asset'"
                    @click="updateAssetDocumentLink(link, { isPinned: !link.isPinned })"
                  >
                    <PinOff v-if="link.isPinned" class="h-4 w-4" />
                    <Pin v-else class="h-4 w-4" />
                  </button>
                  <a class="btn-secondary h-9 w-9 px-0" :href="`/api/documents/${link.document.documentId}/download`" title="Download">
                    <Download class="h-4 w-4" />
                  </a>
                  <button
                    class="btn-secondary h-9 w-9 px-0"
                    type="button"
                    :disabled="!auth.canManageAssets || assetDocumentSaving"
                    title="Edit asset note"
                    @click="editingAssetDocumentLinkId === link.assetDocumentLinkId ? cancelAssetDocumentLinkEdit() : openEditAssetDocumentLink(link)"
                  >
                    <Edit3 class="h-4 w-4" />
                  </button>
                  <button
                    class="btn-secondary h-9 w-9 px-0 text-legal-red hover:border-red-200 hover:bg-red-50"
                    type="button"
                    :disabled="!auth.canManageAssets || assetDocumentSaving"
                    title="Remove link"
                    @click="removeAssetDocumentLink(link)"
                  >
                    <Trash2 class="h-4 w-4" />
                  </button>
                </div>
              </div>
            </article>

            <div v-if="!assetDocuments.length" class="p-4 text-sm text-ink-500">
              No core documents are linked to this asset yet.
            </div>
          </div>

          <div class="border-t border-ink-100 bg-ink-50/50 p-4">
            <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h3 class="text-sm font-semibold text-ink-900">Add core document</h3>
              <div class="inline-flex rounded-md border border-ink-200 bg-white p-1" role="tablist" aria-label="Add core document source">
                <button
                  class="inline-flex h-8 items-center gap-2 rounded px-3 text-sm font-semibold"
                  :class="assetDocumentEntryMode === 'link' ? 'bg-accent-900 text-white' : 'text-ink-600 hover:bg-ink-50'"
                  type="button"
                  role="tab"
                  :aria-selected="assetDocumentEntryMode === 'link'"
                  @click="assetDocumentEntryMode = 'link'"
                >
                  <Link2 class="h-4 w-4" />
                  From Documents
                </button>
                <button
                  class="inline-flex h-8 items-center gap-2 rounded px-3 text-sm font-semibold"
                  :class="assetDocumentEntryMode === 'upload' ? 'bg-accent-900 text-white' : 'text-ink-600 hover:bg-ink-50'"
                  type="button"
                  role="tab"
                  :aria-selected="assetDocumentEntryMode === 'upload'"
                  @click="assetDocumentEntryMode = 'upload'"
                >
                  <Upload class="h-4 w-4" />
                  Upload file
                </button>
              </div>
            </div>

            <div v-if="assetDocumentEntryMode === 'link'" class="space-y-3">
              <input
                v-model="documentLinkSearch"
                class="input h-10 py-1 text-sm"
                placeholder="Search existing documents"
                :disabled="!auth.canManageAssets || assetDocumentSaving"
              />
              <div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_180px_auto]">
                <select
                  v-model="documentLinkForm.documentId"
                  class="input h-10 py-1 text-sm"
                  :disabled="!auth.canManageAssets || assetDocumentSaving || !documentCandidates.length"
                >
                  <option value="" disabled>{{ documentCandidates.length ? "Select a document" : "No available documents" }}</option>
                  <option v-for="document in documentCandidates" :key="document.documentId" :value="document.documentId">
                    {{ document.originalFileName }}
                  </option>
                </select>
                <select
                  v-model="documentLinkForm.relationship"
                  class="input h-10 py-1 text-sm"
                  :disabled="!auth.canManageAssets || assetDocumentSaving"
                >
                  <option v-for="relationship in assetDocumentRelationshipOptions" :key="relationship" :value="relationship">
                    {{ relationship }}
                  </option>
                </select>
                <label class="flex h-10 items-center gap-2 rounded-md border border-ink-200 bg-white px-3 text-sm font-semibold">
                  <input v-model="documentLinkForm.isPinned" type="checkbox" :disabled="!auth.canManageAssets || assetDocumentSaving" />
                  Pin to asset
                </label>
              </div>
              <div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
                <textarea
                  v-model="documentLinkForm.note"
                  class="input min-h-20 resize-y py-2 text-sm"
                  placeholder="Asset note"
                  :disabled="!auth.canManageAssets || assetDocumentSaving"
                ></textarea>
                <button
                  class="btn-primary h-10 px-3 xl:self-start"
                  type="button"
                  :disabled="!auth.canManageAssets || assetDocumentSaving || !documentLinkForm.documentId"
                  @click="linkExistingDocument"
                >
                  <Link2 class="h-4 w-4" />
                  Link to asset
                </button>
              </div>
            </div>

            <div v-else class="space-y-3">
              <input ref="assetDocumentFileInput" class="hidden" type="file" :disabled="!auth.canUpload || !asset.caseId" @change="onAssetDocumentFileChange" />
              <div
                v-if="assetUploadFile"
                class="rounded-md border p-3 transition"
                :class="[
                  isAssetDocumentDragging ? 'border-accent-600 bg-accent-100 text-accent-950 ring-2 ring-accent-100' : 'border-accent-500 bg-accent-50 text-accent-950',
                  !auth.canUpload || !asset.caseId || assetDocumentSaving ? 'opacity-60' : ''
                ]"
                @dragenter="onAssetDocumentDragEnter"
                @dragover="onAssetDocumentDragOver"
                @dragleave="onAssetDocumentDragLeave"
                @drop="onAssetDocumentDrop"
              >
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div class="flex min-w-0 items-center gap-3">
                    <div class="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-white text-accent-800 shadow-sm">
                      <FileText class="h-5 w-5" />
                    </div>
                    <div class="min-w-0">
                      <p class="text-xs font-semibold uppercase text-accent-800">
                        {{ isAssetDocumentDragging ? "Drop to replace file" : "File ready to upload" }}
                      </p>
                      <p class="break-all text-sm font-semibold text-ink-950">{{ assetUploadFile.name }}</p>
                      <p class="text-xs text-accent-900">{{ assetUploadFileSize }}</p>
                    </div>
                  </div>
                  <div class="flex shrink-0 items-center gap-2">
                    <button
                      class="btn-secondary h-9 px-3"
                      type="button"
                      :disabled="!auth.canUpload || !asset.caseId || assetDocumentSaving"
                      @click="openAssetDocumentFilePicker"
                    >
                      Change
                    </button>
                    <button
                      class="btn-secondary h-9 w-9 px-0 text-legal-red hover:border-red-200 hover:bg-red-50"
                      type="button"
                      :disabled="!auth.canUpload || !asset.caseId || assetDocumentSaving"
                      aria-label="Remove selected file"
                      @click="clearAssetUploadFile"
                    >
                      <X class="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
              <div
                v-else
                class="grid min-h-[92px] cursor-pointer place-items-center rounded-md border border-dashed px-4 py-3 text-center transition"
                :class="[
                  isAssetDocumentDragging ? 'border-accent-600 bg-accent-50 text-accent-950 ring-2 ring-accent-100' : 'border-ink-300 bg-white text-ink-700 hover:border-accent-500 hover:bg-ink-50',
                  !auth.canUpload || !asset.caseId || assetDocumentSaving ? 'cursor-not-allowed opacity-60 hover:border-ink-300 hover:bg-white' : ''
                ]"
                role="button"
                :tabindex="!auth.canUpload || !asset.caseId || assetDocumentSaving ? -1 : 0"
                :aria-disabled="!auth.canUpload || !asset.caseId || assetDocumentSaving"
                @click="openAssetDocumentFilePicker"
                @keydown.enter.prevent="openAssetDocumentFilePicker"
                @keydown.space.prevent="openAssetDocumentFilePicker"
                @dragenter="onAssetDocumentDragEnter"
                @dragover="onAssetDocumentDragOver"
                @dragleave="onAssetDocumentDragLeave"
                @drop="onAssetDocumentDrop"
              >
                <div>
                  <Upload class="mx-auto h-6 w-6 text-ink-500" />
                  <p class="mt-2 text-sm font-semibold">
                    {{ isAssetDocumentDragging ? "Drop file here" : "Choose file or drag it here" }}
                  </p>
                  <p class="mt-1 text-xs text-ink-500">Saved in Documents and linked to this asset.</p>
                </div>
              </div>
              <div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_180px_auto]">
                <select
                  v-model="assetUploadForm.category"
                  class="input h-10 py-1 text-sm"
                  :disabled="!auth.canUpload || !asset.caseId || assetDocumentSaving"
                >
                  <option v-for="category in availableDocumentCategories" :key="category" :value="category">
                    {{ category }}
                  </option>
                </select>
                <select
                  v-model="assetUploadForm.relationship"
                  class="input h-10 py-1 text-sm"
                  :disabled="!auth.canUpload || !asset.caseId || assetDocumentSaving"
                >
                  <option v-for="relationship in assetDocumentRelationshipOptions" :key="relationship" :value="relationship">
                    {{ relationship }}
                  </option>
                </select>
                <label class="flex h-10 items-center gap-2 rounded-md border border-ink-200 bg-white px-3 text-sm font-semibold">
                  <input v-model="assetUploadForm.isPinned" type="checkbox" :disabled="!auth.canUpload || !asset.caseId || assetDocumentSaving" />
                  Pin to asset
                </label>
              </div>
              <div class="grid gap-3 xl:grid-cols-2">
                <textarea
                  v-model="assetUploadForm.notes"
                  class="input min-h-20 resize-y py-2 text-sm"
                  placeholder="Document notes"
                  :disabled="!auth.canUpload || !asset.caseId || assetDocumentSaving"
                ></textarea>
                <textarea
                  v-model="assetUploadForm.note"
                  class="input min-h-20 resize-y py-2 text-sm"
                  placeholder="Asset note"
                  :disabled="!auth.canUpload || !asset.caseId || assetDocumentSaving"
                ></textarea>
              </div>
              <div class="flex flex-wrap items-center justify-between gap-3">
                <p v-if="assetUploadFile" class="text-xs text-ink-500">{{ assetUploadFileSize }}</p>
                <p v-else-if="!asset.caseId" class="text-xs text-ink-500">Link this asset to a service before uploading from here.</p>
                <span v-else class="text-xs text-ink-500">Uploads are saved in Documents and linked here.</span>
                <button
                  class="btn-primary h-10 px-3"
                  type="button"
                  :disabled="!auth.canUpload || !asset.caseId || !assetUploadFile || assetDocumentSaving"
                  @click="uploadAndLinkAssetDocument"
                >
                  <Upload class="h-4 w-4" />
                  Upload & link
                </button>
              </div>
            </div>
          </div>

          <p v-if="assetDocumentError" class="border-t border-ink-100 px-4 py-3 text-sm font-semibold text-legal-red">
            {{ assetDocumentError }}
          </p>
        </div>

        <div class="panel min-w-0 overflow-hidden">
          <div class="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 p-4">
            <div class="flex min-w-0 items-start gap-3">
              <div class="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-accent-50 text-accent-900">
                <MessageSquare class="h-5 w-5" />
              </div>
              <div class="min-w-0">
                <h2 class="font-semibold">Related discussions</h2>
                <p class="text-sm text-ink-500">
                  {{ relatedDiscussionTotal }} {{ relatedDiscussionTotal === 1 ? "thread" : "threads" }} linked to this asset.
                </p>
              </div>
            </div>
            <button
              v-if="relatedDiscussions.length > 3"
              class="btn-secondary h-9 px-3 text-sm"
              type="button"
              @click="showAllRelatedDiscussions = !showAllRelatedDiscussions"
            >
              <ChevronDown v-if="!showAllRelatedDiscussions" class="h-4 w-4" />
              <ChevronRight v-else class="h-4 w-4" />
              {{ showAllRelatedDiscussions ? "Show recent" : `Show all ${relatedDiscussionTotal}` }}
            </button>
          </div>

          <div v-if="visibleRelatedDiscussions.length" class="divide-y divide-ink-100">
            <article v-for="thread in visibleRelatedDiscussions" :key="thread.messageId" class="min-w-0 p-3 sm:p-4">
              <div class="flex min-w-0 items-start gap-3">
                <div class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-ink-50 text-accent-800">
                  <MessageSquare class="h-4 w-4" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
                    <span class="font-semibold text-ink-900">{{ relatedDiscussionPreviewMessage(thread).createdByName }}</span>
                    <span>{{ relatedDiscussionLastActivity(thread) }}</span>
                    <span
                      class="rounded-full px-2 py-0.5 font-semibold"
                      :class="relatedDiscussionStatusClass(thread.threadStatus)"
                    >
                      {{ relatedDiscussionStatusLabel(thread.threadStatus) }}
                    </span>
                    <span v-if="thread.threadOwnerUserName" class="rounded-full border border-ink-200 px-2 py-0.5 font-semibold text-ink-700">
                      {{ thread.threadOwnerUserName }}
                    </span>
                  </div>

                  <button
                    class="mt-2 block w-full rounded-md text-left transition hover:bg-ink-50 focus:outline-none focus:ring-2 focus:ring-accent-200"
                    type="button"
                    title="Open original discussion"
                    @click="openRelatedDiscussion(relatedDiscussionPreviewMessage(thread))"
                  >
                    <MarkdownContent
                      class="px-1 text-sm leading-5 text-ink-800"
                      compact
                      :source="relatedDiscussionPreviewMessage(thread).bodyText"
                    />
                  </button>

                  <div class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-3">
                    <div class="flex flex-wrap items-center gap-3 text-xs text-ink-500">
                      <span>{{ thread.replyCount }} {{ thread.replyCount === 1 ? "reply" : "replies" }}</span>
                      <span v-if="relatedDiscussionAttachmentCount(thread)" class="inline-flex items-center gap-1">
                        <Paperclip class="h-3.5 w-3.5" />
                        {{ relatedDiscussionAttachmentCount(thread) }}
                      </span>
                      <span>{{ linkedDiscussionMessages(thread).length }} linked {{ linkedDiscussionMessages(thread).length === 1 ? "message" : "messages" }}</span>
                    </div>
                    <div class="flex flex-wrap items-center justify-end gap-2">
                      <RouterLink
                        v-if="thread.caseId"
                        class="inline-flex h-8 max-w-56 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-accent-800 hover:bg-accent-50"
                        :to="workItemPath(thread.caseId, 'tab=discussion')"
                        title="Open service discussion"
                      >
                        <BriefcaseBusiness class="h-3.5 w-3.5 shrink-0" />
                        <span class="truncate">{{ thread.caseNumber ?? labels.singular }}</span>
                      </RouterLink>
                      <button
                        class="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-accent-800 hover:bg-accent-50"
                        type="button"
                        @click="openRelatedDiscussion(relatedDiscussionPreviewMessage(thread))"
                      >
                        <ExternalLink class="h-3.5 w-3.5" />
                        Open discussion
                      </button>
                    </div>
                  </div>

                  <div v-if="linkedDiscussionMessages(thread).length" class="mt-2 flex flex-wrap gap-2">
                    <span
                      v-for="linkedMessage in linkedDiscussionMessages(thread)"
                      :key="linkedMessage.messageId"
                      class="inline-flex h-8 items-center gap-1.5 rounded-md border border-accent-100 bg-accent-50 px-2 text-xs font-semibold text-accent-900"
                    >
                      {{ relatedDiscussionAssetLink(linkedMessage)?.relationship ?? "related" }}
                      <button
                        class="grid h-6 w-6 place-items-center rounded text-ink-500 transition hover:bg-white hover:text-legal-red"
                        type="button"
                        title="Unlink message from asset"
                        :disabled="!auth.canAddNotes || relatedDiscussionBusy"
                        @click="unlinkRelatedDiscussion(linkedMessage)"
                      >
                        <Unlink class="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>
                </div>
              </div>
            </article>
          </div>

          <div v-else-if="!relatedDiscussionError" class="p-4 text-sm text-ink-500">
            No discussions are linked to this asset yet. Use <span class="font-semibold text-ink-700">Link asset</span> from a discussion message to add context here.
          </div>
          <p v-if="relatedDiscussionError" class="border-t border-ink-100 px-4 py-3 text-sm font-semibold text-legal-red">
            {{ relatedDiscussionError }}
          </p>
        </div>

      <CommunicationHistoryPanel
        :communications="communications"
        title="Communications"
        description="Calls, notes, PBX events, and vendor/customer updates linked to this asset."
        empty-text="No communications are linked to this asset yet."
        max-height-class="max-h-[420px]"
        :inbox-link="`/communications?view=all&assetId=${asset.assetId}`"
        :can-manage="auth.canAddNotes"
        log-label="Log communication"
        @log="openAssetCommunicationLog"
        @status-change="updateCommunicationStatus"
      />
      </div>
    </section>

    <div v-if="showEditAsset" class="fixed inset-0 z-50 overflow-y-auto bg-ink-900/45 px-4 py-6">
      <div class="mx-auto max-w-5xl rounded-lg bg-white shadow-soft">
        <div class="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
          <div>
            <h2 class="text-lg font-semibold">Edit asset</h2>
            <p class="mt-1 text-sm text-ink-500">Update operational asset details without changing contacts or organizations.</p>
          </div>
          <button class="btn-secondary h-9 px-3" type="button" :disabled="saving" @click="showEditAsset = false">
            <X class="h-4 w-4" />
          </button>
        </div>
        <form class="space-y-5 px-5 py-5" @submit.prevent="saveAsset">
          <div class="grid gap-3 md:grid-cols-2">
            <label class="text-sm font-semibold md:col-span-2">
              Asset name
              <input v-model="assetForm.name" class="input mt-1" required />
            </label>
            <label class="text-sm font-semibold">
              Asset type
              <select v-model="assetForm.assetType" class="input mt-1">
                <option v-for="type in ASSET_TYPES" :key="type" :value="type">{{ type }}</option>
              </select>
            </label>
            <label class="text-sm font-semibold">
              Status
              <select v-model="assetForm.status" class="input mt-1">
                <option v-for="status in ASSET_STATUSES" :key="status" :value="status">{{ status }}</option>
              </select>
            </label>
            <label class="text-sm font-semibold">
              Organization
              <select v-model="assetForm.partyOrganizationId" class="input mt-1">
                <option :value="null">Unlinked</option>
                <option v-for="organization in organizations" :key="organization.partyOrganizationId" :value="organization.partyOrganizationId">
                  {{ organization.name }}
                </option>
              </select>
            </label>
            <label class="text-sm font-semibold">
              Linked {{ labels.lowerSingular }}
              <select v-model="assetForm.caseId" class="input mt-1">
                <option :value="null">Unlinked</option>
                <option v-for="service in services" :key="service.caseId" :value="service.caseId">
                  {{ service.caseNumber }} · {{ service.propertyAddress }}
                </option>
              </select>
            </label>
            <label class="text-sm font-semibold md:col-span-2">
              Hosted on / Runs on
              <select v-model="assetForm.parentAssetId" class="input mt-1">
                <option :value="null">Unlinked</option>
                <option v-for="parentAsset in allAssets" :key="parentAsset.assetId" :value="parentAsset.assetId">
                  {{ parentAsset.name }}
                </option>
              </select>
            </label>
            <label class="text-sm font-semibold">
              Manufacturer
              <input v-model="assetForm.manufacturer" class="input mt-1" />
            </label>
            <label class="text-sm font-semibold">
              Model
              <input v-model="assetForm.model" class="input mt-1" />
            </label>
            <label class="text-sm font-semibold">
              Serial number
              <input v-model="assetForm.serialNumber" class="input mt-1" />
            </label>
            <label class="text-sm font-semibold">
              MAC address
              <input v-model="assetForm.macAddress" class="input mt-1" />
            </label>
            <label class="text-sm font-semibold">
              Hostname
              <input v-model="assetForm.hostname" class="input mt-1" />
            </label>
            <label class="text-sm font-semibold">
              LAN IP
              <input v-model="assetForm.lanIp" class="input mt-1" />
            </label>
            <label class="text-sm font-semibold">
              {{ isHttpUrl(assetForm.wanIp) ? "Web UI / Management URL" : template.endpointLabel }}
              <input v-model="assetForm.wanIp" class="input mt-1" placeholder="Public IP, domain, or https:// management URL" />
            </label>
            <label class="text-sm font-semibold">
              Phone number
              <input v-model="assetForm.phoneNumber" class="input mt-1" />
            </label>
            <label class="text-sm font-semibold">
              Extension
              <input v-model="assetForm.extension" class="input mt-1" />
            </label>
            <label class="text-sm font-semibold">
              IMEI
              <input v-model="assetForm.imei" class="input mt-1" />
            </label>
            <label class="text-sm font-semibold">
              ICCID
              <input v-model="assetForm.iccid" class="input mt-1" />
            </label>
            <label class="text-sm font-semibold">
              Installed location
              <input v-model="assetForm.installedLocation" class="input mt-1" />
            </label>
            <label class="text-sm font-semibold">
              Installed at
              <input v-model="assetForm.installedAt" class="input mt-1" type="date" />
            </label>
            <label class="text-sm font-semibold">
              Last service at
              <input v-model="assetForm.lastServiceAt" class="input mt-1" type="date" />
            </label>
          </div>
          <label class="block text-sm font-semibold">
            Notes
            <textarea v-model="assetForm.notes" class="textarea mt-1" />
          </label>
          <p v-if="error" class="text-sm font-semibold text-legal-red">{{ error }}</p>
          <div class="flex justify-end gap-2 border-t border-ink-200 pt-4">
            <button class="btn-secondary" type="button" :disabled="saving" @click="showEditAsset = false">Cancel</button>
            <button class="btn-primary" type="submit" :disabled="saving || !assetForm.name.trim()">
              <Save class="h-4 w-4" />
              {{ saving ? "Saving..." : "Save changes" }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="showCredentialForm" class="fixed inset-0 z-50 overflow-y-auto bg-ink-900/45 px-4 py-6">
      <div class="mx-auto max-w-3xl rounded-lg bg-white shadow-soft">
        <div class="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
          <div>
            <h2 class="text-lg font-semibold">{{ editingCredential ? "Edit credential" : "New credential" }}</h2>
            <p class="mt-1 text-sm text-ink-500">Secrets are encrypted before being stored. Leave secret fields blank while editing to keep existing values.</p>
          </div>
          <button class="btn-secondary h-9 px-3" type="button" :disabled="credentialSaving" @click="showCredentialForm = false">
            <X class="h-4 w-4" />
          </button>
        </div>
        <form class="space-y-5 px-5 py-5" @submit.prevent="saveCredential">
          <div class="grid gap-3 md:grid-cols-2">
            <label class="text-sm font-semibold md:col-span-2">
              Label
              <input v-model="credentialForm.label" class="input mt-1" required placeholder="Router admin, SIP trunk, customer portal..." />
            </label>
            <label class="text-sm font-semibold">
              Credential type
              <select v-model="credentialForm.credentialType" class="input mt-1">
                <option v-for="type in CREDENTIAL_TYPES" :key="type" :value="type">{{ type }}</option>
              </select>
            </label>
            <label class="text-sm font-semibold">
              Username
              <input v-model="credentialForm.username" class="input mt-1" />
            </label>
            <label class="text-sm font-semibold">
              Secret
              <input v-model="credentialForm.secret" class="input mt-1" :placeholder="editingCredential ? 'Leave blank to keep existing secret' : ''" />
            </label>
            <label class="text-sm font-semibold">
              Host
              <input v-model="credentialForm.host" class="input mt-1" placeholder="IP, domain, tenant, trunk host..." />
            </label>
            <label class="text-sm font-semibold md:col-span-2">
              Login URL
              <input v-model="credentialForm.loginUrl" class="input mt-1" />
            </label>
            <label class="text-sm font-semibold">
              Last verified at
              <input v-model="credentialForm.lastVerifiedAt" class="input mt-1" type="date" />
            </label>
            <label class="text-sm font-semibold">
              Rotation due at
              <input v-model="credentialForm.rotationDueAt" class="input mt-1" type="date" />
            </label>
          </div>
          <label class="block text-sm font-semibold">
            Public notes
            <textarea v-model="credentialForm.notes" class="textarea mt-1" placeholder="Non-secret context visible with credential metadata." />
          </label>
          <label class="block text-sm font-semibold">
            Private encrypted notes
            <textarea v-model="credentialForm.privateNotes" class="textarea mt-1" :placeholder="editingCredential ? 'Leave blank to keep existing private notes' : 'Recovery notes or security-sensitive context.'" />
          </label>
          <p v-if="credentialError" class="text-sm font-semibold text-legal-red">{{ credentialError }}</p>
          <div class="flex justify-end gap-2 border-t border-ink-200 pt-4">
            <button class="btn-secondary" type="button" :disabled="credentialSaving" @click="showCredentialForm = false">Cancel</button>
            <button class="btn-primary" type="submit" :disabled="credentialSaving || !credentialForm.label.trim()">
              <Save class="h-4 w-4" />
              {{ credentialSaving ? "Saving..." : editingCredential ? "Save credential" : "Add credential" }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
