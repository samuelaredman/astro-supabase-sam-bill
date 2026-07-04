import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { list_id, game_id, notes } = await context.request.json();

  if (!list_id) return json({ error: "list_id is required." }, 400);
  if (!game_id) return json({ error: "game_id is required." }, 400);

  const { data: list } = await (db as any)
    .from("lists")
    .select("id, profile_id, is_ranked")
    .eq("id", list_id)
    .maybeSingle();

  if (!list) return json({ error: "List not found." }, 404);
  if (list.profile_id !== profile.id) return json({ error: "Forbidden." }, 403);

  let position: number | null = null;

  if (list.is_ranked) {
    const { data: last } = await (db as any)
      .from("list_entries")
      .select("position")
      .eq("list_id", list_id)
      .not("position", "is", null)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    position = last?.position != null ? last.position + 1 : 1;
  }

  const { data: entry, error } = await (db as any)
    .from("list_entries")
    .insert({
      list_id,
      game_id,
      position,
      notes: notes?.trim() || null,
    })
    .select("id, position")
    .single();

  if (error) {
    if (error.code === "23505") return json({ error: "Game is already in this list." }, 409);
    console.error("[lists/entries/add] insert error:", JSON.stringify(error));
    return json({ error: "Failed to add game to list." }, 500);
  }

  return json({ entry_id: entry.id, position: entry.position });
};
