<script setup lang="ts">
import { Building2, Edit3, Save, Trash2, X } from "lucide-vue-next";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { client } from "../api/client";
import { useBusinessTemplate, workItemPath } from "../businessTemplate";
import Breadcrumbs from "../components/Breadcrumbs.vue";
import CommunicationHistoryPanel from "../components/communications/CommunicationHistoryPanel.vue";
import PageHeader from "../components/PageHeader.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { useI18n } from "../i18n";
import { contactDisplayName, formatCurrency, formatDate, formatDateTime, mailtoHref } from "../shared/format";
import {
  type CaseRecord,
  type CaseContact,
  type CommunicationRecord,
  type CommunicationStatus,
  type Contact,
  type ManagedAsset,
  type PartyOrganization,
  type PartyOrganizationInput
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
const organizationId = computed(() => String(route.params.id));
const organization = ref<PartyOrganization | null>(null);
const contacts = ref<Contact[]>([]);
const directlyRelatedCases = ref<CaseRecord[]>([]);
const contactRelatedCases = ref<CaseContact[]>([]);
const linkedAssets = ref<ManagedAsset[]>([]);
const communications = ref<CommunicationRecord[]>([]);
const loading = ref(true);
const saving = ref(false);
const deleting = ref(false);
const error = ref("");
const showEdit = ref(false);

interface OrganizationServiceRow {
  caseRecord: CaseRecord;
  direct: boolean;
  contactRelations: CaseContact[];
}

const editForm = reactive<PartyOrganizationInput>({
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
  state: "",
  zipCode: "",
  country: "United States",
  notes: ""
});

const breadcrumbs = computed(() => [
  { label: t("organizations"), to: "/organizations" },
  { label: organization.value?.name ?? "Organization", current: true }
]);

const addressLines = computed(() => {
  if (!organization.value) return [];
  return [
    organization.value.addressLine1,
    organization.value.addressLine2,
    [organization.value.city, organization.value.state, organization.value.zipCode].filter(Boolean).join(", "),
    organization.value.country
  ].filter(Boolean);
});

const relatedServices = computed<OrganizationServiceRow[]>(() => {
  const rows = new Map<string, OrganizationServiceRow>();

  for (const caseRecord of directlyRelatedCases.value) {
    rows.set(caseRecord.caseId, {
      caseRecord,
      direct: true,
      contactRelations: []
    });
  }

  for (const relation of contactRelatedCases.value) {
    if (!relation.case) continue;
    const existing = rows.get(relation.caseId);
    if (existing) {
      const duplicate = existing.contactRelations.some(
        (item) => item.contactId === relation.contactId && item.role === relation.role
      );
      if (!duplicate) existing.contactRelations.push(relation);
      continue;
    }
    rows.set(relation.caseId, {
      caseRecord: relation.case,
      direct: relation.case.customerOrganizationId === organizationId.value,
      contactRelations: [relation]
    });
  }

  return [...rows.values()].sort((left, right) => right.caseRecord.updatedAt.localeCompare(left.caseRecord.updatedAt));
});

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [record, contactRows, directCaseRows, contactCaseRows, assetRows, communicationRows] = await Promise.all([
      client.partyOrganization(organizationId.value),
      client.partyOrganizationContacts(organizationId.value),
      client.cases({ customerOrganizationId: organizationId.value, sort: "updated", direction: "desc" }),
      client.partyOrganizationCases(organizationId.value),
      client.assetsPage({ partyOrganizationId: organizationId.value, sort: "updated", direction: "desc" }, { pageSize: 12 }),
      client.communicationsPage({ partyOrganizationId: organizationId.value, sort: "occurred", sortDirection: "desc" }, { pageSize: 12 })
    ]);
    organization.value = record;
    contacts.value = contactRows;
    directlyRelatedCases.value = directCaseRows;
    contactRelatedCases.value = contactCaseRows;
    linkedAssets.value = assetRows.items;
    communications.value = communicationRows.items;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load organization";
  } finally {
    loading.value = false;
  }
}

