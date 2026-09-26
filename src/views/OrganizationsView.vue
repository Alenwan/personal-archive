<script setup lang="ts">
import {
  BriefcaseBusiness,
  Building2,
  Grid2X2,
  HardDrive,
  List,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  Save,
  Search,
  Trash2,
  X
} from "lucide-vue-next";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { client } from "../api/client";
import { useBusinessTemplate } from "../businessTemplate";
import DirectoryToolbar from "../components/directory/DirectoryToolbar.vue";
import PageHeader from "../components/PageHeader.vue";
import { useI18n } from "../i18n";
import { formatDateTime, mailtoHref } from "../shared/format";
import { type OrganizationFilters, type PartyOrganization, type PartyOrganizationInput, type SavedDirectoryView } from "../shared/types";
import { useAuthStore } from "../stores/auth";
import { useToastStore } from "../stores/toasts";

const { t } = useI18n();
const { labels } = useBusinessTemplate();
const router = useRouter();
const auth = useAuthStore();
const toasts = useToastStore();
const organizations = ref<PartyOrganization[]>([]);
const savedViews = ref<SavedDirectoryView[]>([]);
const selectedSavedViewId = ref("");
const savedViewName = ref("");
const q = ref("");
const showAdvancedFilters = ref(false);
type OrganizationsViewMode = "cards" | "compact";
const ORGANIZATIONS_VIEW_MODE_STORAGE_KEY = "md3-platform.organizations.view-mode";
const viewMode = ref<OrganizationsViewMode>(
  (window.localStorage.getItem(ORGANIZATIONS_VIEW_MODE_STORAGE_KEY) as OrganizationsViewMode | null) === "compact" ? "compact" : "cards"
);
const emailFilter = ref<OrganizationFilters["email"]>("");
const phoneFilter = ref<OrganizationFilters["phone"]>("");
const websiteFilter = ref<OrganizationFilters["website"]>("");
const contactsFilter = ref<OrganizationFilters["contacts"]>("");
const servicesFilter = ref<OrganizationFilters["services"]>("");
const assetsFilter = ref<OrganizationFilters["assets"]>("");
const communicationsFilter = ref<OrganizationFilters["communications"]>("");
const sortOption = ref("name_asc");
const loading = ref(true);
const page = ref(1);
const pageSize = ref(25);
const totalOrganizations = ref(0);
const totalPages = ref(1);
const selectedOrganizationIds = ref<string[]>([]);
const saving = ref(false);
const error = ref("");
const loadError = ref("");
const showCreate = ref(false);

const form = reactive<PartyOrganizationInput>({
  name: "",
  type: "Company",
  taxIdType: "",
  taxIdValue: "",
  website: "",
  email: "",
  phone: "",
  fax: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "NY",
  zipCode: "",
  country: "United States",
  notes: ""
});

const sortParts = computed(() => {
  const [sort, direction] = sortOption.value.split("_");
  return {
    sort: (sort || "name") as OrganizationFilters["sort"],
    direction: (direction || "asc") as OrganizationFilters["direction"]
  };
});

const organizationFilters = computed<OrganizationFilters>(() => ({
  q: q.value,
  email: emailFilter.value,
  phone: phoneFilter.value,
  website: websiteFilter.value,
  contacts: contactsFilter.value,
  services: servicesFilter.value,
  assets: assetsFilter.value,
  communications: communicationsFilter.value,
  sort: sortParts.value.sort,
  direction: sortParts.value.direction
}));

