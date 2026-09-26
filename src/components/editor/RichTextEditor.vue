<script setup lang="ts">
import DOMPurify from "dompurify";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Eraser,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Palette,
  Quote,
  Redo2,
  Strikethrough,
  Underline,
  Undo2
} from "lucide-vue-next";
import { marked } from "marked";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useReadingPreferences } from "../../readingPreferences";
import { isRichTextHtml, RICH_TEXT_TAGS } from "../../shared/richTextContent";
import ReadingAppearanceControls from "../reading/ReadingAppearanceControls.vue";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
    minHeight?: string;
    disabled?: boolean;
    autofocus?: boolean;
    compact?: boolean;
    autoGrow?: boolean;
    showAppearance?: boolean;
  }>(),
  {
    placeholder: "Start writing…",
    minHeight: "18rem",
    disabled: false,
    autofocus: false,
    compact: false,
    autoGrow: false,
    showAppearance: true
  }
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "insert-image": [payload: { token: string; file: File }];
}>();

const editor = ref<HTMLDivElement | null>(null);
const imageInput = ref<HTMLInputElement | null>(null);
const blockStyle = ref("p");
const textColor = ref("#243b38");
const highlightColor = ref("#fff0bc");
const appearanceOpen = ref(false);
const previewUrls = new Set<string>();
let savedRange: Range | null = null;
let lastEmitted = "";
let scrollAnimationFrame = 0;
const { preferences, fontFamily } = useReadingPreferences();
const editorCanvasStyle = computed(() => ({
  minHeight: props.minHeight,
  "--editor-surface": preferences.backgroundColor,
  "--editor-ink": preferences.textColor,
  "--editor-font-size": `${preferences.fontSize}px`,
  "--editor-line-height": String(preferences.lineHeight),
  "--editor-font-family": fontFamily.value
}));

function editableHtml(value: string) {
  if (!value.trim()) return "";
  const source = isRichTextHtml(value)
    ? value
    : String(marked.parse(value, { async: false, breaks: true, gfm: true }));
  return DOMPurify.sanitize(source, {
    ALLOWED_TAGS: [...RICH_TEXT_TAGS],
    ALLOWED_ATTR: ["alt", "data-inline-image-token", "height", "href", "src", "style", "title", "width"],
    ALLOW_DATA_ATTR: true
  });
}

function setEditorContent(value: string) {
  if (!editor.value) return;
  const nextHtml = editableHtml(value);
  if (editor.value.innerHTML !== nextHtml) editor.value.innerHTML = nextHtml;
}

function normalizedEditorHtml() {
  if (!editor.value) return "";
  const html = editor.value.innerHTML.trim();
  return /^(?:<br\s*\/?>(?:\s*)|<p>(?:<br\s*\/?>|&nbsp;|\s)*<\/p>)$/i.test(html) ? "" : html;
}

function emitContent() {
  // Removing a focused editor can emit blur after Vue clears its DOM ref.
  // That event is not a user edit and must never replace the draft with "".
  if (!editor.value || !editor.value.isConnected) return;
  const html = normalizedEditorHtml();
  lastEmitted = html;
  emit("update:modelValue", html);
}

function selectionInsideEditor(range: Range) {
  const container = range.commonAncestorContainer;
  return Boolean(editor.value && (container === editor.value || editor.value.contains(container)));
}

function rememberSelection() {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (selectionInsideEditor(range)) savedRange = range.cloneRange();
}

function restoreSelection() {
  if (!savedRange || !editor.value) return;
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(savedRange);
}

function runCommand(command: string, value?: string) {
  if (props.disabled || !editor.value) return;
  rememberSelection();
  restoreSelection();
  editor.value.focus();
  document.execCommand("styleWithCSS", false, "true");
  document.execCommand(command, false, value);
  rememberSelection();
  emitContent();
}

function changeBlockStyle(event: Event) {
  blockStyle.value = (event.target as HTMLSelectElement).value;
  runCommand("formatBlock", `<${blockStyle.value}>`);
}

function applyTextColor(event: Event) {
  textColor.value = (event.target as HTMLInputElement).value;
  runCommand("foreColor", textColor.value);
}

function applyHighlightColor(event: Event) {
  highlightColor.value = (event.target as HTMLInputElement).value;
  runCommand("hiliteColor", highlightColor.value);
}

