<script setup lang="ts">
import { AlertCircle, BriefcaseBusiness, Grid2X2, List, Mail, MessageSquare, Phone, Plus, Save, Search, Trash2, X } from "lucide-vue-next";
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { client } from "../api/client";
import DirectoryToolbar from "../components/directory/DirectoryToolbar.vue";
import PageHeader from "../components/PageHeader.vue";
import ContactCard from "../components/relationships/ContactCard.vue";
import ContactFormModal from "../components/relationships/ContactFormModal.vue";
import ContactRelationshipDrawer from "../components/relationships/ContactRelationshipDrawer.vue";
import { useI18n } from "../i18n";
import { contactDisplayName, formatDateTime, mailtoHref } from "../shared/format";
import type { Contact, ContactFilters, ContactInput, PartyOrganization, SavedDirectoryView } from "../shared/types";
import { useAuthStore } from "../stores/auth";
import { useToastStore } from "../stores/toasts";

const { t } = useI18n();
const auth = useAuthStore();
const toasts = useToastStore();
const router = useRouter();
const contacts = ref<Contact[]>([]);
const partyOrganizations = ref<PartyOrganization[]>([]);
const savedViews = ref<SavedDirectoryView[]>([]);
const selectedSavedViewId = ref("");
const savedViewName = ref("");
const q = ref("");
const showAdvancedFilters = ref(false);
type ContactsViewMode = "cards" | "compact";
const CONTACTS_VIEW_MODE_STORAGE_KEY = "md3-platform.contacts.view-mode";
const viewMode = ref<ContactsViewMode>(
  (window.localStorage.getItem(CONTACTS_VIEW_MODE_STORAGE_KEY) as ContactsViewMode | null) === "compact" ? "compact" : "cards"
);
const organizationFilter = ref("");
const emailFilter = ref<ContactFilters["email"]>("");
const phoneFilter = ref<ContactFilters["phone"]>("");
const servicesFilter = ref<ContactFilters["services"]>("");
const communicationsFilter = ref<ContactFilters["communications"]>("");
const sortOption = ref("updated_desc");
const loading = ref(true);
const page = ref(1);
const pageSize = ref(25);
const totalContacts = ref(0);
const totalPages = ref(1);
const selectedContactIds = ref<string[]>([]);
const bulkOrganizationId = ref("");
const showNewContact = ref(false);
const showContactDetail = ref(false);
const selectedContact = ref<Contact | null>(null);
const saving = ref(false);
const formError = ref("");
const loadError = ref("");

const sortParts = computed(() => {
  const [sort, direction] = sortOption.value.split("_");
  return {
    sort: (sort || "updated") as ContactFilters["sort"],
    direction: (direction || "desc") as ContactFilters["direction"]
  };
});

const contactFilters = computed<ContactFilters>(() => ({
  q: q.value,
  partyOrganizationId: organizationFilter.value,
  email: emailFilter.value,
  phone: phoneFilter.value,
  services: servicesFilter.value,
  communications: communicationsFilter.value,
  sort: sortParts.value.sort,
  direction: sortParts.value.direction
}));

const activeFilterCount = computed(
  () =>
    [organizationFilter.value, emailFilter.value, phoneFilter.value, servicesFilter.value, communicationsFilter.value].filter(Boolean).length
);
const missingEmailCount = computed(() => contacts.value.filter((contact) => !contact.email.trim()).length);
const missingPhoneCount = computed(() => contacts.value.filter((contact) => !contact.phone.trim()).length);
const followUpCount = computed(() =>
  contacts.value.reduce((total, contact) => total + (contact.needsFollowUpCommunicationCount ?? 0), 0)
);
const activeFilterChips = computed(() => {
  const organizationLabel =
    organizationFilter.value === "none"
      ? "No organization"
      : partyOrganizations.value.find((organization) => organization.partyOrganizationId === organizationFilter.value)?.name;
  return [
    organizationFilter.value ? { key: "organization", label: `Organization: ${organizationLabel ?? organizationFilter.value}` } : null,
    emailFilter.value ? { key: "email", label: emailFilter.value === "has" ? "Has email" : "Missing email" } : null,
    phoneFilter.value ? { key: "phone", label: phoneFilter.value === "has" ? "Has phone" : "Missing phone" } : null,
    servicesFilter.value
      ? {
          key: "services",
          label:
            servicesFilter.value === "open"
              ? "Has open services"
              : servicesFilter.value === "none"
                ? "No services"
                : "Service link"
        }
      : null,
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
  ].filter(Boolean) as Array<{ key: string; label: string }>;
});
const selectedContactCount = computed(() => selectedContactIds.value.length);
const currentPageAllSelected = computed(
  () => contacts.value.length > 0 && contacts.value.every((contact) => selectedContactIds.value.includes(contact.contactId))
);

