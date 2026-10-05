import { describe, expect, it } from "vitest";
import { groupGradient, groupHue } from "./groupTheme";

describe("groupHue", () => {
  it("is stable for the same id", () => {
    const id = "5b0c6f0e-2d1a-4c55-9a3e-8f1b2c3d4e5f";
    expect(groupHue(id)).toBe(groupHue(id));
  });

  it("stays within 0–359", () => {
    for (const id of ["a", "zzzz", "00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff"]) {
      const hue = groupHue(id);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it("spreads different ids across hues", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `group-${i}`);
    expect(new Set(ids.map(groupHue)).size).toBeGreaterThan(15);
  });
});

describe("groupGradient", () => {
  it("builds a gradient from the group's hue", () => {
    const id = "group-1";
    expect(groupGradient(id)).toContain(`hsl(${groupHue(id)} `);
  });
});
