import { anchorRange, readingBlocks } from "./manuscriptBookmarkPosition";

/** Ephemeral numeric positions only. Never persisted or sent to an API. */
export interface ManuscriptViewport {
  format: "markdown" | "rich-text";
  source?: number;
  block?: number;
  offset?: number;
  inset: number;
  start?: boolean;
  revision?: number;
}
export type MarkdownSourceMap = Map<string, number[]>;

export function viewportTop(pane: HTMLElement) {
  return Math.max(0, pane.getBoundingClientRect().top + pane.clientTop);
}

export function captureManuscriptViewport(root: HTMLElement, pane: HTMLElement, format: ManuscriptViewport["format"], sourceMap?: MarkdownSourceMap): ManuscriptViewport | null {
  if (pane.scrollTop <= 0 && root.getBoundingClientRect().top >= viewportTop(pane)) return { format, inset: 0, start: true };
  const top = viewportTop(pane), bottom = Math.min(innerHeight, pane.getBoundingClientRect().bottom);
  const blocks = readingBlocks(root);
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    for (const part of block.image ? [null] : block.parts) {
      if (part && (!(part.node instanceof Text) || !part.text.trim())) continue;
      const range = document.createRange();
      if (part) range.selectNodeContents(part.node); else range.selectNode(block.image!);
      const bounds = range.getBoundingClientRect();
      if (!bounds.height || bounds.bottom <= top || bounds.top >= bottom) continue;
      let low = 0, high = part ? part.text.length - 1 : 0;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        const rect = anchorRange(block, part!.start + mid)!.getBoundingClientRect();
        if (rect.bottom <= top) low = mid + 1; else high = mid;
      }
      const offset = (part?.start ?? 0) + low;
      const target = anchorRange(block, offset);
      if (!target) continue;
      const rect = target.getBoundingClientRect();
      const inset = (rect.top - top) / Math.max(1, rect.height);
      if (format === "rich-text") return { format, block: index, offset, inset };
      const node = target.startContainer;
      const wrapper = (block.image ?? (node instanceof Element ? node : node.parentElement))?.closest<HTMLElement>("[data-manuscript-source]");
      const positions = wrapper && sourceMap?.get(wrapper.dataset.manuscriptSource!);
      if (!wrapper || !positions?.length) continue;
      const before = document.createRange(); before.selectNodeContents(wrapper);
      if (!block.image) before.setEnd(target.startContainer, target.startOffset);
      const source = positions[block.image ? 0 : Math.min(before.toString().length, positions.length - 1)];
      return { format, source, inset };
    }
  }
  return null;
}

export function resolveManuscriptViewport(root: HTMLElement, anchor: ManuscriptViewport, sourceMap?: MarkdownSourceMap): Range | null {
  if (anchor.format === "rich-text") {
    const block = readingBlocks(root)[anchor.block ?? -1];
    return block ? anchorRange(block, anchor.offset ?? 0) : null;
  }
  if (anchor.source === undefined || !sourceMap) return null;
  let best: { element: HTMLElement; index: number; distance: number } | null = null;
  for (const element of root.querySelectorAll<HTMLElement>("[data-manuscript-source]")) {
    const positions = sourceMap.get(element.dataset.manuscriptSource!);
    if (!positions?.length) continue;
    let low = 0, high = positions.length - 1;
    while (low < high) { const mid = Math.floor((low + high) / 2); if (positions[mid] < anchor.source) low = mid + 1; else high = mid; }
    for (const index of [low, Math.max(0, low - 1)]) {
      const distance = Math.abs(positions[index] - anchor.source);
      if (!best || distance < best.distance) best = { element, index, distance };
    }
  }
  if (!best) return null;
  const range = document.createRange();
  const walker = document.createTreeWalker(best.element, NodeFilter.SHOW_TEXT);
  let remaining = best.index;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (remaining < length) {
      range.setStart(node, remaining); range.setEnd(node, Math.min(length, remaining + ((node.textContent!.codePointAt(remaining) ?? 0) > 0xffff ? 2 : 1)));
      return range;
    }
    remaining -= length;
  }
  range.selectNode(best.element); return range;
}

export function restoreManuscriptViewport(root: HTMLElement, pane: HTMLElement, anchor: ManuscriptViewport, sourceMap?: MarkdownSourceMap) {
  if (anchor.start) {
    pane.scrollTop = 0;
    if (pane.getBoundingClientRect().bottom <= 0 || pane.getBoundingClientRect().top < 0) window.scrollBy({ top: pane.getBoundingClientRect().top, behavior: "instant" });
    return true;
  }
  const range = resolveManuscriptViewport(root, anchor, sourceMap);
  if (!range) return false;
  const rect = range.getBoundingClientRect();
  const delta = rect.top - viewportTop(pane) - anchor.inset * Math.max(1, rect.height);
  for (let element: HTMLElement | null = pane; element; element = element.parentElement) {
    if (element.scrollHeight > element.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(element).overflowY)) {
      element.scrollBy({ top: delta, behavior: "instant" }); return true;
    }
  }
  window.scrollBy({ top: delta, behavior: "instant" });
  return true;
}
