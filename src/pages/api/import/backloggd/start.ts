import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";
import { coerceRow, parseReviewsPage } from "../../../../utils/backloggd/parse";
import {
  BackloggdChallenged,
  BackloggdRateLimited,
  BackloggdUserNotFound,
  fetchReviewsPage,
  normalizeUsername,
} from "../../../../utils/backloggd/fetchPage";
import { loadActiveJob } from "../../../../utils/backloggd/job";

const MAX_UPLOAD_ROWS = 5000;

// POST { username }            -> start a server-side scrape job  ('scraping')
// POST { rows: BackloggdRow[] } -> start an upload job            ('importing')
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

  // One live job per user.
  const active = await loadActiveJob(db, profile.id);
  if (active) {
    return json(
      { error: "You already have an import in progress.", job_id: active.id, status: active.status },
      409,
    );
  }

  // ── Upload path ────────────────────────────────────────────────────────────
  if (Array.isArray(body?.rows)) {
    if (body.rows.length === 0) return json({ error: "The file has no reviews in it." }, 400);
    if (body.rows.length > MAX_UPLOAD_ROWS) {
      return json({ error: `That's more than ${MAX_UPLOAD_ROWS} reviews — split the file.` }, 400);
    }

    const rows = body.rows.map(coerceRow).filter(Boolean) as ReturnType<typeof coerceRow>[];
    if (rows.length === 0) return json({ error: "None of the rows in that file were valid." }, 400);

    // De-dupe within the upload by game slug (keep the last occurrence).
    const bySlug = new Map<string, (typeof rows)[number]>();
    for (const r of rows) bySlug.set(r!.game_slug, r);
    const deduped = [...bySlug.values()];

    const { data: job, error: jobErr } = await db
      .from("import_jobs")
      .insert({ profile_id: profile.id, source: "backloggd", status: "importing", total_items: deduped.length })
      .select("id")
      .single();
    if (jobErr || !job) {
      console.error("[import/backloggd/start] job insert error:", JSON.stringify(jobErr));
      return json({ error: "Could not start the import." }, 500);
    }

    for (let i = 0; i < deduped.length; i += 500) {
      const chunk = deduped.slice(i, i + 500).map((r) => ({
        job_id: job.id,
        game_slug: r!.game_slug,
        game_title: r!.game_title,
        release_year: r!.release_year,
        rating: r!.rating,
        review_text: r!.review_text,
        review_date: r!.review_date,
        platform_name: r!.platform_name,
        play_status: r!.play_status,
        contains_spoilers: r!.contains_spoilers,
        source_url: r!.source_url,
      }));
      const { error: itemsErr } = await db.from("import_job_items").insert(chunk);
      if (itemsErr) {
        console.error("[import/backloggd/start] items insert error:", JSON.stringify(itemsErr));
        await db.from("import_jobs").update({ status: "failed", error: "item insert failed" }).eq("id", job.id);
        return json({ error: "Could not save the uploaded reviews." }, 500);
      }
    }

    return json({ job_id: job.id, status: "importing", total_items: deduped.length });
  }

  // ── Username scrape path ──────────────────────────────────────────────────
  const username = normalizeUsername(String(body?.username ?? ""));
  if (!username) return json({ error: "Enter a valid Backloggd username." }, 400);

  try {
    const html = await fetchReviewsPage(username, 1);
    const parsed = parseReviewsPage(html, username);
    if (parsed.rows.length === 0 && !parsed.totalReviews) {
      return json({ error: `No public reviews found for "${username}".` }, 404);
    }

    const { data: job, error: jobErr } = await db
      .from("import_jobs")
      .insert({
        profile_id: profile.id,
        source: "backloggd",
        backloggd_username: username,
        status: "scraping",
        total_pages: parsed.totalPages ?? 1,
      })
      .select("id")
      .single();
    if (jobErr || !job) {
      console.error("[import/backloggd/start] job insert error:", JSON.stringify(jobErr));
      return json({ error: "Could not start the import." }, 500);
    }

    return json({
      job_id: job.id,
      status: "scraping",
      username,
      total_pages: parsed.totalPages ?? 1,
      total_reviews: parsed.totalReviews ?? parsed.rows.length,
    });
  } catch (e) {
    if (e instanceof BackloggdUserNotFound) {
      return json({ error: `Backloggd has no user called "${username}".` }, 404);
    }
    if (e instanceof BackloggdRateLimited) {
      return json({ error: "Backloggd is rate-limiting us. Try again in a minute.", retry_after: e.retryAfterSeconds }, 503);
    }
    if (e instanceof BackloggdChallenged) {
      return json({ error: "Backloggd is blocking automated access. Use the manual method below.", challenged: true }, 503);
    }
    console.error("[import/backloggd/start] scrape error:", e);
    return json({ error: "Could not reach Backloggd. Try again shortly." }, 502);
  }
};
