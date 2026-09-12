import { describe, expect, it } from "vitest";
import {
  COMPARE_MAX_MEMBERS,
  agreementLabel,
  agreementPercent,
  barPercent,
  comparePickerList,
  defaultCompareSelection,
  defaultCompareSort,
  distributionBuckets,
  parseCompareMode,
  parseCompareSelection,
  parseCompareSort,
  resolveCompareSelection,
  spreadLabel,
} from "./groupCompare";

describe("parseCompareSelection", () => {
  const members = ["a", "b", "c", "d", "e"];

  it("keeps the order the ids were given in", () => {
    expect(parseCompareSelection("c,a,b", members)).toEqual(["c", "a", "b"]);
  });

  it("drops ids that aren't members", () => {
    expect(parseCompareSelection("a,stranger,b", members)).toEqual(["a", "b"]);
  });

  it("drops duplicates", () => {
    expect(parseCompareSelection("a,a,b", members)).toEqual(["a", "b"]);
  });

  it("caps the set", () => {
    expect(parseCompareSelection("a,b,c,d,e", members)).toHaveLength(COMPARE_MAX_MEMBERS);
  });

  it("tolerates whitespace and empty entries", () => {
    expect(parseCompareSelection(" a , , b ", members)).toEqual(["a", "b"]);
  });

  it("returns nothing for missing input", () => {
    expect(parseCompareSelection(null, members)).toEqual([]);
    expect(parseCompareSelection(undefined, members)).toEqual([]);
    expect(parseCompareSelection("", members)).toEqual([]);
  });
});

describe("defaultCompareSelection", () => {
  const rankedMemberIds = ["top", "second", "third"];

  it("compares the viewer with the group's owner", () => {
    expect(defaultCompareSelection({
      rankedMemberIds: ["top", "second", "viewer", "owner"],
      viewerProfileId: "viewer",
      ownerProfileId: "owner",
    })).toEqual(["viewer", "owner"]);
  });

  it("falls back to the two most active reviewers for a visitor", () => {
    expect(defaultCompareSelection({ rankedMemberIds })).toEqual(["top", "second"]);
  });

  it("tops up from the ranking when the viewer is also the owner", () => {
    expect(defaultCompareSelection({
      rankedMemberIds: ["owner", "second"],
      viewerProfileId: "owner",
      ownerProfileId: "owner",
    })).toEqual(["owner", "second"]);
  });

  it("ignores a viewer or owner who hasn't reviewed anything", () => {
    expect(defaultCompareSelection({
      rankedMemberIds,
      viewerProfileId: "lurker",
      ownerProfileId: "third",
    })).toEqual(["third", "top"]);
  });

  it("copes with a group where only one member has reviewed", () => {
    expect(defaultCompareSelection({ rankedMemberIds: ["only"] })).toEqual(["only"]);
    expect(defaultCompareSelection({ rankedMemberIds: [] })).toEqual([]);
  });
});

describe("parseCompareSort", () => {
  it("keeps a known sort", () => {
    expect(parseCompareSort("popular", 2)).toBe("popular");
    expect(parseCompareSort("lowest", 1)).toBe("lowest");
  });

  it("falls back by pick count for anything else", () => {
    expect(parseCompareSort("nonsense", 2)).toBe("disagreement");
    expect(parseCompareSort(undefined, 1)).toBe("vs_group");
    expect(parseCompareSort(null, 0)).toBe("vs_group");
  });

  it("sorts one pick by distance from the group, since it can't disagree with itself", () => {
    expect(defaultCompareSort(1)).toBe("vs_group");
    expect(defaultCompareSort(2)).toBe("disagreement");
  });
});

describe("parseCompareMode", () => {
  it("only accepts all", () => {
    expect(parseCompareMode("all")).toBe("all");
    expect(parseCompareMode("any")).toBe("any");
    expect(parseCompareMode("everything")).toBe("any");
    expect(parseCompareMode(undefined)).toBe("any");
  });
});

describe("distributionBuckets", () => {
  it("puts each score in its slot, 1 first", () => {
    const buckets = distributionBuckets([
      { score: 1, review_count: 2 },
      { score: 7, review_count: 5 },
      { score: 10, review_count: 3 },
    ]);
    expect(buckets).toEqual([2, 0, 0, 0, 0, 0, 5, 0, 0, 3]);
  });

  it("sums repeated scores and ignores out-of-range ones", () => {
    expect(distributionBuckets([
      { score: 5, review_count: 1 },
      { score: 5, review_count: 2 },
      { score: 0, review_count: 9 },
      { score: 11, review_count: 9 },
    ])).toEqual([0, 0, 0, 0, 3, 0, 0, 0, 0, 0]);
  });

  it("is all zeroes for no reviews", () => {
    expect(distributionBuckets([])).toEqual(new Array(10).fill(0));
  });
});

