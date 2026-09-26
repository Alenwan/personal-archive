<script setup lang="ts">
import { ChevronRight, MoreHorizontal } from "lucide-vue-next";
import { computed } from "vue";
import { RouterLink } from "vue-router";

type BreadcrumbItem = {
  label: string;
  to?: string;
  current?: boolean;
};

const props = defineProps<{
  items: BreadcrumbItem[];
  compact?: boolean;
}>();

const visibleItems = computed(() => {
  const items = props.items.filter((item) => item.label.trim());
  if (items.length <= 4) return items.map((item, index) => ({ ...item, key: `${item.label}-${index}` }));
  return [
    { ...items[0], key: `${items[0].label}-0` },
    { label: "...", key: "collapsed", current: true },
    ...items.slice(-3).map((item, index) => ({ ...item, key: `${item.label}-${index + items.length - 3}` }))
  ];
});
</script>

<template>
  <nav class="overflow-x-auto" :class="props.compact ? 'mb-2' : 'mb-4'" aria-label="Breadcrumb">
    <ol class="flex min-w-max items-center gap-1 text-sm">
      <li v-for="(item, index) in visibleItems" :key="item.key" class="flex items-center gap-1">
        <ChevronRight v-if="index > 0" class="h-4 w-4 flex-none text-ink-300" aria-hidden="true" />
        <span v-if="item.label === '...'" class="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-400">
          <MoreHorizontal class="h-4 w-4" aria-hidden="true" />
        </span>
        <RouterLink
          v-else-if="item.to && !item.current"
          class="max-w-[13rem] truncate rounded-md px-1.5 py-1 font-semibold text-accent-700 transition hover:bg-accent-50 hover:text-accent-900"
          :to="item.to"
        >
          {{ item.label }}
        </RouterLink>
        <span v-else class="max-w-[14rem] truncate px-1.5 py-1 font-semibold text-ink-500" aria-current="page">
          {{ item.label }}
        </span>
      </li>
    </ol>
  </nav>
</template>
