import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { comment_id, reaction_type } = await context.request.json();
  if (!comment_id || !reaction_type)
    return json({ error: "comment_id and reaction_type are required." }, 400);

  // Toggle: delete if exists, insert if not
  const { data: existing } = await db
    .from('comment_reactions')
    .select('id')
    .eq('comment_id', comment_id)
    .eq('profile_id', profile.id)
    .eq('reaction_type', reaction_type)
    .maybeSingle();

  let reacted: boolean;
  if (existing) {
    await db.from('comment_reactions').delete()
      .eq('comment_id', comment_id)
      .eq('profile_id', profile.id)
      .eq('reaction_type', reaction_type);
    reacted = false;
  } else {
    await db.from('comment_reactions')
      .insert({ comment_id, profile_id: profile.id, reaction_type });
    reacted = true;
  }

  const { count } = await db
    .from('comment_reactions')
    .select('*', { count: 'exact', head: true })
    .eq('comment_id', comment_id)
    .eq('reaction_type', reaction_type);

  // Fire notification when adding a reaction (not removing)
  if (reacted) {
    try {
      const { data: comment } = await db
        .from('review_comments')
        .select('profile_id, review_id')
        .eq('id', comment_id)
        .single();
      // Don't notify if reacting to your own comment
      if (comment && comment.profile_id !== profile.id) {
        await db.from('notifications').insert({
          profile_id: comment.profile_id,
          actor_profile_id: profile.id,
          type: 'comment_reaction',
          comment_id,
          review_id: comment.review_id,
          reaction_type,
        });
      }
    } catch (e) {
      console.error('[comments/react] notification error (non-fatal):', e);
    }
  }

  return json({ reacted, count: count ?? 0, reaction_type });
};
