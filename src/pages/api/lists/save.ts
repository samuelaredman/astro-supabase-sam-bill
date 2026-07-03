import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { list_id } = await context.request.json();
  if (!list_id) return json({ error: "list_id is required." }, 400);

  const { data: list } = await (db as any)
    .from("lists")
    .select("id, profile_id, visibility")
    .eq("id", list_id)
    .maybeSingle();

  if (!list) return json({ error: "List not found." }, 404);
  if (list.profile_id === profile.id) return json({ error: "Cannot save your own list." }, 400);
  if (list.visibility !== "public") return json({ error: "Cannot save a private list." }, 400);

  const { data: existing } = await (db as any)
    .from("list_saves")
    .select("id")
    .eq("list_id", list_id)
    .eq("profile_id", profile.id)
    .maybeSingle();

  let saved: boolean;

  if (existing) {
    const { error } = await (db as any)
      .from("list_saves")
      .delete()
      .eq("list_id", list_id)
      .eq("profile_id", profile.id);

    if (error) {
      console.error("[lists/save] delete error:", JSON.stringify(error));
      return json({ error: "Failed to unsave list." }, 500);
    }
    saved = false;
  } else {
    const { error } = await (db as any)
      .from("list_saves")
      .insert({ list_id, profile_id: profile.id });

    if (error) {
      console.error("[lists/save] insert error:", JSON.stringify(error));
      return json({ error: "Failed to save list." }, 500);
    }
    saved = true;
  }

  const { count } = await (db as any)
    .from("list_saves")
    .select("*", { count: "exact", head: true })
    .eq("list_id", list_id);

  return json({ saved, count: count ?? 0 });
};
