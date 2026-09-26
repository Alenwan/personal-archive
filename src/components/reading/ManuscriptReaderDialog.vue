<script setup lang="ts">
import DOMPurify from "dompurify";
import {
  ChevronLeft,
  ChevronRight,
  Bookmark,
  PlusCircle,
  Pencil,
  Trash2,
  Edit3,
  ListTree,
  LoaderCircle,
  Minus,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  X
} from "lucide-vue-next";
import { marked } from "marked";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { client } from "../../api/client";
import { useManuscriptContentsVisibility } from "../../composables/useManuscriptContentsVisibility";
import { useReadingPreferences } from "../../readingPreferences";
import { normalizeRelaxedMarkdownHeadings } from "../../shared/manuscriptContent";
import type { Manuscript, ManuscriptChapter } from "../../shared/types";
import type { ManuscriptBookmark } from "../../shared/manuscriptBookmarks";
import { captureBookmark, resolveBookmark } from "../../shared/manuscriptBookmarkPosition";
import ReadingAppearanceControls from "./ReadingAppearanceControls.vue";

const props = defineProps<{
  modelValue: boolean;
  manuscript: Manuscript;
  initialChapterId?: string;
  initialProgress?: number;
  editable?: boolean;
  transformChapter?: (chapter: ManuscriptChapter) => Promise<ManuscriptChapter>;
}>();

type ReaderPosition = { chapterId: string; progress: number };

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  close: [position: ReaderPosition];
  edit: [position: ReaderPosition];
}>();

const chapter = ref<ManuscriptChapter | null>(null);
const loading = ref(false);
const error = ref("");
const appearanceOpen = ref(false);
const activeHeadingId = ref("");
const pane = ref<HTMLElement | null>(null);
const bodyElement = ref<HTMLElement | null>(null);
const outlineTab = ref<"contents" | "bookmarks">("contents");
const bookmarks = ref<ManuscriptBookmark[]>([]);
const bookmarkMessage = ref("");
const bookmarkBusy = ref(false);
const bookmarksLoading = ref(false);
const unavailableBookmark = ref<ManuscriptBookmark | null>(null);
const renamingBookmark = ref("");
const bookmarkName = ref("");
let readerSession = 0;
let chapterRequest = 0;
let bookmarkIntent = 0;
let correction: ResizeObserver | null = null;
let correctionTimer: ReturnType<typeof setTimeout> | null = null;

function cancelBookmarkCorrection() {
  bookmarkIntent++;
  correction?.disconnect(); correction = null;
  if (correctionTimer) clearTimeout(correctionTimer);
  correctionTimer = null;
}

function clearReader() {
  readerSession++; chapterRequest++;
  cancelBookmarkCorrection();
  if (restoreTimer) clearTimeout(restoreTimer);
  if (scrollAnimationFrame) cancelAnimationFrame(scrollAnimationFrame);
  chapter.value = null; bookmarks.value = []; loading.value = false;
  bookmarkBusy.value = false; bookmarksLoading.value = false;
  unavailableBookmark.value = null; bookmarkMessage.value = "";
  renamingBookmark.value = ""; bookmarkName.value = "";
}

function bookmarkLabel(bookmark: ManuscriptBookmark) {
  return props.manuscript.encryptionEnabled ? `Bookmark · ${new Date(bookmark.createdAt).toLocaleString()}`
    : bookmark.name || `Bookmark · ${new Date(bookmark.createdAt).toLocaleString()}`;
}

async function refreshBookmarks() {
  const session = readerSession;
  bookmarksLoading.value = true;
  try {
    const result = await client.manuscriptBookmarks(props.manuscript.manuscriptId);
    if (session === readerSession && props.modelValue) bookmarks.value = result;
  } catch (error) {
    if (session === readerSession) bookmarkMessage.value = error instanceof Error ? error.message : "Unable to load bookmarks.";
  } finally { if (session === readerSession) bookmarksLoading.value = false; }
}

