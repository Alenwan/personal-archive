<script setup lang="ts">
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Expand,
  Maximize2,
  Minimize2,
  RotateCcw,
  RotateCw,
  Scan,
  ZoomIn,
  ZoomOut
} from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    src: string;
    alt: string;
    downloadUrl?: string;
    sequencePosition?: number;
    sequenceTotal?: number;
    sequenceLoading?: boolean;
    previousLabel?: string;
    nextLabel?: string;
  }>(),
  {
    downloadUrl: "",
    sequencePosition: 0,
    sequenceTotal: 0,
    sequenceLoading: false,
    previousLabel: "",
    nextLabel: ""
  }
);

const emit = defineEmits<{
  previous: [];
  next: [];
}>();

const viewer = ref<HTMLDivElement | null>(null);
const canvas = ref<HTMLDivElement | null>(null);
const image = ref<HTMLImageElement | null>(null);
const imageReady = ref(false);
const imageError = ref(false);
const imageAttempt = ref(0);
const naturalWidth = ref(0);
const naturalHeight = ref(0);
const scale = ref(1);
const fitScale = ref(1);
const rotation = ref(0);
const panX = ref(0);
const panY = ref(0);
const dragging = ref(false);
const pinching = ref(false);
const fullscreen = ref(false);
const controlsVisible = ref(true);
let controlsTimer: ReturnType<typeof setTimeout> | undefined;
let keyboardControls = false;
let disposed = false;
const controlSelector = '.image-viewer-toolbar, .image-viewer-nav, .image-viewer-footer, .image-viewer-status';

function showControls() {
  if (disposed) return;
  clearTimeout(controlsTimer);
  controlsVisible.value = true;
}

function hideControls() {
  clearTimeout(controlsTimer);
  if (!fullscreen.value || disposed) return;
  if (viewer.value?.contains(document.activeElement) && document.activeElement?.closest(controlSelector)) {
    viewer.value.querySelector<HTMLButtonElement>('.image-viewer-tools-handle')?.focus({ preventScroll: true });
  }
  controlsVisible.value = false;
}

function scheduleHideControls() {
  clearTimeout(controlsTimer);
  if (!fullscreen.value || disposed || !controlsVisible.value) return;
  controlsTimer = setTimeout(() => {
    const focused = viewer.value?.contains(document.activeElement) && document.activeElement?.closest(controlSelector);
    if (keyboardControls && focused) return;
    hideControls();
  }, 800);
}

function onControlsOver(event: PointerEvent) {
  if (controlsVisible.value && (event.target as Element).closest(controlSelector)) clearTimeout(controlsTimer);
}

function onControlsOut(event: PointerEvent) {
  if (!(event.relatedTarget instanceof Element) || !event.relatedTarget.closest(controlSelector)) scheduleHideControls();
}

function onHandleEnter(event: PointerEvent) {
  if (event.pointerType === 'mouse') showControls();
}
const viewMode = ref<"fit" | "custom">("fit");
let pointerStartX = 0;
let pointerStartY = 0;
let panStartX = 0;
let panStartY = 0;
const activePointers = new Map<number, { x: number; y: number }>();
let pinchStartDistance = 0;
let pinchStartScale = 1;
let pinchStartMidpointX = 0;
let pinchStartMidpointY = 0;
let pinchStartPanX = 0;
let pinchStartPanY = 0;
let swipePointerId: number | null = null;
let swipeStartX = 0;
let swipeStartY = 0;
let swipeCancelled = false;
let resizeObserver: ResizeObserver | null = null;

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;

const zoomLabel = computed(() => `${Math.round(scale.value * 100)}%`);
const imageStyle = computed(() => ({
  width: `${naturalWidth.value * scale.value}px`,
  height: `${naturalHeight.value * scale.value}px`,
  visibility: imageReady.value ? "visible" as const : "hidden" as const,
  transform: `translate(${panX.value}px, ${panY.value}px) rotate(${rotation.value}deg)`
}));
const canPan = computed(() => scale.value > fitScale.value * 1.01);
const hasImageSequence = computed(() => props.sequenceTotal > 1);
const sequenceStatus = computed(() => {
  if (props.sequenceLoading) return "Finding images…";
  if (!hasImageSequence.value) return "";
  return `${props.sequencePosition} / ${props.sequenceTotal}`;
});

