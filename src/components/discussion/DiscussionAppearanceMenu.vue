<script setup lang="ts">
import { Check, RotateCcw, Settings2, Type, X } from "lucide-vue-next";
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useReadingPreferences } from "../../readingPreferences";
import ReadingThemePresetDialog from "../reading/ReadingThemePresetDialog.vue";

const props = withDefaults(defineProps<{
  compact?: boolean;
  align?: "left" | "right";
  label?: string;
}>(), {
  compact: false,
  align: "right",
  label: "Appearance"
});

const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const open = ref(false);
const presetsOpen = ref(false);
const presetsButton = ref<HTMLButtonElement | null>(null);
const panelStyle = ref<Record<string, string>>({});
const {
  preferences,
  themePresets,
  contrastRatio,
  fontFamily,
  applyTheme,
  setBackgroundColor,
  setTextColor,
  resetPreferences
} = useReadingPreferences();

function updateBackground(event: Event) {
  setBackgroundColor((event.target as HTMLInputElement).value);
}

function updateText(event: Event) {
  setTextColor((event.target as HTMLInputElement).value);
}

function positionPanel() {
  if (!root.value || !open.value) return;
  const anchor = root.value.getBoundingClientRect();
  const viewportPadding = 16;
  const width = Math.min(368, window.innerWidth - viewportPadding * 2);
  const panelHeight = panel.value?.getBoundingClientRect().height ?? 480;
  const visiblePanelHeight = Math.min(panelHeight, window.innerHeight - viewportPadding * 2);
  let left = props.align === "left" ? anchor.left : anchor.right - width;
  left = Math.min(Math.max(viewportPadding, left), window.innerWidth - width - viewportPadding);
  let top = anchor.bottom + 8;
  if (top + panelHeight > window.innerHeight - viewportPadding && anchor.top - panelHeight - 8 >= viewportPadding) {
    top = anchor.top - panelHeight - 8;
  } else if (top + visiblePanelHeight > window.innerHeight - viewportPadding) {
    top = window.innerHeight - visiblePanelHeight - viewportPadding;
  }
  panelStyle.value = {
    top: `${Math.max(viewportPadding, top)}px`,
    left: `${left}px`,
    width: `${width}px`,
    maxHeight: `calc(100vh - ${viewportPadding * 2}px)`
  };
}

async function toggleMenu() {
  open.value = !open.value;
  if (!open.value) return;
  await nextTick();
  positionPanel();
  requestAnimationFrame(positionPanel);
}

async function closeMenu(returnFocus = false) {
  presetsOpen.value = false;
  open.value = false;
  if (!returnFocus) return;
  await nextTick();
  trigger.value?.focus();
}

function closeOnOutsideClick(event: PointerEvent) {
  const target = event.target as Node;
  if (!presetsOpen.value && open.value && root.value && !root.value.contains(target) && !panel.value?.contains(target)) open.value = false;
}

function closeOnEscape(event: KeyboardEvent) {
  if (event.key === "Escape" && open.value && !presetsOpen.value) void closeMenu(true);
}

async function closePresets() {
  presetsOpen.value = false;
  await nextTick();
  presetsButton.value?.focus();
}

onMounted(() => {
  window.addEventListener("pointerdown", closeOnOutsideClick);
  window.addEventListener("keydown", closeOnEscape);
  window.addEventListener("resize", positionPanel);
  window.addEventListener("scroll", positionPanel, true);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", closeOnOutsideClick);
  window.removeEventListener("keydown", closeOnEscape);
  window.removeEventListener("resize", positionPanel);
  window.removeEventListener("scroll", positionPanel, true);
});
</script>

