import { describe, expect, it } from "vitest";
import {
  colorProperties,
  customColors,
  DEFAULT_VERSUS_COLORS,
  parseStoredColors,
  presetColors,
  VERSUS_COLOR_PRESETS,
} from "./versusColors";

describe("versus colour presets", () => {
  it("has unique ids and six-digit colours for both themes", () => {
    expect(new Set(VERSUS_COLOR_PRESETS.map((p) => p.id)).size).toBe(VERSUS_COLOR_PRESETS.length);
    for (const p of VERSUS_COLOR_PRESETS) {
      for (const hex of [p.light.l, p.light.r, p.dark.l, p.dark.r]) expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("defaults to purple vs orange", () => {
    expect(DEFAULT_VERSUS_COLORS.id).toBe("classic");
  });
});

describe("customColors", () => {
  it("changes one side and drops the dark shades", () => {
    const blueRed = presetColors(VERSUS_COLOR_PRESETS.find((p) => p.id === "blue-red")!);
    expect(customColors(blueRed, "l", "#112233")).toEqual({ preset: "custom", l: "#112233", r: "#dc2626" });
  });

  it("ignores anything that isn't a hex colour", () => {
    const c = presetColors(DEFAULT_VERSUS_COLORS);
    expect(customColors(c, "r", "red")).toBe(c);
  });
});

describe("parseStoredColors", () => {
  it("reads back what was stored", () => {
    const c = presetColors(DEFAULT_VERSUS_COLORS);
    expect(parseStoredColors(JSON.stringify(c))).toEqual(c);
  });

  it("rejects junk", () => {
    expect(parseStoredColors(null)).toBeNull();
    expect(parseStoredColors("{")).toBeNull();
    expect(parseStoredColors(JSON.stringify({ preset: "x", l: "url(evil)", r: "#000000" }))).toBeNull();
  });
});

describe("colorProperties", () => {
  it("falls back to the light colours in dark when a pick has no dark shades", () => {
    expect(colorProperties({ preset: "custom", l: "#111111", r: "#222222" })).toEqual({
      "--gv-pick-l": "#111111", "--gv-pick-r": "#222222",
      "--gv-pick-l-dark": "#111111", "--gv-pick-r-dark": "#222222",
    });
  });
});
