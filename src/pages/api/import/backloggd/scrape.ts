import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";
import { parseReviewsPage } from "../../../../utils/backloggd/parse";
import {
  BackloggdChallenged,
  BackloggdRateLimited,
  fetchReviewsPage,
} from "../../../../utils/backloggd/fetchPage";
import { loadOwnedJob } from "../../../../utils/backloggd/job";

const MAX_SPAN = 5; // pages per call — keeps the request well under the function limit
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
  if (job.status !== "scraping" || !job.backloggd_username) {
    return json({ error: "This job is not in the scraping phase.", status: job.status }, 409);
  }

  const totalPages = job.total_pages ?? 1;
  const toPage = Math.min(totalPages, fromPage + MAX_SPAN - 1);
  const username = job.backloggd_username;

  // Slugs already stored for this job — avoid inserting the same game twice.
  const { data: existing } = await db
    .from("import_job_items")
    .select("game_slug")
    .eq("job_id", jobId);
  const seen = new Set<string>((existing ?? []).map((r: { game_slug: string }) => r.game_slug));

  const toInsert: {
    job_id: string;
    game_slug: string;
    game_title: string;
    release_year: number | null;
    rating: number | null;
    review_text: string;
    review_date: string | null;
    platform_name: string | null;
    contains_spoilers: boolean;
    source_url: string;
  }[] = [];

  try {
    for (let page = fromPage; page <= toPage; page++) {
      if (page > fromPage) await sleep(PAGE_DELAY_MS);
      const html = await fetchReviewsPage(username, page);
      const parsed = parseReviewsPage(html, username);
      for (const row of parsed.rows) {
        if (seen.has(row.game_slug)) continue;
        seen.add(row.game_slug);
        toInsert.push({
          job_id: jobId,
          game_slug: row.game_slug,
          game_title: row.game_title,
          release_year: row.release_year,
          rating: row.rating,
          review_text: row.review_text,
          review_date: row.review_date,
          platform_name: row.platform_name,
          contains_spoilers: row.contains_spoilers,
          source_url: row.source_url,
        });
      }
    }
  } catch (e) {
    if (toInsert.length) await db.from("import_job_items").insert(toInsert);
    if (e instanceof BackloggdRateLimited) {
      return json(
        {
          error: "Backloggd is rate-limiting us. The import will resume automatically.",
          retry_after: e.retryAfterSeconds,
          next_page: fromPage, // retry the same span
          total_pages: totalPages,
        },
        503,
      );
    }
    if (e instanceof BackloggdChallenged) {
      await db.from("import_jobs").update({ status: "failed", error: "backloggd bot challenge" }).eq("id", jobId);
      return json(
        { error: "Backloggd started blocking automated access mid-import. Use the manual method in Settings to finish.", challenged: true },
        503,
      );
    }
    console.error("[import/backloggd/scrape] error:", e);
    return json({ error: "Scrape failed. Try again shortly.", next_page: fromPage }, 502);
  }

  if (toInsert.length) {
    const { error: insErr } = await db.from("import_job_items").insert(toInsert);
    if (insErr) {
      console.error("[import/backloggd/scrape] items insert error:", JSON.stringify(insErr));
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
