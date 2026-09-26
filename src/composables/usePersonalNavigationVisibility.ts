import { ref, watch } from "vue";

const STORAGE_KEY = "personal-archive.primary-navigation-open";

function loadInitialState() {
  try {
    return typeof localStorage === "undefined" || localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

const navigationOpen = ref(loadInitialState());

watch(navigationOpen, (open) => {
  try {
    localStorage.setItem(STORAGE_KEY, String(open));
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
});

export function usePersonalNavigationVisibility() {
  return { navigationOpen };
}
