import { onBeforeUnmount, ref } from "vue";

interface ResizablePanelOptions {
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  keyboardStep?: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function useResizablePanel(options: ResizablePanelOptions) {
  const storedWidth = typeof window === "undefined"
    ? Number.NaN
    : Number.parseFloat(window.localStorage.getItem(options.storageKey) ?? "");
  const width = ref(Number.isFinite(storedWidth)
    ? clamp(storedWidth, options.minWidth, options.maxWidth)
    : options.defaultWidth);
  const resizing = ref(false);
  const keyboardStep = options.keyboardStep ?? 12;
  let pointerStartX = 0;
  let pointerStartWidth = width.value;

  function persistWidth() {
    if (typeof window !== "undefined") window.localStorage.setItem(options.storageKey, String(width.value));
  }

  function setWidth(nextWidth: number, persist = true) {
    width.value = clamp(Math.round(nextWidth), options.minWidth, options.maxWidth);
    if (persist) persistWidth();
  }

  function onPointerMove(event: PointerEvent) {
    if (!resizing.value) return;
    setWidth(pointerStartWidth + event.clientX - pointerStartX, false);
  }

  function stopResize() {
    if (!resizing.value) return;
    resizing.value = false;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", stopResize);
    window.removeEventListener("pointercancel", stopResize);
    document.documentElement.classList.remove("panel-resize-active");
    persistWidth();
  }

  function startResize(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    pointerStartX = event.clientX;
    pointerStartWidth = width.value;
    resizing.value = true;
    document.documentElement.classList.add("panel-resize-active");
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }

  function resetWidth() {
    setWidth(options.defaultWidth);
  }

  function onSeparatorKeydown(event: KeyboardEvent) {
    const step = event.shiftKey ? keyboardStep * 4 : keyboardStep;
    if (event.key === "ArrowLeft") setWidth(width.value - step);
    else if (event.key === "ArrowRight") setWidth(width.value + step);
    else if (event.key === "Home") setWidth(options.minWidth);
    else if (event.key === "End") setWidth(options.maxWidth);
    else return;
    event.preventDefault();
  }

  onBeforeUnmount(stopResize);

  return {
    maxWidth: options.maxWidth,
    minWidth: options.minWidth,
    onSeparatorKeydown,
    resetWidth,
    resizing,
    startResize,
    width
  };
}
