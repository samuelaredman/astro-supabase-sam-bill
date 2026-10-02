import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";
import {
  fetchRecommendationsPage,
  SteamProfileNotFound,
  SteamProfilePrivate,
  SteamRateLimited,
} from "../../../../utils/steam-reviews/fetchPage";
import { parseRecommendationsPage } from "../../../../utils/steam-reviews/parse";

// POST {} -> { steamId, totalReviews, totalPages, sample[] }
// Uses the caller's connected Steam ID from their profile — Steam reviews
// aren't looked up by handle the way Backloggd is, we already have it from
// the OpenID connect flow (api/auth/steam-callback).
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

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

    return json({
      steamId,
      totalReviews: parsed.totalReviews ?? parsed.rows.length,
      totalPages: parsed.totalPages ?? 1,
      // Trim the sample so the response stays small — the UI only shows a peek.
      sample: parsed.rows.slice(0, 5).map((r) => ({
        steam_appid: r.steam_appid,
        review_text: r.review_text.slice(0, 240),
        review_date: r.review_date,
        hours_at_review: r.hours_at_review,
      })),
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
    console.error("[import/steam/preview] error:", e);
    return json({ error: "Could not reach Steam. Try again shortly." }, 502);
  }
};
