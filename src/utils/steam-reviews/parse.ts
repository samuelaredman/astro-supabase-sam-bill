// Parser for a Steam user's public recommendations page
// (https://steamcommunity.com/profiles/<steamid64>/recommended/?p=N).
//
// Steam has no per-user reviews API, so we scrape the community HTML. The
// page is Rails/Volley-generated and consistent enough for a regex parser
// with no DOM dependency — matching the shape we already use for Backloggd.
//
// One review card, verified against a real profile:
//   <div class="review_box">
//     …
//     <div class="review_box_content">
//       <div class="leftcol">
//         <a href="https://steamcommunity.com/app/<appid>" class="game_capsule_ctn ">
//           <img class="game_capsule" src="…capsule_184x69.jpg?t=…">
//         </a>
//       </div>
//       <div class="rightcol">
//         <div class="vote_header">
//           <div class="thumb"><a href="…/recommended/<appid>/"><img …thumbsUp.png"></a></div>
//           <div class="title"><a href="…/recommended/<appid>/">Recommended</a></div>
//           <div class="hours">
//             1,083.3 hrs on record (223.8 hrs at review time)
//           </div>
//         </div>
//         <div class="content ">body text…</div>
//         <div class="posted">Posted March 24, 2017.</div>
//       </div>
//     </div>
//   </div>
//
// Notes on the shape:
// • The recommendations list has NO game title in the card (only a capsule
//   image with no alt). Titles are attached during scrape from
//   IPlayerService/GetOwnedGames, keyed by appid.
// • "hrs at review time" is only present when it differs from current hrs.
//   When absent, "hrs on record" is the value we keep.
// • Date is "Posted Month D, YYYY." — when the year is the current year
//   Steam prints "Posted Month D." with no year.
// • Pagination lives in .workshopBrowsePagingControls as ?p=N links; the
//   total count is "Showing X-Y of Z entries" (Z is the truth).
// • Private profiles / private reviews render the page with no review_box
//   at all (and often a "private" marker); we surface that as zero rows.

export type SteamReviewRow = {
  /** Steam appid from /app/<id>/ on the card. Required for later matching. */
  steam_appid: number;
  /** Filled in by the scrape route from GetOwnedGames; may be empty for keys/gifts. */
  game_title: string;
  /** Full review body, HTML stripped, line breaks normalized. */
  review_text: string;
  /** ISO date (YYYY-MM-DD) parsed from the "Posted …" string, or null. */
  review_date: string | null;
  /** Hours-at-review-time if Steam printed it; else hrs-on-record; else null. */
  hours_at_review: number | null;
  /** true for Recommended, false for Not Recommended. */
  recommended: boolean;
  /** Permalink built from the Steam profile URL + appid. */
  source_url: string;
};

export type ParsedRecommendationsPage = {
  rows: SteamReviewRow[];
  /** Highest ?p=N in the pager, or null when there's a single page. */
  totalPages: number | null;
  /** Z from "Showing X-Y of Z entries", or null when the marker is absent. */
  totalReviews: number | null;
  /** True when the profile or its reviews section is private. */
  isPrivate: boolean;
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "…", mdash: "—", ndash: "–",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const codePoint =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (Number.isNaN(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return whole;
      try { return String.fromCodePoint(codePoint); } catch { return whole; }
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body)
      ? NAMED_ENTITIES[body]
      : whole;
  });
}

