import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";
import { classifyText } from "../../../utils/moderation/openaiModeration";
import { fileAutoReport } from "../../../utils/moderation/autoReport";
import { finalizePublishedReview } from "../../../utils/reviewPublish";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { review_id, score, title, body: reviewBody, platform_played_on, play_time_hours, contains_spoilers, status } =
    await context.request.json();

  if (!review_id) return json({ error: "Missing review id." }, 400);

  // Verify ownership + current state
  const { data: review } = await db
    .from("reviews").select("id, profile_id, game_id, status").eq("id", review_id).maybeSingle();
  if (!review) return json({ error: "Review not found." }, 404);
  if (review.profile_id !== profile.id) return json({ error: "Forbidden." }, 403);

  // Target status: explicit param wins; otherwise keep the row's current status
  // (so the EditModal path — which sends no status — behaves exactly as before).
  const targetStatus = status === "draft" || status === "published" ? status : review.status ?? "published";

  // ── Saving draft edits: only a body is required. ──
  if (targetStatus === "draft") {
    if (!reviewBody?.trim()) return json({ error: "Write something before saving a draft." }, 400);

    const { error: draftError } = await db
      .from("reviews")
      .update({
        score: score ?? null,
        title: title?.trim() || null,
        body: reviewBody.trim(),
        platform_played_on: platform_played_on || null,
        play_time_hours: play_time_hours ? parseInt(play_time_hours) : null,
        contains_spoilers: contains_spoilers ?? false,
        status: "draft",
      })
      .eq("id", review_id);

    if (draftError) {
      console.error("[reviews/update] draft save error:", JSON.stringify(draftError));
      return json({ error: draftError.message }, 500);
    }
    return json({ success: true, status: "draft" });
  }

  // ── Published path (an ordinary edit, or a draft being published) ──
  if (!score || !title || !reviewBody)
    return json({ error: "Missing required fields." }, 400);
  if (parseFloat(score) < 0.1 || parseFloat(score) > 10)
    return json({ error: "Score must be between 0.1 and 10." }, 400);
  if (reviewBody.length > 5000)
    return json({ error: "Review must be at most 5000 characters." }, 400);

  const publishing = review.status !== "published";

  // Enforce one published review per game before flipping status (friendlier than
  // letting the reviews_one_published_per_game partial unique index throw).
  if (publishing) {
    const { data: existingPublished } = await db
      .from("reviews").select("id")
      .eq("profile_id", profile.id).eq("game_id", review.game_id).eq("status", "published")
      .neq("id", review_id).maybeSingle();
    if (existingPublished) return json({ error: "You've already published a review for this game." }, 409);
  }

  const updatePayload: Record<string, unknown> = {
    score: parseFloat(score),
    title: title.trim(),
    body: reviewBody.trim(),
    platform_played_on: platform_played_on || null,
    play_time_hours: play_time_hours ? parseInt(play_time_hours) : null,
    contains_spoilers: contains_spoilers ?? false,
  };
  if (publishing) {
    updatePayload.status = "published";
    updatePayload.published_at = new Date().toISOString();
  }

  const { error: updateError } = await db.from("reviews").update(updatePayload).eq("id", review_id);
  if (updateError) {
    console.error("[reviews/update] update error:", JSON.stringify(updateError));
    return json({ error: updateError.message }, 500);
  }

  // A plain edit of an already-published review keeps the original behaviour:
  // no re-notification, no moderation re-screen, no reveal card.
  if (!publishing) return json({ success: true });

  // Publishing a draft: screen the text, then run the shared publish side-effects.
  const moderationDone = classifyText(`${title}\n${reviewBody}`)
    .then((result) => {
      if (result.flagged) {
        return fileAutoReport(db, { targetType: "review", targetId: review_id, categories: result.categories });
      }
    })
    .catch((e) => console.error("[reviews/update] moderation error (non-fatal):", e));

  const reveal = await finalizePublishedReview(db, {
    reviewId: review_id,
    gameId: review.game_id,
    profileId: profile.id,
    score: parseFloat(score),
  });

  await moderationDone;

  return json({ success: true, status: "published", ...reveal });
};
