<script setup lang="ts">
import { ArrowDown, ArrowUp, BookOpenText, ChevronRight, EyeOff, Feather, FileText, FileUp, KeyRound, LoaderCircle, LockKeyhole, Plus, Search, Trash2, X } from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { client } from "../api/client";
import ArchiveManagementAccess from "../components/documents/ArchiveManagementAccess.vue";
import { useArchiveContentManagement } from "../composables/useArchiveContentManagement";
import { useDismissibleMenus } from "../composables/useDismissibleMenus";
import { useAuthStore } from "../stores/auth";
import { useToastStore } from "../stores/toasts";
import { MANUSCRIPT_KINDS, type Manuscript, type ManuscriptInput } from "../shared/types";
import { formatDateTime } from "../shared/format";
import { naturalCompare } from "../shared/naturalSort";
import { importManuscriptFile, MANUSCRIPT_IMPORT_ACCEPT, MANUSCRIPT_IMPORT_MAX_FILES, type ImportedManuscript } from "../shared/manuscriptImport";
import { unlockManuscriptWithPassword } from "../shared/manuscriptEncryption";
import { clearStagedManuscriptKey, stageManuscriptUnlockKey } from "../shared/manuscriptUnlockSession";

const router = useRouter();
const auth = useAuthStore();
const { canManageContent, setManagementExpiry, template } = useArchiveContentManagement();
const toasts = useToastStore();
useDismissibleMenus();

type ManuscriptSortField = "updated" | "title" | "created" | "kind" | "status" | "chapters" | "characters";
const MANUSCRIPT_SORT_STORAGE_KEY = "personal-archive.long-writing.sort";
const MANUSCRIPT_SORT_FIELDS: readonly ManuscriptSortField[] = ["updated", "title", "created", "kind", "status", "chapters", "characters"];
const MANUSCRIPT_SORT_LABELS: Record<ManuscriptSortField, string> = {
  updated: "Last updated",
  title: "Title",
  created: "Date created",
  kind: "Type",
  status: "Status",
  chapters: "Chapter count",
  characters: "Character count"
};
const storedManuscriptSort = localStorage.getItem(MANUSCRIPT_SORT_STORAGE_KEY) ?? "";
const [storedManuscriptSortField, storedManuscriptSortDirection] = storedManuscriptSort.split("_");
const initialManuscriptSort = MANUSCRIPT_SORT_FIELDS.includes(storedManuscriptSortField as ManuscriptSortField)
  && (storedManuscriptSortDirection === "asc" || storedManuscriptSortDirection === "desc")
  ? storedManuscriptSort
  : "updated_desc";
const items = ref<Manuscript[]>([]);
const catalog = ref<Manuscript[]>([]);
const query = ref("");
const sortOption = ref(initialManuscriptSort);
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const createOpen = ref(false);
const deletingId = ref("");
const protectedDialogOpen = ref(false);
const protectedPassword = ref("");
const protectedError = ref("");
const unlockingProtected = ref(false);
const unlockedProtectedIds = ref<Set<string>>(new Set());
const importInput = ref<HTMLInputElement | null>(null);
const importing = ref(false);
const importProgress = ref("");
const importNotice = ref("");
let searchTimer: ReturnType<typeof setTimeout> | null = null;

const form = reactive<ManuscriptInput>({
  title: "",
  kind: "Long document",
  status: "Draft",
  description: ""
});

const manuscriptSortParts = computed(() => {
  const [field, direction] = sortOption.value.split("_");
  return {
    field: (field || "updated") as ManuscriptSortField,
    direction: (direction === "asc" ? "asc" : "desc") as "asc" | "desc"
  };
});
const visibleItems = computed(() => items.value
  .filter((item) => !item.encryptionEnabled || unlockedProtectedIds.value.has(item.manuscriptId))
  .sort((left, right) => {
    let result = 0;
    const field = manuscriptSortParts.value.field;
    if (field === "title") result = naturalCompare(left.title, right.title);
    else if (field === "created") result = left.createdAt.localeCompare(right.createdAt);
    else if (field === "kind") result = naturalCompare(left.kind, right.kind);
    else if (field === "status") result = naturalCompare(left.status, right.status);
    else if (field === "chapters") result = left.chapterCount - right.chapterCount;
    else if (field === "characters") result = left.characterCount - right.characterCount;
    else result = left.updatedAt.localeCompare(right.updatedAt);
    if (result === 0) result = naturalCompare(left.title, right.title);
    if (result === 0) result = left.manuscriptId.localeCompare(right.manuscriptId);
    return manuscriptSortParts.value.direction === "asc" ? result : -result;
  }));
