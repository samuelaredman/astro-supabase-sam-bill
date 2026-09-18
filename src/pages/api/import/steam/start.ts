import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";
import {
  fetchRecommendationsPage,
  SteamProfileNotFound,
  SteamProfilePrivate,
  SteamRateLimited,
} from "../../../../utils/steam-reviews/fetchPage";
import { parseRecommendationsPage } from "../../../../utils/steam-reviews/parse";
import { loadActiveJob } from "../../../../utils/importJob";

// POST {} -> { job_id, status, total_pages, total_reviews }
// Creates an import job for the caller's connected Steam account.
// Same "one active per user" rule as Backloggd — resume the existing job
// (any source) instead of starting a second.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const active = await loadActiveJob(db, profile.id);
  if (active) {
    return json(
      { error: "You already have an import in progress.", job_id: active.id, status: active.status },
      409,
    );
  }

  const { data: p } = await db
    .from("profiles")
    .select("steam_id")
    .eq("id", profile.id)
    .single();

  const steamId = p?.steam_id;
  if (!steamId) {
    return json(
      { error: "Connect your Steam account first (Settings → Steam)." },
      400,
    );
  }

  try {
    const html = await fetchRecommendationsPage(steamId, 1);
    const parsed = parseRecommendationsPage(html, steamId);

    if (parsed.isPrivate) {
      return json(
        {
          error:
            "Your Steam profile or reviews section is private. Set it to Public in Steam → Privacy Settings, then try again.",
          private: true,
        },
        403,
      );
    }
    if (parsed.rows.length === 0 && !parsed.totalReviews) {
      return json({ error: "No public Steam reviews found on this account." }, 404);
    }

    const { data: job, error: jobErr } = await db
      .from("import_jobs")
      .insert({
        profile_id: profile.id,
        source: "steam",
        status: "scraping",
        total_pages: parsed.totalPages ?? 1,
      })
      .select("id")
      .single();
    if (jobErr || !job) {
      console.error("[import/steam/start] job insert error:", JSON.stringify(jobErr));
      return json({ error: "Could not start the import." }, 500);
    }

    return json({
      job_id: job.id,
      status: "scraping",
      steamId,
      total_pages: parsed.totalPages ?? 1,
      total_reviews: parsed.totalReviews ?? parsed.rows.length,
    });
  } catch (e) {
    if (e instanceof SteamProfileNotFound) {
      return json({ error: "That Steam profile no longer exists." }, 404);
    }
    if (e instanceof SteamProfilePrivate) {
      return json(
        {
          error:
            "Your Steam profile or reviews section is private. Set it to Public in Steam → Privacy Settings, then try again.",
          private: true,
        },
        403,
      );
    }
    if (e instanceof SteamRateLimited) {
      return json(
        { error: "Steam is rate-limiting us. Try again in a minute.", retry_after: e.retryAfterSeconds },
        503,
      );
    }
    console.error("[import/steam/start] error:", e);
    return json({ error: "Could not reach Steam. Try again shortly." }, 502);
  }
};