async function addBookmark() {
  if (loading.value || bookmarksLoading.value || bookmarkBusy.value || !chapter.value || !bodyElement.value || !pane.value) return;
  const anchor = captureBookmark(bodyElement.value, pane.value, chapter.value.revision, chapter.value.contentFormat, props.manuscript.encryptionEnabled);
  if (!anchor) { bookmarkMessage.value = "Scroll to the text or image you want to bookmark."; return; }
  const session = readerSession;
  bookmarkBusy.value = true;
  try {
    const saved = await client.createManuscriptBookmark(props.manuscript.manuscriptId, {
      chapterId: chapter.value.chapterId, anchor,
      name: props.manuscript.encryptionEnabled ? "" : `${chapter.value.title} · ${anchor.exact.trim().slice(0, 50)}`.slice(0, 120)
    });
    if (session !== readerSession) return;
    if (!bookmarks.value.some((b) => b.bookmarkId === saved.bookmarkId)) bookmarks.value.push(saved);
    bookmarkMessage.value = "Bookmark saved.";
  } catch (error) {
    if (session === readerSession) bookmarkMessage.value = error instanceof Error ? error.message : "Unable to save bookmark.";
  } finally { if (session === readerSession) bookmarkBusy.value = false; }
}

async function changeBookmark(bookmark: ManuscriptBookmark, remove = false) {
  if (bookmarkBusy.value) return;
  const session = readerSession;
  bookmarkBusy.value = true;
  try {
    if (remove) {
      await client.deleteManuscriptBookmark(props.manuscript.manuscriptId, bookmark.bookmarkId);
      if (session === readerSession) bookmarks.value = bookmarks.value.filter((b) => b.bookmarkId !== bookmark.bookmarkId);
    } else {
      const saved = await client.renameManuscriptBookmark(props.manuscript.manuscriptId, bookmark.bookmarkId, bookmarkName.value);
      if (session === readerSession) bookmarks.value = bookmarks.value.map((b) => b.bookmarkId === saved.bookmarkId ? saved : b);
    }
    if (session === readerSession) { renamingBookmark.value = ""; bookmarkName.value = ""; bookmarkMessage.value = remove ? "Bookmark deleted." : "Bookmark renamed."; unavailableBookmark.value = null; }
  } catch (error) {
    if (session === readerSession) bookmarkMessage.value = error instanceof Error ? error.message : "Unable to update bookmark.";
  } finally { if (session === readerSession) bookmarkBusy.value = false; }
}

function applyBookmark(bookmark: ManuscriptBookmark) {
  if (!bodyElement.value || !pane.value || !chapter.value) return;
  const range = resolveBookmark(bodyElement.value, bookmark.anchor, chapter.value.revision, chapter.value.contentFormat, bookmark.positionOnly || props.manuscript.encryptionEnabled);
  if (!range) {
    unavailableBookmark.value = bookmark;
    bookmarkMessage.value = "The original position has changed or is ambiguous. You can open the chapter instead.";
    return;
  }
  unavailableBookmark.value = null; bookmarkMessage.value = "";
  const scroll = () => {
    if (!pane.value || !range.startContainer.isConnected) return;
    pane.value.scrollTop += range.getBoundingClientRect().top - pane.value.getBoundingClientRect().top - 36;
    onScroll();
  };
  scroll();
  correction = new ResizeObserver(scroll);
  correction.observe(bodyElement.value); correction.observe(pane.value);
  correctionTimer = setTimeout(cancelBookmarkCorrection, 2500);
}

function goToBookmark(bookmark: ManuscriptBookmark) {
  if (!props.manuscript.chapters.some((c) => c.chapterId === bookmark.chapterId)) {
    bookmarkMessage.value = "This chapter is no longer available."; unavailableBookmark.value = null; return;
  }
  if (window.matchMedia("(max-width: 760px)").matches) contentsOpen.value = false;
  void loadChapter(bookmark.chapterId, 0, bookmark);
}
const contentsHideButton = ref<HTMLButtonElement | null>(null);
const contentsRestoreButton = ref<HTMLButtonElement | null>(null);
const { contentsOpen } = useManuscriptContentsVisibility();
const { preferences, fontFamily } = useReadingPreferences();
let scrollAnimationFrame = 0;
let restoreTimer: ReturnType<typeof setTimeout> | null = null;

