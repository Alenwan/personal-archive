<script setup lang="ts">
import { Check, Plus, RotateCcw, Trash2, X } from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  colorContrastRatio,
  useReadingPreferences,
  type ReadingThemePreset
} from "../../readingPreferences";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const {
  preferences,
  themePresets,
  applyTheme,
  createThemePreset,
  updateThemePreset,
  restoreThemePreset,
  removeThemePreset,
  maxCustomPresets
} = useReadingPreferences();

const dialog = ref<HTMLElement | null>(null);
const nameInput = ref<HTMLInputElement | null>(null);
const editingId = ref<string | null>(null);
const creating = ref(false);
const deleteArmed = ref(false);
const statusMessage = ref("");
const form = ref({ label: "", backgroundColor: "#fbfaf6", textColor: "#292824" });

const selectedPreset = computed(() => editingId.value
  ? themePresets.find((preset) => preset.id === editingId.value) ?? null
  : null);
const customPresetCount = computed(() => themePresets.filter((preset) => !preset.builtIn).length);
const canCreate = computed(() => customPresetCount.value < maxCustomPresets);
const formContrast = computed(() => colorContrastRatio(form.value.textColor, form.value.backgroundColor));
const formTitle = computed(() => creating.value ? "New preset" : selectedPreset.value ? `Edit ${selectedPreset.value.label}` : "Choose a preset");

function setForm(preset: Pick<ReadingThemePreset, "label" | "backgroundColor" | "textColor">) {
  form.value = {
    label: preset.label,
    backgroundColor: preset.backgroundColor,
    textColor: preset.textColor
  };
}

async function beginCreate() {
  if (!canCreate.value) return;
  editingId.value = null;
  creating.value = true;
  deleteArmed.value = false;
  statusMessage.value = "";
  setForm({
    label: "My preset",
    backgroundColor: preferences.backgroundColor,
    textColor: preferences.textColor
  });
  await nextTick();
  nameInput.value?.focus();
  nameInput.value?.select();
}

async function beginEdit(preset: ReadingThemePreset) {
  editingId.value = preset.id;
  creating.value = false;
  deleteArmed.value = false;
  statusMessage.value = "";
  setForm(preset);
  await nextTick();
  nameInput.value?.focus();
}

function savePreset() {
  const label = form.value.label.trim();
  if (!label) return;
  if (creating.value) {
    const preset = createThemePreset({ ...form.value, label });
    if (!preset) return;
    editingId.value = preset.id;
    creating.value = false;
    setForm(preset);
    statusMessage.value = "Preset added and applied.";
    return;
  }
  if (!editingId.value || !updateThemePreset(editingId.value, { ...form.value, label })) return;
  statusMessage.value = "Preset saved.";
}

function usePreset() {
  if (!editingId.value) return;
  applyTheme(editingId.value);
  statusMessage.value = "Preset applied.";
}

function restorePreset() {
  if (!editingId.value || !restoreThemePreset(editingId.value)) return;
  const preset = themePresets.find((candidate) => candidate.id === editingId.value);
  if (preset) setForm(preset);
  statusMessage.value = "Built-in values restored.";
}

function deletePreset() {
  if (!editingId.value) return;
  if (!deleteArmed.value) {
    deleteArmed.value = true;
    statusMessage.value = "Select Remove again to confirm.";
    return;
  }
  if (!removeThemePreset(editingId.value)) return;
  editingId.value = null;
  creating.value = false;
  deleteArmed.value = false;
  statusMessage.value = "Preset removed.";
}

function closeDialog() {
  deleteArmed.value = false;
  statusMessage.value = "";
  emit("close");
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape" || !props.open) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  closeDialog();
}

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    const activePreset = themePresets.find((preset) => preset.id === preferences.theme);
    if (activePreset) await beginEdit(activePreset);
    else await beginCreate();
    await nextTick();
    dialog.value?.focus({ preventScroll: true });
    nameInput.value?.focus({ preventScroll: true });
  }
);

onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="preset-dialog">
      <div v-if="open" class="preset-backdrop" @pointerdown.self="closeDialog">
        <section
          ref="dialog"
          class="preset-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="preset-dialog-title"
          tabindex="-1"
        >
          <header class="preset-dialog-header">
            <div>
              <p class="preset-eyebrow">Reading appearance</p>
              <h2 id="preset-dialog-title">Appearance presets</h2>
              <p>Edit the built-in colour pairs or save the current colours as your own preset.</p>
            </div>
            <button class="preset-icon-button" type="button" title="Close preset manager" @click="closeDialog"><X /></button>
          </header>

          <div class="preset-dialog-body">
            <aside class="preset-directory" aria-label="Appearance presets">
              <div class="preset-directory-heading">
                <strong>Presets</strong>
                <span>{{ themePresets.length }}</span>
              </div>
              <button class="preset-add" type="button" :disabled="!canCreate" @click="beginCreate">
                <Plus /> Add preset
              </button>
              <p v-if="!canCreate" class="preset-limit">Custom preset limit reached.</p>
              <div class="preset-list">
                <button
                  v-for="preset in themePresets"
                  :key="preset.id"
                  class="preset-list-item"
                  :class="{ 'is-selected': editingId === preset.id && !creating }"
                  type="button"
                  @click="beginEdit(preset)"
                >
                  <span
                    class="preset-list-swatch"
                    :style="{ '--preset-surface': preset.backgroundColor, '--preset-ink': preset.textColor }"
                  >Aa</span>
                  <span class="preset-list-copy">
                    <strong>{{ preset.label }}</strong>
                    <small>{{ preset.builtIn ? "Built-in" : "Custom" }}</small>
                  </span>
                  <Check v-if="preferences.theme === preset.id" class="preset-active-check" />
                </button>
              </div>
            </aside>

            <div class="preset-editor">
              <div class="preset-editor-heading">
                <div>
                  <p class="preset-eyebrow">{{ selectedPreset?.builtIn ? "Built-in preset" : "Custom preset" }}</p>
                  <h3>{{ formTitle }}</h3>
                </div>
                <span v-if="selectedPreset?.builtIn" class="preset-kind">Restorable</span>
              </div>

              <form v-if="creating || selectedPreset" class="preset-form" @submit.prevent="savePreset">
                <label class="preset-name-field">
                  <span>Name</span>
                  <input ref="nameInput" v-model="form.label" type="text" maxlength="32" autocomplete="off" />
                </label>

                <div class="preset-colour-grid">
                  <label>
                    <span>Background</span>
                    <span class="preset-colour-control">
                      <input v-model="form.backgroundColor" type="color" title="Preset background colour" />
                      <code>{{ form.backgroundColor }}</code>
                    </span>
                  </label>
                  <label>
                    <span>Text</span>
                    <span class="preset-colour-control">
                      <input v-model="form.textColor" type="color" title="Preset text colour" />
                      <code>{{ form.textColor }}</code>
                    </span>
                  </label>
                </div>

                <div
                  class="preset-preview"
                  :style="{ backgroundColor: form.backgroundColor, color: form.textColor }"
                >
                  <span>Aa</span>
                  <div>
                    <strong>阅读预览</strong>
                    <p>A quiet page for long-form reading.</p>
                  </div>
                </div>

                <p class="preset-contrast" :class="formContrast >= 4.5 ? 'is-good' : 'is-low'">
                  <Check v-if="formContrast >= 4.5" />
                  {{ formContrast.toFixed(1) }}:1 contrast · {{ formContrast >= 4.5 ? "Readable" : "4.5:1 or higher is recommended" }}
                </p>

                <div class="preset-actions">
                  <button class="preset-primary" type="submit" :disabled="!form.label.trim()">
                    {{ creating ? "Add preset" : "Save changes" }}
                  </button>
                  <button v-if="!creating" class="preset-secondary" type="button" @click="usePreset">Use preset</button>
                  <button v-if="selectedPreset?.builtIn" class="preset-secondary" type="button" @click="restorePreset"><RotateCcw /> Restore</button>
                  <button
                    v-else-if="selectedPreset && !creating"
                    class="preset-danger"
                    :class="{ 'is-armed': deleteArmed }"
                    type="button"
                    @click="deletePreset"
                  ><Trash2 />{{ deleteArmed ? "Confirm remove" : "Remove" }}</button>
                </div>
                <p class="preset-status" aria-live="polite">{{ statusMessage }}</p>
              </form>
            </div>
          </div>

          <footer>Preset changes are stored only in this browser.</footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.preset-backdrop {
  position: fixed;
  inset: 0;
  z-index: 220;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(25, 29, 27, 0.46);
  backdrop-filter: blur(4px);
}

