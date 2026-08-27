// Parser for a Backloggd user's public reviews page
// (https://backloggd.com/u/<username>/reviews?page=N).
//
// Backloggd has no API and its CSV export is ratings-only, so written reviews
// have to come from the rendered HTML. The markup is Rails-generated and very
// regular, so this is a regex parser with no DOM dependency — it runs
// unchanged in a Node API route and in a browser bookmarklet.
//
// Page shape (see src/utils/backloggd/__fixtures__/reviews-page.html):
//   <h2 class="like-count-header">... over <span>2625</span> Reviews</h2>
//   repeating, 15 per page:
//     <div class="row mb-1 game-name">
//        <a href="/games/<slug>/"><h3>Title</h3></a>
//        <p class="... game-date ...">2024</p>
//     </div>
//     <div class="row pt-2 pb-1 review-card">
//        <div class="stars-top" style="width:40%">        (absent = no rating)
//        <a class="review-platform" href="...played_platform:switch/"><p>Nintendo Switch</p></a>
//        <time datetime="2024-05-13T10:20:52Z">May 13, 2024</time>
//        <div class="row ... review-body " review_id="1611785">
//           <div class="mb-0 card-text" id="collapseReview1611785">TEXT</div>
//     </div>
//   <nav class="pagy nav"> ... <a href="/u/<user>/reviews?page=175">175</a> ...

export type BackloggdRow = {
  game_slug: string;
  game_title: string;
  release_year: number | null;
  /** 0.5–5 in half steps, exactly as shown on Backloggd. null = review with no rating. */
  rating: number | null;
  /** Always present — the reviews page only lists entries that have review text. */
  review_text: string;
  /** ISO date (YYYY-MM-DD) parsed from the <time datetime> attribute, or null. */
  review_date: string | null;
  platform_name: string | null;
  /** Raw Backloggd play state shown on the card (completed/playing/retired/…), or null. */
  play_status: string | null;
  contains_spoilers: boolean;
  /** Permalink to the review on Backloggd, or the game page as a fallback. */
  source_url: string;
};

