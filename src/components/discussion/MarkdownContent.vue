<script setup lang="ts">
import DOMPurify from "dompurify";
import { marked } from "marked";
import { computed } from "vue";
import { useReadingPreferences } from "../../readingPreferences";

const props = defineProps<{
  source: string;
  collapsed?: boolean;
  compact?: boolean;
}>();

const { preferences, fontFamily } = useReadingPreferences();
const readingStyle = computed(() => props.compact ? undefined : ({
  "--discussion-surface": preferences.backgroundColor,
  "--discussion-ink": preferences.textColor,
  "--discussion-muted": `color-mix(in srgb, ${preferences.textColor} 68%, ${preferences.backgroundColor})`,
  "--discussion-border": `color-mix(in srgb, ${preferences.textColor} 18%, ${preferences.backgroundColor})`,
  "--discussion-link": `color-mix(in srgb, ${preferences.textColor} 76%, #168c83)`,
  backgroundColor: preferences.backgroundColor,
  color: preferences.textColor,
  fontFamily: fontFamily.value,
  fontSize: `${preferences.fontSize}px`,
  lineHeight: preferences.lineHeight,
  maxWidth: `${preferences.contentWidth}px`,
  marginInline: "auto"
}));

const allowedTags = [
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "div",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "strong",
  "strike",
  "span",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul"
];

const renderedHtml = computed(() => {
  const parsed = marked.parse(props.source, {
    async: false,
    breaks: true,
    gfm: true
  });

  return DOMPurify.sanitize(parsed, {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: ["alt", "height", "href", "src", "style", "title", "width"],
    ALLOW_DATA_ATTR: false
  });
});

function openLink(event: MouseEvent) {
  if (!(event.target instanceof Element)) return;
  const link = event.target.closest("a");
  if (!link?.href) return;
  event.preventDefault();
  window.open(link.href, "_blank", "noopener,noreferrer");
}
</script>

<template>
  <div
    class="discussion-markdown"
    :class="{
      'discussion-markdown--collapsed': collapsed,
      'discussion-markdown--compact': compact
    }"
    :style="readingStyle"
    @click="openLink"
    v-html="renderedHtml"
  ></div>
</template>

<style scoped>
.discussion-markdown {
  min-width: 0;
  overflow-wrap: anywhere;
  border-radius: 6px;
  background: var(--discussion-surface, transparent);
  padding: 0.9rem 1rem;
  color: var(--discussion-ink, inherit);
  transition: background-color 160ms ease, color 160ms ease;
}

.discussion-markdown--collapsed {
  max-height: 10.5rem;
  overflow: hidden;
  border-bottom: 1px dashed #deded7;
  padding-bottom: 0.25rem;
}

.discussion-markdown--compact {
  max-height: 4.75rem;
  overflow: hidden;
  background: transparent;
  padding: 0;
  color: inherit;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
}

.discussion-markdown--compact :deep(p),
.discussion-markdown--compact :deep(ul),
.discussion-markdown--compact :deep(ol),
.discussion-markdown--compact :deep(blockquote),
.discussion-markdown--compact :deep(pre),
.discussion-markdown--compact :deep(table),
.discussion-markdown--compact :deep(hr) {
  margin: 0.3rem 0;
}

.discussion-markdown--compact :deep(h1),
.discussion-markdown--compact :deep(h2),
.discussion-markdown--compact :deep(h3),
.discussion-markdown--compact :deep(h4),
.discussion-markdown--compact :deep(h5),
.discussion-markdown--compact :deep(h6) {
  margin: 0 0 0.25rem;
  font-size: 0.95rem;
  line-height: 1.35;
}

.discussion-markdown :deep(> :first-child) {
  margin-top: 0;
}

.discussion-markdown :deep(> :last-child) {
  margin-bottom: 0;
}

