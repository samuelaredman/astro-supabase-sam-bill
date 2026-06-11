import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json();
  const { game_id, hidden } = body;

  if (!game_id || typeof hidden !== "boolean")
    return json({ error: "game_id and hidden (boolean) are required" }, 400);

  const { data: existing } = await db
    .from("user_game_status")
    .select("id")
    .eq("profile_id", profile.id)
    .eq("game_id", game_id)
    .maybeSingle();

  if (!existing) {
    // Add to library as owned+hidden if not yet tracked
    const { error } = await db.from("user_game_status").insert({
      profile_id: profile.id,
      game_id,
      status: "owned",
      is_hidden: hidden,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      console.error("[toggle-hidden] insert error:", JSON.stringify(error));
      return json({ error: "Failed to update" }, 500);
    }
    return json({ hidden });
  }

  const { error } = await db
    .from("user_game_status")
    .update({ is_hidden: hidden, updated_at: new Date().toISOString() })
    .eq("profile_id", profile.id)
    .eq("game_id", game_id);

  if (error) {
    console.error("[toggle-hidden] update error:", JSON.stringify(error));
    return json({ error: "Failed to update" }, 500);
  }

  return json({ hidden });
};
