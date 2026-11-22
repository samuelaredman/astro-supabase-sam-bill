import type { APIRoute } from "astro";
import { requireAuth, json, getGroupAuthority } from "../../../../../utils/api";
import { classifyText } from "../../../../../utils/moderation/openaiModeration";
import { fileAutoReport } from "../../../../../utils/moderation/autoReport";

// Any current group member may comment on a thread that isn't locked.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { thread_id, body, parent_id } = await context.request.json();
  if (!thread_id || !body?.trim())
    return json({ error: "thread_id and body are required." }, 400);
  if (body.trim().length > 2000)
    return json({ error: "Comment must be 2000 characters or fewer." }, 400);

  const { data: thread } = await (db as any)
    .from("group_forum_threads")
    .select("id, group_id, profile_id, is_locked")
    .eq("id", thread_id)
    .maybeSingle();
  if (!thread) return json({ error: "Thread not found." }, 404);
  if (thread.is_locked) return json({ error: "This thread is locked." }, 403);

  const membership = await getGroupAuthority(db, thread.group_id, profile.id);
  if (!membership) return json({ error: "Not a member of this group." }, 403);

  const { data: inserted, error } = await (db as any)
    .from("group_forum_thread_comments")
    .insert({ thread_id, profile_id: profile.id, body: body.trim(), parent_id: parent_id || null })
    .select("id, body, created_at, parent_id")
    .single();
  if (error) {
    console.error("[groups/forums/comments/create] insert error:", JSON.stringify(error));
    return json({ error: "Failed to post comment." }, 500);
  }

  // Notify the thread author, and (for replies) the parent comment's author.
  try {
    const recipients = new Set<string>();
    if (thread.profile_id && thread.profile_id !== profile.id) recipients.add(thread.profile_id);
    if (parent_id) {
      const { data: parent } = await (db as any)
        .from("group_forum_thread_comments").select("profile_id").eq("id", parent_id).maybeSingle();
      if (parent?.profile_id && parent.profile_id !== profile.id) recipients.add(parent.profile_id);
    }
    const rows = [...recipients].map((rid) => ({
      profile_id: rid,
      actor_profile_id: profile.id,
      group_id: thread.group_id,
      type: rid === thread.profile_id ? "forum_thread_comment" : "forum_thread_reply",
    }));
    if (rows.length > 0) await (db as any).from("notifications").insert(rows);
  } catch (e) {
    console.error("[groups/forums/comments/create] notification error (non-fatal):", e);
  }

  await classifyText(body.trim())
    .then((result) => {
      if (result.flagged) {
        return fileAutoReport(db, { targetType: "forum_thread_comment", targetId: inserted.id, categories: result.categories });
      }
    })
    .catch((e) => console.error("[groups/forums/comments/create] moderation error (non-fatal):", e));

  const { data: profileRow } = await (db as any)
    .from("profiles").select("id, username, avatar_url").eq("id", profile.id).single();

  return json({ comment: { ...inserted, profiles: profileRow } });
};
