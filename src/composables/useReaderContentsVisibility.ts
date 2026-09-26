import { ref, watch, type Ref } from "vue";

const states = new Map<string, Ref<boolean>>();

function loadInitialState(storageKey: string, defaultOpen: boolean) {
  try {
    if (typeof localStorage === "undefined") return defaultOpen;
    const stored = localStorage.getItem(storageKey);
    return stored === null ? defaultOpen : stored !== "false";
  } catch {
    return defaultOpen;
  }
}

export function useReaderContentsVisibility(storageKey: string, defaultOpen = true) {
  let contentsOpen = states.get(storageKey);
  if (!contentsOpen) {
    contentsOpen = ref(loadInitialState(storageKey, defaultOpen));
    states.set(storageKey, contentsOpen);
    watch(contentsOpen, (open) => {
      try {
        localStorage.setItem(storageKey, String(open));
      } catch {
        // Storage can be unavailable in private or restricted browser contexts.
      }
    });
  }
  return { contentsOpen };
}
