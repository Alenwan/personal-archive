<script setup lang="ts">
import {
  BriefcaseBusiness,
  Check,
  ChevronDown,
  Edit3,
  HardDrive,
  Link2,
  LockKeyhole,
  Search,
  X
} from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { client } from "../../api/client";
import { formatDate } from "../../shared/format";
import type {
  CaseRecord,
  ManagedAsset,
  ServiceDiscussionAssetLink,
  ServiceDiscussionMessage
} from "../../shared/types";

const props = withDefaults(defineProps<{
  message: ServiceDiscussionMessage;
  assetLinks?: ServiceDiscussionAssetLink[];
  services: CaseRecord[];
  assets: ManagedAsset[];
  editable?: boolean;
  lockService?: boolean;
  threadMessageCount?: number;
  attachmentCount?: number;
}>(), {
  assetLinks: () => [],
  editable: false,
  lockService: false,
  threadMessageCount: 1,
  attachmentCount: 0
});

const emit = defineEmits<{
  saved: [];
  error: [message: string];
  openService: [caseId: string];
  openAsset: [assetId: string];
}>();

const editing = ref(false);
const saving = ref(false);
const selectedCaseId = ref<string | null>(props.message.caseId ?? null);
const selectedAssetIds = ref<string[]>([]);
const serviceQuery = ref("");
const assetQuery = ref("");
const serviceMenuOpen = ref(false);
const assetMenuOpen = ref(false);
const servicePicker = ref<HTMLElement | null>(null);
const assetPicker = ref<HTMLElement | null>(null);

const uniqueAssetLinks = computed(() => {
  const seen = new Set<string>();
  return props.assetLinks.filter((link) => {
    if (seen.has(link.assetId)) return false;
    seen.add(link.assetId);
    return true;
  });
});

const selectedService = computed(() => props.services.find((service) => service.caseId === selectedCaseId.value) ?? null);
const assetRecords = computed(() => new Map(props.assets.map((asset) => [asset.assetId, asset])));
const assetLinkRecords = computed(() => new Map(uniqueAssetLinks.value.map((link) => [link.assetId, link])));
const selectedAssetSet = computed(() => new Set(selectedAssetIds.value));
const recentServices = computed(() => [...props.services].sort((left, right) =>
  right.createdAt.localeCompare(left.createdAt) || right.updatedAt.localeCompare(left.updatedAt)
));
const serviceAssets = computed(() => props.assets
  .filter((asset) => (asset.caseId ?? null) === selectedCaseId.value)
  .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }))
);

const filteredServices = computed(() => {
  const query = serviceQuery.value.trim().toLowerCase();
  return recentServices.value
    .filter((service) => `${service.caseNumber} ${service.propertyAddress} ${service.notes}`.toLowerCase().includes(query))
    .slice(0, 10);
});

