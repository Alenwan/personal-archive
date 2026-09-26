<script setup lang="ts">
import DOMPurify from "dompurify";
import { strFromU8, unzipSync } from "fflate";
import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  ListTree,
  Loader2,
  Minus,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Plus
} from "lucide-vue-next";
import { marked } from "marked";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { client } from "../api/client";
import ReadingAppearanceControls from "../components/reading/ReadingAppearanceControls.vue";
import { useReaderContentsVisibility } from "../composables/useReaderContentsVisibility";
import { useReadingPreferences } from "../readingPreferences";
import type { DocumentRecord } from "../shared/types";

interface TocEntry {
  id: string;
  label: string;
  level: number;
  anchorId?: string;
  chapterIndex?: number;
}

interface EpubChapter {
  id: string;
  title: string;
  sourcePath: string;
  html: string;
}

const route = useRoute();
const router = useRouter();
const documentRecord = ref<DocumentRecord | null>(null);
const loading = ref(true);
const error = ref("");
const textHtml = ref("");
const toc = ref<TocEntry[]>([]);
const activeTocId = ref("");
const chapters = ref<EpubChapter[]>([]);
const currentChapterIndex = ref(0);
const appearanceOpen = ref(false);
const readingPane = ref<HTMLElement | null>(null);
const contentsHideButton = ref<HTMLButtonElement | null>(null);
const contentsRestoreButton = ref<HTMLButtonElement | null>(null);
const epubFiles = ref<Record<string, Uint8Array>>({});
const epubMimeByPath = ref<Record<string, string>>({});

const { preferences, fontFamily } = useReadingPreferences();
const { contentsOpen: outlineOpen } = useReaderContentsVisibility("personal-archive.archive-reader-contents-open");

function returnToArchive() {
  if (typeof window.history.state?.archiveReaderReturn === "string") {
    router.back();
    return;
  }
  void router.push("/documents");
}

async function hideContents() {
  outlineOpen.value = false;
  await nextTick();
  contentsRestoreButton.value?.focus();
}

async function showContents() {
  outlineOpen.value = true;
  await nextTick();
  contentsHideButton.value?.focus();
}

const documentId = computed(() => String(route.params.id));
const fileExtension = computed(() => documentRecord.value?.originalFileName.toLowerCase().split(".").pop() ?? "");
const isPdf = computed(() => documentRecord.value?.mimeType === "application/pdf" || fileExtension.value === "pdf");
const isEpub = computed(() => documentRecord.value?.mimeType === "application/epub+zip" || fileExtension.value === "epub");
const currentChapter = computed(() => chapters.value[currentChapterIndex.value] ?? null);
const readerTitle = computed(() => documentRecord.value?.originalFileName.replace(/\.[^.]+$/, "") || "Reader");
const progress = computed(() => {
  if (!chapters.value.length) return 0;
  return Math.round(((currentChapterIndex.value + 1) / chapters.value.length) * 100);
});
const readerStyle = computed(() => ({
  "--reader-surface": preferences.backgroundColor,
  "--reader-ink": preferences.textColor,
  "--reader-muted": "color-mix(in srgb, var(--reader-ink) 68%, var(--reader-surface))",
  "--reader-border": "color-mix(in srgb, var(--reader-ink) 18%, var(--reader-surface))",
  "--appearance-surface": preferences.backgroundColor,
  "--appearance-ink": preferences.textColor,
  "--reader-font-size": `${preferences.fontSize}px`,
  "--reader-line-height": String(preferences.lineHeight),
  "--reader-content-width": `${preferences.contentWidth}px`,
  "--reader-font-family": fontFamily.value
}));

function xmlElements(document: XMLDocument, localName: string): Element[] {
  return Array.from(document.getElementsByTagNameNS("*", localName));
}

