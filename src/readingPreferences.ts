import { computed, reactive, readonly, watch } from "vue";

export type BuiltInReadingThemeId = "paper" | "warm" | "sepia" | "sage" | "night" | "contrast";
export type ReadingThemeId = BuiltInReadingThemeId | "custom" | string;
export type ReadingFont = "serif" | "sans";

export interface ReadingThemePreset {
  id: string;
  label: string;
  backgroundColor: string;
  textColor: string;
  builtIn: boolean;
}

export interface ReadingPreferences {
  theme: ReadingThemeId;
  backgroundColor: string;
  textColor: string;
  fontSize: number;
  lineHeight: number;
  contentWidth: number;
  font: ReadingFont;
}

export const READING_THEME_PRESETS: ReadonlyArray<ReadingThemePreset & { id: BuiltInReadingThemeId }> = [
  { id: "paper", label: "Paper", backgroundColor: "#fbfaf6", textColor: "#292824", builtIn: true },
  { id: "warm", label: "Warm", backgroundColor: "#f4ecd8", textColor: "#352f26", builtIn: true },
  { id: "sepia", label: "Sepia", backgroundColor: "#eadbbb", textColor: "#382f24", builtIn: true },
  { id: "sage", label: "Sage", backgroundColor: "#e5eee7", textColor: "#26332b", builtIn: true },
  { id: "night", label: "Night", backgroundColor: "#202421", textColor: "#e8e5dc", builtIn: true },
  { id: "contrast", label: "Contrast", backgroundColor: "#ffffff", textColor: "#171816", builtIn: true }
];

const md3ServiceTemplate = import.meta.env.VITE_BUSINESS_TEMPLATE === "md3-service";

export const DEFAULT_READING_PREFERENCES: ReadingPreferences = md3ServiceTemplate
  ? {
      theme: "paper",
      backgroundColor: "#fbfaf6",
      textColor: "#292824",
      fontSize: 16,
      lineHeight: 1.7,
      contentWidth: 1040,
      font: "sans"
    }
  : {
      theme: "warm",
      backgroundColor: "#f4ecd8",
      textColor: "#352f26",
      fontSize: 19,
      lineHeight: 1.75,
      contentWidth: 760,
      font: "serif"
    };

const STORAGE_KEY = md3ServiceTemplate
  ? "md3-platform.reading-preferences.v1"
  : "personal-archive.reader-preferences";
const PRESET_STORAGE_KEY = md3ServiceTemplate
  ? "md3-platform.reading-theme-presets.v1"
  : "personal-archive.reader-theme-presets.v1";
const MAX_CUSTOM_PRESETS = 18;

function validHex(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}

function clamp(value: unknown, minimum: number, maximum: number, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function validLabel(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const label = value.trim().replace(/\s+/g, " ").slice(0, 32);
  return label || fallback;
}

function readStoredPresets() {
  try {
    if (typeof localStorage === "undefined") return [];
    const parsed = JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY) || "[]") as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadThemePresets(): ReadingThemePreset[] {
  const stored = readStoredPresets();
  const storedById = new Map<string, Record<string, unknown>>();
  for (const value of stored) {
    if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
      storedById.set((value as { id: string }).id, value as Record<string, unknown>);
    }
  }

  const builtIns = READING_THEME_PRESETS.map((preset) => {
    const override = storedById.get(preset.id);
    return {
      ...preset,
      label: validLabel(override?.label, preset.label),
      backgroundColor: validHex(override?.backgroundColor, preset.backgroundColor),
      textColor: validHex(override?.textColor, preset.textColor)
    };
  });
  const builtInIds = new Set<string>(builtIns.map((preset) => preset.id));
  const custom: ReadingThemePreset[] = [];
  for (const value of stored) {
    if (!value || typeof value !== "object") continue;
    const candidate = value as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id : "";
    if (!id || id === "custom" || builtInIds.has(id) || custom.some((preset) => preset.id === id)) continue;
    custom.push({
      id,
      label: validLabel(candidate.label, "Untitled preset"),
      backgroundColor: validHex(candidate.backgroundColor, "#fbfaf6"),
      textColor: validHex(candidate.textColor, "#292824"),
      builtIn: false
    });
    if (custom.length >= MAX_CUSTOM_PRESETS) break;
  }
  return [...builtIns, ...custom];
}

const themePresets = reactive<ReadingThemePreset[]>(loadThemePresets());

