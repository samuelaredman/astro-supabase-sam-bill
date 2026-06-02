import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";

const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const VALID_PRIVACY = ["public", "friends", "private"] as const;

export const POST: APIRoute = async (context) => {
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const db = getSupabaseAdmin() as any;

  const { data: profile } = await db
    .from("profiles").select("id").eq("auth_user_id", user.id).single();
  if (!profile) return json({ error: "Profile not found" }, 404);

  const body = await context.request.json();
  const updates: Record<string, string> = {};

  if (body.want_to_play_privacy !== undefined) {
    if (!VALID_PRIVACY.includes(body.want_to_play_privacy)) {
      return json({ error: "Invalid want_to_play_privacy value" }, 400);
    }
    updates.want_to_play_privacy = body.want_to_play_privacy;
  }
  if (body.dropped_privacy !== undefined) {
    if (!VALID_PRIVACY.includes(body.dropped_privacy)) {
      return json({ error: "Invalid dropped_privacy value" }, 400);
    }
    updates.dropped_privacy = body.dropped_privacy;
  }

  if (Object.keys(updates).length === 0) {
    return json({ error: "Nothing to update" }, 400);
  }

  const { error } = await db.from("profiles").update(updates).eq("id", profile.id);
  if (error) {
    console.error("[profile/privacy] error:", JSON.stringify(error));
    return json({ error: "Failed to update privacy settings" }, 500);
  }

  return json({ success: true, ...updates });
};
