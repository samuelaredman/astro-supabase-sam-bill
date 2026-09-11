import { describe, expect, it } from "vitest";
import { avgScore, hubStatsFor, pooled, reviewCount } from "./hubStats";

const ROWS = [
  { game_id: "a", review_count: 3, score_sum: 25 }, // 8.33…
  { game_id: "b", review_count: 1, score_sum: 7 },
  { game_id: "c", review_count: 2, score_sum: 19 }, // not displayed
];

describe("hubStatsFor", () => {
  it("keeps only the displayed games", () => {
    expect(Object.keys(hubStatsFor(ROWS, ["a", "b", "z"])).sort()).toEqual(["a", "b"]);
  });

  it("tolerates a failed RPC", () => {
    expect(hubStatsFor(null, ["a"])).toEqual({});
  });
});

describe("per-game helpers", () => {
  const stats = hubStatsFor(ROWS, ["a", "b"]);

  it("matches averaging the individual scores", () => {
    expect(avgScore(stats, "a")).toBe(([8, 8, 9].reduce((x, y) => x + y) / 3).toFixed(1));
    expect(avgScore(stats, "b")).toBe("7.0");
  });

  it("treats an unreviewed game as no score / zero reviews", () => {
    expect(avgScore(stats, "z")).toBeNull();
    expect(reviewCount(stats, "z")).toBe(0);
    expect(reviewCount(stats, "a")).toBe(3);
  });
});

describe("pooled", () => {
  const stats = hubStatsFor(ROWS, ["a", "b"]);

  it("weights by review count across all displayed games", () => {
    expect(pooled(stats)).toEqual({ count: 4, sum: 32 });
  });

  it("can be limited to a subset, ignoring unreviewed games", () => {
    expect(pooled(stats, ["b", "z"])).toEqual({ count: 1, sum: 7 });
  });
});
