import { describe, expect, it } from "vitest";
import { seriesTitleTokens, sharedLeadingTokens, seriesRelevanceScore } from "./games";

describe("seriesTitleTokens", () => {
  it("normalizes punctuation, case, and diacritics into tokens", () => {
    expect(seriesTitleTokens("Super Smash Bros. Melee")).toEqual(["super", "smash", "bros", "melee"]);
    expect(seriesTitleTokens("Pokémon: Let's Go!")).toEqual(["pokemon", "let", "s", "go"]);
  });

  it("collapses extra whitespace and trims", () => {
    expect(seriesTitleTokens("  The   Witcher  3 ")).toEqual(["the", "witcher", "3"]);
  });
});

describe("sharedLeadingTokens", () => {
  const t = seriesTitleTokens;

  it("counts the common leading prefix", () => {
    expect(sharedLeadingTokens(t("Super Smash Bros. Melee"), t("Super Smash Bros. Brawl"))).toBe(3);
    expect(sharedLeadingTokens(t("The Witcher 3"), t("The Witcher 2"))).toBe(2);
  });

  it("is 0 for loosely-linked crossover titles", () => {
    expect(sharedLeadingTokens(t("Super Smash Bros. Melee"), t("Donkey Kong"))).toBe(0);
  });

  it("stops at the first differing token even if later tokens match", () => {
    expect(sharedLeadingTokens(t("Mario Kart 8"), t("Mario Party 8"))).toBe(1);
  });
});

describe("seriesRelevanceScore", () => {
  const self = seriesTitleTokens("Super Smash Bros. Melee");
  const selfTime = new Date("2001-11-21").getTime();

  it("ranks a same-series title far above a loosely-linked one", () => {
    const smash = seriesRelevanceScore(self, selfTime, "Super Smash Bros. Brawl", "2008-01-31");
    const dk = seriesRelevanceScore(self, selfTime, "Donkey Kong", "1981-07-09");
    expect(smash).toBeGreaterThan(dk);
    expect(smash).toBeGreaterThan(30); // 3 shared tokens * 10
    expect(dk).toBeLessThan(1); // 0 shared tokens, only tiny proximity
  });

  it("uses release-date proximity only to break ties between equal titles", () => {
    // Same shared-token count → closer release date wins.
    const near = seriesRelevanceScore(self, selfTime, "Super Smash Bros. Melee X", "2002-01-01");
    const far = seriesRelevanceScore(self, selfTime, "Super Smash Bros. Melee Y", "2015-01-01");
    expect(near).toBeGreaterThan(far);
    // But the gap is small — proximity never overtakes a shared-token difference.
    expect(near - far).toBeLessThan(1);
  });
});