function clampScale(value: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function resetPan() {
  panX.value = 0;
  panY.value = 0;
}

function calculateFitScale() {
  if (!canvas.value || !naturalWidth.value || !naturalHeight.value) return;
  const quarterTurn = Math.abs(rotation.value / 90) % 2 === 1;
  const imageWidth = quarterTurn ? naturalHeight.value : naturalWidth.value;
  const imageHeight = quarterTurn ? naturalWidth.value : naturalHeight.value;
  const horizontalPadding = fullscreen.value ? 8 : 32;
  const verticalPadding = fullscreen.value ? 8 : 32;
  const availableWidth = Math.max(1, canvas.value.clientWidth - horizontalPadding);
  const availableHeight = Math.max(1, canvas.value.clientHeight - verticalPadding);
  fitScale.value = Math.min(1, availableWidth / imageWidth, availableHeight / imageHeight);
  if (viewMode.value === "fit") {
    scale.value = fitScale.value;
    resetPan();
  }
}

function fitToWindow() {
  viewMode.value = "fit";
  calculateFitScale();
  scale.value = fitScale.value;
  resetPan();
}

function actualSize() {
  viewMode.value = "custom";
  scale.value = 1;
  resetPan();
}

function setScale(nextScale: number) {
  viewMode.value = "custom";
  scale.value = clampScale(nextScale);
  if (scale.value <= fitScale.value * 1.01) resetPan();
}

function zoomIn() {
  setScale(scale.value * 1.25);
}

function zoomOut() {
  setScale(scale.value / 1.25);
}

function rotate(delta: number) {
  rotation.value = (rotation.value + delta + 360) % 360;
  resetPan();
  void nextTick(calculateFitScale);
}

async function onImageLoad(event: Event) {
  const loaded = event.currentTarget as HTMLImageElement;
  try {
    await loaded.decode();
    if (image.value !== loaded) return;
    naturalWidth.value = loaded.naturalWidth;
    naturalHeight.value = loaded.naturalHeight;
    calculateFitScale();
    imageReady.value = true;
  } catch {
    if (image.value === loaded) imageError.value = true;
  }
}

function onImageError(event: Event) {
  if (event.currentTarget === image.value) imageError.value = true;
}

function retryImage() {
  imageReady.value = false;
  imageError.value = false;
  imageAttempt.value += 1;
}

function onWheel(event: WheelEvent) {
  setScale(scale.value * (event.deltaY < 0 ? 1.12 : 1 / 1.12));
}

function onDoubleClick() {
  if (Math.abs(scale.value - fitScale.value) < 0.01) actualSize();
  else fitToWindow();
}

function onPointerDown(event: PointerEvent) {
  hideControls();
  viewer.value?.focus();
  if (event.pointerType === "mouse" && event.button !== 0) return;
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  canvas.value?.setPointerCapture(event.pointerId);

  if (activePointers.size === 2) {
    swipePointerId = null;
    swipeCancelled = true;
    const [first, second] = [...activePointers.values()];
    pinchStartDistance = Math.hypot(second.x - first.x, second.y - first.y);
    pinchStartScale = scale.value;
    pinchStartMidpointX = (first.x + second.x) / 2;
    pinchStartMidpointY = (first.y + second.y) / 2;
    pinchStartPanX = panX.value;
    pinchStartPanY = panY.value;
    dragging.value = false;
    pinching.value = true;
    return;
  }

  if (!canPan.value) {
    if (event.pointerType !== "mouse" && hasImageSequence.value) {
      swipePointerId = event.pointerId;
      swipeStartX = event.clientX;
      swipeStartY = event.clientY;
      swipeCancelled = false;
    }
    return;
  }
  dragging.value = true;
  pointerStartX = event.clientX;
  pointerStartY = event.clientY;
  panStartX = panX.value;
  panStartY = panY.value;
}

function onPointerMove(event: PointerEvent) {
  if (!activePointers.has(event.pointerId)) return;
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (event.pointerId === swipePointerId && !swipeCancelled) {
    const deltaX = event.clientX - swipeStartX;
    const deltaY = event.clientY - swipeStartY;
    if (Math.abs(deltaY) > 24 && Math.abs(deltaY) > Math.abs(deltaX)) swipeCancelled = true;
  }

  if (activePointers.size === 2 && pinchStartDistance > 0) {
    const [first, second] = [...activePointers.values()];
    const distance = Math.hypot(second.x - first.x, second.y - first.y);
    const midpointX = (first.x + second.x) / 2;
    const midpointY = (first.y + second.y) / 2;
    const nextScale = clampScale(pinchStartScale * distance / pinchStartDistance);
    const scaleRatio = nextScale / pinchStartScale;
    const rect = canvas.value?.getBoundingClientRect();
    const centerX = rect ? rect.left + rect.width / 2 : pinchStartMidpointX;
    const centerY = rect ? rect.top + rect.height / 2 : pinchStartMidpointY;

    viewMode.value = "custom";
    scale.value = nextScale;
    panX.value = pinchStartPanX + midpointX - pinchStartMidpointX
      - (scaleRatio - 1) * (pinchStartMidpointX - centerX - pinchStartPanX);
    panY.value = pinchStartPanY + midpointY - pinchStartMidpointY
      - (scaleRatio - 1) * (pinchStartMidpointY - centerY - pinchStartPanY);
    return;
  }

  if (!dragging.value) return;
  panX.value = panStartX + event.clientX - pointerStartX;
  panY.value = panStartY + event.clientY - pointerStartY;
}

function onPointerUp(event: PointerEvent) {
  const shouldNavigate = event.pointerId === swipePointerId && !swipeCancelled && !pinching.value;
  const swipeDeltaX = event.clientX - swipeStartX;
  const swipeDeltaY = event.clientY - swipeStartY;
  if (event.pointerId === swipePointerId) swipePointerId = null;
  activePointers.delete(event.pointerId);
  if (canvas.value?.hasPointerCapture(event.pointerId)) canvas.value.releasePointerCapture(event.pointerId);
  if (activePointers.size === 1 && canPan.value) {
    const [remaining] = activePointers.values();
    pointerStartX = remaining.x;
    pointerStartY = remaining.y;
    panStartX = panX.value;
    panStartY = panY.value;
    dragging.value = true;
  } else {
    dragging.value = false;
  }
  if (activePointers.size < 2) {
    pinching.value = false;
    pinchStartDistance = 0;
  }
  if (shouldNavigate && Math.abs(swipeDeltaX) >= 56 && Math.abs(swipeDeltaX) > Math.abs(swipeDeltaY) * 1.25) {
    if (swipeDeltaX < 0 && props.nextLabel) emit("next");
    if (swipeDeltaX > 0 && props.previousLabel) emit("previous");
  }
}

function onPointerCancel(event: PointerEvent) {
  if (event.pointerId === swipePointerId) swipePointerId = null;
  swipeCancelled = true;
  onPointerUp(event);
}

async function toggleFullscreen() {
  if (!viewer.value) return;
  if (document.fullscreenElement === viewer.value) await document.exitFullscreen();
  else await viewer.value.requestFullscreen();
}

function onFullscreenChange() {
  fullscreen.value = document.fullscreenElement === viewer.value;
  clearTimeout(controlsTimer);
  controlsVisible.value = !fullscreen.value;
  if (fullscreen.value) viewer.value?.focus({ preventScroll: true });
  void nextTick(calculateFitScale);
}

function onKeydown(event: KeyboardEvent) {
  keyboardControls = true;
  if (event.key === "+" || event.key === "=") zoomIn();
  else if (event.key === "-") zoomOut();
  else if (event.key === "0") fitToWindow();
  else if (event.key === "1") actualSize();
  else if (event.key.toLowerCase() === "r") rotate(event.shiftKey ? -90 : 90);
  else if (event.key.toLowerCase() === "f") void toggleFullscreen();
  else return;
  event.preventDefault();
}

watch(
  () => props.src,
  () => {
    imageReady.value = false;
    imageError.value = false;
    naturalWidth.value = 0;
    naturalHeight.value = 0;
    rotation.value = 0;
    activePointers.clear();
    dragging.value = false;
    pinching.value = false;
    swipePointerId = null;
    swipeCancelled = false;
    resetPan();
  }
);

onMounted(() => {
  document.addEventListener("fullscreenchange", onFullscreenChange);
  resizeObserver = new ResizeObserver(calculateFitScale);
  if (canvas.value) resizeObserver.observe(canvas.value);
});

onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(controlsTimer);
  document.removeEventListener("fullscreenchange", onFullscreenChange);
  activePointers.clear();
  swipePointerId = null;
  resizeObserver?.disconnect();
});
</script>

