// Server-side fetch of a Steam user's recommendations page. Kept separate
// from parse.ts so the parser stays I/O-free and unit-testable.

export class SteamProfilePrivate extends Error {
  constructor(steamId: string) {
    super(`Steam profile ${steamId} has private reviews`);
    this.name = "SteamProfilePrivate";
  }
}

export class SteamRateLimited extends Error {
  retryAfterSeconds: number;
  constructor(retryAfterSeconds = 60) {
    super("Steam Community is rate-limiting requests");
    this.name = "SteamRateLimited";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class SteamProfileNotFound extends Error {
  constructor(steamId: string) {
    super(`Steam profile ${steamId} not found`);
    this.name = "SteamProfileNotFound";
  }
}

// Steam's Cloudflare front rejects generic "curl/…" and gives an odd html shell
// to unknown UAs. A real browser string sails through and is what every other
// Steam scraper uses. This is our own account owner's data on their behalf.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export function recommendationsUrl(steamId64: string, page: number): string {
  const p = Math.max(1, Math.floor(page));
  return `https://steamcommunity.com/profiles/${steamId64}/recommended/?p=${p}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch one recommendations page as raw HTML. Retries once on 429/5xx before
 * throwing SteamRateLimited so the caller can surface a "try again shortly"
 * state and keep the job resumable — same shape as the Backloggd fetcher.
 */
export async function fetchRecommendationsPage(
  steamId64: string,
  page: number,
): Promise<string> {
  const url = recommendationsUrl(steamId64, page);

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
      throw new SteamRateLimited(30);
    }

    if (res.status === 404) throw new SteamProfileNotFound(steamId64);

    if (res.status === 429 || res.status === 403 || res.status >= 500) {
      const retryAfter = parseInt(res.headers.get("retry-after") ?? "", 10);
      if (attempt === 0) {
        await sleep(Number.isNaN(retryAfter) ? 2000 : Math.min(retryAfter, 10) * 1000);
        continue;
      }
      throw new SteamRateLimited(Number.isNaN(retryAfter) ? 60 : retryAfter);
    }

    if (!res.ok) throw new Error(`Steam returned HTTP ${res.status}`);
    return res.text();
  }

  throw new SteamRateLimited(60);
}

/**
 * Fetch the profile's owned games via IPlayerService/GetOwnedGames. Used at
 * scrape time so each item can be tagged with its title (the recommendations
 * page doesn't include one). Returns { appid -> name } — silently empty on
 * failure since matching can still fall back to appid-only lookups.
 */
export async function fetchOwnedGamesTitles(
  steamId64: string,
  apiKey: string,
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  try {
    const res = await fetch(
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId64}&include_appinfo=true&include_played_free_games=true`,
    );
    if (!res.ok) return out;
    const data = (await res.json()) as {
      response?: { games?: Array<{ appid: number; name?: string }> };
    };
    for (const g of data.response?.games ?? []) {
      if (g.name) out.set(g.appid, g.name);
    }
  } catch {
    /* non-fatal — matching will fall back to appid-only */
  }
  return out;
}
