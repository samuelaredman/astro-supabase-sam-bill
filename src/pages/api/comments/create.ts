import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";
import { json } from "../../../utils/api";
import { classifyText } from "../../../utils/moderation/openaiModeration";
import { fileAutoReport } from "../../../utils/moderation/autoReport";

export const POST: APIRoute = async (context) => {
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "You must be signed in to comment." }, 401);

  const { review_id, body, parent_id } = await context.request.json();

  if (!review_id || !body?.trim())
    return json({ error: "review_id and body are required." }, 400);
  if (body.trim().length > 2000)
    return json({ error: "Comment must be 2000 characters or fewer." }, 400);

  const db = getSupabaseAdmin();

  // Fetch extra profile fields needed for the response
  const { data: profile } = await db
    .from('profiles').select('id, username, avatar_url').eq('auth_user_id', user.id).single();
  if (!profile) return json({ error: "Profile not found." }, 404);

  // Insert the comment
  const { data: inserted, error: insertError } = await db
    .from('review_comments')
    .insert({ review_id, profile_id: profile.id, body: body.trim(), parent_id: parent_id || null })
    .select('id, body, created_at, parent_id')
    .single();

  if (insertError) {
    console.error('[comments/create] insert error:', insertError);
    const msg = insertError.message ?? "Failed to post comment.";
    return json({ error: msg }, 500);
  }

  // ── Notify the review author, and (for replies) the parent comment's author.
  // Deduped so nobody is notified twice or about their own comment. Non-blocking. ──
  try {
    const { data: review } = await db
      .from('reviews').select('profile_id').eq('id', review_id).maybeSingle();
    const recipients = new Set<string>();
    if (review?.profile_id && review.profile_id !== profile.id) recipients.add(review.profile_id);

    if (parent_id) {
      const { data: parent } = await db
        .from('review_comments').select('profile_id').eq('id', parent_id).maybeSingle();
      if (parent?.profile_id && parent.profile_id !== profile.id) recipients.add(parent.profile_id);
    }

    const rows = [...recipients].map((rid) => ({
      profile_id: rid,
      actor_profile_id: profile.id,
      review_id,
      comment_id: inserted.id,
      type: rid === review?.profile_id ? 'review_comment' : 'comment_reply',
    }));
    if (rows.length > 0) {
      const { error: notifError } = await db.from('notifications').insert(rows);
      if (notifError) console.error('[comments/create] notification error (non-fatal):', JSON.stringify(notifError));
    }
  } catch (e) {
    console.error('[comments/create] notification error (non-fatal):', e);
  }

  // ── Screen the text for explicit content — never fails the request, but must be
  // awaited: on serverless the function freezes once the response is sent, so a
  // detached promise would be killed before the report is filed. There's no other
  // async work after this, so it's awaited directly (adds one classify round-trip).
  await classifyText(body.trim())
    .then((result) => {
      if (result.flagged) {
        return fileAutoReport(db, { targetType: "comment", targetId: inserted.id, categories: result.categories });
      }
    })
    .catch((e) => console.error("[comments/create] moderation error (non-fatal):", e));

  // Return the comment with the profile already resolved server-side
  // (avoids a fragile chained join on the insert call)
  return json({
    comment: {
      ...inserted,
      profiles: {
        id: profile.id,
        username: profile.username,
        avatar_url: profile.avatar_url,
      },
    },
  });
};
