<script setup lang="ts">
import { Edit3, X } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { client } from "../../api/client";
import { useBusinessTemplate, workItemPath } from "../../businessTemplate";
import { contactDisplayName, formatCurrency, formatDate, mailtoHref } from "../../shared/format";
import type { CaseContact, Contact, ContactInput, PartyOrganization } from "../../shared/types";
import { useAuthStore } from "../../stores/auth";
import Breadcrumbs from "../Breadcrumbs.vue";
import StatusBadge from "../StatusBadge.vue";
import ContactFormModal from "./ContactFormModal.vue";

const props = defineProps<{
  contact: Contact | null;
  modelValue: boolean;
  breadcrumbItems?: Array<{ label: string; to?: string; current?: boolean }>;
  partyOrganizations?: PartyOrganization[];
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  contactUpdated: [contact: Contact];
  organizationCreated: [organization: PartyOrganization];
}>();

const auth = useAuthStore();
const { template, labels } = useBusinessTemplate();
const displayContact = ref<Contact | null>(props.contact);
const relatedCases = ref<CaseContact[]>([]);
const loading = ref(false);
const error = ref("");
const showEdit = ref(false);
const saving = ref(false);
const formError = ref("");
const drawerOrganizations = ref<PartyOrganization[]>(props.partyOrganizations ?? []);
const breadcrumbs = computed(() => {
  if (props.breadcrumbItems?.length) return props.breadcrumbItems;
  return [
    { label: "Contacts", to: "/contacts" },
    { label: displayContact.value ? contactDisplayName(displayContact.value) : "Contact", current: true }
  ];
});
const contactMeta = computed(() =>
  [displayContact.value?.jobTitle, displayContact.value?.partyOrganizationName, displayContact.value?.email]
    .filter(Boolean)
    .join(" · ")
);

async function loadRelatedCases() {
  if (!displayContact.value || !props.modelValue) return;
  loading.value = true;
  error.value = "";
  try {
    relatedCases.value = await client.contactCases(displayContact.value.contactId);
  } catch (err) {
    error.value = err instanceof Error ? err.message : `Unable to load related ${labels.value.lowerPlural}`;
  } finally {
    loading.value = false;
  }
}

function close() {
  emit("update:modelValue", false);
}

async function ensureOrganizations() {
  if (drawerOrganizations.value.length) return;
  drawerOrganizations.value = await client.partyOrganizations();
}

async function openEdit() {
  if (!displayContact.value || !auth.canManageContacts) return;
  formError.value = "";
  await ensureOrganizations();
  showEdit.value = true;
}

function addPartyOrganization(organization: PartyOrganization) {
  if (!drawerOrganizations.value.some((item) => item.partyOrganizationId === organization.partyOrganizationId)) {
    drawerOrganizations.value = [...drawerOrganizations.value, organization].sort((a, b) => a.name.localeCompare(b.name));
  }
  emit("organizationCreated", organization);
}

async function saveContact(payload: { contact: ContactInput }) {
  if (!displayContact.value) return;
  saving.value = true;
  formError.value = "";
  try {
    const updated = await client.updateContact(displayContact.value.contactId, payload.contact);
    displayContact.value = updated;
    emit("contactUpdated", updated);
    showEdit.value = false;
    await loadRelatedCases();
  } catch (err) {
    formError.value = err instanceof Error ? err.message : "Unable to save contact";
  } finally {
    saving.value = false;
  }
}

watch(
  () => props.contact,
  (contact) => {
    displayContact.value = contact;
  },
  { immediate: true }
);

watch(
  () => props.partyOrganizations,
  (organizations) => {
    drawerOrganizations.value = organizations ?? [];
  },
  { immediate: true }
);

watch(() => [displayContact.value?.contactId, props.modelValue], loadRelatedCases, { immediate: true });
</script>