function normalizeArchivePath(value: string): string {
  const parts: string[] = [];
  for (const part of value.replace(/^\/+/, "").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function resolveArchivePath(baseFile: string, href: string): string {
  const cleanHref = decodeURIComponent(href.split("#")[0] || "");
  if (!cleanHref) return normalizeArchivePath(baseFile);
  const baseDirectory = baseFile.split("/").slice(0, -1).join("/");
  return normalizeArchivePath(cleanHref.startsWith("/") ? cleanHref : `${baseDirectory}/${cleanHref}`);
}

function slug(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function mimeForPath(path: string): string {
  if (epubMimeByPath.value[path]) return epubMimeByPath.value[path];
  const extension = path.toLowerCase().split(".").pop();
  if (extension === "png") return "image/png";
  if (extension === "gif") return "image/gif";
  if (extension === "svg") return "image/svg+xml";
  if (extension === "webp") return "image/webp";
  return "image/jpeg";
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function sanitizeReadingHtml(source: string, sourcePath = ""): { html: string; headings: TocEntry[] } {
  const parsed = new DOMParser().parseFromString(`<main>${source}</main>`, "text/html");
  const main = parsed.querySelector("main")!;
  main.querySelectorAll("script, style, iframe, object, embed, form, input, button, video, audio").forEach((node) => node.remove());
  main.querySelectorAll("img").forEach((image) => {
    const rawSource = image.getAttribute("src") || "";
    if (!sourcePath || !rawSource || /^(data:|https?:)/i.test(rawSource)) return;
    const assetPath = resolveArchivePath(sourcePath, rawSource);
    const asset = epubFiles.value[assetPath];
    if (asset) image.setAttribute("src", bytesToDataUrl(asset, mimeForPath(assetPath)));
    else image.removeAttribute("src");
  });

  const headings: TocEntry[] = [];
  const usedIds = new Set<string>();
  main.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((heading, index) => {
    const label = heading.textContent?.trim() || `Section ${index + 1}`;
    const baseId = slug(label, `section-${index + 1}`);
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`;
    usedIds.add(id);
    heading.id = id;
    headings.push({ id, label, level: Number(heading.tagName.slice(1)), anchorId: id });
  });

  const html = DOMPurify.sanitize(main.innerHTML, {
    ALLOWED_TAGS: [
      "a", "abbr", "article", "aside", "blockquote", "br", "caption", "code", "del", "div", "em", "figcaption",
      "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "img", "li", "main", "ol", "p", "pre", "section",
      "small", "span", "strong", "sub", "sup", "table", "tbody", "td", "th", "thead", "tr", "u", "ul"
    ],
    ALLOWED_ATTR: ["alt", "colspan", "height", "href", "id", "rowspan", "src", "title", "width"],
    ALLOW_DATA_ATTR: false,
    FORBID_ATTR: ["style"]
  });
  return { html, headings };
}

function plainTextToHtml(source: string): string {
  const parsed = new DOMParser().parseFromString("<main></main>", "text/html");
  const main = parsed.querySelector("main")!;
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    const p = parsed.createElement("p");
    p.textContent = paragraph.join(" ");
    main.appendChild(p);
    paragraph = [];
  };
  lines.forEach((line) => {
    const trimmed = line.trim();
    const markdownHeading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    const chapterHeading = trimmed.match(/^(第\s*[\d一二三四五六七八九十百千]+\s*[章节卷篇部]|chapter\s+\d+|part\s+\d+)\b.*$/i);
    if (markdownHeading || chapterHeading) {
      flushParagraph();
      const level = markdownHeading ? Math.min(markdownHeading[1].length, 6) : 2;
      const heading = parsed.createElement(`h${level}`);
      heading.textContent = markdownHeading?.[2] || trimmed;
      main.appendChild(heading);
    } else if (!trimmed) {
      flushParagraph();
    } else {
      paragraph.push(trimmed);
    }
  });
  flushParagraph();
  return main.innerHTML;
}

function buildTextDocument(source: string, format: string) {
  const rendered = format === "md" || format === "markdown"
    ? String(marked.parse(source, { async: false, breaks: true, gfm: true }))
    : format === "html" || format === "htm"
      ? source
      : plainTextToHtml(source);
  const result = sanitizeReadingHtml(rendered);
  textHtml.value = result.html;
  toc.value = result.headings;
  activeTocId.value = result.headings[0]?.id ?? "";
}

function epubTitleForPath(path: string, html: string, fallbackIndex: number): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  return parsed.querySelector("h1, h2, title")?.textContent?.trim() || path.split("/").pop()?.replace(/\.[^.]+$/, "") || `Chapter ${fallbackIndex + 1}`;
}

function buildEpub(arrayBuffer: ArrayBuffer) {
  const files = unzipSync(new Uint8Array(arrayBuffer));
  epubFiles.value = files;
  const containerBytes = files["META-INF/container.xml"];
  if (!containerBytes) throw new Error("This EPUB does not contain META-INF/container.xml.");
  const container = new DOMParser().parseFromString(strFromU8(containerBytes), "application/xml");
  const opfPath = xmlElements(container, "rootfile")[0]?.getAttribute("full-path");
  if (!opfPath || !files[opfPath]) throw new Error("The EPUB package document could not be found.");
  const opf = new DOMParser().parseFromString(strFromU8(files[opfPath]), "application/xml");

  const manifest = new Map<string, { path: string; mediaType: string; properties: string }>();
  xmlElements(opf, "item").forEach((item) => {
    const id = item.getAttribute("id") || "";
    const href = item.getAttribute("href") || "";
    if (!id || !href) return;
    const path = resolveArchivePath(opfPath, href);
    const mediaType = item.getAttribute("media-type") || "application/octet-stream";
    manifest.set(id, { path, mediaType, properties: item.getAttribute("properties") || "" });
    epubMimeByPath.value[path] = mediaType;
  });

  const nextChapters: EpubChapter[] = [];
  xmlElements(opf, "itemref").forEach((itemRef, index) => {
    const manifestItem = manifest.get(itemRef.getAttribute("idref") || "");
    if (!manifestItem || !files[manifestItem.path]) return;
    const source = strFromU8(files[manifestItem.path]);
    const body = new DOMParser().parseFromString(source, "text/html").body.innerHTML;
    const result = sanitizeReadingHtml(body, manifestItem.path);
    nextChapters.push({
      id: `chapter-${index + 1}`,
      title: epubTitleForPath(manifestItem.path, source, index),
      sourcePath: manifestItem.path,
      html: result.html
    });
  });
  if (!nextChapters.length) throw new Error("No readable chapters were found in this EPUB.");
  chapters.value = nextChapters;

  const navManifest = [...manifest.values()].find((item) => item.properties.split(/\s+/).includes("nav"));
  const navEntries: TocEntry[] = [];
  if (navManifest && files[navManifest.path]) {
    const navDocument = new DOMParser().parseFromString(strFromU8(files[navManifest.path]), "text/html");
    const nav = [...navDocument.querySelectorAll("nav")].find((item) => item.getAttribute("epub:type") === "toc") || navDocument.querySelector("nav");
    nav?.querySelectorAll("a[href]").forEach((link, index) => {
      const label = link.textContent?.trim() || `Section ${index + 1}`;
      const targetPath = resolveArchivePath(navManifest.path, link.getAttribute("href") || "");
      const chapterIndex = nextChapters.findIndex((chapter) => chapter.sourcePath === targetPath);
      if (chapterIndex >= 0) navEntries.push({ id: `epub-toc-${index}`, label, level: 1, chapterIndex });
    });
  }
  toc.value = navEntries.length
    ? navEntries
    : nextChapters.map((chapter, index) => ({ id: chapter.id, label: chapter.title, level: 1, chapterIndex: index }));
  restoreEpubState();
}

function stateKey() {
  return `personal-archive.reader-state.${documentId.value}`;
}

function restoreEpubState() {
  try {
    const state = JSON.parse(localStorage.getItem(stateKey()) || "{}") as { chapterIndex?: number };
    currentChapterIndex.value = Math.min(Math.max(state.chapterIndex ?? 0, 0), Math.max(chapters.value.length - 1, 0));
  } catch {
    currentChapterIndex.value = 0;
  }
  activeTocId.value = toc.value.find((entry) => entry.chapterIndex === currentChapterIndex.value)?.id ?? toc.value[0]?.id ?? "";
}

function saveEpubState() {
  localStorage.setItem(stateKey(), JSON.stringify({ chapterIndex: currentChapterIndex.value, updatedAt: new Date().toISOString() }));
}

async function loadDocument() {
  loading.value = true;
  error.value = "";
  try {
    documentRecord.value = await client.document(documentId.value);
    if (isPdf.value) return;
    const response = await fetch(`/api/documents/${documentId.value}/preview`, { credentials: "include" });
    if (!response.ok) throw new Error(`Reader could not load this file (${response.status}).`);
    if (isEpub.value) buildEpub(await response.arrayBuffer());
    else buildTextDocument(await response.text(), fileExtension.value);
    await nextTick();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Unable to open this reading material.";
  } finally {
    loading.value = false;
  }
}

function selectTocEntry(entry: TocEntry) {
  activeTocId.value = entry.id;
  if (entry.chapterIndex !== undefined) {
    currentChapterIndex.value = entry.chapterIndex;
    saveEpubState();
    readingPane.value?.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  const target = entry.anchorId ? document.getElementById(entry.anchorId) : null;
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function moveChapter(delta: number) {
  currentChapterIndex.value = Math.min(Math.max(currentChapterIndex.value + delta, 0), chapters.value.length - 1);
  activeTocId.value = toc.value.find((entry) => entry.chapterIndex === currentChapterIndex.value)?.id ?? "";
  saveEpubState();
  readingPane.value?.scrollTo({ top: 0, behavior: "smooth" });
}

function onTextScroll() {
  if (!readingPane.value || chapters.value.length) return;
  const paneTop = readingPane.value.getBoundingClientRect().top;
  let active = toc.value[0];
  for (const entry of toc.value) {
    if (!entry.anchorId) continue;
    const heading = document.getElementById(entry.anchorId);
    if (heading && heading.getBoundingClientRect().top - paneTop <= 120) active = entry;
    else break;
  }
  if (active) activeTocId.value = active.id;
}

function openReadingLink(event: MouseEvent) {
  if (!(event.target instanceof Element)) return;
  const link = event.target.closest("a");
  const href = link?.getAttribute("href") || "";
  if (!link || !href) return;
  event.preventDefault();
  if (/^https?:/i.test(href)) {
    window.open(href, "_blank", "noopener,noreferrer");
    return;
  }
  if (currentChapter.value) {
    const targetPath = resolveArchivePath(currentChapter.value.sourcePath, href);
    const chapterIndex = chapters.value.findIndex((chapter) => chapter.sourcePath === targetPath);
    if (chapterIndex >= 0) moveChapter(chapterIndex - currentChapterIndex.value);
  }
}

watch(currentChapterIndex, saveEpubState);

onMounted(loadDocument);
onBeforeUnmount(saveEpubState);
</script>

<template>
  <div class="reader-shell fixed inset-0 z-40 flex flex-col" :style="readerStyle">
    <header class="reader-toolbar flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 sm:px-4">
      <button class="reader-icon-button" type="button" title="Back to archive" @click="returnToArchive">
        <ArrowLeft class="h-4 w-4" />
      </button>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-semibold">{{ readerTitle }}</p>
        <p class="truncate text-xs reader-muted">
          <template v-if="chapters.length">Chapter {{ currentChapterIndex + 1 }} of {{ chapters.length }} · {{ progress }}%</template>
          <template v-else-if="isPdf">PDF document · browser layout</template>
          <template v-else>Comfort reader</template>
        </p>
      </div>

      <div v-if="!isPdf" class="flex items-center rounded-md border reader-border">
        <button class="reader-icon-button border-0" type="button" title="Smaller text" :disabled="preferences.fontSize <= 14" @click="preferences.fontSize--"><Minus class="h-4 w-4" /></button>
        <span class="w-10 text-center text-xs font-semibold">{{ preferences.fontSize }}</span>
        <button class="reader-icon-button border-0" type="button" title="Larger text" :disabled="preferences.fontSize >= 30" @click="preferences.fontSize++"><Plus class="h-4 w-4" /></button>
      </div>
      <button v-if="!isPdf" class="reader-icon-button reader-icon-button--label" :class="{ 'is-active': appearanceOpen }" type="button" title="Reading appearance" @click="appearanceOpen = !appearanceOpen">
        <Palette class="h-4 w-4" /><span>Appearance</span>
      </button>
      <a class="reader-icon-button" :href="`/api/documents/${documentId}/download`" title="Download original"><Download class="h-4 w-4" /></a>
    </header>

    <ReadingAppearanceControls v-if="appearanceOpen && !isPdf" compact />

    <div v-if="loading" class="grid min-h-0 flex-1 place-items-center">
      <div class="text-center">
        <Loader2 class="mx-auto h-7 w-7 animate-spin" />
        <p class="mt-3 text-sm font-semibold">Preparing the reader...</p>
      </div>
    </div>
    <div v-else-if="error" class="grid min-h-0 flex-1 place-items-center p-6 text-center">
      <div class="max-w-md">
        <BookOpen class="mx-auto h-10 w-10 reader-muted" />
        <h1 class="mt-4 text-xl font-semibold">This file could not be opened in the reader</h1>
        <p class="mt-2 text-sm leading-6 reader-muted">{{ error }}</p>
        <div class="mt-5 flex justify-center gap-2">
          <button class="reader-action" type="button" @click="returnToArchive">Back to archive</button>
          <a class="reader-action" :href="`/api/documents/${documentId}/download`">Download original</a>
        </div>
      </div>
    </div>
    <div v-else class="reader-layout" :class="{ 'reader-layout--outline': outlineOpen }">
      <aside v-if="outlineOpen" class="reader-outline min-h-0 overflow-y-auto border-r p-3">
        <div class="reader-outline-heading">
          <ListTree class="h-4 w-4" />
          <h2 class="text-sm font-semibold">Contents</h2>
          <button
            ref="contentsHideButton"
            type="button"
            title="Hide contents"
            aria-label="Hide contents"
            :aria-expanded="true"
            @click="hideContents"
          ><PanelLeftClose class="h-4 w-4" /></button>
        </div>
        <nav v-if="toc.length" class="space-y-0.5">
          <button
            v-for="entry in toc"
            :key="entry.id"
            class="reader-toc-link"
            :class="activeTocId === entry.id ? 'reader-toc-link--active' : ''"
            :style="{ paddingLeft: `${Math.min(entry.level - 1, 3) * 12 + 10}px` }"
            type="button"
            @click="selectTocEntry(entry)"
          >
            {{ entry.label }}
          </button>
        </nav>
        <div v-else class="px-2 py-5 text-sm leading-6 reader-muted">
          <Columns3 class="mb-3 h-5 w-5" />
          No embedded outline was found. Text files gain an outline when they use headings such as <strong># Title</strong> or <strong>Chapter 1</strong>.
        </div>
      </aside>

      <button
        v-else
        ref="contentsRestoreButton"
        class="reader-contents-tab"
        type="button"
        title="Show contents"
        aria-label="Show contents"
        :aria-expanded="false"
        @click="showContents"
      ><PanelLeftOpen class="h-4 w-4" /><span>Contents</span></button>

      <main ref="readingPane" class="reader-pane min-h-0 overflow-y-auto" @scroll.passive="onTextScroll">
        <iframe v-if="isPdf" class="h-full min-h-[70vh] w-full bg-white" :src="`/api/documents/${documentId}/preview`" title="PDF reader" />
        <article v-else class="reader-article mx-auto" @click="openReadingLink">
          <div v-if="currentChapter" v-html="currentChapter.html"></div>
          <div v-else v-html="textHtml"></div>

          <footer v-if="chapters.length" class="reader-chapter-nav mt-14 flex items-center justify-between gap-3 border-t pt-6">
            <button class="reader-action" type="button" :disabled="currentChapterIndex === 0" @click="moveChapter(-1)">
              <ChevronLeft class="h-4 w-4" /> Previous
            </button>
            <span class="text-xs font-semibold reader-muted">{{ progress }}% complete</span>
            <button class="reader-action" type="button" :disabled="currentChapterIndex >= chapters.length - 1" @click="moveChapter(1)">
              Next <ChevronRight class="h-4 w-4" />
            </button>
          </footer>
        </article>
      </main>
    </div>
  </div>
</template>

<style scoped>
.reader-shell {
  background: var(--reader-surface);
  color: var(--reader-ink);
}

.reader-toolbar {
  border-color: var(--reader-border);
  background: color-mix(in srgb, var(--reader-surface) 94%, transparent);
  backdrop-filter: blur(14px);
}

.reader-muted { color: var(--reader-muted); }
.reader-border { border-color: var(--reader-border); }
.reader-layout { position: relative; display: grid; min-height: 0; flex: 1; grid-template-columns: minmax(0, 1fr); transition: grid-template-columns 180ms ease; }
.reader-layout--outline { grid-template-columns: 280px minmax(0, 1fr); }

.reader-icon-button,
.reader-action,
.reader-select {
  border: 1px solid var(--reader-border);
  border-radius: 6px;
  background: transparent;
  color: var(--reader-ink);
  transition: background-color 150ms ease, transform 150ms ease;
}

.reader-icon-button {
  display: inline-grid;
  min-width: 2.25rem;
  height: 2.25rem;
  place-items: center;
  padding: 0 0.55rem;
}
.reader-icon-button--label { display: inline-flex; align-items: center; gap: 0.4rem; }
.reader-icon-button.is-active { background: color-mix(in srgb, var(--reader-ink) 10%, transparent); }

.reader-icon-button:hover,
.reader-action:hover,
.reader-select:hover { background: color-mix(in srgb, var(--reader-ink) 7%, transparent); }
.reader-icon-button:active,
.reader-action:active { transform: translateY(1px); }
.reader-icon-button:disabled,
.reader-action:disabled { cursor: not-allowed; opacity: 0.4; }

.reader-action {
  display: inline-flex;
  min-height: 2.35rem;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 0.4rem 0.8rem;
  font-size: 0.82rem;
  font-weight: 700;
}

.reader-select {
  height: 2.25rem;
  padding: 0 1.7rem 0 0.55rem;
  font-size: 0.78rem;
  font-weight: 700;
}

.reader-outline { border-color: var(--reader-border); }
.reader-outline-heading { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; padding: 0 0.5rem; }
.reader-outline-heading button { display: grid; width: 1.8rem; height: 1.8rem; margin-left: auto; place-items: center; border-radius: 5px; color: var(--reader-muted); transition: background-color 140ms ease, color 140ms ease; }
.reader-outline-heading button:hover,
.reader-outline-heading button:focus-visible { background: color-mix(in srgb, var(--reader-ink) 7%, transparent); color: var(--reader-ink); outline: none; }

.reader-contents-tab { position: absolute; z-index: 3; top: 0.75rem; left: 0; display: flex; width: 2rem; height: 6.25rem; flex-direction: column; align-items: center; justify-content: center; gap: 0.45rem; border: 1px solid var(--reader-border); border-left: 0; border-radius: 0 6px 6px 0; background: color-mix(in srgb, var(--reader-surface) 94%, var(--reader-ink)); color: var(--reader-muted); box-shadow: 2px 4px 14px color-mix(in srgb, var(--reader-ink) 9%, transparent); transition: width 140ms ease, background-color 140ms ease, color 140ms ease; }
.reader-contents-tab:hover,
.reader-contents-tab:focus-visible { width: 2.25rem; background: color-mix(in srgb, var(--reader-ink) 7%, var(--reader-surface)); color: var(--reader-ink); outline: none; }
.reader-contents-tab span { writing-mode: vertical-rl; font-size: 0.6rem; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; }

.reader-toc-link {
  display: block;
  width: 100%;
  overflow: hidden;
  border-radius: 5px;
  padding: 0.5rem 0.65rem;
  color: var(--reader-muted);
  font-size: 0.82rem;
  line-height: 1.35;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: background-color 140ms ease, color 140ms ease;
}

.reader-toc-link:hover { background: color-mix(in srgb, var(--reader-ink) 6%, transparent); color: var(--reader-ink); }
.reader-toc-link--active { background: color-mix(in srgb, #2f7875 15%, transparent); color: var(--reader-ink); font-weight: 750; }

.reader-pane { scroll-behavior: smooth; }
.reader-article {
  max-width: var(--reader-content-width);
  min-height: 100%;
  padding: clamp(2rem, 6vw, 5.5rem) clamp(1.25rem, 4vw, 3.25rem) 6rem;
  color: var(--reader-ink);
  font-family: var(--reader-font-family);
  font-size: var(--reader-font-size);
  line-height: var(--reader-line-height);
}

.reader-article :deep(h1),
.reader-article :deep(h2),
.reader-article :deep(h3),
.reader-article :deep(h4),
.reader-article :deep(h5),
.reader-article :deep(h6) {
  scroll-margin-top: 5rem;
  color: var(--reader-ink);
  font-family: var(--reader-font-family);
  font-weight: 750;
  line-height: 1.25;
}
.reader-article :deep(h1) { margin: 0 0 1.6em; font-size: 2em; }
.reader-article :deep(h2) { margin: 2.2em 0 0.8em; font-size: 1.5em; }
.reader-article :deep(h3) { margin: 1.8em 0 0.65em; font-size: 1.22em; }
.reader-article :deep(h4),
.reader-article :deep(h5),
.reader-article :deep(h6) { margin: 1.6em 0 0.55em; font-size: 1.05em; }
.reader-article :deep(p) { margin: 0 0 1.1em; }
.reader-article :deep(ul),
.reader-article :deep(ol) { margin: 0 0 1.2em; padding-left: 1.55em; }
.reader-article :deep(ul) { list-style: disc; }
.reader-article :deep(ol) { list-style: decimal; }
.reader-article :deep(li + li) { margin-top: 0.35em; }
.reader-article :deep(blockquote) {
  margin: 1.5em 0;
  border-left: 3px solid var(--reader-border);
  padding: 0.2em 0 0.2em 1.1em;
  color: var(--reader-muted);
}
.reader-article :deep(a) { color: var(--reader-ink); font-weight: 700; text-decoration: underline; text-decoration-thickness: .1em; text-underline-offset: 3px; }
.reader-article :deep(img) { display: block; max-width: 100%; height: auto; margin: 1.8em auto; border-radius: 4px; }
.reader-article :deep(pre) { overflow-x: auto; border-radius: 6px; background: #171a18; padding: 1em; color: #f1f0e9; font-size: 0.82em; line-height: 1.55; }
.reader-article :deep(code) { border-radius: 3px; background: color-mix(in srgb, var(--reader-ink) 8%, transparent); padding: 0.08em 0.25em; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.86em; }
.reader-article :deep(pre code) { background: transparent; padding: 0; color: inherit; }
.reader-article :deep(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; font-size: 0.86em; }
.reader-article :deep(th),
.reader-article :deep(td) { border: 1px solid var(--reader-border); padding: 0.45em 0.65em; text-align: left; }
.reader-chapter-nav { border-color: var(--reader-border); }

@media (max-width: 767px) {
  .reader-layout--outline { grid-template-columns: minmax(0, 1fr); }
  .reader-outline { position: absolute; inset: 3.55rem 0 0 0; z-index: 2; width: min(86vw, 320px); background: var(--reader-surface); box-shadow: 20px 0 50px rgba(0, 0, 0, 0.15); }
  .reader-contents-tab { top: auto; right: max(0.75rem, env(safe-area-inset-right)); bottom: max(0.75rem, env(safe-area-inset-bottom)); left: auto; width: auto; height: 2.5rem; flex-direction: row; border: 1px solid var(--reader-border); border-radius: 999px; padding: 0 0.85rem; backdrop-filter: blur(10px); }
  .reader-contents-tab:hover,
  .reader-contents-tab:focus-visible { width: auto; }
  .reader-contents-tab span { writing-mode: horizontal-tb; }
}

@media (prefers-reduced-motion: reduce) {
  .reader-layout,
  .reader-contents-tab { transition-duration: 0.01ms; }
}
</style>
