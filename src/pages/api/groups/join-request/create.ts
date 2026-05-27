import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../../utils/database";

const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const db = getSupabaseAdmin() as any;

  const { data: profile } = await db
    .from("profiles").select("id").eq("auth_user_id", user.id).single();
  if (!profile) return json({ error: "Profile not found" }, 404);

  const body = await context.request.json();
  const { group_id, message } = body;
  if (!group_id) return json({ error: "group_id is required" }, 400);

  // Verify the group is private
  const { data: group } = await db.from("groups")
    .select("id, name, visibility").eq("id", group_id).single();
  if (!group) return json({ error: "Group not found" }, 404);
  if (group.visibility !== "private") {
    return json({ error: "Join requests are only for private groups" }, 400);
  }

  // Not already a member
  const { data: existing } = await db.from("group_members")
    .select("id").eq("group_id", group_id).eq("profile_id", profile.id).maybeSingle();
  if (existing) return json({ error: "Already a member" }, 409);

  // Upsert so re-requesting after a rejection resets to pending
  const { error } = await db.from("group_join_requests").upsert({
    group_id,
    profile_id: profile.id,
    message: message?.trim() || null,
    status: "pending",
    reviewed_by: null,
    reviewed_at: null,
  }, { onConflict: "group_id,profile_id" });

  if (error) {
    console.error("[join-request/create] error:", JSON.stringify(error));
    return json({ error: "Failed to submit request." }, 500);
  }

  // Notify group admins/owners
  try {
    const { data: admins } = await db.from("group_members")
      .select("profile_id").eq("group_id", group_id).in("role", ["owner", "admin"]);
    if (admins?.length) {
      await db.from("notifications").insert(
        admins.map((a: any) => ({
          profile_id: a.profile_id,
          actor_profile_id: profile.id,
          type: "group_join_request",
          group_id,
        }))
      );
    }
  } catch (e) {
    console.error("[join-request/create] notification error (non-fatal):", e);
  }

  return json({ success: true });
};
