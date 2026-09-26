<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from "vue";

defineProps<{ text: string }>();

const trigger = ref<HTMLElement | null>(null);
const tooltip = ref<HTMLElement | null>(null);
const visible = ref(false);
const position = ref({ top: 0, left: 0 });

function hide() {
  visible.value = false;
}

async function show() {
  visible.value = true;
  await nextTick();
  if (!trigger.value || !tooltip.value) return;
  const triggerRect = trigger.value.getBoundingClientRect();
  const tooltipRect = tooltip.value.getBoundingClientRect();
  const margin = 8;
  const centeredLeft = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
  const left = Math.min(Math.max(centeredLeft, margin), window.innerWidth - tooltipRect.width - margin);
  const below = triggerRect.bottom + 6;
  const top = below + tooltipRect.height <= window.innerHeight - margin
    ? below
    : triggerRect.top - tooltipRect.height - 6;
  position.value = { top, left };
}

window.addEventListener("scroll", hide, true);
window.addEventListener("resize", hide);

onBeforeUnmount(() => {
  window.removeEventListener("scroll", hide, true);
  window.removeEventListener("resize", hide);
});
</script>

<template>
  <span
    ref="trigger"
    class="inline-flex"
    @mouseenter="show"
    @mouseleave="hide"
    @focusin="show"
    @focusout="hide"
  >
    <slot />
  </span>
  <Teleport to="body">
    <span
      v-if="visible"
      ref="tooltip"
      class="pointer-events-none fixed z-[100] whitespace-nowrap rounded-md bg-ink-900 px-2 py-1 text-xs font-semibold text-white shadow-soft"
      role="tooltip"
      :style="{ top: `${position.top}px`, left: `${position.left}px` }"
    >
      {{ text }}
    </span>
  </Teleport>
</template>
