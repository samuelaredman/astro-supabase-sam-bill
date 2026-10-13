import { describe, expect, it } from "vitest";
import { groupPath, normalizeGroupSlug } from "./groupSlug";

describe("normalizeGroupSlug", () => {
  it("lowercases and trims", () => {
    expect(normalizeGroupSlug("  CreatorCrew ")).toEqual({ ok: true, slug: "creatorcrew" });
  });

  it("accepts a pasted /c/ path", () => {
    expect(normalizeGroupSlug("/c/creator-crew")).toEqual({ ok: true, slug: "creator-crew" });
  });

  it("allows inner hyphens and digits", () => {
    expect(normalizeGroupSlug("gg-2-ez")).toEqual({ ok: true, slug: "gg-2-ez" });
  });

  it.each(["ab", "a".repeat(33), "-abc", "abc-", "has space", "émoji", "under_score"])("rejects %j", (input) => {
    expect(normalizeGroupSlug(input).ok).toBe(false);
  });

  it("allows exactly 3 and 32 characters", () => {
    expect(normalizeGroupSlug("abc").ok).toBe(true);
    expect(normalizeGroupSlug("a".repeat(32)).ok).toBe(true);
  });
});

describe("groupPath", () => {
  it("uses the custom link when set", () => {
    expect(groupPath({ id: "g1", slug: "crew" })).toBe("/c/crew");
  });

  it("falls back to the id", () => {
    expect(groupPath({ id: "g1", slug: null })).toBe("/groups/g1");
    expect(groupPath({ id: "g1" })).toBe("/groups/g1");
  });
});
