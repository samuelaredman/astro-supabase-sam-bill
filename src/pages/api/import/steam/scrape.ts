import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";
import {
  fetchOwnedGamesTitles,
  fetchRecommendationsPage,
  SteamRateLimited,
} from "../../../../utils/steam-reviews/fetchPage";
import { parseRecommendationsPage } from "../../../../utils/steam-reviews/parse";
import { loadOwnedJob } from "../../../../utils/importJob";

const MAX_SPAN = 5; // pages per call — keeps us well under the function limit
const PAGE_DELAY_MS = 800;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// POST { job_id, from_page } -> scrape up to MAX_SPAN pages, insert items,
// return { next_page, total_pages, total_items, done }.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const jobId = String(body?.job_id ?? "");
  const fromPage = Math.max(1, parseInt(String(body?.from_page ?? "1"), 10) || 1);
  if (!jobId) return json({ error: "Missing job_id." }, 400);

  const job = await loadOwnedJob(db, profile.id, jobId);
  if (!job) return json({ error: "Import job not found." }, 404);
  if (job.status !== "scraping" || job.source !== "steam") {
    return json({ error: "This job is not a Steam scrape in progress.", status: job.status }, 409);
  }

  const { data: p } = await db
    .from("profiles")
    .select("steam_id")
    .eq("id", profile.id)
    .single();
  const steamId = p?.steam_id;
  if (!steamId) {
    return json({ error: "Steam is no longer connected. Reconnect and try again." }, 400);
  }

  const totalPages = job.total_pages ?? 1;
  const toPage = Math.min(totalPages, fromPage + MAX_SPAN - 1);

  // Load appid -> title once so items carry a title for the matching fallback.
  // The recommendations page has no title in the card, and we don't want the
  // per-item matcher to have to fetch GetOwnedGames every time.
  const steamApiKey = import.meta.env.STEAM_API_KEY as string | undefined;
  const titleByAppid = steamApiKey
    ? await fetchOwnedGamesTitles(steamId, steamApiKey)
    : new Map<number, string>();

  // Appids already stored for this job — avoid inserting the same review twice
  // when a span is retried after a partial failure.
  const { data: existing } = await db
    .from("import_job_items")
    .select("steam_appid")
    .eq("job_id", jobId);
  const seen = new Set<number>(
    (existing ?? [])
      .map((r: { steam_appid: number | null }) => r.steam_appid)
      .filter((v: number | null): v is number => v != null),
  );

  // game_slug stays NOT NULL on the table (Backloggd flow relies on it); Steam
  // items store an empty string since we identify them by steam_appid instead.
  const toInsert: Array<{
    job_id: string;
    game_slug: string;
    steam_appid: number;
    game_title: string;
    review_text: string;
    review_date: string | null;
    hours_at_review: number | null;
    contains_spoilers: boolean;
    source_url: string;
  }> = [];

  try {
    for (let page = fromPage; page <= toPage; page++) {
      if (page > fromPage) await sleep(PAGE_DELAY_MS);
      const html = await fetchRecommendationsPage(steamId, page);
      const parsed = parseRecommendationsPage(html, steamId);
      for (const row of parsed.rows) {
        if (seen.has(row.steam_appid)) continue;
        seen.add(row.steam_appid);
        toInsert.push({
          job_id: jobId,
          game_slug: "",
          steam_appid: row.steam_appid,
          game_title: row.game_title || titleByAppid.get(row.steam_appid) || "",
          review_text: row.review_text,
          review_date: row.review_date,
          hours_at_review: row.hours_at_review,
          contains_spoilers: false,
          source_url: row.source_url,
        });
      }
    }
  } catch (e) {
    if (toInsert.length) await db.from("import_job_items").insert(toInsert);
    if (e instanceof SteamRateLimited) {
      return json(
        {
          error: "Steam is rate-limiting us. The import will resume automatically.",
          retry_after: e.retryAfterSeconds,
          next_page: fromPage,
          total_pages: totalPages,
        },
        503,
      );
    }
    console.error("[import/steam/scrape] error:", e);
    return json({ error: "Scrape failed. Try again shortly.", next_page: fromPage }, 502);
  }

  if (toInsert.length) {
    const { error: insErr } = await db.from("import_job_items").insert(toInsert);
    if (insErr) {
      console.error("[import/steam/scrape] items insert error:", JSON.stringify(insErr));
      return json({ error: "Could not save scraped reviews.", next_page: fromPage }, 500);
    }
  }

  const { count: totalItems } = await db
    .from("import_job_items")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId);

  const done = toPage >= totalPages;
  await db
    .from("import_jobs")
    .update({
      total_items: totalItems ?? 0,
      scraped_pages: Math.max(job.scraped_pages ?? 0, toPage),
      status: done ? "importing" : "scraping",
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  return json({
    next_page: done ? null : toPage + 1,
    total_pages: totalPages,
    total_items: totalItems ?? 0,
    done,
  });
};