const activeFilterCount = computed(
  () =>
    [
      emailFilter.value,
      phoneFilter.value,
      websiteFilter.value,
      contactsFilter.value,
      servicesFilter.value,
      assetsFilter.value,
      communicationsFilter.value
    ].filter(Boolean).length
);
const missingEmailCount = computed(() => organizations.value.filter((organization) => !organization.email.trim()).length);
const missingPhoneCount = computed(() => organizations.value.filter((organization) => !organization.phone.trim()).length);
const followUpCount = computed(() =>
  organizations.value.reduce((total, organization) => total + (organization.needsFollowUpCommunicationCount ?? 0), 0)
);
const activeFilterChips = computed(() =>
  [
    emailFilter.value ? { key: "email", label: emailFilter.value === "has" ? "Has email" : "Missing email" } : null,
    phoneFilter.value ? { key: "phone", label: phoneFilter.value === "has" ? "Has phone" : "Missing phone" } : null,
    websiteFilter.value ? { key: "website", label: websiteFilter.value === "has" ? "Has website" : "Missing website" } : null,
    contactsFilter.value ? { key: "contacts", label: contactsFilter.value === "has" ? "Has contacts" : "No contacts" } : null,
    servicesFilter.value
      ? {
          key: "services",
          label:
            servicesFilter.value === "open"
              ? "Has open services"
              : servicesFilter.value === "has"
                ? "Has services"
                : "No services"
        }
      : null,
    assetsFilter.value ? { key: "assets", label: assetsFilter.value === "has" ? "Has assets" : "No assets" } : null,
    communicationsFilter.value
      ? {
          key: "communications",
          label:
            communicationsFilter.value === "needs-follow-up"
              ? "Needs follow-up"
              : communicationsFilter.value === "has"
                ? "Has communications"
                : "No communications"
        }
      : null
  ].filter(Boolean) as Array<{ key: string; label: string }>
);
const selectedOrganizationCount = computed(() => selectedOrganizationIds.value.length);
const currentPageAllSelected = computed(
  () =>
    organizations.value.length > 0 &&
    organizations.value.every((organization) => selectedOrganizationIds.value.includes(organization.partyOrganizationId))
);

function resetForm() {
  Object.assign(form, {
    name: "",
    type: "Company",
    taxIdType: "",
    taxIdValue: "",
    website: "",
    email: "",
    phone: "",
    fax: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "NY",
    zipCode: "",
    country: "United States",
    notes: ""
  });
  error.value = "";
}

function locationLine(organization: PartyOrganization) {
  return [organization.city, organization.state, organization.zipCode].filter(Boolean).join(", ");
}

function openCreate() {
  resetForm();
  showCreate.value = true;
}

function openOrganization(organizationId: string) {
  void router.push(`/organizations/${organizationId}`);
}

function resetFilters() {
  q.value = "";
  emailFilter.value = "";
  phoneFilter.value = "";
  websiteFilter.value = "";
  contactsFilter.value = "";
  servicesFilter.value = "";
  assetsFilter.value = "";
  communicationsFilter.value = "";
  sortOption.value = "name_asc";
  page.value = 1;
  selectedSavedViewId.value = "";
}

function clearFilter(key: string) {
  if (key === "email") emailFilter.value = "";
  if (key === "phone") phoneFilter.value = "";
  if (key === "website") websiteFilter.value = "";
  if (key === "contacts") contactsFilter.value = "";
  if (key === "services") servicesFilter.value = "";
  if (key === "assets") assetsFilter.value = "";
  if (key === "communications") communicationsFilter.value = "";
}

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const [organizationPage, savedViewRows] = await Promise.all([
      client.partyOrganizationsPage(organizationFilters.value, { page: page.value, pageSize: pageSize.value }),
      client.savedDirectoryViews("organizations")
    ]);
    organizations.value = organizationPage.items;
    totalOrganizations.value = organizationPage.total;
    totalPages.value = organizationPage.totalPages;
    page.value = organizationPage.page;
    savedViews.value = savedViewRows;
    selectedOrganizationIds.value = selectedOrganizationIds.value.filter((id) =>
      organizationPage.items.some((organization) => organization.partyOrganizationId === id)
    );
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : "Unable to load organizations";
  } finally {
    loading.value = false;
  }
}

async function createOrganization() {
  if (!form.name.trim() || saving.value) return;
  saving.value = true;
  error.value = "";
  try {
    const created = await client.createPartyOrganization({ ...form, name: form.name.trim() });
    showCreate.value = false;
    resetFilters();
    organizations.value = [created];
    toasts.success("Organization created", `${created.name} is available for contacts and ${labels.value.lowerPlural}.`);
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to create organization";
    await load().catch(() => undefined);
    toasts.error("Unable to create organization", error.value);
  } finally {
    saving.value = false;
  }
}

