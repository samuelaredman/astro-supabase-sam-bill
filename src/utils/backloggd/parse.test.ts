import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  coerceLibraryRow,
  coerceRow,
  decodeEntities,
  htmlToText,
  isChallengePage,
  mapBackloggdStatus,
  parseBackloggdDate,
  parseGamesPage,
  parseReviewsPage,
  starWidthToRating,
} from "./parse";

const readFixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8");

const fixture = readFixture("reviews-page.html");

describe("starWidthToRating", () => {
  it("maps a width percentage to a half-star rating", () => {
    expect(starWidthToRating(40)).toBe(2);
    expect(starWidthToRating(90)).toBe(4.5);
    expect(starWidthToRating(100)).toBe(5);
    expect(starWidthToRating(10)).toBe(0.5);
  });
  it("returns null for a missing / zero bar", () => {
    expect(starWidthToRating(0)).toBeNull();
    expect(starWidthToRating(NaN)).toBeNull();
  });
});

describe("parseBackloggdDate", () => {
  it("takes the date part of an ISO datetime", () => {
    expect(parseBackloggdDate("2024-05-13T10:20:52Z")).toBe("2024-05-13");
  });
  it("parses the human 'May 13, 2024' form", () => {
    expect(parseBackloggdDate("May 13, 2024")).toBe("2024-05-13");
  });
  it("returns null for junk", () => {
    expect(parseBackloggdDate("")).toBeNull();
    expect(parseBackloggdDate("not a date")).toBeNull();
  });
});

describe("decodeEntities / htmlToText", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeEntities("Depth&#39;s &amp; friends &hellip;")).toBe("Depth's & friends …");
  });
  it("strips tags and collapses whitespace", () => {
    expect(htmlToText("  <div>\n\tHello   <b>world</b>\n</div>  ")).toBe("Hello world");
  });
});

describe("parseReviewsPage", () => {
  const parsed = parseReviewsPage(fixture, "Depth");

  it("reads the pager and the total review count", () => {
    expect(parsed.totalReviews).toBe(2625);
    expect(parsed.totalPages).toBe(175);
  });

  it("extracts every text review on the page", () => {
    expect(parsed.rows).toHaveLength(3);
  });

  it("maps the first review's fields", () => {
    const r = parsed.rows[0];
    expect(r.game_slug).toBe("endless-ocean-luminous");
    expect(r.game_title).toBe("Endless Ocean: Luminous");
    expect(r.release_year).toBe(2024);
    expect(r.rating).toBe(2);
    expect(r.review_date).toBe("2024-05-13");
    expect(r.platform_name).toBe("Nintendo Switch");
    expect(r.contains_spoilers).toBe(false);
    expect(r.source_url).toBe("https://backloggd.com/u/Depth/review/1611785/");
    expect(r.review_text).toMatch(/^Endless Ocean: Luminous offers a relaxing underwater escape/);
    expect(r.review_text).toMatch(/shallow compared to its predecessors\.$/);
  });

  it("maps the other reviews", () => {
    expect(parsed.rows[1].game_slug).toBe("hi-fi-rush");
    expect(parsed.rows[1].rating).toBe(4);
    expect(parsed.rows[2].game_slug).toBe("helldivers-2");
    expect(parsed.rows[2].platform_name).toBe("PlayStation 5");
  });

  it("still parses when there is no pager (single page)", () => {
    const onePage = fixture.replace(/<nav class="pagy nav"[\s\S]*?<\/nav>/, "");
    const p = parseReviewsPage(onePage, "Depth");
    expect(p.totalPages).toBeNull();
    expect(p.rows).toHaveLength(3);
  });
});

describe("coerceRow (upload path)", () => {
  it("accepts a well-formed row and clamps the rating to half steps", () => {
    const row = coerceRow({
      game_slug: "Hollow-Knight",
      game_title: "Hollow Knight",
      release_year: "2017",
      rating: 4.3,
      review_text: "  Masterpiece.  ",
      review_date: "2020-01-02T00:00:00Z",
      platform_name: "PC",
      contains_spoilers: true,
      source_url: "https://backloggd.com/u/x/review/9/",
    });
    expect(row).not.toBeNull();
    expect(row!.game_slug).toBe("hollow-knight");
    expect(row!.rating).toBe(4.5);
    expect(row!.release_year).toBe(2017);
    expect(row!.review_text).toBe("Masterpiece.");
    expect(row!.review_date).toBe("2020-01-02");
    expect(row!.contains_spoilers).toBe(true);
  });

  it("rejects rows with a bad slug or no text", () => {
    expect(coerceRow({ game_slug: "no spaces allowed", review_text: "hi" })).toBeNull();
    expect(coerceRow({ game_slug: "ok-slug", review_text: "   " })).toBeNull();
    expect(coerceRow(null)).toBeNull();
  });

  it("falls back to a safe source_url when the given one is off-site", () => {
    const row = coerceRow({
      game_slug: "celeste",
      review_text: "Tight.",
      source_url: "https://evil.example/x",
    });
    expect(row!.source_url).toBe("https://backloggd.com/games/celeste/");
  });
});

describe("isChallengePage", () => {
  it("detects the Anubis bot-challenge interstitial", () => {
    expect(isChallengePage(readFixture("challenge-page.html"))).toBe(true);
  });
  it("is false for a real page", () => {
    expect(isChallengePage(fixture)).toBe(false);
  });
});

describe("mapBackloggdStatus", () => {
  it("maps Backloggd states onto our user_game_status values", () => {
    expect(mapBackloggdStatus("played")).toBe("completed");
    expect(mapBackloggdStatus("completed")).toBe("completed");
    expect(mapBackloggdStatus("playing")).toBe("playing");
    expect(mapBackloggdStatus("backlog")).toBe("want_to_play");
    expect(mapBackloggdStatus("wishlist")).toBe("want_to_play");
    expect(mapBackloggdStatus("retired")).toBe("dropped");
    expect(mapBackloggdStatus("abandoned")).toBe("dropped");
    expect(mapBackloggdStatus("nonsense")).toBeNull();
    expect(mapBackloggdStatus(null)).toBeNull();
  });
});

describe("parseGamesPage", () => {
  const parsed = parseGamesPage(readFixture("games-page.html"));

  it("pulls slug + title from each game-cover card", () => {
    expect(parsed.slugs).toEqual([
      { game_slug: "hollow-knight", game_title: "Hollow Knight" },
      { game_slug: "celeste", game_title: "Celeste" },
      { game_slug: "hades--1", game_title: "Hades: Battle Out of Hell" },
    ]);
  });

  it("reads the pager", () => {
    expect(parsed.totalPages).toBe(3);
  });
});

describe("coerceLibraryRow", () => {
  it("accepts a valid row with a mappable status", () => {
    const row = coerceLibraryRow({
      game_slug: "Hollow-Knight",
      game_title: "Hollow Knight",
      release_year: 2017,
      backloggd_status: "Played",
    });
    expect(row).toEqual({
      game_slug: "hollow-knight",
      game_title: "Hollow Knight",
      release_year: 2017,
      backloggd_status: "played",
    });
  });

  it("rejects a row whose status doesn't map", () => {
    expect(coerceLibraryRow({ game_slug: "celeste", backloggd_status: "favorited" })).toBeNull();
    expect(coerceLibraryRow({ game_slug: "bad slug", backloggd_status: "played" })).toBeNull();
  });
});
