<script setup lang="ts">
import { Pencil, Plus, Save, Trash2, X } from "lucide-vue-next";
import { onMounted, reactive, ref } from "vue";
import { client } from "../api/client";
import { useBusinessTemplate } from "../businessTemplate";
import PageHeader from "../components/PageHeader.vue";
import { useI18n } from "../i18n";
import type { Tag } from "../shared/types";
import { useAuthStore } from "../stores/auth";
import { useToastStore } from "../stores/toasts";

const { t } = useI18n();
const { labels } = useBusinessTemplate();
const auth = useAuthStore();
const toasts = useToastStore();
const tags = ref<Tag[]>([]);
const saving = ref(false);
const updating = ref(false);
const deletingTagId = ref("");
const editingTagId = ref("");
const error = ref("");
const form = reactive({
  name: "",
  color: "#2c827f"
});
const editForm = reactive({
  name: "",
  color: "#2c827f"
});

function normalizeTagName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

async function load() {
  tags.value = await client.tags();
}

async function createTag() {
  if (!form.name.trim()) return;
  saving.value = true;
  error.value = "";
  try {
    const tag = await client.createTag({ name: normalizeTagName(form.name), color: form.color });
    form.name = "";
    form.color = "#2c827f";
    toasts.success("Tag created", `${tag.name} is available for ${labels.value.lowerPlural} and documents.`);
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to create tag";
    toasts.error("Unable to create tag", error.value);
  } finally {
    saving.value = false;
  }
}

function startEdit(tag: Tag) {
  editingTagId.value = tag.tagId;
  editForm.name = tag.name;
  editForm.color = tag.color;
  error.value = "";
}

function cancelEdit() {
  editingTagId.value = "";
  editForm.name = "";
  editForm.color = "#2c827f";
}

async function updateTag(tag: Tag) {
  if (!normalizeTagName(editForm.name)) return;
  updating.value = true;
  error.value = "";
  try {
    const updated = await client.updateTag(tag.tagId, { name: normalizeTagName(editForm.name), color: editForm.color });
    toasts.success("Tag updated", `${updated.name} was saved.`);
    cancelEdit();
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to update tag";
    toasts.error("Unable to update tag", error.value);
  } finally {
    updating.value = false;
  }
}

async function deleteTag(tag: Tag) {
  if (!window.confirm(`Delete tag "${tag.name}"? It will be removed from related ${labels.value.lowerPlural} and documents.`)) return;
  deletingTagId.value = tag.tagId;
  error.value = "";
  try {
    await client.deleteTag(tag.tagId);
    toasts.success("Tag deleted", `${tag.name} was removed from ${labels.value.lowerPlural} and documents.`);
    if (editingTagId.value === tag.tagId) cancelEdit();
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to delete tag";
    toasts.error("Unable to delete tag", error.value);
  } finally {
    deletingTagId.value = "";
  }
}

onMounted(load);
</script>

<template>
  <PageHeader
    eyebrow="Classification"
    :title="t('tags')"
    :description="`Tags help filter ${labels.lowerPlural} and documents by urgency, service type, customer priority, or follow-up status.`"
  />

  <section class="grid gap-3 xl:grid-cols-[0.75fr_1fr]">
    <form class="panel p-5" @submit.prevent="createTag">
      <h2 class="font-semibold">Create tag</h2>
      <p class="mt-1 text-sm text-ink-500">Use short operational labels such as pbx, network, urgent, waiting-customer, or follow-up.</p>
      <div class="mt-5 grid gap-3 sm:grid-cols-[1fr_96px]">
        <label class="text-sm font-semibold">
          Name
          <input v-model="form.name" class="input mt-1" placeholder="urgent" :disabled="!auth.canEditCases" />
        </label>
        <label class="text-sm font-semibold">
          Color
          <input v-model="form.color" class="mt-1 h-10 w-full rounded-md border border-ink-200 bg-white px-2" type="color" :disabled="!auth.canEditCases" />
        </label>
      </div>
      <p v-if="error" class="mt-3 text-sm font-semibold text-legal-red">{{ error }}</p>
      <button class="btn-primary mt-4" type="submit" :disabled="!auth.canEditCases || saving || !form.name.trim()">
        <Plus class="h-4 w-4" />
        {{ saving ? "Creating..." : "Create tag" }}
      </button>
    </form>

    <section class="panel p-5">
      <h2 class="mb-4 font-semibold">Available tags</h2>
      <div class="grid gap-3">
        <div
          v-for="tag in tags"
          :key="tag.tagId"
          class="rounded-md border border-ink-200 bg-white p-3"
        >
          <div v-if="editingTagId === tag.tagId" class="grid gap-3 md:grid-cols-[1fr_96px_auto]">
            <label class="text-sm font-semibold">
              Name
              <input v-model="editForm.name" class="input mt-1" :disabled="updating" />
            </label>
            <label class="text-sm font-semibold">
              Color
              <input v-model="editForm.color" class="mt-1 h-10 w-full rounded-md border border-ink-200 bg-white px-2" type="color" :disabled="updating" />
            </label>
            <div class="flex items-end gap-2">
              <button class="btn-primary" type="button" :disabled="updating || !normalizeTagName(editForm.name)" @click="updateTag(tag)">
                <Save class="h-4 w-4" />
                Save
              </button>
              <button class="btn-secondary px-3" type="button" :disabled="updating" @click="cancelEdit">
                <X class="h-4 w-4" />
              </button>
            </div>
          </div>
          <div v-else class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-3">
              <span class="h-4 w-4 shrink-0 rounded-full" :style="{ backgroundColor: tag.color }" />
              <span class="truncate rounded-full px-3 py-1 text-sm font-semibold text-white" :style="{ backgroundColor: tag.color }">
                {{ tag.name }}
              </span>
              <span class="text-xs font-semibold text-ink-500">{{ tag.color }}</span>
            </div>
            <div class="flex gap-2">
              <button class="btn-secondary h-9 px-3" type="button" :disabled="!auth.canEditCases" @click="startEdit(tag)">
                <Pencil class="h-4 w-4" />
                Edit
              </button>
              <button
                class="btn-secondary h-9 px-3 text-legal-red"
                type="button"
                :disabled="!auth.canEditCases || deletingTagId === tag.tagId"
                @click="deleteTag(tag)"
              >
                <Trash2 class="h-4 w-4" />
                {{ deletingTagId === tag.tagId ? "Deleting..." : "Delete" }}
              </button>
            </div>
          </div>
        </div>
        <p v-if="!tags.length" class="text-sm text-ink-500">No tags have been created yet.</p>
      </div>
    </section>
  </section>
</template>