function openEdit() {
  if (!organization.value) return;
  Object.assign(editForm, {
    name: organization.value.name,
    type: organization.value.type,
    taxIdType: organization.value.taxIdType,
    taxIdValue: organization.value.taxIdValue,
    website: organization.value.website,
    email: organization.value.email,
    phone: organization.value.phone,
    fax: organization.value.fax,
    addressLine1: organization.value.addressLine1,
    addressLine2: organization.value.addressLine2,
    city: organization.value.city,
    state: organization.value.state,
    zipCode: organization.value.zipCode,
    country: organization.value.country,
    notes: organization.value.notes
  });
  error.value = "";
  showEdit.value = true;
}

async function saveOrganization() {
  if (!organization.value) return;
  saving.value = true;
  error.value = "";
  try {
    organization.value = await client.updatePartyOrganization(organization.value.partyOrganizationId, {
      ...editForm,
      name: editForm.name.trim()
    });
    showEdit.value = false;
    toasts.success("Organization saved", `${organization.value.name} was updated.`);
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to save organization";
    toasts.error("Unable to save organization", error.value);
  } finally {
    saving.value = false;
  }
}

async function deleteOrganization() {
  if (!organization.value || !auth.canDeleteOrganizations || deleting.value) return;
  const confirmed = window.confirm(
    `Delete ${organization.value.name}? Contacts and ${labels.value.lowerPlural} will remain, but this organization link will be removed.`
  );
  if (!confirmed) return;
  deleting.value = true;
  error.value = "";
  try {
    await client.deletePartyOrganization(organization.value.partyOrganizationId);
    toasts.success("Organization deleted", `${organization.value.name} was removed from the directory.`);
    await router.push("/organizations");
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to delete organization";
    toasts.error("Unable to delete organization", error.value);
  } finally {
    deleting.value = false;
  }
}

