<script setup lang="ts">
import { ArrowDown, ArrowUp, ArrowUpDown, ArrowUpRight, BookOpen, MoreHorizontal, Plus, RefreshCw, RotateCcw, Search, SlidersHorizontal, Trash2, X } from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { client } from "../api/client";
import ArchiveManagementAccess from "../components/documents/ArchiveManagementAccess.vue";
import { useArchiveContentManagement } from "../composables/useArchiveContentManagement";
import Breadcrumbs from "../components/Breadcrumbs.vue";
import { useDismissibleMenus } from "../composables/useDismissibleMenus";
import KnowledgeEditor from "../components/knowledge/KnowledgeEditor.vue";
import PageHeader from "../components/PageHeader.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { useBusinessTemplate, workItemPath } from "../businessTemplate";
import { useAuthStore } from "../stores/auth";
import { useToastStore } from "../stores/toasts";
import {
  KNOWLEDGE_STATUSES,
  KNOWLEDGE_TYPES,
  type CaseRecord,
  type DocumentRecord,
  type KnowledgeInput,
  type KnowledgeItem,
  type KnowledgeSortField,
  type ManagedAsset,
  type PaginatedResult
} from "../shared/types";
import { formatDate, formatDateTime } from "../shared/format";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const toasts = useToastStore();
const { template } = useBusinessTemplate();
useDismissibleMenus();

const KNOWLEDGE_SORT_STORAGE_KEY = "personal-archive.knowledge.sort";
const KNOWLEDGE_SORT_FIELDS: readonly KnowledgeSortField[] = ["updated", "title", "type", "status"];
const KNOWLEDGE_SORT_LABELS: Record<KnowledgeSortField, string> = {
  updated: "Last updated",
  title: "Title",
  type: "Type",
  status: "Status",
  component: "Component",
  verified: "Last verified"
};
const storedKnowledgeSort = localStorage.getItem(KNOWLEDGE_SORT_STORAGE_KEY) ?? "";
const [storedKnowledgeSortField, storedKnowledgeSortDirection] = storedKnowledgeSort.split("_");
const initialKnowledgeSort = KNOWLEDGE_SORT_FIELDS.includes(storedKnowledgeSortField as KnowledgeSortField)
  && (storedKnowledgeSortDirection === "asc" || storedKnowledgeSortDirection === "desc")
  ? storedKnowledgeSort
  : "updated_desc";

const q = ref("");
const typeFilter = ref("");
const statusFilter = ref("");
const componentFilter = ref("");
const sortOption = ref(initialKnowledgeSort);
const page = ref(1);
const pageSize = 25;
const loading = ref(false);
const saving = ref(false);
const showCreate = ref(false);
const error = ref("");
const mutatingKnowledgeId = ref("");
const contextMenu = ref<{ knowledgeId: string; x: number; y: number } | null>(null);
const result = ref<PaginatedResult<KnowledgeItem> | null>(null);
const services = ref<CaseRecord[]>([]);
const assets = ref<ManagedAsset[]>([]);
const documents = ref<DocumentRecord[]>([]);

const sourceServiceId = computed(() => (typeof route.query.sourceServiceId === "string" ? route.query.sourceServiceId : ""));
const trashView = computed(() => template.value.personalArchive && route.query.view === "trash");
const items = computed(() => result.value?.items ?? []);
const contextItem = computed(() => items.value.find((item) => item.knowledgeId === contextMenu.value?.knowledgeId) ?? null);
const total = computed(() => result.value?.total ?? 0);
const totalPages = computed(() => result.value?.totalPages ?? 1);
const breadcrumbs = computed(() => [{ label: "Knowledge", current: true }]);
const hasFilters = computed(() => Boolean(q.value || typeFilter.value || statusFilter.value || componentFilter.value));
const knowledgeFilterCount = computed(() => [typeFilter.value, statusFilter.value].filter(Boolean).length);
const knowledgeSortParts = computed(() => {
  const [field, direction] = sortOption.value.split("_");
  return {
    field: (field || "updated") as KnowledgeSortField,
    direction: (direction === "asc" ? "asc" : "desc") as "asc" | "desc"
  };
});
const knowledgeSortDirectionLabel = computed(() => knowledgeSortParts.value.field === "updated"
  ? knowledgeSortParts.value.direction === "asc" ? "Oldest first" : "Newest first"
  : knowledgeSortParts.value.direction === "asc" ? "A–Z" : "Z–A");
