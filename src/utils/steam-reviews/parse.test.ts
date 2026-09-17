import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeSteamId,
  parseHoursBlock,
  parseRecommendationsPage,
  parseSteamPostedDate,
} from "./parse";

const FIXTURE = readFileSync(
  join(__dirname, "__fixtures__", "recommendations-page.html"),
  "utf8",
);

describe("parseHoursBlock", () => {
  it("prefers hrs at review time when both are present", () => {
    expect(parseHoursBlock("1,083.3 hrs on record (223.8 hrs at review time)"))
      .toBeCloseTo(223.8);
  });
  it("falls back to hrs on record when at-review-time is absent", () => {
    expect(parseHoursBlock("12 hrs on record")).toBe(12);
  });
  it("returns null for garbage", () => {
    expect(parseHoursBlock("")).toBeNull();
    expect(parseHoursBlock("Recommended")).toBeNull();
  });
});

describe("parseSteamPostedDate", () => {
  it("parses a full 'Posted Month D, YYYY.' string", () => {
    expect(parseSteamPostedDate("Posted March 24, 2017.")).toBe("2017-03-24");
  });
  it("assumes the current year when Steam omits it", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    expect(parseSteamPostedDate("Posted May 13.", now)).toBe("2026-05-13");
  });
  it("ignores a trailing ' Edited' marker", () => {
    expect(parseSteamPostedDate("Posted January 2, 2020. Edited")).toBe("2020-01-02");
  });
});

describe("normalizeSteamId", () => {
  it("accepts a bare steam64 id", () => {
    expect(normalizeSteamId("76561197960287930")).toBe("76561197960287930");
  });
  it("extracts a steam64 id from a profile URL", () => {
    expect(
      normalizeSteamId("https://steamcommunity.com/profiles/76561197960287930/"),
    ).toBe("76561197960287930");
  });
  it("rejects vanity URLs (we only store steam64 on the profile)", () => {
    expect(normalizeSteamId("https://steamcommunity.com/id/gaben")).toBeNull();
    expect(normalizeSteamId("gaben")).toBeNull();
  });
});

describe("parseRecommendationsPage", () => {
  const parsed = parseRecommendationsPage(FIXTURE, "76561197960287930");

  it("returns one row per review_box", () => {
    expect(parsed.rows).toHaveLength(1);
  });

  it("pulls appid, body, hours-at-review and posted date from the card", () => {
    const [row] = parsed.rows;
    expect(row.steam_appid).toBe(365360);
    expect(row.recommended).toBe(true);
    expect(row.hours_at_review).toBeCloseTo(223.8);
    expect(row.review_text).toBe("The best of all things.");
    expect(row.review_date).toBe("2017-03-24");
    expect(row.source_url).toBe(
      "https://steamcommunity.com/profiles/76561197960287930/recommended/365360/",
    );
  });

  it("does not confuse the fixture for a private profile", () => {
    expect(parsed.isPrivate).toBe(false);
  });
});
