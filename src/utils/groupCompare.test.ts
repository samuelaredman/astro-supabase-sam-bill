import { describe, expect, it } from "vitest";
import {
  agreementLabel,
  agreementPercent,
  buildTape,
  decadeLabel,
  graderLabel,
  rankMemberIds,
  resolveVersusOpponent,
  resolveVersusSubject,
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

describe("buildTape", () => {
  const row = (rows: ReturnType<typeof buildTape>, key: string) => rows.find((r) => r.key === key)!;

  it("is empty when either side has no reviews", () => {
    expect(buildTape(profile(), profile({ reviewCount: 0 }))).toEqual([]);
  });

  it("marks a shared favourite as the same", () => {
    const rows = buildTape(profile(), profile({ topPlatform: "PC" }));
    expect(row(rows, "genre").lead).toBe("same");
    expect(row(rows, "platform").lead).toBeNull();
    expect(row(rows, "genre").left).toEqual({ value: "RPG", sub: "40% of reviews" });
  });

  it("leads with the bigger number, and not on a tie", () => {
    const rows = buildTape(profile({ avgHours: 80 }), profile({ avgHours: 20, tens: 4 }));
    expect(row(rows, "hours").lead).toBe("left");
    expect(row(rows, "hours").left.value).toBe("80h");
    expect(row(rows, "tens").lead).toBeNull();
  });

  it("works out the hot take rate from the games others reviewed", () => {
    const rows = buildTape(profile({ hotTakes: 3, hotTakeBase: 12 }), profile({ hotTakes: 0, hotTakeBase: 0 }));
    expect(row(rows, "takes").left.value).toBe("25%");
    expect(row(rows, "takes").right.value).toBe("—");
    expect(row(rows, "takes").lead).toBeNull();
  });

  it("drops a row neither side has data for", () => {
    const none = { topStudio: null, avgHours: null };
    const rows = buildTape(profile(none), profile(none));
    expect(rows.map((r) => r.key)).not.toContain("studio");
    expect(rows.map((r) => r.key)).not.toContain("hours");
  });
});
