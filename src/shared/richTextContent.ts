export const RICH_TEXT_TAGS = [
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
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "span",
  "strike",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul"
] as const;

const RICH_TEXT_TAG_SET = new Set<string>(RICH_TEXT_TAGS);

export function isRichTextHtml(value: string) {
  const firstTag = value.replace(/^\uFEFF/, "").trimStart().match(/^<([a-z][\w-]*)\b[^>]*>/i);
  return Boolean(firstTag && RICH_TEXT_TAG_SET.has(firstTag[1].toLowerCase()));
}