function openContact(contactId: string) {
  void router.push(`/contacts/${contactId}`);
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

function openOrganizationCommunicationLog() {
  if (!organization.value) return;
  const draftId = crypto.randomUUID();
  sessionStorage.setItem(
    `${COMMUNICATION_DRAFT_STORAGE_PREFIX}${draftId}`,
    JSON.stringify({
      caseId: null,
      partyOrganizationId: organization.value.partyOrganizationId,
      contactId: null,
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
      draftNotice: `Prepared for organization ${organization.value.name}. Add notes, choose a contact or service if needed, then save.`
    })
  );
  void router.push(`/communications?draft=${draftId}`);
}

onMounted(load);
watch(organizationId, load);
</script>

<template>
  <div>
    <Breadcrumbs :items="breadcrumbs" />

    <div v-if="loading" class="panel p-5 text-sm text-ink-500">Loading organization...</div>
    <div v-else-if="error && !organization" class="panel p-5 text-sm font-semibold text-legal-red">{{ error }}</div>

    <template v-else-if="organization">
      <PageHeader eyebrow="Organization profile" :title="organization.name" :description="[organization.email, organization.website].filter(Boolean).join(' · ')">
        <div class="flex flex-wrap items-center gap-2">
          <button
            class="btn-secondary h-9 px-3"
            :disabled="!auth.canManageOrganizations"
            :title="auth.canManageOrganizations ? 'Edit organization' : t('readonlyNotice')"
            @click="openEdit"
          >
            <Edit3 class="h-4 w-4" />
            Edit
          </button>
          <button
            class="btn-secondary h-9 px-3 text-legal-red hover:border-red-200 hover:bg-red-50"
            :disabled="!auth.canDeleteOrganizations || deleting"
            :title="auth.canDeleteOrganizations ? 'Delete organization' : t('readonlyNotice')"
            @click="deleteOrganization"
          >
            <Trash2 class="h-4 w-4" />
            {{ deleting ? "Deleting..." : "Delete" }}
          </button>
        </div>
      </PageHeader>

      <section class="grid items-start gap-3 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]">
        <div class="space-y-3">
          <div class="panel p-5">
            <div class="mb-4 flex items-center gap-3">
              <div class="grid h-10 w-10 place-items-center rounded-md bg-accent-50 text-accent-900">
                <Building2 class="h-5 w-5" />
              </div>
              <div>
                <h2 class="font-semibold">Business details</h2>
                <p class="text-sm text-ink-500">Reusable organization profile for contacts and {{ labels.lowerSingular }} relationships.</p>
              </div>
            </div>

            <dl class="grid gap-4 text-sm sm:grid-cols-2">
              <div v-if="organization.taxIdValue">
                <dt class="text-xs uppercase text-ink-500">Tax ID</dt>
                <dd class="mt-1 font-semibold">{{ organization.taxIdValue }}</dd>
              </div>
              <div v-if="organization.email">
                <dt class="text-xs uppercase text-ink-500">Email</dt>
                <dd class="mt-1">
                  <a
                    class="font-semibold text-accent-700 hover:text-accent-900 hover:underline"
                    :href="mailtoHref(organization.email)"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {{ organization.email }}
                  </a>
                </dd>
              </div>
              <div v-if="organization.phone">
                <dt class="text-xs uppercase text-ink-500">Phone</dt>
                <dd class="mt-1 font-semibold">{{ organization.phone }}</dd>
              </div>
              <div v-if="organization.fax">
                <dt class="text-xs uppercase text-ink-500">Fax</dt>
                <dd class="mt-1 font-semibold">{{ organization.fax }}</dd>
              </div>
              <div v-if="organization.website">
                <dt class="text-xs uppercase text-ink-500">Website</dt>
                <dd class="mt-1 font-semibold">{{ organization.website }}</dd>
              </div>
              <div v-if="addressLines.length" class="sm:col-span-2">
                <dt class="text-xs uppercase text-ink-500">Address</dt>
                <dd class="mt-1 whitespace-pre-line font-semibold">{{ addressLines.join("\n") }}</dd>
              </div>
              <div>
                <dt class="text-xs uppercase text-ink-500">Updated</dt>
                <dd class="mt-1 font-semibold">{{ formatDateTime(organization.updatedAt) }}</dd>
              </div>
            </dl>

            <div class="mt-5 border-t border-ink-100 pt-5">
              <h3 class="mb-2 text-sm font-semibold">Notes</h3>
              <p class="text-sm leading-6 text-ink-700">{{ organization.notes || "No notes saved yet." }}</p>
            </div>
          </div>
        </div>

        <div class="space-y-3">
          <CommunicationHistoryPanel
            :communications="communications"
            title="Communications"
            description="Calls, emails, SMS, notes, and PBX events linked to this organization."
            empty-text="No communications are linked to this organization yet."
            :inbox-link="`/communications?view=all&partyOrganizationId=${organization.partyOrganizationId}`"
            :can-manage="auth.canAddNotes"
            log-label="Log communication"
            @log="openOrganizationCommunicationLog"
            @status-change="updateCommunicationStatus"
          />

          <section class="panel p-5">
            <div class="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 class="font-semibold">Associated contacts</h2>
                <p class="text-sm text-ink-500">People currently linked to this organization.</p>
              </div>
              <span class="rounded-full bg-accent-50 px-3 py-1 text-sm font-semibold text-accent-800">{{ contacts.length }}</span>
            </div>
            <div class="overflow-x-auto rounded-md border border-ink-200">
              <table class="min-w-[760px] w-full text-left text-sm">
                <thead class="bg-ink-50 text-xs uppercase text-ink-500">
                  <tr>
                    <th class="px-4 py-3">Contact</th>
                    <th class="px-4 py-3">Title</th>
                    <th class="px-4 py-3">Email</th>
                    <th class="px-4 py-3">Phone</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-ink-100">
                  <tr
                    v-for="contact in contacts"
                    :key="contact.contactId"
                    class="cursor-pointer transition hover:bg-ink-50"
                    tabindex="0"
                    @click="openContact(contact.contactId)"
                    @keydown.enter.prevent="openContact(contact.contactId)"
                    @keydown.space.prevent="openContact(contact.contactId)"
                  >
                    <td class="px-4 py-3 font-semibold text-accent-800">{{ contactDisplayName(contact) }}</td>
                    <td class="px-4 py-3 text-ink-700">{{ contact.jobTitle }}</td>
                    <td class="px-4 py-3">
                      <a
                        v-if="contact.email"
                        class="font-semibold text-accent-700 hover:text-accent-900 hover:underline"
                        :href="mailtoHref(contact.email)"
                        target="_blank"
                        rel="noopener noreferrer"
                        @click.stop
                      >
                        {{ contact.email }}
                      </a>
                    </td>
                    <td class="px-4 py-3 text-ink-700">{{ contact.phone }}</td>
                  </tr>
                  <tr v-if="!contacts.length">
                    <td class="px-4 py-5 text-ink-500" colspan="4">No contacts are linked yet.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="panel p-5">
            <div class="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 class="font-semibold">Managed assets</h2>
                <p class="text-sm text-ink-500">Devices, numbers, accounts, and systems linked directly to this organization.</p>
              </div>
              <span class="rounded-full bg-accent-50 px-3 py-1 text-sm font-semibold text-accent-800">{{ linkedAssets.length }}</span>
            </div>
            <div class="overflow-x-auto rounded-md border border-ink-200">
              <table class="min-w-[840px] w-full text-left text-sm">
                <thead class="bg-ink-50 text-xs uppercase text-ink-500">
                  <tr>
                    <th class="px-4 py-3">Asset</th>
                    <th class="px-4 py-3">Type</th>
                    <th class="px-4 py-3">Status</th>
                    <th class="px-4 py-3">Identifiers</th>
                    <th class="px-4 py-3">Credentials</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-ink-100">
                  <tr
                    v-for="asset in linkedAssets"
                    :key="asset.assetId"
                    class="cursor-pointer transition hover:bg-ink-50"
                    tabindex="0"
                    @click="router.push(`/managed-assets/${asset.assetId}`)"
                    @keydown.enter.prevent="router.push(`/managed-assets/${asset.assetId}`)"
                    @keydown.space.prevent="router.push(`/managed-assets/${asset.assetId}`)"
                  >
                    <td class="px-4 py-3 font-semibold text-accent-800">{{ asset.name }}</td>
                    <td class="px-4 py-3 text-ink-700">{{ asset.assetType }}</td>
                    <td class="px-4 py-3">
                      <StatusBadge :status="asset.status" />
                    </td>
                    <td class="px-4 py-3 text-ink-600">
                      {{ [asset.hostname, asset.lanIp, asset.phoneNumber, asset.serialNumber].filter(Boolean).join(" · ") }}
                    </td>
                    <td class="px-4 py-3 text-ink-700">{{ asset.credentialCount }}</td>
                  </tr>
                  <tr v-if="!linkedAssets.length">
                    <td class="px-4 py-5 text-ink-500" colspan="5">No managed assets are linked yet.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="panel p-5">
            <div class="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 class="font-semibold">{{ labels.relatedTitle }}</h2>
                <p class="text-sm text-ink-500">{{ labels.relatedDescription }}</p>
              </div>
              <span class="rounded-full bg-accent-50 px-3 py-1 text-sm font-semibold text-accent-800">{{ relatedServices.length }}</span>
            </div>
            <div class="overflow-x-auto rounded-md border border-ink-200">
              <table class="min-w-[960px] w-full text-left text-sm">
                <thead class="bg-ink-50 text-xs uppercase text-ink-500">
                  <tr>
                    <th class="px-5 py-3">{{ labels.singular }}</th>
                    <th class="px-5 py-3">Relationship</th>
                    <th class="px-5 py-3">Contacts</th>
                    <th class="px-5 py-3">Status</th>
                    <th class="px-5 py-3">{{ labels.targetDateLabel }}</th>
                    <th v-if="template.showValueField" class="px-5 py-3">{{ labels.valueLabel }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-ink-100">
                  <tr v-for="item in relatedServices" :key="item.caseRecord.caseId" class="hover:bg-ink-50">
                    <td class="px-5 py-4 font-semibold">
                      <RouterLink class="text-accent-700 hover:text-accent-900" :to="workItemPath(item.caseRecord.caseId)">
                        {{ item.caseRecord.caseNumber }}
                      </RouterLink>
                      <p class="text-xs font-normal text-ink-500">{{ item.caseRecord.propertyAddress }}</p>
                    </td>
                    <td class="px-5 py-4">
                      <div class="flex flex-wrap gap-1.5">
                        <span v-if="item.direct" class="rounded-full bg-accent-50 px-2 py-1 text-xs font-semibold text-accent-800">
                          Direct organization
                        </span>
                        <span
                          v-if="item.contactRelations.length"
                          class="rounded-full bg-ink-100 px-2 py-1 text-xs font-semibold text-ink-700"
                        >
                          Via contact
                        </span>
                      </div>
                    </td>
                    <td class="px-5 py-4">
                      <div v-if="item.contactRelations.length" class="space-y-1.5">
                        <div v-for="relation in item.contactRelations" :key="`${relation.contactId}-${relation.role}`" class="flex flex-wrap gap-x-1">
                          <RouterLink
                            class="font-semibold text-accent-700 hover:text-accent-900"
                            :to="`/contacts/${relation.contactId}`"
                          >
                            {{ contactDisplayName(relation.contact) }}
                          </RouterLink>
                          <span class="text-ink-500">· {{ relation.role }}</span>
                        </div>
                      </div>
                      <span v-else class="text-ink-400">—</span>
                    </td>
                    <td class="px-5 py-4">
                      <StatusBadge :status="item.caseRecord.status" />
                    </td>
                    <td class="px-5 py-4">{{ formatDate(item.caseRecord.closingDate) }}</td>
                    <td v-if="template.showValueField" class="px-5 py-4">{{ formatCurrency(item.caseRecord.salePriceCents) }}</td>
                  </tr>
                  <tr v-if="!relatedServices.length">
                    <td class="px-5 py-6 text-ink-500" :colspan="template.showValueField ? 6 : 5">
                      No related {{ labels.lowerPlural }} yet.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </section>
    </template>

    <div v-if="showEdit && organization" class="fixed inset-0 z-50 overflow-y-auto bg-ink-900/45 px-4 py-6">
      <div class="mx-auto max-w-4xl rounded-lg bg-white shadow-soft">
        <div class="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
          <div>
            <h2 class="text-lg font-semibold">Edit organization</h2>
            <p class="mt-1 text-sm text-ink-500">Update reusable business details for linked contacts.</p>
          </div>
          <button class="btn-secondary h-9 px-3" type="button" :disabled="saving" @click="showEdit = false">
            <X class="h-4 w-4" />
          </button>
        </div>

        <form class="space-y-5 px-5 py-5" @submit.prevent="saveOrganization">
          <div class="grid gap-3 md:grid-cols-2">
            <label class="text-sm font-semibold md:col-span-2">
              Organization name
              <input v-model="editForm.name" class="input mt-1" required />
            </label>
            <label class="text-sm font-semibold">
              Email
              <input v-model="editForm.email" class="input mt-1" type="email" />
            </label>
            <label class="text-sm font-semibold">
              Phone
              <input v-model="editForm.phone" class="input mt-1" />
            </label>
            <label class="text-sm font-semibold">
              Website
              <input v-model="editForm.website" class="input mt-1" />
            </label>
            <label class="text-sm font-semibold">
              Fax
              <input v-model="editForm.fax" class="input mt-1" />
            </label>
            <label class="text-sm font-semibold md:col-span-2">
              Tax ID
              <input v-model="editForm.taxIdValue" class="input mt-1" />
            </label>
            <label class="text-sm font-semibold md:col-span-2">
              Address line 1
              <input v-model="editForm.addressLine1" class="input mt-1" />
            </label>
            <label class="text-sm font-semibold md:col-span-2">
              Address line 2
              <input v-model="editForm.addressLine2" class="input mt-1" />
            </label>
            <label class="text-sm font-semibold">
              City
              <input v-model="editForm.city" class="input mt-1" />
            </label>
            <label class="text-sm font-semibold">
              State
              <input v-model="editForm.state" class="input mt-1" />
            </label>
            <label class="text-sm font-semibold">
              ZIP
              <input v-model="editForm.zipCode" class="input mt-1" />
            </label>
            <label class="text-sm font-semibold">
              Country
              <input v-model="editForm.country" class="input mt-1" />
            </label>
          </div>

          <label class="block text-sm font-semibold">
            Notes
            <textarea v-model="editForm.notes" class="textarea mt-1" />
          </label>

          <p v-if="error" class="text-sm font-semibold text-legal-red">{{ error }}</p>

          <div class="flex justify-end gap-2 border-t border-ink-200 pt-4">
            <button class="btn-secondary" type="button" :disabled="saving" @click="showEdit = false">Cancel</button>
            <button class="btn-primary" type="submit" :disabled="saving || !editForm.name.trim()">
              <Save class="h-4 w-4" />
              {{ saving ? "Saving..." : "Save changes" }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
