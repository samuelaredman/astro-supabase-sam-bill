import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

const VALID_STATUSES = ["playing", "want_to_play", "completed", "dropped"] as const;

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json();
  const { game_id, status } = body;

  if (!game_id) return json({ error: "game_id is required" }, 400);

  // null status = remove tracking entirely
  if (status === null || status === undefined) {
    const { error: delError } = await db.from("user_game_status")
      .delete()
      .eq("profile_id", profile.id)
      .eq("game_id", game_id);
    if (delError) {
      console.error("[user-game-status/set] delete error:", JSON.stringify(delError));
      return json({ error: "Failed to remove status" }, 500);
    }
    return json({ status: null });
  }

  if (!VALID_STATUSES.includes(status)) {
    return json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` }, 400);
  }

  const { error } = await db.from("user_game_status").upsert({
    profile_id: profile.id,
    game_id,
    status,
    updated_at: new Date().toISOString(),
  }, { onConflict: "profile_id,game_id" });

  if (error) {
    console.error("[user-game-status/set] error:", JSON.stringify(error));
    return json({ error: "Failed to update status" }, 500);
  }

  return json({ status });
};
