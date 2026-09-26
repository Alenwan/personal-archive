<script setup lang="ts">
import {
  ArrowLeft,
  Building2,
  BriefcaseBusiness,
  CalendarDays,
  Grid2X2,
  HardDrive,
  KeyRound,
  List,
  Network,
  Plus,
  Save,
  Search,
  Trash2,
  X
} from "lucide-vue-next";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { client } from "../api/client";
import { useBusinessTemplate, workItemPath } from "../businessTemplate";
import DirectoryToolbar from "../components/directory/DirectoryToolbar.vue";
import PageHeader from "../components/PageHeader.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { useI18n } from "../i18n";
import { formatDate, formatDateTime } from "../shared/format";
import {
  hasAssetHardwareIdentifier,
  hasAssetNetworkIdentifier,
  hasAssetPhoneIdentifier
} from "../shared/assetFilters";
import {
  ASSET_STATUSES,
  ASSET_TYPES,
  type AssetFilters,
  type CaseRecord,
  type ManagedAsset,
  type ManagedAssetInput,
  type PartyOrganization,
  type SavedDirectoryView
} from "../shared/types";
import { useAuthStore } from "../stores/auth";
import { useToastStore } from "../stores/toasts";

type AssetsViewMode = "cards" | "compact";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const toasts = useToastStore();
const { t } = useI18n();
const { template, labels } = useBusinessTemplate();

const LINKED_CHOICE = "__linked__";
const UNLINKED_CHOICE = "__unlinked__";
const ASSETS_VIEW_MODE_STORAGE_KEY = "md3-platform.assets.view-mode";

const assets = ref<ManagedAsset[]>([]);
const assetOptions = ref<ManagedAsset[]>([]);
const organizations = ref<PartyOrganization[]>([]);
const services = ref<CaseRecord[]>([]);
const savedViews = ref<SavedDirectoryView[]>([]);
const selectedSavedViewId = ref("");
const savedViewName = ref("");
const showAdvancedFilters = ref(false);
const q = ref("");
const typeFilter = ref("");
const statusFilter = ref("");
const organizationChoice = ref("");
const serviceChoice = ref(typeof route.query.serviceId === "string" ? route.query.serviceId : "");
const parentChoice = ref("");
const credentialFilter = ref<AssetFilters["credentials"]>("");
const identifierFilter = ref<AssetFilters["identifiers"]>("");
const sortOption = ref("updated_desc");
const viewMode = ref<AssetsViewMode>(
  (window.localStorage.getItem(ASSETS_VIEW_MODE_STORAGE_KEY) as AssetsViewMode | null) === "compact" ? "compact" : "cards"
);
const loading = ref(true);
const page = ref(1);
const pageSize = ref(25);
const totalAssets = ref(0);
const totalPages = ref(1);
const selectedAssetIds = ref<string[]>([]);
const bulkStatus = ref("");
const bulkType = ref("");
const lookupLoading = ref(true);
const saving = ref(false);
const error = ref("");
const loadError = ref("");
const showCreate = ref(false);

