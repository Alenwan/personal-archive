<script setup lang="ts">
defineProps<{ eyebrow?: string; title: string; description?: string }>();
</script>

<template>
  <div class="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
    <div>
      <p v-if="eyebrow" class="mb-1 text-xs font-semibold uppercase tracking-wide text-accent-700">{{ eyebrow }}</p>
      <h1 class="text-2xl font-semibold text-ink-900 md:text-3xl">{{ title }}</h1>
      <p v-if="description" class="mt-1 max-w-3xl text-sm leading-5 text-ink-600">{{ description }}</p>
    </div>
    <slot />
  </div>
</template>
