import { describe, expect, it } from "vitest";
import { formatScore, isPreRelease, scoreClass } from "./format";

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

describe("isPreRelease", () => {
  it("is true when the review predates the release date", () => {
    expect(isPreRelease("2027-11-01", "2026-11-07T12:00:00Z", null)).toBe(true);
  });

  it("is false on or after release day", () => {
    expect(isPreRelease("2026-11-07", "2026-11-07T12:00:00Z", null)).toBe(false);
    expect(isPreRelease("2026-11-07", "2026-11-08T00:00:00Z", null)).toBe(false);
  });

  it("falls back to created_at when published_at is missing", () => {
    expect(isPreRelease("2027-01-01", null, "2026-06-01T00:00:00Z")).toBe(true);
  });

  it("is false when the release date is unknown", () => {
    expect(isPreRelease(null, "2026-11-07T12:00:00Z", null)).toBe(false);
    expect(isPreRelease(undefined, "2026-11-07T12:00:00Z", null)).toBe(false);
  });

  it("is false when there is no review timestamp", () => {
    expect(isPreRelease("2027-01-01", null, null)).toBe(false);
  });
});