.discussion-markdown :deep(p),
.discussion-markdown :deep(ul),
.discussion-markdown :deep(ol),
.discussion-markdown :deep(blockquote),
.discussion-markdown :deep(pre),
.discussion-markdown :deep(table),
.discussion-markdown :deep(hr) {
  margin: 0.55rem 0;
}

.discussion-markdown :deep(figure) {
  margin: 1rem auto;
  text-align: center;
}

.discussion-markdown :deep(img) {
  display: block;
  max-width: min(100%, 64rem);
  max-height: 46rem;
  margin: 0 auto;
  border-radius: 0.65rem;
  object-fit: contain;
  box-shadow: 0 7px 22px rgba(35, 47, 42, 0.12);
}

.discussion-markdown :deep(figcaption) {
  margin-top: 0.35rem;
  color: var(--discussion-muted, #74746b);
  font-size: 0.75rem;
  line-height: 1.45;
  text-align: center;
}

.discussion-markdown :deep(h1),
.discussion-markdown :deep(h2),
.discussion-markdown :deep(h3),
.discussion-markdown :deep(h4),
.discussion-markdown :deep(h5),
.discussion-markdown :deep(h6) {
  margin: 0.75rem 0 0.35rem;
  color: var(--discussion-ink, #20201d);
  font-weight: 700;
  line-height: 1.35;
}

.discussion-markdown :deep(h1) {
  font-size: 1.125rem;
}

.discussion-markdown :deep(h2) {
  font-size: 1rem;
}

.discussion-markdown :deep(h3),
.discussion-markdown :deep(h4),
.discussion-markdown :deep(h5),
.discussion-markdown :deep(h6) {
  font-size: 0.925rem;
}

.discussion-markdown :deep(ul),
.discussion-markdown :deep(ol) {
  padding-left: 1.4rem;
}

.discussion-markdown :deep(ul) {
  list-style: disc;
}

.discussion-markdown :deep(ol) {
  list-style: decimal;
}

.discussion-markdown :deep(li + li) {
  margin-top: 0.2rem;
}

.discussion-markdown :deep(blockquote) {
  border-left: 3px solid var(--discussion-border, #9ec7c5);
  padding: 0.15rem 0 0.15rem 0.75rem;
  color: var(--discussion-muted, #606059);
}

.discussion-markdown :deep(a) {
  color: var(--discussion-link, #215c5b);
  font-weight: 600;
  text-decoration: underline;
  text-decoration-color: var(--discussion-border, #9ec7c5);
  text-underline-offset: 2px;
}

.discussion-markdown :deep(a:hover) {
  filter: brightness(0.82);
}

.discussion-markdown :deep(code) {
  border-radius: 4px;
  background: color-mix(in srgb, var(--discussion-ink, #30302b) 9%, var(--discussion-surface, #f0f0ec));
  padding: 0.12rem 0.3rem;
  color: var(--discussion-ink, #30302b);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.875em;
}

.discussion-markdown :deep(pre) {
  max-width: 100%;
  overflow-x: auto;
  border: 1px solid var(--discussion-border, #deded7);
  border-radius: 6px;
  background: #272724;
  padding: 0.75rem;
  color: #f7f7f4;
}

.discussion-markdown :deep(pre code) {
  display: block;
  min-width: max-content;
  background: transparent;
  padding: 0;
  color: inherit;
  font-size: 0.78rem;
  line-height: 1.55;
}

.discussion-markdown :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
}

.discussion-markdown :deep(th),
.discussion-markdown :deep(td) {
  border: 1px solid var(--discussion-border, #deded7);
  padding: 0.4rem 0.55rem;
  text-align: left;
  white-space: nowrap;
}

.discussion-markdown :deep(th) {
  background: color-mix(in srgb, var(--discussion-ink, #30302b) 7%, var(--discussion-surface, #f3f3ef));
  color: var(--discussion-ink, #30302b);
  font-weight: 700;
}

.discussion-markdown :deep(hr) {
  border: 0;
  border-top: 1px solid var(--discussion-border, #deded7);
}
</style>
