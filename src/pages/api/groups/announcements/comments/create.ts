import type { APIRoute } from "astro";
import { requireAuth, json, getGroupAuthority } from "../../../../../utils/api";
import { classifyText } from "../../../../../utils/moderation/openaiModeration";
import { fileAutoReport } from "../../../../../utils/moderation/autoReport";

// Any current group member may comment on an announcement that isn't locked.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { announcement_id, body, parent_id } = await context.request.json();
  if (!announcement_id || !body?.trim())
    return json({ error: "announcement_id and body are required." }, 400);
  if (body.trim().length > 2000)
    return json({ error: "Comment must be 2000 characters or fewer." }, 400);

  const { data: announcement } = await (db as any)
    .from("group_announcements")
    .select("id, group_id, profile_id, is_locked")
    .eq("id", announcement_id)
    .maybeSingle();
  if (!announcement) return json({ error: "Announcement not found." }, 404);
  if (announcement.is_locked) return json({ error: "Commenting is closed on this announcement." }, 403);

  const membership = await getGroupAuthority(db, announcement.group_id, profile.id);
  if (!membership) return json({ error: "Not a member of this group." }, 403);

  const { data: inserted, error } = await (db as any)
    .from("group_announcement_comments")
    .insert({ announcement_id, profile_id: profile.id, body: body.trim(), parent_id: parent_id || null })
    .select("id, body, created_at, parent_id")
    .single();
  if (error) {
    console.error("[groups/announcements/comments/create] insert error:", JSON.stringify(error));
    return json({ error: "Failed to post comment." }, 500);
  }

  // Notify the announcement author, and (for replies) the parent comment's author.
  try {
    const recipients = new Set<string>();
    if (announcement.profile_id && announcement.profile_id !== profile.id) recipients.add(announcement.profile_id);
    if (parent_id) {
      const { data: parent } = await (db as any)
        .from("group_announcement_comments").select("profile_id").eq("id", parent_id).maybeSingle();
      if (parent?.profile_id && parent.profile_id !== profile.id) recipients.add(parent.profile_id);
    }
    const rows = [...recipients].map((rid) => ({
      profile_id: rid,
      actor_profile_id: profile.id,
      group_id: announcement.group_id,
      type: rid === announcement.profile_id ? "announcement_comment" : "announcement_reply",
    }));
    if (rows.length > 0) await (db as any).from("notifications").insert(rows);
  } catch (e) {
    console.error("[groups/announcements/comments/create] notification error (non-fatal):", e);
  }

  await classifyText(body.trim())
    .then((result) => {
      if (result.flagged) {
        return fileAutoReport(db, { targetType: "announcement_comment", targetId: inserted.id, categories: result.categories });
      }
    })
    .catch((e) => console.error("[groups/announcements/comments/create] moderation error (non-fatal):", e));

  const { data: profileRow } = await (db as any)
    .from("profiles").select("id, username, avatar_url").eq("id", profile.id).single();

  return json({ comment: { ...inserted, profiles: profileRow } });
};
