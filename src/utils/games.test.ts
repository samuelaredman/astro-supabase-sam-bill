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
  relationTypeForChildCategory,
  deriveIgdbRelationEdges,
  collectSteamAppids,
  asIgdbId,
  collapseParentCandidates,
  normalizeClusterTitle,
  chooseClusterCanonical,
  revisionKindForEdition,
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

describe("asIgdbId", () => {
  it("accepts bare ids and {id} objects, rejects everything else", () => {
    expect(asIgdbId(42)).toBe(42);
    expect(asIgdbId({ id: 42 })).toBe(42);
    expect(asIgdbId(null)).toBeNull();
    expect(asIgdbId(undefined)).toBeNull();
    expect(asIgdbId("42")).toBeNull();
    expect(asIgdbId(NaN)).toBeNull();
  });
});

describe("relationTypeForChildCategory", () => {
  it("maps connected child categories to their edge type", () => {
    expect(relationTypeForChildCategory(1)).toBe("dlc");
    expect(relationTypeForChildCategory(2)).toBe("expansion");
    expect(relationTypeForChildCategory(4)).toBe("standalone_expansion");
    expect(relationTypeForChildCategory(8)).toBe("remake");
    expect(relationTypeForChildCategory(10)).toBe("expanded_game");
  });

  it("returns null for collapse categories and unknowns (no edge)", () => {
    expect(relationTypeForChildCategory(11)).toBeNull(); // port collapses
    expect(relationTypeForChildCategory(9)).toBeNull();  // remaster collapses
    expect(relationTypeForChildCategory(0)).toBeNull();  // main_game has no parent edge
    expect(relationTypeForChildCategory(null)).toBeNull();
  });
});

describe("deriveIgdbRelationEdges", () => {
  it("emits outbound edges for each reverse-array member", () => {
    const edges = deriveIgdbRelationEdges({
      game_type: 0,
      dlcs: [101, 102],
      expansions: [{ id: 201 }],
      remakes: [301],
    });
    expect(edges).toContainEqual({ igdbId: 101, relationType: "dlc", direction: "out" });
    expect(edges).toContainEqual({ igdbId: 102, relationType: "dlc", direction: "out" });
    expect(edges).toContainEqual({ igdbId: 201, relationType: "expansion", direction: "out" });
    expect(edges).toContainEqual({ igdbId: 301, relationType: "remake", direction: "out" });
  });

  it("emits an inbound edge from parent typed by this game's own category", () => {
    // This game is an expansion (2) whose parent_game is 500.
    const edges = deriveIgdbRelationEdges({ game_type: 2, parent_game: 500 });
    expect(edges).toEqual([{ igdbId: 500, relationType: "expansion", direction: "in" }]);
  });

  it("emits no parent edge when the child category collapses (e.g. a port)", () => {
    expect(deriveIgdbRelationEdges({ game_type: 11, parent_game: 500 })).toEqual([]);
  });

  it("de-duplicates identical edges", () => {
    const edges = deriveIgdbRelationEdges({ game_type: 0, dlcs: [101, 101] });
    expect(edges).toEqual([{ igdbId: 101, relationType: "dlc", direction: "out" }]);
  });

  it("returns nothing for a payload with no relationships", () => {
    expect(deriveIgdbRelationEdges({ game_type: 0 })).toEqual([]);
    expect(deriveIgdbRelationEdges({})).toEqual([]);
  });
});

describe("collectSteamAppids", () => {
  it("pulls distinct positive Steam appids (category 1) and ignores other stores", () => {
    const appids = collectSteamAppids([
      { category: 1, uid: "570" },   // Steam
      { category: 1, uid: "570" },   // dup
      { category: 5, uid: "999" },   // GOG — ignored
      { category: 1, uid: "440" },   // Steam
    ]);
    expect(appids.sort((a, b) => a - b)).toEqual([440, 570]);
  });

  it("handles missing/garbage uids and empty input", () => {
    expect(collectSteamAppids(null)).toEqual([]);
    expect(collectSteamAppids([{ category: 1, uid: null }])).toEqual([]);
    expect(collectSteamAppids([{ category: 1, uid: "not-a-number" }])).toEqual([]);
  });
});

describe("collapseParentCandidates", () => {
  it("prefers version_parent over parent_game", () => {
    expect(collapseParentCandidates({ igdb_version_parent: 10, igdb_parent_game: 20 }))
      .toEqual([10, 20]);
  });

  it("dedupes when both point at the same game, and handles missing values", () => {
    expect(collapseParentCandidates({ igdb_version_parent: 10, igdb_parent_game: 10 })).toEqual([10]);
    expect(collapseParentCandidates({ igdb_parent_game: 20 })).toEqual([20]);
    expect(collapseParentCandidates({})).toEqual([]);
  });
});

describe("normalizeClusterTitle", () => {
  it("folds case, whitespace, and diacritics for exact-duplicate clustering", () => {
    expect(normalizeClusterTitle("  DOOM  ")).toBe("doom");
    expect(normalizeClusterTitle("Pokémon   Red")).toBe("pokemon red");
    expect(normalizeClusterTitle("BioShock")).toBe(normalizeClusterTitle("bioshock"));
  });
});

describe("chooseClusterCanonical", () => {
  it("picks the earliest-released main_game", () => {
    const id = chooseClusterCanonical([
      { id: "b", igdb_category: 0, date_released: "2011-11-11" }, // Skyrim (main)
      { id: "a", igdb_category: 9, date_released: "2016-10-28" }, // Special Edition (remaster)
      { id: "c", igdb_category: 3, date_released: "2021-11-11" }, // Anniversary (bundle)
    ]);
    expect(id).toBe("b");
  });

  it("falls back to earliest release when the cluster has no main game", () => {
    const id = chooseClusterCanonical([
      { id: "a", igdb_category: 11, date_released: "2013-01-01" }, // port
      { id: "b", igdb_category: 9, date_released: "2012-01-01" },  // remaster (earlier)
    ]);
    expect(id).toBe("b");
  });

  it("is deterministic on ties and empty clusters", () => {
    expect(chooseClusterCanonical([
      { id: "y", igdb_category: 0, date_released: null },
      { id: "x", igdb_category: 0, date_released: null },
    ])).toBe("x");
    expect(chooseClusterCanonical([])).toBeNull();
  });
});

describe("revisionKindForEdition", () => {
  it("maps a remaster to remaster_merge and everything else to edition", () => {
    expect(revisionKindForEdition(9)).toBe("remaster_merge");
    expect(revisionKindForEdition(3)).toBe("edition");   // bundle
    expect(revisionKindForEdition(11)).toBe("edition");  // port
    expect(revisionKindForEdition(13)).toBe("edition");  // pack
    expect(revisionKindForEdition(null)).toBe("edition");
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
