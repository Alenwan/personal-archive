<script setup lang="ts">
import { Plus, RotateCcw, Save, Search, Trash2, X } from "lucide-vue-next";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { client } from "../api/client";
import { caseTypeDisplayName, filterCaseTypeTemplates, useBusinessTemplate, workItemPath } from "../businessTemplate";
import PageHeader from "../components/PageHeader.vue";
import DirectoryToolbar from "../components/directory/DirectoryToolbar.vue";
import StatusBadge from "../components/StatusBadge.vue";
import TagChip from "../components/TagChip.vue";
import { useI18n } from "../i18n";
import { formatCurrency, formatDate, formatDateTime, localDateInputValue } from "../shared/format";
import {
  CASE_STATUSES,
  PROPERTY_TYPES,
  type CaseFilters,
  type CaseInput,
  type CaseRecord,
  type CaseStatus,
  type CaseTypeTemplate,
  type ManagedAsset,
  type PartyOrganization,
  type PublicUser,
  type SavedDirectoryView,
  type Tag
} from "../shared/types";
import { useAuthStore } from "../stores/auth";
import { useToastStore } from "../stores/toasts";

const { t } = useI18n();
const { template, labels } = useBusinessTemplate();
const auth = useAuthStore();
const toasts = useToastStore();
const router = useRouter();
const cases = ref<CaseRecord[]>([]);
const caseTypes = ref<CaseTypeTemplate[]>([]);
const organizations = ref<PartyOrganization[]>([]);
const users = ref<PublicUser[]>([]);
const assets = ref<ManagedAsset[]>([]);
const tags = ref<Tag[]>([]);
const savedViews = ref<SavedDirectoryView[]>([]);
const selectedSavedViewId = ref("");
const savedViewName = ref("");
const showAdvancedFilters = ref(false);
const loading = ref(true);
const page = ref(1);
const pageSize = ref(25);
const totalCases = ref(0);
const totalPages = ref(1);
const selectedCaseIds = ref<string[]>([]);
const bulkStatus = ref<CaseStatus | "">("");
const bulkTagId = ref("");
const saving = ref(false);
const formError = ref("");
const showNewCase = ref(false);
const selectedTagIds = ref<string[]>([]);
const salePriceDollars = ref("");
const nextCaseNumberPreview = ref("");
const nextCaseNumberLoading = ref(false);

const today = localDateInputValue();
const form = reactive<CaseInput>({
  caseNumber: "",
  caseTypeCode: template.value.defaultWorkItemTypeCode,
  createChecklistTasks: false,
  customerOrganizationId: null,
  propertyAddress: "",
  city: template.value.defaultCity,
  state: template.value.defaultState,
  zipCode: template.value.defaultZipCode,
  propertyType: template.value.defaultPropertyType,
  salePriceCents: 0,
  status: "New",
  closingDate: today,
  notes: "",
  tagIds: []
});

const filters = reactive({
  q: "",
  status: "",
  tag: "",
  contactRole: "",
  caseTypeCode: "",
  customerOrganizationId: "",
  assignedTo: "",
  assetId: "",
  closingFrom: "",
  closingTo: "",
  archiveStatus: "active" as CaseFilters["archiveStatus"]
});
const sortOption = ref("updated_desc");

