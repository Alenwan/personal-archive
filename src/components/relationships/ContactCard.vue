<script setup lang="ts">
import { Mail, Phone, UserMinus } from "lucide-vue-next";
import { contactDisplayName, mailtoHref } from "../../shared/format";
import type { Contact, ContactRole } from "../../shared/types";

defineProps<{
  contact: Contact;
  role?: ContactRole;
  removable?: boolean;
  removeDisabled?: boolean;
  removeLabel?: string;
}>();

const emit = defineEmits<{
  openRelated: [];
  remove: [];
}>();

function openRelated() {
  emit("openRelated");
}
</script>

<template>
  <article
    class="panel flex h-full cursor-pointer flex-col p-5 transition hover:border-accent-300 hover:bg-ink-50 focus:outline-none focus:ring-2 focus:ring-accent-200"
    role="button"
    tabindex="0"
    @click="openRelated"
    @keydown.enter.prevent="openRelated"
    @keydown.space.prevent="openRelated"
  >
    <div class="flex-1">
      <div class="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold text-ink-900">{{ contactDisplayName(contact) }}</h2>
          <p v-if="contact.jobTitle" class="text-sm font-semibold text-ink-700">{{ contact.jobTitle }}</p>
          <p v-if="contact.partyOrganizationName" class="text-sm text-ink-500">{{ contact.partyOrganizationName }}</p>
        </div>
        <span v-if="role" class="shrink-0 rounded-full bg-accent-50 px-2.5 py-1 text-xs font-semibold text-accent-800">{{ role }}</span>
      </div>
      <div class="space-y-2 text-sm text-ink-700">
        <p class="flex items-center gap-2">
          <Mail class="h-4 w-4 shrink-0 text-ink-400" />
          <a
            v-if="contact.email"
            class="truncate font-semibold text-accent-700 hover:text-accent-900 hover:underline"
            :href="mailtoHref(contact.email)"
            target="_blank"
            rel="noopener noreferrer"
            @click.stop
          >
            {{ contact.email }}
          </a>
          <span v-else class="truncate">No email on file</span>
        </p>
        <p v-if="contact.phone" class="flex items-center gap-2"><Phone class="h-4 w-4 shrink-0 text-ink-400" /> {{ contact.phone }}</p>
      </div>
      <p v-if="contact.notes" class="mt-4 line-clamp-3 text-sm leading-6 text-ink-500">{{ contact.notes }}</p>
    </div>
    <button
      v-if="removable"
      class="mt-4 inline-flex self-end items-center justify-center gap-2 rounded-md border border-red-200 px-3 py-2 text-sm font-semibold text-legal-red transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
      type="button"
      :disabled="removeDisabled"
      @click.stop="$emit('remove')"
    >
      <UserMinus class="h-4 w-4" />
      {{ removeLabel || "Remove from case" }}
    </button>
  </article>
</template>
