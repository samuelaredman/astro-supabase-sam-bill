import { describe, expect, it } from "vitest";
import { formatScore, scoreClass } from "./format";

describe("formatScore", () => {
  it("always shows one decimal", () => {
    expect(formatScore(9)).toBe("9.0");
    expect(formatScore(6.44)).toBe("6.4");
    expect(formatScore(10)).toBe("10.0");
  });

  it("shows a dash when there's no score", () => {
    expect(formatScore(null)).toBe("—");
    expect(formatScore(undefined)).toBe("—");
    expect(formatScore(Number.NaN)).toBe("—");
  });
});

describe("scoreClass", () => {
  it("colours by the exact value, not a rounded one", () => {
    expect(scoreClass(8.6)).toBe("score-teal");
    expect(scoreClass(9)).toBe("score-great");
    expect(scoreClass(6.9)).toBe("score-mid");
  });
});