function openNewContact() {
  formError.value = "";
  showNewContact.value = true;
}

function openContactDetail(contact: Contact) {
  selectedContact.value = contact;
  showContactDetail.value = true;
}

function updateContactInState(contact: Contact) {
  selectedContact.value = contact;
  contacts.value = contacts.value.map((item) => (item.contactId === contact.contactId ? contact : item));
}

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const [contactPage, organizationRows, savedViewRows] = await Promise.all([
      client.contactsPage(contactFilters.value, { page: page.value, pageSize: pageSize.value }),
      client.partyOrganizations(),
      client.savedDirectoryViews("contacts")
    ]);
    contacts.value = contactPage.items;
    totalContacts.value = contactPage.total;
    totalPages.value = contactPage.totalPages;
    page.value = contactPage.page;
    partyOrganizations.value = organizationRows;
    savedViews.value = savedViewRows;
    selectedContactIds.value = selectedContactIds.value.filter((id) => contactPage.items.some((contact) => contact.contactId === id));
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "Unable to load contacts";
  } finally {
    loading.value = false;
  }
}

async function saveContact(payload: { contact: ContactInput }) {
  saving.value = true;
  formError.value = "";
  try {
    await client.createContact(payload.contact);
    showNewContact.value = false;
    await load();
  } catch (error) {
    formError.value = error instanceof Error ? error.message : "Unable to create contact";
  } finally {
    saving.value = false;
  }
}

function addPartyOrganization(organization: PartyOrganization) {
  if (partyOrganizations.value.some((item) => item.partyOrganizationId === organization.partyOrganizationId)) return;
  partyOrganizations.value = [...partyOrganizations.value, organization].sort((a, b) => a.name.localeCompare(b.name));
}

let timer: number | undefined;
watch([q, organizationFilter, emailFilter, phoneFilter, servicesFilter, communicationsFilter, sortOption], () => {
  page.value = 1;
  window.clearTimeout(timer);
  timer = window.setTimeout(load, 200);
});

watch([pageSize], () => {
  page.value = 1;
  void load();
});

watch(viewMode, (mode) => {
  window.localStorage.setItem(CONTACTS_VIEW_MODE_STORAGE_KEY, mode);
});

function resetFilters() {
  q.value = "";
  organizationFilter.value = "";
  emailFilter.value = "";
  phoneFilter.value = "";
  servicesFilter.value = "";
  communicationsFilter.value = "";
  sortOption.value = "updated_desc";
  page.value = 1;
  selectedSavedViewId.value = "";
}

function clearFilter(key: string) {
  if (key === "organization") organizationFilter.value = "";
  if (key === "email") emailFilter.value = "";
  if (key === "phone") phoneFilter.value = "";
  if (key === "services") servicesFilter.value = "";
  if (key === "communications") communicationsFilter.value = "";
}

function openContact(contact: Contact) {
  void router.push(`/contacts/${contact.contactId}`);
}

function toggleContactSelection(contactId: string) {
  selectedContactIds.value = selectedContactIds.value.includes(contactId)
    ? selectedContactIds.value.filter((id) => id !== contactId)
    : [...selectedContactIds.value, contactId];
}