function insertLink() {
  rememberSelection();
  const value = window.prompt("Paste a web address");
  if (!value?.trim()) return;
  const normalized = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
  runCommand("createLink", normalized);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function imageFile(file: File) {
  return file.type.toLowerCase().startsWith("image/") ||
    /\.(?:apng|avif|bmp|cur|dib|gif|heic|heif|ico|j2[ck]|jpe?g|jfif|jp2|jpx|jxl|pjp|pjpeg|png|svg|tiff?|webp)$/i.test(file.name);
}

function insertImageFile(file: File) {
  if (!imageFile(file) || props.disabled || !editor.value) return;
  const token = `inline-${crypto.randomUUID()}`;
  const previewUrl = URL.createObjectURL(file);
  previewUrls.add(previewUrl);
  restoreSelection();
  editor.value.focus();
  const fileName = escapeHtml(file.name || "Inserted image");
  document.execCommand(
    "insertHTML",
    false,
    `<figure data-inline-image-token="${token}"><img src="${previewUrl}" alt="${fileName}"><figcaption>${fileName}</figcaption></figure><p><br></p>`
  );
  emit("insert-image", { token, file });
  rememberSelection();
  emitContent();
}

function chooseImages() {
  rememberSelection();
  imageInput.value?.click();
}

function onImageChange(event: Event) {
  for (const file of Array.from((event.target as HTMLInputElement).files ?? [])) insertImageFile(file);
  if (imageInput.value) imageInput.value.value = "";
}

function onPaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files ?? []).filter(imageFile);
  if (!files.length) return;
  event.preventDefault();
  for (const file of files) insertImageFile(file);
}

function onDrop(event: DragEvent) {
  const files = Array.from(event.dataTransfer?.files ?? []).filter(imageFile);
  if (!files.length) return;
  event.preventDefault();
  editor.value?.focus();
  for (const file of files) insertImageFile(file);
}

function onBlur() {
  rememberSelection();
  emitContent();
}

function focus() {
  editor.value?.focus();
}

function clampProgress(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function getScrollProgress() {
  const canvas = editor.value;
  if (!canvas) return 0;
  const internalMaximum = Math.max(0, canvas.scrollHeight - canvas.clientHeight);
  if (internalMaximum > 4) return clampProgress(canvas.scrollTop / internalMaximum);

  const viewportTop = 88;
  const viewportHeight = Math.max(160, window.innerHeight - viewportTop - 24);
  const maximum = Math.max(0, canvas.getBoundingClientRect().height - viewportHeight);
  if (maximum <= 4) return 0;
  return clampProgress((viewportTop - canvas.getBoundingClientRect().top) / maximum);
}

function restoreScrollProgress(progress: number) {
  const canvas = editor.value;
  if (!canvas) return;
  const normalized = clampProgress(progress);
  const internalMaximum = Math.max(0, canvas.scrollHeight - canvas.clientHeight);
  if (internalMaximum > 4) {
    canvas.scrollTop = internalMaximum * normalized;
    return;
  }

  const viewportTop = 88;
  const viewportHeight = Math.max(160, window.innerHeight - viewportTop - 24);
  const rect = canvas.getBoundingClientRect();
  const maximum = Math.max(0, rect.height - viewportHeight);
  window.scrollTo({ top: window.scrollY + rect.top + maximum * normalized - viewportTop, behavior: "auto" });
}

function animateScroll(start: number, target: number, write: (value: number) => void) {
  if (scrollAnimationFrame) cancelAnimationFrame(scrollAnimationFrame);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || Math.abs(target - start) < 8) {
    write(target);
    return;
  }
  const startedAt = performance.now();
  const duration = 145;
  const step = (now: number) => {
    const elapsed = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - Math.pow(1 - elapsed, 3);
    write(start + (target - start) * eased);
    if (elapsed < 1) scrollAnimationFrame = requestAnimationFrame(step);
  };
  scrollAnimationFrame = requestAnimationFrame(step);
}

function scrollToHeading(index: number) {
  const heading = editor.value?.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")[index];
  const canvas = editor.value;
  if (!heading || !canvas) return false;
  const internalMaximum = Math.max(0, canvas.scrollHeight - canvas.clientHeight);
  if (internalMaximum > 4) {
    const canvasRect = canvas.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    const target = Math.min(internalMaximum, Math.max(0, canvas.scrollTop + headingRect.top - canvasRect.top - (canvas.clientHeight - headingRect.height) / 2));
    animateScroll(canvas.scrollTop, target, (value) => { canvas.scrollTop = value; });
    return true;
  }

  const headingRect = heading.getBoundingClientRect();
  const target = Math.max(0, window.scrollY + headingRect.top - (window.innerHeight - headingRect.height) / 2);
  animateScroll(window.scrollY, target, (value) => { window.scrollTo({ top: value, behavior: "auto" }); });
  return true;
}