const knowledgeSortIcon = computed(() => knowledgeSortParts.value.direction === "asc" ? ArrowUp : ArrowDown);
const { canManageContent, setManagementExpiry } = useArchiveContentManagement();
const canManageKnowledge = (item: KnowledgeItem) => auth.canEditCases && canManageContent(item.managementOwnerUserId);

function serviceLabel(id: string | null | undefined) {
  if (!id) return "";
  const service = services.value.find((item) => item.caseId === id);
  return service ? `${service.caseNumber} - ${service.propertyAddress}` : "";
}

function knowledgeTypeLabel(type: string) {
  if (!template.value.personalArchive) return type;
  return ({
    Runbook: "Checklist",
    Troubleshooting: "Problem note",
    "Install guide": "Guide",
    "Configuration note": "Reference note",
    "Service lesson": "Reading note",
    Reference: "Reference"
  } as Record<string, string>)[type] ?? type;
}

async function loadOptions() {
  if (template.value.personalArchive) {
    const documentPage = await client.documentsPage({ sort: "uploaded", direction: "desc" }, { pageSize: 100 });
    services.value = [];
    assets.value = [];
    documents.value = documentPage.items;
    return;
  }
  const [servicePage, assetPage, documentPage] = await Promise.all([
    client.casesPage({ sort: "updated", direction: "desc" }, { pageSize: 100 }),
    client.assetsPage({ sort: "updated", direction: "desc" }, { pageSize: 100 }),
    client.documentsPage({ sort: "uploaded", direction: "desc" }, { pageSize: 100 })
  ]);
  services.value = servicePage.items;
  assets.value = assetPage.items;
  documents.value = documentPage.items;
}

function setKnowledgeSortField(event: Event) {
  const field = (event.target as HTMLSelectElement).value as KnowledgeSortField;
  if (!KNOWLEDGE_SORT_FIELDS.includes(field)) return;
  const defaultDirection = field === "updated" ? "desc" : "asc";
  const direction = knowledgeSortParts.value.field === field ? knowledgeSortParts.value.direction : defaultDirection;
  sortOption.value = `${field}_${direction}`;
}

function toggleKnowledgeSortDirection() {
  const { field, direction } = knowledgeSortParts.value;
  sortOption.value = `${field}_${direction === "asc" ? "desc" : "asc"}`;
}

function sortKnowledgeFromColumn(field: KnowledgeSortField) {
  if (knowledgeSortParts.value.field === field) {
    toggleKnowledgeSortDirection();
    return;
  }
  sortOption.value = `${field}_${field === "updated" ? "desc" : "asc"}`;
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    result.value = await client.knowledgePage(
      {
        q: q.value.trim(),
        type: typeFilter.value as never,
        status: statusFilter.value as never,
        component: componentFilter.value.trim(),
        trashed: trashView.value || undefined,
        sort: knowledgeSortParts.value.field,
        direction: knowledgeSortParts.value.direction
      },
      { page: page.value, pageSize }
    );
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load knowledge";
  } finally {
    loading.value = false;
  }
}

function resetFilters() {
  q.value = "";
  typeFilter.value = "";
  statusFilter.value = "";
  componentFilter.value = "";
  page.value = 1;
}

async function createKnowledge(input: KnowledgeInput) {
  saving.value = true;
  error.value = "";
  try {
    const created = await client.createKnowledge(input);
    toasts.success("Knowledge saved", created.title);
    showCreate.value = false;
    await router.replace({ path: "/knowledge" });
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to save knowledge";
    toasts.error("Unable to save knowledge", error.value);
  } finally {
    saving.value = false;
  }
}

function openItem(item: KnowledgeItem) {
  if (trashView.value) return;
  void router.push(`/knowledge/${item.knowledgeId}`);
}