function toggleCurrentPageSelection() {
  if (currentPageAllSelected.value) {
    const currentIds = new Set(contacts.value.map((contact) => contact.contactId));
    selectedContactIds.value = selectedContactIds.value.filter((id) => !currentIds.has(id));
  } else {
    selectedContactIds.value = Array.from(new Set([...selectedContactIds.value, ...contacts.value.map((contact) => contact.contactId)]));
  }
}

function savedViewPayload() {
  return {
    q: q.value,
    partyOrganizationId: organizationFilter.value,
    email: emailFilter.value,
    phone: phoneFilter.value,
    services: servicesFilter.value,
    communications: communicationsFilter.value,
    sortOption: sortOption.value
  };
}

function applySavedView() {
  const view = savedViews.value.find((item) => item.savedViewId === selectedSavedViewId.value);
  if (!view) return;
  const filters = view.filters as Record<string, string | undefined>;
  q.value = filters.q ?? "";
  organizationFilter.value = filters.partyOrganizationId ?? "";
  emailFilter.value = (filters.email ?? "") as ContactFilters["email"];
  phoneFilter.value = (filters.phone ?? "") as ContactFilters["phone"];
  servicesFilter.value = (filters.services ?? "") as ContactFilters["services"];
  communicationsFilter.value = (filters.communications ?? "") as ContactFilters["communications"];
  sortOption.value = filters.sortOption ?? view.sort ?? "updated_desc";
  pageSize.value = view.pageSize;
  page.value = 1;
}

