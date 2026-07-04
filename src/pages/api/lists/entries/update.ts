import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { entry_id, notes } = await context.request.json();
  if (!entry_id) return json({ error: "entry_id is required." }, 400);

  // Verify ownership via parent list
  const { data: entry } = await (db as any)
    .from("list_entries")
    .select("id, list_id")
    .eq("id", entry_id)
    .maybeSingle();

  if (!entry) return json({ error: "Entry not found." }, 404);

  const { data: list } = await (db as any)
    .from("lists")
    .select("profile_id")
    .eq("id", entry.list_id)
    .maybeSingle();

  if (!list || list.profile_id !== profile.id) return json({ error: "Forbidden." }, 403);

  const { error } = await (db as any)
    .from("list_entries")
    .update({ notes: notes?.trim() || null })
    .eq("id", entry_id);

  if (error) {
    console.error("[lists/entries/update] update error:", JSON.stringify(error));
    return json({ error: "Failed to update entry." }, 500);
  }

  return json({ success: true });
};
