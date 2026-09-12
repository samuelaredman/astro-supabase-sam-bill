import { describe, expect, it } from "vitest";
import {
  parseFeedFilter,
  parseFeedOffset,
  scoreComparison,
  siteDay,
  votePercents,
} from "./groupFeed";

describe("parseFeedFilter", () => {
  it("keeps a known filter for a signed-in viewer", () => {
    expect(parseFeedFilter("disagree", true)).toBe("disagree");
    expect(parseFeedFilter("unplayed", true)).toBe("unplayed");
    expect(parseFeedFilter("all", true)).toBe("all");
  });

  it("falls back to everything for anything unknown", () => {
    expect(parseFeedFilter("nonsense", true)).toBe("all");
    expect(parseFeedFilter(undefined, true)).toBe("all");
    expect(parseFeedFilter(null, true)).toBe("all");
  });

  it("forces everything for a logged-out visitor, as group_feed does", () => {
    // Both viewer-relative filters compare against the viewer's own reviews, so
    // without a viewer they would quietly return the whole feed anyway — the
    // highlighted filter must not claim otherwise.
    expect(parseFeedFilter("disagree", false)).toBe("all");
    expect(parseFeedFilter("unplayed", false)).toBe("all");
  });
});

describe("parseFeedOffset", () => {
  it("takes a whole positive offset", () => {
    expect(parseFeedOffset("20")).toBe(20);
    expect(parseFeedOffset(40)).toBe(40);
  });

  it("treats anything else as the first page", () => {
    expect(parseFeedOffset("-10")).toBe(0);
    expect(parseFeedOffset("1.5")).toBe(0);
    expect(parseFeedOffset("many")).toBe(0);
    expect(parseFeedOffset(undefined)).toBe(0);
    expect(parseFeedOffset(Infinity)).toBe(0);
  });
});

describe("siteDay", () => {
  it("formats the Los Angeles day as YYYY-MM-DD", () => {
    expect(siteDay(new Date("2026-09-12T18:00:00Z"))).toBe("2026-09-12");
  });

  it("is still yesterday just after UTC midnight", () => {
    // 00:30 UTC on the 13th is 17:30 on the 12th in Los Angeles
    expect(siteDay(new Date("2026-09-13T00:30:00Z"))).toBe("2026-09-12");
  });

  it("rolls over at Los Angeles midnight, not UTC's", () => {
    expect(siteDay(new Date("2026-09-13T06:59:00Z"))).toBe("2026-09-12");
    expect(siteDay(new Date("2026-09-13T07:01:00Z"))).toBe("2026-09-13");
  });
});

describe("votePercents", () => {
  it("splits the vote", () => {
    expect(votePercents(3, 1)).toEqual({ high: 75, low: 25 });
  });

  it("always totals 100, even when rounding fights back", () => {
    const { high, low } = votePercents(1, 2);
    expect(high + low).toBe(100);
    expect(high).toBe(33);
  });

  it("is zero for both sides before anyone votes", () => {
    expect(votePercents(0, 0)).toEqual({ high: 0, low: 0 });
  });
});

describe("scoreComparison", () => {
  it("says nothing when the viewer hasn't played it", () => {
    expect(scoreComparison(undefined, 8)).toBeNull();
  });

  it("calls an identical score agreement", () => {
    expect(scoreComparison(8, 8)).toEqual({ gap: 0, verdict: "agree" });
  });

  it("calls a gap under three close", () => {
    expect(scoreComparison(8, 6)).toEqual({ gap: 2, verdict: "close" });
  });

  it("calls a gap of three or more a disagreement, whichever way round", () => {
    expect(scoreComparison(9, 3)).toEqual({ gap: 6, verdict: "disagree" });
    expect(scoreComparison(3, 9)).toEqual({ gap: 6, verdict: "disagree" });
  });

  it("counts a score of zero as a real score, not a missing one", () => {
    expect(scoreComparison(0, 5)).toEqual({ gap: 5, verdict: "disagree" });
  });
});
