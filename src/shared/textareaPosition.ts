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
