<script setup lang="ts">
import { Archive, ArrowLeft, ArrowUpRight, BookOpen, Edit3, Trash2, X } from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { client } from "../api/client";
import ArchiveManagementAccess from "../components/documents/ArchiveManagementAccess.vue";
import { useArchiveContentManagement } from "../composables/useArchiveContentManagement";
import { useBusinessTemplate, workItemPath } from "../businessTemplate";
import Breadcrumbs from "../components/Breadcrumbs.vue";
import KnowledgeEditor from "../components/knowledge/KnowledgeEditor.vue";
import MarkdownContent from "../components/discussion/MarkdownContent.vue";
import MarkdownReaderDialog from "../components/reading/MarkdownReaderDialog.vue";
import PageHeader from "../components/PageHeader.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { useAuthStore } from "../stores/auth";
import { useToastStore } from "../stores/toasts";
import { formatDate, formatDateTime } from "../shared/format";
import type { CaseRecord, DocumentRecord, KnowledgeInput, KnowledgeItem, KnowledgeLink, ManagedAsset } from "../shared/types";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const toasts = useToastStore();
const { template } = useBusinessTemplate();

const item = ref<KnowledgeItem | null>(null);
const services = ref<CaseRecord[]>([]);
const assets = ref<ManagedAsset[]>([]);
const documents = ref<DocumentRecord[]>([]);
const loading = ref(false);
const saving = ref(false);
const editMode = ref(false);
const error = ref("");
const showReader = ref(false);

const knowledgeId = computed(() => String(route.params.id));
const breadcrumbs = computed(() => [
  { label: "Knowledge", to: "/knowledge" },
  { label: item.value?.title ?? "Knowledge item", current: true }
]);
const serviceLinks = computed(() => item.value?.links.filter((link) => link.entityType === "service") ?? []);
const assetLinks = computed(() => item.value?.links.filter((link) => link.entityType === "asset") ?? []);
const documentLinks = computed(() => item.value?.links.filter((link) => link.entityType === "document") ?? []);
const discussionLinks = computed(() => item.value?.links.filter((link) => link.entityType === "discussion") ?? []);
const { canManageContent, setManagementExpiry, managementLabel } = useArchiveContentManagement();
const canEditKnowledge = computed(() => auth.canEditCases && canManageContent(item.value?.managementOwnerUserId));

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

