import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

// 7 days between consecutive posts of the same list. There is no unpost
// endpoint — allowing owners to clear the timestamp would let them bypass
// the cooldown by removing and immediately re-posting.
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

async function loadOwnedList(db: any, list_id: string, profileId: string) {
  if (!list_id) return { error: "list_id is required." as const, status: 400 as const };
  const { data: list } = await db
    .from("lists")
    .select("id, profile_id, visibility, last_posted_to_feed_at")
    .eq("id", list_id)
    .maybeSingle();
  if (!list) return { error: "List not found." as const, status: 404 as const };
  if (list.profile_id !== profileId) return { error: "Forbidden." as const, status: 403 as const };
  return { list };
}

// POST: push (or re-push) a list to the home feed, respecting the 7-day cooldown.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { list_id } = await context.request.json().catch(() => ({}));
  const loaded = await loadOwnedList(db, list_id, profile.id);
  if ("error" in loaded) return json({ error: loaded.error }, loaded.status);
  const { list } = loaded;

  if (list.visibility === "private") {
    return json({ error: "Only public lists can be posted to the feed." }, 400);
  }

  if (list.last_posted_to_feed_at) {
    const sinceMs = Date.now() - new Date(list.last_posted_to_feed_at).getTime();
    if (sinceMs < COOLDOWN_MS) {
      const remainingMs = COOLDOWN_MS - sinceMs;
      return json(
        {
          error: "This list was posted to the feed recently.",
          cooldown_remaining_ms: remainingMs,
          cooldown_remaining_days: Math.ceil(remainingMs / (24 * 60 * 60 * 1000)),
          last_posted_at: list.last_posted_to_feed_at,
        },
        429,
      );
    }
  }

  const now = new Date().toISOString();
  const { error } = await db
    .from("lists")
    .update({ last_posted_to_feed_at: now, shared_to_feed: true, updated_at: now })
    .eq("id", list.id);

  if (error) {
    console.error("[lists/post-to-feed] update error:", JSON.stringify(error));
    return json({ error: "Failed to post list to feed." }, 500);
  }

  return json({ success: true, last_posted_at: now });
};

