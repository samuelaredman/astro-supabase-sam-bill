import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";
import { classifyText } from "../../../../utils/moderation/openaiModeration";
import { fileAutoReport } from "../../../../utils/moderation/autoReport";

// Any signed-in user may comment on a forum post. Comments are screened for
// explicit content like all other user-authored text.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { post_id, body, parent_id } = await context.request.json();
  if (!post_id || !body?.trim()) return json({ error: "post_id and body are required." }, 400);
  if (body.trim().length > 2000) return json({ error: "Comment must be 2000 characters or fewer." }, 400);

  // Confirm the post exists and isn't locked (locked posts reject new comments).
  const { data: post } = await (db as any)
    .from("forum_posts")
    .select("id, profile_id, is_locked")
    .eq("id", post_id)
    .maybeSingle();
  if (!post) return json({ error: "Post not found." }, 404);
  if (post.is_locked) return json({ error: "Commenting is closed on this post." }, 403);

  const { data: inserted, error } = await (db as any)
    .from("forum_comments")
    .insert({ post_id, profile_id: profile.id, body: body.trim(), parent_id: parent_id || null })
    .select("id, body, created_at, parent_id")
    .single();

  if (error) {
    console.error("[forum/comments/create] insert error:", JSON.stringify(error));
    return json({ error: "Failed to post comment." }, 500);
  }

  // ── Notify the post author, and (for replies) the parent comment's author.
  // Deduped so nobody is notified twice or about their own comment. Non-blocking. ──
  try {
    const recipients = new Set<string>();
    if (post.profile_id && post.profile_id !== profile.id) recipients.add(post.profile_id);

    if (parent_id) {
      const { data: parent } = await (db as any)
        .from("forum_comments").select("profile_id").eq("id", parent_id).maybeSingle();
      if (parent?.profile_id && parent.profile_id !== profile.id) recipients.add(parent.profile_id);
    }

    const rows = [...recipients].map((rid) => ({
      profile_id: rid,
      actor_profile_id: profile.id,
      forum_post_id: post_id,
      type: rid === post.profile_id ? "forum_comment" : "forum_reply",
    }));
    if (rows.length > 0) await (db as any).from("notifications").insert(rows);
  } catch (e) {
    console.error("[forum/comments/create] notification error (non-fatal):", e);
  }

  // ── Screen the text — must be awaited before returning (serverless freezes on
  // response, which would kill a detached report insert). ──
  await classifyText(body.trim())
    .then((result) => {
      if (result.flagged) {
        return fileAutoReport(db, { targetType: "forum_comment", targetId: inserted.id, categories: result.categories });
      }
    })
    .catch((e) => console.error("[forum/comments/create] moderation error (non-fatal):", e));

  const { data: profileRow } = await (db as any)
    .from("profiles").select("id, username, avatar_url").eq("id", profile.id).single();

  return json({ comment: { ...inserted, profiles: profileRow } });
};