const form = reactive<ManagedAssetInput>({
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

const serviceContextId = computed(() => (typeof route.query.serviceId === "string" ? route.query.serviceId.trim() : ""));
const serviceContext = computed(() => services.value.find((service) => service.caseId === serviceContextId.value) ?? null);

const sortParts = computed(() => {
  const [sort, direction] = sortOption.value.split("_");
  return {
    sort: (sort || "updated") as AssetFilters["sort"],
    direction: (direction || "desc") as AssetFilters["direction"]
  };
});

function choiceRelationship(choice: string): AssetFilters["organization"] {
  if (choice === LINKED_CHOICE) return "linked";
  if (choice === UNLINKED_CHOICE) return "unlinked";
  return "";
}

function choiceId(choice: string): string | undefined {
  return choice && choice !== LINKED_CHOICE && choice !== UNLINKED_CHOICE ? choice : undefined;
}

const assetFilters = computed<AssetFilters>(() => ({
  q: q.value,
  type: typeFilter.value,
  status: statusFilter.value,
  partyOrganizationId: choiceId(organizationChoice.value),
  caseId: choiceId(serviceChoice.value),
  parentAssetId: choiceId(parentChoice.value),
  organization: choiceRelationship(organizationChoice.value),
  service: choiceRelationship(serviceChoice.value),
  parent: choiceRelationship(parentChoice.value),
  credentials: credentialFilter.value,
  identifiers: identifierFilter.value,
  sort: sortParts.value.sort,
  direction: sortParts.value.direction
}));

const activeAssets = computed(() => assets.value.filter((asset) => asset.status === "Active").length);
const credentialCount = computed(() => assets.value.reduce((total, asset) => total + asset.credentialCount, 0));
const hostedAssetCount = computed(() => assets.value.filter((asset) => asset.parentAssetId).length);
const missingNetworkCount = computed(() => assets.value.filter((asset) => !hasAssetNetworkIdentifier(asset)).length);
const missingHardwareCount = computed(() => assets.value.filter((asset) => !hasAssetHardwareIdentifier(asset)).length);
const missingPhoneCount = computed(() => assets.value.filter((asset) => !hasAssetPhoneIdentifier(asset)).length);
const selectedAssetCount = computed(() => selectedAssetIds.value.length);
const currentPageAllSelected = computed(
  () => assets.value.length > 0 && assets.value.every((asset) => selectedAssetIds.value.includes(asset.assetId))
);
const activeFilterCount = computed(
  () =>
    [
      typeFilter.value,
      statusFilter.value,
      organizationChoice.value,
      serviceChoice.value,
      parentChoice.value,
      credentialFilter.value,
      identifierFilter.value
    ].filter(Boolean).length
);
const activeFilterChips = computed(() => {
  const organizationLabel =
    organizationChoice.value === LINKED_CHOICE
      ? "Has organization"
      : organizationChoice.value === UNLINKED_CHOICE
        ? "No organization"
        : organizations.value.find((organization) => organization.partyOrganizationId === organizationChoice.value)?.name;
  const service = services.value.find((item) => item.caseId === serviceChoice.value);
  const serviceLabelText =
    serviceChoice.value === LINKED_CHOICE
      ? `Linked to ${labels.value.lowerSingular}`
      : serviceChoice.value === UNLINKED_CHOICE
        ? `No linked ${labels.value.lowerSingular}`
        : service
          ? serviceLabel(service)
          : serviceChoice.value;
  const parentLabel =
    parentChoice.value === LINKED_CHOICE
      ? "Runs on another asset"
      : parentChoice.value === UNLINKED_CHOICE
        ? "No parent asset"
        : assetOptions.value.find((asset) => asset.assetId === parentChoice.value)?.name;
  const identifierLabel =
    identifierFilter.value === "missing-network"
      ? "Missing network info"
      : identifierFilter.value === "missing-hardware"
        ? "Missing hardware ID"
        : identifierFilter.value === "missing-phone"
          ? "Missing phone/ext"
          : "";
  return [
    typeFilter.value ? { key: "type", label: `Type: ${typeFilter.value}` } : null,
    statusFilter.value ? { key: "status", label: `Status: ${statusFilter.value}` } : null,
    organizationChoice.value ? { key: "organization", label: `Organization: ${organizationLabel ?? organizationChoice.value}` } : null,
    serviceChoice.value
      ? {
          key: "service",
          label: `${labels.value.singular}: ${serviceLabelText}`,
          locked: Boolean(serviceContextId.value && serviceChoice.value === serviceContextId.value)
        }
      : null,
    parentChoice.value ? { key: "parent", label: `Host: ${parentLabel ?? parentChoice.value}` } : null,
    credentialFilter.value ? { key: "credentials", label: credentialFilter.value === "has" ? "Has credentials" : "No credentials" } : null,
    identifierFilter.value ? { key: "identifiers", label: identifierLabel } : null
  ].filter(Boolean) as Array<{ key: string; label: string; locked?: boolean }>;
});

function resetForm() {
  Object.assign(form, {
    partyOrganizationId: null,
    caseId: serviceContextId.value || choiceId(serviceChoice.value) || null,
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
  error.value = "";
}

function openCreate() {
  resetForm();
  showCreate.value = true;
}

function openAsset(assetId: string) {
  void router.push(`/managed-assets/${assetId}`);
}

function assetIdentifiers(asset: ManagedAsset) {
  return [
    asset.hostname,
    asset.lanIp ? `LAN ${asset.lanIp}` : "",
    asset.wanIp ? `${template.value.endpointLabel} ${asset.wanIp}` : "",
    asset.phoneNumber,
    asset.extension ? `Ext ${asset.extension}` : "",
    asset.serialNumber ? `S/N ${asset.serialNumber}` : "",
    asset.macAddress ? `MAC ${asset.macAddress}` : ""
  ]
    .filter(Boolean)
    .join(" · ");
}

function hardwareLine(asset: ManagedAsset) {
  return [
    asset.manufacturer,
    asset.model,
    asset.serialNumber ? `S/N ${asset.serialNumber}` : "",
    asset.macAddress ? `MAC ${asset.macAddress}` : "",
    asset.imei ? `IMEI ${asset.imei}` : "",
    asset.iccid ? `ICCID ${asset.iccid}` : ""
  ]
    .filter(Boolean)
    .join(" · ");
}

function networkLine(asset: ManagedAsset) {
  return [
    asset.hostname,
    asset.lanIp ? `LAN ${asset.lanIp}` : "",
    asset.wanIp ? `${template.value.endpointLabel} ${asset.wanIp}` : "",
    asset.phoneNumber,
    asset.extension ? `Ext ${asset.extension}` : ""
  ]
    .filter(Boolean)
    .join(" · ");
}

function hierarchyLine(asset: ManagedAsset) {
  if (asset.parentAssetName) return `Runs on ${asset.parentAssetName}`;
  if (asset.childAssetCount) return `Hosts ${asset.childAssetCount} asset${asset.childAssetCount === 1 ? "" : "s"}`;
  return "";
}

function serviceLabel(service: CaseRecord) {
  return `${service.caseNumber} · ${service.propertyAddress}`;
}

function resetFilters() {
  q.value = "";
  typeFilter.value = "";
  statusFilter.value = "";
  organizationChoice.value = "";
  serviceChoice.value = serviceContextId.value;
  parentChoice.value = "";
  credentialFilter.value = "";
  identifierFilter.value = "";
  sortOption.value = "updated_desc";
  page.value = 1;
  selectedSavedViewId.value = "";
}

function clearFilter(key: string) {
  if (key === "type") typeFilter.value = "";
  if (key === "status") statusFilter.value = "";
  if (key === "organization") organizationChoice.value = "";
  if (key === "service") serviceChoice.value = serviceContextId.value;
  if (key === "parent") parentChoice.value = "";
  if (key === "credentials") credentialFilter.value = "";
  if (key === "identifiers") identifierFilter.value = "";
}

async function loadAssets() {
  loading.value = true;
  loadError.value = "";
  try {
    const [assetPage, savedViewRows] = await Promise.all([
      client.assetsPage(assetFilters.value, { page: page.value, pageSize: pageSize.value }),
      client.savedDirectoryViews("assets")
    ]);
    assets.value = assetPage.items;
    totalAssets.value = assetPage.total;
    totalPages.value = assetPage.totalPages;
    page.value = assetPage.page;
    savedViews.value = savedViewRows;
    selectedAssetIds.value = selectedAssetIds.value.filter((id) => assetPage.items.some((asset) => asset.assetId === id));
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : "Unable to load assets";
  } finally {
    loading.value = false;
  }
}

async function loadLookups() {
  lookupLoading.value = true;
  try {
    const [organizationPage, servicePage, assetPage, contextualService] = await Promise.all([
      client.partyOrganizationsPage({ sort: "name", direction: "asc" }, { pageSize: 100 }),
      client.casesPage({ archiveStatus: "active", sort: "number", direction: "desc" }, { pageSize: 100 }),
      client.assetsPage({ sort: "name", direction: "asc" }, { pageSize: 100 }),
      serviceContextId.value ? client.case(serviceContextId.value, { includeArchived: true }).catch(() => null) : Promise.resolve(null)
    ]);
    organizations.value = organizationPage.items;
    services.value = contextualService && !servicePage.items.some((service) => service.caseId === contextualService.caseId)
      ? [contextualService, ...servicePage.items]
      : servicePage.items;
    assetOptions.value = assetPage.items;
  } finally {
    lookupLoading.value = false;
  }
}

async function createAsset() {
  if (!form.name.trim() || saving.value) return;
  saving.value = true;
  error.value = "";
  try {
    const created = await client.createAsset({ ...form, name: form.name.trim() });
    showCreate.value = false;
    toasts.success("Asset created", `${created.name} is ready for credentials and ${labels.value.lowerSingular} links.`);
    await router.push(`/managed-assets/${created.assetId}`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to create asset";
    toasts.error("Unable to create asset", error.value);
  } finally {
    saving.value = false;
  }
}

let timer: number | undefined;
watch([q, typeFilter, statusFilter, organizationChoice, serviceChoice, parentChoice, credentialFilter, identifierFilter, sortOption], () => {
  page.value = 1;
  window.clearTimeout(timer);
  timer = window.setTimeout(loadAssets, 200);
});

watch([pageSize], () => {
  page.value = 1;
  void loadAssets();
});

watch(viewMode, (mode) => {
  window.localStorage.setItem(ASSETS_VIEW_MODE_STORAGE_KEY, mode);
});

function toggleAssetSelection(assetId: string) {
  selectedAssetIds.value = selectedAssetIds.value.includes(assetId)
    ? selectedAssetIds.value.filter((id) => id !== assetId)
    : [...selectedAssetIds.value, assetId];
}

function toggleCurrentPageSelection() {
  if (currentPageAllSelected.value) {
    const currentIds = new Set(assets.value.map((asset) => asset.assetId));
    selectedAssetIds.value = selectedAssetIds.value.filter((id) => !currentIds.has(id));
  } else {
    selectedAssetIds.value = Array.from(new Set([...selectedAssetIds.value, ...assets.value.map((asset) => asset.assetId)]));
  }
}

function savedViewPayload() {
  return {
    q: q.value,
    type: typeFilter.value,
    status: statusFilter.value,
    organizationChoice: organizationChoice.value,
    serviceChoice: serviceChoice.value,
    parentChoice: parentChoice.value,
    credentials: credentialFilter.value,
    identifiers: identifierFilter.value,
    sortOption: sortOption.value
  };
}

function applySavedView() {
  const view = savedViews.value.find((item) => item.savedViewId === selectedSavedViewId.value);
  if (!view) return;
  const filters = view.filters as Record<string, string | undefined>;
  q.value = filters.q ?? "";
  typeFilter.value = filters.type ?? "";
  statusFilter.value = filters.status ?? "";
  organizationChoice.value = filters.organizationChoice ?? "";
  serviceChoice.value = filters.serviceChoice ?? "";
  parentChoice.value = filters.parentChoice ?? "";
  credentialFilter.value = (filters.credentials ?? "") as AssetFilters["credentials"];
  identifierFilter.value = (filters.identifiers ?? "") as AssetFilters["identifiers"];
  sortOption.value = filters.sortOption ?? view.sort ?? "updated_desc";
  pageSize.value = view.pageSize;
  page.value = 1;
}

async function saveCurrentView() {
  const name = savedViewName.value.trim();
  if (!name) return;
  try {
    const view = await client.createSavedDirectoryView({
      scope: "assets",
      name,
      filters: savedViewPayload(),
      sort: sortOption.value,
      pageSize: pageSize.value
    });
    savedViews.value = [...savedViews.value, view].sort((a, b) => a.name.localeCompare(b.name));
    selectedSavedViewId.value = view.savedViewId;
    savedViewName.value = "";
    toasts.success("Asset view saved", view.name);
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
  toasts.success("Asset view deleted", view.name);
}

async function runAssetBulkAction(action: "set-status" | "set-type") {
  if (!selectedAssetIds.value.length) return;
  if (action === "set-status" && !bulkStatus.value) return;
  if (action === "set-type" && !bulkType.value) return;
  try {
    const result = await client.bulkAssets({
      action,
      assetIds: selectedAssetIds.value,
      status: action === "set-status" ? bulkStatus.value : undefined,
      assetType: action === "set-type" ? bulkType.value : undefined
    });
    toasts.success("Bulk asset update complete", `${result.succeeded} of ${result.requested} assets updated.`);
    selectedAssetIds.value = [];
    await loadAssets();
  } catch (error) {
    toasts.error("Bulk asset update failed", error instanceof Error ? error.message : "Please try again.");
  }
}

function consumeCreateRequest() {
  if (route.query.create !== "1") return;
  openCreate();
  const nextQuery = { ...route.query };
  delete nextQuery.create;
  void router.replace({ query: nextQuery });
}

onMounted(async () => {
  await Promise.all([loadLookups(), loadAssets()]);
  consumeCreateRequest();
});

watch(serviceContextId, (contextId, previousContextId) => {
  if (contextId) {
    serviceChoice.value = contextId;
    if (showCreate.value) form.caseId = contextId;
    return;
  }
  if (previousContextId && serviceChoice.value === previousContextId) {
    serviceChoice.value = "";
  }
});

watch(
  () => route.query.create,
  (create) => {
    if (create === "1") consumeCreateRequest();
  }
);
</script>

<template>
  <PageHeader
    eyebrow="MD3 operations"
    :title="t('assets')"
    description="Managed devices, lines, servers, accounts, numbers, SIMs, gateways, and other operational assets kept separate from contacts."
  >
    <button
      class="btn-primary"
      :disabled="!auth.canManageAssets"
      :title="auth.canManageAssets ? 'Create asset' : t('readonlyNotice')"
      @click="openCreate"
    >
      <Plus class="h-4 w-4" />
      New asset
    </button>
  </PageHeader>

  <div v-if="serviceContext" class="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 pb-3 text-sm">
    <div class="flex min-w-0 items-center gap-2 text-ink-600">
      <BriefcaseBusiness class="h-4 w-4 shrink-0 text-accent-800" />
      <span>Managing assets for</span>
      <strong class="truncate text-ink-900">{{ serviceLabel(serviceContext) }}</strong>
    </div>
    <button class="btn-secondary h-9 px-3" type="button" @click="router.push(workItemPath(serviceContext.caseId, 'tab=assets'))">
      <ArrowLeft class="h-4 w-4" />
      Back to service
    </button>
  </div>

  <DirectoryToolbar
    :active-filter-count="activeFilterCount"
    :show-advanced-filters="showAdvancedFilters"
    :selected-count="selectedAssetCount"
    @toggle-advanced="showAdvancedFilters = !showAdvancedFilters"
    @clear-filters="resetFilters"
  >
    <template #search>
      <label class="relative block">
        <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input v-model="q" class="input pl-9" :placeholder="`Search assets, serials, IPs, numbers, organizations, or ${labels.lowerPlural}`" />
      </label>
    </template>

    <template #controls>
      <div class="inline-flex shrink-0 rounded-md border border-ink-200 bg-white p-1">
        <button
          class="inline-flex items-center gap-2 rounded px-3 py-2 text-sm font-semibold transition"
          :class="viewMode === 'cards' ? 'bg-accent-700 text-white' : 'text-ink-700 hover:bg-ink-50'"
          type="button"
          @click="viewMode = 'cards'"
        >
          <Grid2X2 class="h-4 w-4" />
          Cards
        </button>
        <button
          class="inline-flex items-center gap-2 rounded px-3 py-2 text-sm font-semibold transition"
          :class="viewMode === 'compact' ? 'bg-accent-700 text-white' : 'text-ink-700 hover:bg-ink-50'"
          type="button"
          @click="viewMode = 'compact'"
        >
          <List class="h-4 w-4" />
          Compact list
        </button>
      </div>
      <select v-model="sortOption" class="input h-11 min-w-[11rem] flex-[1_1_12rem]">
        <option value="updated_desc">Recently updated</option>
        <option value="updated_asc">Oldest updated</option>
        <option value="name_asc">Name A-Z</option>
        <option value="name_desc">Name Z-A</option>
        <option value="type_asc">Type A-Z</option>
        <option value="type_desc">Type Z-A</option>
        <option value="organization_asc">Organization A-Z</option>
        <option value="organization_desc">Organization Z-A</option>
        <option value="service_asc">{{ labels.singular }} A-Z</option>
        <option value="service_desc">{{ labels.singular }} Z-A</option>
        <option value="installedAt_desc">Recently installed</option>
        <option value="installedAt_asc">Oldest installed</option>
        <option value="lastServiceAt_desc">Recent service date</option>
        <option value="lastServiceAt_asc">Oldest service date</option>
      </select>
      <select v-model="selectedSavedViewId" class="input h-11 min-w-[11rem] flex-[1_1_12rem]" @change="applySavedView">
        <option value="">Saved views</option>
        <option v-for="view in savedViews" :key="view.savedViewId" :value="view.savedViewId">{{ view.name }}</option>
      </select>
    </template>

    <template #chips>
      <template v-for="chip in activeFilterChips" :key="chip.key">
        <span
          v-if="chip.locked"
          class="inline-flex max-w-full items-center gap-1.5 rounded-full bg-accent-50 px-2.5 py-1 text-xs font-semibold text-accent-950 ring-1 ring-accent-100"
          title="Current service context"
        >
          <BriefcaseBusiness class="h-3.5 w-3.5 shrink-0" />
          <span class="truncate">{{ chip.label }}</span>
        </span>
        <button
          v-else
          class="inline-flex max-w-full items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-accent-950 ring-1 ring-accent-100 hover:bg-accent-50"
          type="button"
          :title="`Clear ${chip.label}`"
          @click="clearFilter(chip.key)"
        >
          <span class="truncate">{{ chip.label }}</span>
          <X class="h-3.5 w-3.5 shrink-0" />
        </button>
      </template>
    </template>

    <template #advanced>
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <select v-model="typeFilter" class="input">
        <option value="">Any asset type</option>
        <option v-for="type in ASSET_TYPES" :key="type" :value="type">{{ type }}</option>
      </select>
      <select v-model="statusFilter" class="input">
        <option value="">Any status</option>
        <option v-for="status in ASSET_STATUSES" :key="status" :value="status">{{ status }}</option>
      </select>
      <select v-model="organizationChoice" class="input" :disabled="lookupLoading">
        <option value="">Any organization</option>
        <option :value="LINKED_CHOICE">Has organization</option>
        <option :value="UNLINKED_CHOICE">No organization</option>
        <option v-for="organization in organizations" :key="organization.partyOrganizationId" :value="organization.partyOrganizationId">
          {{ organization.name }}
        </option>
      </select>
      <select v-model="serviceChoice" class="input" :disabled="lookupLoading">
        <option value="">Any linked {{ labels.lowerSingular }}</option>
        <option :value="LINKED_CHOICE">Linked to {{ labels.lowerSingular }}</option>
        <option :value="UNLINKED_CHOICE">No linked {{ labels.lowerSingular }}</option>
        <option v-for="service in services" :key="service.caseId" :value="service.caseId">
          {{ serviceLabel(service) }}
        </option>
      </select>
      <select v-model="parentChoice" class="input" :disabled="lookupLoading">
        <option value="">Any host relationship</option>
        <option :value="LINKED_CHOICE">Runs on another asset</option>
        <option :value="UNLINKED_CHOICE">No parent asset</option>
        <option v-for="asset in assetOptions" :key="asset.assetId" :value="asset.assetId">
          Runs on {{ asset.name }}
        </option>
      </select>
      <select v-model="credentialFilter" class="input">
        <option value="">Any credentials</option>
        <option value="has">Has credentials</option>
        <option value="none">No credentials</option>
      </select>
      <select v-model="identifierFilter" class="input">
        <option value="">Any identifiers</option>
        <option value="missing-network">Missing network info</option>
        <option value="missing-hardware">Missing hardware ID</option>
        <option value="missing-phone">Missing phone/ext</option>
      </select>
      </div>
      <div class="mt-3 grid gap-3 lg:grid-cols-[minmax(14rem,1fr)_auto_auto]">
      <input v-model="savedViewName" class="input" placeholder="Name current asset filters as a saved view" />
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
        <span class="rounded-md border border-ink-200 px-3 py-2"><strong class="text-ink-900">{{ totalAssets }}</strong> total</span>
        <span class="rounded-md border border-ink-200 px-3 py-2"><strong class="text-ink-900">{{ assets.length }}</strong> shown</span>
        <span class="rounded-md border border-ink-200 px-3 py-2"><strong class="text-ink-900">{{ activeAssets }}</strong> active</span>
        <span class="rounded-md border border-ink-200 px-3 py-2"><strong class="text-ink-900">{{ credentialCount }}</strong> credentials</span>
        <span class="rounded-md border border-ink-200 px-3 py-2"><strong class="text-ink-900">{{ hostedAssetCount }}</strong> hosted</span>
        <span class="rounded-md border border-ink-200 px-3 py-2"><strong class="text-ink-900">{{ missingNetworkCount }}</strong> missing network</span>
        <span class="rounded-md border border-ink-200 px-3 py-2"><strong class="text-ink-900">{{ missingHardwareCount }}</strong> missing ID</span>
    </template>

    <template #selection>
      <div v-if="auth.canManageAssets" class="flex flex-wrap items-center gap-3">
      <span class="font-semibold text-ink-700">{{ selectedAssetCount }} selected</span>
      <button class="btn-secondary h-9 px-3" type="button" :disabled="!assets.length" @click="toggleCurrentPageSelection">
        {{ currentPageAllSelected ? "Clear page" : "Select page" }}
      </button>
      <select v-model="bulkStatus" class="input h-9 max-w-xs py-1">
        <option value="">Choose status</option>
        <option v-for="status in ASSET_STATUSES" :key="status" :value="status">{{ status }}</option>
      </select>
      <button class="btn-secondary h-9 px-3" type="button" :disabled="!selectedAssetCount || !bulkStatus" @click="runAssetBulkAction('set-status')">
        Set status
      </button>
      <select v-model="bulkType" class="input h-9 max-w-xs py-1">
        <option value="">Choose type</option>
        <option v-for="type in ASSET_TYPES" :key="type" :value="type">{{ type }}</option>
      </select>
      <button class="btn-secondary h-9 px-3" type="button" :disabled="!selectedAssetCount || !bulkType" @click="runAssetBulkAction('set-type')">
        Set type
      </button>
      </div>
    </template>

    <template #errors>
    <p v-if="loadError" class="mt-2 text-sm font-semibold text-legal-red">{{ loadError }}</p>
    </template>
  </DirectoryToolbar>

  <p v-if="loading" class="panel p-5 text-sm text-ink-500">Loading assets...</p>

  <section v-else-if="viewMode === 'cards'" class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
    <article v-for="asset in assets" :key="asset.assetId">
      <div
        class="panel group h-full cursor-pointer p-5 transition hover:border-accent-300 hover:bg-ink-50 focus:outline-none focus:ring-2 focus:ring-accent-200"
        role="button"
        tabindex="0"
        @click="openAsset(asset.assetId)"
        @keydown.enter.prevent="openAsset(asset.assetId)"
        @keydown.space.prevent="openAsset(asset.assetId)"
      >
      <div class="mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div class="flex min-w-0 items-start gap-3">
          <div class="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-accent-50 text-accent-900">
            <HardDrive class="h-5 w-5" />
          </div>
          <div class="min-w-0">
            <h2 class="truncate text-lg font-semibold text-ink-900">{{ asset.name }}</h2>
            <p class="mt-0.5 text-sm text-ink-500">{{ asset.assetType }}</p>
          </div>
        </div>
        <div class="flex min-w-[5.5rem] shrink-0 flex-col items-end gap-2">
          <label v-if="auth.canManageAssets" class="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-xs font-semibold text-ink-800 shadow-sm ring-1 ring-ink-100" @click.stop>
            <input
              class="h-4 w-4 shrink-0"
              type="checkbox"
              :checked="selectedAssetIds.includes(asset.assetId)"
              @change.stop="toggleAssetSelection(asset.assetId)"
              @click.stop
            />
            <span>Select</span>
          </label>
          <StatusBadge :status="asset.status" />
        </div>
      </div>
      <div class="space-y-2 text-sm text-ink-700">
        <p v-if="asset.partyOrganizationName" class="flex items-center gap-2">
          <Building2 class="h-4 w-4 shrink-0 text-ink-400" />
          <span class="truncate">{{ asset.partyOrganizationName }}</span>
        </p>
        <p v-if="asset.caseNumber" class="flex items-center gap-2">
          <BriefcaseBusiness class="h-4 w-4 shrink-0 text-ink-400" />
          <span class="truncate">{{ asset.caseNumber }} · {{ asset.caseTitle }}</span>
        </p>
        <p v-if="hierarchyLine(asset)" class="flex items-center gap-2">
          <Network class="h-4 w-4 shrink-0 text-ink-400" />
          <span class="truncate">{{ hierarchyLine(asset) }}</span>
        </p>
        <p v-if="assetIdentifiers(asset)" class="line-clamp-2 text-ink-500">{{ assetIdentifiers(asset) }}</p>
        <p class="flex items-center gap-2 text-ink-500">
          <KeyRound class="h-4 w-4 shrink-0 text-ink-400" />
          <span>{{ asset.credentialCount }} credential{{ asset.credentialCount === 1 ? "" : "s" }}</span>
        </p>
      </div>
      </div>
    </article>
    <div v-if="!assets.length" class="panel p-5 text-sm text-ink-500">
      No assets match these filters. Add devices, accounts, lines, numbers, or systems here, then attach credentials only when needed.
    </div>
  </section>

  <section v-else class="panel overflow-hidden">
    <div class="overflow-x-auto">
      <table class="min-w-[78rem] table-fixed text-left text-xs">
        <colgroup>
          <col class="w-10" />
          <col class="w-[18rem]" />
          <col class="w-[18rem]" />
          <col class="w-[13rem]" />
          <col class="w-[16rem]" />
          <col class="w-[16rem]" />
          <col class="w-[7rem]" />
          <col class="w-[10rem]" />
        </colgroup>
        <thead class="bg-ink-50 text-[0.68rem] font-semibold uppercase text-ink-500">
          <tr>
            <th class="px-3 py-2">
              <input class="h-4 w-4" type="checkbox" :checked="currentPageAllSelected" @change="toggleCurrentPageSelection" />
            </th>
            <th class="px-3 py-2">Asset</th>
            <th class="px-3 py-2">Owner / {{ labels.singular }}</th>
            <th class="px-3 py-2">Hosted on</th>
            <th class="px-3 py-2">Network</th>
            <th class="px-3 py-2">Identifiers</th>
            <th class="px-3 py-2">Credentials</th>
            <th class="px-3 py-2">Updated</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-ink-100">
          <tr
            v-for="asset in assets"
            :key="asset.assetId"
            class="cursor-pointer align-top hover:bg-ink-50"
            @click="openAsset(asset.assetId)"
          >
            <td class="px-3 py-2.5" @click.stop>
              <input
                class="h-4 w-4"
                type="checkbox"
                :checked="selectedAssetIds.includes(asset.assetId)"
                @change="toggleAssetSelection(asset.assetId)"
              />
            </td>
            <td class="px-3 py-2.5">
              <div class="flex min-w-0 items-start gap-2.5">
                <div class="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent-50 text-accent-900">
                  <HardDrive class="h-3.5 w-3.5" />
                </div>
                <div class="min-w-0">
                  <div class="flex min-w-0 items-center gap-2">
                    <p class="truncate text-sm font-semibold text-accent-800" :title="asset.name">{{ asset.name }}</p>
                    <StatusBadge class="shrink-0" :status="asset.status" />
                  </div>
                  <p class="mt-0.5 truncate text-ink-500" :title="asset.assetType">{{ asset.assetType }}</p>
                </div>
              </div>
            </td>
            <td class="px-3 py-2.5">
              <p v-if="asset.partyOrganizationName" class="truncate font-semibold text-ink-900" :title="asset.partyOrganizationName">{{ asset.partyOrganizationName }}</p>
              <p v-else class="text-ink-400">No organization</p>
              <p v-if="asset.caseNumber" class="mt-0.5 truncate font-semibold text-accent-800" :title="`${asset.caseNumber} · ${asset.caseTitle}`">{{ asset.caseNumber }} · {{ asset.caseTitle }}</p>
              <p v-else class="mt-0.5 text-ink-400">No linked {{ labels.lowerSingular }}</p>
            </td>
            <td class="px-3 py-2.5">
              <p v-if="asset.parentAssetName" class="truncate font-semibold text-ink-900" :title="`Runs on ${asset.parentAssetName}`">Runs on {{ asset.parentAssetName }}</p>
              <p v-else class="text-ink-400">No parent asset</p>
              <p v-if="asset.childAssetCount" class="mt-0.5 text-ink-500">
                Hosts {{ asset.childAssetCount }} asset{{ asset.childAssetCount === 1 ? "" : "s" }}
              </p>
            </td>
            <td class="px-3 py-2.5">
              <p v-if="networkLine(asset)" class="line-clamp-2 leading-snug text-ink-700" :title="networkLine(asset)">{{ networkLine(asset) }}</p>
              <p v-else class="text-amber-700">Missing network info</p>
            </td>
            <td class="px-3 py-2.5">
              <p v-if="hardwareLine(asset)" class="line-clamp-2 leading-snug text-ink-700" :title="hardwareLine(asset)">{{ hardwareLine(asset) }}</p>
              <p v-else class="text-amber-700">Missing hardware ID</p>
            </td>
            <td class="px-3 py-2.5">
              <p class="inline-flex items-center gap-1.5 font-semibold text-ink-800">
                <KeyRound class="h-3.5 w-3.5 text-ink-400" />
                {{ asset.credentialCount }}<span class="font-normal text-ink-500">cred.</span>
              </p>
            </td>
            <td class="px-3 py-2.5">
              <p class="font-semibold text-ink-800">{{ formatDateTime(asset.updatedAt) }}</p>
              <p v-if="asset.lastServiceAt" class="mt-0.5 text-ink-500">Svc {{ formatDate(asset.lastServiceAt) }}</p>
              <p v-else-if="asset.installedAt" class="mt-0.5 flex items-center gap-1 text-ink-500">
                <CalendarDays class="h-3 w-3 text-ink-400" />
                Inst {{ formatDate(asset.installedAt) }}
              </p>
            </td>
          </tr>
          <tr v-if="!assets.length">
            <td class="px-3 py-5 text-ink-500" colspan="8">No assets match these filters.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <div v-if="!loading" class="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
    <p class="text-ink-500">Page {{ page }} of {{ totalPages }} · {{ totalAssets }} assets</p>
    <div class="flex items-center gap-2">
      <select v-model.number="pageSize" class="input h-9 w-28 py-1">
        <option :value="10">10 / page</option>
        <option :value="25">25 / page</option>
        <option :value="50">50 / page</option>
        <option :value="100">100 / page</option>
      </select>
      <button class="btn-secondary h-9 px-3" type="button" :disabled="page <= 1" @click="page--; loadAssets()">Previous</button>
      <button class="btn-secondary h-9 px-3" type="button" :disabled="page >= totalPages" @click="page++; loadAssets()">Next</button>
    </div>
  </div>

  <div v-if="showCreate" class="fixed inset-0 z-50 overflow-y-auto bg-ink-900/45 px-4 py-6">
    <div class="mx-auto max-w-5xl rounded-lg bg-white shadow-soft">
      <div class="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
        <div>
          <h2 class="text-lg font-semibold">New asset</h2>
          <p class="mt-1 text-sm text-ink-500">
            {{ serviceContext ? `This asset will be linked automatically to ${serviceLabel(serviceContext)}.` : `Create a managed asset and link it to a customer organization or ${labels.lowerSingular} when useful.` }}
          </p>
        </div>
        <button class="btn-secondary h-9 px-3" type="button" :disabled="saving" @click="showCreate = false">
          <X class="h-4 w-4" />
        </button>
      </div>

      <form class="space-y-5 px-5 py-5" @submit.prevent="createAsset">
        <div class="grid gap-3 md:grid-cols-2">
          <label class="text-sm font-semibold md:col-span-2">
            Asset name
            <input v-model="form.name" class="input mt-1" required placeholder="PBX server, SIP trunk, DVR, router, phone number..." />
          </label>
          <label class="text-sm font-semibold">
            Asset type
            <select v-model="form.assetType" class="input mt-1">
              <option v-for="type in ASSET_TYPES" :key="type" :value="type">{{ type }}</option>
            </select>
          </label>
          <label class="text-sm font-semibold">
            Status
            <select v-model="form.status" class="input mt-1">
              <option v-for="status in ASSET_STATUSES" :key="status" :value="status">{{ status }}</option>
            </select>
          </label>
          <label class="text-sm font-semibold">
            Organization
            <select v-model="form.partyOrganizationId" class="input mt-1">
              <option :value="null">Unlinked</option>
              <option v-for="organization in organizations" :key="organization.partyOrganizationId" :value="organization.partyOrganizationId">
                {{ organization.name }}
              </option>
            </select>
          </label>
          <label v-if="!serviceContextId" class="text-sm font-semibold">
            Linked {{ labels.lowerSingular }}
            <select v-model="form.caseId" class="input mt-1">
              <option :value="null">Unlinked</option>
              <option v-for="service in services" :key="service.caseId" :value="service.caseId">
                {{ serviceLabel(service) }}
              </option>
            </select>
          </label>
          <div v-else class="text-sm font-semibold">
            Linked {{ labels.lowerSingular }}
            <div class="mt-1 flex min-h-11 items-center gap-2 rounded-md border border-accent-200 bg-accent-50 px-3 text-accent-950">
              <BriefcaseBusiness class="h-4 w-4 shrink-0" />
              <span class="truncate">{{ serviceContext ? serviceLabel(serviceContext) : serviceContextId }}</span>
            </div>
            <p class="mt-1 text-xs font-normal text-ink-500">Linked automatically from the current {{ labels.lowerSingular }}.</p>
          </div>
          <label class="text-sm font-semibold md:col-span-2">
            Hosted on / Runs on
            <select v-model="form.parentAssetId" class="input mt-1">
              <option :value="null">Unlinked</option>
              <option v-for="asset in assetOptions" :key="asset.assetId" :value="asset.assetId">
                {{ asset.name }}
              </option>
            </select>
          </label>
          <label class="text-sm font-semibold">
            Manufacturer
            <input v-model="form.manufacturer" class="input mt-1" />
          </label>
          <label class="text-sm font-semibold">
            Model
            <input v-model="form.model" class="input mt-1" />
          </label>
          <label class="text-sm font-semibold">
            Serial number
            <input v-model="form.serialNumber" class="input mt-1" />
          </label>
          <label class="text-sm font-semibold">
            MAC address
            <input v-model="form.macAddress" class="input mt-1" />
          </label>
          <label class="text-sm font-semibold">
            Hostname
            <input v-model="form.hostname" class="input mt-1" />
          </label>
          <label class="text-sm font-semibold">
            LAN IP
            <input v-model="form.lanIp" class="input mt-1" />
          </label>
          <label class="text-sm font-semibold">
            {{ template.endpointLabel }}
            <input v-model="form.wanIp" class="input mt-1" />
          </label>
          <label class="text-sm font-semibold">
            Phone number
            <input v-model="form.phoneNumber" class="input mt-1" />
          </label>
          <label class="text-sm font-semibold">
            Extension
            <input v-model="form.extension" class="input mt-1" />
          </label>
          <label class="text-sm font-semibold">
            IMEI
            <input v-model="form.imei" class="input mt-1" />
          </label>
          <label class="text-sm font-semibold">
            ICCID
            <input v-model="form.iccid" class="input mt-1" />
          </label>
          <label class="text-sm font-semibold">
            Installed location
            <input v-model="form.installedLocation" class="input mt-1" />
          </label>
          <label class="text-sm font-semibold">
            Installed at
            <input v-model="form.installedAt" class="input mt-1" type="date" />
          </label>
          <label class="text-sm font-semibold">
            Last service at
            <input v-model="form.lastServiceAt" class="input mt-1" type="date" />
          </label>
        </div>

        <label class="block text-sm font-semibold">
          Notes
          <textarea v-model="form.notes" class="textarea mt-1" placeholder="Manual notes from old info files can be summarized here." />
        </label>

        <p v-if="error" class="text-sm font-semibold text-legal-red">{{ error }}</p>

        <div class="flex justify-end gap-2 border-t border-ink-200 pt-4">
          <button class="btn-secondary" type="button" :disabled="saving" @click="showCreate = false">Cancel</button>
          <button class="btn-primary" type="submit" :disabled="saving || !form.name.trim()">
            <Plus class="h-4 w-4" />
            {{ saving ? "Creating..." : "Create asset" }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
