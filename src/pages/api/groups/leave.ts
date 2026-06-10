import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { group_id } = await context.request.json();

  const { data: membership } = await db.from("group_members")
    .select("id, role").eq("group_id", group_id).eq("profile_id", profile.id).single();
  if (!membership) return json({ error: "Not a member" }, 404);

  if (membership.role === "owner") {
    const { count } = await db.from("group_members")
      .select("*", { count: "exact", head: true }).eq("group_id", group_id);
    if ((count ?? 0) > 1) {
      return json({ error: "Transfer ownership before leaving, or remove all members first." }, 400);
    }
    // Last member — delete the whole group
    await db.from("groups").delete().eq("id", group_id);
    return json({ deleted: true });
  }

  await db.from("group_members").delete().eq("id", membership.id);
  return json({ success: true });
};