const protectedItems = computed(() => catalog.value.filter((item) => item.encryptionEnabled));
const unlockedProtectedCount = computed(() => protectedItems.value.filter(
  (item) => unlockedProtectedIds.value.has(item.manuscriptId)
).length);
const hiddenProtectedCount = computed(() => Math.max(0, protectedItems.value.length - unlockedProtectedCount.value));
const totalCharacters = computed(() => visibleItems.value.reduce((sum, item) => sum + item.characterCount, 0));
const manuscriptSortDirectionLabel = computed(() => {
  const { field, direction } = manuscriptSortParts.value;
  if (field === "updated" || field === "created") return direction === "asc" ? "Oldest first" : "Newest first";
  if (field === "chapters" || field === "characters") return direction === "asc" ? "Smallest first" : "Largest first";
  return direction === "asc" ? "A–Z" : "Z–A";
});
const manuscriptSortIcon = computed(() => manuscriptSortParts.value.direction === "asc" ? ArrowUp : ArrowDown);

function formatCount(value: number) {
  return new Intl.NumberFormat().format(value);
}

function kindIcon(kind: Manuscript["kind"]) {
  return kind === "Novel" || kind === "Memoir" ? Feather : FileText;
}

function setManuscriptSortField(event: Event) {
  const field = (event.target as HTMLSelectElement).value as ManuscriptSortField;
  if (!MANUSCRIPT_SORT_FIELDS.includes(field)) return;
  const descendingByDefault = ["updated", "created", "chapters", "characters"].includes(field);
  const direction = manuscriptSortParts.value.field === field
    ? manuscriptSortParts.value.direction
    : descendingByDefault ? "desc" : "asc";
  sortOption.value = `${field}_${direction}`;
}

function toggleManuscriptSortDirection() {
  const { field, direction } = manuscriptSortParts.value;
  sortOption.value = `${field}_${direction === "asc" ? "desc" : "asc"}`;
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const loaded = await client.manuscripts(query.value.trim());
    items.value = loaded;
    if (!query.value.trim()) catalog.value = loaded;
  } catch (loadError) {
    error.value = loadError instanceof Error ? loadError.message : "Unable to load long-form works";
  } finally {
    loading.value = false;
  }
}

function openProtectedDialog() {
  protectedPassword.value = "";
  protectedError.value = "";
  protectedDialogOpen.value = true;
}

function closeProtectedDialog() {
  if (unlockingProtected.value) return;
  protectedDialogOpen.value = false;
  protectedPassword.value = "";
  protectedError.value = "";
}

async function unlockProtectedWorks() {
  if (!protectedPassword.value || unlockingProtected.value) return;
  unlockingProtected.value = true;
  protectedError.value = "";
  try {
    const allItems = await client.manuscripts("");
    const encryptedItems = allItems.filter((item) => item.encryptionEnabled);
    const matchedIds = new Set<string>();

    for (const item of encryptedItems) {
      try {
        const key = await unlockManuscriptWithPassword(item, protectedPassword.value);
        stageManuscriptUnlockKey(item.manuscriptId, key);
        matchedIds.add(item.manuscriptId);
      } catch {
        // A password may intentionally unlock only one protected work.
      }
    }

    if (!matchedIds.size) {
      protectedError.value = "No protected work uses this password.";
      return;
    }

    unlockedProtectedIds.value = new Set([...unlockedProtectedIds.value, ...matchedIds]);
    catalog.value = allItems;
    items.value = allItems;
    query.value = "";
    protectedDialogOpen.value = false;
    protectedPassword.value = "";
    toasts.success(
      matchedIds.size === 1 ? "Protected work shown" : "Protected works shown",
      "The matching work key is held briefly in memory so you can open it without entering the password twice."
    );
  } catch (unlockError) {
    protectedError.value = unlockError instanceof Error ? unlockError.message : "Unable to check protected works.";
  } finally {
    unlockingProtected.value = false;
  }
}

function hideProtectedWorks() {
  for (const manuscriptId of unlockedProtectedIds.value) clearStagedManuscriptKey(manuscriptId);
  unlockedProtectedIds.value = new Set();
  toasts.info("Protected works hidden", "Their titles and details are no longer shown in Long writing.");
}

