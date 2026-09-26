<script setup lang="ts">
import DOMPurify from "dompurify";
import { Edit3, ListTree, Minus, Palette, PanelLeftClose, PanelLeftOpen, Plus, X } from "lucide-vue-next";
import { marked } from "marked";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useReaderContentsVisibility } from "../../composables/useReaderContentsVisibility";
import { useReadingPreferences } from "../../readingPreferences";
import ReadingAppearanceControls from "./ReadingAppearanceControls.vue";

const props = defineProps<{
  modelValue: boolean;
  source: string;
  title?: string;
  editable?: boolean;
}>();

const emit = defineEmits<{ "update:modelValue": [value: boolean]; edit: [] }>();
const appearanceOpen = ref(false);
const activeId = ref("");
const pane = ref<HTMLElement | null>(null);
const { preferences, fontFamily } = useReadingPreferences();
const { contentsOpen: outlineOpen } = useReaderContentsVisibility("personal-archive.note-reader-contents-open");

const rendered = computed(() => {
  const parsed = String(marked.parse(props.source, { async: false, breaks: true, gfm: true }));
  const document = new DOMParser().parseFromString(`<main>${parsed}</main>`, "text/html");
  const main = document.querySelector("main")!;
  const entries: Array<{ id: string; label: string; level: number }> = [];
  const used = new Set<string>();
  main.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((heading, index) => {
    const label = heading.textContent?.trim() || `Section ${index + 1}`;
    const base = label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || `section-${index + 1}`;
    let id = `note-${base}`;
    let suffix = 2;
    while (used.has(id)) id = `note-${base}-${suffix++}`;
    used.add(id);
    heading.id = id;
    entries.push({ id, label, level: Number(heading.tagName.slice(1)) });
  });
  return {
    html: DOMPurify.sanitize(main.innerHTML, {
      ALLOWED_TAGS: [
        "a", "b", "blockquote", "br", "code", "del", "div", "em", "figcaption", "figure", "h1", "h2", "h3", "h4",
        "h5", "h6", "hr", "i", "img", "li", "ol", "p", "pre", "s", "span", "strike", "strong", "table", "tbody",
        "td", "th", "thead", "tr", "u", "ul"
      ],
      ALLOWED_ATTR: ["alt", "height", "href", "id", "src", "title", "width"],
      ALLOW_DATA_ATTR: false,
      FORBID_ATTR: ["style"]
    }),
    entries
  };
});

const readerStyle = computed(() => {
  return {
    "--note-surface": preferences.backgroundColor,
    "--note-ink": preferences.textColor,
    "--note-muted": "color-mix(in srgb, var(--note-ink) 68%, var(--note-surface))",
    "--note-border": "color-mix(in srgb, var(--note-ink) 18%, var(--note-surface))",
    "--appearance-surface": preferences.backgroundColor,
    "--appearance-ink": preferences.textColor,
    "--note-font-size": `${preferences.fontSize}px`,
    "--note-line-height": String(preferences.lineHeight),
    "--note-width": `${preferences.contentWidth}px`,
    "--note-font": fontFamily.value
  };
});

function close() { emit("update:modelValue", false); }
function edit() { emit("edit"); }
function selectHeading(id: string) {
  activeId.value = id;
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}
function onScroll() {
  if (!pane.value) return;
  const top = pane.value.getBoundingClientRect().top;
  let active = rendered.value.entries[0];
  for (const entry of rendered.value.entries) {
    const heading = document.getElementById(entry.id);
    if (heading && heading.getBoundingClientRect().top - top <= 100) active = entry;
    else break;
  }
  if (active) activeId.value = active.id;
}
function openLink(event: MouseEvent) {
  if (!(event.target instanceof Element)) return;
  const link = event.target.closest("a");
  if (!link?.href) return;
  event.preventDefault();
  window.open(link.href, "_blank", "noopener,noreferrer");
}
function onKeydown(event: KeyboardEvent) { if (event.key === "Escape" && props.modelValue) close(); }

watch(() => props.modelValue, (open) => {
  if (!open) return;
  activeId.value = rendered.value.entries[0]?.id ?? "";
  pane.value?.scrollTo({ top: 0 });
});
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div v-if="modelValue" class="fixed inset-0 z-[70] flex flex-col" :style="readerStyle">
    <header class="note-toolbar flex min-h-12 items-center gap-2 border-b px-3 py-1.5">
      <button class="note-button" type="button" title="Close reader" @click="close"><X class="h-4 w-4" /></button>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-semibold">{{ title || "Topic note" }}</p>
      </div>
      <button class="note-button" type="button" :title="outlineOpen ? 'Hide contents' : 'Show contents'" @click="outlineOpen = !outlineOpen">
        <PanelLeftClose v-if="outlineOpen" class="h-4 w-4" /><PanelLeftOpen v-else class="h-4 w-4" />
      </button>
      <div class="flex items-center rounded-md border note-border">
        <button class="note-button border-0" type="button" :disabled="preferences.fontSize <= 14" @click="preferences.fontSize--"><Minus class="h-4 w-4" /></button>
        <span class="w-10 text-center text-xs font-semibold">{{ preferences.fontSize }}</span>
        <button class="note-button border-0" type="button" :disabled="preferences.fontSize >= 30" @click="preferences.fontSize++"><Plus class="h-4 w-4" /></button>
      </div>
      <button v-if="editable" class="note-button note-button--label" type="button" title="Edit this note" @click="edit">
        <Edit3 class="h-4 w-4" /><span>Edit</span>
      </button>
      <button class="note-button note-button--label" :class="{ 'is-active': appearanceOpen }" type="button" title="Reading appearance" @click="appearanceOpen = !appearanceOpen">
        <Palette class="h-4 w-4" /><span>Appearance</span>
      </button>
    </header>
    <ReadingAppearanceControls v-if="appearanceOpen" compact />
    <div class="relative grid min-h-0 flex-1" :class="outlineOpen ? 'md:grid-cols-[244px_minmax(0,1fr)]' : 'grid-cols-1'">
      <aside v-if="outlineOpen" class="note-outline min-h-0 overflow-y-auto border-r p-3">
        <div class="mb-3 flex items-center gap-2 px-2"><ListTree class="h-4 w-4" /><h2 class="text-sm font-semibold">Contents</h2></div>
        <button
          v-for="entry in rendered.entries"
          :key="entry.id"
          class="note-toc-link"
          :class="activeId === entry.id ? 'note-toc-link--active' : ''"
          :style="{ paddingLeft: `${Math.min(entry.level - 1, 3) * 12 + 10}px` }"
          type="button"
          @click="selectHeading(entry.id)"
        >{{ entry.label }}</button>
        <p v-if="!rendered.entries.length" class="px-2 py-4 text-sm leading-6 note-muted">Add Markdown headings such as <strong># Title</strong> and <strong>## Section</strong> to create a Pages-style outline.</p>
      </aside>
      <main ref="pane" class="min-h-0 overflow-y-auto" @scroll.passive="onScroll">
        <article class="note-article mx-auto" @click="openLink" v-html="rendered.html"></article>
      </main>
    </div>
  </div>
