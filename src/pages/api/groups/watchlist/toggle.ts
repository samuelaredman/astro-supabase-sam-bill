import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";
import { resolveCanonicalGameId } from "../../../../utils/games";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json();
  const { group_id } = body;
  if (!group_id || !body.game_id) return json({ error: "group_id and game_id required" }, 400);
  // Track the canonical row — see watchlist/toggle.ts for the rationale.
  const game_id = await resolveCanonicalGameId(db, body.game_id);

  const { data: membership } = await db.from("group_members")
    .select("role, custom_role_id").eq("group_id", group_id).eq("profile_id", profile.id).maybeSingle();
  if (!membership) return json({ error: "Not a member of this group" }, 403);

  // Members with a custom role must have can_manage_watchlist=true (and not be view-only).
  // Plain members (no custom role) retain the original unrestricted access.
  if (membership.custom_role_id) {
    const { data: cr } = await db.from("group_roles")
      .select("can_manage_watchlist, is_view_only").eq("id", membership.custom_role_id).maybeSingle();
    if (!cr?.can_manage_watchlist || cr?.is_view_only)
      return json({ error: "Your role does not have permission to manage the watchlist" }, 403);
  }

  const { data: existing } = await db.from("group_watchlist")
    .select("id").eq("group_id", group_id).eq("game_id", game_id).maybeSingle();

  if (existing) {
    await db.from("group_watchlist").delete().eq("id", existing.id);
    return json({ added: false });
  }

  const { error } = await db.from("group_watchlist")
    .insert({ group_id, game_id, added_by: profile.id });
  if (error) {
    console.error("[groups/watchlist/toggle] insert error:", JSON.stringify(error));
    return json({ error: "Failed to update watchlist" }, 500);
  }

  return json({ added: true });
};