<template>
  <div
    ref="viewer"
    class="image-viewer"
    :class="{ 'controls-hidden': fullscreen && !controlsVisible }"
    tabindex="0"
    role="application"
    aria-label="Image preview"
    @keydown="onKeydown"
    @pointerdown="keyboardControls = false"
    @pointerover="onControlsOver"
    @pointerout="onControlsOut"
    @focusout="scheduleHideControls"
  >
    <button v-if="fullscreen" class="image-viewer-tools-handle" type="button"
      :aria-expanded="controlsVisible" aria-label="Show image tools"
      @pointerenter="onHandleEnter" @pointerleave="scheduleHideControls" @click="showControls">
      ⌄ Tools
    </button>
    <div class="image-viewer-toolbar" role="toolbar" aria-label="Image controls">
      <div class="image-viewer-group">
        <button type="button" title="Zoom out (−)" aria-label="Zoom out" @click="zoomOut"><ZoomOut /></button>
        <span class="image-viewer-zoom" aria-live="polite">{{ zoomLabel }}</span>
        <button type="button" title="Zoom in (+)" aria-label="Zoom in" @click="zoomIn"><ZoomIn /></button>
      </div>
      <span class="image-viewer-divider" />
      <div class="image-viewer-group">
        <button type="button" title="Fit to window (0)" aria-label="Fit to window" @click="fitToWindow"><Scan /></button>
        <button type="button" title="Actual size (1)" aria-label="Actual size" @click="actualSize"><Expand /></button>
      </div>
      <span class="image-viewer-divider" />
      <div class="image-viewer-group">
        <button type="button" title="Rotate left (Shift+R)" aria-label="Rotate left" @click="rotate(-90)"><RotateCcw /></button>
        <button type="button" title="Rotate right (R)" aria-label="Rotate right" @click="rotate(90)"><RotateCw /></button>
      </div>
      <span class="image-viewer-divider" />
      <div class="image-viewer-group">
        <button
          type="button"
          :title="fullscreen ? 'Exit full screen (F)' : 'Full screen (F)'"
          :aria-label="fullscreen ? 'Exit full screen' : 'Full screen'"
          @click="toggleFullscreen"
        >
          <Minimize2 v-if="fullscreen" />
          <Maximize2 v-else />
        </button>
        <a v-if="downloadUrl" :href="downloadUrl" title="Download original" aria-label="Download original"><Download /></a>
      </div>
    </div>

    <div
      ref="canvas"
      class="image-viewer-canvas"
      :class="{ 'is-pannable': canPan, 'is-dragging': dragging, 'is-pinching': pinching }"
      @wheel.prevent="onWheel"
      @dblclick="onDoubleClick"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
    >
      <img
        :key="`${src}:${imageAttempt}`"
        ref="image"
        :src="src"
        :alt="alt"
        class="image-viewer-image"
        :style="imageStyle"
        draggable="false"
        @load="onImageLoad"
        @error="onImageError"
      />
    </div>
    <div v-if="!imageReady" class="image-viewer-status" role="status">
      <template v-if="imageError">
        <p>Unable to load this image.</p>
        <button type="button" class="btn-secondary mt-3" @click="retryImage">Retry image</button>
        <a v-if="downloadUrl" :href="downloadUrl" class="ml-3 underline">Download original</a>
      </template>
      <span v-else>Loading image…</span>
    </div>

    <button
      v-if="hasImageSequence"
      class="image-viewer-nav is-previous"
      type="button"
      :disabled="!previousLabel"
      :aria-label="previousLabel ? `Previous image: ${previousLabel}` : 'No previous image'"
      :title="previousLabel ? `Previous: ${previousLabel}` : 'First image'"
      @click="emit('previous')"
    >
      <ChevronLeft />
    </button>
    <button
      v-if="hasImageSequence"
      class="image-viewer-nav is-next"
      type="button"
      :disabled="!nextLabel"
      :aria-label="nextLabel ? `Next image: ${nextLabel}` : 'No next image'"
      :title="nextLabel ? `Next: ${nextLabel}` : 'Last image'"
      @click="emit('next')"
    >
      <ChevronRight />
    </button>

    <div class="image-viewer-footer">
    <div v-if="sequenceStatus" class="image-viewer-position" aria-live="polite">
      {{ sequenceStatus }}
    </div>

    <div class="image-viewer-hint" aria-hidden="true">
      <span class="image-viewer-hint-desktop">
        Scroll to zoom · Double-click for actual size · Drag to move<span v-if="hasImageSequence"> · ← → to browse</span>
      </span>
      <span class="image-viewer-hint-touch">
        Pinch to zoom · Drag to move<span v-if="hasImageSequence"> · Swipe to browse</span>
      </span>
    </div>
    </div>
  </div>
