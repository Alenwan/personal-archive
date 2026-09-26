import type { BookmarkAnchor } from "./manuscriptBookmarks";

type Part = { node: Text | HTMLBRElement; start: number; text: string };
export type ReadingBlock = { kind: "text" | "image"; text: string; parts: Part[]; image?: HTMLImageElement };
const boundaries = new Set(["P", "DIV", "BLOCKQUOTE", "LI", "UL", "OL", "PRE", "TABLE", "TR", "TD", "TH", "FIGURE", "FIGCAPTION", "H1", "H2", "H3", "H4", "H5", "H6"]);

// Build an index from the sanitized, rendered body, never from source character counts.
export function readingBlocks(root: HTMLElement): ReadingBlock[] {
  const blocks: ReadingBlock[] = [];
  let parts: Part[] = [], text = "";
  const flush = () => {
    if (text.trim()) blocks.push({ kind: "text", text, parts });
    parts = []; text = "";
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = (node.textContent ?? "").replace(/\u00a0/g, " ");
      parts.push({ node: node as Text, start: text.length, text: value }); text += value;
    } else if (node instanceof HTMLElement) {
      if (node.tagName === "IMG") { flush(); blocks.push({ kind: "image", text: "", parts: [], image: node as HTMLImageElement }); return; }
      if (node.tagName === "BR") { parts.push({ node: node as HTMLBRElement, start: text.length, text: "\n" }); text += "\n"; return; }
      const boundary = boundaries.has(node.tagName);
      if (boundary) flush();
      node.childNodes.forEach(walk);
      if (boundary) flush();
    }
  };
  root.childNodes.forEach(walk); flush(); return blocks;
}

function safeOffset(text: string, offset: number) {
  const value = Math.min(Math.max(0, offset), Math.max(0, text.length - 1));
  const code = text.charCodeAt(value);
  return value > 0 && code >= 0xdc00 && code <= 0xdfff ? value - 1 : value;
}

export function anchorRange(block: ReadingBlock, offset: number): Range | null {
  const range = document.createRange();
  if (block.image) { range.selectNode(block.image); return range; }
  const safe = safeOffset(block.text, offset);
  const part = block.parts.find((p) => safe >= p.start && safe < p.start + p.text.length);
  if (!part) return null;
  if (part.node.nodeType === Node.TEXT_NODE) {
    const start = safeOffset(part.text, safe - part.start);
    const length = (part.text.codePointAt(start) ?? 0) > 0xffff ? 2 : 1;
    range.setStart(part.node, start); range.setEnd(part.node, Math.min(part.text.length, start + length));
  } else range.selectNode(part.node);
  return range;
}

export function captureBookmark(root: HTMLElement, pane: HTMLElement, revision: number, format: BookmarkAnchor["format"], positionOnly: boolean): BookmarkAnchor | null {
  const blocks = readingBlocks(root);
  const paneRect = pane.getBoundingClientRect();
  const top = paneRect.top + 36;
  for (const [index, block] of blocks.entries()) {
    if (block.image) {
      const rect = block.image.getBoundingClientRect();
      if (rect.bottom <= top || rect.top >= paneRect.bottom) continue;
      return { version: 1, revision, format, block: index, offset: 0, kind: "image", exact: "", prefix: "", suffix: "" };
    }
    for (const part of block.parts) {
      if (!(part.node instanceof Text) || !part.text.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(part.node);
      const rect = range.getBoundingClientRect();
      if (rect.bottom <= top || rect.top >= paneRect.bottom || rect.height === 0) continue;
      // Binary search real line rectangles, including a single very long paragraph.
      let low = 0, high = part.text.length - 1;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        const rect = anchorRange(block, part.start + mid)!.getBoundingClientRect();
        if (rect.bottom <= top) low = mid + 1; else high = mid;
      }
      const offset = safeOffset(block.text, part.start + low);
      const end = Math.min(block.text.length, offset + 80);
      return { version: 1, revision, format, block: index, offset, kind: "text",
        exact: positionOnly ? "" : block.text.slice(offset, end),
        prefix: positionOnly ? "" : block.text.slice(Math.max(0, offset - 40), offset),
        suffix: positionOnly ? "" : block.text.slice(end, end + 40) };
    }
  }
  return null;
}

export function resolveBookmark(root: HTMLElement, anchor: BookmarkAnchor, revision: number, format: string, positionOnly: boolean): Range | null {
  if (anchor.version !== 1 || anchor.format !== format) return null;
  const blocks = readingBlocks(root);
  const direct = blocks[anchor.block];
  if (anchor.revision === revision && direct?.kind === anchor.kind && (direct.kind === "image" || anchor.offset < direct.text.length)) {
    if (positionOnly || (anchor.kind === "image") || (anchor.exact && direct.text.slice(anchor.offset, anchor.offset + anchor.exact.length) === anchor.exact)) {
      return anchorRange(direct, anchor.offset);
    }
  }
  if (positionOnly || !anchor.exact || anchor.kind !== "text") return null;
  const matches: Array<{ block: ReadingBlock; offset: number; context: boolean }> = [];
  for (const block of blocks) {
    let offset = block.text.indexOf(anchor.exact);
    while (offset >= 0) {
      const end = offset + anchor.exact.length;
      matches.push({ block, offset, context: block.text.slice(Math.max(0, offset - anchor.prefix.length), offset) === anchor.prefix && block.text.slice(end, end + anchor.suffix.length) === anchor.suffix });
      offset = block.text.indexOf(anchor.exact, offset + 1);
    }
  }
  const contextual = matches.filter((m) => m.context);
  const candidates = contextual.length ? contextual : matches;
  return candidates.length === 1 ? anchorRange(candidates[0].block, candidates[0].offset) : null;
}
