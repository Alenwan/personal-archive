<script setup lang="ts">
import { Check, Minus, Plus, RotateCcw, Settings2 } from "lucide-vue-next";
import { nextTick, ref } from "vue";
import { useReadingPreferences } from "../../readingPreferences";
import ReadingThemePresetDialog from "./ReadingThemePresetDialog.vue";

withDefaults(defineProps<{ compact?: boolean; wrapPresets?: boolean }>(), {
  compact: false,
  wrapPresets: false
});

const {
  preferences,
  themePresets,
  contrastRatio,
  applyTheme,
  setBackgroundColor,
  setTextColor,
  resetPreferences
} = useReadingPreferences();

const presetsOpen = ref(false);
const presetsButton = ref<HTMLButtonElement | null>(null);

function backgroundChanged(event: Event) {
  setBackgroundColor((event.target as HTMLInputElement).value);
}

function textChanged(event: Event) {
  setTextColor((event.target as HTMLInputElement).value);
}

async function closePresets() {
  presetsOpen.value = false;
  await nextTick();
  presetsButton.value?.focus();
}
</script>

<template>
  <section
    class="appearance-panel"
    :class="{
      'appearance-panel--compact': compact,
      'appearance-panel--wrapped-presets': compact && wrapPresets
    }"
    aria-label="Reading and editing appearance"
  >
    <div class="appearance-intro">
      <div>
        <p class="appearance-title">Reading appearance</p>
        <p class="appearance-copy">Shared by the editor, topic reader, and book reader.</p>
      </div>
      <span class="appearance-contrast" :class="contrastRatio >= 4.5 ? 'is-good' : 'is-low'">
        <Check v-if="contrastRatio >= 4.5" />
        {{ contrastRatio.toFixed(1) }}:1 {{ contrastRatio >= 4.5 ? "contrast" : "low contrast" }}
      </span>
    </div>

    <div class="appearance-themes" aria-label="Reading themes">
      <button
        v-for="theme in themePresets"
        :key="theme.id"
        type="button"
        class="appearance-theme"
        :class="{ 'is-active': preferences.theme === theme.id }"
        :style="{ '--swatch-surface': theme.backgroundColor, '--swatch-ink': theme.textColor }"
        :title="`${theme.label} theme`"
        @click="applyTheme(theme.id)"
      >
        <span class="appearance-swatch">Aa</span>
        <span>{{ theme.label }}</span>
      </button>
      <button
        ref="presetsButton"
        class="appearance-presets"
        type="button"
        title="Add or edit appearance presets"
        aria-haspopup="dialog"
        :aria-expanded="presetsOpen"
        @click="presetsOpen = true"
      ><Settings2 /><span>Presets</span></button>
    </div>

    <div class="appearance-controls">
      <label class="appearance-color">
        <span>Background</span>
        <span class="appearance-color-input" :style="{ backgroundColor: preferences.backgroundColor }">
          <input :value="preferences.backgroundColor" type="color" @input="backgroundChanged" />
        </span>
      </label>
      <label class="appearance-color">
        <span>Text</span>
        <span class="appearance-color-input" :style="{ backgroundColor: preferences.textColor }">
          <input :value="preferences.textColor" type="color" @input="textChanged" />
        </span>
      </label>
      <div class="appearance-stepper" aria-label="Text size">
        <span>Size</span>
        <button type="button" title="Smaller text" :disabled="preferences.fontSize <= 14" @click="preferences.fontSize--"><Minus /></button>
        <strong>{{ preferences.fontSize }}</strong>
        <button type="button" title="Larger text" :disabled="preferences.fontSize >= 32" @click="preferences.fontSize++"><Plus /></button>
      </div>
      <label>
        <span>Typeface</span>
        <select v-model="preferences.font"><option value="serif">Serif</option><option value="sans">Sans</option></select>
      </label>
      <label>
        <span>Line spacing</span>
        <select v-model.number="preferences.lineHeight">
          <option :value="1.5">Compact</option><option :value="1.75">Comfort</option><option :value="2">Relaxed</option><option :value="2.15">Airy</option>
        </select>
      </label>
      <label>
        <span>Text width</span>
        <select v-model.number="preferences.contentWidth">
          <option :value="620">Narrow</option><option :value="760">Comfort</option><option :value="920">Wide</option><option :value="1040">Extra wide</option>
        </select>
      </label>
      <button class="appearance-reset" type="button" title="Reset reading appearance" @click="resetPreferences"><RotateCcw />Reset</button>
    </div>

    <ReadingThemePresetDialog :open="presetsOpen" @close="closePresets" />
  </section>
