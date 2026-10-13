/**
 * The Stats tab's side colours: the left side (you) and the right side (the
 * community or a member), which mark the stat cards, the genre radar and the
 * game face-offs. Viewers can pick a preset or their own pair; the choice is
 * kept in their browser (VERSUS_COLORS_KEY) and applied as --gv-pick-* custom
 * properties on <html>, which the page's .gv-root reads with these defaults
 * as fallbacks.
 *
 * Each preset has a light-theme and a dark-theme shade of each colour, tuned
 * to read on that theme's cards. A custom colour is used as picked in both.
 */

export interface VersusColorPreset {
  id: string;
  label: string;
  light: { l: string; r: string };
  dark: { l: string; r: string };
}

export const VERSUS_COLOR_PRESETS: VersusColorPreset[] = [
  { id: "classic", label: "Purple vs Orange", light: { l: "#6050c8", r: "#d9661c" }, dark: { l: "#7b6cf0", r: "#e0702a" } },
  { id: "blue-red", label: "Blue vs Red", light: { l: "#2563eb", r: "#dc2626" }, dark: { l: "#60a5fa", r: "#f87171" } },
  { id: "blue-orange", label: "Blue vs Orange (colour-blind friendly)", light: { l: "#1d4ed8", r: "#ea580c" }, dark: { l: "#3b82f6", r: "#fb923c" } },
  { id: "teal-pink", label: "Teal vs Pink", light: { l: "#0f766e", r: "#db2777" }, dark: { l: "#2dd4bf", r: "#f472b6" } },
  { id: "green-purple", label: "Green vs Purple", light: { l: "#15803d", r: "#7c3aed" }, dark: { l: "#4ade80", r: "#a78bfa" } },
  { id: "gold-indigo", label: "Gold vs Indigo", light: { l: "#b45309", r: "#4338ca" }, dark: { l: "#fbbf24", r: "#818cf8" } },
];

export const DEFAULT_VERSUS_COLORS = VERSUS_COLOR_PRESETS[0];

/** localStorage key for the viewer's pick. Read before paint by CompareTab's inline script, so keep the shape stable. */
export const VERSUS_COLORS_KEY = "gv-colors";

/**
 * What's stored: the preset's id, or "custom", with the colours to apply.
 * `ld` / `rd` are the dark-theme shades; a custom pick has none and uses
 * `l` / `r` in both themes.
 */
export interface StoredVersusColors {
  preset: string;
  l: string;
  r: string;
  ld?: string;
  rd?: string;
}

const HEX = /^#[0-9a-f]{6}$/i;

export function presetColors(preset: VersusColorPreset): StoredVersusColors {
  return { preset: preset.id, l: preset.light.l, r: preset.light.r, ld: preset.dark.l, rd: preset.dark.r };
}

/** A custom pick, keeping the other side's current colour. */
export function customColors(current: StoredVersusColors, side: "l" | "r", hex: string): StoredVersusColors {
  if (!HEX.test(hex)) return current;
  const l = side === "l" ? hex : current.l;
  const r = side === "r" ? hex : current.r;
  return { preset: "custom", l, r };
}

/** A stored pick, or null when there isn't one or it isn't usable. */
export function parseStoredColors(raw: string | null | undefined): StoredVersusColors | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v.preset !== "string" || !HEX.test(v.l) || !HEX.test(v.r)) return null;
    if (v.ld != null && !HEX.test(v.ld)) return null;
    if (v.rd != null && !HEX.test(v.rd)) return null;
    return { preset: v.preset, l: v.l, r: v.r, ...(v.ld ? { ld: v.ld } : {}), ...(v.rd ? { rd: v.rd } : {}) };
  } catch {
    return null;
  }
}

/** The custom properties to set on <html> for a pick. */
export function colorProperties(c: StoredVersusColors): Record<string, string> {
  return {
    "--gv-pick-l": c.l,
    "--gv-pick-r": c.r,
    "--gv-pick-l-dark": c.ld ?? c.l,
    "--gv-pick-r-dark": c.rd ?? c.r,
  };
}
