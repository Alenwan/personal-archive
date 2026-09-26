<script setup lang="ts">
import { Building2, Plus, Search, X } from "lucide-vue-next";
import { computed, reactive, ref, watch } from "vue";
import { client } from "../../api/client";
import { type PartyOrganization, type PartyOrganizationInput } from "../../shared/types";

const props = withDefaults(
  defineProps<{
    modelValue?: string | null;
    organizations?: PartyOrganization[];
    label?: string;
    description?: string;
    disabled?: boolean;
    allowCreate?: boolean;
  }>(),
  {
    modelValue: null,
    organizations: () => [],
    label: "Organization",
    description: "Optional. Leave empty for an individual contact.",
    disabled: false,
    allowCreate: true
  }
);

const emit = defineEmits<{
  "update:modelValue": [value: string | null];
  select: [organization: PartyOrganization | null];
  created: [organization: PartyOrganization];
}>();

const search = ref("");
const isOpen = ref(false);
const showCreate = ref(false);
const saving = ref(false);
const createError = ref("");

const createForm = reactive<PartyOrganizationInput>({
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

const selectedOrganization = computed(
  () => props.organizations.find((organization) => organization.partyOrganizationId === props.modelValue) ?? null
);
const searchId = computed(() => `organization-search-${props.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);

const filteredOrganizations = computed(() => {
  const needle = search.value.trim().toLowerCase();
  const sorted = props.organizations.slice().sort((a, b) => a.name.localeCompare(b.name));
  if (!needle) return sorted.slice(0, 6);

  return sorted
    .filter((organization) =>
      [
        organization.name,
        organization.email,
        organization.phone,
        organization.fax,
        organization.website,
        organization.city,
        organization.state
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle)
    )
    .slice(0, 6);
});

const exactNameExists = computed(() => {
  const needle = search.value.trim().toLowerCase();
  return Boolean(needle) && props.organizations.some((organization) => organization.name.toLowerCase() === needle);
});

function organizationLabel(organization: PartyOrganization) {
  return organization.name;
}

function resetCreateForm(name = "") {
  Object.assign(createForm, {
    name,
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
  createError.value = "";
}

function chooseOrganization(organization: PartyOrganization) {
  emit("update:modelValue", organization.partyOrganizationId);
  emit("select", organization);
  search.value = organization.name;
  isOpen.value = false;
}

function chooseNoOrganization() {
  emit("update:modelValue", null);
  emit("select", null);
  search.value = "";
  isOpen.value = false;
}

function openCreate() {
  resetCreateForm(search.value.trim());
  isOpen.value = false;
  showCreate.value = true;
}

function closeCreate() {
  if (!saving.value) showCreate.value = false;
}

async function createOrganization() {
  if (saving.value) return;
  createError.value = "";
  if (!createForm.name.trim()) {
    createError.value = "Organization name is required.";
    return;
  }

  saving.value = true;
  try {
    const organization = await client.createPartyOrganization({
      ...createForm,
      name: createForm.name.trim()
    });
    emit("created", organization);
    chooseOrganization(organization);
    showCreate.value = false;
  } catch (error) {
    createError.value = error instanceof Error ? error.message : "Unable to create organization.";
  } finally {
    saving.value = false;
  }
}

watch(
  selectedOrganization,
  (organization) => {
    if (organization) {
      search.value = organization.name;
    } else {
      search.value = "";
    }
  },
  { immediate: true }
);
</script>

<template>
  <div class="space-y-3">
    <div>
      <label class="text-sm font-semibold" :for="searchId">{{ label }}</label>
      <p class="mt-1 text-xs text-ink-500">{{ description }}</p>
    </div>

    <div class="rounded-md border border-ink-200 bg-white p-3">
      <div class="relative">
        <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input
          :id="searchId"
          v-model="search"
          class="input pl-9"
          :disabled="disabled"
          placeholder="Search or choose organization"
          @focus="isOpen = true"
          @input="isOpen = true"
          @keydown.escape="isOpen = false"
          @blur="isOpen = false"
        />

        <div
          v-if="isOpen && !disabled"
          class="absolute left-0 right-0 top-full z-30 mt-2 max-h-72 overflow-y-auto rounded-md border border-ink-200 bg-white p-2 shadow-soft"
        >
          <button
            v-for="organization in filteredOrganizations"
            :key="organization.partyOrganizationId"
            class="w-full rounded-md px-3 py-2 text-left text-sm transition hover:bg-accent-50"
            :class="modelValue === organization.partyOrganizationId ? 'bg-accent-50 text-accent-900' : 'text-ink-700'"
            type="button"
            @mousedown.prevent
            @click="chooseOrganization(organization)"
          >
            <span class="font-semibold">{{ organization.name }}</span>
            <span v-if="organization.email || organization.phone || organization.website" class="mt-0.5 block text-xs text-ink-500">
              {{ [organization.email, organization.phone, organization.website].filter(Boolean).join(" · ") }}
            </span>
          </button>

          <p v-if="!filteredOrganizations.length" class="px-3 py-3 text-sm text-ink-500">No matching organizations.</p>

          <button
            v-if="allowCreate && !exactNameExists"
            class="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-ink-200 px-3 py-2 text-sm font-semibold transition hover:border-accent-400 hover:bg-accent-50"
            type="button"
            @mousedown.prevent
            @click="openCreate"
          >
            <Plus class="h-4 w-4" />
            {{ search.trim() ? `Create "${search.trim()}"` : "Create new organization" }}
          </button>
        </div>
      </div>

      <div v-if="selectedOrganization" class="mt-3 rounded-md border border-accent-300 bg-accent-50 px-3 py-2 text-sm">
        <p class="font-semibold text-accent-900">{{ organizationLabel(selectedOrganization) }}</p>
        <button class="mt-1 text-xs font-semibold text-accent-800 hover:text-accent-950" type="button" :disabled="disabled" @click="chooseNoOrganization">
          Clear organization
        </button>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="showCreate" class="fixed inset-0 z-[70] overflow-y-auto bg-ink-900/45 px-4 py-6">
        <div class="mx-auto max-w-3xl rounded-lg bg-white shadow-soft">
          <div class="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
            <div>
              <p class="text-xs font-semibold uppercase tracking-wide text-accent-800">Quick organization</p>
              <h2 class="mt-1 text-lg font-semibold">Create organization</h2>
              <p class="mt-1 text-sm text-ink-500">Add a reusable organization for this contact.</p>
            </div>
            <button class="btn-secondary h-9 px-3" type="button" :disabled="saving" @click="closeCreate">
              <X class="h-4 w-4" />
            </button>
          </div>

          <form class="space-y-5 px-5 py-5" @submit.prevent="createOrganization">
            <div class="grid gap-3 md:grid-cols-2">
              <label class="text-sm font-semibold md:col-span-2">
                Organization name
                <input v-model="createForm.name" class="input mt-1" required />
              </label>
              <label class="text-sm font-semibold">
                Email
                <input v-model="createForm.email" class="input mt-1" type="email" />
              </label>
              <label class="text-sm font-semibold">
                Phone
                <input v-model="createForm.phone" class="input mt-1" />
              </label>
              <label class="text-sm font-semibold">
                Website
                <input v-model="createForm.website" class="input mt-1" placeholder="example.com" />
              </label>
              <label class="text-sm font-semibold">
                Fax
                <input v-model="createForm.fax" class="input mt-1" />
              </label>
              <label class="text-sm font-semibold md:col-span-2">
                Tax ID
                <input v-model="createForm.taxIdValue" class="input mt-1" />
              </label>
            </div>

            <label class="block text-sm font-semibold">
              Notes
              <textarea v-model="createForm.notes" class="textarea mt-1" placeholder="Optional office notes, preferred contact path, or billing reference." />
            </label>

            <p v-if="createError" class="text-sm font-semibold text-legal-red">{{ createError }}</p>

            <div class="flex justify-end gap-2 border-t border-ink-200 pt-4">
              <button class="btn-secondary" type="button" :disabled="saving" @click="closeCreate">Cancel</button>
              <button class="btn-primary" type="submit" :disabled="saving">
                <Building2 class="h-4 w-4" />
                {{ saving ? "Creating..." : "Create and select" }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>