const activeTags = computed(() => tags.value.filter((tag) => selectedTagIds.value.includes(tag.tagId)));
const newCaseStatuses = computed(() => CASE_STATUSES.filter((status) => status !== "Closed"));
const availableCaseTypes = computed(() => filterCaseTypeTemplates(template.value, caseTypes.value));
const availableContactRoles = computed(() => template.value.contactRoleOptions);
const selectedCaseType = computed(() => availableCaseTypes.value.find((caseType) => caseType.code === form.caseTypeCode));
const selectedCaseCount = computed(() => selectedCaseIds.value.length);
const currentPageAllSelected = computed(
  () => cases.value.length > 0 && cases.value.every((caseRecord) => selectedCaseIds.value.includes(caseRecord.caseId))
);
const activeFilterCount = computed(
  () =>
    [
      filters.status,
      filters.archiveStatus !== "active" ? filters.archiveStatus : "",
      filters.caseTypeCode,
      filters.customerOrganizationId,
      filters.assignedTo,
      filters.assetId,
      filters.tag,
      filters.contactRole,
      filters.closingFrom,
      filters.closingTo
    ].filter(Boolean).length
);
const activeFilterChips = computed(() => {
  const caseTypeName = availableCaseTypes.value.find((caseType) => caseType.code === filters.caseTypeCode)?.name;
  const organizationName = organizations.value.find((organization) => organization.partyOrganizationId === filters.customerOrganizationId)?.name;
  const assigneeName = users.value.find((user) => user.userId === filters.assignedTo)?.name;
  const assetName = assets.value.find((asset) => asset.assetId === filters.assetId)?.name;
  const archiveLabel =
    filters.archiveStatus === "archived"
      ? labels.value.archivedArchiveLabel
      : filters.archiveStatus === "all"
        ? labels.value.allArchiveLabel
        : "";
  return [
    filters.status ? { key: "status", label: `Status: ${filters.status}` } : null,
    archiveLabel ? { key: "archiveStatus", label: archiveLabel } : null,
    filters.caseTypeCode ? { key: "caseTypeCode", label: `${labels.value.typeLabel}: ${caseTypeName ?? filters.caseTypeCode}` } : null,
    filters.customerOrganizationId
      ? { key: "customerOrganizationId", label: `Customer: ${organizationName ?? filters.customerOrganizationId}` }
      : null,
    filters.assignedTo ? { key: "assignedTo", label: `Assignee: ${assigneeName ?? filters.assignedTo}` } : null,
    filters.assetId ? { key: "assetId", label: `Asset: ${assetName ?? filters.assetId}` } : null,
    filters.tag ? { key: "tag", label: `Tag: ${filters.tag}` } : null,
    filters.contactRole ? { key: "contactRole", label: `Role: ${filters.contactRole}` } : null,
    filters.closingFrom ? { key: "closingFrom", label: `${labels.value.targetDateFromLabel}: ${filters.closingFrom}` } : null,
    filters.closingTo ? { key: "closingTo", label: `${labels.value.targetDateToLabel}: ${filters.closingTo}` } : null
  ].filter(Boolean) as Array<{ key: string; label: string }>;
});

const sortParts = computed(() => {
  const [sort, direction] = sortOption.value.split("_");
  return {
    sort: (sort || "updated") as CaseFilters["sort"],
    direction: (direction || "desc") as CaseFilters["direction"]
  };
});

const caseFilters = computed<CaseFilters>(() => ({
  q: filters.q,
  status: filters.status as CaseFilters["status"],
  tag: filters.tag,
  contactRole: filters.contactRole as CaseFilters["contactRole"],
  caseTypeCode: filters.caseTypeCode,
  customerOrganizationId: filters.customerOrganizationId,
  assignedTo: filters.assignedTo,
  assetId: filters.assetId,
  closingFrom: filters.closingFrom,
  closingTo: filters.closingTo,
  archiveStatus: filters.archiveStatus,
  sort: sortParts.value.sort,
  direction: sortParts.value.direction
}));

function toggleTag(tagId: string, checked: boolean) {
  selectedTagIds.value = checked
    ? [...new Set([...selectedTagIds.value, tagId])]
    : selectedTagIds.value.filter((id) => id !== tagId);
}

function resetForm() {
  Object.assign(form, {
    caseNumber: "",
    caseTypeCode: availableCaseTypes.value[0]?.code ?? template.value.defaultWorkItemTypeCode,
    createChecklistTasks: false,
    customerOrganizationId: null,
    propertyAddress: "",
    city: template.value.defaultCity,
    state: template.value.defaultState,
    zipCode: template.value.defaultZipCode,
    propertyType: template.value.defaultPropertyType,
    salePriceCents: 0,
    status: "New",
    closingDate: today,
    notes: "",
    tagIds: []
  });
  salePriceDollars.value = "";
  selectedTagIds.value = [];
  formError.value = "";
}

async function loadNextCaseNumberPreview() {
  nextCaseNumberLoading.value = true;
  try {
    const response = await client.nextCaseNumber();
    nextCaseNumberPreview.value = response.caseNumber;
  } catch {
    nextCaseNumberPreview.value = "";
  } finally {
    nextCaseNumberLoading.value = false;
  }
}

