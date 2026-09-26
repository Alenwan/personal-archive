<script setup lang="ts">
import { Paperclip, Reply, SlidersHorizontal, X } from "lucide-vue-next";
import { computed, ref } from "vue";
import RichTextEditor from "../editor/RichTextEditor.vue";
import { formatFileSize } from "../../shared/format";
import type { PublicUser, ServiceDiscussionMessage } from "../../shared/types";

const props = defineProps<{
  parent: ServiceDiscussionMessage;
  modelValue: string;
  files: File[];
  users: PublicUser[];
  ownerUserId: string;
  mentionedUserIds: string[];
  disabled?: boolean;
  canUpload?: boolean;
  busy?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "update:ownerUserId": [value: string];
  "update:mentionedUserIds": [value: string[]];
  addFiles: [files: File[]];
  insertImage: [payload: { token: string; file: File }];
  removeFile: [index: number];
  submit: [];
  cancel: [];
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const parentExcerpt = computed(() => {
  const normalized = props.parent.bodyText.replace(/\s+/g, " ").trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
});
const hasReplyContent = computed(() =>
  /<img\b/i.test(props.modelValue) || Boolean(props.modelValue.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").trim())
);

function onFileChange(event: Event) {
  emit("addFiles", Array.from((event.target as HTMLInputElement).files ?? []));
  if (fileInput.value) fileInput.value.value = "";
}

function onMentionChange(event: Event) {
  emit(
    "update:mentionedUserIds",
    Array.from((event.target as HTMLSelectElement).selectedOptions).map((option) => option.value)
  );
}

</script>

<template>
  <div class="mt-3 border-l-2 border-accent-200 pl-3 sm:pl-4">
    <div class="rounded-md border border-accent-100 bg-accent-50/40 p-3">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-xs font-semibold uppercase text-accent-900">Replying in thread</p>
          <p class="mt-1 line-clamp-2 text-xs leading-5 text-ink-500">
            <strong class="text-ink-700">{{ parent.createdByName }}:</strong>
            {{ parentExcerpt }}
          </p>
        </div>
        <button class="rounded-md p-1.5 text-ink-500 transition hover:bg-white hover:text-ink-900" type="button" title="Cancel reply" @click="emit('cancel')">
          <X class="h-4 w-4" />
        </button>
      </div>

      <RichTextEditor
        class="mt-3"
        :model-value="modelValue"
        :disabled="disabled || busy"
        placeholder="Write and format a reply…"
        min-height="10rem"
        compact
        autofocus
        @update:model-value="emit('update:modelValue', $event)"
        @insert-image="emit('insertImage', $event)"
      />

      <div v-if="files.length" class="mt-2 flex flex-wrap gap-2">
        <span
          v-for="(file, index) in files"
          :key="`${file.name}-${file.size}-${index}`"
          class="inline-flex max-w-full items-center gap-2 rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-700"
        >
          <Paperclip class="h-3.5 w-3.5 shrink-0 text-ink-400" />
          <span class="max-w-[220px] truncate">{{ file.name }}</span>
          <span class="shrink-0 text-ink-400">{{ formatFileSize(file.size) }}</span>
          <button class="rounded p-0.5 text-ink-400 hover:bg-ink-100 hover:text-ink-900" type="button" title="Remove file" @click="emit('removeFile', index)">
            <X class="h-3.5 w-3.5" />
          </button>
        </span>
      </div>

      <details class="mt-2">
        <summary class="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-ink-600 hover:bg-white">
          <SlidersHorizontal class="h-3.5 w-3.5" />
          Reply options
        </summary>
        <div class="mt-2 grid gap-2 sm:grid-cols-[14rem_minmax(0,1fr)]">
          <label class="text-xs font-semibold text-ink-600">
            Owner
            <select
              :value="ownerUserId"
              class="input mt-1 h-9 py-1 text-sm"
              :disabled="disabled || busy"
              @change="emit('update:ownerUserId', ($event.target as HTMLSelectElement).value)"
            >
              <option value="">No owner</option>
              <option v-for="user in users" :key="user.userId" :value="user.userId">{{ user.name }}</option>
            </select>
          </label>
          <label class="text-xs font-semibold text-ink-600">
            Mentions
            <select
              :value="mentionedUserIds"
              class="input mt-1 h-20 py-1 text-sm"
              multiple
              :disabled="disabled || busy"
              @change="onMentionChange"
            >
              <option v-for="user in users" :key="user.userId" :value="user.userId">@{{ user.name }}</option>
            </select>
          </label>
        </div>
      </details>

      <div class="mt-2 flex items-center justify-between gap-2">
        <div>
          <input ref="fileInput" class="hidden" type="file" multiple :disabled="disabled || !canUpload || busy" @change="onFileChange" />
          <button class="btn-secondary h-8 px-2.5 text-xs" type="button" :disabled="disabled || !canUpload || busy" @click="fileInput?.click()">
            <Paperclip class="h-3.5 w-3.5" />
            Attach
          </button>
        </div>
        <button class="btn-primary h-8 px-3 text-xs" type="button" :disabled="disabled || busy || (!hasReplyContent && !files.length)" @click="emit('submit')">
          <Reply class="h-3.5 w-3.5" />
          Reply
        </button>
      </div>
    </div>
  </div>
</template>
