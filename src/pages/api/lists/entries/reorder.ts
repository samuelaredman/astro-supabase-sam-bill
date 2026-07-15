import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { list_id, entry_ids } = await context.request.json();

  if (!list_id) return json({ error: "list_id is required." }, 400);
  if (!Array.isArray(entry_ids) || entry_ids.length === 0)
    return json({ error: "entry_ids must be a non-empty array." }, 400);

  const { data: list } = await (db as any)
    .from("lists")
    .select("id, profile_id, is_ranked")
    .eq("id", list_id)
    .maybeSingle();

  if (!list) return json({ error: "List not found." }, 404);
  if (list.profile_id !== profile.id) return json({ error: "Forbidden." }, 403);

  // Null out all positions first to avoid unique constraint conflicts mid-update
  const { error: nullError } = await (db as any)
    .from("list_entries")
    .update({ position: null })
    .eq("list_id", list_id);

  if (nullError) {
    console.error("[lists/entries/reorder] null error:", JSON.stringify(nullError));
    return json({ error: "Failed to reorder list." }, 500);
  }

  // Assign positions 1…N in the order provided
  for (let i = 0; i < entry_ids.length; i++) {
    const { error } = await (db as any)
      .from("list_entries")
      .update({ position: i + 1 })
      .eq("id", entry_ids[i])
      .eq("list_id", list_id); // guard: only touch entries belonging to this list

    if (error) {
      console.error("[lists/entries/reorder] position update error:", JSON.stringify(error));
      return json({ error: "Failed to reorder list." }, 500);
    }
  }

  return json({ success: true });
};
