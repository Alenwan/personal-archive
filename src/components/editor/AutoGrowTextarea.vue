<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<{
  modelValue: string;
  autofocus?: boolean;
}>(), {
  autofocus: false
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const field = ref<HTMLTextAreaElement | null>(null);
let resizeObserver: ResizeObserver | null = null;
let observedWidth = 0;

function resize() {
  if (!field.value) return;
  field.value.style.height = "auto";
  field.value.style.height = `${field.value.scrollHeight}px`;
}

function onInput(event: Event) {
  emit("update:modelValue", (event.target as HTMLTextAreaElement).value);
  resize();
}

watch(
  () => props.modelValue,
  () => void nextTick(resize)
);

onMounted(() => {
  resize();
  if (props.autofocus) void nextTick(() => field.value?.focus());
  resizeObserver = new ResizeObserver(([entry]) => {
    const width = Math.round(entry?.contentRect.width ?? 0);
    if (width && width !== observedWidth) {
      observedWidth = width;
      resize();
    }
  });
  if (field.value) resizeObserver.observe(field.value);
});

onBeforeUnmount(() => resizeObserver?.disconnect());
</script>

<template>
  <textarea
    v-bind="$attrs"
    ref="field"
    class="overflow-y-hidden resize-none"
    :value="modelValue"
    :autofocus="autofocus"
    @input="onInput"
  />
</template>
