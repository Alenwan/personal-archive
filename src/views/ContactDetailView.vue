<script setup lang="ts">
import { Edit3, Save, Trash2, X } from "lucide-vue-next";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { client } from "../api/client";
import { useBusinessTemplate, workItemPath } from "../businessTemplate";
import Breadcrumbs from "../components/Breadcrumbs.vue";
import CommunicationHistoryPanel from "../components/communications/CommunicationHistoryPanel.vue";
import PageHeader from "../components/PageHeader.vue";
import OrganizationPicker from "../components/relationships/OrganizationPicker.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { useI18n } from "../i18n";
import { contactDisplayName, formatCurrency, formatDate, formatDateTime, mailtoHref } from "../shared/format";
import type { CaseContact, CommunicationRecord, CommunicationStatus, Contact, ContactInput, PartyOrganization } from "../shared/types";
import { useAuthStore } from "../stores/auth";
import { useToastStore } from "../stores/toasts";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const toasts = useToastStore();
const { t } = useI18n();
const { template, labels } = useBusinessTemplate();
const COMMUNICATION_DRAFT_STORAGE_PREFIX = "md3-platform.communication-draft.";
const contactId = computed(() => String(route.params.id));
const contact = ref<Contact | null>(null);
const relatedCases = ref<CaseContact[]>([]);
const partyOrganizations = ref<PartyOrganization[]>([]);
const communications = ref<CommunicationRecord[]>([]);
const loading = ref(true);
const saving = ref(false);
const deleting = ref(false);
const error = ref("");
const showEdit = ref(false);

const editForm = reactive<ContactInput>({
  displayName: "",
  firstName: "",
  lastName: "",
  partyOrganizationId: null,
  jobTitle: "",
  email: "",
  phone: "",
  address: "",
  notes: ""
});

const fullName = computed(() => (contact.value ? contactDisplayName(contact.value) : "Contact"));
const headerDescription = computed(() =>
  contact.value
    ? [contact.value.jobTitle, contact.value.partyOrganizationName || contact.value.email].filter(Boolean).join(" · ")
    : ""
);
const activeCases = computed(() => relatedCases.value.filter((item) => item.case?.status !== "Closed" && item.case?.status !== "Cancelled"));
const upcomingCases = computed(() =>
  relatedCases.value
    .filter((item) => item.case?.closingDate)
    .slice()
    .sort((a, b) => String(a.case?.closingDate).localeCompare(String(b.case?.closingDate)))
    .slice(0, 3)
);
const roles = computed(() => [...new Set(relatedCases.value.map((item) => item.role))]);
const breadcrumbs = computed(() => [
  { label: t("contacts"), to: "/contacts" },
  { label: fullName.value, current: true }
]);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [contactRecord, caseRows, organizationRows, communicationRows] = await Promise.all([
      client.contact(contactId.value),
      client.contactCases(contactId.value),
      client.partyOrganizations(),
      client.communicationsPage({ contactId: contactId.value, sort: "occurred", sortDirection: "desc" }, { pageSize: 12 })
    ]);
    contact.value = contactRecord;
    relatedCases.value = caseRows;
    partyOrganizations.value = organizationRows;
    communications.value = communicationRows.items;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load contact";
  } finally {
    loading.value = false;
  }
}

function openEdit() {
  if (!contact.value) return;
  Object.assign(editForm, {
    displayName: contactDisplayName(contact.value),
    firstName: contact.value.firstName,
    lastName: "",
    partyOrganizationId: contact.value.partyOrganizationId ?? null,
    jobTitle: contact.value.jobTitle,
    email: contact.value.email,
    phone: contact.value.phone,
    address: contact.value.address,
    notes: contact.value.notes
  });
  error.value = "";
  showEdit.value = true;
}

function selectOrganization(organization: PartyOrganization | null) {
  editForm.partyOrganizationId = organization?.partyOrganizationId ?? null;
}

function addPartyOrganization(organization: PartyOrganization) {
  if (!partyOrganizations.value.some((item) => item.partyOrganizationId === organization.partyOrganizationId)) {
    partyOrganizations.value = [...partyOrganizations.value, organization].sort((a, b) => a.name.localeCompare(b.name));
  }
  selectOrganization(organization);
}

async function saveContact() {
  if (!contact.value) return;
  saving.value = true;
  error.value = "";
  try {
    const displayName = editForm.displayName.trim();
    contact.value = await client.updateContact(contact.value.contactId, {
      ...editForm,
      displayName,
      firstName: displayName,
      lastName: ""
    });
    showEdit.value = false;
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to save contact";
  } finally {
    saving.value = false;
  }
}

