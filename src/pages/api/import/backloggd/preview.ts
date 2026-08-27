import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";
import { parseReviewsPage } from "../../../../utils/backloggd/parse";
import {
  BackloggdChallenged,
  BackloggdRateLimited,
  BackloggdUserNotFound,
  fetchReviewsPage,
  normalizeUsername,
} from "../../../../utils/backloggd/fetchPage";

// POST { username } -> { username, totalReviews, totalPages, sample[] }
// Fetches page 1 only so the UI can confirm "Found N reviews — import?".
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const username = normalizeUsername(String(body?.username ?? ""));
  if (!username) return json({ error: "Enter a valid Backloggd username." }, 400);

  try {
    const html = await fetchReviewsPage(username, 1);
    const parsed = parseReviewsPage(html, username);

    if (parsed.rows.length === 0 && !parsed.totalReviews) {
      return json(
        { error: `No public reviews found for "${username}". Check the spelling, or use the manual method below.` },
        404,
      );
    }

    return json({
      username,
      totalReviews: parsed.totalReviews ?? parsed.rows.length,
      totalPages: parsed.totalPages ?? 1,
      sample: parsed.rows.slice(0, 5),
    });
  } catch (e) {
    if (e instanceof BackloggdUserNotFound) {
      return json({ error: `Backloggd has no user called "${username}".` }, 404);
    }
    if (e instanceof BackloggdRateLimited) {
      return json(
        { error: "Backloggd is rate-limiting us right now. Try again in a minute.", retry_after: e.retryAfterSeconds },
        503,
      );
    }
    if (e instanceof BackloggdChallenged) {
      return json(
        { error: "Backloggd is blocking automated access right now. Use the manual method below (console + file upload).", challenged: true },
        503,
      );
    }
    console.error("[import/backloggd/preview] error:", e);
    return json({ error: "Could not reach Backloggd. Try again shortly." }, 502);
  }
};
