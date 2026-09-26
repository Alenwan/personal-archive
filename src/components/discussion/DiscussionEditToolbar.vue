<script setup lang="ts">
import { Edit3, Save, X } from "lucide-vue-next";

withDefaults(defineProps<{
  busy?: boolean;
  saveDisabled?: boolean;
  label?: string;
}>(), {
  busy: false,
  saveDisabled: false,
  label: "Editing post"
});

const emit = defineEmits<{
  cancel: [];
  save: [];
}>();
</script>

<template>
  <div class="sticky top-0 z-30 -mx-1 flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-md border border-accent-100 bg-white/95 px-2.5 py-1.5 shadow-sm backdrop-blur">
    <span class="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-900">
      <Edit3 class="h-3.5 w-3.5" />
      {{ label }}
    </span>
    <span class="flex items-center gap-2">
      <button class="btn-secondary h-8 px-2.5 text-xs" type="button" :disabled="busy" @click="emit('cancel')">
        <X class="h-3.5 w-3.5" /> Cancel
      </button>
      <button class="btn-primary h-8 px-2.5 text-xs" type="button" :disabled="busy || saveDisabled" @click="emit('save')">
        <Save class="h-3.5 w-3.5" /> Save
      </button>
    </span>
  </div>
</template>