</template>

<style scoped>
.fixed { background: var(--note-surface); color: var(--note-ink); }
.note-toolbar { border-color: var(--note-border); background: color-mix(in srgb, var(--note-surface) 94%, transparent); backdrop-filter: blur(14px); }
.note-muted { color: var(--note-muted); }
.note-border, .note-outline { border-color: var(--note-border); }
.note-button, .note-select { height: 2.25rem; border: 1px solid var(--note-border); border-radius: 6px; background: transparent; color: var(--note-ink); font-size: 0.78rem; font-weight: 700; }
.note-button { display: inline-grid; min-width: 2.25rem; place-items: center; padding: 0 0.55rem; }
.note-button--label { display: inline-flex; align-items: center; gap: 0.4rem; }
.note-button.is-active { background: color-mix(in srgb, var(--note-ink) 10%, transparent); }
.note-select { padding: 0 1.65rem 0 0.55rem; }
.note-button:hover, .note-select:hover { background: color-mix(in srgb, var(--note-ink) 7%, transparent); }
.note-button:disabled { opacity: 0.4; }
.note-toc-link { display: block; width: 100%; overflow: hidden; border-radius: 5px; padding: 0.5rem 0.65rem; color: var(--note-muted); font-size: 0.82rem; line-height: 1.35; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.note-toc-link:hover { background: color-mix(in srgb, var(--note-ink) 6%, transparent); color: var(--note-ink); }
.note-toc-link--active { background: color-mix(in srgb, #2f7875 15%, transparent); color: var(--note-ink); font-weight: 750; }
.note-article { max-width: var(--note-width); min-height: 100%; padding: clamp(2rem, 6vw, 5.5rem) clamp(1.25rem, 4vw, 3.25rem) 6rem; font-family: var(--note-font); font-size: var(--note-font-size); line-height: var(--note-line-height); }
.note-article :deep(h1), .note-article :deep(h2), .note-article :deep(h3), .note-article :deep(h4), .note-article :deep(h5), .note-article :deep(h6) { scroll-margin-top: 5rem; font-weight: 750; line-height: 1.25; }
.note-article :deep(h1) { margin: 0 0 1.5em; font-size: 2em; }
.note-article :deep(h2) { margin: 2.2em 0 0.8em; font-size: 1.5em; }
.note-article :deep(h3) { margin: 1.8em 0 0.65em; font-size: 1.22em; }
.note-article :deep(h4), .note-article :deep(h5), .note-article :deep(h6) { margin: 1.5em 0 0.5em; font-size: 1.05em; }
.note-article :deep(p) { margin: 0 0 1.1em; }
.note-article :deep(ul), .note-article :deep(ol) { margin: 0 0 1.2em; padding-left: 1.55em; }
.note-article :deep(ul) { list-style: disc; }.note-article :deep(ol) { list-style: decimal; }
.note-article :deep(blockquote) { margin: 1.5em 0; border-left: 3px solid var(--note-border); padding-left: 1em; color: var(--note-muted); }
.note-article :deep(a) { color: var(--note-ink); font-weight: 700; text-decoration: underline; text-decoration-thickness: .1em; text-underline-offset: 3px; }
.note-article :deep(figure) { margin: 1.6em 0; text-align: center; }
.note-article :deep(img) { display: block; max-width: 100%; height: auto; margin: 1.4em auto; border-radius: 5px; }
.note-article :deep(figcaption) { margin-top: -.8em; color: var(--note-muted); font-size: .72em; text-align: center; }
.note-article :deep(pre) { overflow-x: auto; border-radius: 6px; background: #171a18; padding: 1em; color: #f1f0e9; font-size: 0.82em; line-height: 1.55; }
.note-article :deep(code) { border-radius: 3px; background: color-mix(in srgb, var(--note-ink) 8%, transparent); padding: 0.08em 0.25em; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.86em; }
.note-article :deep(pre code) { background: transparent; padding: 0; color: inherit; }
@media (max-width: 767px) {
  .note-outline { position: absolute; inset: 0 auto 0 0; z-index: 2; width: min(86vw, 320px); background: var(--note-surface); box-shadow: 20px 0 50px rgba(0,0,0,.15); }
  .note-button--label span { display: none; }
}
</style>
