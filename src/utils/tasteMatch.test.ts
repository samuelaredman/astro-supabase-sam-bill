import { describe, expect, it } from "vitest";
import { computeTasteMatch, type TasteReview } from "./tasteMatch";
import { tasteMatchLabel } from "./format";

// Small helper to build a review vector without repeating the game object shape.
function rv(id: string, score: number, genres: string[] = [], published_at: string | null = null): TasteReview {
  return {
    game_id: id,
    score,
    published_at,
    game: { title: `Game ${id}`, slug: id, cover_img_url: null },
    genres,
  };
}

describe("computeTasteMatch", () => {
  it("returns a neutral, no-shared-games result when there is no overlap", () => {
    const r = computeTasteMatch([rv("a", 8)], [rv("b", 3)]);
    expect(r.sharedCount).toBe(0);
    expect(r.matchPct).toBe(0);
    expect(r.confidence).toBe("none");
    expect(r.viewerReviewCount).toBe(1);
    expect(r.targetReviewCount).toBe(1);
    expect(r.sharedGames).toEqual([]);
  });

  it("scores near 100% when both rate many games identically", () => {
    const a = [rv("a", 9), rv("b", 8), rv("c", 7), rv("d", 10), rv("e", 6), rv("f", 5), rv("g", 8), rv("h", 9), rv("i", 7), rv("j", 6)];
    const b = a.map((x) => rv(x.game_id, x.score));
    const r = computeTasteMatch(a, b);
    expect(r.sharedCount).toBe(10);
    // C=5 shrinkage caps 10 perfectly-aligned games at (5*0.5+10)/15 ≈ 0.833 → 83%.
    // Deliberately conservative: it takes more shared games to approach 100%.
    expect(r.matchPct).toBe(83);
    expect(r.label).toBe("Very similar");
    expect(r.confidence).toBe("high");
    expect(r.correlation).toBeCloseTo(1, 5);
  });

  it("scores very low when many games are rated at opposite extremes", () => {
    const a = Array.from({ length: 10 }, (_, i) => rv(`g${i}`, 10));
    const b = Array.from({ length: 10 }, (_, i) => rv(`g${i}`, 1));
    const r = computeTasteMatch(a, b);
    // (5*0.5 + 0)/15 ≈ 0.167 → 17%.
    expect(r.matchPct).toBe(17);
    expect(r.label).toBe("Different");
    expect(r.confidence).toBe("high");
  });

  it("shrinks a single perfect match toward the neutral prior", () => {
    // One shared game, identical scores: raw agreement 1.0, but with C=5 pulled to
    // (5*0.5 + 1) / (5 + 1) = 3.5/6 ≈ 0.583 → 58%. Not 100%.
    const r = computeTasteMatch([rv("a", 9)], [rv("a", 9)]);
    expect(r.sharedCount).toBe(1);
    expect(r.matchPct).toBe(58);
    expect(r.confidence).toBe("low");
  });

  it("orders top agreements and disagreements correctly", () => {
    const a = [rv("close", 8), rv("far", 9), rv("mid", 7)];
    const b = [rv("close", 8), rv("far", 2), rv("mid", 5)];
    const r = computeTasteMatch(a, b);
    expect(r.topAgreements[0].game_id).toBe("close"); // identical → highest agreement
    expect(r.topDisagreements[0].game_id).toBe("far"); // |9-2|=7 → biggest gap
  });

  it("keeps the viewer's score as scoreA and the other user's as scoreB", () => {
    const r = computeTasteMatch([rv("a", 9)], [rv("a", 4)]);
    const g = r.sharedGames[0];
    expect(g.scoreA).toBe(9);
    expect(g.scoreB).toBe(4);
  });

  it("builds a genre breakdown, counting a game in each of its genres and omitting thin genres", () => {
    const a = [
      rv("g1", 8, ["RPG", "Action"]),
      rv("g2", 7, ["RPG"]),
      rv("g3", 9, ["Puzzle"]),
    ];
    const b = [
      rv("g1", 8, ["RPG", "Action"]),
      rv("g2", 7, ["RPG"]),
      rv("g3", 9, ["Puzzle"]),
    ];
    const r = computeTasteMatch(a, b);
    const genres = r.genreBreakdown.map((x) => x.genre);
    expect(genres).toContain("RPG"); // 2 shared games → included
    expect(genres).not.toContain("Action"); // only 1 shared → omitted
    expect(genres).not.toContain("Puzzle"); // only 1 shared → omitted
    const rpg = r.genreBreakdown.find((x) => x.genre === "RPG");
    expect(rpg?.shared).toBe(2);
    expect(rpg?.pct).toBe(100);
  });

  it("uses the latest score per game when a user has re-reviewed (dated history)", () => {
    // Viewer re-reviewed game "a": launch 9, later 4. Only the latest (4) should count.
    const a = [
      rv("a", 9, [], "2024-01-01T00:00:00Z"),
      rv("a", 4, [], "2025-01-01T00:00:00Z"),
    ];
    const b = [rv("a", 4, [], "2024-06-01T00:00:00Z")];
    const r = computeTasteMatch(a, b);
    expect(r.sharedCount).toBe(1); // deduped to one game
    expect(r.viewerReviewCount).toBe(1);
    expect(r.sharedGames[0].scoreA).toBe(4); // latest, not the launch 9
  });

  it("computes averages over shared games only", () => {
    const a = [rv("a", 8), rv("b", 6), rv("unseen", 2)];
    const b = [rv("a", 8), rv("b", 6)];
    const r = computeTasteMatch(a, b);
    expect(r.viewerAvg).toBe(7); // (8+6)/2, ignores the unshared "unseen"
    expect(r.targetAvg).toBe(7);
  });
});

describe("tasteMatchLabel", () => {
  it("maps percentages to human labels", () => {
    expect(tasteMatchLabel(90)).toBe("Very similar");
    expect(tasteMatchLabel(70)).toBe("Similar");
    expect(tasteMatchLabel(50)).toBe("Mixed");
    expect(tasteMatchLabel(20)).toBe("Different");
  });
});