async function saveCurrentView() {
  const name = savedViewName.value.trim();
  if (!name) return;
  try {
    const view = await client.createSavedDirectoryView({
      scope: "contacts",
      name,
      filters: savedViewPayload(),
      sort: sortOption.value,
      pageSize: pageSize.value
    });
    savedViews.value = [...savedViews.value, view].sort((a, b) => a.name.localeCompare(b.name));
    selectedSavedViewId.value = view.savedViewId;
    savedViewName.value = "";
    toasts.success("Contact view saved", view.name);
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
  toasts.success("Contact view deleted", view.name);
}

async function runContactBulkAction(action: "set-organization" | "clear-organization" | "delete") {
  if (!selectedContactIds.value.length) return;
  if (action === "set-organization" && !bulkOrganizationId.value) return;
  if (action === "delete" && !window.confirm(`Delete ${selectedContactIds.value.length} selected contacts?`)) return;
  try {
    const result = await client.bulkContacts({
      action,
      contactIds: selectedContactIds.value,
      partyOrganizationId: action === "set-organization" ? bulkOrganizationId.value : null
    });
    const actionLabel =
      action === "delete" ? "deleted" : action === "set-organization" ? "assigned to the organization" : "cleared from the organization";
    if (result.failed.length) {
      toasts.error("Bulk action partially failed", `${result.succeeded} of ${result.requested} contacts ${actionLabel}.`);
    } else {
      toasts.success("Bulk action complete", `${result.succeeded} of ${result.requested} contacts ${actionLabel}.`);
    }
    selectedContactIds.value = [];
    await load();
  } catch (error) {
    toasts.error("Bulk update failed", error instanceof Error ? error.message : "Please try again.");
  }
}

onMounted(load);
</script>

<template>
  <PageHeader
    eyebrow="Party directory"
    :title="t('contacts')"
    description="Reusable contacts for customers, vendors, partners, technicians, and outside parties."
  >
    <button class="btn-primary" :disabled="!auth.canManageContacts" :title="auth.canManageContacts ? 'Create contact' : t('readonlyNotice')" @click="openNewContact">
      <Plus class="h-4 w-4" />
      New contact
    </button>
  </PageHeader>

  <DirectoryToolbar
    :active-filter-count="activeFilterCount"
    :show-advanced-filters="showAdvancedFilters"
    :selected-count="selectedContactCount"
    @toggle-advanced="showAdvancedFilters = !showAdvancedFilters"
    @clear-filters="resetFilters"
  >
    <template #search>
      <label class="relative block">
        <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input v-model="q" class="input pl-9" placeholder="Search by name, organization, title, email, or phone" />
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
        <option value="organization_asc">Organization A-Z</option>
        <option value="organization_desc">Organization Z-A</option>
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
      <select v-model="organizationFilter" class="input">
        <option value="">Any organization</option>
        <option value="none">No organization</option>
        <option v-for="organization in partyOrganizations" :key="organization.partyOrganizationId" :value="organization.partyOrganizationId">
          {{ organization.name }}
        </option>
      </select>
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
      <select v-model="servicesFilter" class="input">
        <option value="">Any service link</option>
        <option value="open">Has open services</option>
        <option value="none">No services</option>
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
        <span class="rounded-md border border-ink-200 px-3 py-2"><strong class="text-ink-900">{{ totalContacts }}</strong> total</span>
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
      <div v-if="auth.canManageContacts" class="flex flex-wrap items-center gap-3">
        <span class="font-semibold text-ink-700">{{ selectedContactCount }} selected</span>
        <button class="btn-secondary h-9 px-3" type="button" :disabled="!contacts.length" @click="toggleCurrentPageSelection">
          {{ currentPageAllSelected ? "Clear page" : "Select page" }}
        </button>
        <select v-model="bulkOrganizationId" class="input h-9 max-w-xs py-1">
          <option value="">Choose organization</option>
          <option v-for="organization in partyOrganizations" :key="organization.partyOrganizationId" :value="organization.partyOrganizationId">
            {{ organization.name }}
          </option>
        </select>
        <button class="btn-secondary h-9 px-3" type="button" :disabled="!selectedContactCount || !bulkOrganizationId" @click="runContactBulkAction('set-organization')">
          Assign organization
        </button>
        <button class="btn-secondary h-9 px-3" type="button" :disabled="!selectedContactCount" @click="runContactBulkAction('clear-organization')">
          Clear organization
        </button>
        <button class="btn-secondary h-9 px-3 text-red-700" type="button" :disabled="!selectedContactCount || !auth.canDeleteContacts" @click="runContactBulkAction('delete')">
          Delete selected
        </button>
      </div>
    </template>

    <template #errors>
    <p v-if="formError" class="mt-2 text-sm font-semibold text-legal-red">{{ formError }}</p>
    <p v-if="loadError" class="mt-2 text-sm font-semibold text-legal-red">{{ loadError }}</p>
    </template>
  </DirectoryToolbar>

  <p v-if="loading" class="panel p-5 text-sm text-ink-500">Loading contacts...</p>

  <section v-else-if="viewMode === 'cards'" class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
    <article v-for="contact in contacts" :key="contact.contactId" class="relative">
      <label v-if="auth.canManageContacts" class="absolute right-3 top-3 z-10 rounded-md bg-white/95 px-2 py-1 text-xs font-semibold shadow-sm">
        <input
          class="mr-1 align-middle"
          type="checkbox"
          :checked="selectedContactIds.includes(contact.contactId)"
          @change.stop="toggleContactSelection(contact.contactId)"
          @click.stop
        />
        Select
      </label>
      <ContactCard
        :contact="contact"
        @open-related="router.push(`/contacts/${contact.contactId}`)"
      />
    </article>
  </section>

  <section v-else class="panel overflow-hidden">
    <div class="overflow-x-auto">
      <table class="min-w-full text-left text-sm">
        <thead class="bg-ink-50 text-xs font-semibold uppercase text-ink-500">
          <tr>
            <th class="px-4 py-3">
              <input type="checkbox" :checked="currentPageAllSelected" @change="toggleCurrentPageSelection" />
            </th>
            <th class="px-4 py-3">Name</th>
            <th class="px-4 py-3">Organization</th>
            <th class="px-4 py-3">Title</th>
            <th class="px-4 py-3">Email</th>
            <th class="px-4 py-3">Phone</th>
            <th class="px-4 py-3">Services</th>
            <th class="px-4 py-3">Communication</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-ink-100">
          <tr
            v-for="contact in contacts"
            :key="contact.contactId"
            class="cursor-pointer align-top transition hover:bg-ink-50"
            @click="openContact(contact)"
          >
            <td class="px-4 py-3" @click.stop>
              <input
                type="checkbox"
                :checked="selectedContactIds.includes(contact.contactId)"
                @change="toggleContactSelection(contact.contactId)"
              />
            </td>
            <td class="px-4 py-3">
              <p class="font-semibold text-accent-800">{{ contactDisplayName(contact) }}</p>
              <p v-if="contact.notes" class="mt-1 max-w-xs truncate text-xs text-ink-500">{{ contact.notes }}</p>
            </td>
            <td class="px-4 py-3">
              <button
                v-if="contact.partyOrganizationId"
                class="max-w-[15rem] truncate text-left font-semibold text-accent-700 hover:text-accent-900 hover:underline"
                type="button"
                @click.stop="router.push(`/organizations/${contact.partyOrganizationId}`)"
              >
                {{ contact.partyOrganizationName }}
              </button>
              <span v-else class="text-ink-400">No organization</span>
            </td>
            <td class="px-4 py-3 text-ink-700">{{ contact.jobTitle }}</td>
            <td class="px-4 py-3">
              <a
                v-if="contact.email"
                class="inline-flex max-w-[16rem] items-center gap-2 truncate font-semibold text-accent-700 hover:text-accent-900 hover:underline"
                :href="mailtoHref(contact.email)"
                target="_blank"
                rel="noopener noreferrer"
                @click.stop
              >
                <Mail class="h-4 w-4 shrink-0 text-ink-400" />
                <span class="truncate">{{ contact.email }}</span>
              </a>
              <span v-else class="inline-flex items-center gap-2 text-ink-400"><Mail class="h-4 w-4" /> Missing</span>
            </td>
            <td class="px-4 py-3">
              <span v-if="contact.phone" class="inline-flex items-center gap-2 whitespace-nowrap">
                <Phone class="h-4 w-4 text-ink-400" />
                {{ contact.phone }}
              </span>
              <span v-else class="inline-flex items-center gap-2 text-ink-400"><Phone class="h-4 w-4" /> Missing</span>
            </td>
            <td class="px-4 py-3">
              <span class="inline-flex items-center gap-2 whitespace-nowrap">
                <BriefcaseBusiness class="h-4 w-4 text-ink-400" />
                {{ contact.openServiceCount ?? 0 }} open / {{ contact.relatedServiceCount ?? 0 }} total
              </span>
            </td>
            <td class="px-4 py-3">
              <div class="flex flex-col gap-1">
                <span
                  v-if="contact.needsFollowUpCommunicationCount"
                  class="inline-flex w-fit items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800"
                >
                  <AlertCircle class="h-3.5 w-3.5" />
                  {{ contact.needsFollowUpCommunicationCount }} follow-up
                </span>
                <span class="inline-flex items-center gap-2 whitespace-nowrap text-ink-600">
                  <MessageSquare class="h-4 w-4 text-ink-400" />
                  {{ contact.communicationCount ?? 0 }}
                  <span v-if="contact.lastCommunicationAt" class="text-ink-400">· {{ formatDateTime(contact.lastCommunicationAt) }}</span>
                </span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="!contacts.length" class="border-t border-ink-100 p-8 text-center text-sm text-ink-500">
      No contacts match the current filters.
    </div>
  </section>

  <div v-if="!loading" class="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
    <p class="text-ink-500">Page {{ page }} of {{ totalPages }} · {{ totalContacts }} contacts</p>
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

  <ContactRelationshipDrawer
    v-model="showContactDetail"
    :contact="selectedContact"
    :party-organizations="partyOrganizations"
    :breadcrumb-items="[
      { label: t('contacts'), to: '/contacts' },
      { label: selectedContact ? contactDisplayName(selectedContact) : 'Contact', current: true }
    ]"
    @contact-updated="updateContactInState"
    @organization-created="addPartyOrganization"
  />

  <ContactFormModal
    v-model="showNewContact"
    :saving="saving"
    :error="formError"
    :party-organizations="partyOrganizations"
    @organization-created="addPartyOrganization"
    @submit="saveContact"
  />
</template>
