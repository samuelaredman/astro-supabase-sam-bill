// Parser / validator for an uploaded HowLongToBeat library export (the JSON
// the bookmarklet in libraryScraperSource.ts downloads). Shared by the import
// endpoint (`/api/import/hltb/library`).
//
// Mirrors `src/utils/backloggd/parse.ts` in spirit: a `coerceRow` that returns
// a strongly-typed row or null, plus a `mapHltbStatus` that translates HLTB's
// play state to Chekpoint's `user_game_status.status` values.

export type LibraryStatus = "playing" | "want_to_play" | "completed" | "dropped";

/** One row from the uploaded JSON after validation. */
export type HltbRow = {
  /** Preserved for linking back if we have it, but not required to import. */
  hltb_id: string | null;
  /** Human-readable title the IGDB matcher gets as a fallback. */
  game_title: string;
  release_year: number | null;
  /** Raw HLTB status string, lower-cased (`completed`, `playing`, `backlog`, …). */
  hltb_status: string;
  /** Hours played, in minutes. 0 is treated the same as null (no data). */
  minutes_played: number | null;
  /** 1–10 integer. HLTB uses a 1–10 star rating; maps 1:1 to Chekpoint's scale. */
  score: number | null;
  /** Review body, if the user wrote one. */
  review_text: string | null;
  /** ISO date (YYYY-MM-DD) if the bookmarklet could parse one. */
  review_date: string | null;
  /** Spoiler flag if the HLTB entry had one. HLTB doesn't currently expose this
   *  but we accept it so a future scraper revision can set it. */
  contains_spoilers: boolean;
};

const STATUS_MAP: Record<string, LibraryStatus> = {
  playing: "playing",
  "currently playing": "playing",
  completed: "completed",
  played: "completed",
  mastered: "completed",
  "100%": "completed",
  replay: "completed",
  replays: "completed",
  backlog: "want_to_play",
  wishlist: "want_to_play",
  "want to play": "want_to_play",
  retired: "dropped",
  shelved: "dropped",
  abandoned: "dropped",
  dropped: "dropped",
  custom: "dropped", // HLTB "Custom" shelf is used for retired/abandoned play
};

export function mapHltbStatus(raw: string | null | undefined): LibraryStatus | null {
  if (!raw) return null;
  return STATUS_MAP[raw.trim().toLowerCase()] ?? null;
}

const YEAR_MIN = 1950;
const YEAR_MAX = 2100;
const TITLE_MAX = 300;
const REVIEW_MAX = 20_000;

function coerceInt(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) return Math.trunc(input);
  if (typeof input === "string") {
    const n = parseInt(input, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Score coercion mirrors the IIFE's pickScore: integers 1–10 go through,
// 0.5–5 fractional values are treated as half-stars and doubled, everything
// else is rejected. Centralised here so an uploaded payload from a legacy
// HLTB client is normalised at the server boundary rather than silently
// rejected (reviews.score is CHECK(1..10) INT).
function coerceScore(input: unknown): number | null {
  let s: number;
  if (typeof input === "number") s = input;
  else if (typeof input === "string") s = parseFloat(input);
  else return null;
  if (!Number.isFinite(s) || s <= 0) return null;
  if (!Number.isInteger(s) && s <= 5) s = s * 2;
  const rounded = Math.round(s);
  return rounded >= 1 && rounded <= 10 ? rounded : null;
}

// Accepts "YYYY-MM-DD" or any ISO-like date string. Returns null for anything
// Date can't parse — otherwise an invalid value here would be injected as a
// bad timestamp into reviews.published_at.
function coerceDate(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function coerceString(input: unknown, max: number): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/** Validate one row from an uploaded HLTB export. */
export function coerceHltbRow(input: unknown): HltbRow | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;

  const title = coerceString(r.game_title, TITLE_MAX);
  if (!title) return null;

  const status = typeof r.hltb_status === "string" ? r.hltb_status.trim().toLowerCase() : "";
  if (!status || !mapHltbStatus(status)) return null;

  const yearRaw = coerceInt(r.release_year);
  const release_year = yearRaw != null && yearRaw >= YEAR_MIN && yearRaw <= YEAR_MAX ? yearRaw : null;

  const minutesRaw = coerceInt(r.minutes_played);
  const minutes_played = minutesRaw != null && minutesRaw > 0 ? minutesRaw : null;

  const score = coerceScore(r.score);
  const review_text = coerceString(r.review_text, REVIEW_MAX);
  const review_date = coerceDate(r.review_date);

  const hltb_id = coerceString(r.hltb_id, 32);
  const contains_spoilers = r.contains_spoilers === true;

  return {
    hltb_id,
    game_title: title,
    release_year,
    hltb_status: status,
    minutes_played,
    score,
    review_text,
    review_date,
    contains_spoilers,
  };
}

/** True when the row should become a Chekpoint review (score required). */
export function hasReviewPayload(row: HltbRow): boolean {
  return row.score != null;
}

/** draft when there's a score but no body; published when both are present. */
export function reviewStatusFor(row: HltbRow): "draft" | "published" {
  return row.review_text && row.review_text.trim().length > 0 ? "published" : "draft";
}

/** HLTB uses hours decimals internally; the scraper reports minutes. Convert
 *  back to the whole hours Chekpoint stores on reviews.play_time_hours. */
export function minutesToHours(minutes: number | null | undefined): number | null {
  if (!minutes || minutes <= 0) return null;
  const hours = Math.round(minutes / 60);
  return hours > 0 ? hours : null;
}
