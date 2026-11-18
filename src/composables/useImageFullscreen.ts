import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";

// iPhone/iPad browsers do not all expose the element Fullscreen API. Keep the
// same edge-to-edge layout available without requiring native fullscreen.
export function useImageFullscreen(target: Ref<HTMLElement | null>) {
  const native = ref(false);
  const expanded = ref(false);
  const fullscreen = computed(() => native.value || expanded.value);

  function sync() {
    native.value = Boolean(target.value && document.fullscreenElement === target.value);
    if (native.value) expanded.value = false;
  }

  async function exitFullscreen() {
    expanded.value = false;
    if (target.value && document.fullscreenElement === target.value) await document.exitFullscreen();
  }

  async function toggleFullscreen() {
    const element = target.value;
    if (!element) return;
    if (fullscreen.value) return exitFullscreen();
    if (document.fullscreenEnabled && element.requestFullscreen) {
      try {
        await element.requestFullscreen();
        return;
      } catch {
        // A denied native request still permits an in-page, viewport-sized view.
      }
    }
    expanded.value = true;
  }

  watch(target, element => {
    if (!element) expanded.value = false;
    sync();
  });
  onMounted(() => document.addEventListener("fullscreenchange", sync));
  onBeforeUnmount(() => {
    if (target.value && document.fullscreenElement === target.value) void document.exitFullscreen().catch(() => undefined);
    document.removeEventListener("fullscreenchange", sync);
  });
  return { fullscreen, toggleFullscreen, exitFullscreen };
}
