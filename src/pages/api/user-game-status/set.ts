import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

const VALID_STATUSES = ["playing", "want_to_play", "owned", "completed", "hundred_percent", "dropped"] as const;

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json();
  const { game_id, status, owned } = body;

  if (!game_id) return json({ error: "game_id is required" }, 400);

  // null status = remove tracking entirely
  if (status === null) {
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

  // status omitted, owned provided = update the ownership flag only, leave status untouched
  if (status === undefined) {
    if (typeof owned !== "boolean") {
      return json({ error: "status or owned is required" }, 400);
    }
    const { error } = await db.from("user_game_status")
      .update({ is_owned: owned, updated_at: new Date().toISOString() })
      .eq("profile_id", profile.id)
      .eq("game_id", game_id);
    if (error) {
      console.error("[user-game-status/set] owned-only update error:", JSON.stringify(error));
      return json({ error: "Failed to update owned flag" }, 500);
    }
    return json({ owned });
  }

  if (!VALID_STATUSES.includes(status)) {
    return json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` }, 400);
  }

  // Owned is not mutually exclusive with status — every status except
  // want_to_play implies ownership by default, but the caller can override
  // (e.g. "completed it on a friend's console").
  const isOwned = typeof owned === "boolean" ? owned : status !== "want_to_play";

  const { error } = await db.from("user_game_status").upsert({
    profile_id: profile.id,
    game_id,
    status,
    is_owned: isOwned,
    updated_at: new Date().toISOString(),
  }, { onConflict: "profile_id,game_id" });

  if (error) {
    console.error("[user-game-status/set] error:", JSON.stringify(error));
    return json({ error: "Failed to update status" }, 500);
  }

  return json({ status, owned: isOwned });
};
