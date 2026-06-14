import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { list_id, game_id } = await context.request.json();

  if (!list_id) return json({ error: "list_id is required." }, 400);
  if (!game_id) return json({ error: "game_id is required." }, 400);

  const { data: list } = await (db as any)
    .from("lists")
    .select("id, profile_id, is_ranked")
    .eq("id", list_id)
    .maybeSingle();

  if (!list) return json({ error: "List not found." }, 404);
  if (list.profile_id !== profile.id) return json({ error: "Forbidden." }, 403);

  const { error: deleteError } = await (db as any)
    .from("list_entries")
    .delete()
    .eq("list_id", list_id)
    .eq("game_id", game_id);

  if (deleteError) {
    console.error("[lists/entries/remove] delete error:", JSON.stringify(deleteError));
    return json({ error: "Failed to remove game from list." }, 500);
  }

  // Re-number positions after removal to keep them dense (1, 2, 3…)
  if (list.is_ranked) {
    const { data: remaining } = await (db as any)
      .from("list_entries")
      .select("id")
      .eq("list_id", list_id)
      .not("position", "is", null)
      .order("position", { ascending: true });

    if (remaining?.length) {
      // Null out all positions first to avoid unique constraint conflicts mid-update
      await (db as any)
        .from("list_entries")
        .update({ position: null })
        .eq("list_id", list_id);

      // Re-assign sequential positions
      for (let i = 0; i < remaining.length; i++) {
        await (db as any)
          .from("list_entries")
          .update({ position: i + 1 })
          .eq("id", remaining[i].id);
      }
    }
  }

  return json({ success: true });
};
