import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { review_id, score, title, body: reviewBody, platform_played_on, play_time_hours, contains_spoilers } = await context.request.json();

  if (!review_id || !score || !title || !reviewBody)
    return json({ error: "Missing required fields." }, 400);
  if (parseFloat(score) < 0.1 || parseFloat(score) > 10)
    return json({ error: "Score must be between 0.1 and 10." }, 400);
  if (reviewBody.length > 5000)
    return json({ error: "Review must be at most 5000 characters." }, 400);

  // Verify ownership
  const { data: review } = await db
    .from("reviews").select("id, profile_id").eq("id", review_id).maybeSingle();
  if (!review) return json({ error: "Review not found." }, 404);
  if (review.profile_id !== profile.id) return json({ error: "Forbidden." }, 403);

  const { error: updateError } = await db
    .from("reviews")
    .update({
      score: parseFloat(score),
      title: title.trim(),
      body: reviewBody.trim(),
      platform_played_on: platform_played_on || null,
      play_time_hours: play_time_hours ? parseInt(play_time_hours) : null,
      contains_spoilers: contains_spoilers ?? false,
    })
    .eq("id", review_id);

  if (updateError) return json({ error: updateError.message }, 500);
  return json({ success: true });
};
