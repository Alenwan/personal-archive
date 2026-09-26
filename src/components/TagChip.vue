<script setup lang="ts">
import type { Tag } from "../shared/types";

defineProps<{ tag: Tag }>();
</script>

<template>
  <span
    class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold text-white"
    :style="{ backgroundColor: tag.color }"
  >
    {{ tag.name }}
  </span>
</template>