async function openWork(item: Manuscript) {
  await router.push(`/manuscripts/${item.manuscriptId}`);
}

function openCreate() {
  Object.assign(form, { title: "", kind: "Long document", status: "Draft", description: "" });
  createOpen.value = true;
}

async function create() {
  if (!form.title.trim() || saving.value) return;
  saving.value = true;
  error.value = "";
  try {
    const manuscript = await client.createManuscript({
      title: form.title.trim(),
      kind: form.kind,
      status: form.status,
      description: form.description?.trim() ?? ""
    });
    createOpen.value = false;
    toasts.success("Long-form work created", manuscript.title);
    await router.push(`/manuscripts/${manuscript.manuscriptId}`);
  } catch (createError) {
    error.value = createError instanceof Error ? createError.message : "Unable to create long-form work";
    toasts.error("Unable to create work", error.value);
  } finally {
    saving.value = false;
  }
}

function openImportPicker() {
  if (!auth.canAddNotes || importing.value) return;
  importInput.value?.click();
}

async function createImportedWork(input: ImportedManuscript): Promise<Manuscript> {
  let created: Manuscript | null = null;
  try {
    created = await client.createManuscript({
      title: input.title,
      kind: input.kind,
      status: "Draft",
      description: input.description
    });
    const initialChapter = created.chapters[0];
    if (!initialChapter) throw new Error("The new work did not contain its initial chapter.");
    const firstChapter = input.chapters[0];
    if (!firstChapter) throw new Error("The imported file did not contain a readable chapter.");
    await client.updateManuscriptChapter(created.manuscriptId, initialChapter.chapterId, {
      title: firstChapter.title,
      body: firstChapter.body,
      contentFormat: firstChapter.contentFormat,
      expectedRevision: initialChapter.revision,
      saveSource: "manual"
    });
    for (const [index, chapter] of input.chapters.slice(1).entries()) {
      await client.createManuscriptChapter(created.manuscriptId, {
        title: chapter.title,
        body: chapter.body,
        contentFormat: chapter.contentFormat,
        sortOrder: (index + 2) * 1000
      });
    }
    return await client.manuscript(created.manuscriptId);
  } catch (importError) {
    if (created) await client.deleteManuscript(created.manuscriptId).catch(() => undefined);
    throw importError;
  }
}

async function importFiles(event: Event) {
  const input = event.currentTarget as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  if (!files.length || importing.value) return;
  if (files.length > MANUSCRIPT_IMPORT_MAX_FILES) {
    error.value = `Choose no more than ${MANUSCRIPT_IMPORT_MAX_FILES} files at once.`;
    return;
  }
  importing.value = true;
  importNotice.value = "";
  error.value = "";
  const imported: Manuscript[] = [];
  const failures: string[] = [];
  try {
    for (const [index, file] of files.entries()) {
      importProgress.value = `Importing ${index + 1} of ${files.length}: ${file.name}`;
      try {
        imported.push(await createImportedWork(await importManuscriptFile(file)));
      } catch (importError) {
        failures.push(`${file.name}: ${importError instanceof Error ? importError.message : "Import failed."}`);
      }
    }
    await load();
    if (imported.length) {
      importNotice.value = `${imported.length} ${imported.length === 1 ? "work" : "works"} imported successfully.`;
      toasts.success(
        imported.length === 1 ? "Work imported" : "Works imported",
        imported.length === 1 ? imported[0].title : `${imported.length} files are now available in Long Writing.`
      );
    }
    if (failures.length) {
      const visibleFailures = failures.slice(0, 3).join(" · ");
      error.value = `${failures.length} ${failures.length === 1 ? "file" : "files"} could not be imported: ${visibleFailures}${failures.length > 3 ? " · …" : ""}`;
      toasts.error("Some files were not imported", visibleFailures);
    }
  } finally {
    importing.value = false;
    importProgress.value = "";
  }
}