describe("barPercent", () => {
  it("fills the bar in proportion to the score", () => {
    expect(barPercent(10)).toBe(100);
    expect(barPercent(5)).toBe(50);
    expect(barPercent(7.8)).toBeCloseTo(78);
  });

  it("leaves a visible sliver for the lowest score", () => {
    expect(barPercent(1)).toBe(10);
  });

  it("clamps anything off the scale", () => {
    expect(barPercent(-2)).toBe(0);
    expect(barPercent(12)).toBe(100);
  });
});

describe("comparePickerList", () => {
  const member = (id: string, extra: Partial<{ isOwner: boolean; isViewer: boolean }> = {}) =>
    ({ id, isOwner: false, isViewer: false, ...extra });

  it("keeps the ranking when everyone fits", () => {
    const ranked = [member("a"), member("b"), member("c")];
    expect(comparePickerList(ranked, [], 10).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("caps the list at max", () => {
    const ranked = ["a", "b", "c", "d"].map((id) => member(id));
    expect(comparePickerList(ranked, [], 2).map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("keeps the viewer and the owner however little they have reviewed", () => {
    const ranked = [
      member("top"), member("second"),
      member("owner", { isOwner: true }), member("me", { isViewer: true }),
    ];
    expect(comparePickerList(ranked, [], 3).map((m) => m.id)).toEqual(["owner", "me", "top"]);
  });

  it("keeps a picked member who is far down the ranking", () => {
    const ranked = ["a", "b", "c", "deep"].map((id) => member(id));
    expect(comparePickerList(ranked, ["deep"], 2).map((m) => m.id)).toEqual(["deep", "a"]);
  });

  it("does not repeat a pick who already ranks highly", () => {
    const ranked = ["a", "b"].map((id) => member(id));
    expect(comparePickerList(ranked, ["a"], 10).map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("agreementPercent", () => {
  it("is the share of shared games within a point", () => {
    expect(agreementPercent(7, 10)).toBe(70);
    expect(agreementPercent(1, 3)).toBe(33);
  });

  it("is zero with no shared games", () => {
    expect(agreementPercent(0, 0)).toBe(0);
  });
});

describe("agreementLabel", () => {
  it("describes the gap between two members", () => {
    expect(agreementLabel(0.2)).toBe("Near-identical taste");
    expect(agreementLabel(0.7)).toBe("Mostly agree");
    expect(agreementLabel(1.5)).toBe("Broadly agree");
    expect(agreementLabel(2.4)).toBe("Often disagree");
    expect(agreementLabel(4)).toBe("Opposite taste");
  });
});

describe("spreadLabel", () => {
  it("labels the spread across the picked members", () => {
    expect(spreadLabel(0).label).toBe("Consensus");
    expect(spreadLabel(2).label).toBe("Consensus");
    expect(spreadLabel(3).label).toBe("Mixed");
    expect(spreadLabel(5).label).toBe("Divisive");
  });
});

describe("resolveCompareSelection", () => {
  const opts = {
    memberIds: ["me", "owner", "top"],
    memberStats: [
      { profile_id: "top", review_count: 40 },
      { profile_id: "owner", review_count: 12 },
      { profile_id: "me", review_count: 3 },
    ],
    viewerProfileId: "me",
    ownerProfileId: "owner",
  };

  it("defaults to the viewer against the owner when ?with= is absent", () => {
    expect(resolveCompareSelection(new URLSearchParams(), opts)).toEqual(["me", "owner"]);
  });

  it("takes an explicit ?with= over the default", () => {
    expect(resolveCompareSelection(new URLSearchParams("with=top,me"), opts)).toEqual(["top", "me"]);
  });

  it("treats an empty ?with= as comparing nobody", () => {
    expect(resolveCompareSelection(new URLSearchParams("with="), opts)).toEqual([]);
  });

  it("drops an id that is no longer a member", () => {
    expect(resolveCompareSelection(new URLSearchParams("with=top,departed"), opts)).toEqual(["top"]);
  });

  it("falls back to the most active reviewers for a logged-out visitor", () => {
    expect(resolveCompareSelection(new URLSearchParams(), { ...opts, viewerProfileId: null }))
      .toEqual(["owner", "top"]);
  });
});