</template>

<style scoped>
.image-viewer {
  position: relative;
  min-height: 0;
  flex: 1;
  overflow: hidden;
  background: #171b1a;
  color: white;
  outline: none;
}

.image-viewer:focus-visible {
  box-shadow: inset 0 0 0 2px #7dc4bc;
}

.image-viewer:fullscreen {
  width: 100vw;
  height: 100vh;
  background: #111413;
}

.image-viewer-toolbar {
  position: absolute;
  z-index: 5;
  top: 0.75rem;
  left: 50%;
  display: flex;
  max-width: calc(100% - 1.5rem);
  transform: translateX(-50%);
  align-items: center;
  gap: 0.25rem;
  overflow-x: auto;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 0.75rem;
  background: rgba(24, 29, 27, 0.88);
  padding: 0.3rem;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(14px);
  scrollbar-width: none;
}

.image-viewer-toolbar::-webkit-scrollbar {
  display: none;
}

.image-viewer-group {
  display: flex;
  align-items: center;
  gap: 0.15rem;
}

.image-viewer-toolbar button,
.image-viewer-toolbar a {
  display: grid;
  width: 2rem;
  height: 2rem;
  flex: 0 0 auto;
  place-items: center;
  border: 0;
  border-radius: 0.5rem;
  background: transparent;
  color: rgba(255, 255, 255, 0.86);
  transition: background 140ms ease, color 140ms ease, transform 140ms ease;
}