<template>
  <div v-if="modelValue && displayContact" class="fixed inset-0 z-50 bg-ink-900/45">
    <button class="absolute inset-0 h-full w-full cursor-default" type="button" :aria-label="`Close related ${labels.lowerPlural}`" @click="close" />

    <aside class="absolute inset-y-0 right-0 flex w-full max-w-5xl flex-col bg-white shadow-soft">
      <header class="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
        <div>
          <Breadcrumbs :items="breadcrumbs" compact />
          <p class="text-xs font-semibold uppercase tracking-wide text-accent-700">Contact relationship view</p>
          <h2 class="mt-1 text-lg font-semibold">{{ contactDisplayName(displayContact) }}</h2>
          <p class="mt-1 text-sm text-ink-500">{{ contactMeta }}</p>
        </div>
        <div class="flex items-center gap-2">
          <button
            class="btn-secondary h-9 px-3"
            type="button"
            :disabled="!auth.canManageContacts || saving"
            :title="auth.canManageContacts ? 'Edit contact' : 'Read-only users cannot edit contacts'"
            @click="openEdit"
          >
            <Edit3 class="h-4 w-4" />
            Edit
          </button>
          <button class="btn-secondary h-9 px-3" type="button" @click="close">
            <X class="h-4 w-4" />
          </button>
        </div>
      </header>

      <div class="grid flex-1 gap-5 overflow-y-auto px-5 py-5 xl:grid-cols-[0.72fr_1.28fr]">
        <section>
          <h3 class="text-sm font-semibold uppercase text-ink-500">Contact details</h3>
          <dl class="mt-3 space-y-3 text-sm">
            <div>
              <dt class="text-ink-500">Organization</dt>
              <dd class="font-medium">
                <RouterLink
                  v-if="displayContact.partyOrganizationId"
                  class="text-accent-700 hover:text-accent-900"
                  :to="`/organizations/${displayContact.partyOrganizationId}`"
                  @click="close"
                >
                  {{ displayContact.partyOrganizationName }}
                </RouterLink>
                <span v-else>{{ displayContact.partyOrganizationName }}</span>
              </dd>
            </div>
            <div>
              <dt class="text-ink-500">Title</dt>
              <dd class="font-medium">{{ displayContact.jobTitle }}</dd>
            </div>
            <div v-if="displayContact.email">
              <dt class="text-ink-500">Email</dt>
              <dd>
                <a
                  class="font-medium text-accent-700 hover:text-accent-900 hover:underline"
                  :href="mailtoHref(displayContact.email)"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {{ displayContact.email }}
                </a>
              </dd>
            </div>
            <div>
              <dt class="text-ink-500">Phone</dt>
              <dd class="font-medium">{{ displayContact.phone }}</dd>
            </div>
            <div>
              <dt class="text-ink-500">Address</dt>
              <dd class="font-medium">{{ displayContact.address }}</dd>
            </div>
            <div>
              <dt class="text-ink-500">Notes</dt>
              <dd class="leading-6">{{ displayContact.notes }}</dd>
            </div>
          </dl>
        </section>

        <section>
          <div class="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 class="font-semibold">{{ labels.contactRelationshipTitle }}</h3>
              <p class="text-sm text-ink-500">{{ labels.contactRelationshipDescription }}</p>
            </div>
            <span class="rounded-full bg-accent-50 px-3 py-1 text-sm font-semibold text-accent-800">{{ relatedCases.length }}</span>
          </div>

          <div class="panel overflow-hidden shadow-none">
            <div class="overflow-x-auto">
              <table class="min-w-[760px] w-full text-left text-sm">
                <thead class="bg-ink-50 text-xs uppercase text-ink-500">
                  <tr>
                    <th class="px-5 py-3">{{ labels.singular }}</th>
                    <th class="px-5 py-3">Role</th>
                    <th class="px-5 py-3">{{ labels.locationSummaryLabel }}</th>
                    <th class="px-5 py-3">Status</th>
                    <th class="px-5 py-3">{{ labels.targetDateLabel }}</th>
                    <th v-if="template.showValueField" class="px-5 py-3">{{ labels.valueLabel }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-ink-100">
                  <tr v-if="loading">
                    <td class="px-5 py-6 text-ink-500" colspan="6">Loading related {{ labels.lowerPlural }}...</td>
                  </tr>
                  <tr v-for="item in relatedCases" :key="`${item.caseId}-${item.role}`" class="hover:bg-ink-50">
                    <td class="px-5 py-4 font-semibold">
                      <RouterLink class="text-accent-700 hover:text-accent-900" :to="workItemPath(item.caseId)" @click="close">
                        {{ item.case?.caseNumber }}
                      </RouterLink>
                    </td>
                    <td class="px-5 py-4">{{ item.role }}</td>
                    <td class="px-5 py-4">
                      <p class="font-medium">{{ item.case?.propertyAddress }}</p>
                      <p class="text-xs text-ink-500">{{ item.case?.city }}, {{ item.case?.state }}</p>
                    </td>
                    <td class="px-5 py-4">
                      <StatusBadge v-if="item.case" :status="item.case.status" />
                    </td>
                    <td class="px-5 py-4">{{ item.case ? formatDate(item.case.closingDate) : "" }}</td>
                    <td v-if="template.showValueField" class="px-5 py-4">{{ item.case ? formatCurrency(item.case.salePriceCents) : "" }}</td>
                  </tr>
                  <tr v-if="!loading && error">
                    <td class="px-5 py-6 text-legal-red" colspan="6">{{ error }}</td>
                  </tr>
                  <tr v-if="!loading && !error && !relatedCases.length">
                    <td class="px-5 py-6 text-ink-500" colspan="6">No related {{ labels.lowerPlural }} yet.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </aside>

    <ContactFormModal
      v-model="showEdit"
      title="Edit contact"
      :description="`Update reusable party information without leaving this ${labels.lowerSingular}.`"
      submit-label="Save changes"
      :saving="saving"
      :error="formError"
      :initial-contact="displayContact"
      :party-organizations="drawerOrganizations"
      @organization-created="addPartyOrganization"
      @submit="saveContact"
    />
  </div>
</template>