.preset-dialog {
  width: min(46rem, 100%);
  max-height: min(42rem, calc(100vh - 2rem));
  overflow: hidden;
  border: 1px solid #d8d8cf;
  border-radius: 0.9rem;
  background: #fbfaf6;
  color: #292824;
  box-shadow: 0 24px 70px rgba(20, 25, 22, 0.24);
  outline: none;
}

.preset-dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.15rem 1.25rem 1rem;
  border-bottom: 1px solid #deded5;
}
.preset-dialog-header h2 { margin-top: 0.15rem; font-size: 1.15rem; font-weight: 800; letter-spacing: -0.02em; }
.preset-dialog-header p:last-child { margin-top: 0.25rem; color: #686961; font-size: 0.78rem; }
.preset-eyebrow { color: #4f7f79; font-size: 0.64rem; font-weight: 850; letter-spacing: 0.11em; text-transform: uppercase; }
.preset-icon-button { display: grid; width: 2rem; height: 2rem; flex: 0 0 auto; place-items: center; border-radius: 0.45rem; color: #666860; }
.preset-icon-button:hover { background: #efefe9; color: #252722; }
.preset-icon-button svg { width: 1rem; height: 1rem; }

.preset-dialog-body { display: grid; min-height: 28rem; grid-template-columns: 15.5rem minmax(0, 1fr); }
.preset-directory { min-width: 0; padding: 1rem; border-right: 1px solid #deded5; background: #f5f4ee; }
.preset-directory-heading { display: flex; align-items: center; justify-content: space-between; color: #686961; font-size: 0.72rem; }
.preset-directory-heading strong { color: #33352f; font-size: 0.76rem; }
.preset-directory-heading span { font-variant-numeric: tabular-nums; }
.preset-add { display: flex; width: 100%; height: 2.25rem; align-items: center; justify-content: center; gap: 0.4rem; margin-top: 0.7rem; border: 1px solid #a9c5c1; border-radius: 0.5rem; background: #edf6f4; color: #285e58; font-size: 0.72rem; font-weight: 800; }
.preset-add:hover { background: #e3f1ef; }
.preset-add:disabled { cursor: not-allowed; opacity: 0.45; }
.preset-add svg { width: 0.85rem; height: 0.85rem; }
.preset-limit { margin-top: 0.35rem; color: #8a5b27; font-size: 0.65rem; }
.preset-list { display: grid; max-height: 22.5rem; gap: 0.35rem; margin-top: 0.75rem; overflow-y: auto; padding-right: 0.15rem; scrollbar-width: thin; }
.preset-list-item { display: flex; min-width: 0; align-items: center; gap: 0.55rem; border: 1px solid transparent; border-radius: 0.55rem; padding: 0.42rem; text-align: left; transition: border-color 130ms ease, background 130ms ease, transform 130ms ease; }
.preset-list-item:hover { background: #ebeae3; transform: translateX(1px); }
.preset-list-item.is-selected { border-color: #8fb8b2; background: #e9f3f1; }
.preset-list-swatch { display: grid; width: 2.1rem; height: 2.1rem; flex: 0 0 auto; place-items: center; border: 1px solid rgba(60, 62, 56, 0.16); border-radius: 0.45rem; background: var(--preset-surface); color: var(--preset-ink); font-family: Georgia, serif; font-size: 0.72rem; font-weight: 800; }
.preset-list-copy { display: grid; min-width: 0; flex: 1; }
.preset-list-copy strong { overflow: hidden; color: #30322d; font-size: 0.73rem; text-overflow: ellipsis; white-space: nowrap; }
.preset-list-copy small { margin-top: 0.08rem; color: #7a7b73; font-size: 0.61rem; }
.preset-active-check { width: 0.8rem; height: 0.8rem; flex: 0 0 auto; color: #3d756e; }

.preset-editor { min-width: 0; padding: 1.1rem 1.25rem; }
.preset-editor-heading { display: flex; min-height: 2.8rem; align-items: flex-start; justify-content: space-between; gap: 0.8rem; }
.preset-editor-heading h3 { margin-top: 0.14rem; font-size: 1rem; font-weight: 800; letter-spacing: -0.015em; }
.preset-kind { border-radius: 999px; background: #e8efed; padding: 0.23rem 0.45rem; color: #416660; font-size: 0.62rem; font-weight: 800; }
.preset-form { margin-top: 0.8rem; }
.preset-form label { display: grid; gap: 0.32rem; color: #60625b; font-size: 0.68rem; font-weight: 800; }
.preset-name-field input { height: 2.35rem; border: 1px solid #cacbc2; border-radius: 0.5rem; background: #fff; padding: 0 0.65rem; color: #292b27; font-size: 0.78rem; outline: none; }
.preset-name-field input:focus { border-color: #5d9991; box-shadow: 0 0 0 3px rgba(79, 145, 139, 0.13); }
.preset-colour-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.65rem; margin-top: 0.75rem; }
.preset-colour-control { display: flex; height: 2.35rem; align-items: center; gap: 0.55rem; border: 1px solid #cacbc2; border-radius: 0.5rem; background: #fff; padding: 0 0.55rem; }
.preset-colour-control input { width: 1.7rem; height: 1.45rem; cursor: pointer; border: 0; background: transparent; padding: 0; }
.preset-colour-control code { color: #5f615a; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.68rem; text-transform: uppercase; }
.preset-preview { display: flex; min-height: 7.4rem; align-items: center; gap: 1rem; margin-top: 0.85rem; border: 1px solid rgba(80, 80, 70, 0.16); border-radius: 0.65rem; padding: 1rem 1.15rem; transition: background-color 150ms ease, color 150ms ease; }
.preset-preview > span { font-family: Georgia, serif; font-size: 2.15rem; font-weight: 800; line-height: 1; }
.preset-preview strong { font-family: Georgia, serif; font-size: 1rem; }
.preset-preview p { margin-top: 0.15rem; opacity: 0.72; font-family: Georgia, serif; font-size: 0.75rem; }
.preset-contrast { display: flex; align-items: center; gap: 0.35rem; margin-top: 0.65rem; font-size: 0.68rem; font-weight: 750; }
.preset-contrast svg { width: 0.75rem; height: 0.75rem; }
.preset-contrast.is-good { color: #286144; }
.preset-contrast.is-low { color: #8b4a16; }
.preset-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem; margin-top: 1rem; }
.preset-actions button { display: inline-flex; height: 2.15rem; align-items: center; justify-content: center; gap: 0.32rem; border-radius: 0.48rem; padding: 0 0.65rem; font-size: 0.68rem; font-weight: 800; }
.preset-actions button:disabled { cursor: not-allowed; opacity: 0.45; }
.preset-actions svg { width: 0.78rem; height: 0.78rem; }
.preset-primary { background: #3d746e; color: #fff; }
.preset-primary:hover { background: #32645e; }
.preset-secondary { border: 1px solid #c4c6bd; color: #44463f; }
.preset-secondary:hover { background: #efefe9; }
.preset-danger { margin-left: auto; color: #9a3f35; }
.preset-danger:hover, .preset-danger.is-armed { background: #f8e9e6; }
.preset-status { min-height: 1rem; margin-top: 0.55rem; color: #5d6c67; font-size: 0.66rem; }

.preset-dialog footer { border-top: 1px solid #deded5; padding: 0.65rem 1.25rem; color: #73756d; font-size: 0.65rem; text-align: right; }
.preset-dialog-enter-active, .preset-dialog-leave-active { transition: opacity 150ms ease; }
.preset-dialog-enter-active .preset-dialog, .preset-dialog-leave-active .preset-dialog { transition: transform 150ms ease, opacity 150ms ease; }
.preset-dialog-enter-from, .preset-dialog-leave-to { opacity: 0; }
.preset-dialog-enter-from .preset-dialog, .preset-dialog-leave-to .preset-dialog { opacity: 0; transform: translateY(8px) scale(0.99); }

@media (max-width: 680px) {
  .preset-backdrop { align-items: end; padding: 0; }
  .preset-dialog { width: 100%; max-height: 92vh; border-radius: 0.9rem 0.9rem 0 0; overflow-y: auto; }
  .preset-dialog-body { display: block; min-height: 0; }
  .preset-directory { border-right: 0; border-bottom: 1px solid #deded5; }
  .preset-list { display: flex; max-height: none; overflow-x: auto; padding-bottom: 0.2rem; }
  .preset-list-item { min-width: 9.5rem; }
  .preset-editor { padding: 1rem; }
  .preset-colour-grid { grid-template-columns: 1fr; }
  .preset-preview { min-height: 6rem; }
}

@media (prefers-reduced-motion: reduce) {
  .preset-list-item, .preset-preview, .preset-dialog-enter-active, .preset-dialog-leave-active,
  .preset-dialog-enter-active .preset-dialog, .preset-dialog-leave-active .preset-dialog { transition: none; }
}
</style>
