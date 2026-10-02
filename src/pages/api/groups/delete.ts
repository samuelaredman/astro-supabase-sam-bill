import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";
import { SITE_GROUP_DELETE_ERROR } from "../../../utils/siteGroup";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { group_id } = await context.request.json();

  const { data: group } = await db.from("groups")
    .select("created_by, is_site_group").eq("id", group_id).maybeSingle();
  if (!group) return json({ error: "Group not found" }, 404);
  if (group.is_site_group) return json({ error: SITE_GROUP_DELETE_ERROR }, 403);
  if (group.created_by !== profile.id) return json({ error: "Only the owner can delete the group" }, 403);

  const { error } = await db.from("groups").delete().eq("id", group_id);
  if (error) return json({ error: error.message }, 500);

  return json({ success: true });
};