function loadPreferences(): ReadingPreferences {
  let saved: Partial<ReadingPreferences> = {};
  try {
    if (typeof localStorage !== "undefined") saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Partial<ReadingPreferences>;
  } catch {
    saved = {};
  }
  const savedTheme = themePresets.find((preset) => preset.id === saved.theme);
  const fallbackTheme = savedTheme ?? themePresets.find((preset) => preset.id === DEFAULT_READING_PREFERENCES.theme)!;
  return {
    theme: saved.theme === "custom" ? "custom" : savedTheme?.id ?? DEFAULT_READING_PREFERENCES.theme,
    backgroundColor: validHex(saved.backgroundColor, fallbackTheme.backgroundColor),
    textColor: validHex(saved.textColor, fallbackTheme.textColor),
    fontSize: clamp(saved.fontSize, 14, 32, DEFAULT_READING_PREFERENCES.fontSize),
    lineHeight: clamp(saved.lineHeight, 1.45, 2.2, DEFAULT_READING_PREFERENCES.lineHeight),
    contentWidth: clamp(saved.contentWidth, 560, 1040, DEFAULT_READING_PREFERENCES.contentWidth),
    font: saved.font === "serif" || saved.font === "sans" ? saved.font : DEFAULT_READING_PREFERENCES.font
  };
}

const preferences = reactive<ReadingPreferences>(loadPreferences());

function channelToLinear(channel: number) {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(color: string) {
  const match = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!match) return 0;
  const [, red, green, blue] = match;
  return 0.2126 * channelToLinear(Number.parseInt(red, 16)) +
    0.7152 * channelToLinear(Number.parseInt(green, 16)) +
    0.0722 * channelToLinear(Number.parseInt(blue, 16));
}

export function colorContrastRatio(foreground: string, background: string) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

export function useReadingPreferences() {
  const contrastRatio = computed(() => colorContrastRatio(preferences.textColor, preferences.backgroundColor));
  const fontFamily = computed(() => preferences.font === "serif"
    ? "Iowan Old Style, Baskerville, Charter, Georgia, Times New Roman, serif"
    : "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif");

  function applyTheme(themeId: string) {
    const theme = themePresets.find((preset) => preset.id === themeId);
    if (!theme) return;
    preferences.theme = theme.id;
    preferences.backgroundColor = theme.backgroundColor;
    preferences.textColor = theme.textColor;
  }

  function setBackgroundColor(color: string) {
    preferences.backgroundColor = validHex(color, preferences.backgroundColor);
    preferences.theme = "custom";
  }

  function setTextColor(color: string) {
    preferences.textColor = validHex(color, preferences.textColor);
    preferences.theme = "custom";
  }

  function resetPreferences() {
    Object.assign(preferences, DEFAULT_READING_PREFERENCES);
    const theme = themePresets.find((preset) => preset.id === preferences.theme);
    if (theme) {
      preferences.backgroundColor = theme.backgroundColor;
      preferences.textColor = theme.textColor;
    }
  }

  function createThemePreset(input: Pick<ReadingThemePreset, "label" | "backgroundColor" | "textColor">) {
    if (themePresets.filter((preset) => !preset.builtIn).length >= MAX_CUSTOM_PRESETS) return null;
    const id = `reader-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
    const preset: ReadingThemePreset = {
      id,
      label: validLabel(input.label, "Untitled preset"),
      backgroundColor: validHex(input.backgroundColor, preferences.backgroundColor),
      textColor: validHex(input.textColor, preferences.textColor),
      builtIn: false
    };
    themePresets.push(preset);
    applyTheme(preset.id);
    return preset;
  }

  function updateThemePreset(id: string, input: Pick<ReadingThemePreset, "label" | "backgroundColor" | "textColor">) {
    const preset = themePresets.find((candidate) => candidate.id === id);
    if (!preset) return false;
    preset.label = validLabel(input.label, preset.label);
    preset.backgroundColor = validHex(input.backgroundColor, preset.backgroundColor);
    preset.textColor = validHex(input.textColor, preset.textColor);
    if (preferences.theme === preset.id) applyTheme(preset.id);
    return true;
  }

  function restoreThemePreset(id: string) {
    const preset = themePresets.find((candidate) => candidate.id === id);
    const original = READING_THEME_PRESETS.find((candidate) => candidate.id === id);
    if (!preset || !original) return false;
    preset.label = original.label;
    preset.backgroundColor = original.backgroundColor;
    preset.textColor = original.textColor;
    if (preferences.theme === preset.id) applyTheme(preset.id);
    return true;
  }

  function removeThemePreset(id: string) {
    const index = themePresets.findIndex((candidate) => candidate.id === id && !candidate.builtIn);
    if (index < 0) return false;
    themePresets.splice(index, 1);
    if (preferences.theme === id) preferences.theme = "custom";
    return true;
  }

  return {
    preferences,
    themePresets: readonly(themePresets),
    contrastRatio,
    fontFamily,
    applyTheme,
    setBackgroundColor,
    setTextColor,
    resetPreferences,
    createThemePreset,
    updateThemePreset,
    restoreThemePreset,
    removeThemePreset,
    maxCustomPresets: MAX_CUSTOM_PRESETS
  };
}

watch(
  preferences,
  (value) => {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  },
  { deep: true }
);

watch(
  themePresets,
  (value) => {
    if (typeof localStorage !== "undefined") localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(value));
  },
  { deep: true }
);