function openNewCase() {
  resetForm();
  showNewCase.value = true;
  void loadNextCaseNumberPreview();
}

async function loadCases() {
  loading.value = true;
  try {
    const casePage = await client.casesPage(caseFilters.value, { page: page.value, pageSize: pageSize.value });
    cases.value = casePage.items;
    totalCases.value = casePage.total;
    totalPages.value = casePage.totalPages;
    page.value = casePage.page;
    selectedCaseIds.value = selectedCaseIds.value.filter((id) => casePage.items.some((caseRecord) => caseRecord.caseId === id));
  } finally {
    loading.value = false;
  }
}

async function restoreCase(caseRecord: CaseRecord) {
  if (!caseRecord.deletedAt) return;
  loading.value = true;
  try {
    const restored = await client.restoreCase(caseRecord.caseId, { reason: "Restored from archived case list." });
    toasts.success(labels.value.restoreSuccessTitle, labels.value.restoreSuccessMessage(restored.caseNumber));
    await loadCases();
  } catch (error) {
    toasts.error("Restore failed", error instanceof Error ? error.message : labels.value.restoredError);
  } finally {
    loading.value = false;
  }
}

async function saveCase() {
  saving.value = true;
  formError.value = "";
  try {
    const created = await client.createCase({
      ...form,
      caseNumber: form.caseNumber?.trim() || undefined,
      salePriceCents: Math.round(Number(salePriceDollars.value || "0") * 100),
      tagIds: selectedTagIds.value
    });
    showNewCase.value = false;
    await router.push(workItemPath(created.caseId));
  } catch (error) {
    formError.value = error instanceof Error ? error.message : labels.value.createdError;
  } finally {
    saving.value = false;
  }
}

let timer: number | undefined;
watch(
  filters,
  () => {
    page.value = 1;
    window.clearTimeout(timer);
    timer = window.setTimeout(loadCases, 200);
  },
  { deep: true }
);

watch([sortOption], () => {
  page.value = 1;
  window.clearTimeout(timer);
  timer = window.setTimeout(loadCases, 200);
});

watch([pageSize], () => {
  page.value = 1;
  void loadCases();
});

onMounted(async () => {
  const [casePage, tagRows, caseTypeRows, organizationPage, userRows, assetPage, savedViewRows] = await Promise.all([
    client.casesPage(caseFilters.value, { page: page.value, pageSize: pageSize.value }),
    client.tags(),
    client.caseTypes(),
    client.partyOrganizationsPage({ sort: "name", direction: "asc" }, { pageSize: 100 }),
    client.users(),
    client.assetsPage({ sort: "name", direction: "asc" }, { pageSize: 100 }),
    client.savedDirectoryViews("services")
  ]);
  cases.value = casePage.items;
  totalCases.value = casePage.total;
  totalPages.value = casePage.totalPages;
  page.value = casePage.page;
  tags.value = tagRows;
  caseTypes.value = caseTypeRows;
  organizations.value = organizationPage.items;
  users.value = userRows;
  assets.value = assetPage.items;
  savedViews.value = savedViewRows;
  if (!availableCaseTypes.value.some((caseType) => caseType.code === form.caseTypeCode)) {
    form.caseTypeCode = availableCaseTypes.value[0]?.code ?? template.value.defaultWorkItemTypeCode;
  }
  loading.value = false;
});

function caseDetailPath(caseRecord: CaseRecord) {
  return {
    path: workItemPath(caseRecord.caseId),
    query: caseRecord.deletedAt ? { includeArchived: "true" } : {}
  };
}

function displayCaseType(caseRecord: CaseRecord) {
  return caseTypeDisplayName(caseRecord.caseTypeCode, caseTypes.value, caseRecord.caseTypeName || caseRecord.propertyType);
}