const chapterIndex = computed(() => props.manuscript.chapters.findIndex((item) => item.chapterId === chapter.value?.chapterId));
const singleMarkdownDocument = computed(() => props.manuscript.chapters.length === 1 && chapter.value?.contentFormat === "markdown");

const rendered = computed(() => {
  const source = chapter.value?.contentFormat === "markdown"
    ? normalizeRelaxedMarkdownHeadings(chapter.value?.body ?? "")
    : chapter.value?.body ?? "";
  const parsed = String(marked.parse(source, { async: false, breaks: true, gfm: true }));
  const documentNode = new DOMParser().parseFromString(`<main>${parsed}</main>`, "text/html");
  const main = documentNode.querySelector("main")!;
  const entries: Array<{ id: string; label: string; level: number }> = [];
  const used = new Set<string>();
  main.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((heading, index) => {
    const label = heading.textContent?.trim() || `Section ${index + 1}`;
    const base = label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || `section-${index + 1}`;
    let id = `manuscript-${base}`;
    let suffix = 2;
    while (used.has(id)) id = `manuscript-${base}-${suffix++}`;
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

const readerStyle = computed(() => ({
  "--book-surface": preferences.backgroundColor,
  "--book-ink": preferences.textColor,
  "--book-muted": "color-mix(in srgb, var(--book-ink) 68%, var(--book-surface))",
  "--book-border": "color-mix(in srgb, var(--book-ink) 18%, var(--book-surface))",
  "--appearance-surface": preferences.backgroundColor,
  "--appearance-ink": preferences.textColor,
  "--book-font-size": `${preferences.fontSize}px`,
  "--book-line-height": String(preferences.lineHeight),
  "--book-width": `${preferences.contentWidth}px`,
  "--book-font": fontFamily.value
}));

function clampProgress(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function currentProgress() {
  if (!pane.value) return 0;
  const maximum = Math.max(0, pane.value.scrollHeight - pane.value.clientHeight);
  return maximum > 4 ? clampProgress(pane.value.scrollTop / maximum) : 0;
}

function restoreProgress(progress: number) {
  if (!pane.value) return;
  const normalized = clampProgress(progress);
  const apply = () => {
    if (!pane.value) return;
    const maximum = Math.max(0, pane.value.scrollHeight - pane.value.clientHeight);
    pane.value.scrollTop = maximum * normalized;
    onScroll();
  };
  apply();
  if (restoreTimer) clearTimeout(restoreTimer);
  restoreTimer = setTimeout(apply, 120);
}

async function loadChapter(chapterId: string, progress = 0, bookmark?: ManuscriptBookmark) {
  if (!chapterId || !props.modelValue) return;
  const request = ++chapterRequest;
  cancelBookmarkCorrection();
  const intent = bookmarkIntent;
  if (restoreTimer) clearTimeout(restoreTimer);
  if (scrollAnimationFrame) cancelAnimationFrame(scrollAnimationFrame);
  unavailableBookmark.value = null;
  loading.value = true;
  error.value = "";
  let loaded = false;
  try {
    const fetchedChapter = await client.manuscriptChapter(props.manuscript.manuscriptId, chapterId);
    if (request !== chapterRequest || !props.modelValue) return;
    const transformed = props.transformChapter ? await props.transformChapter(fetchedChapter) : fetchedChapter;
    if (request !== chapterRequest || !props.modelValue) return;
    chapter.value = transformed;
    activeHeadingId.value = "";
    loaded = true;
  } catch (loadError) {
    if (request === chapterRequest) error.value = loadError instanceof Error ? loadError.message : "Unable to load chapter";
  } finally {
    if (request === chapterRequest) loading.value = false;
  }
  if (loaded) {
    await nextTick();
    requestAnimationFrame(() => {
      if (request !== chapterRequest || !props.modelValue) return;
      if (bookmark) { if (intent === bookmarkIntent) applyBookmark(bookmark); } else restoreProgress(progress);
    });
  }
}

function readerPosition(): ReaderPosition | null {
  return chapter.value ? { chapterId: chapter.value.chapterId, progress: currentProgress() } : null;
}
function close() {
  const position = readerPosition();
  if (position) emit("close", position);
  emit("update:modelValue", false);
}
function edit() {
  const position = readerPosition();
  if (position) emit("edit", position);
}
async function hideContents() {
  contentsOpen.value = false;
  await nextTick();
  contentsRestoreButton.value?.focus();
}
async function showContents() {
  contentsOpen.value = true;
  await nextTick();
  contentsHideButton.value?.focus();
}
function selectRelativeChapter(offset: -1 | 1) {
  const target = props.manuscript.chapters[chapterIndex.value + offset];
  if (target) void loadChapter(target.chapterId);
}
function selectHeading(id: string) {
  cancelBookmarkCorrection();
  activeHeadingId.value = id;
  const heading = document.getElementById(id);
  if (!heading || !pane.value) return;
  if (scrollAnimationFrame) cancelAnimationFrame(scrollAnimationFrame);
  const paneRect = pane.value.getBoundingClientRect();
  const headingRect = heading.getBoundingClientRect();
  const start = pane.value.scrollTop;
  const maximum = Math.max(0, pane.value.scrollHeight - pane.value.clientHeight);
  const target = Math.min(maximum, Math.max(0, start + headingRect.top - paneRect.top - 36));
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || Math.abs(target - start) < 8) {
    pane.value.scrollTop = target;
    return;
  }
  const startedAt = performance.now();
  const duration = 145;
  const step = (now: number) => {
    if (!pane.value) return;
    const elapsed = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - Math.pow(1 - elapsed, 3);
    pane.value.scrollTop = start + (target - start) * eased;
    if (elapsed < 1) scrollAnimationFrame = requestAnimationFrame(step);
  };
  scrollAnimationFrame = requestAnimationFrame(step);
}
function onScroll() {
  if (!pane.value) return;
  const top = pane.value.getBoundingClientRect().top;
  let active = rendered.value.entries[0];
  for (const entry of rendered.value.entries) {
    const heading = document.getElementById(entry.id);
    if (heading && heading.getBoundingClientRect().top - top <= 95) active = entry;
    else break;
  }
  if (active) activeHeadingId.value = active.id;
}
function openLink(event: MouseEvent) {
  if (!(event.target instanceof Element)) return;
  const link = event.target.closest("a");
  if (!link?.href) return;
  event.preventDefault();
  window.open(link.href, "_blank", "noopener,noreferrer");
}
function onKeydown(event: KeyboardEvent) {
  if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) cancelBookmarkCorrection();
  if (event.key === "Escape" && props.modelValue) close();
}

watch(
  () => props.modelValue,
  async (open) => {
    clearReader();
    if (!open) return;
    void refreshBookmarks();
    const target = props.manuscript.chapters.find((item) => item.chapterId === props.initialChapterId)
      ?? props.manuscript.chapters[0];
    if (target) await loadChapter(target.chapterId, props.initialProgress ?? 0);
  }, { immediate: true }
);

watch(() => props.manuscript.manuscriptId, () => {
  clearReader();
  if (!props.modelValue) return;
  void refreshBookmarks();
  const first = props.manuscript.chapters[0];
  if (first) void loadChapter(first.chapterId);
});

onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => {
  clearReader();
  window.removeEventListener("keydown", onKeydown);
  if (scrollAnimationFrame) cancelAnimationFrame(scrollAnimationFrame);
  if (restoreTimer) clearTimeout(restoreTimer);
});
</script>

<template>
  <div v-if="modelValue" class="book-reader" :style="readerStyle">
    <header class="book-toolbar">
      <button class="book-button" type="button" title="Close reader" @click="close"><X /></button>
      <div class="book-toolbar-title">
        <strong>{{ manuscript.title }}</strong>
        <span>{{ singleMarkdownDocument ? "Markdown document" : chapter?.title || "Loading chapter…" }}</span>
      </div>
      <div class="book-size-control">
        <button type="button" :disabled="preferences.fontSize <= 14" @click="preferences.fontSize--"><Minus /></button>
        <span>{{ preferences.fontSize }}</span>
        <button type="button" :disabled="preferences.fontSize >= 30" @click="preferences.fontSize++"><Plus /></button>
      </div>
      <button v-if="editable" class="book-button book-button--label" type="button" @click="edit"><Edit3 /><span>Edit</span></button>
      <button class="book-button book-button--label" type="button" title="Bookmark this position" aria-label="Bookmark this position" :disabled="loading || bookmarksLoading || bookmarkBusy || !chapter" @click="addBookmark"><PlusCircle /><span>Bookmark</span></button>
      <button class="book-button" type="button" title="Show bookmarks" aria-label="Show bookmarks" @click="outlineTab = 'bookmarks'; contentsOpen = true"><Bookmark /></button>
      <button class="book-button book-button--label" :class="{ active: appearanceOpen }" type="button" @click="appearanceOpen = !appearanceOpen"><Palette /><span>Appearance</span></button>
    </header>
    <ReadingAppearanceControls v-if="appearanceOpen" compact />
    <div v-if="bookmarkMessage" class="book-bookmark-message" role="status">
      {{ bookmarkMessage }}
      <button v-if="unavailableBookmark" class="book-button" type="button" @click="loadChapter(unavailableBookmark.chapterId); bookmarkMessage = ''">Open chapter</button>
      <button type="button" aria-label="Dismiss bookmark message" @click="bookmarkMessage = ''; unavailableBookmark = null"><X /></button>
    </div>

    <div class="book-layout" :class="{ 'book-layout--outline': contentsOpen }">
      <aside v-if="contentsOpen" class="book-outline">
        <div class="book-outline-heading">
          <button type="button" :class="{ 'is-selected': outlineTab === 'contents' }" @click="outlineTab = 'contents'"><ListTree /> Contents</button>
          <button type="button" :class="{ 'is-selected': outlineTab === 'bookmarks' }" @click="outlineTab = 'bookmarks'"><Bookmark /> Bookmarks</button>
          <button
            ref="contentsHideButton"
            type="button"
            title="Hide contents"
            aria-label="Hide contents"
            :aria-expanded="true"
            @click="hideContents"
          ><PanelLeftClose /></button>
        </div>
        <div v-if="outlineTab === 'bookmarks'" class="book-bookmarks">
          <p v-if="bookmarksLoading">Loading bookmarks…</p>
          <p v-else-if="!bookmarks.length">No bookmarks yet. Use Bookmark in the reading toolbar to save your position.</p>
          <p v-if="manuscript.encryptionEnabled" class="book-outline-empty">Encrypted works save positions only. Edited chapters may need a new bookmark.</p>
          <div v-for="bookmark in bookmarks" :key="bookmark.bookmarkId" class="book-bookmark-row">
            <form v-if="renamingBookmark === bookmark.bookmarkId" @submit.prevent="changeBookmark(bookmark)">
              <input v-model="bookmarkName" maxlength="120" aria-label="Bookmark name" />
              <button type="submit" :disabled="bookmarkBusy">Save</button>
              <button type="button" @click="renamingBookmark = ''; bookmarkName = ''">Cancel</button>
            </form>
            <template v-else>
              <button class="book-bookmark-open" type="button" @click="goToBookmark(bookmark)">{{ bookmarkLabel(bookmark) }}</button>
              <div class="book-bookmark-actions">
                <button v-if="!manuscript.encryptionEnabled" type="button" title="Rename bookmark" aria-label="Rename bookmark" :disabled="bookmarkBusy" @click="renamingBookmark = bookmark.bookmarkId; bookmarkName = bookmark.name"><Pencil /></button>
                <button type="button" title="Delete bookmark" aria-label="Delete bookmark" :disabled="bookmarkBusy" @click="changeBookmark(bookmark, true)"><Trash2 /></button>
              </div>
            </template>
          </div>
        </div>
        <div v-else class="book-chapter-list">
          <div v-if="singleMarkdownDocument" class="book-section-list book-section-list--document">
            <button
              v-for="entry in rendered.entries"
              :key="entry.id"
              :class="{ active: activeHeadingId === entry.id }"
              :style="{ paddingLeft: `${Math.min(entry.level - 1, 4) * 12 + 12}px` }"
              type="button"
              @click="selectHeading(entry.id)"
            >{{ entry.label }}</button>
            <p v-if="!rendered.entries.length" class="book-outline-empty">Add # headings to build the contents.</p>
          </div>
          <template v-else v-for="(item, index) in manuscript.chapters" :key="item.chapterId">
            <button class="book-chapter-link" :class="{ active: item.chapterId === chapter?.chapterId }" type="button" @click="loadChapter(item.chapterId)">
              <small>{{ String(index + 1).padStart(2, "0") }}</small><span>{{ item.title }}</span>
            </button>
            <div v-if="item.chapterId === chapter?.chapterId && rendered.entries.length" class="book-section-list">
              <button
                v-for="entry in rendered.entries"
                :key="entry.id"
                :class="{ active: activeHeadingId === entry.id }"
                :style="{ paddingLeft: `${Math.min(entry.level - 1, 3) * 10 + 30}px` }"
                type="button"
                @click="selectHeading(entry.id)"
              >{{ entry.label }}</button>
            </div>
          </template>
        </div>
      </aside>

      <button
        v-else
        ref="contentsRestoreButton"
        class="book-contents-tab"
        type="button"
        title="Show contents"
        aria-label="Show contents"
        :aria-expanded="false"
        @click="showContents"
      ><PanelLeftOpen /><span>Contents</span></button>

      <main ref="pane" class="book-page" @scroll.passive="onScroll" @wheel.passive="cancelBookmarkCorrection" @touchstart.passive="cancelBookmarkCorrection" @pointerdown="cancelBookmarkCorrection">
        <div v-if="loading" class="book-loading"><LoaderCircle class="animate-spin" /> Loading chapter…</div>
        <div v-else-if="error" class="book-loading">{{ error }}</div>
        <article v-else class="book-article" @click="openLink">
          <p v-if="!singleMarkdownDocument" class="book-kicker">Chapter {{ chapterIndex + 1 }} of {{ manuscript.chapters.length }}</p>
          <h1 v-if="!singleMarkdownDocument">{{ chapter?.title }}</h1>
          <div v-if="rendered.html" ref="bodyElement" v-html="rendered.html"></div>
          <p v-else class="book-empty">This chapter is empty.</p>
          <footer v-if="manuscript.chapters.length > 1" class="book-pagination">
            <button type="button" :disabled="chapterIndex <= 0" @click="selectRelativeChapter(-1)"><ChevronLeft /> Previous chapter</button>
            <span>{{ chapterIndex + 1 }} / {{ manuscript.chapters.length }}</span>
            <button type="button" :disabled="chapterIndex >= manuscript.chapters.length - 1" @click="selectRelativeChapter(1)">Next chapter <ChevronRight /></button>
          </footer>
        </article>
      </main>
    </div>
  </div>
</template>

<style scoped>
.book-bookmark-message { display: flex; gap: .7rem; align-items: center; padding: .55rem 1rem; border-bottom: 1px solid var(--book-border); font-size: .8rem; }
.book-bookmark-message > button:last-child { margin-left: auto; }
.book-bookmark-message svg { width: 1rem; height: 1rem; }
.book-bookmarks { padding: .5rem; font-size: .8rem; }
.book-bookmarks > p { padding: .5rem 0; line-height: 1.6; color: var(--book-muted); }
.book-bookmark-row { padding: .55rem 0; border-bottom: 1px solid var(--book-border); }
.book-bookmark-open { width: 100%; text-align: left; overflow-wrap: anywhere; line-height: 1.5; padding: .35rem; }
.book-bookmark-open:hover { text-decoration: underline; }
.book-bookmark-actions { display: flex; justify-content: flex-end; gap: .5rem; }
.book-bookmark-actions button { display: grid; place-items: center; min-width: 2.25rem; min-height: 2.25rem; }
.book-bookmark-row input { width: 100%; background: var(--book-surface); color: var(--book-ink); border: 1px solid var(--book-border); padding: .5rem; }
.book-bookmark-row form button { padding: .6rem; }
.book-bookmark-row svg { width: 1rem; height: 1rem; }
.book-button:disabled { opacity: .45; cursor: default; }
.book-outline-heading > button:not([aria-expanded]) { display: inline-flex; width: auto; height: auto; min-height: 2rem; margin: 0; gap: .3rem; padding: .3rem; }
.book-outline-heading > button.is-selected { color: var(--book-ink); text-decoration: underline; text-underline-offset: .3rem; }
.book-reader { position: fixed; inset: 0; z-index: 90; display: flex; flex-direction: column; background: var(--book-surface); color: var(--book-ink); }
.book-toolbar { display: flex; min-height: 3.25rem; align-items: center; gap: .45rem; border-bottom: 1px solid var(--book-border); padding: .38rem .55rem; background: color-mix(in srgb, var(--book-surface) 94%, transparent); backdrop-filter: blur(14px); }
.book-toolbar svg, .book-outline svg { width: .95rem; height: .95rem; }
.book-button { display: inline-grid; min-width: 2.25rem; height: 2.25rem; place-items: center; border: 1px solid var(--book-border); border-radius: .45rem; padding: 0 .55rem; font-size: .72rem; font-weight: 750; }
.book-button--label { display: inline-flex; align-items: center; gap: .38rem; }
.book-button:hover, .book-button.active { background: color-mix(in srgb, var(--book-ink) 7%, transparent); }
.book-toolbar-title { min-width: 0; flex: 1; }
.book-toolbar-title strong, .book-toolbar-title span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.book-toolbar-title strong { font-size: .78rem; }.book-toolbar-title span { margin-top: .04rem; color: var(--book-muted); font-size: .62rem; }
.book-size-control { display: flex; height: 2.25rem; align-items: center; border: 1px solid var(--book-border); border-radius: .45rem; }
.book-size-control button { display: grid; width: 2rem; height: 100%; place-items: center; }.book-size-control button:disabled { opacity: .35; }
.book-size-control span { width: 2rem; text-align: center; font-size: .68rem; font-weight: 750; }.book-size-control svg { width: .85rem; height: .85rem; }
.book-layout { position: relative; display: grid; min-height: 0; flex: 1; grid-template-columns: 1fr; transition: grid-template-columns 180ms ease; }
.book-layout--outline { grid-template-columns: 260px minmax(0, 1fr); }
.book-outline { min-height: 0; overflow-y: auto; border-right: 1px solid var(--book-border); padding: .7rem .45rem; }
.book-outline-heading { display: flex; align-items: center; gap: .45rem; padding: .25rem .55rem .65rem; font-size: .72rem; font-weight: 800; }
.book-outline-heading button { display: grid; width: 1.75rem; height: 1.75rem; margin: -.2rem -.2rem -.2rem auto; place-items: center; border-radius: .35rem; color: var(--book-muted); }
.book-outline-heading button:hover, .book-outline-heading button:focus-visible { background: color-mix(in srgb, var(--book-ink) 7%, transparent); color: var(--book-ink); outline: none; }
.book-contents-tab { position: absolute; z-index: 4; top: .7rem; left: 0; display: flex; width: 1.95rem; height: 6.2rem; flex-direction: column; align-items: center; justify-content: center; gap: .42rem; border: 1px solid var(--book-border); border-left: 0; border-radius: 0 .42rem .42rem 0; background: color-mix(in srgb, var(--book-surface) 93%, var(--book-ink)); color: var(--book-muted); box-shadow: 2px 4px 14px color-mix(in srgb, var(--book-ink) 9%, transparent); transition: width 130ms ease, color 130ms ease, background-color 130ms ease; }
.book-contents-tab:hover, .book-contents-tab:focus-visible { width: 2.2rem; background: color-mix(in srgb, var(--book-ink) 7%, var(--book-surface)); color: var(--book-ink); outline: none; }
.book-contents-tab svg { width: .85rem; height: .85rem; }
.book-contents-tab span { writing-mode: vertical-rl; font-size: .58rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
.book-chapter-link { display: flex; width: 100%; align-items: center; gap: .5rem; border-radius: .42rem; padding: .52rem .55rem; color: var(--book-muted); font-size: .72rem; text-align: left; }
.book-chapter-link small { width: 1.2rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .55rem; }.book-chapter-link span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.book-chapter-link:hover { background: color-mix(in srgb, var(--book-ink) 5%, transparent); color: var(--book-ink); }.book-chapter-link.active { background: color-mix(in srgb, #2f7875 15%, transparent); color: var(--book-ink); font-weight: 750; }
.book-section-list { margin: .08rem 0 .3rem; }.book-section-list button { display: block; width: 100%; overflow: hidden; padding-top: .34rem; padding-bottom: .34rem; color: var(--book-muted); font-size: .62rem; text-align: left; text-overflow: ellipsis; white-space: nowrap; }.book-section-list button:hover, .book-section-list button.active { color: var(--book-ink); }
.book-section-list--document { margin-top: 0; }.book-section-list--document button { font-size: .69rem; }.book-outline-empty { padding: .45rem .65rem; color: var(--book-muted); font-size: .64rem; line-height: 1.45; }
.book-page { min-height: 0; overflow-y: auto; }
.book-article { max-width: var(--book-width); min-height: 100%; margin: 0 auto; padding: clamp(2.2rem, 6vw, 5rem) clamp(1.25rem, 4vw, 3.25rem) 5rem; font-family: var(--book-font); font-size: var(--book-font-size); line-height: var(--book-line-height); }
.book-kicker { margin: 0 0 .55rem; color: var(--book-muted); font-family: ui-sans-serif, system-ui, sans-serif; font-size: .62em; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
.book-article > h1 { margin: 0 0 1.6em; font-size: 2em; font-weight: 780; line-height: 1.18; }
.book-article :deep(h1), .book-article :deep(h2), .book-article :deep(h3), .book-article :deep(h4), .book-article :deep(h5), .book-article :deep(h6) { scroll-margin-top: 4rem; font-weight: 750; line-height: 1.25; }
.book-article :deep(h1) { margin: 2.3em 0 .8em; font-size: 1.7em; }.book-article :deep(h2) { margin: 2.1em 0 .75em; font-size: 1.45em; }.book-article :deep(h3) { margin: 1.8em 0 .65em; font-size: 1.2em; }
.book-article :deep(p) { margin: 0 0 1.12em; }.book-article :deep(ul), .book-article :deep(ol) { margin: 0 0 1.2em; padding-left: 1.55em; }.book-article :deep(ul) { list-style: disc; }.book-article :deep(ol) { list-style: decimal; }
.book-article :deep(blockquote) { margin: 1.5em 0; border-left: 3px solid var(--book-border); padding-left: 1em; color: var(--book-muted); }.book-article :deep(a) { color: inherit; font-weight: 700; text-decoration: underline; text-underline-offset: 3px; }
.book-article :deep(figure) { margin: 1.6em 0; text-align: center; }.book-article :deep(img) { display: block; max-width: 100%; height: auto; margin: 1.4em auto; border-radius: .4rem; }.book-article :deep(figcaption) { color: var(--book-muted); font-size: .7em; }
.book-article :deep(pre) { overflow-x: auto; border-radius: .4rem; background: #171a18; padding: 1em; color: #f1f0e9; font-size: .82em; }.book-article :deep(code) { border-radius: .2rem; background: color-mix(in srgb, var(--book-ink) 8%, transparent); padding: .08em .25em; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .86em; }
.book-empty, .book-loading { color: var(--book-muted); }.book-loading { display: flex; min-height: 20rem; align-items: center; justify-content: center; gap: .5rem; font-size: .76rem; }.book-loading svg { width: 1rem; height: 1rem; }
.book-pagination { display: flex; align-items: center; justify-content: space-between; gap: .8rem; margin-top: 5rem; border-top: 1px solid var(--book-border); padding-top: 1rem; font-family: ui-sans-serif, system-ui, sans-serif; font-size: .62em; }
.book-pagination button { display: inline-flex; align-items: center; gap: .35rem; font-weight: 750; }.book-pagination button:disabled { opacity: .3; }.book-pagination svg { width: .9rem; height: .9rem; }
@media (max-width: 760px) { .book-layout--outline { grid-template-columns: 1fr; }.book-outline { position: absolute; z-index: 3; top: 3.25rem; bottom: 0; left: 0; width: min(86vw, 320px); background: var(--book-surface); box-shadow: 20px 0 50px rgba(0,0,0,.15); }.book-button--label span { display: none; }.book-size-control { display: none; } }
</style>
