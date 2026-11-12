import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";
import { resolveCanonicalGameId } from "../../../utils/games";

const VALID_STATUSES = ["playing", "want_to_play", "owned", "completed", "hundred_percent", "dropped"] as const;

// PostgREST encodes .in() values as URL query params; large arrays exceed URL length limits
// and get silently truncated, causing only a handful of rows to be affected. Chunking keeps
// each request well within safe URL limits.
const CHUNK_SIZE = 100;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json();
  const { action, status } = body;
  const rawGameIds: unknown = body.game_ids;

  if (!Array.isArray(rawGameIds) || rawGameIds.length === 0)
    return json({ error: "game_ids must be a non-empty array" }, 400);
  if (!["delete", "set_status"].includes(action))
    return json({ error: "action must be 'delete' or 'set_status'" }, 400);
  if (action === "set_status" && !VALID_STATUSES.includes(status))
    return json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` }, 400);

  // Resolve every id to its canonical row and de-dupe. The caller may pass a
  // mix of canonical and edition ids (e.g. a page built before the backfill);
  // both must act on the one canonical row rather than silently affect zero
  // rows for the editions.
  const resolved = await Promise.all(
    (rawGameIds as string[]).map((id) => resolveCanonicalGameId(db, id))
  );
  const canonical_ids = [...new Set(resolved)];

  if (action === "delete") {
    // Delete must target every row in each canonical group — not just the
    // canonical row — because older syncs wrote user_game_status at the
    // edition's game_id directly (before the canonical-collapse write path
    // was in place). A user clicking delete on their library card for a
    // deluxe/anniversary edition sends the edition's id; resolving to
    // canonical then deleting only the canonical leaves the edition row in
    // place and the card persists after "removal". Expand each canonical
    // into {canonical + all editions whose canonical_game_id = canonical}
    // and delete across the whole set in one shot.
    const affectedGameIds = new Set<string>(canonical_ids);
    for (const idChunk of chunk(canonical_ids, CHUNK_SIZE)) {
      const { data: editionRows, error: editionErr } = await db
        .from("games")
        .select("id")
        .in("canonical_game_id", idChunk);
      if (editionErr) {
        console.error("[bulk-update] edition lookup error:", JSON.stringify(editionErr));
        return json({ error: "Failed to delete entries" }, 500);
      }
      for (const r of ((editionRows ?? []) as any[])) affectedGameIds.add(r.id);
    }
    const toDelete = [...affectedGameIds];
    for (const ids of chunk(toDelete, CHUNK_SIZE)) {
      const { error } = await db.from("user_game_status")
        .delete()
        .eq("profile_id", profile.id)
        .in("game_id", ids);
      if (error) {
        console.error("[bulk-update] delete error:", JSON.stringify(error));
        return json({ error: "Failed to delete entries" }, 500);
      }
    }
    return json({ affected: canonical_ids.length });
  }

  // set_status — upsert all. Owned is not mutually exclusive with status —
  // every status except want_to_play implies ownership by default.
  const isOwned = status !== "want_to_play";
  const rows = canonical_ids.map((game_id) => ({
    profile_id: profile.id,
    game_id,
    status,
    is_owned: isOwned,
    updated_at: new Date().toISOString(),
  }));
  for (const rowChunk of chunk(rows, CHUNK_SIZE)) {
    const { error } = await db.from("user_game_status")
      .upsert(rowChunk, { onConflict: "profile_id,game_id" });
    if (error) {
      console.error("[bulk-update] upsert error:", JSON.stringify(error));
      return json({ error: "Failed to update entries" }, 500);
    }
  }
  return json({ affected: canonical_ids.length });
};
