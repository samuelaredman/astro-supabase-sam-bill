import { describe, expect, it } from "vitest";
import {
  GAME_CATEGORIES,
  COLLAPSE_CATEGORIES,
  CONNECTED_CATEGORIES,
  HIDDEN_CATEGORIES,
  classifyGameType,
  isReviewableNode,
  isBrowseGridNode,
  isAllowedGameCategory,
} from "./games";

describe("canonical-node classification sets", () => {
  it("partitions every IGDB game_type exactly once", () => {
    const all = [
      ...COLLAPSE_CATEGORIES,
      ...CONNECTED_CATEGORIES,
      ...HIDDEN_CATEGORIES,
    ].sort((a, b) => a - b);
    const every = Object.keys(GAME_CATEGORIES).map(Number).sort((a, b) => a - b);
    // No overlaps, no gaps — every category 0..14 lands in exactly one set.
    expect(all).toEqual(every);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("classifyGameType", () => {
  it("collapses ports, remasters, bundles, and packs", () => {
    expect(classifyGameType(11)).toBe("collapse"); // port
    expect(classifyGameType(9)).toBe("collapse");  // remaster
    expect(classifyGameType(3)).toBe("collapse");  // bundle
    expect(classifyGameType(13)).toBe("collapse"); // pack
  });

  it("keeps main games, remakes, expansions, and dlc as connected nodes", () => {
    expect(classifyGameType(0)).toBe("connected"); // main_game
    expect(classifyGameType(8)).toBe("connected"); // remake
    expect(classifyGameType(2)).toBe("connected"); // expansion
    expect(classifyGameType(4)).toBe("connected"); // standalone_expansion
    expect(classifyGameType(10)).toBe("connected"); // expanded_game
    expect(classifyGameType(1)).toBe("connected"); // dlc_addon
  });

  it("hides mods, episodes, seasons, forks, and updates", () => {
    expect(classifyGameType(5)).toBe("hidden");  // mod
    expect(classifyGameType(6)).toBe("hidden");  // episode
    expect(classifyGameType(7)).toBe("hidden");  // season
    expect(classifyGameType(12)).toBe("hidden"); // fork
    expect(classifyGameType(14)).toBe("hidden"); // update
  });

  it("treats a null/undefined category as a reviewable (connected) node", () => {
    expect(classifyGameType(null)).toBe("connected");
    expect(classifyGameType(undefined)).toBe("connected");
  });
});

describe("isReviewableNode", () => {
  it("is true only for a canonical (non-collapsed) non-hidden row", () => {
    expect(isReviewableNode(0, null)).toBe(true);   // canonical main_game
    expect(isReviewableNode(1, null)).toBe(true);   // dlc is still reviewable
    expect(isReviewableNode(9, null)).toBe(true);   // a remaster with no parent stays a node
  });

  it("is false when the row has been collapsed into a canonical node", () => {
    expect(isReviewableNode(0, "some-canonical-uuid")).toBe(false);
    expect(isReviewableNode(9, "some-canonical-uuid")).toBe(false);
  });

  it("is false for hidden categories even when canonical", () => {
    expect(isReviewableNode(5, null)).toBe(false);  // mod
    expect(isReviewableNode(14, null)).toBe(false); // update
  });
});

describe("isBrowseGridNode", () => {
  it("excludes dlc from the main browse grid but keeps other reviewable nodes", () => {
    expect(isBrowseGridNode(0, null)).toBe(true);  // main_game shows in grid
    expect(isBrowseGridNode(1, null)).toBe(false); // dlc hidden from grid
    expect(isBrowseGridNode(1, "canonical")).toBe(false);
  });
});

describe("isAllowedGameCategory (legacy filter still intact)", () => {
  it("keeps the pre-canonical allow-list behavior unchanged", () => {
    // Legacy allow-list is [0,2,4,8,9,10] + notable bundles + null.
    expect(isAllowedGameCategory(0)).toBe(true);
    expect(isAllowedGameCategory(9)).toBe(true);
    expect(isAllowedGameCategory(null)).toBe(true);
    expect(isAllowedGameCategory(11)).toBe(false); // port excluded by legacy filter
    expect(isAllowedGameCategory(3, "Halo: The Master Chief Collection")).toBe(true);
    expect(isAllowedGameCategory(3, "Some Random Bundle")).toBe(false);
  });
});