<template>
  <div ref="root" class="relative">
    <button
      ref="trigger"
      class="btn-secondary"
      :class="compact ? 'h-8 px-2.5 text-xs' : 'h-9 px-3'"
      type="button"
      title="Reading appearance"
      aria-label="Reading appearance"
      :aria-expanded="open"
      @click="toggleMenu"
    >
      <Type :class="compact ? 'h-3.5 w-3.5' : 'h-4 w-4'" />
      <span :class="compact ? '' : 'hidden sm:inline'">{{ label }}</span>
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="panel"
        class="fixed z-[100] overflow-y-auto rounded-md border border-ink-200 bg-white p-4 text-left text-ink-900 shadow-xl"
        :style="panelStyle"
        role="dialog"
        aria-label="Reading appearance settings"
      >
      <div class="flex items-start justify-between gap-3 border-b border-ink-100 pb-3">
        <div>
          <h3 class="text-sm font-semibold">Reading appearance</h3>
          <p class="mt-0.5 text-xs text-ink-500">Applies to posts and editors on this browser.</p>
        </div>
        <div class="flex items-center gap-1">
          <button class="grid h-8 w-8 place-items-center rounded-md text-ink-500 hover:bg-ink-50 hover:text-ink-900" type="button" title="Reset appearance" @click="resetPreferences"><RotateCcw class="h-4 w-4" /></button>
          <button class="grid h-8 w-8 place-items-center rounded-md text-ink-500 hover:bg-ink-50 hover:text-ink-900" type="button" title="Close" @click="closeMenu(true)"><X class="h-4 w-4" /></button>
        </div>
      </div>

      <fieldset class="mt-3">
        <legend class="text-xs font-semibold uppercase text-ink-500">Theme</legend>
        <div class="mt-2 grid grid-cols-2 gap-2">
          <button v-for="preset in themePresets" :key="preset.id" class="flex min-h-10 items-center gap-2 rounded-md border px-2.5 text-xs font-semibold transition" :class="preferences.theme === preset.id ? 'border-accent-600 ring-2 ring-accent-100' : 'border-ink-200 hover:border-accent-300'" type="button" @click="applyTheme(preset.id)">
            <span class="h-5 w-5 shrink-0 rounded border border-black/10" :style="{ backgroundColor: preset.backgroundColor }" />
            <span class="min-w-0 flex-1 text-left">{{ preset.label }}</span>
            <Check v-if="preferences.theme === preset.id" class="h-3.5 w-3.5 text-accent-700" />
          </button>
          <button ref="presetsButton" class="col-span-2 flex h-9 items-center justify-center gap-1.5 rounded-md border border-dashed border-ink-300 text-xs font-semibold text-ink-600 hover:border-accent-500 hover:bg-accent-50 hover:text-accent-800" type="button" aria-haspopup="dialog" :aria-expanded="presetsOpen" @click="presetsOpen = true">
            <Settings2 class="h-3.5 w-3.5" /> Add or edit presets
          </button>
        </div>
      </fieldset>

      <fieldset class="mt-4">
        <legend class="text-xs font-semibold uppercase text-ink-500">Custom colours</legend>
        <div class="mt-2 grid grid-cols-2 gap-2">
          <label class="flex h-10 items-center gap-2 rounded-md border border-ink-200 px-2.5 text-xs font-semibold">
            <input class="h-6 w-7 cursor-pointer border-0 bg-transparent p-0" type="color" :value="preferences.backgroundColor" title="Background colour" @input="updateBackground" />
            Background
          </label>
          <label class="flex h-10 items-center gap-2 rounded-md border border-ink-200 px-2.5 text-xs font-semibold">
            <input class="h-6 w-7 cursor-pointer border-0 bg-transparent p-0" type="color" :value="preferences.textColor" title="Text colour" @input="updateText" />
            Text
          </label>
        </div>
        <p class="mt-1.5 text-xs" :class="contrastRatio >= 4.5 ? 'text-emerald-700' : 'font-semibold text-red-700'">
          Contrast {{ contrastRatio.toFixed(1) }}:1 · {{ contrastRatio >= 4.5 ? "Readable" : "Choose stronger contrast (4.5:1 minimum)" }}
        </p>
      </fieldset>

      <div class="mt-4 grid gap-3">
        <label class="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3 text-xs font-semibold">
          Font
          <span class="inline-flex rounded-md border border-ink-200 bg-ink-50 p-1">
            <button class="h-7 flex-1 rounded px-2" :class="preferences.font === 'sans' ? 'bg-white text-accent-900 shadow-sm' : 'text-ink-500'" type="button" @click="preferences.font = 'sans'">Sans</button>
            <button class="h-7 flex-1 rounded px-2 font-serif" :class="preferences.font === 'serif' ? 'bg-white text-accent-900 shadow-sm' : 'text-ink-500'" type="button" @click="preferences.font = 'serif'">Serif</button>
          </span>
        </label>

        <label class="grid grid-cols-[5.5rem_minmax(0,1fr)_2.5rem] items-center gap-3 text-xs font-semibold">
          Text size
          <input v-model.number="preferences.fontSize" class="accent-accent-700" type="range" min="14" max="32" step="1" />
          <span class="text-right tabular-nums text-ink-500">{{ preferences.fontSize }}px</span>
        </label>

        <label class="grid grid-cols-[5.5rem_minmax(0,1fr)_2.5rem] items-center gap-3 text-xs font-semibold">
          Line height
          <input v-model.number="preferences.lineHeight" class="accent-accent-700" type="range" min="1.45" max="2.2" step="0.05" />
          <span class="text-right tabular-nums text-ink-500">{{ preferences.lineHeight.toFixed(2) }}</span>
        </label>

        <label class="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3 text-xs font-semibold">
          Text width
          <select v-model.number="preferences.contentWidth" class="h-9 rounded-md border border-ink-200 bg-white px-2 text-xs font-semibold text-ink-800">
            <option :value="620">Narrow</option>
            <option :value="760">Comfort</option>
            <option :value="920">Wide</option>
            <option :value="1040">Extra wide</option>
          </select>
        </label>
      </div>

      <div
        class="mt-4 rounded-md border px-3 py-2 text-sm"
        :style="{
          backgroundColor: preferences.backgroundColor,
          borderColor: `color-mix(in srgb, ${preferences.textColor} 18%, ${preferences.backgroundColor})`,
          color: preferences.textColor,
          fontFamily,
          fontSize: `${preferences.fontSize}px`,
          lineHeight: preferences.lineHeight
        }"
      >阅读预览 · Comfortable reading preview</div>
      </div>
    </Teleport>

    <ReadingThemePresetDialog :open="presetsOpen" @close="closePresets" />
  </div>
</template>
