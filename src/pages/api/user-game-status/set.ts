import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";

const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const VALID_STATUSES = ["playing", "want_to_play", "completed", "dropped"] as const;

export const POST: APIRoute = async (context) => {
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const db = getSupabaseAdmin() as any;

  const { data: profile } = await db
    .from("profiles").select("id").eq("auth_user_id", user.id).single();
  if (!profile) return json({ error: "Profile not found" }, 404);

  const body = await context.request.json();
  const { game_id, status } = body;

  if (!game_id) return json({ error: "game_id is required" }, 400);

  // null status = remove tracking entirely
  if (status === null || status === undefined) {
    await db.from("user_game_status")
      .delete()
      .eq("profile_id", profile.id)
      .eq("game_id", game_id);
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