async function load() {
  loading.value = true;
  error.value = "";
  try {
    item.value = await client.knowledgeItem(knowledgeId.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load knowledge";
  } finally {
    loading.value = false;
  }
}

async function save(input: KnowledgeInput) {
  if (!item.value || !canEditKnowledge.value) return;
  saving.value = true;
  error.value = "";
  try {
    item.value = await client.updateKnowledge(item.value.knowledgeId, input);
    editMode.value = false;
    toasts.success("Knowledge updated", item.value.title);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to update knowledge";
    toasts.error("Unable to update knowledge", error.value);
  } finally {
    saving.value = false;
  }
}

async function archiveItem() {
  if (!item.value || !canEditKnowledge.value) return;
  const action = template.value.personalArchive ? "Move" : "Archive";
  const destination = template.value.personalArchive ? " to Knowledge trash" : "";
  if (!window.confirm(`${action} “${item.value.title}”${destination}?`)) return;
  saving.value = true;
  try {
    await client.deleteKnowledge(item.value.knowledgeId);
    toasts.success(template.value.personalArchive ? "Moved to Knowledge trash" : "Knowledge archived", item.value.title);
    await router.push("/knowledge");
  } catch (err) {
    error.value = err instanceof Error ? err.message : template.value.personalArchive ? "Unable to move knowledge to trash" : "Unable to archive knowledge";
    toasts.error(template.value.personalArchive ? "Knowledge not moved" : "Unable to archive knowledge", error.value);
  } finally {
    saving.value = false;
  }
}

function openLink(link: KnowledgeLink) {
  if (link.entityType === "service") void router.push(workItemPath(link.entityId));
  if (link.entityType === "asset") void router.push(`/managed-assets/${link.entityId}`);
  if (link.entityType === "document") {
    if (template.value.personalArchive) {
      void router.push(`/reader/${link.entityId}`);
      return;
    }
    const document = documents.value.find((record) => record.documentId === link.entityId);
    void router.push(document?.caseId ? workItemPath(document.caseId, `tab=documents&documentId=${document.documentId}`) : "/documents");
  }
  if (link.entityType === "discussion") void router.push(`${template.value.personalArchive ? "/reading-notes" : "/discussions"}?q=${link.entityId}`);
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

onMounted(async () => {
  await Promise.all([loadOptions(), load()]);
});
</script>

<template>
  <div>
    <Breadcrumbs v-if="!template.personalArchive" :items="breadcrumbs" />
    <div v-if="loading" class="panel p-6 text-sm text-ink-500">Loading knowledge...</div>
    <div v-else-if="error && !item" class="panel p-6 text-sm font-semibold text-legal-red">{{ error }}</div>
    <div v-else-if="item">
      <PageHeader :eyebrow="template.personalArchive ? 'Reading workspace · Knowledge' : 'Knowledge'" :title="item.title" :description="item.summary">
        <div class="flex flex-wrap items-center gap-1.5">
          <ArchiveManagementAccess v-if="template.personalArchive && auth.user?.role === 'Admin'" @change="setManagementExpiry" />
          <button class="btn-secondary px-3" :class="template.personalArchive ? 'h-8 text-xs' : 'h-9'" type="button" @click="router.push('/knowledge')">
            <ArrowLeft class="h-4 w-4" />
            {{ template.personalArchive ? "Back to Knowledge" : "Back" }}
          </button>
          <button v-if="!editMode && template.personalArchive" class="btn-primary h-8 px-3 text-xs" type="button" @click="showReader = true">
            <BookOpen class="h-4 w-4" />
            Read
          </button>
          <button v-if="!editMode" class="btn-secondary px-3" :class="template.personalArchive ? 'h-8 text-xs' : 'h-9'" type="button" :disabled="!canEditKnowledge" @click="editMode = true">
            <Edit3 class="h-4 w-4" />
            Edit
          </button>
          <button v-if="editMode" class="btn-secondary px-3" :class="template.personalArchive ? 'h-8 text-xs' : 'h-9'" type="button" @click="editMode = false">
            <X class="h-4 w-4" />
            Cancel
          </button>
          <button class="btn-secondary px-3 text-legal-red hover:border-red-200 hover:bg-red-50" :class="template.personalArchive ? 'h-8 text-xs' : 'h-9'" type="button" :disabled="!canEditKnowledge || saving" @click="archiveItem">
            <Trash2 v-if="template.personalArchive" class="h-4 w-4" />
            <Archive v-else class="h-4 w-4" />
            {{ template.personalArchive ? "Move to trash" : "Archive" }}
          </button>
        </div>
      </PageHeader>
      <p v-if="template.personalArchive" class="mb-3 text-xs text-ink-500">{{ managementLabel(item.managementOwnerUserId) }}</p>

      <section v-if="editMode" class="panel p-4">
        <p v-if="!canEditKnowledge" class="mb-3 text-sm" role="status">Editing is paused. Your unsaved changes remain here; restore management access to continue.</p>
        <fieldset :disabled="!canEditKnowledge">
        <KnowledgeEditor
          :initial="item"
          :services="services"
          :assets="assets"
          :documents="documents"
          :saving="saving"
          :personal-mode="template.personalArchive"
          submit-label="Save changes"
          show-cancel
          @save="save"
          @cancel="editMode = false"
        />
        </fieldset>
      </section>

      <section v-else class="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div class="space-y-4">
          <div class="panel p-4">
            <div class="mb-4 flex flex-wrap items-center gap-2">
              <StatusBadge :status="item.status" />
              <span class="rounded-md bg-ink-100 px-2.5 py-1 text-xs font-semibold text-ink-700">{{ knowledgeTypeLabel(item.type) }}</span>
              <span v-if="item.component" class="rounded-md bg-accent-50 px-2.5 py-1 text-xs font-semibold text-accent-900">
                {{ item.component }}
              </span>
            </div>
            <MarkdownContent v-if="item.body" class="text-sm leading-7 text-ink-800" :source="item.body" />
            <p v-else class="text-sm text-ink-500">No body has been added yet.</p>
          </div>

          <div v-if="item.keywords.length" class="panel p-4">
            <h2 class="mb-3 font-semibold">Keywords</h2>
            <div class="flex flex-wrap gap-2">
              <span v-for="keyword in item.keywords" :key="keyword" class="rounded-md bg-ink-100 px-2.5 py-1 text-sm text-ink-700">
                {{ keyword }}
              </span>
            </div>
          </div>
        </div>

        <aside class="space-y-4">
          <div class="panel p-4">
            <div class="mb-3 flex items-center gap-2">
              <div class="grid h-9 w-9 place-items-center rounded-md bg-accent-50 text-accent-900">
                <BookOpen class="h-4 w-4" />
              </div>
              <h2 class="font-semibold">Metadata</h2>
            </div>
            <dl class="space-y-3 text-sm">
              <div>
                <dt class="text-xs uppercase text-ink-500">Updated</dt>
                <dd class="mt-1 font-semibold">{{ formatDateTime(item.updatedAt) }}</dd>
              </div>
              <div>
                <dt class="text-xs uppercase text-ink-500">Created</dt>
                <dd class="mt-1 font-semibold">{{ formatDateTime(item.createdAt) }}</dd>
              </div>
              <div v-if="item.lastVerifiedAt">
                <dt class="text-xs uppercase text-ink-500">Last verified</dt>
                <dd class="mt-1 font-semibold">{{ formatDate(item.lastVerifiedAt) }}</dd>
              </div>
              <div v-if="item.updatedByName">
                <dt class="text-xs uppercase text-ink-500">Updated by</dt>
                <dd class="mt-1 font-semibold">{{ item.updatedByName }}</dd>
              </div>
              <div v-if="item.credentialReference">
                <dt class="text-xs uppercase text-ink-500">Credential reference</dt>
                <dd class="mt-1 rounded-md border border-ink-200 bg-ink-50 p-2 font-semibold">{{ item.credentialReference }}</dd>
              </div>
            </dl>
          </div>

          <div class="panel p-4">
            <h2 class="mb-3 font-semibold">Related links</h2>
            <div class="space-y-2">
              <button
                v-for="link in [...serviceLinks, ...assetLinks, ...documentLinks, ...discussionLinks]"
                :key="link.knowledgeLinkId"
                class="flex w-full items-center justify-between gap-3 rounded-md border border-ink-200 px-3 py-2 text-left text-sm transition hover:border-accent-300 hover:bg-accent-50"
                type="button"
                @click="openLink(link)"
              >
                <span class="min-w-0">
                  <span class="block truncate font-semibold">{{ link.label || link.entityId }}</span>
                  <span class="mt-0.5 block truncate text-xs text-ink-500">{{ link.entityType }} · {{ link.detail || link.relationship }}</span>
                </span>
                <ArrowUpRight class="h-4 w-4 shrink-0 text-ink-400" />
              </button>
              <p v-if="!item.links.length" class="text-sm text-ink-500">
                {{ template.personalArchive ? "No document or Reading & Notes links yet." : "No service, asset, document, or discussion links yet." }}
              </p>
            </div>
          </div>
        </aside>
      </section>
      <MarkdownReaderDialog
        v-model="showReader"
        :source="item.body"
        :title="item.title"
      />
    </div>
  </div>
</template>
