import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

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
  const { game_ids, action, status } = body;

  if (!Array.isArray(game_ids) || game_ids.length === 0)
    return json({ error: "game_ids must be a non-empty array" }, 400);
  if (!["delete", "set_status"].includes(action))
    return json({ error: "action must be 'delete' or 'set_status'" }, 400);
  if (action === "set_status" && !VALID_STATUSES.includes(status))
    return json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` }, 400);

  if (action === "delete") {
    for (const ids of chunk(game_ids, CHUNK_SIZE)) {
      const { error } = await db.from("user_game_status")
        .delete()
        .eq("profile_id", profile.id)
        .in("game_id", ids);
      if (error) {
        console.error("[bulk-update] delete error:", JSON.stringify(error));
        return json({ error: "Failed to delete entries" }, 500);
      }
    }
    return json({ affected: game_ids.length });
  }

  // set_status — upsert all. Owned is not mutually exclusive with status —
  // every status except want_to_play implies ownership by default.
  const isOwned = status !== "want_to_play";
  const rows = game_ids.map((game_id: string) => ({
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
  return json({ affected: game_ids.length });
};
