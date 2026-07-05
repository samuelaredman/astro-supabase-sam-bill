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