let timer: number | undefined;
watch([q, emailFilter, phoneFilter, websiteFilter, contactsFilter, servicesFilter, assetsFilter, communicationsFilter, sortOption], () => {
  page.value = 1;
  window.clearTimeout(timer);
  timer = window.setTimeout(load, 200);
});

watch([pageSize], () => {
  page.value = 1;
  void load();
});

watch(viewMode, (mode) => {
  window.localStorage.setItem(ORGANIZATIONS_VIEW_MODE_STORAGE_KEY, mode);
});

function toggleOrganizationSelection(organizationId: string) {
  selectedOrganizationIds.value = selectedOrganizationIds.value.includes(organizationId)
    ? selectedOrganizationIds.value.filter((id) => id !== organizationId)
    : [...selectedOrganizationIds.value, organizationId];
}

function toggleCurrentPageSelection() {
  if (currentPageAllSelected.value) {
    const currentIds = new Set(organizations.value.map((organization) => organization.partyOrganizationId));
    selectedOrganizationIds.value = selectedOrganizationIds.value.filter((id) => !currentIds.has(id));
  } else {
    selectedOrganizationIds.value = Array.from(new Set([...selectedOrganizationIds.value, ...organizations.value.map((organization) => organization.partyOrganizationId)]));
  }
}

function savedViewPayload() {
  return {
    q: q.value,
    email: emailFilter.value,
    phone: phoneFilter.value,
    website: websiteFilter.value,
    contacts: contactsFilter.value,
    services: servicesFilter.value,
    assets: assetsFilter.value,
    communications: communicationsFilter.value,
    sortOption: sortOption.value
  };
}

function applySavedView() {
  const view = savedViews.value.find((item) => item.savedViewId === selectedSavedViewId.value);
  if (!view) return;
  const filters = view.filters as Record<string, string | undefined>;
  q.value = filters.q ?? "";
  emailFilter.value = (filters.email ?? "") as OrganizationFilters["email"];
  phoneFilter.value = (filters.phone ?? "") as OrganizationFilters["phone"];
  websiteFilter.value = (filters.website ?? "") as OrganizationFilters["website"];
  contactsFilter.value = (filters.contacts ?? "") as OrganizationFilters["contacts"];
  servicesFilter.value = (filters.services ?? "") as OrganizationFilters["services"];
  assetsFilter.value = (filters.assets ?? "") as OrganizationFilters["assets"];
  communicationsFilter.value = (filters.communications ?? "") as OrganizationFilters["communications"];
  sortOption.value = filters.sortOption ?? view.sort ?? "name_asc";
  pageSize.value = view.pageSize;
  page.value = 1;
}