function replaceInlineImage(token: string, source: string, alt = "Inserted image") {
  const node = editor.value?.querySelector<HTMLElement>(`[data-inline-image-token="${CSS.escape(token)}"]`);
  if (!node) return false;
  const image = node.matches("img") ? node as HTMLImageElement : node.querySelector<HTMLImageElement>("img");
  if (!image) return false;
  image.src = source;
  image.alt = alt;
  node.removeAttribute("data-inline-image-token");
  emitContent();
  return true;
}

function removeInlineImage(token: string) {
  const node = editor.value?.querySelector<HTMLElement>(`[data-inline-image-token="${CSS.escape(token)}"]`);
  if (!node) return false;
  node.remove();
  emitContent();
  return true;
}

watch(
  () => props.modelValue,
  (value) => {
    if (value === lastEmitted || document.activeElement === editor.value) return;
    setEditorContent(value);
  }
);

onMounted(() => {
  setEditorContent(props.modelValue);
  if (props.autofocus) void nextTick(focus);
});

onBeforeUnmount(() => {
  if (scrollAnimationFrame) cancelAnimationFrame(scrollAnimationFrame);
  for (const url of previewUrls) URL.revokeObjectURL(url);
});

defineExpose({ focus, getScrollProgress, restoreScrollProgress, scrollToHeading, replaceInlineImage, removeInlineImage });
</script>

<template>
  <div class="rich-editor" :class="{ 'rich-editor--compact': compact, 'rich-editor--disabled': disabled }">
    <div class="rich-editor-toolbar" role="toolbar" aria-label="Text formatting">
      <select class="rich-editor-style" :value="blockStyle" :disabled="disabled" title="Paragraph style" @mousedown="rememberSelection" @change="changeBlockStyle">
        <option value="p">Paragraph</option>
        <option value="h1">Title</option>
        <option value="h2">Heading</option>
        <option value="h3">Subheading</option>
        <option value="blockquote">Quote</option>
      </select>

      <span class="rich-editor-divider" />
      <button class="rich-editor-tool" type="button" title="Undo" :disabled="disabled" @mousedown.prevent="runCommand('undo')"><Undo2 /></button>
      <button class="rich-editor-tool" type="button" title="Redo" :disabled="disabled" @mousedown.prevent="runCommand('redo')"><Redo2 /></button>
      <span class="rich-editor-divider" />
      <button class="rich-editor-tool" type="button" title="Bold" :disabled="disabled" @mousedown.prevent="runCommand('bold')"><Bold /></button>
      <button class="rich-editor-tool" type="button" title="Italic" :disabled="disabled" @mousedown.prevent="runCommand('italic')"><Italic /></button>
      <button class="rich-editor-tool" type="button" title="Underline" :disabled="disabled" @mousedown.prevent="runCommand('underline')"><Underline /></button>
      <button class="rich-editor-tool" type="button" title="Strikethrough" :disabled="disabled" @mousedown.prevent="runCommand('strikeThrough')"><Strikethrough /></button>
      <span class="rich-editor-divider" />
      <button class="rich-editor-tool" type="button" title="Bullet list" :disabled="disabled" @mousedown.prevent="runCommand('insertUnorderedList')"><List /></button>
      <button class="rich-editor-tool" type="button" title="Numbered list" :disabled="disabled" @mousedown.prevent="runCommand('insertOrderedList')"><ListOrdered /></button>
      <button class="rich-editor-tool" type="button" title="Quote" :disabled="disabled" @mousedown.prevent="runCommand('formatBlock', '<blockquote>')"><Quote /></button>
      <span class="rich-editor-divider" />
      <button class="rich-editor-tool" type="button" title="Align left" :disabled="disabled" @mousedown.prevent="runCommand('justifyLeft')"><AlignLeft /></button>
      <button class="rich-editor-tool" type="button" title="Align center" :disabled="disabled" @mousedown.prevent="runCommand('justifyCenter')"><AlignCenter /></button>
      <button class="rich-editor-tool" type="button" title="Align right" :disabled="disabled" @mousedown.prevent="runCommand('justifyRight')"><AlignRight /></button>
      <span class="rich-editor-divider" />
      <label class="rich-editor-colour" title="Text colour"><span>A</span><input v-model="textColor" type="color" :disabled="disabled" @mousedown="rememberSelection" @change="applyTextColor" /></label>
      <label class="rich-editor-colour rich-editor-colour--highlight" title="Highlight colour"><span>A</span><input v-model="highlightColor" type="color" :disabled="disabled" @mousedown="rememberSelection" @change="applyHighlightColor" /></label>
      <button class="rich-editor-tool" type="button" title="Insert link" :disabled="disabled" @mousedown.prevent="insertLink"><Link2 /></button>
      <button class="rich-editor-tool rich-editor-tool--label" type="button" title="Insert image" :disabled="disabled" @mousedown.prevent="rememberSelection" @click="chooseImages"><ImagePlus /><span>Image</span></button>
      <button class="rich-editor-tool" type="button" title="Clear formatting" :disabled="disabled" @mousedown.prevent="runCommand('removeFormat')"><Eraser /></button>
      <span v-if="showAppearance" class="rich-editor-divider" />
      <button
        v-if="showAppearance"
        class="rich-editor-tool rich-editor-tool--label"
        :class="{ 'rich-editor-tool--active': appearanceOpen }"
        type="button"
        title="Reading and editing appearance"
        :disabled="disabled"
        @mousedown.prevent="rememberSelection"
        @click="appearanceOpen = !appearanceOpen"
      ><Palette /><span>Appearance</span></button>
      <input
        ref="imageInput"
        class="hidden"
        type="file"
        accept="image/*,.apng,.avif,.bmp,.cur,.dib,.gif,.heic,.heif,.ico,.j2c,.j2k,.jpe,.jpeg,.jfif,.jp2,.jpg,.jpx,.jxl,.pjp,.pjpeg,.png,.svg,.tif,.tiff,.webp"
        multiple
        :disabled="disabled"
        @change="onImageChange"
      />
    </div>

    <ReadingAppearanceControls v-if="appearanceOpen" compact />

    <div
      ref="editor"
      class="rich-editor-canvas"
      :class="{
        'rich-editor-canvas--empty': !modelValue,
        'rich-editor-canvas--auto-grow': autoGrow
      }"
      :contenteditable="disabled ? 'false' : 'true'"
      :data-placeholder="placeholder"
      :style="editorCanvasStyle"
      role="textbox"
      aria-multiline="true"
      spellcheck="true"
      @input="emitContent"
      @mouseup="rememberSelection"
      @keyup="rememberSelection"
      @blur="onBlur"
      @paste="onPaste"
      @drop="onDrop"
      @dragover.prevent
    />
  </div>