const filteredAssets = computed(() => {
  const query = assetQuery.value.trim().toLowerCase();
  return serviceAssets.value
    .filter((asset) =>
      [asset.name, asset.assetType, asset.hostname, asset.lanIp, asset.serialNumber]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
});

const conflictingAssetIds = computed(() => selectedAssetIds.value.filter((assetId) => {
  const caseId = assetRecords.value.get(assetId)?.caseId ?? assetLinkRecords.value.get(assetId)?.caseId ?? null;
  return caseId !== selectedCaseId.value;
}));

const contextKey = computed(() => [
  props.message.caseId ?? "",
  ...uniqueAssetLinks.value.map((link) => link.assetId).sort()
].join(":"));

watch(contextKey, () => {
  if (!editing.value) resetDraft();
}, { immediate: true });

function serviceLabel(service: CaseRecord) {
  return `${service.caseNumber} - ${service.propertyAddress || service.notes || service.status}`;
}

function currentServiceLabel() {
  if (selectedService.value) return serviceLabel(selectedService.value);
  if (props.message.caseNumber) return `${props.message.caseNumber}${props.message.caseTitle ? ` - ${props.message.caseTitle}` : ""}`;
  return "Unlinked service";
}

function assetName(assetId: string) {
  return assetRecords.value.get(assetId)?.name ?? assetLinkRecords.value.get(assetId)?.assetName ?? "Linked asset";
}

function assetDetail(asset: ManagedAsset) {
  return [asset.assetType, asset.hostname, asset.lanIp].filter(Boolean).join(" · ");
}

function resetDraft() {
  selectedCaseId.value = props.message.caseId ?? null;
  selectedAssetIds.value = uniqueAssetLinks.value.map((link) => link.assetId);
  serviceQuery.value = "";
  assetQuery.value = "";
  serviceMenuOpen.value = false;
  assetMenuOpen.value = false;
}

function startEditing() {
  if (!props.editable || saving.value) return;
  resetDraft();
  editing.value = true;
}

function cancelEditing() {
  resetDraft();
  editing.value = false;
}

function chooseService(service: CaseRecord) {
  selectedCaseId.value = service.caseId;
  serviceQuery.value = "";
  assetQuery.value = "";
  serviceMenuOpen.value = false;
  assetMenuOpen.value = false;
}

function clearService() {
  if (props.lockService) return;
  selectedCaseId.value = null;
  serviceQuery.value = "";
  assetQuery.value = "";
  serviceMenuOpen.value = true;
  assetMenuOpen.value = false;
}

function openServiceMenu() {
  if (!saving.value && !props.lockService) serviceMenuOpen.value = true;
}

function closeServiceMenuOnBlur(event: FocusEvent) {
  const nextTarget = event.relatedTarget;
  if (!(nextTarget instanceof Node) || !servicePicker.value?.contains(nextTarget)) {
    serviceMenuOpen.value = false;
  }
}

function openAssetMenu() {
  if (!saving.value && selectedCaseId.value) assetMenuOpen.value = true;
}

function closeAssetMenuOnBlur(event: FocusEvent) {
  const nextTarget = event.relatedTarget;
  if (!(nextTarget instanceof Node) || !assetPicker.value?.contains(nextTarget)) {
    assetMenuOpen.value = false;
  }
}

function toggleAsset(assetId: string) {
  if (selectedAssetSet.value.has(assetId)) {
    removeAsset(assetId);
    return;
  }
  selectedAssetIds.value = [...selectedAssetIds.value, assetId];
}

function removeAsset(assetId: string) {
  selectedAssetIds.value = selectedAssetIds.value.filter((id) => id !== assetId);
}

async function saveContext() {
  if (saving.value || conflictingAssetIds.value.length) return;
  const previousCaseId = props.message.caseId ?? null;
  if (previousCaseId !== selectedCaseId.value) {
    const destination = selectedCaseId.value ? currentServiceLabel() : "an unlinked discussion";
    const confirmed = window.confirm(
      `Move this discussion to ${destination}? ${props.threadMessageCount} message${props.threadMessageCount === 1 ? "" : "s"} and ${props.attachmentCount} attached document${props.attachmentCount === 1 ? "" : "s"} will be updated.`
    );
    if (!confirmed) return;
  }
  saving.value = true;
  try {
    await client.updateDiscussionThreadContext(props.message.messageId, {
      caseId: selectedCaseId.value,
      assetIds: selectedAssetIds.value
    });
    editing.value = false;
    emit("saved");
  } catch (error) {
    emit("error", error instanceof Error ? error.message : "Unable to update linked context");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="mt-3 rounded-md border border-ink-100 bg-ink-50/70 px-3 py-2.5">
    <div v-if="!editing" class="flex min-w-0 flex-wrap items-center gap-2">
      <span class="mr-0.5 shrink-0 text-xs font-semibold uppercase text-ink-500">Linked context</span>
      <button
        v-if="message.caseId && !lockService"
        class="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-accent-900 ring-1 ring-ink-200 transition hover:bg-accent-50 hover:ring-accent-200"
        type="button"
        title="Open linked service"
        @click="emit('openService', message.caseId)"
      >
        <BriefcaseBusiness class="h-3.5 w-3.5 shrink-0" />
        <span class="truncate">Service: {{ currentServiceLabel() }}</span>
      </button>
      <span
        v-else-if="message.caseId"
        class="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-accent-900 ring-1 ring-ink-200"
      >
        <LockKeyhole class="h-3.5 w-3.5 shrink-0 text-ink-400" />
        <span class="truncate">Service: {{ currentServiceLabel() }}</span>
      </span>
      <span v-else class="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900 ring-1 ring-amber-100">
        <BriefcaseBusiness class="h-3.5 w-3.5" />
        Unlinked service
      </span>
      <button
        v-for="link in uniqueAssetLinks"
        :key="link.assetId"
        class="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-accent-900 ring-1 ring-ink-200 transition hover:bg-accent-50 hover:ring-accent-200"
        type="button"
        :title="`Open linked asset · ${link.relationship}`"
        @click="emit('openAsset', link.assetId)"
      >
        <HardDrive class="h-3.5 w-3.5 shrink-0" />
        <span class="truncate">Asset: {{ link.assetName }}</span>
      </button>
      <span v-if="!uniqueAssetLinks.length" class="text-xs text-ink-400">No assets linked</span>
      <button
        v-if="editable"
        class="ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold text-ink-600 transition hover:bg-white hover:text-accent-900"
        type="button"
        title="Manage linked service and assets"
        @click="startEditing"
      >
        <Edit3 class="h-3.5 w-3.5" />
        Manage links
      </button>
    </div>

    <div v-else class="space-y-3">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <Link2 class="h-4 w-4 text-accent-800" />
          <span class="text-sm font-semibold text-ink-900">Linked context</span>
        </div>
        <button class="grid h-8 w-8 place-items-center rounded-md text-ink-500 hover:bg-white hover:text-ink-900" type="button" title="Cancel" :disabled="saving" @click="cancelEditing">
          <X class="h-4 w-4" />
        </button>
      </div>

      <div class="grid items-start gap-3 lg:grid-cols-2">
        <div class="min-w-0 space-y-2">
          <label class="block text-xs font-semibold uppercase text-ink-500">Service</label>

          <div v-if="lockService" class="flex h-10 min-w-0 items-center gap-2 rounded-md border border-ink-200 bg-white px-3">
            <LockKeyhole class="h-4 w-4 shrink-0 text-ink-400" />
            <span class="min-w-0 flex-1 truncate text-sm font-semibold text-ink-800">{{ currentServiceLabel() }}</span>
          </div>

          <div
            v-else
            ref="servicePicker"
            class="relative"
            @focusout="closeServiceMenuOnBlur"
          >
            <Search class="pointer-events-none absolute left-3 top-5 z-10 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              v-model="serviceQuery"
              class="input h-10 pl-9 pr-10 text-sm"
              placeholder="Select or search services"
              :disabled="saving"
              aria-label="Select or search services"
              :aria-expanded="serviceMenuOpen"
              @focus="openServiceMenu"
              @click="openServiceMenu"
              @keydown.esc="serviceMenuOpen = false"
            />
            <button
              class="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded text-ink-500 hover:bg-ink-50 hover:text-ink-900"
              type="button"
              title="Show recent services"
              :disabled="saving"
              @click="serviceMenuOpen = !serviceMenuOpen"
            >
              <ChevronDown class="h-4 w-4 transition" :class="serviceMenuOpen ? 'rotate-180' : ''" />
            </button>

            <div v-if="serviceMenuOpen" class="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-md border border-ink-200 bg-white p-1 shadow-lg">
              <p class="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase text-ink-400">
                {{ serviceQuery.trim() ? "Search results" : "Recently created services" }}
              </p>
              <button
                v-for="service in filteredServices"
                :key="service.caseId"
                class="flex w-full items-start gap-2 rounded px-2.5 py-2 text-left hover:bg-accent-50"
                type="button"
                @click="chooseService(service)"
              >
                <BriefcaseBusiness class="mt-0.5 h-4 w-4 shrink-0 text-accent-800" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-semibold text-ink-800">{{ serviceLabel(service) }}</span>
                  <span class="block text-xs text-ink-500">Created {{ formatDate(service.createdAt) }} · {{ service.status }}</span>
                </span>
                <Check v-if="service.caseId === selectedCaseId" class="mt-0.5 h-4 w-4 shrink-0 text-accent-800" />
              </button>
              <p v-if="!filteredServices.length" class="px-2.5 py-3 text-xs text-ink-500">No matching services.</p>
            </div>
          </div>

          <div v-if="lockService" class="flex min-h-8 items-center">
            <p class="text-xs text-ink-500">Service context is inherited from this page.</p>
          </div>
          <div v-else-if="selectedCaseId" class="flex min-h-8 min-w-0 items-center gap-2 rounded-md border border-ink-200 bg-white px-2.5 py-1.5">
            <BriefcaseBusiness class="h-4 w-4 shrink-0 text-accent-800" />
            <span class="min-w-0 flex-1 truncate text-xs font-semibold text-ink-800">Current: {{ currentServiceLabel() }}</span>
            <button class="grid h-6 w-6 shrink-0 place-items-center rounded text-ink-400 hover:bg-ink-50 hover:text-legal-red" type="button" title="Remove service link" @click="clearService">
              <X class="h-3.5 w-3.5" />
            </button>
          </div>
          <div v-else class="flex min-h-8 items-center">
            <p class="text-xs text-ink-500">No service linked. Choose from recent services or search.</p>
          </div>
        </div>

        <div class="min-w-0 space-y-2">
          <label class="block text-xs font-semibold uppercase text-ink-500">Assets</label>
          <div
            ref="assetPicker"
            class="relative"
            @focusout="closeAssetMenuOnBlur"
          >
            <Search class="pointer-events-none absolute left-3 top-5 z-10 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              v-model="assetQuery"
              class="input h-10 pl-9 pr-10 text-sm"
              :placeholder="selectedCaseId ? 'Select or search assets' : 'Select a service first'"
              :disabled="saving || !selectedCaseId"
              aria-label="Select or search assets"
              :aria-expanded="assetMenuOpen"
              @focus="openAssetMenu"
              @click="openAssetMenu"
              @keydown.esc="assetMenuOpen = false"
            />
            <button
              class="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded text-ink-500 hover:bg-ink-50 hover:text-ink-900 disabled:text-ink-300"
              type="button"
              title="Show assets in this service"
              :disabled="saving || !selectedCaseId"
              @click="assetMenuOpen = !assetMenuOpen"
            >
              <ChevronDown class="h-4 w-4 transition" :class="assetMenuOpen ? 'rotate-180' : ''" />
            </button>
            <div v-if="assetMenuOpen" class="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-md border border-ink-200 bg-white p-1 shadow-lg">
              <p class="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase text-ink-400">
                {{ assetQuery.trim() ? "Search results" : `Assets in this service · ${serviceAssets.length}` }}
              </p>
              <button
                v-for="asset in filteredAssets"
                :key="asset.assetId"
                class="flex w-full items-start gap-2 rounded px-2.5 py-2 text-left hover:bg-accent-50"
                type="button"
                @click="toggleAsset(asset.assetId)"
              >
                <HardDrive class="mt-0.5 h-4 w-4 shrink-0 text-accent-800" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-semibold text-ink-800">{{ asset.name }}</span>
                  <span v-if="assetDetail(asset)" class="block truncate text-xs text-ink-500">{{ assetDetail(asset) }}</span>
                </span>
                <Check v-if="selectedAssetSet.has(asset.assetId)" class="mt-0.5 h-4 w-4 shrink-0 text-accent-800" />
              </button>
              <p v-if="!filteredAssets.length" class="px-2.5 py-3 text-xs text-ink-500">
                {{ assetQuery.trim() ? "No matching assets in this service." : "No assets are available in this service." }}
              </p>
            </div>
          </div>

          <div v-if="selectedAssetIds.length" class="flex min-h-8 flex-wrap items-center gap-1.5">
            <span
              v-for="assetId in selectedAssetIds"
              :key="assetId"
              class="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-xs font-semibold ring-1"
              :class="conflictingAssetIds.includes(assetId) ? 'text-red-800 ring-red-200' : 'text-ink-700 ring-ink-200'"
            >
              <HardDrive class="h-3.5 w-3.5 shrink-0 text-accent-800" />
              <span class="truncate">{{ assetName(assetId) }}</span>
              <button class="grid h-5 w-5 shrink-0 place-items-center rounded text-ink-400 hover:bg-ink-50 hover:text-legal-red" type="button" title="Remove asset link" @click="removeAsset(assetId)">
                <X class="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
          <div v-else class="flex min-h-8 items-center">
            <p class="text-xs text-ink-500">No assets linked to this thread.</p>
          </div>
        </div>
      </div>

      <p v-if="conflictingAssetIds.length" class="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">
        Remove {{ conflictingAssetIds.length }} asset {{ conflictingAssetIds.length === 1 ? "link" : "links" }} that do not belong to the selected service before saving.
      </p>

      <div class="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-2">
        <span class="text-xs text-ink-500">Changes apply to the entire discussion thread and its attachments.</span>
        <div class="flex items-center gap-2">
          <button class="btn-secondary h-8 px-3 text-xs" type="button" :disabled="saving" @click="cancelEditing">Cancel</button>
          <button class="btn-primary h-8 px-3 text-xs" type="button" :disabled="saving || Boolean(conflictingAssetIds.length)" @click="saveContext">
            <Check class="h-3.5 w-3.5" />
            {{ saving ? "Saving..." : "Save links" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
