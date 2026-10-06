import { describe, expect, it } from "vitest";
import {
  agreementLabel,
  agreementPercent,
  buildGenreRadar,
  buildScoreDistribution,
  buildStatCard,
  buildTape,
  rankMemberIds,
  resolveVersusOpponent,
  resolveVersusSubject,
  scoreBuckets,
  shortGenre,
  sideScores,
  signedScore,
  versusOptions,
  type VersusMember,
  type VersusProfile,
} from "./groupCompare";

const member = (id: string, over: Partial<VersusMember> = {}): VersusMember => ({
  id, username: id, avatar_url: null, isOwner: false, isViewer: false, reviewCount: 0, ...over,
});

describe("rankMemberIds", () => {
  it("puts the most active reviewers first, ties in a stable order", () => {
    expect(rankMemberIds([
      { profile_id: "b", review_count: 3 },
      { profile_id: "a", review_count: 3 },
      { profile_id: "c", review_count: 9 },
    ])).toEqual(["c", "a", "b"]);
  });
});

describe("resolveVersusSubject", () => {
  const base = { memberIds: ["owner", "me", "busy"], rankedMemberIds: ["busy", "owner"] };

  it("is the viewer when they're a member", () => {
    expect(resolveVersusSubject({ ...base, viewerProfileId: "me", ownerProfileId: "owner" })).toBe("me");
  });

  it("falls back to the owner for a visitor", () => {
    expect(resolveVersusSubject({ ...base, viewerProfileId: "stranger", ownerProfileId: "owner" })).toBe("owner");
  });

  it("falls back to the most active reviewer with no owner (the site group)", () => {
    expect(resolveVersusSubject({ ...base, viewerProfileId: null, ownerProfileId: null })).toBe("busy");
  });

  it("is null for an empty group", () => {
    expect(resolveVersusSubject({ memberIds: [], rankedMemberIds: [] })).toBeNull();
  });
});

describe("resolveVersusOpponent", () => {
  const ids = ["me", "creator"];

  it("accepts a current member", () => {
    expect(resolveVersusOpponent("creator", ids, "me")).toBe("creator");
  });

  it("is the community for nothing, a stranger, or the subject themselves", () => {
    expect(resolveVersusOpponent(null, ids, "me")).toBeNull();
    expect(resolveVersusOpponent("", ids, "me")).toBeNull();
    expect(resolveVersusOpponent("someone-else", ids, "me")).toBeNull();
    expect(resolveVersusOpponent("me", ids, "me")).toBeNull();
  });
});

describe("versusOptions", () => {
  const ranked = [
    member("busy", { reviewCount: 50 }),
    member("me", { isViewer: true, reviewCount: 10 }),
    member("quiet", { reviewCount: 1 }),
    member("owner", { isOwner: true, reviewCount: 0 }),
  ];

  it("leaves out the subject and puts the owner first", () => {
    expect(versusOptions(ranked, "me", null).map((m) => m.id)).toEqual(["owner", "busy", "quiet"]);
  });

  it("keeps the current pick even past the cap", () => {
    expect(versusOptions(ranked, "me", "quiet", 2).map((m) => m.id)).toEqual(["owner", "quiet"]);
  });
});

describe("agreementPercent", () => {
  it("rounds the share within a point", () => {
    expect(agreementPercent(2, 3)).toBe(67);
  });

  it("is zero with nothing shared", () => {
    expect(agreementPercent(0, 0)).toBe(0);
  });
});

describe("agreementLabel", () => {
  it.each([
    [0.2, "Near-identical taste"],
    [0.8, "Mostly agree"],
    [1.5, "Broadly agree"],
    [2.5, "Often disagree"],
    [4, "Opposite taste"],
  ])("describes a %s gap as %s", (gap, label) => {
    expect(agreementLabel(gap)).toBe(label);
  });
});

describe("signedScore", () => {
  it("signs and rounds to one decimal", () => {
    expect(signedScore(1.46)).toBe("+1.5");
    expect(signedScore(-0.44)).toBe("−0.4");
    expect(signedScore(0.04)).toBe("0.0");
  });
});

const profile = (over: Partial<VersusProfile> = {}): VersusProfile => ({
  reviewCount: 20, gamesPlayed: 20, avgScore: 7.45, topGenre: "RPG", topGenreCount: 8,
  avgHours: 41.6, tens: 4, avgAchievementPct: 0.634, achievementGames: 12, ...over,
});

describe("buildStatCard", () => {
  const side = (rows: ReturnType<typeof buildStatCard>, key: string) => rows.find((r) => r.key === key)!;

  it("gives both sides the same rows, in order", () => {
    const rows = buildStatCard(profile(), profile({ gamesPlayed: 1203, reviewCount: 1400 }));
    expect(rows.map((r) => r.key)).toEqual(["games", "rating", "achievements", "hours", "tens"]);
    expect(side(rows, "games")).toMatchObject({ left: { value: "20" }, right: { value: "1,203" } });
  });

  it("formats each stat", () => {
    const rows = buildStatCard(profile(), profile());
    expect(side(rows, "rating")).toMatchObject({ score: true, left: { value: "7.5", sub: "20 reviews" } });
    expect(side(rows, "achievements").left).toEqual({ value: "63%", sub: "across 12 games" });
    expect(side(rows, "hours").left).toEqual({ value: "42h" });
    expect(side(rows, "tens").left).toEqual({ value: "4", sub: "20% of reviews" });
  });

  it("shows a dash where a side has no data", () => {
    const rows = buildStatCard(profile({ avgScore: null, avgHours: null, avgAchievementPct: null, achievementGames: 0 }), profile());
    expect(side(rows, "rating").left).toEqual({ value: "—" });
    expect(side(rows, "achievements").left).toEqual({ value: "—", sub: "None synced" });
    expect(side(rows, "hours").left).toEqual({ value: "—" });
  });
});

