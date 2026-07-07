import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";
import { classifyText } from "../../../utils/moderation/openaiModeration";
import { fileAutoReport } from "../../../utils/moderation/autoReport";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { source_game_id, target_game_id, body, contains_spoilers } = await context.request.json();

  if (!source_game_id || !target_game_id || !body?.trim())
    return json({ error: "source_game_id, target_game_id and body are required." }, 400);
  if (source_game_id === target_game_id)
    return json({ error: "Pick two different games." }, 400);
  if (body.trim().length > 5000)
    return json({ error: "Recommendation must be 5000 characters or fewer." }, 400);

  // One recommendation per author per directional game pair
  const { data: existing } = await (db as any)
    .from("recommendations")
    .select("id")
    .eq("profile_id", profile.id)
    .eq("source_game_id", source_game_id)
    .eq("target_game_id", target_game_id)
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

  // ── Notify followers with notify = true (non-blocking) ──
  try {
    const { data: notifyFollowers } = await (db as any)
      .from("follows").select("follower_id")
      .eq("following_id", profile.id).eq("notify", true).neq("follower_id", profile.id);

    const rows = (notifyFollowers ?? []).map((f: any) => ({
      profile_id: f.follower_id,
      type: "follow_recommendation",
      recommendation_id: inserted.id,
      actor_profile_id: profile.id,
    }));

    if (rows.length > 0) await (db as any).from("notifications").insert(rows);
  } catch (e) {
    console.error("[recommendations/create] notification error (non-fatal):", e);
  }

  await moderationDone;

  return json({ recommendation_id: inserted.id });
};