export type ParsedReviewsPage = {
  rows: BackloggdRow[];
  /** Highest page number in the pager, or null if there's no pager (single page). */
  totalPages: number | null;
  /** "N Reviews" from the page header, or null if not found. */
  totalReviews: number | null;
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const codePoint =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (Number.isNaN(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return whole;
      }
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

/** Backloggd stars: a `width:` percentage of a 5-star bar. 40% -> 2.0, 90% -> 4.5. */
export function starWidthToRating(percent: number): number | null {
  if (!Number.isFinite(percent) || percent <= 0) return null;
  const raw = (percent / 100) * 5;
  const rounded = Math.round(raw * 2) / 2; // snap to nearest half star
  return Math.min(5, Math.max(0.5, rounded));
}

/** "2024-05-13T10:20:52Z" | "May 13, 2024" -> "2024-05-13" (or null). */
export function parseBackloggdDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function extractTotalReviews(html: string): number | null {
  const m = html.match(/over\s*<span[^>]*>\s*([\d,]+)\s*<\/span>\s*Reviews/i);
  if (!m) return null;
  const n = parseInt(m[1].replace(/,/g, ""), 10);
  return Number.isNaN(n) ? null : n;
}

function extractTotalPages(html: string): number | null {
  const nav = html.match(/<nav[^>]*class="[^"]*\bpagy\b[^"]*"[^>]*>([\s\S]*?)<\/nav>/i);
  if (!nav) return null;
  let max = 1;
  for (const m of nav[1].matchAll(/[?&]page=(\d+)/g)) {
    const n = parseInt(m[1], 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return max;
}

function sliceReviewSection(html: string): string {
  // Everything from the first game-name block up to the pager / end of the list.
  const start = html.search(/<div class="row mb-1 game-name">/);
  if (start === -1) return "";
  const rest = html.slice(start);
  const end = rest.search(/<nav[^>]*class="[^"]*\bpagy\b/i);
  return end === -1 ? rest : rest.slice(0, end);
}

function parseOneEntry(chunk: string, username: string): BackloggdRow | null {
  const gameLink = chunk.match(/href="\/games\/([^/"]+)\/"/);
  if (!gameLink) return null;
  const game_slug = gameLink[1];

  const titleMatch = chunk.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
  const game_title = titleMatch ? htmlToText(titleMatch[1]) : game_slug.replace(/-/g, " ");

  const yearMatch = chunk.match(/game-date[^>]*>\s*(\d{4})\s*</);
  const release_year = yearMatch ? parseInt(yearMatch[1], 10) : null;

  const starMatch = chunk.match(/class="stars-top"\s+style="width:\s*([\d.]+)%/);
  const rating = starMatch ? starWidthToRating(parseFloat(starMatch[1])) : null;

  const platformMatch = chunk.match(
    /class="[^"]*\breview-platform\b[^"]*"[^>]*>\s*<p[^>]*>([\s\S]*?)<\/p>/,
  );
  const platform_name = platformMatch ? htmlToText(platformMatch[1]) || null : null;

  const timeMatch = chunk.match(/<time[^>]*datetime="([^"]+)"/);
  const review_date = parseBackloggdDate(timeMatch?.[1]);

  // Play state shown on the card: <p class="mb-0 play-type completed">Completed</p>
  const statusMatch = chunk.match(/\bplay-type\s+([a-z_]+)\b/);
  const play_status = statusMatch ? statusMatch[1].toLowerCase() : null;

  const bodyBlock = chunk.match(
    /class="[^"]*\breview-body\b[^"]*"\s+review_id="(\d+)"[\s\S]*?<div class="[^"]*\bcard-text\b[^"]*"[^>]*>([\s\S]*?)<\/div>/,
  );
  const review_id = bodyBlock?.[1] ?? null;
  const review_text = bodyBlock ? htmlToText(bodyBlock[2]) : "";
  if (!review_text) return null; // not a text review — skip

  const contains_spoilers = /\bspoiler(?:s|-|_|")/i.test(chunk);

  const source_url = review_id
    ? `https://backloggd.com/u/${username}/review/${review_id}/`
    : `https://backloggd.com/games/${game_slug}/`;

  return {
    game_slug,
    game_title,
    release_year,
    rating,
    review_text,
    review_date,
    platform_name,
    play_status,
    contains_spoilers,
    source_url,
  };
}

/**
 * Parse one reviews page. `username` is needed to build review permalinks and
 * cannot always be recovered from the markup reliably.
 */
export function parseReviewsPage(html: string, username: string): ParsedReviewsPage {
  const section = sliceReviewSection(html);
  const rows: BackloggdRow[] = [];

  if (section) {
    // Split on the game-name delimiter; each piece holds one game header + one card.
    const pieces = section.split(/(?=<div class="row mb-1 game-name">)/);
    for (const piece of pieces) {
      if (!piece.includes("review-card")) continue;
      const row = parseOneEntry(piece, username);
      if (row) rows.push(row);
    }
  }

  return {
    rows,
    totalPages: extractTotalPages(html),
    totalReviews: extractTotalReviews(html),
  };
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Validate/normalise a single row coming from the bookmarklet upload path. */
export function coerceRow(input: unknown): BackloggdRow | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;

  const game_slug = typeof r.game_slug === "string" ? r.game_slug.trim().toLowerCase() : "";
  if (!SLUG_RE.test(game_slug)) return null;

  const review_text = typeof r.review_text === "string" ? r.review_text.trim() : "";
  if (!review_text) return null;

  let rating: number | null = null;
  if (typeof r.rating === "number" && r.rating > 0) {
    rating = Math.min(5, Math.max(0.5, Math.round(r.rating * 2) / 2));
  }

  const yearNum =
    typeof r.release_year === "number"
      ? r.release_year
      : typeof r.release_year === "string"
        ? parseInt(r.release_year, 10)
        : NaN;
  const release_year = yearNum >= 1950 && yearNum <= 2100 ? yearNum : null;

  const game_title =
    typeof r.game_title === "string" && r.game_title.trim()
      ? r.game_title.trim().slice(0, 300)
      : game_slug.replace(/-/g, " ");

  const platform_name =
    typeof r.platform_name === "string" && r.platform_name.trim()
      ? r.platform_name.trim().slice(0, 120)
      : null;

  const source_url =
    typeof r.source_url === "string" && /^https:\/\/(www\.)?backloggd\.com\//.test(r.source_url)
      ? r.source_url
      : `https://backloggd.com/games/${game_slug}/`;

  return {
    game_slug,
    game_title,
    release_year,
    rating,
    review_text: review_text.slice(0, 20000),
    review_date: parseBackloggdDate(typeof r.review_date === "string" ? r.review_date : null),
    platform_name,
    play_status: typeof r.play_status === "string" ? r.play_status.trim().toLowerCase() || null : null,
    contains_spoilers: r.contains_spoilers === true,
    source_url,
  };
}

// ─── Library import ─────────────────────────────────────────────────────────────
// The reviews pages are not bot-challenged, but the games/library pages
// (/u/<user>/games/) are — Backloggd serves an Anubis proof-of-work page there
// that a server-side fetch can't solve. So the library is acquired only via the
// browser (console snippet / bookmarklet) and uploaded; `parseGamesPage` runs in
// that browser context against the games grid, which reuses Backloggd's standard
// `game-cover` card:
//   <a href="/games/<slug>/" ...><div class="card ... game-cover" ... game_id="123">
//      <img class="card-img height" src="...co....jpg" alt="Title"></div></a>
// The play status is not read from the card — the scraper fetches each
// `type:<status>` filter URL separately and tags the rows with that status.

export type BacklogGameRow = {
  game_slug: string;
  game_title: string;
  release_year: number | null;
  /** Raw Backloggd status filter this game came from (played/playing/backlog/…). */
  backloggd_status: string;
};

export type ParsedGamesPage = {
  slugs: { game_slug: string; game_title: string }[];
  totalPages: number | null;
};

/** True if `html` is the Anubis "Making sure you're not a bot" interstitial. */
export function isChallengePage(html: string): boolean {
  return (
    /id="anubis_challenge"/.test(html) ||
    /making sure you(?:&#39;|')?re not a bot/i.test(html) ||
    /within\.website\/x\/cmd\/anubis/.test(html)
  );
}

/** Parse one page of the games grid — slugs + titles + pager. Best-effort. */
export function parseGamesPage(html: string): ParsedGamesPage {
  const slugs: { game_slug: string; game_title: string }[] = [];
  const seen = new Set<string>();

  // Every game-cover card is an <a href="/games/<slug>/"> wrapping an <img alt="Title">.
  const cardRe =
    /<a[^>]+href="\/games\/([a-z0-9-]+)\/"[^>]*>[\s\S]{0,400}?<img[^>]*\balt="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(html))) {
    const slug = m[1];
    if (seen.has(slug)) continue;
    seen.add(slug);
    slugs.push({ game_slug: slug, game_title: decodeEntities(m[2]).trim() || slug.replace(/-/g, " ") });
  }

  // Fallback: bare /games/<slug>/ links if the card regex matched nothing
  // (markup drift) — still lets a status transfer even without the title.
  if (slugs.length === 0) {
    for (const mm of html.matchAll(/href="\/games\/([a-z0-9-]+)\/"/g)) {
      const slug = mm[1];
      if (seen.has(slug)) continue;
      seen.add(slug);
      slugs.push({ game_slug: slug, game_title: slug.replace(/-/g, " ") });
    }
  }

  let totalPages: number | null = null;
  const nav = html.match(/<nav[^>]*class="[^"]*\bpagy\b[^"]*"[^>]*>([\s\S]*?)<\/nav>/i);
  if (nav) {
    let max = 1;
    for (const mm of nav[1].matchAll(/[?&]page=(\d+)/g)) {
      const n = parseInt(mm[1], 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
    totalPages = max;
  }

  return { slugs, totalPages };
}

/** Our `user_game_status.status` values. */
export type LibraryStatus = "completed" | "playing" | "want_to_play" | "dropped";

// Backloggd status filter value -> our status. Backloggd's "Played" is the
// broad "I've played this" bucket, which maps to our closest equivalent,
// `completed`. Backlog + Wishlist both mean "want to play". Retired / Shelved /
// Abandoned mean the player stopped -> `dropped`.
const STATUS_MAP: Record<string, LibraryStatus> = {
  played: "completed",
  completed: "completed",
  mastered: "completed",
  playing: "playing",
  backlog: "want_to_play",
  wishlist: "want_to_play",
  retired: "dropped",
  shelved: "dropped",
  abandoned: "dropped",
};

/** All Backloggd status filters worth scraping, most-committed first (so a game
 *  that's e.g. both played and wishlisted keeps the "played" mapping). */
export const BACKLOGGD_STATUS_FILTERS = [
  "completed",
  "played",
  "mastered",
  "playing",
  "retired",
  "shelved",
  "abandoned",
  "backlog",
  "wishlist",
];

export function mapBackloggdStatus(raw: string | null | undefined): LibraryStatus | null {
  if (!raw) return null;
  return STATUS_MAP[raw.trim().toLowerCase()] ?? null;
}

/** Validate one row from an uploaded library export. */
export function coerceLibraryRow(input: unknown): BacklogGameRow | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;

  const game_slug = typeof r.game_slug === "string" ? r.game_slug.trim().toLowerCase() : "";
  if (!SLUG_RE.test(game_slug)) return null;

  if (typeof r.backloggd_status !== "string" || !mapBackloggdStatus(r.backloggd_status)) return null;

  const yearNum =
    typeof r.release_year === "number"
      ? r.release_year
      : typeof r.release_year === "string"
        ? parseInt(r.release_year, 10)
        : NaN;

  const game_title =
    typeof r.game_title === "string" && r.game_title.trim()
      ? r.game_title.trim().slice(0, 300)
      : game_slug.replace(/-/g, " ");

  return {
    game_slug,
    game_title,
    release_year: yearNum >= 1950 && yearNum <= 2100 ? yearNum : null,
    backloggd_status: r.backloggd_status.trim().toLowerCase(),
  };
}
