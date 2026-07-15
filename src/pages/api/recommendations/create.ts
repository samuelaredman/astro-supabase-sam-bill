import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";
import { classifyText } from "../../../utils/moderation/openaiModeration";
import { fileAutoReport } from "../../../utils/moderation/autoReport";
import { notifyRecommendationPublished } from "../../../utils/recommendationPublish";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { source_game_id, target_game_id, body, contains_spoilers, status } = await context.request.json();
  const isDraft = status === "draft";

  // Both games are always required — the whole post is "if you liked A, try B".
  if (!source_game_id || !target_game_id)
    return json({ error: "Pick both games." }, 400);
  if (source_game_id === target_game_id)
    return json({ error: "Pick two different games." }, 400);
  if (body && body.trim().length > 5000)
    return json({ error: "Recommendation must be 5000 characters or fewer." }, 400);

  // ── Draft path: body optional, no dedupe against published, no notifications. ──
  if (isDraft) {
    const { data: inserted, error: draftError } = await (db as any)
      .from("recommendations")
      .insert({
        profile_id: profile.id,
        source_game_id,
        target_game_id,
        body: body?.trim() ?? "",
        contains_spoilers: contains_spoilers ?? false,
        status: "draft",
      })
      .select("id")
      .single();

    if (draftError) {
      console.error("[recommendations/create] draft insert error:", JSON.stringify(draftError));
      return json({ error: "Failed to save draft." }, 500);
    }

    return json({ recommendation_id: inserted.id, status: "draft" });
  }

  // ── Published path ──
  if (!body?.trim())
    return json({ error: "source_game_id, target_game_id and body are required." }, 400);

  // One published recommendation per author per directional game pair
  const { data: existing } = await (db as any)
    .from("recommendations")
    .select("id")
    .eq("profile_id", profile.id)
    .eq("source_game_id", source_game_id)
    .eq("target_game_id", target_game_id)
    .eq("status", "published")
    .maybeSingle();

  if (existing) return json({ error: "You've already made this recommendation." }, 409);

  const { data: inserted, error: insertError } = await (db as any)
    .from("recommendations")
    .insert({
      profile_id: profile.id,
      source_game_id,
      target_game_id,
      body: body.trim(),
      contains_spoilers: contains_spoilers ?? false,
      status: "published",
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("[recommendations/create] insert error:", JSON.stringify(insertError));
    return json({ error: "Failed to create recommendation." }, 500);
  }

  // ── Screen the body for explicit content — never fails the request, but must be
  // awaited before returning (serverless freezes on response). Runs concurrently
  // with the notification work below. ──
  const moderationDone = classifyText(body.trim())
    .then((result) => {
      if (result.flagged) {
        return fileAutoReport(db, { targetType: "recommendation", targetId: inserted.id, categories: result.categories });
      }
    })
    .catch((e) => console.error("[recommendations/create] moderation error (non-fatal):", e));

  await notifyRecommendationPublished(db, { recommendationId: inserted.id, profileId: profile.id });

  await moderationDone;

  return json({ recommendation_id: inserted.id });
};
