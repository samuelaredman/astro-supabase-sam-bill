// Server-side fetch of a Backloggd reviews page. Kept separate from parse.ts so
// the parser stays I/O-free and reusable in the browser bookmarklet.

import { isChallengePage } from "./parse";

export class BackloggdRateLimited extends Error {
  retryAfterSeconds: number;
  constructor(retryAfterSeconds = 60) {
    super("Backloggd is rate-limiting requests");
    this.name = "BackloggdRateLimited";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class BackloggdUserNotFound extends Error {
  constructor(username: string) {
    super(`Backloggd user "${username}" not found`);
    this.name = "BackloggdUserNotFound";
  }
}

// Backloggd fronts some paths (notably the games/library pages) with an Anubis
// proof-of-work interstitial that a serverless fetch can't solve. Thrown so the
// route can tell the user to use the browser/upload method instead.
export class BackloggdChallenged extends Error {
  constructor() {
    super("Backloggd served a bot challenge");
    this.name = "BackloggdChallenged";
  }
}

const UA =
  "ChekpointImporter/1.0 (+https://chekpoint.gg; review import for the account owner)";

// Backloggd usernames: letters, digits, underscore, hyphen. Also tolerate a
// pasted full profile URL and pull the handle out of it.
export function normalizeUsername(raw: string): string | null {
  let value = (raw ?? "").trim();
  const urlMatch = value.match(/backloggd\.com\/u\/([^/?#\s]+)/i);
  if (urlMatch) value = urlMatch[1];
  value = value.replace(/^@/, "").trim();
  return /^[A-Za-z0-9_-]{1,32}$/.test(value) ? value : null;
}

export function reviewsPageUrl(username: string, page: number): string {
  return `https://backloggd.com/u/${encodeURIComponent(username)}/reviews?page=${page}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch one reviews page as raw HTML. Retries once on 429/5xx with a short
 * back-off, then throws BackloggdRateLimited so the caller can surface a
 * "try again shortly" state and keep the job resumable.
 */
export async function fetchReviewsPage(username: string, page: number): Promise<string> {
  const url = reviewsPageUrl(username, page);

  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
        redirect: "follow",
      });
    } catch {
      if (attempt === 0) {
        await sleep(1500);
        continue;
      }
      throw new BackloggdRateLimited(30);
    }

    if (res.status === 404) throw new BackloggdUserNotFound(username);

    if (res.status === 429 || res.status === 403 || res.status >= 500) {
      const retryAfter = parseInt(res.headers.get("retry-after") ?? "", 10);
      if (attempt === 0) {
        await sleep(Number.isNaN(retryAfter) ? 2000 : Math.min(retryAfter, 10) * 1000);
        continue;
      }
      throw new BackloggdRateLimited(Number.isNaN(retryAfter) ? 60 : retryAfter);
    }

    if (!res.ok) throw new Error(`Backloggd returned HTTP ${res.status}`);
    const html = await res.text();
    if (isChallengePage(html)) throw new BackloggdChallenged();
    return html;
  }

  throw new BackloggdRateLimited(60);
}
