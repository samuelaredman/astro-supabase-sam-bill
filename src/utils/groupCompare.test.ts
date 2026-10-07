import { describe, expect, it } from "vitest";
import {
  agreementLabel,
  agreementPercent,
  buildGenreRadar,
  buildScoreDistribution,
  buildStatCard,
  buildTape,
  filterVersusGames,
  gameDetails,
  normalizeMemberQuery,
  searchVersusMembers,
  parseVersusGameFilter,
  parseVersusGenre,
  parseVersusScope,
  parseVersusGameSearch,
  parseVersusGameLimit,
  parseVersusGameSort,
  sortVersusGames,
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

/** A stand-in PostgREST query that records each call. */
const recorder = () => {
  const calls: string[] = [];
  const q: any = new Proxy({}, {
    get: (_, name: string) => (...args: any[]) => {
      calls.push(`${name}(${args.map((a) => JSON.stringify(a)).join(",")})`);
      return q;
    },
  });
  return { q, calls };
};

describe("games list settings", () => {
  it("falls back to all, biggest gap and one page", () => {
    expect(parseVersusGameFilter("nope")).toBe("all");
    expect(parseVersusGameFilter("theirs")).toBe("theirs");
    expect(parseVersusGameSort(null)).toBe("gap");
    expect(parseVersusGameSort("title")).toBe("title");
    expect(parseVersusGameSort("top")).toBe("top");
    // The old per-side sorts fall back rather than erroring
    expect(parseVersusGameSort("subject-high")).toBe("gap");
  });

  it("takes a genre id and ignores anything else", () => {
    expect(parseVersusGenre("8A1B2C3D-0000-4000-8000-000000000001")).toBe("8a1b2c3d-0000-4000-8000-000000000001");
    expect(parseVersusGenre("rpg")).toBeNull();
    expect(parseVersusGenre(null)).toBeNull();
  });

  it("keeps a title search safe for an ilike pattern", () => {
    expect(parseVersusGameSearch("  elden   ring ")).toBe("elden ring");
    expect(parseVersusGameSearch("100%_*,()")).toBe("100");
    expect(parseVersusGameSearch("   ")).toBeNull();
    expect(parseVersusGameSearch("x".repeat(200))).toHaveLength(80);
  });

  it("rounds the length up to whole pages, within bounds", () => {
    expect(parseVersusGameLimit(null)).toBe(10);
    expect(parseVersusGameLimit("-5")).toBe(10);
    expect(parseVersusGameLimit("11")).toBe(20);
    expect(parseVersusGameLimit("30")).toBe(30);
    expect(parseVersusGameLimit("9999")).toBe(200);
  });
});

describe("filterVersusGames", () => {
  const run = (scope: Parameters<typeof filterVersusGames>[1], filter: Parameters<typeof filterVersusGames>[2] = "all") => {
    const { q, calls } = recorder();
    filterVersusGames(q, scope, filter, 1);
    return calls;
  };

  it("keeps any game either side reviewed for all", () => {
    expect(run("all")).toEqual(['or("subject_score.not.is.null,other_count.gte.1")']);
  });

  it("needs both sides for shared, and splits them on the gap", () => {
    const shared = ['not("subject_score","is",null)', 'gte("other_count",1)'];
    expect(run("shared")).toEqual(shared);
    expect(run("disagree")).toEqual([...shared, 'gt("diff_abs",1)']);
    expect(run("agree")).toEqual([...shared, 'lte("diff_abs",1)']);
  });

  it("keeps one side only for yours and theirs", () => {
    expect(run("all", "yours")).toEqual(['not("subject_score","is",null)', 'lt("other_count",1)']);
    expect(run("all", "theirs")).toEqual(['is("subject_score",null)', 'gte("other_count",1)']);
  });

  it("ignores the list's own filter under a narrower scope", () => {
    expect(run("shared", "yours")).toEqual(run("shared"));
  });
});

describe("parseVersusScope", () => {
  it("reads ?sc=, then an older link's ?gf=, else all", () => {
    expect(parseVersusScope("agree")).toBe("agree");
    expect(parseVersusScope(null, "disagree")).toBe("disagree");
    expect(parseVersusScope(null, "yours")).toBe("all");
    expect(parseVersusScope("nope")).toBe("all");
  });
});

describe("sortVersusGames", () => {
  it("ranks both sides together, taking turns at an equal rating", () => {
    for (const [sort, ascending] of [["top", false], ["low", true]] as const) {
      const { q, calls } = recorder();
      sortVersusGames(q, sort);
      expect(calls.slice(0, 3)).toEqual([
        `order("rated",{"ascending":${ascending},"nullsFirst":false})`,
        'order("turn",{"ascending":true,"nullsFirst":false})',
        'order("rated_side",{"ascending":true,"nullsFirst":false})',
      ]);
      expect(calls.slice(-2)).toEqual(['order("other_count",{"ascending":false,"nullsFirst":false})', 'order("game_id")']);
    }
  });

  it("orders the biggest gaps first by default", () => {
    const { q, calls } = recorder();
    sortVersusGames(q, "gap");
    expect(calls[0]).toBe('order("diff_abs",{"ascending":false,"nullsFirst":false})');
  });
});

describe("member search", () => {
  const ranked = [
    member("s", { username: "billy", reviewCount: 50 }),
    member("a", { username: "samwise", reviewCount: 40 }),
    member("b", { username: "Sam", reviewCount: 10 }),
    member("c", { username: "jessam", reviewCount: 30 }),
    member("d", { username: "zed", reviewCount: 5 }),
  ];

  it("ignores a leading @ and case", () => {
    expect(normalizeMemberQuery("  @@Sam ")).toBe("sam");
    expect(normalizeMemberQuery("@")).toBe("");
  });

  it("finds names containing the query, starts first, never the subject", () => {
    expect(searchVersusMembers(ranked, "s", null, "@sam").map((m) => m.username)).toEqual(["samwise", "Sam", "jessam"]);
    expect(searchVersusMembers(ranked, "s", null, "bil")).toEqual([]);
  });

  it("gives the usual list for an empty query", () => {
    expect(searchVersusMembers(ranked, "s", null, "@ ").map((m) => m.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("gameDetails", () => {
  it("keys each game's rows by side, with nulls kept as nulls", () => {
    const d = gameDetails([
      { game_id: "g", side: "subject", review_count: 1, avg_hours: 40, hours_count: 1, avg_achievement_pct: 0.5, achievement_count: 1, top_platform: "PS5" },
      { game_id: "g", side: "other", review_count: 12, avg_hours: null, hours_count: 0, avg_achievement_pct: null, achievement_count: 0, top_platform: null },
    ]);
    expect(d.get("g")).toEqual({
      subject: { reviewCount: 1, avgHours: 40, hoursCount: 1, achievementPct: 0.5, achievementCount: 1, platform: "PS5" },
      other: { reviewCount: 12, avgHours: null, hoursCount: 0, achievementPct: null, achievementCount: 0, platform: null },
    });
    expect(gameDetails(null).size).toBe(0);
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
    { side: "subject", score: 8, review_count: 3 },
    { side: "other", score: 8, review_count: 7 },
    { side: "other", score: 5, review_count: 4 },
  ];

  it("buckets each side's rows", () => {
    const { left, right } = sideScores(rows);
    expect(left[7]).toBe(3);
    expect(right[7]).toBe(7);
    expect(right[4]).toBe(4);
    expect(left[4]).toBe(0);
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
    expect(d.scale).toBe(80);
    expect([d.leftTotal, d.leftCounts[7], d.rightTotal, d.rightCounts[6]]).toEqual([4, 3, 10, 6]);
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