/** Strip tags, decode entities, collapse whitespace. Keeps paragraph breaks as "\n\n". */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/\s*(p|div)\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(withBreaks)
    .replace(/\r/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * "Posted March 24, 2017." | "Posted May 13." (no year) -> "YYYY-MM-DD"
 * The no-year form appears when the review's year matches the current year;
 * we fill in the current year in that case.
 */
export function parseSteamPostedDate(
  raw: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^Posted\s+/i, "")
    .replace(/\.$/, "")
    .replace(/\s+Edited$/i, "")
    .trim();
  if (!cleaned) return null;
  // "March 24, 2017" has a comma; the no-year form is "May 13" (no comma).
  const hasYear = /,\s*\d{4}$/.test(cleaned);
  const withYear = hasYear ? cleaned : `${cleaned}, ${now.getUTCFullYear()}`;
  const parsed = new Date(`${withYear} UTC`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/**
 * "1,083.3 hrs on record (223.8 hrs at review time)" -> 223.8
 * "12 hrs on record" -> 12
 * Prefers at-review-time when present; falls back to hrs-on-record.
 */
export function parseHoursBlock(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const text = decodeEntities(raw).replace(/\s+/g, " ").trim();
  const atReview = text.match(/\(([\d,.]+)\s*hrs?\s*at\s*review\s*time\)/i);
  const onRecord = text.match(/([\d,.]+)\s*hrs?\s*on\s*record/i);
  const pick = atReview?.[1] ?? onRecord?.[1] ?? null;
  if (!pick) return null;
  const n = parseFloat(pick.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function extractTotalReviews(html: string): number | null {
  const m = html.match(/Showing\s+\d+\s*[-–]\s*\d+\s+of\s+([\d,]+)\s+entries/i);
  if (!m) return null;
  const n = parseInt(m[1].replace(/,/g, ""), 10);
  return Number.isNaN(n) ? null : n;
}

function extractTotalPages(html: string): number | null {
  const nav = html.match(
    /<div[^>]*class="[^"]*\bworkshopBrowsePagingControls\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  );
  if (!nav) return null;
  let max = 1;
  for (const m of nav[1].matchAll(/[?&]p=(\d+)/g)) {
    const n = parseInt(m[1], 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return max === 1 ? null : max;
}

/** Split the page into one string per review_box. */
function splitReviewBoxes(html: string): string[] {
  const out: string[] = [];
  const re = /<div\b[^>]*class="[^"]*\breview_box\b[^"]*"[^>]*>/gi;
  let start = -1;
  let match: RegExpExecArray | null;
  const heads: number[] = [];
  while ((match = re.exec(html))) heads.push(match.index);
  for (let i = 0; i < heads.length; i++) {
    start = heads[i];
    const end = i + 1 < heads.length ? heads[i + 1] : html.length;
    out.push(html.slice(start, end));
  }
  return out;
}

function isPrivateProfile(html: string): boolean {
  return (
    /class="[^"]*\bprivate_profile\b/.test(html) ||
    /This profile is private\./i.test(html)
  );
}

function parseReviewBox(box: string, steamId64: string): SteamReviewRow | null {
  // Prefer the leftcol app link — the vote_header links (recommended/<appid>/)
  // include the appid too, but the leftcol is the canonical "this review is
  // about this game" pointer.
  const appLink =
    box.match(/href="https?:\/\/steamcommunity\.com\/app\/(\d+)/i) ??
    box.match(/href="[^"]*\/recommended\/(\d+)\/?"/i);
  if (!appLink) return null;
  const steam_appid = parseInt(appLink[1], 10);
  if (!Number.isFinite(steam_appid) || steam_appid <= 0) return null;

  const titleMatch = box.match(
    /<div[^>]*class="title"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>\s*<\/div>/i,
  );
  const titleText = titleMatch ? htmlToText(titleMatch[1]).toLowerCase() : "";
  // "Recommended" -> true, "Not Recommended" -> false. Default true when Steam
  // is unusually terse: the important signal for us is the review body, not
  // the thumb, and users almost always Recommend the games they take the time
  // to write about.
  const recommended = titleText ? !/\bnot\b/.test(titleText) : true;

  const hoursMatch = box.match(
    /<div[^>]*class="hours"[^>]*>([\s\S]*?)<\/div>/i,
  );
  const hours_at_review = parseHoursBlock(hoursMatch?.[1]);

  const bodyMatch = box.match(
    /<div[^>]*class="content\s*"[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*class="[^"]*\bposted\b/i,
  ) ?? box.match(
    /<div[^>]*class="content\s*"[^>]*>([\s\S]*?)<\/div>/i,
  );
  const review_text = bodyMatch ? htmlToText(bodyMatch[1]) : "";
  if (!review_text) return null;

  const postedMatch = box.match(
    /<div[^>]*class="posted"[^>]*>([\s\S]*?)<\/div>/i,
  );
  const review_date = parseSteamPostedDate(postedMatch ? htmlToText(postedMatch[1]) : null);

  const source_url = `https://steamcommunity.com/profiles/${steamId64}/recommended/${steam_appid}/`;

  return {
    steam_appid,
    game_title: "", // filled in later from GetOwnedGames
    review_text,
    review_date,
    hours_at_review,
    recommended,
    source_url,
  };
}

/**
 * Parse one recommendations page. `steamId64` is used to build review
 * permalinks; the community pages don't consistently include a canonical
 * profile URL we can trust for that.
 */
export function parseRecommendationsPage(
  html: string,
  steamId64: string,
): ParsedRecommendationsPage {
  const boxes = splitReviewBoxes(html);
  const rows: SteamReviewRow[] = [];
  const seen = new Set<number>();
  for (const box of boxes) {
    const row = parseReviewBox(box, steamId64);
    if (!row) continue;
    if (seen.has(row.steam_appid)) continue; // safety — Steam never dupes on a page, but cheap
    seen.add(row.steam_appid);
    rows.push(row);
  }
  return {
    rows,
    totalPages: extractTotalPages(html),
    totalReviews: extractTotalReviews(html),
    isPrivate: rows.length === 0 && isPrivateProfile(html),
  };
}

/** 17-digit numeric Steam ID (steam64). Also accepts full profile URLs. */
export function normalizeSteamId(raw: string): string | null {
  let value = (raw ?? "").trim();
  const urlMatch = value.match(/steamcommunity\.com\/profiles\/(\d{16,20})/i);
  if (urlMatch) value = urlMatch[1];
  return /^\d{16,20}$/.test(value) ? value : null;
}