async function saveCurrentView() {
  const name = savedViewName.value.trim();
  if (!name) return;
  try {
    const view = await client.createSavedDirectoryView({
      scope: "organizations",
      name,
      filters: savedViewPayload(),
      sort: sortOption.value,
      pageSize: pageSize.value
    });
    savedViews.value = [...savedViews.value, view].sort((a, b) => a.name.localeCompare(b.name));
    selectedSavedViewId.value = view.savedViewId;
    savedViewName.value = "";
    toasts.success("Organization view saved", view.name);
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
  toasts.success("Organization view deleted", view.name);
}

async function deleteSelectedOrganizations() {
  if (!selectedOrganizationIds.value.length || !auth.canDeleteOrganizations) return;
  if (!window.confirm(`Delete ${selectedOrganizationIds.value.length} selected organizations?`)) return;
  try {
    const result = await client.bulkPartyOrganizations({ action: "delete", partyOrganizationIds: selectedOrganizationIds.value });
    toasts.success("Bulk delete complete", `${result.succeeded} of ${result.requested} organizations deleted.`);
    selectedOrganizationIds.value = [];
    await load();
  } catch (error) {
    toasts.error("Bulk delete failed", error instanceof Error ? error.message : "Please try again.");
  }
}

onMounted(load);
</script>

<template>
  <PageHeader
    eyebrow="Business directory"
    :title="t('organizations')"
    description="Reusable organizations for customers, vendors, partners, and service relationships."
  >
    <button
      class="btn-primary"
      :disabled="!auth.canManageOrganizations"
      :title="auth.canManageOrganizations ? 'Create organization' : t('readonlyNotice')"
      @click="openCreate"
    >
      <Plus class="h-4 w-4" />
      New organization
    </button>
  </PageHeader>

  <DirectoryToolbar
    :active-filter-count="activeFilterCount"
    :show-advanced-filters="showAdvancedFilters"
    :selected-count="selectedOrganizationCount"
    @toggle-advanced="showAdvancedFilters = !showAdvancedFilters"
    @clear-filters="resetFilters"
  >
    <template #search>
      <label class="relative block">
        <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input v-model="q" class="input pl-9" placeholder="Search by organization, city, email, phone, website, or notes" />
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
        <option value="name_asc">Name A-Z</option>
        <option value="name_desc">Name Z-A</option>
        <option value="updated_desc">Recently updated</option>
        <option value="updated_asc">Oldest updated</option>
        <option value="lastCommunication_desc">Recent communication</option>
        <option value="lastCommunication_asc">Oldest communication</option>
        <option value="location_asc">Location A-Z</option>
        <option value="location_desc">Location Z-A</option>
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
      <select v-model="emailFilter" class="input">
        <option value="">Any email</option>
        <option value="has">Has email</option>
        <option value="missing">Missing email</option>
      </select>
      <select v-model="phoneFilter" class="input">
        <option value="">Any phone</option>
        <option value="has">Has phone</option>
        <option value="missing">Missing phone</option>
      </select>
      <select v-model="websiteFilter" class="input">
        <option value="">Any website</option>
        <option value="has">Has website</option>
        <option value="missing">Missing website</option>
      </select>
      <select v-model="contactsFilter" class="input">
        <option value="">Any contacts</option>
        <option value="has">Has contacts</option>
        <option value="none">No contacts</option>
      </select>
      <select v-model="servicesFilter" class="input">
        <option value="">Any service link</option>
        <option value="has">Has services</option>
        <option value="open">Has open services</option>
        <option value="none">No services</option>
      </select>
      <select v-model="assetsFilter" class="input">
        <option value="">Any assets</option>
        <option value="has">Has assets</option>
        <option value="none">No assets</option>
      </select>
      <select v-model="communicationsFilter" class="input">
        <option value="">Any communication</option>
        <option value="has">Has communications</option>
        <option value="needs-follow-up">Needs follow-up</option>
        <option value="none">No communications</option>
      </select>
      </div>
      <div class="mt-3 grid gap-3 lg:grid-cols-[minmax(14rem,1fr)_auto_auto]">
      <input v-model="savedViewName" class="input" placeholder="Name current filters as a saved view" />
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
        <span class="rounded-md border border-ink-200 px-3 py-2"><strong class="text-ink-900">{{ totalOrganizations }}</strong> total</span>
        <button class="rounded-md border border-ink-200 px-3 py-2 text-left transition hover:border-accent-300 hover:bg-accent-50" type="button" @click="emailFilter = 'missing'">
          <strong class="text-ink-900">{{ missingEmailCount }}</strong> missing email
        </button>
        <button class="rounded-md border border-ink-200 px-3 py-2 text-left transition hover:border-accent-300 hover:bg-accent-50" type="button" @click="phoneFilter = 'missing'">
          <strong class="text-ink-900">{{ missingPhoneCount }}</strong> missing phone
        </button>
        <button
          class="rounded-md border border-ink-200 px-3 py-2 text-left transition hover:border-accent-300 hover:bg-accent-50"
          type="button"
          @click="communicationsFilter = 'needs-follow-up'"
        >
          <strong class="text-ink-900">{{ followUpCount }}</strong> follow-ups
        </button>
    </template>

    <template #selection>
      <div v-if="auth.canDeleteOrganizations" class="flex flex-wrap items-center gap-3">
      <span class="font-semibold text-ink-700">{{ selectedOrganizationCount }} selected</span>
      <button class="btn-secondary h-9 px-3" type="button" :disabled="!organizations.length" @click="toggleCurrentPageSelection">
        {{ currentPageAllSelected ? "Clear page" : "Select page" }}
      </button>
      <button class="btn-secondary h-9 px-3 text-red-700" type="button" :disabled="!selectedOrganizationCount" @click="deleteSelectedOrganizations">
        Delete selected
      </button>
      </div>
    </template>

    <template #errors>
    <p v-if="loadError" class="mt-2 text-sm font-semibold text-legal-red">{{ loadError }}</p>
    </template>
  </DirectoryToolbar>

  <p v-if="loading" class="panel p-5 text-sm text-ink-500">Loading organizations...</p>

  <section v-else-if="viewMode === 'cards'" class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
    <article
      v-for="organization in organizations"
      :key="organization.partyOrganizationId"
      class="panel group relative cursor-pointer p-5 transition hover:border-accent-300 hover:bg-ink-50 focus:outline-none focus:ring-2 focus:ring-accent-200"
      role="button"
      tabindex="0"
      @click="openOrganization(organization.partyOrganizationId)"
      @keydown.enter.prevent="openOrganization(organization.partyOrganizationId)"
      @keydown.space.prevent="openOrganization(organization.partyOrganizationId)"
    >
      <label v-if="auth.canDeleteOrganizations" class="absolute right-3 top-3 z-10 rounded-md bg-white/95 px-2 py-1 text-xs font-semibold shadow-sm">
        <input
          class="mr-1 align-middle"
          type="checkbox"
          :checked="selectedOrganizationIds.includes(organization.partyOrganizationId)"
          @change.stop="toggleOrganizationSelection(organization.partyOrganizationId)"
          @click.stop
        />
        Select
      </label>
      <div class="mb-4 flex items-start gap-3">
        <div class="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-accent-50 text-accent-900">
          <Building2 class="h-5 w-5" />
        </div>
        <div class="min-w-0">
          <h2 class="truncate text-lg font-semibold text-ink-900">{{ organization.name }}</h2>
          <p v-if="locationLine(organization)" class="truncate text-sm text-ink-500">{{ locationLine(organization) }}</p>
        </div>
      </div>
      <div class="space-y-2 text-sm text-ink-700">
        <p v-if="organization.email" class="flex items-center gap-2">
          <Mail class="h-4 w-4 shrink-0 text-ink-400" />
          <a
            class="truncate font-semibold text-accent-700 hover:text-accent-900 hover:underline"
            :href="mailtoHref(organization.email)"
            target="_blank"
            rel="noopener noreferrer"
            @click.stop
          >
            {{ organization.email }}
          </a>
        </p>
        <p v-if="organization.phone" class="flex items-center gap-2">
          <Phone class="h-4 w-4 shrink-0 text-ink-400" />
          <span>{{ organization.phone }}</span>
        </p>
        <p v-if="organization.website" class="truncate text-ink-500">{{ organization.website }}</p>
      </div>
      <div class="mt-4 grid grid-cols-3 gap-2 text-xs text-ink-600">
        <div class="rounded-md bg-ink-50 px-3 py-2">
          <p class="font-semibold text-ink-900">{{ organization.contactCount ?? 0 }}</p>
          <p>Contacts</p>
        </div>
        <div class="rounded-md bg-ink-50 px-3 py-2">
          <p class="font-semibold text-ink-900">{{ organization.openServiceCount ?? 0 }} / {{ organization.relatedServiceCount ?? 0 }}</p>
          <p>Open / total</p>
        </div>
        <div class="rounded-md bg-ink-50 px-3 py-2">
          <p class="font-semibold text-ink-900">{{ organization.assetCount ?? 0 }}</p>
          <p>Assets</p>
        </div>
      </div>
      <p v-if="organization.communicationCount" class="mt-3 flex items-center gap-2 text-sm text-ink-500">
        <MessageSquare class="h-4 w-4" />
        {{ organization.communicationCount }} communications
        <span v-if="organization.lastCommunicationAt" class="text-ink-400">· {{ formatDateTime(organization.lastCommunicationAt) }}</span>
      </p>
    </article>
    <div v-if="!organizations.length" class="panel p-5 text-sm text-ink-500">
      No organizations match these filters. Create one when a customer, vendor, partner, or other business should be reused across contacts.
    </div>
  </section>

  <section v-else class="panel overflow-hidden">
    <div class="overflow-x-auto">
      <table class="min-w-full text-left text-sm">
        <thead class="bg-ink-50 text-xs font-semibold uppercase text-ink-500">
          <tr>
            <th class="px-4 py-3">
              <input type="checkbox" :checked="currentPageAllSelected" @change="toggleCurrentPageSelection" />
            </th>
            <th class="px-4 py-3">Organization</th>
            <th class="px-4 py-3">Contact info</th>
            <th class="px-4 py-3">{{ labels.plural }}</th>
            <th class="px-4 py-3">Assets</th>
            <th class="px-4 py-3">Communications</th>
            <th class="px-4 py-3">Location</th>
            <th class="px-4 py-3">Updated</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-ink-100">
          <tr
            v-for="organization in organizations"
            :key="organization.partyOrganizationId"
            class="cursor-pointer hover:bg-ink-50"
            @click="openOrganization(organization.partyOrganizationId)"
          >
            <td class="px-4 py-4" @click.stop>
              <input
                type="checkbox"
                :checked="selectedOrganizationIds.includes(organization.partyOrganizationId)"
                @change="toggleOrganizationSelection(organization.partyOrganizationId)"
              />
            </td>
            <td class="px-4 py-4">
              <p class="font-semibold text-accent-800">{{ organization.name }}</p>
              <p v-if="organization.website" class="text-xs text-ink-500">{{ organization.website }}</p>
            </td>
            <td class="px-4 py-4">
              <a
                v-if="organization.email"
                class="block max-w-[15rem] truncate font-semibold text-accent-700 hover:text-accent-900 hover:underline"
                :href="mailtoHref(organization.email)"
                target="_blank"
                rel="noopener noreferrer"
                @click.stop
              >
                {{ organization.email }}
              </a>
              <p v-if="organization.phone" class="mt-1 text-ink-700">{{ organization.phone }}</p>
              <p class="mt-1 text-xs text-ink-500">{{ organization.contactCount ?? 0 }} contacts</p>
            </td>
            <td class="px-4 py-4">
              <p class="inline-flex items-center gap-2 font-semibold">
                <BriefcaseBusiness class="h-4 w-4 text-ink-400" />
                {{ organization.openServiceCount ?? 0 }} open
              </p>
              <p class="text-xs text-ink-500">{{ organization.relatedServiceCount ?? 0 }} total</p>
            </td>
            <td class="px-4 py-4">
              <p class="inline-flex items-center gap-2 font-semibold">
                <HardDrive class="h-4 w-4 text-ink-400" />
                {{ organization.assetCount ?? 0 }}
              </p>
            </td>
            <td class="px-4 py-4">
              <p class="inline-flex items-center gap-2 font-semibold">
                <MessageSquare class="h-4 w-4 text-ink-400" />
                {{ organization.communicationCount ?? 0 }}
              </p>
              <p v-if="organization.needsFollowUpCommunicationCount" class="text-xs font-semibold text-amber-700">
                {{ organization.needsFollowUpCommunicationCount }} follow-up
              </p>
              <p v-if="organization.lastCommunicationAt" class="text-xs text-ink-500">{{ formatDateTime(organization.lastCommunicationAt) }}</p>
            </td>
            <td class="px-4 py-4 text-ink-700">{{ locationLine(organization) || organization.country || "" }}</td>
            <td class="px-4 py-4 text-ink-500">{{ formatDateTime(organization.updatedAt) }}</td>
          </tr>
          <tr v-if="!organizations.length">
            <td class="px-4 py-6 text-ink-500" colspan="8">No organizations match these filters.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <div v-if="!loading" class="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
    <p class="text-ink-500">Page {{ page }} of {{ totalPages }} · {{ totalOrganizations }} organizations</p>
    <div class="flex items-center gap-2">
      <select v-model.number="pageSize" class="input h-9 w-28 py-1">
        <option :value="10">10 / page</option>
        <option :value="25">25 / page</option>
        <option :value="50">50 / page</option>
        <option :value="100">100 / page</option>
      </select>
      <button class="btn-secondary h-9 px-3" type="button" :disabled="page <= 1" @click="page--; load()">Previous</button>
      <button class="btn-secondary h-9 px-3" type="button" :disabled="page >= totalPages" @click="page++; load()">Next</button>
    </div>
  </div>

  <div v-if="showCreate" class="fixed inset-0 z-50 overflow-y-auto bg-ink-900/45 px-4 py-6">
    <div class="mx-auto max-w-4xl rounded-lg bg-white shadow-soft">
      <div class="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
        <div>
          <h2 class="text-lg font-semibold">New organization</h2>
          <p class="mt-1 text-sm text-ink-500">Add a reusable business party for contacts and {{ labels.lowerSingular }} relationships.</p>
        </div>
        <button class="btn-secondary h-9 px-3" type="button" :disabled="saving" @click="showCreate = false">
          <X class="h-4 w-4" />
        </button>
      </div>

      <form class="space-y-5 px-5 py-5" @submit.prevent="createOrganization">
        <div class="grid gap-3 md:grid-cols-2">
          <label class="text-sm font-semibold md:col-span-2">
            Organization name
            <input v-model="form.name" class="input mt-1" required />
          </label>
          <label class="text-sm font-semibold">
            Email
            <input v-model="form.email" class="input mt-1" type="email" />
          </label>
          <label class="text-sm font-semibold">
            Phone
            <input v-model="form.phone" class="input mt-1" />
          </label>
          <label class="text-sm font-semibold">
            Website
            <input v-model="form.website" class="input mt-1" placeholder="example.com" />
          </label>
          <label class="text-sm font-semibold">
            Fax
            <input v-model="form.fax" class="input mt-1" />
          </label>
          <label class="text-sm font-semibold md:col-span-2">
            Tax ID
            <input v-model="form.taxIdValue" class="input mt-1" />
          </label>
          <label class="text-sm font-semibold md:col-span-2">
            Address line 1
            <input v-model="form.addressLine1" class="input mt-1" />
          </label>
          <label class="text-sm font-semibold md:col-span-2">
            Address line 2
            <input v-model="form.addressLine2" class="input mt-1" />
          </label>
          <label class="text-sm font-semibold">
            City
            <input v-model="form.city" class="input mt-1" />
          </label>
          <label class="text-sm font-semibold">
            State
            <input v-model="form.state" class="input mt-1" />
          </label>
          <label class="text-sm font-semibold">
            ZIP
            <input v-model="form.zipCode" class="input mt-1" />
          </label>
          <label class="text-sm font-semibold">
            Country
            <input v-model="form.country" class="input mt-1" />
          </label>
        </div>

        <label class="block text-sm font-semibold">
          Notes
          <textarea v-model="form.notes" class="textarea mt-1" placeholder="Billing notes, service area, office instructions, or relationship context." />
        </label>

        <p v-if="error" class="text-sm font-semibold text-legal-red">{{ error }}</p>

        <div class="flex justify-end gap-2 border-t border-ink-200 pt-4">
          <button class="btn-secondary" type="button" :disabled="saving" @click="showCreate = false">Cancel</button>
          <button class="btn-primary" type="submit" :disabled="saving || !form.name.trim()">
            <Plus class="h-4 w-4" />
            {{ saving ? "Creating..." : "Create organization" }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