function locationLine(caseRecord: CaseRecord) {
  return [caseRecord.city, [caseRecord.state, caseRecord.zipCode].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
}

function resetFilters() {
  Object.assign(filters, {
    q: "",
    status: "",
    tag: "",
    contactRole: "",
    caseTypeCode: "",
    customerOrganizationId: "",
    assignedTo: "",
    assetId: "",
    closingFrom: "",
    closingTo: "",
    archiveStatus: "active"
  });
  sortOption.value = "updated_desc";
  page.value = 1;
  selectedSavedViewId.value = "";
}

function clearFilter(key: string) {
  if (key === "status") filters.status = "";
  if (key === "archiveStatus") filters.archiveStatus = "active";
  if (key === "caseTypeCode") filters.caseTypeCode = "";
  if (key === "customerOrganizationId") filters.customerOrganizationId = "";
  if (key === "assignedTo") filters.assignedTo = "";
  if (key === "assetId") filters.assetId = "";
  if (key === "tag") filters.tag = "";
  if (key === "contactRole") filters.contactRole = "";
  if (key === "closingFrom") filters.closingFrom = "";
  if (key === "closingTo") filters.closingTo = "";
}

function toggleCaseSelection(caseId: string) {
  selectedCaseIds.value = selectedCaseIds.value.includes(caseId)
    ? selectedCaseIds.value.filter((id) => id !== caseId)
    : [...selectedCaseIds.value, caseId];
}

function toggleCurrentPageSelection() {
  if (currentPageAllSelected.value) {
    const currentIds = new Set(cases.value.map((caseRecord) => caseRecord.caseId));
    selectedCaseIds.value = selectedCaseIds.value.filter((id) => !currentIds.has(id));
  } else {
    selectedCaseIds.value = Array.from(new Set([...selectedCaseIds.value, ...cases.value.map((caseRecord) => caseRecord.caseId)]));
  }
}

function savedViewPayload() {
  return {
    q: filters.q,
    status: filters.status,
    tag: filters.tag,
    contactRole: filters.contactRole,
    caseTypeCode: filters.caseTypeCode,
    customerOrganizationId: filters.customerOrganizationId,
    assignedTo: filters.assignedTo,
    assetId: filters.assetId,
    closingFrom: filters.closingFrom,
    closingTo: filters.closingTo,
    archiveStatus: filters.archiveStatus,
    sortOption: sortOption.value
  };
}

function applySavedView() {
  const view = savedViews.value.find((item) => item.savedViewId === selectedSavedViewId.value);
  if (!view) return;
  const savedFilters = view.filters as Record<string, string | undefined>;
  Object.assign(filters, {
    q: savedFilters.q ?? "",
    status: savedFilters.status ?? "",
    tag: savedFilters.tag ?? "",
    contactRole: savedFilters.contactRole ?? "",
    caseTypeCode: savedFilters.caseTypeCode ?? "",
    customerOrganizationId: savedFilters.customerOrganizationId ?? "",
    assignedTo: savedFilters.assignedTo ?? "",
    assetId: savedFilters.assetId ?? "",
    closingFrom: savedFilters.closingFrom ?? "",
    closingTo: savedFilters.closingTo ?? "",
    archiveStatus: (savedFilters.archiveStatus ?? "active") as CaseFilters["archiveStatus"]
  });
  sortOption.value = savedFilters.sortOption ?? view.sort ?? "updated_desc";
  pageSize.value = view.pageSize;
  page.value = 1;
}

async function saveCurrentView() {
  const name = savedViewName.value.trim();
  if (!name) return;
  try {
    const view = await client.createSavedDirectoryView({
      scope: "services",
      name,
      filters: savedViewPayload(),
      sort: sortOption.value,
      pageSize: pageSize.value
    });
    savedViews.value = [...savedViews.value, view].sort((a, b) => a.name.localeCompare(b.name));
    selectedSavedViewId.value = view.savedViewId;
    savedViewName.value = "";
    toasts.success(`${labels.value.singular} view saved`, view.name);
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
  toasts.success(`${labels.value.singular} view deleted`, view.name);
}

async function runCaseBulkAction(action: "set-status" | "add-tag" | "remove-tag") {
  if (!selectedCaseIds.value.length) return;
  if (action === "set-status" && !bulkStatus.value) return;
  if ((action === "add-tag" || action === "remove-tag") && !bulkTagId.value) return;
  try {
    const result = await client.bulkCases({
      action,
      caseIds: selectedCaseIds.value,
      status: action === "set-status" ? bulkStatus.value || undefined : undefined,
      tagId: action === "add-tag" || action === "remove-tag" ? bulkTagId.value : undefined
    });
    toasts.success(`Bulk ${labels.value.lowerSingular} update complete`, `${result.succeeded} of ${result.requested} updated.`);
    selectedCaseIds.value = [];
    await loadCases();
  } catch (error) {
    toasts.error("Bulk update failed", error instanceof Error ? error.message : "Please try again.");
  }
}
</script>

<template>
  <PageHeader
    :eyebrow="labels.managementEyebrow"
    :title="labels.plural"
    :description="labels.listDescription"
  >
    <button class="btn-primary" :disabled="!auth.canEditCases" :title="auth.canEditCases ? labels.newButton : t('readonlyNotice')" @click="openNewCase">
      <Plus class="h-4 w-4" />
      {{ labels.newButton }}
    </button>
  </PageHeader>

  <DirectoryToolbar
    :active-filter-count="activeFilterCount"
    :show-advanced-filters="showAdvancedFilters"
    :selected-count="selectedCaseCount"
    @toggle-advanced="showAdvancedFilters = !showAdvancedFilters"
    @clear-filters="resetFilters"
  >
    <template #search>
      <label class="relative block">
        <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input v-model="filters.q" class="input pl-9" :placeholder="labels.listSearchPlaceholder" />
      </label>
    </template>

    <template #controls>
      <select v-model="filters.status" class="input h-11 min-w-[9rem] flex-[1_1_10rem]">
        <option value="">Any status</option>
        <option v-for="status in CASE_STATUSES" :key="status" :value="status">{{ status }}</option>
      </select>
      <select v-model="filters.caseTypeCode" class="input h-11 min-w-[11rem] flex-[1_1_12rem]">
        <option value="">Any {{ labels.typeLabel.toLowerCase() }}</option>
        <option v-for="caseType in availableCaseTypes" :key="caseType.code" :value="caseType.code">{{ caseType.name }}</option>
      </select>
      <select v-model="filters.customerOrganizationId" class="input h-11 min-w-[14rem] flex-[2_1_16rem]">
        <option value="">Any customer / organization</option>
        <option v-for="organization in organizations" :key="organization.partyOrganizationId" :value="organization.partyOrganizationId">
          {{ organization.name }}
        </option>
      </select>
      <select v-model="sortOption" class="input h-11 min-w-[11rem] flex-[1_1_12rem]">
        <option value="updated_desc">Recently updated</option>
        <option value="updated_asc">Oldest updated</option>
        <option value="number_desc">{{ labels.singular }} number high-low</option>
        <option value="number_asc">{{ labels.singular }} number low-high</option>
        <option value="title_asc">Title A-Z</option>
        <option value="title_desc">Title Z-A</option>
        <option value="status_asc">Status A-Z</option>
        <option value="targetDate_asc">{{ labels.targetDateLabel }} soonest</option>
        <option value="targetDate_desc">{{ labels.targetDateLabel }} latest</option>
        <option value="customer_asc">Customer A-Z</option>
        <option value="type_asc">{{ labels.typeLabel }} A-Z</option>
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
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <select v-model="filters.archiveStatus" class="input" :disabled="!auth.canArchiveCases" :title="auth.canArchiveCases ? `Filter active or archived ${labels.lowerPlural}` : `Archived ${labels.lowerPlural} are restricted to Admin and Manager users`">
          <option value="active">{{ labels.activeArchiveLabel }}</option>
          <option value="archived">{{ labels.archivedArchiveLabel }}</option>
          <option value="all">{{ labels.allArchiveLabel }}</option>
        </select>
        <select v-model="filters.assignedTo" class="input">
          <option value="">Any assignee</option>
          <option v-for="user in users" :key="user.userId" :value="user.userId">{{ user.name }}</option>
        </select>
        <select v-model="filters.assetId" class="input">
          <option value="">Any linked asset</option>
          <option v-for="asset in assets" :key="asset.assetId" :value="asset.assetId">{{ asset.name }}</option>
        </select>
        <select v-model="filters.tag" class="input">
          <option value="">All tags</option>
          <option v-for="tag in tags" :key="tag.tagId" :value="tag.name">{{ tag.name }}</option>
        </select>
        <select v-model="filters.contactRole" class="input">
          <option value="">All contact roles</option>
          <option v-for="role in availableContactRoles" :key="role" :value="role">{{ role }}</option>
        </select>
        <label class="min-w-0">
          <span class="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-500">{{ labels.targetDateFromLabel }}</span>
          <input v-model="filters.closingFrom" class="input w-full" type="date" :aria-label="`${labels.targetDateLabel} from`" />
        </label>
        <label class="min-w-0">
          <span class="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-500">{{ labels.targetDateToLabel }}</span>
          <input v-model="filters.closingTo" class="input w-full" type="date" :aria-label="`${labels.targetDateLabel} to`" />
        </label>
      </div>
      <div class="mt-3 grid gap-3 lg:grid-cols-[minmax(14rem,1fr)_auto_auto]">
        <input v-model="savedViewName" class="input" :placeholder="`Name current ${labels.lowerSingular} filters as a saved view`" />
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
      <span class="rounded-md border border-ink-200 px-3 py-2"><strong class="text-ink-900">{{ totalCases }}</strong> total</span>
      <span class="rounded-md border border-ink-200 px-3 py-2"><strong class="text-ink-900">{{ cases.length }}</strong> shown</span>
      <span class="rounded-md border border-ink-200 px-3 py-2">{{ pageSize }} per page</span>
    </template>

    <template #selection>
      <div v-if="auth.canEditCases" class="flex flex-wrap items-center gap-3">
        <span class="font-semibold text-ink-700">{{ selectedCaseCount }} selected</span>
        <button class="btn-secondary h-9 px-3" type="button" :disabled="!cases.length" @click="toggleCurrentPageSelection">
          {{ currentPageAllSelected ? "Clear page" : "Select page" }}
        </button>
        <select v-model="bulkStatus" class="input h-9 max-w-xs py-1">
          <option value="">Choose status</option>
          <option v-for="status in CASE_STATUSES" :key="status" :value="status">{{ status }}</option>
        </select>
        <button class="btn-secondary h-9 px-3" type="button" :disabled="!selectedCaseCount || !bulkStatus" @click="runCaseBulkAction('set-status')">
          Set status
        </button>
        <select v-model="bulkTagId" class="input h-9 max-w-xs py-1">
          <option value="">Choose tag</option>
          <option v-for="tag in tags" :key="tag.tagId" :value="tag.tagId">{{ tag.name }}</option>
        </select>
        <button class="btn-secondary h-9 px-3" type="button" :disabled="!selectedCaseCount || !bulkTagId" @click="runCaseBulkAction('add-tag')">
          Add tag
        </button>
        <button class="btn-secondary h-9 px-3" type="button" :disabled="!selectedCaseCount || !bulkTagId" @click="runCaseBulkAction('remove-tag')">
          Remove tag
        </button>
      </div>
    </template>
  </DirectoryToolbar>

  <section class="panel overflow-hidden">
    <div class="overflow-x-auto">
      <table class="min-w-[1100px] w-full text-left text-sm">
        <thead class="bg-ink-50 text-xs uppercase text-ink-500">
          <tr>
            <th class="px-5 py-3">
              <input type="checkbox" :checked="currentPageAllSelected" @change="toggleCurrentPageSelection" />
            </th>
            <th class="px-5 py-3">{{ labels.singular }}</th>
            <th class="px-5 py-3">{{ labels.locationSummaryLabel }}</th>
            <th class="px-5 py-3">{{ t("status") }}</th>
            <th class="px-5 py-3">{{ labels.valueLabel }}</th>
            <th class="px-5 py-3">{{ labels.targetDateLabel }}</th>
            <th class="px-5 py-3">Tags</th>
            <th class="px-5 py-3">Lifecycle</th>
            <th class="px-5 py-3"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-ink-100">
          <tr v-if="loading">
            <td class="px-5 py-6 text-ink-500" colspan="9">{{ labels.loading }}</td>
          </tr>
          <tr v-else-if="!cases.length">
            <td class="px-5 py-6 text-ink-500" colspan="9">{{ labels.noMatches }}</td>
          </tr>
          <tr
            v-for="caseRecord in cases"
            :key="caseRecord.caseId"
            class="align-top hover:bg-ink-50"
            :class="caseRecord.deletedAt ? 'bg-ink-50/70 text-ink-600' : ''"
          >
            <td class="px-5 py-4">
              <input
                type="checkbox"
                :checked="selectedCaseIds.includes(caseRecord.caseId)"
                @change="toggleCaseSelection(caseRecord.caseId)"
              />
            </td>
            <td class="px-5 py-4">
              <RouterLink
                class="font-semibold text-accent-700 hover:text-accent-900"
                :to="caseDetailPath(caseRecord)"
              >
                {{ caseRecord.caseNumber }}
              </RouterLink>
              <p class="mt-1 text-xs text-ink-500">{{ displayCaseType(caseRecord) }}</p>
            </td>
            <td class="px-5 py-4">
              <p class="font-medium text-ink-900">{{ caseRecord.propertyAddress }}</p>
              <p v-if="caseRecord.customerOrganizationName" class="text-xs text-ink-500">{{ caseRecord.customerOrganizationName }}</p>
              <p v-if="locationLine(caseRecord)" class="text-xs text-ink-500">{{ locationLine(caseRecord) }}</p>
            </td>
            <td class="px-5 py-4"><StatusBadge :status="caseRecord.status" /></td>
            <td class="px-5 py-4 font-medium">{{ formatCurrency(caseRecord.salePriceCents) }}</td>
            <td class="px-5 py-4">{{ formatDate(caseRecord.closingDate) }}</td>
            <td class="px-5 py-4">
              <div class="flex flex-wrap gap-1.5">
                <TagChip v-for="tag in caseRecord.tags" :key="tag.tagId" :tag="tag" />
              </div>
            </td>
            <td class="px-5 py-4">
              <div v-if="caseRecord.deletedAt">
                <span class="rounded-full bg-ink-200 px-2 py-1 text-xs font-semibold uppercase text-ink-700">Archived</span>
                <p class="mt-2 text-xs text-ink-500">{{ formatDateTime(caseRecord.deletedAt) }}</p>
              </div>
              <span v-else class="text-xs font-semibold uppercase text-emerald-700">Active</span>
            </td>
            <td class="px-5 py-4 text-right">
              <button
                v-if="caseRecord.deletedAt"
                class="btn-secondary h-9 px-3"
                type="button"
                :disabled="!auth.canArchiveCases || loading"
                @click="restoreCase(caseRecord)"
              >
                <RotateCcw class="h-4 w-4" />
                Restore
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <div v-if="!loading" class="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
    <p class="text-ink-500">Page {{ page }} of {{ totalPages }} · {{ totalCases }} {{ labels.lowerPlural }}</p>
    <div class="flex items-center gap-2">
      <select v-model.number="pageSize" class="input h-9 w-28 py-1">
        <option :value="10">10 / page</option>
        <option :value="25">25 / page</option>
        <option :value="50">50 / page</option>
        <option :value="100">100 / page</option>
      </select>
      <button class="btn-secondary h-9 px-3" type="button" :disabled="page <= 1" @click="page--; loadCases()">Previous</button>
      <button class="btn-secondary h-9 px-3" type="button" :disabled="page >= totalPages" @click="page++; loadCases()">Next</button>
    </div>
  </div>

  <div v-if="showNewCase" class="fixed inset-0 z-50 overflow-y-auto bg-ink-900/45 px-4 py-6">
    <div class="mx-auto max-w-4xl rounded-lg bg-white shadow-soft">
      <div class="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
        <div>
          <h2 class="text-lg font-semibold">{{ labels.newTitle }}</h2>
          <p class="mt-1 text-sm text-ink-500">{{ labels.newDescription }}</p>
        </div>
        <button class="btn-secondary h-9 px-3" @click="showNewCase = false">
          <X class="h-4 w-4" />
        </button>
      </div>

      <form class="space-y-5 px-5 py-5" @submit.prevent="saveCase">
        <div class="grid gap-3 md:grid-cols-3">
          <label class="text-sm font-semibold">
            {{ labels.numberLabel }}
            <input
              class="input mt-1 bg-ink-50 text-ink-700"
              :value="nextCaseNumberLoading ? 'Loading next number...' : nextCaseNumberPreview || 'Auto-assigned on save'"
              readonly
            />
            <span class="mt-1 block text-xs font-medium text-ink-500">Preview only. The database assigns the final number when saved.</span>
          </label>
          <label class="text-sm font-semibold md:col-span-2">
            {{ labels.titleLabel }}
            <input v-model="form.propertyAddress" class="input mt-1" required />
          </label>
          <label class="text-sm font-semibold md:col-span-3">
            {{ labels.typeLabel }}
            <select v-model="form.caseTypeCode" class="input mt-1">
              <option v-for="caseType in availableCaseTypes" :key="caseType.code" :value="caseType.code">{{ caseType.name }}</option>
            </select>
            <span class="mt-1 block text-xs font-normal text-ink-500">
              {{ selectedCaseType?.description || "Select the workflow template for required documents and checklist tasks." }}
            </span>
          </label>
          <label
            v-if="selectedCaseType?.checklist.length"
            class="flex items-start gap-3 rounded-md border border-ink-200 bg-ink-50 px-3 py-3 text-sm md:col-span-3"
          >
            <input
              v-model="form.createChecklistTasks"
              class="mt-0.5 h-4 w-4 rounded border-ink-300 text-accent-700 focus:ring-accent-500"
              type="checkbox"
            />
            <span>
              <span class="block font-semibold text-ink-900">Add suggested tasks</span>
              <span class="mt-0.5 block text-xs font-normal text-ink-500">
                Create {{ selectedCaseType.checklist.length }} starter tasks from this service type. Leave this off when the Service does not need a checklist.
              </span>
            </span>
          </label>
          <label v-if="template.showCustomerOrganization" class="text-sm font-semibold md:col-span-3">
            Customer / Organization
            <select v-model="form.customerOrganizationId" class="input mt-1">
              <option :value="null">Unlinked / internal</option>
              <option v-for="organization in organizations" :key="organization.partyOrganizationId" :value="organization.partyOrganizationId">
                {{ organization.name }}
              </option>
            </select>
            <span class="mt-1 block text-xs font-normal text-ink-500">Leave unlinked for internal MD3 infrastructure services.</span>
          </label>
          <label class="text-sm font-semibold">
            City
            <input v-model="form.city" class="input mt-1" :required="template.requireCityStateZip" />
          </label>
          <label class="text-sm font-semibold">
            State
            <input v-model="form.state" class="input mt-1" maxlength="2" :required="template.requireCityStateZip" />
          </label>
          <label class="text-sm font-semibold">
            ZIP code
            <input v-model="form.zipCode" class="input mt-1" :required="template.requireCityStateZip" />
          </label>
          <label v-if="template.showPropertyType" class="text-sm font-semibold">
            Property type
            <select v-model="form.propertyType" class="input mt-1">
              <option v-for="type in PROPERTY_TYPES" :key="type" :value="type">{{ type }}</option>
            </select>
          </label>
          <label v-if="template.showValueField" class="text-sm font-semibold">
            {{ labels.valueLabel }}
            <input v-model="salePriceDollars" class="input mt-1" inputmode="decimal" :placeholder="template.defaultValuePlaceholder" />
          </label>
          <label class="text-sm font-semibold">
            {{ labels.targetDateLabel }}
            <input v-model="form.closingDate" class="input mt-1" type="date" required />
          </label>
          <label class="text-sm font-semibold">
            Status
            <select v-model="form.status" class="input mt-1">
              <option v-for="status in newCaseStatuses" :key="status" :value="status">{{ status }}</option>
            </select>
            <span class="mt-1 block text-xs font-normal text-ink-500">Use the {{ labels.completeAction }} workflow after intake when the work is finished.</span>
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

        <div v-if="activeTags.length" class="flex flex-wrap gap-2">
          <TagChip v-for="tag in activeTags" :key="tag.tagId" :tag="tag" />
        </div>

        <label class="block text-sm font-semibold">
          Notes
          <textarea v-model="form.notes" class="textarea mt-1" placeholder="Initial intake notes, special coordination items, site access, customer expectations, or risks." />
        </label>

        <p v-if="formError" class="text-sm font-semibold text-legal-red">{{ formError }}</p>

        <div class="flex justify-end gap-2 border-t border-ink-200 pt-4">
          <button class="btn-secondary" type="button" @click="showNewCase = false">Cancel</button>
          <button class="btn-primary" type="submit" :disabled="saving">{{ saving ? "Creating..." : labels.createSubmitLabel }}</button>
        </div>
      </form>
    </div>
  </div>
</template>