describe("buildTape", () => {
  const names = { subject: "You", other: "@sam" };
  const tile = (tiles: ReturnType<typeof buildTape>, key: string) => tiles.find((t) => t.key === key)!;

  it("is empty when either side has no reviews", () => {
    expect(buildTape(profile(), profile({ reviewCount: 0 }), names)).toEqual([]);
  });

  it("merges a shared favourite and keeps different ones apart", () => {
    expect(tile(buildTape(profile(), profile(), names), "genre"))
      .toMatchObject({ kind: "pick", same: true, left: { value: "RPG", sub: "40%" } });
    expect(tile(buildTape(profile(), profile({ topGenre: "Shooter" }), names), "genre"))
      .toMatchObject({ kind: "pick", same: false, right: { value: "Shooter" } });
  });
});

describe("shortGenre", () => {
  it.each([
    ["Role-playing (RPG)", "RPG"],
    ["Real Time Strategy (RTS)", "RTS"],
    ["Hack and slash/Beat 'em up", "Hack and slash"],
    ["Point-and-click", "Point-and-click"],
    ["Indie", "Indie"],
  ])("shortens %s to %s", (name, short) => {
    expect(shortGenre(name)).toBe(short);
  });
});

describe("buildGenreRadar", () => {
  const g = (genre: string, reviewCount: number) => ({ genre, reviewCount });

  it("plots each side as a share of its own reviews, strongest genres first", () => {
    const radar = buildGenreRadar(
      [g("RPG", 8), g("Indie", 4), g("Shooter", 2)],
      [g("Indie", 50), g("Platform", 30), g("RPG", 10)],
      20, 100,
    )!;
    expect(radar.axes).toEqual([
      { genre: "Indie", left: 20, right: 50 },
      { genre: "RPG", left: 40, right: 10 },
      { genre: "Platform", left: 0, right: 30 },
      { genre: "Shooter", left: 10, right: 0 },
    ]);
    expect(radar.scale).toBe(50);
  });

  it("caps the spokes", () => {
    const many = ["A", "B", "C", "D", "E", "F", "G", "H"].map((x, i) => g(x, 10 - i));
    expect(buildGenreRadar(many, many, 50, 50)!.axes).toHaveLength(6);
  });

  it("is null with too few genres for a shape, or no reviews", () => {
    expect(buildGenreRadar([g("RPG", 3)], [g("Indie", 2)], 5, 5)).toBeNull();
    expect(buildGenreRadar([g("A", 1), g("B", 1), g("C", 1)], [], 3, 0)).toBeNull();
  });

  it("replaces the favourite-genre tile when it can be drawn", () => {
    const genres = { left: [g("RPG", 8), g("Indie", 4), g("Shooter", 2)], right: [g("RPG", 5)] };
    const keys = buildTape(profile(), profile(), { subject: "You", other: "@sam" }, genres).map((t) => t.key);
    expect(keys).toContain("genres");
    expect(keys).not.toContain("genre");
    const fallback = buildTape(profile(), profile(), { subject: "You", other: "@sam" }).map((t) => t.key);
    expect(fallback).toContain("genre");
  });
});

describe("scoreBuckets", () => {
  it("fills ten slots and ignores anything off the scale", () => {
    expect(scoreBuckets([{ score: 1, review_count: 2 }, { score: 10, review_count: 5 }, { score: 11, review_count: 9 }]))
      .toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0, 5]);
  });
});

describe("sideScores", () => {
  const rows = [
    { profile_id: null, score: 8, review_count: 10 },
    { profile_id: null, score: 5, review_count: 4 },
    { profile_id: "me", score: 8, review_count: 3 },
    { profile_id: "sam", score: 5, review_count: 2 },
  ];

  it("takes the subject out of the group for the community", () => {
    const { left, right } = sideScores(rows, "me", null);
    expect(left[7]).toBe(3);
    expect(right[7]).toBe(7);
    expect(right[4]).toBe(4);
  });

  it("uses the member's own rows against a member", () => {
    expect(sideScores(rows, "me", "sam").right[4]).toBe(2);
  });
});

describe("buildScoreDistribution", () => {
  const b = (counts: Record<number, number>) => Array.from({ length: 10 }, (_, i) => counts[i + 1] ?? 0);
  const names = { subject: "You", other: "The community" };

  it("turns counts into shares with averages and most-given scores", () => {
    const d = buildScoreDistribution(b({ 8: 3, 9: 1 }), b({ 6: 2, 7: 6, 8: 2 }), names)!;
    expect(d.left[7]).toBe(75);
    expect(d.leftAvg).toBe(8.3);
    expect(d.rightAvg).toBe(7);
    expect([d.leftMode, d.rightMode]).toEqual([8, 7]);
    expect(d.peak).toBe(75);
    expect(d.headline).toBe("Your most common score is 8; the community's is 7");
  });

  it("says when both sides give the same score most", () => {
    expect(buildScoreDistribution(b({ 8: 4 }), b({ 8: 9, 6: 1 }), names)!.headline).toBe("You both give 8 most often");
    expect(buildScoreDistribution(b({ 8: 4 }), b({ 8: 9 }), { subject: "@a", other: "@b" })!.headline)
      .toBe("@a and @b both give 8 most often");
  });

  it("needs a few reviews on each side", () => {
    expect(buildScoreDistribution(b({ 8: 2 }), b({ 7: 9 }), names)).toBeNull();
  });
});