async function deleteWork(item: Manuscript) {
  if (!auth.canEditDocuments || !canManageContent(item.managementOwnerUserId) || deletingId.value) return;
  if (!window.confirm(`Delete “${item.title}” and remove all of its chapters from Long writing?`)) return;
  deletingId.value = item.manuscriptId;
  try {
    await client.deleteManuscript(item.manuscriptId);
    items.value = items.value.filter((candidate) => candidate.manuscriptId !== item.manuscriptId);
    catalog.value = catalog.value.filter((candidate) => candidate.manuscriptId !== item.manuscriptId);
    clearStagedManuscriptKey(item.manuscriptId);
    const nextUnlockedIds = new Set(unlockedProtectedIds.value);
    nextUnlockedIds.delete(item.manuscriptId);
    unlockedProtectedIds.value = nextUnlockedIds;
    toasts.success("Work deleted", item.title);
  } catch (deleteError) {
    toasts.error("Unable to delete work", deleteError instanceof Error ? deleteError.message : "Please try again.");
  } finally {
    deletingId.value = "";
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  if (protectedDialogOpen.value) closeProtectedDialog();
  else if (createOpen.value) createOpen.value = false;
}

watch(query, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 220);
});
watch(sortOption, (value) => localStorage.setItem(MANUSCRIPT_SORT_STORAGE_KEY, value));

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  void load();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  if (searchTimer) clearTimeout(searchTimer);
});
</script>

