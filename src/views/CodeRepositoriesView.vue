<script setup lang="ts">
import {
  Archive,
  CheckCircle2,
  ChevronRight,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  GitBranch,
  GitCommitHorizontal,
  HardDrive,
  Import,
  LockKeyhole,
  MoreHorizontal,
  PackageOpen,
  Plus,
  RefreshCw,
  Save,
  Search,
  Tag,
  Trash2,
  Unlock,
  X
} from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { client } from "../api/client";
import type {
  CodeRepositoryDetail,
  CodeRepositoryOverview,
  CodeRepositoryRecord,
  CodeRepositoryUpdateInput
} from "../shared/types";
import { useToastStore } from "../stores/toasts";

type DetailTab = "overview" | "commits" | "refs" | "snapshots" | "settings";
type DialogKind = "create" | "import" | null;
type RepositoryActionMenuPosition = {
  left: number;
  top: number;
  maxHeight: number;
  opensUp: boolean;
};

const toasts = useToastStore();
const overview = ref<CodeRepositoryOverview | null>(null);
const loading = ref(true);
const refreshing = ref(false);
const errorMessage = ref("");
const query = ref("");
const dialog = ref<DialogKind>(null);
const creating = ref(false);
const importing = ref(false);
const changingRepository = ref("");
const selectedFullName = ref("");
const detail = ref<CodeRepositoryDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref("");
const detailTab = ref<DetailTab>("overview");
const creatingBranch = ref(false);
const creatingTag = ref(false);
const creatingSnapshot = ref(false);
const deletingRepository = ref(false);
const deleteConfirmation = ref("");
const actionMenuFullName = ref("");
const actionMenuPosition = ref<RepositoryActionMenuPosition>({ left: 0, top: 0, maxHeight: 0, opensUp: false });

const createForm = reactive({ name: "", description: "", isPrivate: true, initialize: false });
const importForm = reactive({
  sourceUrl: "",
  name: "",
  description: "",
  isPrivate: true,
  mirror: false,
  includeMetadata: true,
  sourceToken: ""
});
const settingsForm = reactive({ name: "", description: "", defaultBranch: "", isPrivate: true });
const branchForm = reactive({ name: "", sourceRef: "" });
const tagForm = reactive({ name: "", target: "", message: "" });

const filteredRepositories = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return overview.value?.repositories ?? [];
  return (overview.value?.repositories ?? []).filter((repository) =>
    [repository.name, repository.fullName, repository.description, repository.defaultBranch]
      .join(" ")
      .toLowerCase()
      .includes(needle)
  );
});

const activeRepositoryCount = computed(
  () => overview.value?.repositories.filter((repository) => !repository.isArchived).length ?? 0
);

const activeActionRepository = computed(
  () => overview.value?.repositories.find((repository) => repository.fullName === actionMenuFullName.value) ?? null
);

const detailTabs = computed<{ id: DetailTab; label: string; count?: number }[]>(() => [
  { id: "overview", label: "Overview" },
  { id: "commits", label: "Commits", count: detail.value?.commits.length ?? 0 },
  { id: "refs", label: "Branches & tags", count: (detail.value?.branches.length ?? 0) + (detail.value?.tags.length ?? 0) },
  { id: "snapshots", label: "Snapshots", count: detail.value?.snapshots.length ?? 0 },
  { id: "settings", label: "Settings" }
]);

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 100 ? size.toFixed(0) : size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[index]}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return "No activity yet";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function firstLine(value: string): string {
  return value.split(/\r?\n/)[0]?.trim() || "Commit";
}

async function copyText(value: string, label: string) {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
    } else {
      const textArea = document.createElement("textarea");
      try {
        textArea.value = value;
        textArea.setAttribute("readonly", "");
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        document.body.appendChild(textArea);
        textArea.select();
        if (!document.execCommand("copy")) throw new Error("Copy command was blocked.");
      } finally {
        textArea.remove();
      }
    }
    toasts.success(`${label} copied`, value);
  } catch {
    toasts.error("Clipboard unavailable", "Select the address and copy it manually.");
  }
}

function updateOverviewRepository(updated: CodeRepositoryRecord, previousFullName: string) {
  if (!overview.value) return;
  overview.value.repositories = overview.value.repositories.map((item) =>
    item.fullName === previousFullName ? updated : item
  );
  overview.value.totalRepositoryBytes = overview.value.repositories.reduce((total, item) => total + item.sizeBytes, 0);
  if (selectedFullName.value === previousFullName) selectedFullName.value = updated.fullName;
}

function syncSettingsForm(repository: CodeRepositoryRecord) {
  settingsForm.name = repository.name;
  settingsForm.description = repository.description;
  settingsForm.defaultBranch = repository.defaultBranch;
  settingsForm.isPrivate = repository.isPrivate;
  branchForm.sourceRef = repository.defaultBranch;
  tagForm.target = repository.defaultBranch;
  deleteConfirmation.value = "";
}