</template>

<style scoped>
.rich-editor {
  overflow: hidden;
  border: 1px solid #d9d6cc;
  border-radius: 0.9rem;
  background: white;
  box-shadow: 0 8px 22px rgba(39, 49, 44, 0.06);
}

.rich-editor:focus-within {
  border-color: #6baaa4;
  box-shadow: 0 0 0 3px rgba(82, 170, 168, 0.12), 0 10px 28px rgba(39, 49, 44, 0.08);
}

.rich-editor-toolbar {
  display: flex;
  min-height: 2.7rem;
  align-items: center;
  gap: 0.15rem;
  overflow-x: auto;
  border-bottom: 1px solid #e5e2d9;
  background: #faf9f5;
  padding: 0.35rem 0.45rem;
  scrollbar-width: thin;
}

.rich-editor-style {
  height: 2rem;
  min-width: 7.5rem;
  border: 0;
  border-radius: 0.45rem;
  background: transparent;
  padding: 0 0.5rem;
  color: #363a35;
  font-size: 0.75rem;
  font-weight: 700;
  outline: none;
}

.rich-editor-style:hover,
.rich-editor-style:focus { background: white; }

.rich-editor-divider {
  width: 1px;
  height: 1.45rem;
  flex: 0 0 auto;
  margin: 0 0.2rem;
  background: #d9d6cc;
}

.rich-editor-tool {
  display: inline-flex;
  width: 2rem;
  height: 2rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border-radius: 0.45rem;
  color: #555b54;
  transition: background-color 120ms ease, color 120ms ease, transform 120ms ease;
}

