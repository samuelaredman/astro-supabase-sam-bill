import { describe, expect, it } from "vitest";
import {
  agreementLabel,
  agreementPercent,
  graderLabel,
  rankMemberIds,
  resolveVersusOpponent,
  resolveVersusSubject,
  signedScore,
  versusOptions,
  type VersusMember,
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