async function loadRepositories(mode: "initial" | "refresh" = "initial") {
  if (mode === "refresh") refreshing.value = true;
  else loading.value = true;
  try {
    overview.value = await client.codeRepositories();
    errorMessage.value = "";
    if (selectedFullName.value && !overview.value.repositories.some((item) => item.fullName === selectedFullName.value)) {
      closeDetail();
    }
    if (actionMenuFullName.value && !overview.value.repositories.some((item) => item.fullName === actionMenuFullName.value)) {
      closeRepositoryActionMenu();
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Code repositories are unavailable.";
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

async function openDetail(repository: CodeRepositoryRecord, tab: DetailTab = "overview") {
  closeRepositoryActionMenu();
  selectedFullName.value = repository.fullName;
  detailTab.value = tab;
  detailLoading.value = true;
  detailError.value = "";
  try {
    const loaded = await client.codeRepositoryDetail(repository.owner, repository.name);
    if (selectedFullName.value !== repository.fullName) return;
    detail.value = loaded;
    syncSettingsForm(loaded.repository);
  } catch (error) {
    detailError.value = error instanceof Error ? error.message : "Repository details are unavailable.";
  } finally {
    detailLoading.value = false;
  }
}

async function reloadDetail(tab: DetailTab = detailTab.value) {
  const repository = detail.value?.repository;
  if (repository) await openDetail(repository, tab);
}

function closeDetail() {
  selectedFullName.value = "";
  detail.value = null;
  detailError.value = "";
  detailTab.value = "overview";
}

function closeRepositoryActionMenu() {
  actionMenuFullName.value = "";
}

function toggleRepositoryActionMenu(event: MouseEvent, repository: CodeRepositoryRecord) {
  if (actionMenuFullName.value === repository.fullName) {
    closeRepositoryActionMenu();
    return;
  }

  const trigger = event.currentTarget as HTMLElement;
  const triggerRect = trigger.getBoundingClientRect();
  const viewportPadding = 12;
  const menuGap = 6;
  const menuWidth = 208;
  const estimatedMenuHeight = 180;
  const spaceBelow = window.innerHeight - triggerRect.bottom - viewportPadding - menuGap;
  const spaceAbove = triggerRect.top - viewportPadding - menuGap;
  const opensUp = spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow;

  actionMenuPosition.value = {
    left: Math.max(
      viewportPadding,
      Math.min(triggerRect.right - menuWidth, window.innerWidth - menuWidth - viewportPadding)
    ),
    top: opensUp ? triggerRect.top - menuGap : triggerRect.bottom + menuGap,
    maxHeight: Math.max(96, opensUp ? spaceAbove : spaceBelow),
    opensUp
  };
  actionMenuFullName.value = repository.fullName;
}

function viewRepositoryFromMenu() {
  const repository = activeActionRepository.value;
  if (repository) void openDetail(repository);
}

function copyRepositorySshFromMenu() {
  const repository = activeActionRepository.value;
  closeRepositoryActionMenu();
  if (repository) void copyText(repository.sshUrl, "SSH address");
}

function changeRepositoryVisibilityFromMenu() {
  const repository = activeActionRepository.value;
  closeRepositoryActionMenu();
  if (repository) void toggleVisibility(repository);
}

function changeRepositoryArchiveStateFromMenu() {
  const repository = activeActionRepository.value;
  closeRepositoryActionMenu();
  if (repository) void toggleArchive(repository);
}

function openCreateDialog() {
  createForm.name = "";
  createForm.description = "";
  createForm.isPrivate = true;
  createForm.initialize = false;
  dialog.value = "create";
}

function openImportDialog() {
  importForm.sourceUrl = "";
  importForm.name = "";
  importForm.description = "";
  importForm.isPrivate = true;
  importForm.mirror = false;
  importForm.includeMetadata = true;
  importForm.sourceToken = "";
  dialog.value = "import";
}

function inferImportName() {
  if (importForm.name.trim()) return;
  try {
    const url = new URL(importForm.sourceUrl.trim());
    const last = url.pathname.split("/").filter(Boolean).at(-1)?.replace(/\.git$/i, "") ?? "";
    if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(last)) importForm.name = last;
  } catch {
    // Validation is shown by the browser and API.
  }
}

function closeDialog() {
  if (!creating.value && !importing.value) dialog.value = null;
}

async function createRepository() {
  if (!createForm.name.trim()) return;
  creating.value = true;
  try {
    const repository = await client.createCodeRepository({
      name: createForm.name.trim(),
      description: createForm.description.trim(),
      isPrivate: createForm.isPrivate,
      initialize: createForm.initialize
    });
    dialog.value = null;
    toasts.success("Repository created", repository.fullName);
    await loadRepositories("refresh");
    await openDetail(repository);
  } catch (error) {
    toasts.error("Repository was not created", error instanceof Error ? error.message : "Try again.");
  } finally {
    creating.value = false;
  }
}

async function importRepository() {
  inferImportName();
  if (!importForm.sourceUrl.trim() || !importForm.name.trim()) return;
  importing.value = true;
  try {
    const repository = await client.importCodeRepository({
      sourceUrl: importForm.sourceUrl.trim(),
      name: importForm.name.trim(),
      description: importForm.description.trim(),
      isPrivate: importForm.isPrivate,
      mirror: importForm.mirror,
      includeMetadata: importForm.includeMetadata,
      sourceToken: importForm.sourceToken.trim()
    });
    importForm.sourceToken = "";
    dialog.value = null;
    toasts.success("GitHub repository imported", repository.fullName);
    await loadRepositories("refresh");
    await openDetail(repository);
  } catch (error) {
    toasts.error("Repository was not imported", error instanceof Error ? error.message : "Try again.");
  } finally {
    importForm.sourceToken = "";
    importing.value = false;
  }
}

async function updateRepository(repository: CodeRepositoryRecord, input: CodeRepositoryUpdateInput, successMessage: string) {
  const previousFullName = repository.fullName;
  changingRepository.value = previousFullName;
  try {
    const updated = await client.updateCodeRepository(repository.owner, repository.name, input);
    updateOverviewRepository(updated, previousFullName);
    if (detail.value?.repository.fullName === previousFullName) {
      detail.value.repository = updated;
      syncSettingsForm(updated);
    }
    toasts.success(successMessage, updated.fullName);
    return updated;
  } catch (error) {
    toasts.error("Repository was not updated", error instanceof Error ? error.message : "Try again.");
    return null;
  } finally {
    changingRepository.value = "";
  }
}

async function saveRepositorySettings() {
  const repository = detail.value?.repository;
  if (!repository) return;
  const updated = await updateRepository(
    repository,
    {
      name: settingsForm.name.trim(),
      description: settingsForm.description.trim(),
      defaultBranch: settingsForm.defaultBranch,
      isPrivate: settingsForm.isPrivate
    },
    "Repository settings saved"
  );
  if (updated) await openDetail(updated, "settings");
}

async function toggleVisibility(repository: CodeRepositoryRecord) {
  const makePrivate = !repository.isPrivate;
  if (!makePrivate && !window.confirm(`Make ${repository.fullName} public to everyone who can reach Forgejo?`)) return;
  await updateRepository(repository, { isPrivate: makePrivate }, makePrivate ? "Repository is private" : "Repository is public");
}

async function toggleArchive(repository: CodeRepositoryRecord) {
  const archive = !repository.isArchived;
  if (archive && !window.confirm(`Archive ${repository.fullName}? Git pushes will stop until it is restored.`)) return;
  const updated = await updateRepository(repository, { isArchived: archive }, archive ? "Repository archived" : "Repository restored");
  if (updated) await openDetail(updated, "settings");
}

async function createBranch() {
  const repository = detail.value?.repository;
  if (!repository || !branchForm.name.trim()) return;
  creatingBranch.value = true;
  try {
    await client.createCodeRepositoryBranch(repository.owner, repository.name, {
      name: branchForm.name.trim(),
      sourceRef: branchForm.sourceRef || repository.defaultBranch
    });
    toasts.success("Branch created", branchForm.name.trim());
    branchForm.name = "";
    await reloadDetail("refs");
  } catch (error) {
    toasts.error("Branch was not created", error instanceof Error ? error.message : "Try again.");
  } finally {
    creatingBranch.value = false;
  }
}

async function deleteBranch(branch: string) {
  const repository = detail.value?.repository;
  if (!repository || branch === repository.defaultBranch) return;
  if (!window.confirm(`Delete branch ${branch}? Commits reachable only from this branch may become difficult to recover.`)) return;
  try {
    await client.deleteCodeRepositoryBranch(repository.owner, repository.name, branch);
    toasts.success("Branch deleted", branch);
    await reloadDetail("refs");
  } catch (error) {
    toasts.error("Branch was not deleted", error instanceof Error ? error.message : "Try again.");
  }
}

async function createTag() {
  const repository = detail.value?.repository;
  if (!repository || !tagForm.name.trim()) return;
  creatingTag.value = true;
  try {
    await client.createCodeRepositoryTag(repository.owner, repository.name, {
      name: tagForm.name.trim(),
      target: tagForm.target || repository.defaultBranch,
      message: tagForm.message.trim()
    });
    toasts.success("Tag created", tagForm.name.trim());
    tagForm.name = "";
    tagForm.message = "";
    await reloadDetail("refs");
  } catch (error) {
    toasts.error("Tag was not created", error instanceof Error ? error.message : "Try again.");
  } finally {
    creatingTag.value = false;
  }
}

async function deleteTag(tag: string) {
  const repository = detail.value?.repository;
  if (!repository || !window.confirm(`Delete tag ${tag}?`)) return;
  try {
    await client.deleteCodeRepositoryTag(repository.owner, repository.name, tag);
    toasts.success("Tag deleted", tag);
    await reloadDetail("refs");
  } catch (error) {
    toasts.error("Tag was not deleted", error instanceof Error ? error.message : "Try again.");
  }
}

async function createSnapshot() {
  const repository = detail.value?.repository;
  if (!repository) return;
  creatingSnapshot.value = true;
  try {
    const snapshot = await client.createCodeRepositorySnapshot(repository.owner, repository.name);
    toasts.success("Source snapshot saved", `${snapshot.ref} · ${formatBytes(snapshot.archiveBytes)}`);
    await reloadDetail("snapshots");
  } catch (error) {
    toasts.error("Snapshot was not created", error instanceof Error ? error.message : "Try again.");
  } finally {
    creatingSnapshot.value = false;
  }
}

async function permanentlyDeleteRepository() {
  const repository = detail.value?.repository;
  if (!repository || deleteConfirmation.value !== repository.name) return;
  deletingRepository.value = true;
  try {
    await client.deleteCodeRepository(repository.owner, repository.name, deleteConfirmation.value);
    toasts.success("Repository permanently deleted", repository.fullName);
    closeDetail();
    await loadRepositories("refresh");
  } catch (error) {
    toasts.error("Repository was not deleted", error instanceof Error ? error.message : "Try again.");
  } finally {
    deletingRepository.value = false;
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  if (actionMenuFullName.value) closeRepositoryActionMenu();
  else if (dialog.value) closeDialog();
  else if (selectedFullName.value) closeDetail();
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("click", closeRepositoryActionMenu);
  window.addEventListener("resize", closeRepositoryActionMenu);
  window.addEventListener("scroll", closeRepositoryActionMenu, true);
  void loadRepositories();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("click", closeRepositoryActionMenu);
  window.removeEventListener("resize", closeRepositoryActionMenu);
  window.removeEventListener("scroll", closeRepositoryActionMenu, true);
});
</script>

<template>
  <section class="code-page">
    <header class="code-header">
      <div>
        <p class="code-eyebrow"><Code2 /> DEVELOPMENT STORAGE</p>
        <h1>Code repositories</h1>
        <p>Manage Forgejo repositories, source history and recoverable snapshots without leaving Personal Archive.</p>
      </div>
      <div class="header-actions">
        <a v-if="overview?.webUrl" :href="overview.webUrl" target="_blank" rel="noopener noreferrer" class="secondary-action">
          <ExternalLink /> Open Forgejo
        </a>
        <button type="button" class="secondary-action" :disabled="loading || refreshing" @click="loadRepositories('refresh')">
          <RefreshCw :class="{ spinning: refreshing }" /> {{ refreshing ? "Refreshing…" : "Refresh" }}
        </button>
        <button type="button" class="secondary-action" :disabled="!overview?.configured" @click="openImportDialog">
          <Import /> Import GitHub
        </button>
        <button type="button" class="primary-action" :disabled="!overview?.configured" @click="openCreateDialog">
          <Plus /> New repository
        </button>
      </div>
    </header>

    <div v-if="errorMessage && !overview" class="code-message is-error" role="alert">
      <Code2 />
      <div><strong>Forgejo could not be reached</strong><span>{{ errorMessage }}</span></div>
      <button type="button" @click="loadRepositories('refresh')">Try again</button>
    </div>

    <div v-else-if="loading || !overview" class="code-loading" aria-live="polite">
      <RefreshCw class="spinning" /> Connecting to Forgejo…
    </div>

    <template v-else>
      <div v-if="!overview.configured" class="code-message is-warning" role="status">
        <Code2 />
        <div><strong>Forgejo connection is not configured</strong><span>{{ overview.message }}</span></div>
      </div>

      <section v-else class="service-strip" :class="`is-${overview.status}`">
        <div class="service-state">
          <CheckCircle2 />
          <span><strong>Forgejo connected</strong><small>{{ overview.version ? `Version ${overview.version}` : "API responding" }}</small></span>
        </div>
        <div class="service-stat"><span>Repositories</span><strong>{{ overview.repositoryCount }}</strong></div>
        <div class="service-stat"><span>Active</span><strong>{{ activeRepositoryCount }}</strong></div>
        <div class="service-stat"><span>Git data</span><strong>{{ formatBytes(overview.totalRepositoryBytes) }}</strong></div>
        <div class="service-stat service-endpoint"><span>SSH endpoint</span><strong>{{ overview.sshHost }}:{{ overview.sshPort }}</strong></div>
      </section>

      <section v-if="overview.configured" class="repository-workspace" :class="{ 'has-detail': selectedFullName }">
        <div class="repository-pane">
          <div class="repository-toolbar">
            <label class="repository-search">
              <Search />
              <input v-model="query" type="search" placeholder="Search repositories" />
            </label>
            <span>{{ filteredRepositories.length }} {{ filteredRepositories.length === 1 ? "repository" : "repositories" }}</span>
          </div>

          <div v-if="!overview.repositories.length" class="empty-repositories">
            <GitBranch />
            <strong>No repositories yet</strong>
            <span>Create an empty repository or migrate an existing GitHub project.</span>
            <button type="button" class="primary-action" @click="openCreateDialog"><Plus /> New repository</button>
          </div>

          <div v-else-if="!filteredRepositories.length" class="empty-repositories is-compact">
            <Search /><strong>No matching repositories</strong><span>Try another name or description.</span>
          </div>

          <div v-else class="repository-list">
            <div class="repository-columns" aria-hidden="true">
              <span>Repository</span><span>Access</span><span>Size</span><span>Updated</span><span />
            </div>
            <article
              v-for="repository in filteredRepositories"
              :key="repository.id || repository.fullName"
              class="repository-row"
              :class="{ 'is-archived': repository.isArchived, 'is-selected': repository.fullName === selectedFullName }"
            >
              <button type="button" class="repository-identity" @click="openDetail(repository)">
                <span class="repository-icon"><GitBranch /></span>
                <span>
                  <strong>{{ repository.name }}</strong>
                  <small>{{ repository.description || (repository.isEmpty ? "Empty repository" : `${repository.defaultBranch} branch`) }}</small>
                </span>
              </button>
              <div class="repository-access">
                <span :class="repository.isPrivate ? 'is-private' : 'is-public'">
                  <LockKeyhole v-if="repository.isPrivate" /><Unlock v-else />{{ repository.isPrivate ? "Private" : "Public" }}
                </span>
                <em v-if="repository.isArchived">Archived</em><em v-else-if="repository.isMirror">Mirror</em>
              </div>
              <strong class="repository-size">{{ formatBytes(repository.sizeBytes) }}</strong>
              <time :datetime="repository.updatedAt">{{ formatDateTime(repository.updatedAt) }}</time>
              <button
                type="button"
                class="repository-action-trigger"
                :class="{ active: actionMenuFullName === repository.fullName }"
                :aria-expanded="actionMenuFullName === repository.fullName"
                aria-haspopup="menu"
                title="Repository actions"
                aria-label="Repository actions"
                @click.stop="toggleRepositoryActionMenu($event, repository)"
              >
                <MoreHorizontal />
              </button>
            </article>
          </div>
        </div>

        <aside v-if="selectedFullName" class="detail-pane" aria-live="polite">
          <div v-if="detailLoading" class="detail-loading"><RefreshCw class="spinning" /> Loading repository…</div>
          <div v-else-if="detailError" class="detail-error">
            <strong>Details unavailable</strong><span>{{ detailError }}</span><button type="button" @click="reloadDetail()">Try again</button>
          </div>
          <template v-else-if="detail">
            <header class="detail-header">
              <div>
                <p>{{ detail.repository.owner }}</p>
                <h2>{{ detail.repository.name }}</h2>
                <span>{{ detail.repository.description || "No description" }}</span>
              </div>
              <div>
                <a :href="detail.repository.webUrl" target="_blank" rel="noopener noreferrer" title="Open in Forgejo"><ExternalLink /></a>
                <button type="button" title="Close details" aria-label="Close details" @click="closeDetail"><X /></button>
              </div>
            </header>

            <nav class="detail-tabs" aria-label="Repository details">
              <button
                v-for="tab in detailTabs"
                :key="tab.id"
                type="button"
                :class="{ active: detailTab === tab.id }"
                @click="detailTab = tab.id"
              >
                {{ tab.label }}<span v-if="tab.count !== undefined">{{ tab.count }}</span>
              </button>
            </nav>

            <div class="detail-content">
              <section v-if="detailTab === 'overview'" class="overview-panel">
                <div class="repository-facts">
                  <div><span>Default branch</span><strong><GitBranch />{{ detail.repository.defaultBranch }}</strong></div>
                  <div><span>Repository size</span><strong><HardDrive />{{ formatBytes(detail.repository.sizeBytes) }}</strong></div>
                  <div><span>Branches</span><strong>{{ detail.branches.length }}</strong></div>
                  <div><span>Tags / releases</span><strong>{{ detail.tags.length }} / {{ detail.releases.length }}</strong></div>
                </div>
                <div class="clone-block">
                  <div><span>SSH clone address</span><code>{{ detail.repository.sshUrl }}</code></div>
                  <button type="button" @click="copyText(detail.repository.sshUrl, 'SSH address')"><Copy /> Copy</button>
                </div>
                <section class="panel-section">
                  <header><div><GitCommitHorizontal /><span><strong>Recent commits</strong><small>Latest activity on {{ detail.repository.defaultBranch }}</small></span></div><button type="button" @click="detailTab = 'commits'">View all</button></header>
                  <div v-if="detail.commits.length" class="compact-list">
                    <a v-for="commit in detail.commits.slice(0, 5)" :key="commit.sha" :href="commit.webUrl || detail.repository.webUrl" target="_blank" rel="noopener noreferrer">
                      <code>{{ commit.shortSha }}</code><span><strong>{{ firstLine(commit.message) }}</strong><small>{{ commit.authorName }} · {{ formatDateTime(commit.authoredAt) }}</small></span>
                    </a>
                  </div>
                  <p v-else class="empty-line">No commits yet.</p>
                </section>
                <section v-if="detail.releases.length" class="panel-section">
                  <header><div><PackageOpen /><span><strong>Releases</strong><small>Published versions</small></span></div></header>
                  <div class="release-list">
                    <a v-for="release in detail.releases.slice(0, 4)" :key="release.id" :href="release.webUrl" target="_blank" rel="noopener noreferrer">
                      <Tag /><span><strong>{{ release.name }}</strong><small>{{ release.tagName }} · {{ formatDateTime(release.publishedAt) }}</small></span>
                    </a>
                  </div>
                </section>
              </section>

              <section v-else-if="detailTab === 'commits'" class="commits-panel">
                <header class="section-heading"><div><h3>Recent commits</h3><p>Latest 20 commits from the default branch.</p></div><button type="button" class="mini-action" @click="reloadDetail('commits')"><RefreshCw /> Refresh</button></header>
                <div v-if="detail.commits.length" class="commit-list">
                  <a v-for="commit in detail.commits" :key="commit.sha" :href="commit.webUrl || detail.repository.webUrl" target="_blank" rel="noopener noreferrer">
                    <span class="commit-mark"><GitCommitHorizontal /></span>
                    <span><strong>{{ firstLine(commit.message) }}</strong><small>{{ commit.authorName }} · {{ formatDateTime(commit.authoredAt) }}</small></span>
                    <code>{{ commit.shortSha }}</code>
                  </a>
                </div>
                <p v-else class="empty-line">This repository has no commits.</p>
              </section>

              <section v-else-if="detailTab === 'refs'" class="refs-panel">
                <div class="ref-section">
                  <header class="section-heading"><div><h3>Branches</h3><p>Create a branch from an existing branch, tag or commit.</p></div></header>
                  <form class="inline-form" @submit.prevent="createBranch">
                    <label><span>New branch</span><input v-model="branchForm.name" required placeholder="feature/name" /></label>
                    <label><span>From</span><select v-model="branchForm.sourceRef"><option v-for="branch in detail.branches" :key="branch.name" :value="branch.name">{{ branch.name }}</option></select></label>
                    <button type="submit" class="primary-action" :disabled="creatingBranch || detail.repository.isArchived"><Plus />{{ creatingBranch ? "Creating…" : "Create" }}</button>
                  </form>
                  <div class="ref-list">
                    <div v-for="branch in detail.branches" :key="branch.name">
                      <GitBranch /><span><strong>{{ branch.name }}</strong><small>{{ branch.sha.slice(0, 8) }}<em v-if="branch.name === detail.repository.defaultBranch">Default</em><em v-if="branch.isProtected">Protected</em></small></span>
                      <button type="button" title="Delete branch" :disabled="branch.name === detail.repository.defaultBranch || branch.isProtected || detail.repository.isArchived" @click="deleteBranch(branch.name)"><Trash2 /></button>
                    </div>
                  </div>
                </div>
                <div class="ref-section">
                  <header class="section-heading"><div><h3>Tags</h3><p>Mark stable or important points in the repository.</p></div></header>
                  <form class="tag-form" @submit.prevent="createTag">
                    <label><span>Tag</span><input v-model="tagForm.name" required placeholder="v1.0.0" /></label>
                    <label><span>Target</span><select v-model="tagForm.target"><option v-for="branch in detail.branches" :key="branch.name" :value="branch.name">{{ branch.name }}</option></select></label>
                    <label class="tag-message"><span>Message</span><input v-model="tagForm.message" maxlength="500" placeholder="Optional release note" /></label>
                    <button type="submit" class="primary-action" :disabled="creatingTag || detail.repository.isArchived"><Tag />{{ creatingTag ? "Creating…" : "Create tag" }}</button>
                  </form>
                  <div v-if="detail.tags.length" class="ref-list">
                    <div v-for="repositoryTag in detail.tags" :key="repositoryTag.name">
                      <Tag /><span><strong>{{ repositoryTag.name }}</strong><small>{{ repositoryTag.sha.slice(0, 8) }}{{ repositoryTag.message ? ` · ${repositoryTag.message}` : "" }}</small></span>
                      <button type="button" title="Delete tag" :disabled="detail.repository.isArchived" @click="deleteTag(repositoryTag.name)"><Trash2 /></button>
                    </div>
                  </div>
                  <p v-else class="empty-line">No tags yet.</p>
                </div>
              </section>

              <section v-else-if="detailTab === 'snapshots'" class="snapshots-panel">
                <header class="section-heading">
                  <div><h3>Source snapshots</h3><p>Save the default branch and repository metadata to Personal Archive backup storage.</p></div>
                  <button type="button" class="primary-action" :disabled="creatingSnapshot || detail.repository.isEmpty" @click="createSnapshot"><FileArchive />{{ creatingSnapshot ? "Saving…" : "Save snapshot" }}</button>
                </header>
                <div class="snapshot-boundary"><Archive /><span><strong>Recovery boundary</strong><small>Snapshots protect current source. Full history, accounts and Forgejo settings remain covered by the server-level Forgejo backup.</small></span></div>
                <div v-if="detail.snapshots.length" class="snapshot-list">
                  <div v-for="snapshot in detail.snapshots" :key="snapshot.snapshotId">
                    <FileArchive /><span><strong>{{ snapshot.ref }}</strong><small>{{ formatDateTime(snapshot.createdAt) }} · {{ formatBytes(snapshot.archiveBytes) }}</small></span>
                    <a :href="client.codeRepositorySnapshotUrl(detail.repository.owner, detail.repository.name, snapshot.snapshotId)" title="Download snapshot"><Download /></a>
                  </div>
                </div>
                <p v-else class="empty-line">No source snapshots have been saved for this repository.</p>
              </section>

              <section v-else class="settings-panel">
                <header class="section-heading"><div><h3>Repository settings</h3><p>Changes are applied directly to Forgejo.</p></div></header>
                <form class="settings-form" @submit.prevent="saveRepositorySettings">
                  <label><span>Name</span><input v-model="settingsForm.name" required maxlength="100" pattern="[A-Za-z0-9][A-Za-z0-9._-]*" /></label>
                  <label><span>Default branch</span><select v-model="settingsForm.defaultBranch"><option v-for="branch in detail.branches" :key="branch.name" :value="branch.name">{{ branch.name }}</option></select></label>
                  <label class="wide"><span>Description</span><textarea v-model="settingsForm.description" maxlength="500" rows="3" /></label>
                  <label class="switch-row wide"><input v-model="settingsForm.isPrivate" type="checkbox" /><span><strong>Private repository</strong><small>Only authenticated Forgejo users can read it.</small></span></label>
                  <footer class="wide"><button type="submit" class="primary-action" :disabled="changingRepository === detail.repository.fullName"><Save />Save settings</button></footer>
                </form>
                <div class="archive-zone">
                  <div><Archive /><span><strong>{{ detail.repository.isArchived ? "Repository archived" : "Archive repository" }}</strong><small>{{ detail.repository.isArchived ? "Restore it to accept Git pushes again." : "Keeps the repository but stops Git pushes." }}</small></span></div>
                  <button type="button" class="secondary-action" @click="toggleArchive(detail.repository)">{{ detail.repository.isArchived ? "Restore" : "Archive" }}</button>
                </div>
                <div class="danger-zone">
                  <div><Trash2 /><span><strong>Permanently delete repository</strong><small>Archive it first, then type <code>{{ detail.repository.name }}</code>. Source history is removed from Forgejo.</small></span></div>
                  <div><input v-model="deleteConfirmation" :placeholder="detail.repository.name" /><button type="button" :disabled="!detail.repository.isArchived || deleteConfirmation !== detail.repository.name || deletingRepository" @click="permanentlyDeleteRepository">{{ deletingRepository ? "Deleting…" : "Delete permanently" }}</button></div>
                </div>
              </section>
            </div>
          </template>
        </aside>
      </section>
    </template>

    <Teleport to="body">
      <Transition name="repository-menu">
        <div
          v-if="activeActionRepository"
          class="repository-action-menu"
          :class="{ 'opens-up': actionMenuPosition.opensUp }"
          :style="{
            left: `${actionMenuPosition.left}px`,
            top: `${actionMenuPosition.top}px`,
            maxHeight: `${actionMenuPosition.maxHeight}px`
          }"
          role="menu"
          :aria-label="`${activeActionRepository.name} actions`"
          @click.stop
        >
          <button type="button" role="menuitem" @click="viewRepositoryFromMenu"><ChevronRight /> View details</button>
          <button type="button" role="menuitem" @click="copyRepositorySshFromMenu"><Copy /> Copy SSH address</button>
          <button type="button" role="menuitem" @click="changeRepositoryVisibilityFromMenu">
            <LockKeyhole v-if="!activeActionRepository.isPrivate" /><Unlock v-else />Make {{ activeActionRepository.isPrivate ? "public" : "private" }}
          </button>
          <button type="button" role="menuitem" @click="changeRepositoryArchiveStateFromMenu">
            <Archive />{{ activeActionRepository.isArchived ? "Restore" : "Archive" }}
          </button>
          <a :href="activeActionRepository.webUrl" target="_blank" rel="noopener noreferrer" role="menuitem" @click="closeRepositoryActionMenu">
            <ExternalLink /> Open in Forgejo
          </a>
        </div>
      </Transition>
    </Teleport>

    <div v-if="dialog" class="dialog-backdrop" role="presentation" @mousedown.self="closeDialog">
      <form v-if="dialog === 'create'" class="create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-repository-title" @submit.prevent="createRepository">
        <header><div><p>FORGEJO</p><h2 id="create-repository-title">Create repository</h2></div><button type="button" title="Close" aria-label="Close" :disabled="creating" @click="closeDialog"><X /></button></header>
        <label><span>Repository name</span><input v-model="createForm.name" required maxlength="100" pattern="[A-Za-z0-9][A-Za-z0-9._-]*" autofocus placeholder="project-name" /><small>Letters, numbers, dots, dashes, and underscores.</small></label>
        <label><span>Description <em>optional</em></span><textarea v-model="createForm.description" maxlength="500" rows="3" placeholder="What this repository contains" /></label>
        <div class="create-options">
          <label><input v-model="createForm.isPrivate" type="checkbox" /><span><strong>Private repository</strong><small>Only authorized Forgejo users can view it.</small></span></label>
          <label><input v-model="createForm.initialize" type="checkbox" /><span><strong>Initialize with README</strong><small>Leave off when pushing an existing local repository.</small></span></label>
        </div>
        <footer><button type="button" class="secondary-action" :disabled="creating" @click="closeDialog">Cancel</button><button type="submit" class="primary-action" :disabled="creating || !createForm.name.trim()"><RefreshCw v-if="creating" class="spinning" /><Plus v-else />{{ creating ? "Creating…" : "Create repository" }}</button></footer>
      </form>

      <form v-else class="create-dialog import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-repository-title" @submit.prevent="importRepository">
        <header><div><p>GITHUB MIGRATION</p><h2 id="import-repository-title">Import repository</h2></div><button type="button" title="Close" aria-label="Close" :disabled="importing" @click="closeDialog"><X /></button></header>
        <label><span>GitHub repository URL</span><input v-model="importForm.sourceUrl" required type="url" pattern="https://(www\.)?github\.com/.+" autofocus placeholder="https://github.com/owner/repository" @blur="inferImportName" /><small>Only HTTPS github.com addresses are accepted.</small></label>
        <div class="dialog-fields"><label><span>New repository name</span><input v-model="importForm.name" required maxlength="100" pattern="[A-Za-z0-9][A-Za-z0-9._-]*" /></label><label><span>GitHub token <em>private repositories only</em></span><input v-model="importForm.sourceToken" type="password" autocomplete="off" maxlength="512" placeholder="Used once and not saved by Personal Archive" /></label></div>
        <label><span>Description <em>optional</em></span><textarea v-model="importForm.description" maxlength="500" rows="2" /></label>
        <div class="create-options import-options">
          <label><input v-model="importForm.isPrivate" type="checkbox" /><span><strong>Private in Forgejo</strong><small>Recommended for personal development.</small></span></label>
          <label><input v-model="importForm.includeMetadata" type="checkbox" /><span><strong>Import GitHub metadata</strong><small>Issues, labels, milestones, pull requests and releases when available.</small></span></label>
          <label :class="{ disabled: Boolean(importForm.sourceToken) }"><input v-model="importForm.mirror" type="checkbox" :disabled="Boolean(importForm.sourceToken)" /><span><strong>Read-only mirror</strong><small>Public repositories only; refreshes from GitHub every eight hours.</small></span></label>
        </div>
        <p class="token-note"><LockKeyhole />The optional GitHub token is sent only to Forgejo for this migration and is cleared from this form afterward.</p>
        <footer><button type="button" class="secondary-action" :disabled="importing" @click="closeDialog">Cancel</button><button type="submit" class="primary-action" :disabled="importing || !importForm.sourceUrl.trim() || !importForm.name.trim()"><RefreshCw v-if="importing" class="spinning" /><Import v-else />{{ importing ? "Importing…" : "Import repository" }}</button></footer>
      </form>
    </div>
  </section>
</template>

<style scoped>
.code-page { --code-ink: var(--personal-text,#20201d); --code-muted: var(--personal-muted,#6a6f69); --code-line: var(--personal-border,#deded7); --code-surface: var(--personal-surface,#fff); --code-raised: var(--personal-surface-raised,#fff); --code-accent: var(--personal-accent,#397f75); --code-accent-strong: var(--personal-accent-strong,#245e56); --code-accent-soft: var(--personal-accent-soft,#dff0ec); width:min(100%,96rem); margin:0 auto; color:var(--code-ink); }
.code-header { display:flex; align-items:flex-end; justify-content:space-between; gap:1.5rem; border-bottom:1px solid var(--code-line); padding:.2rem 0 1rem; }
.code-eyebrow { display:flex; align-items:center; gap:.4rem; color:var(--code-accent-strong); font-size:.67rem; font-weight:850; letter-spacing:.12em; }
.code-eyebrow svg { width:.82rem; }
.code-header h1 { margin-top:.18rem; font-size:clamp(1.8rem,3vw,2.45rem); font-weight:850; letter-spacing:-.045em; }
.code-header>div:first-child>p:last-child { max-width:42rem; margin-top:.16rem; color:var(--code-muted); font-size:.82rem; }
.header-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:.5rem; }
.primary-action,.secondary-action,.mini-action { display:inline-flex; min-height:2.35rem; align-items:center; justify-content:center; gap:.42rem; border-radius:.62rem; padding:0 .78rem; font-size:.71rem; font-weight:780; transition:transform 140ms ease,border-color 140ms ease,background-color 140ms ease; }
.primary-action { border:1px solid var(--code-accent); background:var(--code-accent); color:#fff; }
.secondary-action,.mini-action { border:1px solid var(--code-line); background:var(--code-raised); color:var(--code-ink); }
.mini-action { min-height:2rem; padding:0 .58rem; font-size:.63rem; }
.primary-action:hover:not(:disabled),.secondary-action:hover:not(:disabled),.mini-action:hover:not(:disabled) { transform:translateY(-1px); }
.secondary-action:hover:not(:disabled),.mini-action:hover:not(:disabled) { border-color:var(--code-accent); background:var(--code-accent-soft); }
.primary-action:disabled,.secondary-action:disabled,.mini-action:disabled { cursor:not-allowed; opacity:.52; }
.primary-action svg,.secondary-action svg,.mini-action svg { width:.82rem; height:.82rem; }
.code-loading { min-height:18rem; display:flex; align-items:center; justify-content:center; gap:.6rem; color:var(--code-muted); font-size:.76rem; }
.code-message { display:flex; align-items:center; gap:.8rem; margin-top:1rem; border:1px solid var(--code-line); border-left-width:3px; border-radius:.7rem; background:var(--code-surface); padding:1rem; }
.code-message>svg { width:1.2rem; color:#b47a24; }.code-message>div { display:grid; flex:1; gap:.12rem; }.code-message strong { font-size:.8rem; }.code-message span { color:var(--code-muted); font-size:.7rem; }.code-message.is-warning { border-left-color:#b47a24; }.code-message.is-error { border-left-color:#b34f48; }.code-message.is-error>svg { color:#b34f48; }.code-message>button { color:var(--code-accent-strong); font-size:.7rem; font-weight:750; text-decoration:underline; }
.service-strip { display:grid; grid-template-columns:minmax(15rem,1.5fr) repeat(3,minmax(6rem,.55fr)) minmax(10rem,1fr); margin-top:1rem; border:1px solid var(--code-line); border-radius:.8rem; background:var(--code-surface); animation:code-rise 220ms ease-out both; }
.service-state,.service-stat { min-height:4.3rem; display:flex; align-items:center; border-right:1px solid var(--code-line); padding:.65rem .95rem; }.service-state { gap:.65rem; }.service-state>svg { width:1.1rem; color:#2e9a6d; }.service-state>span,.service-stat { display:grid; align-content:center; gap:.08rem; }.service-state strong,.service-stat strong { font-size:.75rem; font-weight:820; }.service-state small,.service-stat span { color:var(--code-muted); font-size:.59rem; }.service-stat:last-child { border-right:0; }.service-endpoint strong { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.66rem; }
.repository-workspace { display:grid; grid-template-columns:minmax(0,1fr); margin-top:1rem; overflow:hidden; border:1px solid var(--code-line); border-radius:.82rem; background:var(--code-surface); animation:code-rise 260ms ease-out both; transition:grid-template-columns 200ms ease; }.repository-workspace.has-detail { grid-template-columns:minmax(24rem,.8fr) minmax(32rem,1.2fr); }.repository-pane { min-width:0; }.repository-workspace.has-detail .repository-pane { border-right:1px solid var(--code-line); }
.repository-toolbar { display:flex; min-height:4rem; align-items:center; justify-content:space-between; gap:1rem; border-bottom:1px solid var(--code-line); padding:.7rem 1rem; }.repository-toolbar>span { color:var(--code-muted); font-size:.63rem; white-space:nowrap; }.repository-search { display:flex; width:min(30rem,100%); min-height:2.35rem; align-items:center; gap:.52rem; border:1px solid var(--code-line); border-radius:.6rem; background:var(--code-raised); padding:0 .7rem; }.repository-search:focus-within { border-color:var(--code-accent); box-shadow:0 0 0 3px color-mix(in srgb,var(--code-accent) 14%,transparent); }.repository-search svg { width:.86rem; color:var(--code-muted); }.repository-search input { min-width:0; flex:1; border:0; background:transparent; color:var(--code-ink); font-size:.73rem; outline:0; }
.repository-columns,.repository-row { display:grid; grid-template-columns:minmax(16rem,1.7fr) minmax(7rem,.7fr) minmax(4rem,.35fr) minmax(9rem,.7fr) 2.3rem; align-items:center; gap:.8rem; }.repository-columns { min-height:2.35rem; border-bottom:1px solid var(--code-line); padding:0 1rem; color:var(--code-muted); font-size:.56rem; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }.repository-row { position:relative; min-height:4.65rem; border-bottom:1px solid var(--code-line); padding:.65rem 1rem; transition:background-color 140ms ease,box-shadow 140ms ease; }.repository-row:last-child { border-bottom:0; }.repository-row:hover { background:color-mix(in srgb,var(--code-accent-soft) 34%,transparent); }.repository-row.is-selected { background:color-mix(in srgb,var(--code-accent-soft) 65%,transparent); box-shadow:inset 3px 0 var(--code-accent); }.repository-row.is-archived { opacity:.72; }
.repository-identity { min-width:0; display:flex; align-items:center; gap:.7rem; color:inherit; text-align:left; }.repository-icon { display:grid; width:2.2rem; height:2.2rem; flex:0 0 auto; place-items:center; border-radius:.52rem; background:var(--code-accent-soft); color:var(--code-accent-strong); }.repository-icon svg { width:.95rem; }.repository-identity>span:last-child { min-width:0; display:grid; gap:.12rem; }.repository-identity strong,.repository-identity small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.repository-identity strong { font-size:.77rem; font-weight:820; }.repository-identity small { color:var(--code-muted); font-size:.62rem; }.repository-identity:hover strong { color:var(--code-accent-strong); text-decoration:underline; }
.repository-access { display:flex; flex-wrap:wrap; gap:.3rem; }.repository-access span,.repository-access em { display:inline-flex; align-items:center; gap:.23rem; border-radius:999px; padding:.17rem .42rem; font-size:.56rem; font-style:normal; font-weight:780; }.repository-access span { background:color-mix(in srgb,var(--code-line) 55%,transparent); color:var(--code-muted); }.repository-access span.is-private { background:var(--code-accent-soft); color:var(--code-accent-strong); }.repository-access em { border:1px solid var(--code-line); color:var(--code-muted); }.repository-access svg { width:.62rem; }.repository-size,.repository-row time { color:var(--code-muted); font-size:.62rem; font-weight:650; }
.repository-action-trigger { display:grid; width:1.95rem; height:1.95rem; justify-self:end; place-items:center; border:1px solid transparent; border-radius:.48rem; color:var(--code-muted); }.repository-action-trigger:hover,.repository-action-trigger.active { border-color:var(--code-line); background:var(--code-raised); color:var(--code-ink); }.repository-action-trigger svg { width:.9rem; }
.repository-action-menu { --code-ink:var(--personal-text,#20201d); --code-muted:var(--personal-muted,#6a6f69); --code-line:var(--personal-border,#deded7); --code-raised:var(--personal-surface-raised,#fff); --code-accent-soft:var(--personal-accent-soft,#dff0ec); position:fixed; z-index:120; width:min(13rem,calc(100vw - 1.5rem)); overflow-x:hidden; overflow-y:auto; border:1px solid var(--code-line); border-radius:.62rem; background:var(--code-raised); padding:.3rem; color:var(--code-ink); box-shadow:0 12px 28px color-mix(in srgb,var(--code-ink) 18%,transparent); transform-origin:top right; }.repository-action-menu.opens-up { transform:translateY(-100%); transform-origin:bottom right; }.repository-action-menu button,.repository-action-menu a { display:flex; width:100%; min-height:2.05rem; align-items:center; gap:.48rem; border-radius:.38rem; padding:.32rem .52rem; color:var(--code-ink); font-size:.64rem; font-weight:650; text-align:left; }.repository-action-menu button:hover,.repository-action-menu a:hover,.repository-action-menu button:focus-visible,.repository-action-menu a:focus-visible { background:var(--code-accent-soft); outline:0; }.repository-action-menu svg { width:.75rem; flex:0 0 auto; }
.repository-menu-enter-active,.repository-menu-leave-active { transition:opacity 120ms ease,transform 120ms ease; }.repository-menu-enter-from:not(.opens-up),.repository-menu-leave-to:not(.opens-up) { opacity:0; transform:translateY(-4px) scale(.98); }.repository-menu-enter-from.opens-up,.repository-menu-leave-to.opens-up { opacity:0; transform:translateY(-100%) scale(.98); }
.empty-repositories { min-height:17rem; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:2rem; text-align:center; }.empty-repositories>svg { width:1.6rem; color:var(--code-accent); }.empty-repositories strong { margin-top:.7rem; font-size:.86rem; }.empty-repositories span { max-width:24rem; margin-top:.24rem; color:var(--code-muted); font-size:.66rem; }.empty-repositories button { margin-top:1rem; }.empty-repositories.is-compact { min-height:12rem; }
.detail-pane { min-width:0; background:color-mix(in srgb,var(--code-raised) 72%,var(--code-surface)); animation:detail-in 180ms ease-out both; }.detail-loading,.detail-error { min-height:24rem; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:.45rem; padding:2rem; color:var(--code-muted); font-size:.7rem; text-align:center; }.detail-loading { flex-direction:row; }.detail-error strong { color:var(--code-ink); font-size:.8rem; }.detail-error button { color:var(--code-accent-strong); font-weight:750; text-decoration:underline; }.detail-header { display:flex; min-height:5.7rem; align-items:flex-start; justify-content:space-between; gap:1rem; border-bottom:1px solid var(--code-line); padding:1rem 1.1rem .8rem; }.detail-header p { color:var(--code-accent-strong); font-size:.58rem; font-weight:820; letter-spacing:.08em; text-transform:uppercase; }.detail-header h2 { margin-top:.08rem; font-size:1.3rem; font-weight:850; letter-spacing:-.035em; }.detail-header span { display:block; max-width:32rem; margin-top:.14rem; color:var(--code-muted); font-size:.65rem; }.detail-header>div:last-child { display:flex; gap:.4rem; }.detail-header a,.detail-header button { display:grid; width:2.05rem; height:2.05rem; place-items:center; border:1px solid var(--code-line); border-radius:.52rem; color:var(--code-muted); }.detail-header svg { width:.86rem; }.detail-tabs { display:flex; overflow-x:auto; border-bottom:1px solid var(--code-line); padding:0 .8rem; }.detail-tabs button { position:relative; min-height:3rem; display:flex; align-items:center; gap:.32rem; padding:0 .65rem; color:var(--code-muted); font-size:.62rem; font-weight:760; white-space:nowrap; }.detail-tabs button::after { position:absolute; right:.65rem; bottom:-1px; left:.65rem; height:2px; content:""; background:transparent; }.detail-tabs button.active { color:var(--code-ink); }.detail-tabs button.active::after { background:var(--code-accent); }.detail-tabs span { border-radius:999px; background:color-mix(in srgb,var(--code-line) 60%,transparent); padding:.08rem .3rem; font-size:.52rem; }.detail-content { max-height:calc(100vh - 18rem); min-height:28rem; overflow-y:auto; padding:1rem; scroll-behavior:smooth; }
.repository-facts { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); border-block:1px solid var(--code-line); }.repository-facts>div { display:grid; gap:.25rem; border-right:1px solid var(--code-line); padding:.85rem .7rem; }.repository-facts>div:last-child { border-right:0; }.repository-facts span { color:var(--code-muted); font-size:.56rem; }.repository-facts strong { display:flex; align-items:center; gap:.32rem; font-size:.7rem; }.repository-facts svg { width:.72rem; color:var(--code-accent-strong); }.clone-block { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:end; gap:.7rem; margin-top:1rem; }.clone-block>div { min-width:0; display:grid; gap:.3rem; }.clone-block span { color:var(--code-muted); font-size:.57rem; }.clone-block code { overflow:hidden; border:1px solid var(--code-line); border-radius:.52rem; background:var(--code-surface); padding:.62rem .68rem; color:var(--code-ink); font-size:.6rem; text-overflow:ellipsis; white-space:nowrap; }.clone-block button { display:flex; min-height:2.15rem; align-items:center; gap:.35rem; border:1px solid var(--code-line); border-radius:.52rem; padding:0 .65rem; font-size:.62rem; font-weight:750; }.clone-block svg { width:.72rem; }
.panel-section,.ref-section { margin-top:1.2rem; }.panel-section>header,.section-heading { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:.55rem; }.panel-section>header>div { display:flex; align-items:center; gap:.5rem; }.panel-section>header svg,.section-heading svg { width:.9rem; color:var(--code-accent-strong); }.panel-section>header span { display:grid; }.panel-section>header strong,.section-heading h3 { font-size:.72rem; font-weight:820; }.panel-section>header small,.section-heading p { margin-top:.08rem; color:var(--code-muted); font-size:.56rem; }.panel-section>header>button { color:var(--code-accent-strong); font-size:.58rem; font-weight:750; }
.compact-list,.commit-list,.release-list,.ref-list,.snapshot-list { border-top:1px solid var(--code-line); }.compact-list a,.commit-list a,.release-list a,.ref-list>div,.snapshot-list>div { display:flex; min-width:0; align-items:center; gap:.6rem; border-bottom:1px solid var(--code-line); padding:.62rem .2rem; color:var(--code-ink); }.compact-list a:hover,.commit-list a:hover,.release-list a:hover { background:color-mix(in srgb,var(--code-accent-soft) 34%,transparent); }.compact-list code,.commit-list code { flex:0 0 auto; color:var(--code-accent-strong); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.56rem; }.compact-list span,.commit-list a>span:nth-child(2),.release-list span,.ref-list span,.snapshot-list span { min-width:0; display:grid; flex:1; gap:.1rem; }.compact-list strong,.commit-list strong,.release-list strong,.ref-list strong,.snapshot-list strong { overflow:hidden; font-size:.65rem; text-overflow:ellipsis; white-space:nowrap; }.compact-list small,.commit-list small,.release-list small,.ref-list small,.snapshot-list small { overflow:hidden; color:var(--code-muted); font-size:.55rem; text-overflow:ellipsis; white-space:nowrap; }.release-list>a>svg,.ref-list>div>svg,.snapshot-list>div>svg { width:.82rem; flex:0 0 auto; color:var(--code-accent-strong); }.commit-mark { display:grid; width:1.75rem; height:1.75rem; flex:0 0 auto; place-items:center; border-radius:50%; background:var(--code-accent-soft); color:var(--code-accent-strong); }.commit-mark svg { width:.78rem; }.commit-list a>code { margin-left:auto; }.empty-line { border-block:1px solid var(--code-line); padding:1rem .2rem; color:var(--code-muted); font-size:.62rem; }.ref-list em { display:inline-flex; margin-left:.35rem; border:1px solid var(--code-line); border-radius:999px; padding:.05rem .3rem; color:var(--code-accent-strong); font-size:.48rem; font-style:normal; font-weight:760; }.ref-list button,.snapshot-list a { display:grid; width:1.8rem; height:1.8rem; flex:0 0 auto; place-items:center; border-radius:.45rem; color:var(--code-muted); }.ref-list button:hover:not(:disabled),.snapshot-list a:hover { background:var(--code-accent-soft); color:var(--code-accent-strong); }.ref-list button:disabled { opacity:.28; }.ref-list button svg,.snapshot-list a svg { width:.75rem; }
.inline-form,.tag-form { display:grid; grid-template-columns:minmax(0,1fr) minmax(8rem,.75fr) auto; align-items:end; gap:.55rem; margin-bottom:.65rem; }.tag-form { grid-template-columns:minmax(0,.75fr) minmax(7rem,.55fr) minmax(0,1fr) auto; }.inline-form label,.tag-form label,.settings-form label { display:grid; gap:.28rem; }.inline-form label>span,.tag-form label>span,.settings-form label>span:first-child { color:var(--code-muted); font-size:.55rem; font-weight:720; }.inline-form input,.inline-form select,.tag-form input,.tag-form select,.settings-form input,.settings-form select,.settings-form textarea,.danger-zone input { width:100%; border:1px solid var(--code-line); border-radius:.5rem; background:var(--code-surface); padding:.58rem .62rem; color:var(--code-ink); font-size:.65rem; outline:0; }.inline-form input:focus,.inline-form select:focus,.tag-form input:focus,.tag-form select:focus,.settings-form input:focus,.settings-form select:focus,.settings-form textarea:focus,.danger-zone input:focus { border-color:var(--code-accent); box-shadow:0 0 0 3px color-mix(in srgb,var(--code-accent) 14%,transparent); }
.snapshot-boundary { display:flex; align-items:flex-start; gap:.6rem; margin:.8rem 0; border-left:3px solid var(--code-accent); background:color-mix(in srgb,var(--code-accent-soft) 45%,transparent); padding:.75rem; }.snapshot-boundary>svg { width:.9rem; flex:0 0 auto; color:var(--code-accent-strong); }.snapshot-boundary span { display:grid; gap:.12rem; }.snapshot-boundary strong { font-size:.64rem; }.snapshot-boundary small { color:var(--code-muted); font-size:.56rem; line-height:1.45; }
.settings-form { display:grid; grid-template-columns:1fr 1fr; gap:.75rem; }.settings-form .wide { grid-column:1/-1; }.switch-row { display:flex!important; align-items:flex-start; gap:.5rem; border-block:1px solid var(--code-line); padding:.7rem 0; }.switch-row input { width:auto; margin-top:.12rem; accent-color:var(--code-accent); }.switch-row>span { display:grid; gap:.1rem; }.switch-row strong { font-size:.64rem; }.switch-row small { color:var(--code-muted); font-size:.55rem; }.settings-form footer { display:flex; justify-content:flex-end; }.archive-zone,.danger-zone { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-top:1rem; border-top:1px solid var(--code-line); padding:1rem 0 0; }.archive-zone>div,.danger-zone>div:first-child { display:flex; align-items:flex-start; gap:.55rem; }.archive-zone svg,.danger-zone svg { width:.85rem; flex:0 0 auto; }.archive-zone span,.danger-zone span { display:grid; gap:.1rem; }.archive-zone strong,.danger-zone strong { font-size:.65rem; }.archive-zone small,.danger-zone small { color:var(--code-muted); font-size:.55rem; line-height:1.4; }.danger-zone { align-items:flex-start; border-color:color-mix(in srgb,#b34f48 45%,var(--code-line)); }.danger-zone>div:last-child { width:min(15rem,45%); display:grid; gap:.4rem; }.danger-zone button { min-height:2rem; border-radius:.48rem; background:#a9433d; color:#fff; font-size:.6rem; font-weight:780; }.danger-zone button:disabled { opacity:.35; }.danger-zone code { color:#a9433d; font-weight:750; }
.dialog-backdrop { position:fixed; z-index:80; inset:0; display:grid; place-items:center; overflow-y:auto; background:color-mix(in srgb,#101815 50%,transparent); padding:1rem; }.create-dialog { width:min(100%,36rem); border:1px solid var(--code-line); border-radius:1rem; background:var(--code-raised); color:var(--code-ink); box-shadow:0 24px 70px rgba(0,0,0,.24); animation:dialog-in 180ms ease-out both; }.import-dialog { width:min(100%,42rem); }.create-dialog>header { display:flex; align-items:flex-start; justify-content:space-between; border-bottom:1px solid var(--code-line); padding:1.05rem 1.15rem; }.create-dialog header p { color:var(--code-accent-strong); font-size:.6rem; font-weight:850; letter-spacing:.12em; }.create-dialog h2 { margin-top:.14rem; font-size:1.28rem; font-weight:840; letter-spacing:-.03em; }.create-dialog header button { display:grid; width:2.15rem; height:2.15rem; place-items:center; border:1px solid var(--code-line); border-radius:.54rem; }.create-dialog header button svg { width:.95rem; }.create-dialog>label { display:grid; gap:.36rem; padding:.85rem 1.15rem 0; }.create-dialog label>span { font-size:.68rem; font-weight:780; }.create-dialog label em { color:var(--code-muted); font-size:.57rem; font-style:normal; font-weight:600; }.create-dialog input:not([type="checkbox"]),.create-dialog textarea { width:100%; border:1px solid var(--code-line); border-radius:.56rem; background:var(--code-surface); padding:.66rem .72rem; color:var(--code-ink); font-size:.71rem; outline:0; }.create-dialog input:focus,.create-dialog textarea:focus { border-color:var(--code-accent); box-shadow:0 0 0 3px color-mix(in srgb,var(--code-accent) 14%,transparent); }.create-dialog label small { color:var(--code-muted); font-size:.57rem; }.dialog-fields { display:grid; grid-template-columns:1fr 1fr; gap:.65rem; padding:.85rem 1.15rem 0; }.dialog-fields label { display:grid; gap:.36rem; }.create-options { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.6rem; padding:.9rem 1.15rem; }.import-options { grid-template-columns:repeat(3,minmax(0,1fr)); }.create-options label { display:flex; align-items:flex-start; gap:.5rem; border:1px solid var(--code-line); border-radius:.62rem; padding:.65rem; }.create-options label.disabled { opacity:.48; }.create-options input { margin-top:.1rem; accent-color:var(--code-accent); }.create-options span { display:grid; gap:.08rem; }.create-options strong { font-size:.64rem; }.create-options small { color:var(--code-muted); font-size:.55rem; line-height:1.35; }.token-note { display:flex; align-items:center; gap:.4rem; margin:0 1.15rem .85rem; color:var(--code-muted); font-size:.55rem; }.token-note svg { width:.72rem; }.create-dialog>footer { display:flex; justify-content:flex-end; gap:.5rem; border-top:1px solid var(--code-line); padding:.8rem 1.15rem; }
.spinning { animation:code-spin .8s linear infinite; }@keyframes code-spin { to { transform:rotate(360deg); } }@keyframes code-rise { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:translateY(0); } }@keyframes detail-in { from { opacity:0; transform:translateX(8px); } to { opacity:1; transform:translateX(0); } }@keyframes dialog-in { from { opacity:0; transform:translateY(8px) scale(.99); } to { opacity:1; transform:translateY(0) scale(1); } }
@media (prefers-reduced-motion:reduce) { .service-strip,.repository-workspace,.detail-pane,.create-dialog,.repository-action-menu { animation:none; transition:none; } }
@media (max-width:1250px) { .repository-workspace.has-detail { grid-template-columns:minmax(20rem,.7fr) minmax(30rem,1.3fr); }.repository-workspace.has-detail .repository-columns { display:none; }.repository-workspace.has-detail .repository-row { grid-template-columns:minmax(0,1fr) auto; }.repository-workspace.has-detail .repository-access,.repository-workspace.has-detail .repository-size,.repository-workspace.has-detail .repository-row time { display:none; } }
@media (max-width:980px) { .service-strip { grid-template-columns:minmax(14rem,1.5fr) repeat(3,minmax(5rem,.5fr)); }.service-endpoint { grid-column:1/-1; border-top:1px solid var(--code-line); border-right:0; }.repository-workspace.has-detail { grid-template-columns:1fr; }.repository-workspace.has-detail .repository-pane { border-right:0; }.detail-pane { border-top:1px solid var(--code-line); }.detail-content { max-height:none; }.repository-columns,.repository-row { grid-template-columns:minmax(15rem,1.5fr) minmax(7rem,.7fr) minmax(8rem,.7fr) 2.3rem; }.repository-columns span:nth-child(3),.repository-size { display:none; }.tag-form { grid-template-columns:1fr 1fr; }.tag-message { grid-column:1/-1; }.tag-form button { justify-self:start; } }
@media (max-width:720px) { .code-header { align-items:flex-start; flex-direction:column; }.header-actions { width:100%; justify-content:flex-start; }.service-strip { grid-template-columns:repeat(2,minmax(0,1fr)); }.service-state { grid-column:1/-1; }.service-state,.service-stat { border-bottom:1px solid var(--code-line); }.service-stat:nth-child(3) { border-right:0; }.service-endpoint { grid-column:1/-1; border-bottom:0; }.repository-toolbar { align-items:flex-start; flex-direction:column; }.repository-columns { display:none; }.repository-row { grid-template-columns:minmax(0,1fr) auto; gap:.5rem; }.repository-access { grid-column:1; padding-left:2.9rem; }.repository-row time { grid-column:1; padding-left:2.9rem; }.repository-action-trigger { grid-column:2; grid-row:1; }.repository-size { display:none; }.detail-header { min-height:auto; }.detail-tabs { padding:0 .4rem; }.detail-content { min-height:22rem; padding:.8rem; }.repository-facts { grid-template-columns:1fr 1fr; }.repository-facts>div:nth-child(2) { border-right:0; }.repository-facts>div:nth-child(-n+2) { border-bottom:1px solid var(--code-line); }.clone-block,.inline-form,.tag-form,.settings-form,.dialog-fields,.create-options,.import-options { grid-template-columns:1fr; }.tag-message,.settings-form .wide { grid-column:auto; }.inline-form button,.tag-form button { justify-self:start; }.archive-zone,.danger-zone { align-items:flex-start; flex-direction:column; }.danger-zone>div:last-child { width:100%; }.create-dialog { border-radius:.8rem; }.header-actions .secondary-action:first-child { display:none; } }
</style>
