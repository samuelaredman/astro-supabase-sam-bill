import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const POST: APIRoute = async (context) => {
  // Auth via user JWT
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "You must be signed in to comment." }, 401);

  const { review_id, body } = await context.request.json();

  if (!review_id || !body?.trim())
    return json({ error: "review_id and body are required." }, 400);
  if (body.trim().length > 2000)
    return json({ error: "Comment must be 2000 characters or fewer." }, 400);

  // All DB ops via admin client to bypass RLS
  const db = getSupabaseAdmin() as any;

  const { data: profile } = await db
    .from('profiles').select('id, username, avatar_url').eq('auth_user_id', user.id).single();
  if (!profile) return json({ error: "Profile not found." }, 404);

  // Insert the comment
  const { data: inserted, error: insertError } = await db
    .from('review_comments')
    .insert({ review_id, profile_id: profile.id, body: body.trim() })
    .select('id, body, created_at')
    .single();

  if (insertError) {
    console.error('[comments/create] insert error:', insertError);
    return json({ error: "Failed to post comment." }, 500);
  }

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