.image-viewer-toolbar button:hover,
.image-viewer-toolbar a:hover {
  background: rgba(255, 255, 255, 0.12);
  color: white;
}

.image-viewer-toolbar button:active,
.image-viewer-toolbar a:active {
  transform: scale(0.94);
}

.image-viewer-toolbar svg {
  width: 1rem;
  height: 1rem;
}

.image-viewer-zoom {
  min-width: 3.25rem;
  padding: 0 0.2rem;
  color: rgba(255, 255, 255, 0.84);
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  text-align: center;
}

.image-viewer-divider {
  width: 1px;
  height: 1.15rem;
  flex: 0 0 auto;
  background: rgba(255, 255, 255, 0.14);
}

.image-viewer-canvas {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  touch-action: none;
  user-select: none;
}

.image-viewer-canvas.is-pannable {
  cursor: grab;
}

.image-viewer-canvas.is-dragging {
  cursor: grabbing;
}

.image-viewer-image {
  max-width: none;
  max-height: none;
  flex: 0 0 auto;
  border-radius: 0.35rem;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.34);
  transform-origin: center;
  /* Size the decoded image for the viewport; avoid a full-resolution scaled GPU layer. */
}

.image-viewer-status {
  position: absolute;
  z-index: 3;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  padding: 1rem;
  text-align: center;
  color: rgba(255, 255, 255, 0.8);
}

.image-viewer-nav {
  position: absolute;
  z-index: 4;
  top: 50%;
  display: grid;
  width: 3rem;
  height: 3rem;
  transform: translateY(-50%);
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  background: rgba(18, 22, 21, 0.76);
  color: rgba(255, 255, 255, 0.92);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(12px);
  transition: background 140ms ease, opacity 140ms ease, transform 140ms ease;
}

.image-viewer-nav:hover:not(:disabled) {
  background: rgba(47, 128, 118, 0.92);
  transform: translateY(-50%) scale(1.05);
}

.image-viewer-nav:active:not(:disabled) {
  transform: translateY(-50%) scale(0.95);
}

.image-viewer-nav:disabled {
  cursor: default;
  opacity: 0.18;
}

.image-viewer-nav.is-previous {
  left: 0.75rem;
}

.image-viewer-nav.is-next {
  right: 0.75rem;
}

.image-viewer-nav svg {
  width: 1.5rem;
  height: 1.5rem;
}