async function setTrashView(enabled: boolean) {
  contextMenu.value = null;
  showCreate.value = false;
  const query = { ...route.query };
  if (enabled) query.view = "trash";
  else delete query.view;
  await router.replace({ path: "/knowledge", query });
}

function closeContextMenu() {
  contextMenu.value = null;
}

function onWindowKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") closeContextMenu();
}

function openRowMenu(event: MouseEvent, item: KnowledgeItem) {
  const anchor = event.currentTarget as HTMLElement;
  const rect = anchor.getBoundingClientRect();
  const menuWidth = 208;
  const menuHeight = trashView.value ? 92 : 50;
  const requestedX = event.type === "contextmenu" ? event.clientX : rect.right - menuWidth;
  const requestedY = event.type === "contextmenu" ? event.clientY : rect.bottom + 6;
  const y = requestedY + menuHeight > window.innerHeight
    ? Math.max(8, rect.top - menuHeight - 6)
    : Math.max(8, requestedY);
  contextMenu.value = {
    knowledgeId: item.knowledgeId,
    x: Math.max(8, Math.min(requestedX, window.innerWidth - menuWidth - 8)),
    y
  };
}

async function reloadAfterRemoval() {
  if (items.value.length === 1 && page.value > 1) {
    page.value -= 1;
    return;
  }
  await load();
}

async function moveToTrash(item: KnowledgeItem) {
  closeContextMenu();
  if (!canManageKnowledge(item) || !window.confirm(`Move “${item.title}” to Knowledge trash?`)) return;
  mutatingKnowledgeId.value = item.knowledgeId;
  error.value = "";
  try {
    await client.deleteKnowledge(item.knowledgeId);
    toasts.success("Moved to Knowledge trash", item.title);
    await reloadAfterRemoval();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to move knowledge to trash";
    toasts.error("Knowledge not moved", error.value);
  } finally {
    mutatingKnowledgeId.value = "";
  }
}

async function restoreItem(item: KnowledgeItem) {
  closeContextMenu();
  if (!canManageKnowledge(item)) return;
  mutatingKnowledgeId.value = item.knowledgeId;
  error.value = "";
  try {
    await client.restoreKnowledge(item.knowledgeId);
    toasts.success("Knowledge restored", item.title);
    await reloadAfterRemoval();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to restore knowledge";
    toasts.error("Knowledge not restored", error.value);
  } finally {
    mutatingKnowledgeId.value = "";
  }
}

async function permanentlyDeleteItem(item: KnowledgeItem) {
  closeContextMenu();
  if (!canManageKnowledge(item) || !window.confirm(`Permanently delete “${item.title}”? This cannot be undone.`)) return;
  mutatingKnowledgeId.value = item.knowledgeId;
  error.value = "";
  try {
    await client.purgeKnowledge(item.knowledgeId);
    toasts.success("Knowledge permanently deleted", item.title);
    await reloadAfterRemoval();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to permanently delete knowledge";
    toasts.error("Knowledge not deleted", error.value);
  } finally {
    mutatingKnowledgeId.value = "";
  }
}

function nextPage() {
  if (page.value >= totalPages.value) return;
  page.value += 1;
}

function previousPage() {
  if (page.value <= 1) return;
  page.value -= 1;
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(sortOption, (value) => {
  if (template.value.personalArchive) localStorage.setItem(KNOWLEDGE_SORT_STORAGE_KEY, value);
});
watch([q, typeFilter, statusFilter, componentFilter, sortOption], () => {
  page.value = 1;
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 200);
});
watch(page, load);
watch(trashView, () => {
  contextMenu.value = null;
  showCreate.value = false;
  if (page.value !== 1) {
    page.value = 1;
    return;
  }
  void load();
});

onMounted(async () => {
  window.addEventListener("click", closeContextMenu);
  window.addEventListener("keydown", onWindowKeydown, true);
  await loadOptions();
  if (sourceServiceId.value && !trashView.value) showCreate.value = true;
  await load();
});

onBeforeUnmount(() => {
  window.removeEventListener("click", closeContextMenu);
  window.removeEventListener("keydown", onWindowKeydown, true);
  if (searchTimer) clearTimeout(searchTimer);
});
</script>