<template>
  <div class="manuscript-library">
    <header class="library-heading">
      <div>
        <p class="library-eyebrow">Chapter-based writing</p>
        <h1>Long writing</h1>
        <p class="library-description">Novels and long documents, organized by chapter.</p>
      </div>
      <div class="personal-page-actions">
        <details class="personal-action-menu" data-dismissible-menu>
          <summary class="btn-secondary flex h-8 cursor-pointer list-none items-center px-2.5 text-xs">
            <Search class="h-3.5 w-3.5" /> Search
            <span v-if="query" class="h-1.5 w-1.5 rounded-full bg-accent-700" aria-label="Search active" />
          </summary>
          <div class="personal-action-panel">
            <p class="personal-action-panel-heading">Search long writing</p>
            <label class="library-search library-search--menu">
              <Search class="h-4 w-4" />
              <input v-model="query" type="search" placeholder="Titles, descriptions, or chapter text…" />
              <button v-if="query" class="dialog-close !h-7 !w-7 shrink-0 border-0" type="button" title="Clear search" @click="query = ''"><X /></button>
            </label>
          </div>
        </details>

        <details class="personal-action-menu" data-dismissible-menu>
          <summary class="btn-secondary flex h-8 cursor-pointer list-none items-center px-2.5 text-xs">
            <BookOpenText class="h-3.5 w-3.5" /> Overview
            <span class="personal-action-count">{{ visibleItems.length }}</span>
          </summary>
          <div class="personal-action-panel">
            <p class="personal-action-panel-heading">Writing overview</p>
            <div class="grid gap-2 text-sm">
              <div class="flex items-center justify-between"><span class="text-ink-500">Works shown</span><strong>{{ visibleItems.length }}</strong></div>
              <div class="flex items-center justify-between"><span class="text-ink-500">Characters</span><strong>{{ formatCount(totalCharacters) }}</strong></div>
            </div>
          </div>
        </details>

        <ArchiveManagementAccess v-if="template.personalArchive && auth.user?.role === 'Admin'" @change="setManagementExpiry" />
        <button class="btn-primary h-8 px-2.5 text-xs" type="button" :disabled="!auth.canAddNotes" @click="openCreate">
          <Plus class="h-3.5 w-3.5" /> New work
        </button>
        <button class="btn-secondary h-8 px-2.5 text-xs" type="button" :disabled="!auth.canAddNotes || importing" title="Import one or several TXT, Markdown, or EPUB files" @click="openImportPicker">
          <LoaderCircle v-if="importing" class="h-3.5 w-3.5 animate-spin" />
          <FileUp v-else class="h-3.5 w-3.5" /> {{ importing ? "Importing…" : "Import files" }}
        </button>
        <input ref="importInput" class="sr-only" type="file" multiple :accept="MANUSCRIPT_IMPORT_ACCEPT" @change="importFiles" />
      </div>
    </header>

    <p v-if="error" class="mt-3 text-sm font-semibold text-legal-red">{{ error }}</p>
    <p v-if="importProgress" class="import-status" role="status"><LoaderCircle class="animate-spin" />{{ importProgress }}</p>
    <p v-else-if="importNotice" class="import-status import-status--success" role="status"><FileUp />{{ importNotice }} EPUB images and styles are skipped.</p>

    <div class="library-sort-bar">
      <span>{{ visibleItems.length }} {{ visibleItems.length === 1 ? "work" : "works" }}</span>
      <div role="group" aria-label="Long writing sorting">
        <label for="manuscript-sort-field">Sort by</label>
        <select id="manuscript-sort-field" :value="manuscriptSortParts.field" @change="setManuscriptSortField">
          <option v-for="field in MANUSCRIPT_SORT_FIELDS" :key="field" :value="field">{{ MANUSCRIPT_SORT_LABELS[field] }}</option>
        </select>
        <button type="button" :title="`Reverse order. Currently ${manuscriptSortDirectionLabel}.`" @click="toggleManuscriptSortDirection">
          <component :is="manuscriptSortIcon" /> <span>{{ manuscriptSortDirectionLabel }}</span>
        </button>
      </div>
    </div>

    <section class="work-list" aria-live="polite">
      <div v-if="protectedItems.length" class="protected-row" :class="{ revealed: unlockedProtectedCount > 0 }">
        <span class="protected-icon"><LockKeyhole /></span>
        <span class="protected-copy">
          <strong>{{ unlockedProtectedCount ? `${unlockedProtectedCount} protected ${unlockedProtectedCount === 1 ? "work" : "works"} visible` : "Protected works are hidden" }}</strong>
          <small>{{ hiddenProtectedCount ? "Encrypted titles stay out of this list until their password is entered." : "All matching encrypted works are visible for this visit." }}</small>
        </span>
        <button v-if="hiddenProtectedCount" class="protected-action" type="button" @click="openProtectedDialog">
          <KeyRound /> {{ unlockedProtectedCount ? "Show another" : "Show protected works" }}
        </button>
        <button v-if="unlockedProtectedCount" class="protected-action is-quiet" type="button" @click="hideProtectedWorks">
          <EyeOff /> Hide again
        </button>
      </div>

      <article
        v-for="item in visibleItems"
        :key="item.manuscriptId"
        class="work-row"
      >
        <button class="work-open" type="button" @click="openWork(item)">
          <span class="work-icon"><component :is="kindIcon(item.kind)" /></span>
          <span class="work-main">
            <strong>{{ item.title }} <LockKeyhole v-if="item.encryptionEnabled" class="work-lock" aria-label="Encrypted body" /></strong>
            <span>{{ item.description || (item.kind === "Novel" ? "A chapter-based novel" : "A chapter-based long document") }}</span>
          </span>
          <span class="work-kind">{{ item.kind }}</span>
          <span class="work-metric"><strong>{{ item.chapterCount }}</strong><small>chapters</small></span>
          <span class="work-metric"><strong>{{ formatCount(item.characterCount) }}</strong><small>characters</small></span>
          <span class="work-updated">{{ formatDateTime(item.updatedAt) }}</span>
          <ChevronRight class="work-arrow" />
        </button>
        <button
          class="work-delete"
          type="button"
          :disabled="!auth.canEditDocuments || !canManageContent(item.managementOwnerUserId) || deletingId === item.manuscriptId"
          :title="`Delete ${item.title}`"
          :aria-label="`Delete ${item.title}`"
          @click="deleteWork(item)"
        ><Trash2 /></button>
      </article>

      <div v-if="loading && !visibleItems.length && !protectedItems.length" class="library-empty">
        <BookOpenText class="h-7 w-7" />
        <p>Loading your writing library…</p>
      </div>
      <div v-else-if="!visibleItems.length && (query || !protectedItems.length)" class="library-empty">
        <BookOpenText class="h-7 w-7" />
        <h2>{{ query ? "No matching works" : "Start a long-form work" }}</h2>
        <p>{{ query ? "Try a different search." : "Create a novel or long document. The first chapter is prepared automatically." }}</p>
        <button v-if="!query" class="btn-primary mt-2" type="button" :disabled="!auth.canAddNotes" @click="openCreate">
          <Plus class="h-4 w-4" /> New work
        </button>
      </div>
    </section>

    <div v-if="createOpen" class="create-backdrop" @mousedown.self="createOpen = false">
      <form class="create-dialog" @submit.prevent="create">
        <div class="create-dialog-heading">
          <div>
            <p class="library-eyebrow">New long-form work</p>
            <h2>Choose a clear working title</h2>
          </div>
          <button class="dialog-close" type="button" title="Close" @click="createOpen = false"><X /></button>
        </div>

        <label>
          <span>Title</span>
          <input v-model="form.title" class="input" autofocus required maxlength="240" placeholder="Example: Family records handbook" />
        </label>
        <label>
          <span>Type</span>
          <select v-model="form.kind" class="input">
            <option v-for="kind in MANUSCRIPT_KINDS" :key="kind" :value="kind">{{ kind }}</option>
          </select>
        </label>
        <label>
          <span>Description <small>optional</small></span>
          <textarea v-model="form.description" class="input min-h-24" maxlength="5000" placeholder="What this work contains or who it is for." />
        </label>
        <div class="flex justify-end gap-2">
          <button class="btn-secondary" type="button" @click="createOpen = false">Cancel</button>
          <button class="btn-primary" type="submit" :disabled="saving || !form.title.trim()">
            {{ saving ? "Creating…" : "Create and write" }}
          </button>
        </div>
      </form>
    </div>

    <div v-if="protectedDialogOpen" class="create-backdrop" @mousedown.self="closeProtectedDialog">
      <form class="create-dialog protected-dialog" @submit.prevent="unlockProtectedWorks">
        <div class="create-dialog-heading">
          <div>
            <p class="library-eyebrow">Protected writing</p>
            <h2>Show encrypted works</h2>
          </div>
          <button class="dialog-close" type="button" title="Close" :disabled="unlockingProtected" @click="closeProtectedDialog"><X /></button>
        </div>

        <p class="protected-dialog-copy">Enter a work’s encryption password. Only works using that password will appear in the library.</p>
        <label>
          <span>Encryption password</span>
          <input
            v-model="protectedPassword"
            class="input"
            type="password"
            autocomplete="current-password"
            autofocus
            required
            placeholder="Enter the password for a protected work"
          />
        </label>
        <p v-if="protectedError" class="protected-error" role="alert">{{ protectedError }}</p>
        <p class="protected-privacy"><LockKeyhole /> Checked locally in this browser and never saved.</p>
        <div class="flex justify-end gap-2">
          <button class="btn-secondary" type="button" :disabled="unlockingProtected" @click="closeProtectedDialog">Cancel</button>
          <button class="btn-primary" type="submit" :disabled="unlockingProtected || !protectedPassword">
            <KeyRound class="h-4 w-4" /> {{ unlockingProtected ? "Checking…" : "Show matching works" }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.manuscript-library { max-width: 1420px; margin: 0 auto; padding: 0.25rem 0 3rem; }
.library-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.2rem 0 .65rem; border-bottom: 1px solid var(--personal-border, #dedbd1); }
.library-heading h1 { margin-top: .08rem; color: var(--personal-text, #213e3b); font-size: clamp(1.45rem, 2vw, 1.85rem); font-weight: 820; letter-spacing: -.04em; }
.library-eyebrow { color: var(--personal-muted, #54716d); font-size: .7rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
.library-description { margin-top: .18rem; color: var(--personal-muted, #66736e); font-size: .78rem; }
.import-status { display: flex; align-items: center; gap: .45rem; margin: .65rem 0 0; border: 1px solid color-mix(in srgb, var(--personal-accent, #4fa69e) 35%, var(--personal-border, #dedbd1)); border-radius: .65rem; background: color-mix(in srgb, var(--personal-accent, #4fa69e) 7%, transparent); padding: .55rem .7rem; color: var(--personal-muted, #5f716c); font-size: .72rem; font-weight: 700; }
.import-status--success { color: var(--personal-text, #264642); }
.import-status svg { width: .85rem; height: .85rem; flex: 0 0 auto; }
.library-search { display: flex; width: min(100%, 620px); height: 2.65rem; align-items: center; gap: .65rem; border: 1px solid var(--personal-border, #d9d6cc); border-radius: .75rem; background: var(--personal-surface, #fff); padding: 0 .85rem; color: var(--personal-muted, #67736f); }
.library-search--menu { width: 100%; height: 2.35rem; }
.library-search:focus-within { border-color: #5caaa3; box-shadow: 0 0 0 3px rgba(79, 166, 158, .11); }
.library-search input { min-width: 0; flex: 1; border: 0; background: transparent; color: var(--personal-text, #263c39); font-size: .86rem; outline: none; }
.library-sort-bar { display: flex; min-height: 2.8rem; align-items: center; justify-content: space-between; gap: .75rem; border-bottom: 1px solid var(--personal-border, #e2dfd6); padding: .42rem .25rem; color: var(--personal-muted, #66736e); font-size: .7rem; font-weight: 700; }
.library-sort-bar > div { display: flex; min-width: 0; align-items: center; gap: .35rem; }
.library-sort-bar label { flex: 0 0 auto; }
.library-sort-bar select, .library-sort-bar button { height: 2rem; border: 1px solid var(--personal-border, #d9d6cc); border-radius: .55rem; background: var(--personal-surface-raised, var(--personal-surface, #fff)); color: var(--personal-text, #263c39); }
.library-sort-bar select { min-width: 8.5rem; padding: 0 1.7rem 0 .55rem; }
.library-sort-bar button { display: inline-flex; align-items: center; gap: .3rem; padding: 0 .55rem; transition: border-color .15s ease, background-color .15s ease; }
.library-sort-bar button:hover { border-color: var(--personal-accent, #4fa69e); background: color-mix(in srgb, var(--personal-accent, #4fa69e) 8%, var(--personal-surface, #fff)); }
.library-sort-bar button svg { width: .78rem; height: .78rem; }
.work-list { border-top: 0; }
.protected-row { display: flex; min-height: 4.2rem; align-items: center; gap: .72rem; border-bottom: 1px solid var(--personal-border, #e2dfd6); background: color-mix(in srgb, var(--personal-accent, #4fa69e) 5%, transparent); padding: .65rem .75rem; animation: protected-row-in .18s ease-out both; }
.protected-row.revealed { background: color-mix(in srgb, var(--personal-accent, #4fa69e) 9%, transparent); }
.protected-icon { display: grid; width: 2.2rem; height: 2.2rem; flex: 0 0 auto; place-items: center; border-radius: .65rem; background: color-mix(in srgb, var(--personal-accent, #4fa69e) 15%, transparent); color: var(--personal-text, #244a46); }
.protected-icon svg { width: .96rem; height: .96rem; }
.protected-copy { min-width: 0; display: grid; flex: 1; gap: .12rem; }
.protected-copy strong { font-size: .82rem; }
.protected-copy small { color: var(--personal-muted, #6c746f); font-size: .7rem; }
.protected-action { display: inline-flex; min-height: 2.15rem; flex: 0 0 auto; align-items: center; gap: .35rem; border: 1px solid color-mix(in srgb, var(--personal-accent, #4fa69e) 48%, var(--personal-border, #dedbd1)); border-radius: .6rem; background: var(--personal-surface-raised, var(--personal-surface, #fff)); padding: 0 .65rem; color: var(--personal-text, #263c39); font-size: .68rem; font-weight: 760; transition: background-color .15s ease, border-color .15s ease, transform .15s ease; }
.protected-action:hover { border-color: var(--personal-accent, #4fa69e); background: color-mix(in srgb, var(--personal-accent, #4fa69e) 10%, var(--personal-surface, #fff)); transform: translateY(-1px); }
.protected-action.is-quiet { border-color: transparent; background: transparent; color: var(--personal-muted, #64716c); }
.protected-action svg { width: .78rem; height: .78rem; }
.work-row { display: flex; width: 100%; align-items: center; border-bottom: 1px solid var(--personal-border, #e2dfd6); color: var(--personal-text, #263c39); transition: background-color .16s ease; }
.work-row:hover { background: color-mix(in srgb, var(--personal-accent, #4fa69e) 8%, transparent); }
.work-open { display: grid; min-width: 0; flex: 1; grid-template-columns: 2.5rem minmax(240px, 1fr) 9rem 6.5rem 8.5rem 11rem 1.25rem; align-items: center; gap: .8rem; padding: .85rem .25rem .85rem .5rem; text-align: left; transition: padding-left .16s ease; }
.work-row:hover .work-open { padding-left: .75rem; }
.work-delete { display: grid; width: 2.2rem; height: 2.2rem; flex: 0 0 auto; place-items: center; margin: 0 .35rem; border-radius: .55rem; color: var(--personal-muted, #77807b); opacity: .62; transition: background-color .15s ease, color .15s ease, opacity .15s ease; }
.work-row:hover .work-delete, .work-delete:focus-visible { opacity: 1; }
.work-delete:hover { background: color-mix(in srgb, #bb322d 10%, transparent); color: #b12e29; }
.work-delete:disabled { cursor: wait; opacity: .35; }
.work-delete svg { width: .9rem; height: .9rem; }
.work-icon { display: grid; width: 2.2rem; height: 2.2rem; place-items: center; border-radius: .65rem; background: color-mix(in srgb, var(--personal-accent, #4fa69e) 14%, transparent); color: var(--personal-text, #244a46); }
.work-icon :deep(svg) { width: 1rem; height: 1rem; }
.work-main { min-width: 0; }
.work-main strong, .work-main span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.work-main strong { font-size: .94rem; }
.work-main strong { display: flex; align-items: center; gap: .35rem; }
.work-main .work-lock { width: .75rem; height: .75rem; flex: 0 0 auto; color: var(--personal-accent, #4fa69e); }
.work-main span { margin-top: .14rem; color: var(--personal-muted, #6c746f); font-size: .75rem; }
.work-kind { color: var(--personal-muted, #64716c); font-size: .75rem; font-weight: 700; }
.work-metric strong, .work-metric small { display: block; }
.work-metric strong { font-size: .82rem; }
.work-metric small { margin-top: .08rem; color: var(--personal-muted, #77807b); font-size: .65rem; }
.work-updated { color: var(--personal-muted, #77807b); font-size: .7rem; }
.work-arrow { width: 1rem; height: 1rem; color: var(--personal-muted, #78817c); }
.library-empty { display: grid; min-height: 18rem; place-items: center; align-content: center; gap: .5rem; color: var(--personal-muted, #66736e); text-align: center; }
.library-empty h2 { color: var(--personal-text, #263c39); font-size: 1.05rem; }
.library-empty p { max-width: 32rem; font-size: .82rem; }
.create-backdrop { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; background: rgba(18, 27, 24, .46); padding: 1rem; backdrop-filter: blur(5px); }
.create-dialog { width: min(100%, 34rem); border: 1px solid var(--personal-border, #d9d6cc); border-radius: 1rem; background: var(--personal-surface, #fffdf8); padding: 1.2rem; box-shadow: 0 28px 80px rgba(24, 35, 31, .22); }
.create-dialog-heading { display: flex; align-items: start; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
.create-dialog-heading h2 { margin-top: .15rem; font-size: 1.18rem; font-weight: 800; }
.dialog-close { display: grid; width: 2.2rem; height: 2.2rem; place-items: center; border: 1px solid var(--personal-border, #d9d6cc); border-radius: .65rem; }
.dialog-close svg { width: 1rem; height: 1rem; }
.create-dialog label { display: block; margin-bottom: .85rem; }
.create-dialog label > span { display: block; margin-bottom: .35rem; color: var(--personal-muted, #5e6e69); font-size: .7rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
.create-dialog label small { font-weight: 600; text-transform: none; }
.protected-dialog { animation: protected-dialog-in .18s ease-out both; }
.protected-dialog-copy { margin: -.25rem 0 1rem; color: var(--personal-muted, #65736e); font-size: .78rem; line-height: 1.5; }
.protected-error { margin: -.25rem 0 .75rem; border-left: 3px solid #b12e29; background: color-mix(in srgb, #b12e29 8%, transparent); padding: .55rem .65rem; color: #a52d28; font-size: .72rem; font-weight: 700; }
.protected-privacy { display: flex; align-items: center; gap: .4rem; margin: -.15rem 0 1rem; color: var(--personal-muted, #6c746f); font-size: .68rem; }
.protected-privacy svg { width: .76rem; height: .76rem; }
@keyframes protected-row-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
@keyframes protected-dialog-in { from { opacity: 0; transform: translateY(7px) scale(.99); } to { opacity: 1; transform: translateY(0) scale(1); } }
@media (prefers-reduced-motion: reduce) { .protected-row, .protected-dialog { animation: none; }.protected-action { transition: none; } }
@media (max-width: 1100px) { .work-open { grid-template-columns: 2.5rem minmax(180px, 1fr) 7rem 6rem 7.5rem 1.25rem; }.work-updated { display: none; } }
@media (max-width: 760px) { .library-heading { align-items: stretch; flex-direction: column; }.library-sort-bar { align-items: flex-start; flex-direction: column; padding: .55rem 0; }.library-sort-bar > div { width: 100%; }.library-sort-bar select { min-width: 0; flex: 1; }.library-sort-bar button span { display: none; }.protected-row { align-items: flex-start; flex-wrap: wrap; }.protected-copy { min-width: calc(100% - 3rem); }.protected-action { margin-left: 2.9rem; }.protected-action.is-quiet { margin-left: 0; }.work-open { grid-template-columns: 2.5rem minmax(0, 1fr) 1.25rem; }.work-kind, .work-metric, .work-updated { display: none; }.work-delete { opacity: 1; } }
</style>
