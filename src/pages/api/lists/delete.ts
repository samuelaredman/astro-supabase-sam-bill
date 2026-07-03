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
    .select("id, profile_id")
    .eq("id", list_id)
    .maybeSingle();

  if (!list) return json({ error: "List not found." }, 404);
  if (list.profile_id !== profile.id) return json({ error: "Forbidden." }, 403);

  const { error } = await (db as any).from("lists").delete().eq("id", list_id);

  if (error) {
    console.error("[lists/delete] delete error:", JSON.stringify(error));
    return json({ error: "Failed to delete list." }, 500);
  }

  return json({ success: true });
};
