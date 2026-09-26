<script setup lang="ts">
import { ChevronDown, SlidersHorizontal, X } from "lucide-vue-next";

withDefaults(
  defineProps<{
    activeFilterCount?: number;
    showAdvancedFilters?: boolean;
    selectedCount?: number;
    advancedLabel?: string;
  }>(),
  {
    activeFilterCount: 0,
    showAdvancedFilters: false,
    selectedCount: 0,
    advancedLabel: "Filters"
  }
);

const emit = defineEmits<{
  (event: "toggle-advanced"): void;
  (event: "clear-filters"): void;
}>();
</script>

<template>
  <section class="panel mb-5 p-3 sm:p-4">
    <div class="flex flex-wrap items-center gap-2">
      <div class="min-w-[16rem] flex-[1_1_26rem]">
        <slot name="search" />
      </div>
      <slot name="controls" />
      <button
        v-if="$slots.advanced"
        class="btn-secondary h-11 shrink-0 px-3"
        type="button"
        :aria-expanded="showAdvancedFilters"
        @click="emit('toggle-advanced')"
      >
        <SlidersHorizontal class="h-4 w-4" />
        {{ advancedLabel }}
        <span
          v-if="activeFilterCount"
          class="rounded-full bg-accent-50 px-2 py-0.5 text-xs font-semibold text-accent-800"
        >
          {{ activeFilterCount }}
        </span>
        <ChevronDown class="h-4 w-4 transition" :class="showAdvancedFilters ? 'rotate-180' : ''" />
      </button>
    </div>

    <div
      v-if="activeFilterCount && $slots.chips"
      class="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-accent-100 bg-accent-50/60 px-3 py-2 text-sm"
    >
      <span class="font-semibold text-accent-950">Applied</span>
      <slot name="chips" />
      <button class="ml-auto inline-flex items-center gap-1 font-semibold text-accent-900 hover:underline" type="button" @click="emit('clear-filters')">
        <X class="h-3.5 w-3.5" />
        Clear all
      </button>
    </div>

    <div v-if="showAdvancedFilters && $slots.advanced" class="mt-3 rounded-md border border-ink-200 bg-white p-3">
      <slot name="advanced" />
    </div>

    <div v-if="$slots.summary || $slots.saved" class="mt-3 flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap gap-2 text-sm text-ink-600">
        <slot name="summary" />
      </div>
      <div v-if="$slots.saved" class="flex flex-wrap items-center gap-2">
        <slot name="saved" />
      </div>
    </div>

    <div v-if="selectedCount > 0 && $slots.selection" class="mt-3 rounded-md border border-accent-100 bg-accent-50/60 p-3 text-sm">
      <slot name="selection" />
    </div>

    <div v-if="$slots.errors" class="mt-2">
      <slot name="errors" />
    </div>
  </section>
</template>
