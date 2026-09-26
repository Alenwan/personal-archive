import DOMPurify from "dompurify";
import { marked } from "marked";

export interface ManuscriptOutlineEntry {
  key: string;
  label: string;
  level: number;
  headingIndex: number;
  sourceStart?: number;
  sourceEnd?: number;
}

const RICH_TEXT_TAGS = [
  "a", "b", "blockquote", "br", "code", "del", "div", "em", "figcaption", "figure", "h1", "h2", "h3", "h4",
  "h5", "h6", "hr", "i", "img", "li", "ol", "p", "pre", "s", "span", "strike", "strong", "table", "tbody",
  "td", "th", "thead", "tr", "u", "ul"
];

function cleanHeadingLabel(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]+/g, "")
    .replace(/\s+#+\s*$/, "")
    .trim();
}

export function markdownOutline(source: string): ManuscriptOutlineEntry[] {
  const entries: ManuscriptOutlineEntry[] = [];
  let offset = 0;
  let fenced = false;
  for (const [lineIndex, line] of source.split("\n").entries()) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      offset += line.length + 1;
      continue;
    }
    if (!fenced) {
      const match = line.match(/^\s{0,3}(#{1,6})(?!#)(?:[\t ]+|(?=[^\s#]))(.+?)\s*$/);
      if (match) {
        const label = cleanHeadingLabel(match[2]);
        if (label) {
          entries.push({
            key: `markdown-heading-${lineIndex}`,
            label,
            level: match[1].length,
            headingIndex: entries.length,
            sourceStart: offset,
            sourceEnd: offset + line.length
          });
        }
      }
    }
    offset += line.length + 1;
  }
  return entries;
}

/**
 * CommonMark requires a space after an ATX heading marker. Personal writing often
 * uses compact CJK headings such as `##第一章`, so normalize those lines only for
 * rendering while preserving the source exactly as the author entered it.
 */
export function normalizeRelaxedMarkdownHeadings(source: string) {
  let fenced = false;
  return source.split("\n").map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return line;
    }
    if (fenced) return line;
    const compactHeading = line.match(/^(\s{0,3})(#{1,6})(?!#)([^\s#].*)$/);
    return compactHeading
      ? `${compactHeading[1]}${compactHeading[2]} ${compactHeading[3]}`
      : line;
  }).join("\n");
}

export function richTextOutline(source: string): ManuscriptOutlineEntry[] {
  if (!source.trim() || typeof DOMParser === "undefined") return [];
  const documentNode = new DOMParser().parseFromString(`<main>${source}</main>`, "text/html");
  return Array.from(documentNode.querySelectorAll("main h1, main h2, main h3, main h4, main h5, main h6"))
    .map((heading, headingIndex) => ({
      key: `rich-heading-${headingIndex}`,
      label: heading.textContent?.trim() || `Section ${headingIndex + 1}`,
      level: Number(heading.tagName.slice(1)),
      headingIndex
    }));
}

function markdownForNode(node: Node, listDepth = 0): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return "";
  const children = () => Array.from(node.childNodes).map((child) => markdownForNode(child, listDepth)).join("");
  const tag = node.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag.slice(1)))} ${children().trim()}\n\n`;
  if (tag === "p" || tag === "div" || tag === "figcaption") return `${children().trim()}\n\n`;
  if (tag === "br") return "\n";
  if (tag === "strong" || tag === "b") return `**${children()}**`;
  if (tag === "em" || tag === "i") return `*${children()}*`;
  if (tag === "del" || tag === "s" || tag === "strike") return `~~${children()}~~`;
  if (tag === "u") return `<u>${children()}</u>`;
  if (tag === "code" && node.parentElement?.tagName.toLowerCase() !== "pre") return `\`${children()}\``;
  if (tag === "pre") return `\n\`\`\`\n${node.textContent ?? ""}\n\`\`\`\n\n`;
  if (tag === "blockquote") {
    return `${children().trim().split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
  }
  if (tag === "a") {
    const label = children().trim() || node.getAttribute("href") || "Link";
    return `[${label}](${node.getAttribute("href") ?? ""})`;
  }
  if (tag === "img") return `![${node.getAttribute("alt") ?? "Image"}](${node.getAttribute("src") ?? ""})`;
  if (tag === "hr") return "\n---\n\n";
  if (tag === "ul" || tag === "ol") {
    const ordered = tag === "ol";
    return `${Array.from(node.children).filter((child) => child.tagName.toLowerCase() === "li").map((item, index) => {
      const prefix = ordered ? `${index + 1}. ` : "- ";
      const body = Array.from(item.childNodes).map((child) => markdownForNode(child, listDepth + 1)).join("").trim();
      return `${"  ".repeat(listDepth)}${prefix}${body}`;
    }).join("\n")}\n\n`;
  }
  if (tag === "li") return children();
  return children();
}

export function richTextToMarkdown(source: string) {
  if (!source.trim() || typeof DOMParser === "undefined") return source;
  const documentNode = new DOMParser().parseFromString(`<main>${source}</main>`, "text/html");
  const main = documentNode.querySelector("main");
  if (!main) return source;
  return Array.from(main.childNodes)
    .map((node) => markdownForNode(node))
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function markdownToRichText(source: string) {
  if (!source.trim()) return "";
  return DOMPurify.sanitize(String(marked.parse(normalizeRelaxedMarkdownHeadings(source), { async: false, breaks: true, gfm: true })), {
    ALLOWED_TAGS: RICH_TEXT_TAGS,
    ALLOWED_ATTR: ["alt", "height", "href", "src", "style", "title", "width"],
    ALLOW_DATA_ATTR: false
  });
}