<template>
  <div>
    <Breadcrumbs v-if="!template.personalArchive" :items="breadcrumbs" />
    <PageHeader
      :class="template.personalArchive ? 'personal-compact-page-header' : ''"
      :eyebrow="template.personalArchive ? 'Reading workspace' : 'MD3 Operations'"
      :title="trashView ? 'Knowledge trash' : 'Knowledge'"
      :description="template.personalArchive
        ? trashView
          ? 'Restore notes or permanently remove them.'
          : 'Structured notes with Markdown outlines.'
        : 'Reusable runbooks, troubleshooting notes, install guides, configuration notes, service lessons, and reference material.'"
    >
      <div class="personal-page-actions">
        <template v-if="template.personalArchive">
          <details class="personal-action-menu" data-dismissible-menu>
            <summary class="btn-secondary flex h-8 cursor-pointer list-none items-center px-2.5 text-xs">
              <Search class="h-3.5 w-3.5" /> Search
              <span v-if="q" class="h-1.5 w-1.5 rounded-full bg-accent-700" aria-label="Search active" />
            </summary>
            <div class="personal-action-panel">
              <p class="personal-action-panel-heading">Search knowledge</p>
              <label class="relative block">
                <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <input v-model="q" class="input h-9 pl-9 pr-9 text-sm" placeholder="Title, body, or keywords..." />
                <button v-if="q" class="absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-ink-400 hover:bg-ink-50 hover:text-ink-900" type="button" title="Clear search" @click="q = ''"><X class="h-3.5 w-3.5" /></button>
              </label>
            </div>
          </details>

          <details class="personal-action-menu" data-dismissible-menu>
            <summary class="btn-secondary flex h-8 cursor-pointer list-none items-center px-2.5 text-xs">
              <SlidersHorizontal class="h-3.5 w-3.5" /> Filters
              <span v-if="knowledgeFilterCount" class="personal-action-count">{{ knowledgeFilterCount }}</span>
            </summary>
            <div class="personal-action-panel">
              <p class="personal-action-panel-heading">Filter knowledge</p>
              <div class="grid gap-2">
                <select v-model="typeFilter" class="input h-9 py-1.5 text-sm">
                  <option value="">All types</option>
                  <option v-for="type in KNOWLEDGE_TYPES" :key="type" :value="type">{{ knowledgeTypeLabel(type) }}</option>
                </select>
                <select v-model="statusFilter" class="input h-9 py-1.5 text-sm">
                  <option value="">All statuses</option>
                  <option v-for="status in KNOWLEDGE_STATUSES" :key="status" :value="status">{{ status }}</option>
                </select>
              </div>
              <div class="mt-3 flex justify-end gap-2 border-t border-ink-100 pt-3">
                <button class="btn-secondary h-8 px-2.5 text-xs" type="button" :disabled="loading" @click="load"><RefreshCw class="h-3.5 w-3.5" /> Refresh</button>
                <button class="btn-secondary h-8 px-2.5 text-xs" type="button" :disabled="!hasFilters" @click="resetFilters"><X class="h-3.5 w-3.5" /> Clear</button>
              </div>
            </div>
          </details>

          <details class="personal-action-menu" data-dismissible-menu>
            <summary class="btn-secondary flex h-8 cursor-pointer list-none items-center px-2.5 text-xs">
              <component :is="knowledgeSortIcon" class="h-3.5 w-3.5" /> Sort
            </summary>
            <div class="personal-action-panel">
              <p class="personal-action-panel-heading">Sort knowledge</p>
              <div class="flex gap-1.5">
                <select class="input h-9 min-w-0 flex-1 py-1.5 text-sm" :value="knowledgeSortParts.field" aria-label="Sort knowledge by" @change="setKnowledgeSortField">
                  <option v-for="field in KNOWLEDGE_SORT_FIELDS" :key="field" :value="field">{{ KNOWLEDGE_SORT_LABELS[field] }}</option>
                </select>
                <button class="btn-secondary h-9 shrink-0 px-2.5 text-xs" type="button" :title="`Reverse order. Currently ${knowledgeSortDirectionLabel}.`" @click="toggleKnowledgeSortDirection">
                  <component :is="knowledgeSortIcon" class="h-3.5 w-3.5" /> {{ knowledgeSortDirectionLabel }}
                </button>
              </div>
            </div>
          </details>
        </template>
        <button
          v-if="template.personalArchive"
          class="btn-secondary h-8 px-2.5 text-xs"
          type="button"
          @click="setTrashView(!trashView)"
        >
          <BookOpen v-if="trashView" class="h-3.5 w-3.5" />
          <Trash2 v-else class="h-3.5 w-3.5" />
          {{ trashView ? "Back to Knowledge" : "Trash" }}
        </button>
        <ArchiveManagementAccess v-if="template.personalArchive && auth.user?.role === 'Admin'" @change="setManagementExpiry" />
        <button v-if="!trashView" class="btn-primary px-3" :class="template.personalArchive ? 'h-8 text-xs' : 'h-10'" type="button" :disabled="!auth.canAddNotes" @click="showCreate = true">
          <Plus :class="template.personalArchive ? 'h-3.5 w-3.5' : 'h-4 w-4'" />
          New knowledge
        </button>
      </div>
    </PageHeader>

    <section v-if="showCreate" class="panel mb-4 p-4">
      <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="font-semibold">New knowledge</h2>
          <p v-if="sourceServiceId" class="mt-1 text-sm text-ink-500">
            Linked to {{ serviceLabel(sourceServiceId) || "the selected service" }}.
          </p>
        </div>
        <button class="btn-secondary h-9 px-3" type="button" @click="showCreate = false">
          <X class="h-4 w-4" />
          Close
        </button>
      </div>
      <KnowledgeEditor
        :services="services"
        :assets="assets"
        :documents="documents"
        :default-source-service-id="sourceServiceId"
        :saving="saving"
        :personal-mode="template.personalArchive"
        :submit-label="template.personalArchive ? 'Create note' : 'Create knowledge'"
        @save="createKnowledge"
      />
    </section>

    <section v-if="!template.personalArchive" class="panel mb-4 p-3">
      <div
        class="grid gap-2"
        :class="template.personalArchive
          ? 'xl:grid-cols-[minmax(300px,1fr)_180px_180px_auto]'
          : 'xl:grid-cols-[minmax(260px,1fr)_180px_180px_180px_auto]'"
      >
        <label class="relative block">
          <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            v-model="q"
            class="input pl-9"
            :placeholder="template.personalArchive ? 'Search title, body, or keywords...' : 'Search title, body, keywords, linked service...'"
          />
        </label>
        <select v-model="typeFilter" class="input">
          <option value="">All types</option>
          <option v-for="type in KNOWLEDGE_TYPES" :key="type" :value="type">{{ knowledgeTypeLabel(type) }}</option>
        </select>
        <select v-model="statusFilter" class="input">
          <option value="">All statuses</option>
          <option v-for="status in KNOWLEDGE_STATUSES" :key="status" :value="status">{{ status }}</option>
        </select>
        <input v-if="!template.personalArchive" v-model="componentFilter" class="input" placeholder="Component" />
        <button class="btn-secondary h-10 px-3" type="button" :disabled="loading" @click="hasFilters ? resetFilters() : load()">
          <RefreshCw v-if="!hasFilters" class="h-4 w-4" />
          <X v-else class="h-4 w-4" />
          {{ hasFilters ? "Clear" : "Refresh" }}
        </button>
      </div>
      <p v-if="error" class="mt-2 text-sm font-semibold text-legal-red">{{ error }}</p>
    </section>

    <p v-if="template.personalArchive && error" class="mb-3 text-sm font-semibold text-legal-red">{{ error }}</p>

    <section class="panel overflow-hidden">
      <div class="flex items-center justify-between border-b border-ink-100 px-4 py-3">
        <div class="flex items-center gap-2">
          <Trash2 v-if="trashView" class="h-4 w-4 text-ink-500" />
          <p class="text-sm font-semibold">
            {{ total }} {{ total === 1 ? "knowledge item" : "knowledge items" }}{{ trashView ? " in trash" : "" }}
          </p>
        </div>
        <p class="text-xs text-ink-500">Page {{ result?.page ?? 1 }} of {{ totalPages }}</p>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm" :class="template.personalArchive ? 'min-w-[760px]' : 'min-w-[980px]'">
          <thead class="bg-ink-50 text-xs uppercase text-ink-500">
            <tr>
              <th class="px-4 py-3">
                <button v-if="template.personalArchive" class="inline-flex items-center gap-1 hover:text-accent-900" type="button" title="Sort by title" @click="sortKnowledgeFromColumn('title')">Title <component :is="knowledgeSortParts.field === 'title' ? knowledgeSortIcon : ArrowUpDown" class="h-3.5 w-3.5" /></button>
                <span v-else>Title</span>
              </th>
              <th class="px-4 py-3">
                <button v-if="template.personalArchive" class="inline-flex items-center gap-1 hover:text-accent-900" type="button" title="Sort by type" @click="sortKnowledgeFromColumn('type')">Type <component :is="knowledgeSortParts.field === 'type' ? knowledgeSortIcon : ArrowUpDown" class="h-3.5 w-3.5" /></button>
                <span v-else>Type</span>
              </th>
              <th class="px-4 py-3">
                <button v-if="template.personalArchive" class="inline-flex items-center gap-1 hover:text-accent-900" type="button" title="Sort by status" @click="sortKnowledgeFromColumn('status')">Status <component :is="knowledgeSortParts.field === 'status' ? knowledgeSortIcon : ArrowUpDown" class="h-3.5 w-3.5" /></button>
                <span v-else>Status</span>
              </th>
              <th v-if="!template.personalArchive" class="px-4 py-3">Component</th>
              <th v-if="!template.personalArchive" class="px-4 py-3">Linked service</th>
              <th class="px-4 py-3">
                <button v-if="template.personalArchive && !trashView" class="inline-flex items-center gap-1 hover:text-accent-900" type="button" title="Sort by update date" @click="sortKnowledgeFromColumn('updated')">Updated <component :is="knowledgeSortParts.field === 'updated' ? knowledgeSortIcon : ArrowUpDown" class="h-3.5 w-3.5" /></button>
                <span v-else>{{ trashView ? "Deleted" : "Updated" }}</span>
              </th>
              <th v-if="template.personalArchive" class="w-14 px-3 py-3"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-ink-100">
            <tr
              v-for="item in items"
              :key="item.knowledgeId"
              class="transition hover:bg-ink-50"
              :class="trashView ? 'cursor-default' : 'cursor-pointer'"
              :tabindex="trashView ? undefined : 0"
              @click="openItem(item)"
              @keydown.enter.prevent="openItem(item)"
              @keydown.space.prevent="openItem(item)"
            >
              <td class="px-4 py-3">
                <div class="flex items-start gap-3">
                  <div class="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md bg-accent-50 text-accent-900">
                    <BookOpen class="h-4 w-4" />
                  </div>
                  <div class="min-w-0">
                    <p class="font-semibold text-ink-900">{{ item.title }}</p>
                    <p class="mt-1 line-clamp-2 text-xs leading-5 text-ink-500">{{ item.summary || item.body || "No summary yet." }}</p>
                    <div v-if="item.keywords.length" class="mt-2 flex flex-wrap gap-1">
                      <span v-for="keyword in item.keywords.slice(0, 4)" :key="keyword" class="rounded-md bg-ink-100 px-2 py-0.5 text-xs text-ink-600">
                        {{ keyword }}
                      </span>
                    </div>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3 text-ink-700">{{ knowledgeTypeLabel(item.type) }}</td>
              <td class="px-4 py-3"><StatusBadge :status="item.status" /></td>
              <td v-if="!template.personalArchive" class="px-4 py-3 text-ink-700">{{ item.component || "Unspecified" }}</td>
              <td v-if="!template.personalArchive" class="px-4 py-3">
                <button
                  v-if="item.sourceServiceId"
                  class="inline-flex max-w-xs items-center gap-1 truncate font-semibold text-accent-800 hover:text-accent-950"
                  type="button"
                  @click.stop="router.push(workItemPath(item.sourceServiceId))"
                >
                  <span class="truncate">{{ item.sourceServiceNumber || "Linked service" }}</span>
                  <ArrowUpRight class="h-3.5 w-3.5 shrink-0" />
                </button>
                <span v-else class="text-ink-400">None</span>
              </td>
              <td class="px-4 py-3 text-ink-600">
                <p>{{ formatDateTime(item.updatedAt) }}</p>
                <p v-if="item.lastVerifiedAt" class="mt-1 text-xs text-ink-500">Verified {{ formatDate(item.lastVerifiedAt) }}</p>
              </td>
              <td v-if="template.personalArchive" class="px-3 py-3 text-right" @click.stop @keydown.stop>
                <button
                  class="grid h-8 w-8 place-items-center rounded-md text-ink-500 transition hover:bg-ink-100 hover:text-ink-900"
                  type="button"
                  :disabled="!canManageKnowledge(item) || mutatingKnowledgeId === item.knowledgeId"
                  :aria-label="`Actions for ${item.title}`"
                  title="Knowledge actions"
                  @click.stop="openRowMenu($event, item)"
                >
                  <MoreHorizontal class="h-4 w-4" />
                </button>
              </td>
            </tr>
            <tr v-if="!loading && !items.length">
              <td class="px-4 py-8 text-center text-ink-500" :colspan="template.personalArchive ? 5 : 6">
                {{ trashView ? "Knowledge trash is empty." : "No knowledge items match the current filters." }}
              </td>
            </tr>
            <tr v-if="loading">
              <td class="px-4 py-8 text-center text-ink-500" :colspan="template.personalArchive ? 5 : 6">
                Loading knowledge...
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="flex flex-wrap items-center justify-end gap-2 border-t border-ink-100 px-4 py-3">
        <button class="btn-secondary h-9 px-3" type="button" :disabled="page <= 1 || loading" @click="previousPage">Previous</button>
        <button class="btn-secondary h-9 px-3" type="button" :disabled="page >= totalPages || loading" @click="nextPage">Next</button>
      </div>
    </section>

    <Teleport to="body">
      <div
        v-if="contextMenu && contextItem"
        class="knowledge-row-menu"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        role="menu"
        @click.stop
        @pointerdown.stop
      >
        <template v-if="trashView">
          <button type="button" role="menuitem" @click="restoreItem(contextItem)">
            <RotateCcw /> Restore
          </button>
          <button class="danger" type="button" role="menuitem" @click="permanentlyDeleteItem(contextItem)">
            <Trash2 /> Delete permanently
          </button>
        </template>
        <button v-else class="danger" type="button" role="menuitem" @click="moveToTrash(contextItem)">
          <Trash2 /> Move to trash
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.knowledge-row-menu {
  position: fixed;
  z-index: 120;
  width: 13rem;
  overflow: hidden;
  border: 1px solid var(--personal-border, #deded7);
  border-radius: 0.65rem;
  background: var(--personal-surface, #fff);
  padding: 0.3rem;
  color: var(--personal-text, #20201d);
  box-shadow: 0 16px 44px color-mix(in srgb, var(--personal-text, #20201d) 22%, transparent);
  animation: knowledge-menu-in 120ms ease-out both;
}

.knowledge-row-menu button {
  display: flex;
  min-height: 2.15rem;
  width: 100%;
  align-items: center;
  gap: 0.55rem;
  border-radius: 0.4rem;
  padding: 0.4rem 0.55rem;
  color: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  text-align: left;
}

.knowledge-row-menu button:hover {
  background: var(--personal-accent-soft, #dff0ec);
  color: var(--personal-accent-strong, #245e56);
}

.knowledge-row-menu button.danger {
  color: #a3362f;
}

.knowledge-row-menu button.danger:hover {
  background: #fff0ee;
  color: #a3362f;
}

.knowledge-row-menu svg {
  width: 0.9rem;
  height: 0.9rem;
}

@keyframes knowledge-menu-in {
  from { opacity: 0; transform: translateY(-3px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
</style>
