<script setup lang="ts">
import { X } from "lucide-vue-next";
import { computed, reactive, ref, watch } from "vue";
import { useBusinessTemplate } from "../../businessTemplate";
import { contactDisplayName } from "../../shared/format";
import { type Contact, type ContactInput, type ContactRole, type PartyOrganization } from "../../shared/types";
import OrganizationPicker from "./OrganizationPicker.vue";

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    title?: string;
    description?: string;
    submitLabel?: string;
    saving?: boolean;
    error?: string;
    showRole?: boolean;
    initialRole?: ContactRole;
    initialContact?: Contact | null;
    partyOrganizations?: PartyOrganization[];
  }>(),
  {
    title: "New contact",
    description: "Add a reusable contact for future work records.",
    submitLabel: "Create contact",
    saving: false,
    error: "",
    showRole: false,
    initialRole: "Other",
    initialContact: null,
    partyOrganizations: () => []
  }
);

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  submit: [payload: { contact: ContactInput; role?: ContactRole }];
  organizationCreated: [organization: PartyOrganization];
}>();

const { template, labels } = useBusinessTemplate();
const contactRoleOptions = computed(() => template.value.contactRoleOptions);
const defaultContactRole = () => contactRoleOptions.value[0] ?? "Other";

const form = reactive<ContactInput>({
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
const role = ref<ContactRole>(contactRoleOptions.value.includes(props.initialRole) ? props.initialRole : defaultContactRole());

function resetForm() {
  const contact = props.initialContact;
  Object.assign(
    form,
    contact
      ? {
          displayName: contactDisplayName(contact),
          firstName: contact.firstName,
          lastName: "",
          partyOrganizationId: contact.partyOrganizationId ?? null,
          jobTitle: contact.jobTitle,
          email: contact.email,
          phone: contact.phone,
          address: contact.address,
          notes: contact.notes
        }
      : {
          displayName: "",
          firstName: "",
          lastName: "",
          partyOrganizationId: null,
          jobTitle: "",
          email: "",
          phone: "",
          address: "",
          notes: ""
        }
  );
  role.value = contactRoleOptions.value.includes(props.initialRole) ? props.initialRole : defaultContactRole();
}

function selectOrganization(organization: PartyOrganization | null) {
  form.partyOrganizationId = organization?.partyOrganizationId ?? null;
}

function handleOrganizationCreated(organization: PartyOrganization) {
  emit("organizationCreated", organization);
  selectOrganization(organization);
}

function close() {
  if (!props.saving) emit("update:modelValue", false);
}

function submit() {
  const displayName = form.displayName.trim();
  emit("submit", {
    contact: { ...form, displayName, firstName: displayName, lastName: "" },
    role: props.showRole ? role.value : undefined
  });
}

watch(
  () => props.modelValue,
  (isOpen) => {
    if (isOpen) resetForm();
  }
);

watch(
  () => props.initialRole,
  (nextRole) => {
    if (props.modelValue) role.value = contactRoleOptions.value.includes(nextRole) ? nextRole : defaultContactRole();
  }
);

watch(contactRoleOptions, (roles) => {
  if (!roles.includes(role.value)) role.value = roles[0] ?? "Other";
});

watch(
  () => props.initialContact?.contactId,
  () => {
    if (props.modelValue) resetForm();
  }
);
</script>

<template>
  <div v-if="modelValue" class="fixed inset-0 z-50 overflow-y-auto bg-ink-900/45 px-4 py-6">
    <div class="mx-auto max-w-3xl rounded-lg bg-white shadow-soft">
      <div class="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
        <div>
          <h2 class="text-lg font-semibold">{{ title }}</h2>
          <p class="mt-1 text-sm text-ink-500">{{ description }}</p>
        </div>
        <button class="btn-secondary h-9 px-3" type="button" @click="close">
          <X class="h-4 w-4" />
        </button>
      </div>

      <form class="space-y-5 px-5 py-5" @submit.prevent="submit">
        <label v-if="showRole" class="block text-sm font-semibold">
          Party role in this {{ labels.lowerSingular }}
          <select v-model="role" class="input mt-1">
            <option v-for="item in contactRoleOptions" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>

        <div class="grid gap-3 md:grid-cols-2">
          <label class="text-sm font-semibold md:col-span-2">
            Name
            <input v-model="form.displayName" class="input mt-1" required />
          </label>
          <OrganizationPicker
            v-model="form.partyOrganizationId"
            class="md:col-span-2"
            :organizations="partyOrganizations"
            @select="selectOrganization"
            @created="handleOrganizationCreated"
          />
          <label class="text-sm font-semibold">
            Email <span class="font-normal text-ink-500">(optional)</span>
            <input v-model="form.email" class="input mt-1" type="email" placeholder="name@example.com" />
          </label>
          <label class="text-sm font-semibold">
            Phone
            <input v-model="form.phone" class="input mt-1" />
          </label>
          <label class="text-sm font-semibold">
            Title
            <input v-model="form.jobTitle" class="input mt-1" placeholder="Partner, closer, processor, coordinator" />
          </label>
          <label class="text-sm font-semibold">
            Address
            <input v-model="form.address" class="input mt-1" />
          </label>
        </div>

        <label class="block text-sm font-semibold">
          Notes
          <textarea
            v-model="form.notes"
            class="textarea mt-1"
            placeholder="Communication preference, language needs, representation notes, or office instructions."
          />
        </label>

        <p v-if="error" class="text-sm font-semibold text-legal-red">{{ error }}</p>

        <div class="flex justify-end gap-2 border-t border-ink-200 pt-4">
          <button class="btn-secondary" type="button" :disabled="saving" @click="close">Cancel</button>
          <button class="btn-primary" type="submit" :disabled="saving">{{ saving ? "Saving..." : submitLabel }}</button>
        </div>
      </form>
    </div>
  </div>
</template>