async function deleteContact() {
  if (!contact.value || !auth.canDeleteContacts || deleting.value) return;
  const name = fullName.value;
  const confirmed = window.confirm(`Delete ${name} from the contact directory? Related ${labels.value.lowerSingular} history stays in the audit trail.`);
  if (!confirmed) return;
  deleting.value = true;
  error.value = "";
  try {
    await client.deleteContact(contact.value.contactId);
    await router.push("/contacts");
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to delete contact";
  } finally {
    deleting.value = false;
  }
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

function openContactCommunicationLog() {
  if (!contact.value) return;
  const draftId = crypto.randomUUID();
  sessionStorage.setItem(
    `${COMMUNICATION_DRAFT_STORAGE_PREFIX}${draftId}`,
    JSON.stringify({
      caseId: null,
      partyOrganizationId: contact.value.partyOrganizationId ?? null,
      contactId: contact.value.contactId,
      assetId: null,
      supportingDocumentId: null,
      communicationType: "Call",
      direction: "Inbound",
      source: "Manual",
      status: "Logged",
      externalProvider: "",
      externalReference: "",
      externalUrl: "",
      sourceMetadata: {},
      subject: "",
      body: "",
      occurredAt: new Date().toISOString(),
      draftNotice: `Prepared for contact ${fullName.value}. Add notes, choose a service if needed, then save.`
    })
  );
  void router.push(`/communications?draft=${draftId}`);
}

onMounted(load);

watch(contactId, load);
</script>

<template>
  <div>
    <Breadcrumbs :items="breadcrumbs" />

    <div v-if="loading" class="panel p-5 text-sm text-ink-500">Loading contact...</div>
    <div v-else-if="error && !contact" class="panel p-5 text-sm font-semibold text-legal-red">{{ error }}</div>

    <template v-else-if="contact">
      <PageHeader :eyebrow="'Contact profile'" :title="fullName" :description="headerDescription">
        <div class="flex flex-wrap items-center gap-2">
          <button
            class="btn-secondary h-9 px-3"
            :disabled="!auth.canManageContacts"
            :title="auth.canManageContacts ? 'Edit contact' : t('readonlyNotice')"
            @click="openEdit"
          >
            <Edit3 class="h-4 w-4" />
            Edit
          </button>
          <button
            class="btn-secondary h-9 px-3 text-legal-red hover:border-red-200 hover:bg-red-50"
            :disabled="!auth.canDeleteContacts || deleting"
            :title="auth.canDeleteContacts ? 'Delete contact' : t('readonlyNotice')"
            @click="deleteContact"
          >
            <Trash2 class="h-4 w-4" />
            {{ deleting ? "Deleting..." : "Delete" }}
          </button>
        </div>
      </PageHeader>

      <section class="grid items-start gap-3 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]">
        <div class="space-y-3">
          <div class="panel p-5">
            <h2 class="mb-4 font-semibold">Contact details</h2>
            <dl class="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt class="text-xs uppercase text-ink-500">Organization</dt>
                <dd class="mt-1 font-semibold">
                  <RouterLink
                    v-if="contact.partyOrganizationId"
                    class="text-accent-700 hover:text-accent-900"
                    :to="`/organizations/${contact.partyOrganizationId}`"
                  >
                    {{ contact.partyOrganizationName }}
                  </RouterLink>
                  <span v-else>{{ contact.partyOrganizationName }}</span>
                </dd>
              </div>
              <div>
                <dt class="text-xs uppercase text-ink-500">Title</dt>
                <dd class="mt-1 font-semibold">{{ contact.jobTitle }}</dd>
              </div>
              <div>
                <dt class="text-xs uppercase text-ink-500">Email</dt>
                <dd class="mt-1">
                  <a
                    v-if="contact.email"
                    class="font-semibold text-accent-700 hover:text-accent-900 hover:underline"
                    :href="mailtoHref(contact.email)"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {{ contact.email }}
                  </a>
                  <span v-else class="font-semibold">No email on file</span>
                </dd>
              </div>
              <div>
                <dt class="text-xs uppercase text-ink-500">Phone</dt>
                <dd class="mt-1 font-semibold">{{ contact.phone }}</dd>
              </div>
              <div class="sm:col-span-2">
                <dt class="text-xs uppercase text-ink-500">Address</dt>
                <dd class="mt-1 font-semibold whitespace-pre-line">{{ contact.address }}</dd>
              </div>
              <div>
                <dt class="text-xs uppercase text-ink-500">Updated</dt>
                <dd class="mt-1 font-semibold">{{ formatDateTime(contact.updatedAt) }}</dd>
              </div>
            </dl>

            <div class="mt-5 border-t border-ink-100 pt-5">
              <h3 class="mb-3 text-sm font-semibold">Relationship summary</h3>
              <div class="grid gap-3 sm:grid-cols-3">
                <div class="rounded-md bg-ink-50 p-3">
                  <p class="text-xs uppercase text-ink-500">Related {{ labels.lowerPlural }}</p>
                  <p class="mt-1 text-2xl font-semibold">{{ relatedCases.length }}</p>
                </div>
                <div class="rounded-md bg-ink-50 p-3">
                  <p class="text-xs uppercase text-ink-500">Open {{ labels.lowerPlural }}</p>
                  <p class="mt-1 text-2xl font-semibold">{{ activeCases.length }}</p>
                </div>
                <div class="rounded-md bg-ink-50 p-3">
                  <p class="text-xs uppercase text-ink-500">Roles</p>
                  <p class="mt-1 text-sm font-semibold">{{ roles.join(", ") || `No ${labels.lowerSingular} role yet` }}</p>
                </div>
              </div>
            </div>

            <div class="mt-5 border-t border-ink-100 pt-5">
              <h3 class="mb-2 text-sm font-semibold">Notes</h3>
              <p class="text-sm leading-6 text-ink-700">{{ contact.notes || "No notes saved yet." }}</p>
            </div>
          </div>
        </div>

        <div class="space-y-3">
          <CommunicationHistoryPanel
            :communications="communications"
            title="Communications"
            description="Calls, emails, SMS, notes, and PBX events linked to this contact."
            empty-text="No communications are linked to this contact yet."
            :inbox-link="`/communications?view=all&contactId=${contact.contactId}`"
            :can-manage="auth.canAddNotes"
            log-label="Log communication"
            @log="openContactCommunicationLog"
            @status-change="updateCommunicationStatus"
          />

          <div class="panel p-5">
            <div class="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 class="font-semibold">{{ labels.contactRelationshipTitle }}</h2>
                <p class="text-sm text-ink-500">{{ labels.contactRelationshipDescription }}</p>
              </div>
              <span class="rounded-full bg-accent-50 px-3 py-1 text-sm font-semibold text-accent-800">{{ relatedCases.length }}</span>
            </div>

            <div class="overflow-x-auto rounded-md border border-ink-200">
              <table class="min-w-[820px] w-full text-left text-sm">
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
                  <tr v-for="item in relatedCases" :key="`${item.caseId}-${item.role}`" class="hover:bg-ink-50">
                    <td class="px-5 py-4 font-semibold">
                      <RouterLink class="text-accent-700 hover:text-accent-900" :to="workItemPath(item.caseId)">
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
                  <tr v-if="!relatedCases.length">
                    <td class="px-5 py-6 text-ink-500" colspan="6">No related {{ labels.lowerPlural }} yet.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="panel p-5">
            <h2 class="mb-4 font-semibold">Upcoming {{ labels.lowerPlural }}</h2>
            <div class="space-y-3">
              <RouterLink
                v-for="item in upcomingCases"
                :key="`${item.caseId}-${item.role}-upcoming`"
                class="block rounded-md border border-ink-100 p-3 transition hover:border-accent-300 hover:bg-ink-50"
                :to="workItemPath(item.caseId)"
              >
                <p class="font-semibold text-accent-800">{{ item.case?.caseNumber }} · {{ item.role }}</p>
                <p class="mt-1 text-sm text-ink-700">{{ item.case?.propertyAddress }}</p>
                <p class="mt-1 text-xs text-ink-500">{{ item.case ? formatDate(item.case.closingDate) : "" }}</p>
              </RouterLink>
              <p v-if="!upcomingCases.length" class="text-sm text-ink-500">No upcoming {{ labels.lowerPlural }} tied to this contact.</p>
            </div>
          </div>
        </div>
      </section>
    </template>

    <div v-if="showEdit && contact" class="fixed inset-0 z-50 overflow-y-auto bg-ink-900/45 px-4 py-6">
      <div class="mx-auto max-w-3xl rounded-lg bg-white shadow-soft">
        <div class="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
          <div>
            <h2 class="text-lg font-semibold">Edit contact</h2>
            <p class="mt-1 text-sm text-ink-500">Update reusable party information for future {{ labels.lowerPlural }}.</p>
          </div>
          <button class="btn-secondary h-9 px-3" type="button" @click="showEdit = false">
            <X class="h-4 w-4" />
          </button>
        </div>

        <form class="space-y-5 px-5 py-5" @submit.prevent="saveContact">
          <div class="grid gap-3 md:grid-cols-2">
            <label class="text-sm font-semibold md:col-span-2">
              Name
              <input v-model="editForm.displayName" class="input mt-1" required />
            </label>
            <OrganizationPicker
              v-model="editForm.partyOrganizationId"
              class="md:col-span-2"
              :organizations="partyOrganizations"
              @select="selectOrganization"
              @created="addPartyOrganization"
            />
            <label class="text-sm font-semibold">
              Email <span class="font-normal text-ink-500">(optional)</span>
              <input v-model="editForm.email" class="input mt-1" type="email" placeholder="name@example.com" />
            </label>
            <label class="text-sm font-semibold">
              Phone
              <input v-model="editForm.phone" class="input mt-1" />
            </label>
            <label class="text-sm font-semibold">
              Title
              <input v-model="editForm.jobTitle" class="input mt-1" placeholder="Partner, closer, processor, coordinator" />
            </label>
            <label class="text-sm font-semibold">
              Address
              <input v-model="editForm.address" class="input mt-1" />
            </label>
          </div>

          <label class="block text-sm font-semibold">
            Notes
            <textarea v-model="editForm.notes" class="textarea mt-1" />
          </label>

          <p v-if="error" class="text-sm font-semibold text-legal-red">{{ error }}</p>

          <div class="flex justify-end gap-2 border-t border-ink-200 pt-4">
            <button class="btn-secondary" type="button" :disabled="saving" @click="showEdit = false">Cancel</button>
            <button class="btn-primary" type="submit" :disabled="saving">
              <Save class="h-4 w-4" />
              {{ saving ? "Saving..." : "Save changes" }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
