import type { APIRoute } from "astro";
import { requireAuth, json, getGroupAuthority } from "../../../utils/api";
import { validateName } from "../../../utils/moderation/nameRules";
import { groupOwnerYouTube, readGroupShowcaseKeys } from "../../../utils/groupShowcases";
import { parseYouTubeId } from "../../../utils/youtube";

function randomCode(len = 8) {
  return Math.random().toString(36).slice(2, 2 + len).toUpperCase();
}

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json();
  const { group_id, name, description, visibility, regenerate_invite, join_prompt, stats_config, requires_approval } = body;

  const membership = await getGroupAuthority(db, group_id, profile.id);
  if (!membership) return json({ error: "Not authorized" }, 403);

  const isOwner = membership.role === "owner";
  const isAdmin = membership.role === "admin";

  // Custom role holders with can_edit_group may update name/description/join_prompt/stats_config
  // and the Overview's showcases (order, hidden sections, video)
  let hasEditGroup = false;
  if (!isOwner && !isAdmin && membership.custom_role_id) {
    const { data: cr } = await db.from("group_roles")
      .select("can_edit_group").eq("id", membership.custom_role_id).maybeSingle();
    hasEditGroup = !!cr?.can_edit_group;
  }

  if (!isOwner && !isAdmin && !hasEditGroup)
    return json({ error: "Not authorized" }, 403);

  const updates: Record<string, any> = {};

  if (name !== undefined) {
    const nameCheck = validateName(name);
    if (!nameCheck.ok) return json({ error: nameCheck.error }, 400);
    updates.name = name.trim();
  }
  if (description !== undefined)  updates.description = description?.trim() || null;
  if (join_prompt !== undefined)  updates.join_prompt = join_prompt?.trim() || null;
  if (stats_config !== undefined) updates.stats_config = stats_config;

  // Overview showcases, from "Customize" on the Overview (src/utils/groupShowcases.ts)
  if ("overview_order" in body) {
    const order = readGroupShowcaseKeys(body.overview_order);
    if (!order) return json({ error: "Invalid section order" }, 400);
    updates.overview_order = order;
  }
  if ("overview_hidden" in body) {
    const hidden = readGroupShowcaseKeys(body.overview_hidden);
    if (!hidden) return json({ error: "Invalid hidden sections" }, 400);
    updates.overview_hidden = hidden;
  }
  // The Overview video: 'latest' = the owner's newest upload, 'featured' = one link, null = off
  if ("showcase_video_mode" in body) {
    const mode = body.showcase_video_mode || null;
    if (mode !== null && mode !== "latest" && mode !== "featured")
      return json({ error: "Invalid video option" }, 400);
    if (mode === "featured") {
      const videoId = parseYouTubeId(typeof body.showcase_video_url === "string" ? body.showcase_video_url : "");
      if (!videoId) return json({ error: "That doesn't look like a YouTube video link." }, 400);
      updates.showcase_video_id = videoId;
    }
    if (mode === "latest" && !(await groupOwnerYouTube(db, group_id))?.youtubeUrl)
      return json({ error: "The group owner needs a YouTube channel in their profile links first." }, 400);
    updates.showcase_video_mode = mode;
  }

  // Visibility, join settings, and invite regeneration require at least owner/admin
  if (visibility !== undefined && !isOwner && !isAdmin)
    return json({ error: "Only the group owner or admin can change visibility" }, 403);
  if (requires_approval !== undefined && !isOwner && !isAdmin)
    return json({ error: "Only the group owner or admin can change join settings" }, 403);
  if (regenerate_invite && !isOwner && !isAdmin)
    return json({ error: "Only the group owner or admin can regenerate the invite code" }, 403);

  if (visibility !== undefined) {
    if (!["public", "private"].includes(visibility))
      return json({ error: "Invalid visibility" }, 400);
    updates.visibility = visibility;
    if (visibility === "private") {
      const { data: g } = await db.from("groups").select("invite_code").eq("id", group_id).single();
      if (!g?.invite_code) updates.invite_code = randomCode();
    }
  }

  // requires_approval only means anything for public groups — force it off for private
  if (requires_approval !== undefined || visibility === "private") {
    let effectiveVisibility = visibility;
    if (effectiveVisibility === undefined) {
      const { data: g } = await db.from("groups").select("visibility").eq("id", group_id).single();
      effectiveVisibility = g?.visibility;
    }
    updates.requires_approval = effectiveVisibility === "public" ? !!requires_approval : false;
  }

  if (regenerate_invite) updates.invite_code = randomCode();

  if (Object.keys(updates).length === 0) return json({ error: "Nothing to update" }, 400);

  const { data: updated, error } = await db.from("groups")
    .update(updates).eq("id", group_id).select("invite_code").single();
  if (error) {
    console.error("[groups/update] error:", JSON.stringify(error));
    return json({ error: error.message }, 500);
  }

  return json({ success: true, invite_code: updated.invite_code });
};
