import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

const VALID_PRIVACY = ["public", "friends", "private"] as const;

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json();
  const updates: Record<string, string | boolean | null> = {};

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

  // GDPR opt-in consent for search-engine indexing of the user's public profile
  // and authored content. Record the consent timestamp when enabling; clear it
  // on withdrawal so the audit trail reflects only currently-valid consent.
  if (body.search_indexable !== undefined) {
    if (typeof body.search_indexable !== "boolean") {
      return json({ error: "Invalid search_indexable value" }, 400);
    }
    updates.search_indexable = body.search_indexable;
    updates.search_indexable_at = body.search_indexable ? new Date().toISOString() : null;
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