.rich-editor-tool :deep(svg) { width: 0.95rem; height: 0.95rem; }
.rich-editor-tool:hover:not(:disabled) { background: white; color: #1f5652; transform: translateY(-1px); }
.rich-editor-tool--active { background: #e6f2f0; color: #1f6560; }
.rich-editor-tool:disabled { cursor: not-allowed; opacity: 0.35; }
.rich-editor-tool--label { width: auto; padding: 0 0.55rem; font-size: 0.72rem; font-weight: 700; }

.rich-editor-colour {
  position: relative;
  display: grid;
  width: 2rem;
  height: 2rem;
  flex: 0 0 auto;
  cursor: pointer;
  place-items: center;
  border-radius: 0.45rem;
  color: #343934;
  font-size: 0.8rem;
  font-weight: 800;
}

.rich-editor-colour:hover { background: white; }
.rich-editor-colour::after { content: ""; position: absolute; right: 0.35rem; bottom: 0.25rem; left: 0.35rem; height: 0.18rem; border-radius: 1rem; background: v-bind(textColor); }
.rich-editor-colour--highlight::after { height: 0.38rem; background: v-bind(highlightColor); opacity: 0.75; }
.rich-editor-colour input { position: absolute; width: 1px; height: 1px; opacity: 0; }

.rich-editor-canvas {
  resize: vertical;
  overflow: auto;
  background: var(--editor-surface, white);
  padding: 1.1rem 1.25rem;
  color: var(--editor-ink, #2c302c);
  font-family: var(--editor-font-family, ui-serif, Georgia, Cambria, "Times New Roman", serif);
  font-size: var(--editor-font-size, 1rem);
  line-height: var(--editor-line-height, 1.72);
  outline: none;
  transition: background-color 160ms ease, color 160ms ease;
}

.rich-editor-canvas--auto-grow {
  height: auto;
  overflow-y: visible;
  resize: none;
}

.rich-editor-canvas:empty::before {
  content: attr(data-placeholder);
  color: color-mix(in srgb, var(--editor-ink, #2c302c) 48%, transparent);
  pointer-events: none;
}

.rich-editor-canvas :deep(h1) { margin: 0.8rem 0 0.45rem; font-size: 1.8rem; line-height: 1.25; }
.rich-editor-canvas :deep(h2) { margin: 0.75rem 0 0.4rem; font-size: 1.4rem; line-height: 1.3; }
.rich-editor-canvas :deep(h3) { margin: 0.65rem 0 0.35rem; font-size: 1.15rem; line-height: 1.35; }
.rich-editor-canvas :deep(p) { margin: 0.55rem 0; }
.rich-editor-canvas :deep(ul), .rich-editor-canvas :deep(ol) { margin: 0.55rem 0; padding-left: 1.6rem; }
.rich-editor-canvas :deep(ul) { list-style: disc; }
.rich-editor-canvas :deep(ol) { list-style: decimal; }
.rich-editor-canvas :deep(blockquote) { margin: 0.75rem 0; border-left: 3px solid color-mix(in srgb, var(--editor-ink) 40%, transparent); padding: 0.2rem 0 0.2rem 0.9rem; color: color-mix(in srgb, var(--editor-ink) 72%, transparent); }
.rich-editor-canvas :deep(a) { color: inherit; font-weight: 700; text-decoration: underline; text-decoration-thickness: 0.1em; text-underline-offset: 2px; }
.rich-editor-canvas :deep(code) { border-radius: 4px; background: color-mix(in srgb, var(--editor-ink) 9%, var(--editor-surface)); padding: 0.12rem 0.3rem; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; font-size: 0.875em; }
.rich-editor-canvas :deep(pre) { max-width: 100%; overflow-x: auto; border: 1px solid color-mix(in srgb, var(--editor-ink) 18%, var(--editor-surface)); border-radius: 6px; background: #272724; padding: 0.75rem; color: #f7f7f4; }
.rich-editor-canvas :deep(pre code) { display: block; min-width: max-content; background: transparent; padding: 0; color: inherit; font-size: 0.78rem; line-height: 1.55; }
.rich-editor-canvas :deep(figure) { margin: 1rem auto; text-align: center; }
.rich-editor-canvas :deep(img) { display: block; max-width: min(100%, 56rem); max-height: 38rem; margin: 0 auto; border-radius: 0.65rem; object-fit: contain; box-shadow: 0 7px 22px rgba(35, 47, 42, 0.12); }
.rich-editor-canvas :deep(figcaption) { margin-top: 0.35rem; color: color-mix(in srgb, var(--editor-ink) 68%, transparent); font-family: Inter, ui-sans-serif, system-ui, sans-serif; font-size: 0.72rem; line-height: 1.4; }

.rich-editor--compact .rich-editor-canvas { padding: 0.8rem 0.95rem; }
.rich-editor--disabled { opacity: 0.7; }

@media (max-width: 640px) {
  .rich-editor-canvas { padding: 0.9rem; }
  .rich-editor-tool--label span { display: none; }
  .rich-editor-tool--label { width: 2rem; padding: 0; }
}
</style>
