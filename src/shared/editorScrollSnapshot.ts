/** Numeric, tab-memory-only geometry. No DOM references, text or keys survive a lock. */
export interface EditorScrollSnapshot {
  offsets: Array<{ top: number; left: number }>;
  windowTop: number;
  windowLeft: number;
}

export function captureEditorScroll(element: HTMLElement): EditorScrollSnapshot {
  const offsets: EditorScrollSnapshot["offsets"] = [];
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    offsets.push({ top: node.scrollTop, left: node.scrollLeft });
  }
  return { offsets, windowTop: window.scrollY, windowLeft: window.scrollX };
}

export function restoreEditorScroll(element: HTMLElement, snapshot: EditorScrollSnapshot) {
  let node: HTMLElement | null = element;
  for (const offset of snapshot.offsets) {
    if (!node) break;
    node.scrollTo({ top: offset.top, left: offset.left, behavior: "instant" });
    node = node.parentElement;
  }
  window.scrollTo({ top: snapshot.windowTop, left: snapshot.windowLeft, behavior: "instant" });
}
