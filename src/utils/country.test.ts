import { describe, it, expect } from "vitest";
import { countryName } from "./country";

describe("countryName", () => {
  it("resolves IGDB numeric codes", () => {
    expect(countryName("616")).toBe("Poland");
    expect(countryName("840")).toBe("United States");
    expect(countryName("36")).toBe("Australia");
    expect(countryName(826)).toBe("United Kingdom");
  });

  it("accepts alpha-2 codes", () => {
    expect(countryName("se")).toBe("Sweden");
  });

  it("returns null instead of echoing an unknown code", () => {
    expect(countryName("999")).toBeNull();
    expect(countryName("")).toBeNull();
    expect(countryName(null)).toBeNull();
  });
});
