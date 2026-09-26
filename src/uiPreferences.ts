import { ref, watch } from "vue";

export const PERSONAL_UI_STYLES = [
  { id: "daylight", name: "Daylight", description: "Soft shapes and a warm, lively workspace" },
  { id: "quiet", name: "Quiet", description: "Restrained, compact and distraction-free" },
  { id: "blue-hour", name: "Blue Hour", description: "Cool surfaces with a composed dark rail" },
  { id: "editorial", name: "Editorial", description: "Paper texture, serif headings and fine rules" },
  { id: "gallery", name: "Gallery", description: "A floating navigation rail and generous panels" }
] as const;

export const PERSONAL_UI_ACCENTS = [
  { id: "sea-glass", name: "Sea glass", color: "#397f75" },
  { id: "coral", name: "Coral", color: "#c85d47" },
  { id: "indigo", name: "Indigo", color: "#596bc1" },
  { id: "plum", name: "Plum", color: "#79577f" },
  { id: "olive", name: "Olive", color: "#6e7845" },
  { id: "amber", name: "Amber", color: "#a26c1f" },
  { id: "slate", name: "Slate", color: "#536872" }
] as const;

export const PERSONAL_UI_PALETTES = [
  {
    id: "style-match",
    name: "Style match",
    description: "Uses the surfaces designed for the selected interface style",
    page: "#f7f7f4",
    surface: "#ffffff",
    text: "#20201d",
    border: "#d8d8cd"
  },
  {
    id: "warm-paper",
    name: "Warm paper",
    description: "Creamy paper with soft walnut text",
    page: "#f2eadf",
    surface: "#fffaf2",
    text: "#3d3329",
    border: "#d9cbbb"
  },
  {
    id: "mist-blue",
    name: "Mist blue",
    description: "Cool, clear surfaces for focused work",
    page: "#eaf0f6",
    surface: "#f9fbfe",
    text: "#27384e",
    border: "#cbd7e4"
  },
  {
    id: "sage-wash",
    name: "Sage wash",
    description: "A quiet green tint with natural contrast",
    page: "#e8eee9",
    surface: "#f9fcf9",
    text: "#283b32",
    border: "#c8d5cc"
  },
  {
    id: "soft-lilac",
    name: "Soft lilac",
    description: "Muted violet without losing readability",
    page: "#f0eaf1",
    surface: "#fcf9fd",
    text: "#403244",
    border: "#d8cbd9"
  },
  {
    id: "night-ink",
    name: "Night ink",
    description: "Deep slate surfaces for low-light use",
    page: "#182027",
    surface: "#222c35",
    text: "#edf3f2",
    border: "#3c4b56"
  },
  {
    id: "ember-dusk",
    name: "Ember dusk",
    description: "Warm charcoal with softly lit text",
    page: "#201b19",
    surface: "#2b2522",
    text: "#f3ece4",
    border: "#51443d"
  },
  {
    id: "deep-tide",
    name: "Deep tide",
    description: "Dark teal surfaces with cool clarity",
    page: "#0f2225",
    surface: "#173033",
    text: "#e8f3f2",
    border: "#315054"
  }
] as const;

export type PersonalUiStyle = (typeof PERSONAL_UI_STYLES)[number]["id"];
export type PersonalUiAccent = (typeof PERSONAL_UI_ACCENTS)[number]["id"];
export type PersonalUiPalette = (typeof PERSONAL_UI_PALETTES)[number]["id"];
export type PersonalUiDensity = "compact" | "comfortable";

const STORAGE_KEY = "personal-archive.ui-preferences";

function isUiStyle(value: unknown): value is PersonalUiStyle {
  return PERSONAL_UI_STYLES.some((option) => option.id === value);
}

function isUiAccent(value: unknown): value is PersonalUiAccent {
  return PERSONAL_UI_ACCENTS.some((option) => option.id === value);
}

function isUiPalette(value: unknown): value is PersonalUiPalette {
  return PERSONAL_UI_PALETTES.some((option) => option.id === value);
}

function readPreferences(): { style: PersonalUiStyle; accent: PersonalUiAccent; palette: PersonalUiPalette; density: PersonalUiDensity } {
  if (typeof window === "undefined") return { style: "daylight", accent: "sea-glass", palette: "style-match", density: "compact" };
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}") as {
      style?: PersonalUiStyle;
      theme?: PersonalUiStyle;
      accent?: PersonalUiAccent;
      palette?: PersonalUiPalette;
      density?: PersonalUiDensity;
    };
    const savedStyle = stored.style ?? stored.theme;
    return {
      style: isUiStyle(savedStyle) ? savedStyle : "daylight",
      accent: isUiAccent(stored.accent) ? stored.accent : "sea-glass",
      palette: isUiPalette(stored.palette) ? stored.palette : "style-match",
      density: stored.density === "comfortable" ? "comfortable" : "compact"
    };
  } catch {
    return { style: "daylight", accent: "sea-glass", palette: "style-match", density: "compact" };
  }
}

const initial = readPreferences();
const style = ref<PersonalUiStyle>(initial.style);
const accent = ref<PersonalUiAccent>(initial.accent);
const palette = ref<PersonalUiPalette>(initial.palette);
const density = ref<PersonalUiDensity>(initial.density);

watch(
  [style, accent, palette, density],
  ([nextStyle, nextAccent, nextPalette, nextDensity]) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ style: nextStyle, accent: nextAccent, palette: nextPalette, density: nextDensity })
    );
  },
  { flush: "sync" }
);

export function useUiPreferences() {
  return { style, accent, palette, density };
}
