export const prerender = false;
import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";
import { json } from "../../../utils/api";

async function resolveOwnedList(
  db: any, userId: string, listId: string
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const { data: profile } = await db
    .from("profiles").select("id").eq("auth_user_id", userId).single();
  if (!profile) return { ok: false, response: json({ error: "Profile not found." }, 404) };

  const { data: list } = await db
    .from("lists").select("id, profile_id").eq("id", listId).maybeSingle();
  if (!list) return { ok: false, response: json({ error: "List not found." }, 404) };
  if (list.profile_id !== profile.id) return { ok: false, response: json({ error: "Forbidden." }, 403) };

  return { ok: true };
}

export const POST: APIRoute = async (context) => {
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const form = await context.request.formData();
  const file = form.get("cover") as File;
  const listId = form.get("list_id") as string;
  if (!file || !listId) return json({ error: "Missing file or list_id." }, 400);
  if (file.size > 5 * 1024 * 1024) return json({ error: "File must be under 5MB." }, 400);

  const db = getSupabaseAdmin() as any;
  const resolved = await resolveOwnedList(db, user.id, listId);
  if (!resolved.ok) return resolved.response;

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `lists/${listId}/cover.${ext}`;

  const { data: existing } = await db.storage.from("avatars").list(`lists/${listId}`);
  if (existing?.length) {
    await db.storage.from("avatars").remove(existing.map((f: any) => `lists/${listId}/${f.name}`));
  }

  const { error: uploadError } = await db.storage
    .from("avatars").upload(path, file, { contentType: file.type });
  if (uploadError) {
    console.error("[lists/cover] upload error:", JSON.stringify(uploadError));
    return json({ error: "Failed to upload cover image." }, 500);
  }

  const { data: { publicUrl } } = db.storage.from("avatars").getPublicUrl(path);

  const { error: updateError } = await db
    .from("lists").update({ cover_image_url: publicUrl, updated_at: new Date().toISOString() }).eq("id", listId);
  if (updateError) {
    console.error("[lists/cover] update error:", JSON.stringify(updateError));
    return json({ error: "Failed to save cover image." }, 500);
  }

  return json({ url: publicUrl + "?t=" + Date.now() });
};

export const DELETE: APIRoute = async (context) => {
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const { list_id } = await context.request.json();
  if (!list_id) return json({ error: "list_id is required." }, 400);

  const db = getSupabaseAdmin() as any;
  const resolved = await resolveOwnedList(db, user.id, list_id);
  if (!resolved.ok) return resolved.response;

  const { data: existing } = await db.storage.from("avatars").list(`lists/${list_id}`);
  if (existing?.length) {
    await db.storage.from("avatars").remove(existing.map((f: any) => `lists/${list_id}/${f.name}`));
  }

  const { error } = await db
    .from("lists").update({ cover_image_url: null, updated_at: new Date().toISOString() }).eq("id", list_id);
  if (error) {
    console.error("[lists/cover] remove error:", JSON.stringify(error));
    return json({ error: "Failed to remove cover image." }, 500);
  }

  return json({ success: true });
};
