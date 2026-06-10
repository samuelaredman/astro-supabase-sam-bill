import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

const VALID_PRIVACY = ["public", "friends", "private"] as const;

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

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
