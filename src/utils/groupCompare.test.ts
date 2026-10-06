import { describe, expect, it } from "vitest";
import {
  agreementLabel,
  agreementPercent,
  barHeadline,
  buildGenreRadar,
  buildTape,
  decadeLabel,
  graderLabel,
  rankMemberIds,
  resolveVersusOpponent,
  resolveVersusSubject,
  ratioLabel,
  shortGenre,
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

describe("graderLabel", () => {
  it("speaks to the viewer", () => {
    expect(graderLabel("You", "the community", 8, 7)).toBe("You score more generously than the community");
  });

  it("names a member", () => {
    expect(graderLabel("@creator", "@sam", 6, 7.5)).toBe("@creator scores tougher than @sam");
  });

  it("calls a small gap the same", () => {
    expect(graderLabel("You", "@sam", 7.1, 7)).toBe("You and @sam score about the same");
  });

  it("says nothing without both averages", () => {
    expect(graderLabel("You", "@sam", null, 7)).toBeNull();
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
  reviewCount: 20, topGenre: "RPG", topGenreCount: 8, topPlatform: "PS5", topPlatformCount: 10,
  topStudio: "FromSoftware", topStudioCount: 3, avgReleaseYear: 2014.4, avgHours: 42, hoursSum: 840,
  tens: 4, hotTakes: 3, hotTakeBase: 12, avgWords: 180, ...over,
});

describe("decadeLabel", () => {
  it("rounds the average year into its decade", () => {
    expect(decadeLabel(2014.4)).toBe("2010s");
    expect(decadeLabel(1999.6)).toBe("2000s");
    expect(decadeLabel(null)).toBeNull();
  });
});

describe("ratioLabel", () => {
  it("keeps one decimal for small ratios and drops it for big ones", () => {
    expect(ratioLabel(1.84)).toBe("1.8×");
    expect(ratioLabel(2)).toBe("2.0×");
    expect(ratioLabel(3.4)).toBe("3×");
  });
});

describe("barHeadline", () => {
  const you = { subject: "You", other: "The community" };
  const verb = { you: "play", they: "plays", more: "longer per game" };

  it("names whoever has more, with how many times more", () => {
    expect(barHeadline(60, 30, you, verb, "Same")).toBe("You play 2.0× longer per game");
    expect(barHeadline(10, 40, you, verb, "Same")).toBe("The community plays 4× longer per game");
  });

  it("calls anything within 15% the same", () => {
    expect(barHeadline(50, 46, you, verb, "Same pace")).toBe("Same pace");
  });

  it("says only, mid-sentence, when one side has none", () => {
    const tens = { you: "hand out 10s", they: "hands out 10s", more: "as often" };
    expect(barHeadline(12, 0, you, tens, "Same")).toBe("Only you hand out 10s");
    expect(barHeadline(0, 12, you, tens, "Same")).toBe("Only the community hands out 10s");
    expect(barHeadline(0, 0, you, tens, "No 10s")).toBe("No 10s");
  });
});

describe("buildTape", () => {
  const names = { subject: "You", other: "@sam" };
  const tile = (tiles: ReturnType<typeof buildTape>, key: string) => tiles.find((t) => t.key === key)!;

  it("is empty when either side has no reviews", () => {
    expect(buildTape(profile(), profile({ reviewCount: 0 }), names)).toEqual([]);
  });

  it("merges a shared favourite and keeps different ones apart", () => {
    const tiles = buildTape(profile(), profile({ topPlatform: "PC" }), names);
    expect(tile(tiles, "genre")).toMatchObject({ kind: "pick", same: true, left: { value: "RPG", sub: "40%" } });
    expect(tile(tiles, "platform")).toMatchObject({ kind: "pick", same: false, right: { value: "PC" } });
  });

  it("splits a bar by share, with a headline", () => {
    const t = tile(buildTape(profile({ avgHours: 75 }), profile({ avgHours: 25 }), names), "hours");
    expect(t).toMatchObject({ kind: "bar", leftShare: 75, left: { value: "75h" }, right: { value: "25h" } });
    expect(t.kind === "bar" && t.headline).toBe("You play 3× longer per game");
  });

  it("places both sides on the era timeline", () => {
    const t = tile(buildTape(profile({ avgReleaseYear: 2020 }), profile({ avgReleaseYear: 2000 }), names, 2026), "era");
    expect(t).toMatchObject({ kind: "era", from: 1980, to: 2026, headline: "You play 20 years newer" });
    if (t.kind === "era") expect(Math.round(t.left!.pos)).toBe(87);
  });

  it("leaves out a bar that only one side has data for", () => {
    const tiles = buildTape(profile({ hotTakeBase: 0 }), profile({ avgHours: null }), names);
    expect(tiles.map((t) => t.key)).not.toContain("takes");
    expect(tiles.map((t) => t.key)).not.toContain("hours");
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
    const keys = buildTape(profile(), profile(), { subject: "You", other: "@sam" }, 2026, genres).map((t) => t.key);
    expect(keys).toContain("genres");
    expect(keys).not.toContain("genre");
    const fallback = buildTape(profile(), profile(), { subject: "You", other: "@sam" }, 2026).map((t) => t.key);
    expect(fallback).toContain("genre");
  });
});