.image-viewer-position {
  position: absolute;
  z-index: 4;
  bottom: 0.65rem;
  left: 50%;
  min-width: 3.75rem;
  transform: translateX(-50%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  background: rgba(18, 22, 21, 0.76);
  padding: 0.3rem 0.7rem;
  color: rgba(255, 255, 255, 0.84);
  font-size: 0.7rem;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  text-align: center;
  backdrop-filter: blur(8px);
}

.image-viewer-canvas.is-dragging .image-viewer-image,
.image-viewer-canvas.is-pinching .image-viewer-image {
  transition: none;
}

.image-viewer-hint {
  position: absolute;
  right: 0.75rem;
  bottom: 0.65rem;
  border-radius: 999px;
  background: rgba(18, 22, 21, 0.66);
  padding: 0.28rem 0.55rem;
  color: rgba(255, 255, 255, 0.58);
  font-size: 0.65rem;
  letter-spacing: 0.01em;
  pointer-events: none;
  backdrop-filter: blur(8px);
}

.image-viewer-hint-touch {
  display: none;
}

@media (max-width: 900px) {
  .image-viewer {
    display: flex;
    flex-direction: column;
  }

  .image-viewer-toolbar {
    position: relative;
    inset: auto;
    width: 100%;
    max-width: none;
    flex: none;
    transform: none;
    border-width: 0 0 1px;
    border-radius: 0;
    padding: 0.4rem 0.5rem;
    box-shadow: none;
  }

  .image-viewer-toolbar button,
  .image-viewer-toolbar a {
    width: 2.75rem;
    height: 2.75rem;
  }

  .image-viewer-toolbar svg {
    width: 1.15rem;
    height: 1.15rem;
  }

  .image-viewer-canvas {
    height: auto;
    flex: 1;
  }

  .image-viewer-hint {
    right: 50%;
    bottom: 0.5rem;
    transform: translateX(50%);
    white-space: nowrap;
  }

  .image-viewer-nav {
    top: calc(50% + 1.55rem);
    width: 3.25rem;
    height: 3.25rem;
  }

  .image-viewer-position {
    bottom: 2.55rem;
  }

  .image-viewer-hint-desktop {
    display: none;
  }

  .image-viewer-hint-touch {
    display: inline;
  }
}

@media (prefers-reduced-motion: reduce) {
  .image-viewer-image,
  .image-viewer-nav,
  .image-viewer-toolbar button,
  .image-viewer-toolbar a {
    transition: none;
  }

  .image-viewer-image {
    animation: none;
  }
}
/* Normal previews reserve space for controls; fullscreen keeps the entire canvas. */
.image-viewer { display: flex; flex-direction: column; }
.image-viewer-toolbar {
  position: relative;
  inset: auto;
  flex: none;
  width: 100%;
  max-width: none;
  transform: none;
  justify-content: center;
  border-width: 0 0 1px;
  border-radius: 0;
  box-shadow: none;
  backdrop-filter: none;
}
.image-viewer-canvas { flex: 1; height: auto; }
@media (max-width: 900px) {
  .image-viewer-toolbar { justify-content: flex-start; }
}
.image-viewer-footer {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.25rem 0.75rem;
  padding: 0.35rem 0.5rem;
  background: #171b1a;
}
.image-viewer-footer .image-viewer-position,
.image-viewer-footer .image-viewer-hint {
  position: static;
  transform: none;
  backdrop-filter: none;
  white-space: normal;
  text-align: center;
}
.image-viewer:fullscreen .image-viewer-canvas { flex: none; height: 100%; }
.image-viewer:fullscreen .image-viewer-toolbar {
  position: absolute;
  top: calc(max(0rem, env(safe-area-inset-top)) + 1.8rem);
  left: 50%;
  width: max-content;
  max-width: calc(100% - 1rem);
  transform: translateX(-50%);
  justify-content: flex-start;
  border-width: 1px;
  border-radius: 0.75rem;
}
.image-viewer:fullscreen .image-viewer-footer {
  position: absolute;
  z-index: 4;
  bottom: max(0.35rem, env(safe-area-inset-bottom));
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  max-width: calc(100% - 1rem);
  border-radius: 0.75rem;
  background: rgba(18, 22, 21, 0.76);
}
.image-viewer:fullscreen .image-viewer-nav { top: 50%; }
.image-viewer-tools-handle {
  position: absolute;
  z-index: 6;
  top: max(0rem, env(safe-area-inset-top));
  left: 50%;
  transform: translateX(-50%);
  min-width: 5rem;
  min-height: 1.6rem;
  padding: 0.15rem 0.65rem;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 0 0 0.6rem 0.6rem;
  background: rgba(18, 22, 21, 0.72);
  color: rgba(255, 255, 255, 0.8);
  font-size: 0.7rem;
  cursor: pointer;
}
.image-viewer-tools-handle:focus-visible { outline: 2px solid #7dc4bc; outline-offset: 2px; }
.image-viewer.controls-hidden .image-viewer-toolbar,
.image-viewer.controls-hidden .image-viewer-footer,
.image-viewer.controls-hidden .image-viewer-nav {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}
</style>
