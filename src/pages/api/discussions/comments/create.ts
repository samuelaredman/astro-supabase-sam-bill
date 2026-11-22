import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";
import { classifyText } from "../../../../utils/moderation/openaiModeration";
import { fileAutoReport } from "../../../../utils/moderation/autoReport";

// Comment on a site discussion. Any signed-in user may comment on a thread
// that isn't locked.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { discussion_id, body, parent_id } = await context.request.json();
  if (!discussion_id || !body?.trim())
    return json({ error: "discussion_id and body are required." }, 400);
  if (body.trim().length > 2000)
    return json({ error: "Comment must be 2000 characters or fewer." }, 400);

  const { data: discussion } = await (db as any)
    .from("site_discussions")
    .select("id, profile_id, is_locked")
    .eq("id", discussion_id)
    .maybeSingle();
  if (!discussion) return json({ error: "Discussion not found." }, 404);
  if (discussion.is_locked) return json({ error: "This discussion is locked." }, 403);

  const { data: inserted, error } = await (db as any)
    .from("site_discussion_comments")
    .insert({ discussion_id, profile_id: profile.id, body: body.trim(), parent_id: parent_id || null })
    .select("id, body, created_at, parent_id")
    .single();
  if (error) {
    console.error("[discussions/comments/create] insert error:", JSON.stringify(error));
    return json({ error: "Failed to post comment." }, 500);
  }

  // Notify the thread author, and (for replies) the parent comment's author.
  try {
    const recipients = new Set<string>();
    if (discussion.profile_id && discussion.profile_id !== profile.id) recipients.add(discussion.profile_id);
    if (parent_id) {
      const { data: parent } = await (db as any)
        .from("site_discussion_comments").select("profile_id").eq("id", parent_id).maybeSingle();
      if (parent?.profile_id && parent.profile_id !== profile.id) recipients.add(parent.profile_id);
    }
    const rows = [...recipients].map((rid) => ({
      profile_id: rid,
      actor_profile_id: profile.id,
      type: rid === discussion.profile_id ? "site_discussion_comment" : "site_discussion_reply",
    }));
    if (rows.length > 0) await (db as any).from("notifications").insert(rows);
  } catch (e) {
    console.error("[discussions/comments/create] notification error (non-fatal):", e);
  }

  await classifyText(body.trim())
    .then((result) => {
      if (result.flagged) {
        return fileAutoReport(db, { targetType: "site_discussion_comment", targetId: inserted.id, categories: result.categories });
      }
    })
    .catch((e) => console.error("[discussions/comments/create] moderation error (non-fatal):", e));

  const { data: profileRow } = await (db as any)
    .from("profiles").select("id, username, avatar_url").eq("id", profile.id).single();

  return json({ comment: { ...inserted, profiles: profileRow } });
};
