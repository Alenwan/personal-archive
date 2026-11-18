const TEXT_LAYOUT_PROPERTIES = [
  "direction",
  "fontFamily",
  "fontFeatureSettings",
  "fontKerning",
  "fontSize",
  "fontStretch",
  "fontStyle",
  "fontVariant",
  "fontVariationSettings",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "overflowWrap",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "tabSize",
  "textAlign",
  "textIndent",
  "textRendering",
  "textTransform",
  "whiteSpace",
  "wordBreak",
  "wordSpacing",
  "writingMode"
] as const;

/**
 * Measure a source offset using the textarea's real wrapping and font metrics.
 * Character ratios drift badly in long documents because wrapped lines do not
 * have a uniform number of characters.
 */
export function textareaOffsetTop(textarea: HTMLTextAreaElement, sourceOffset: number) {
  const value = textarea.value;
  const offset = Math.min(Math.max(0, sourceOffset), value.length);
  const computed = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  const marker = document.createElement("span");

  mirror.setAttribute("aria-hidden", "true");
  Object.assign(mirror.style, {
    position: "fixed",
    top: "0",
    left: "-100000px",
    visibility: "hidden",
    pointerEvents: "none",
    overflow: "hidden",
    boxSizing: "border-box",
    width: `${textarea.clientWidth}px`,
    minHeight: "0",
    margin: "0",
    border: "0"
  });

  for (const property of TEXT_LAYOUT_PROPERTIES) {
    mirror.style.setProperty(property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`), computed[property]);
  }

  // Browsers render textareas as pre-wrapped text even when their computed
  // white-space value is not exposed consistently.
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = computed.overflowWrap || "break-word";

  mirror.appendChild(document.createTextNode(value.slice(0, offset)));
  const lineEnd = value.indexOf("\n", offset);
  marker.textContent = value.slice(offset, lineEnd < 0 ? value.length : lineEnd) || "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const top = marker.offsetTop;
  mirror.remove();
  return top;
}

export function scrollTextareaOffsetIntoView(textarea: HTMLTextAreaElement, sourceOffset: number, topInset = 24) {
  const targetTop = textareaOffsetTop(textarea, sourceOffset);
  const maximum = Math.max(0, textarea.scrollHeight - textarea.clientHeight);
  textarea.scrollTop = Math.min(maximum, Math.max(0, targetTop - topInset));
}

// One full mirror, real Range rectangles and O(log n) line search. Never infer
// a character position from a scroll-height/character-count ratio.
function textareaMirror(textarea: HTMLTextAreaElement) {
  const style = getComputedStyle(textarea), mirror = document.createElement("div");
  Object.assign(mirror.style, { position: "fixed", top: "0", left: "-100000px", visibility: "hidden", pointerEvents: "none", boxSizing: "border-box", width: `${textarea.clientWidth}px`, margin: "0", border: "0" });
  for (const property of TEXT_LAYOUT_PROPERTIES) mirror.style.setProperty(property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`), style[property]);
  mirror.style.whiteSpace = "pre-wrap"; mirror.style.overflowWrap = style.overflowWrap || "break-word";
  const text = document.createTextNode(textarea.value || "\u200b"); mirror.appendChild(text); document.body.appendChild(mirror);
  const rect = (offset: number) => {
    let start = Math.min(Math.max(0, offset), text.length - 1);
    if (start > 0 && /[\uDC00-\uDFFF]/.test(text.data[start])) start--;
    const range = document.createRange(); range.setStart(text, start);
    range.setEnd(text, Math.min(text.length, start + ((text.data.codePointAt(start) ?? 0) > 0xffff ? 2 : 1)));
    return range.getBoundingClientRect();
  };
  return { mirror, rect };
}

export function captureTextareaViewport(textarea: HTMLTextAreaElement): import("./manuscriptViewport").ManuscriptViewport {
  const outer = textarea.getBoundingClientRect(), visibleTop = Math.max(0, outer.top + textarea.clientTop);
  if (textarea.scrollTop <= 0 && outer.top >= 0) return { format: "markdown", inset: 0, start: true };
  const { mirror, rect } = textareaMirror(textarea);
  try {
    const top = textarea.scrollTop + visibleTop - outer.top - textarea.clientTop;
    let low = 0, high = Math.max(0, textarea.value.length - 1);
    while (low < high) { const mid = Math.floor((low + high) / 2); if (rect(mid).bottom <= top) low = mid + 1; else high = mid; }
    const bounds = rect(low);
    return { format: "markdown", source: low, inset: (bounds.top - top) / Math.max(1, bounds.height) };
  } finally { mirror.remove(); }
}

export function restoreTextareaViewport(textarea: HTMLTextAreaElement, anchor: import("./manuscriptViewport").ManuscriptViewport) {
  if (anchor.start) { textarea.scrollTop = 0; return; }
  if (anchor.source === undefined) return;
  const { mirror, rect } = textareaMirror(textarea);
  try {
    const bounds = rect(anchor.source), outer = textarea.getBoundingClientRect();
    textarea.scrollTop = bounds.top - Math.max(0, -outer.top - textarea.clientTop) - anchor.inset * Math.max(1, bounds.height);
  } finally { mirror.remove(); }
}