</template>

<style scoped>
.appearance-panel {
  border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent);
  background: color-mix(in srgb, var(--appearance-surface, #faf9f5) 95%, transparent);
  padding: 0.8rem 1rem;
  color: var(--appearance-ink, #2e332f);
  box-shadow: 0 8px 20px rgba(36, 44, 40, 0.05);
  backdrop-filter: blur(14px);
}

.appearance-intro { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; }
.appearance-title { font-size: 0.78rem; font-weight: 800; }
.appearance-copy { margin-top: 0.12rem; color: color-mix(in srgb, currentColor 65%, transparent); font-size: 0.67rem; }
.appearance-contrast { display: inline-flex; align-items: center; gap: 0.3rem; border-radius: 999px; padding: 0.24rem 0.48rem; font-size: 0.65rem; font-weight: 800; white-space: nowrap; }
.appearance-contrast svg { width: 0.72rem; height: 0.72rem; }
.appearance-contrast.is-good { background: #dff4e8; color: #225d3c; }
.appearance-contrast.is-low { background: #fff0c7; color: #74430f; }

.appearance-themes { display: flex; gap: 0.35rem; margin-top: 0.65rem; overflow-x: auto; padding-bottom: 0.1rem; scrollbar-width: thin; }
.appearance-theme { display: inline-flex; min-width: 4.7rem; align-items: center; gap: 0.35rem; border: 1px solid color-mix(in srgb, currentColor 16%, transparent); border-radius: 0.55rem; padding: 0.28rem 0.4rem; color: inherit; font-size: 0.67rem; font-weight: 750; transition: border-color 130ms ease, background 130ms ease, transform 130ms ease; }
.appearance-theme:hover { background: color-mix(in srgb, currentColor 6%, transparent); transform: translateY(-1px); }
.appearance-theme.is-active { border-color: #4f918b; box-shadow: 0 0 0 2px rgba(79,145,139,.12); }
.appearance-swatch { display: grid; width: 1.65rem; height: 1.65rem; place-items: center; border: 1px solid rgba(80,80,70,.14); border-radius: 0.38rem; background: var(--swatch-surface); color: var(--swatch-ink); font-family: Georgia, serif; font-size: 0.68rem; font-weight: 800; }
.appearance-presets { display: inline-flex; min-width: 4.7rem; align-items: center; justify-content: center; gap: 0.3rem; border: 1px dashed color-mix(in srgb, currentColor 25%, transparent); border-radius: 0.55rem; padding: 0.28rem 0.48rem; color: color-mix(in srgb, currentColor 78%, transparent); font-size: 0.67rem; font-weight: 780; transition: border-color 130ms ease, background 130ms ease; }
.appearance-presets:hover { border-color: #4f918b; background: color-mix(in srgb, currentColor 5%, transparent); color: inherit; }
.appearance-presets svg { width: 0.78rem; height: 0.78rem; }

.appearance-controls { display: flex; align-items: end; gap: 0.55rem; margin-top: 0.65rem; overflow-x: auto; padding-bottom: 0.1rem; scrollbar-width: thin; }
.appearance-controls label,
.appearance-stepper { display: grid; flex: 0 0 auto; gap: 0.22rem; color: color-mix(in srgb, currentColor 68%, transparent); font-size: 0.62rem; font-weight: 750; }
.appearance-controls select { width: 7.2rem; height: 2rem; border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 0.45rem; background: transparent; padding: 0 1.45rem 0 0.45rem; color: inherit; font-size: 0.7rem; font-weight: 700; }
.appearance-color { min-width: 4.3rem; }
.appearance-color-input { display: block; width: 100%; height: 2rem; overflow: hidden; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 0.45rem; }
.appearance-color-input input { width: 150%; height: 150%; transform: translate(-16%, -16%); cursor: pointer; opacity: 0; }
.appearance-stepper { grid-template-columns: auto 2rem 2.2rem 2rem; align-items: center; }
.appearance-stepper > span { grid-column: 1 / -1; }
.appearance-stepper button { display: grid; width: 2rem; height: 2rem; place-items: center; border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 0.45rem; }
.appearance-stepper button:disabled { opacity: 0.35; }
.appearance-stepper svg { width: 0.75rem; height: 0.75rem; }
.appearance-stepper strong { text-align: center; color: inherit; font-size: 0.72rem; }
.appearance-reset { display: inline-flex; height: 2rem; flex: 0 0 auto; align-items: center; gap: 0.3rem; border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 0.45rem; padding: 0 0.55rem; color: inherit; font-size: 0.68rem; font-weight: 750; }
.appearance-reset:hover { background: color-mix(in srgb, currentColor 6%, transparent); }
.appearance-reset svg { width: 0.75rem; height: 0.75rem; }

.appearance-panel--compact {
  display: flex;
  align-items: end;
  gap: 0.6rem;
  overflow-x: auto;
  padding: 0.48rem 0.7rem;
  scrollbar-width: thin;
}
.appearance-panel--compact .appearance-intro { order: 3; flex: 0 0 auto; padding-bottom: 0.18rem; }
.appearance-panel--compact .appearance-intro > div { display: none; }
.appearance-panel--compact .appearance-themes { order: 1; flex: 0 0 auto; margin-top: 0; overflow: visible; padding: 0; }
.appearance-panel--compact .appearance-controls { order: 2; flex: 0 0 auto; margin-top: 0; overflow: visible; padding: 0 0 0 0.6rem; border-left: 1px solid color-mix(in srgb, currentColor 14%, transparent); }
.appearance-panel--compact .appearance-theme { min-width: auto; padding: 0.2rem 0.34rem; }
.appearance-panel--compact .appearance-swatch { width: 1.45rem; height: 1.45rem; }
.appearance-panel--compact .appearance-presets { min-width: auto; padding: 0.2rem 0.44rem; }
.appearance-panel--compact .appearance-controls select { width: 6.25rem; }
.appearance-panel--compact .appearance-color { min-width: 2.25rem; }
.appearance-panel--compact .appearance-color-input { width: 2.25rem; }

.appearance-panel--compact.appearance-panel--wrapped-presets {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr) auto;
  align-items: center;
  overflow: visible;
}
.appearance-panel--wrapped-presets .appearance-themes {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: max-content;
  grid-template-rows: repeat(2, max-content);
  gap: 0.3rem 0.35rem;
  max-width: 100%;
  overflow-x: auto;
}
.appearance-panel--wrapped-presets .appearance-controls {
  min-width: 0;
  flex-wrap: wrap;
  align-content: center;
  row-gap: 0.4rem;
  overflow: visible;
}
.appearance-panel--wrapped-presets .appearance-intro { align-self: center; }

@media (max-width: 1100px) {
  .appearance-panel--compact.appearance-panel--wrapped-presets {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
  }
  .appearance-panel--wrapped-presets .appearance-themes { grid-column: 1 / -1; }
  .appearance-panel--wrapped-presets .appearance-controls {
    grid-column: 1;
    grid-row: 2;
    border-left: 0;
    padding-left: 0;
  }
  .appearance-panel--wrapped-presets .appearance-intro {
    grid-column: 2;
    grid-row: 2;
  }
}

@media (max-width: 640px) {
  .appearance-panel { padding: 0.65rem 0.75rem; }
  .appearance-copy { display: none; }
  .appearance-panel--compact { padding: 0.45rem 0.55rem; }
}
</style>
