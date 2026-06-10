import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { comment_id, vote } = await context.request.json();
  if (!comment_id || ![1, -1].includes(vote)) return json({ error: "Invalid request." }, 400);

  const { data: existing } = await db
    .from('comment_votes')
    .select('vote')
    .eq('profile_id', profile.id)
    .eq('comment_id', comment_id)
    .maybeSingle();

  let newVote: number | null;
  let notifAction: 'insert' | 'update' | 'none' = 'none';

  if (existing) {
    if (existing.vote === vote) {
      // Same vote — toggle off
      const { error } = await db
        .from('comment_votes')
        .delete()
        .eq('profile_id', profile.id)
        .eq('comment_id', comment_id);
      if (error) return json({ error: "Failed to remove vote.", detail: error.message }, 500);
      newVote = null;
    } else {
      // Switch vote
      const { error } = await db
        .from('comment_votes')
        .update({ vote })
        .eq('profile_id', profile.id)
        .eq('comment_id', comment_id);
      if (error) return json({ error: "Failed to update vote.", detail: error.message }, 500);
      newVote = vote;
      notifAction = 'update';
    }
  } else {
    const { error } = await db
      .from('comment_votes')
      .insert({ profile_id: profile.id, comment_id, vote });
    if (error) return json({ error: "Failed to save vote.", detail: error.message }, 500);
    newVote = vote;
    notifAction = 'insert';
  }

  const [{ count: upCount }, { count: downCount }] = await Promise.all([
    db.from('comment_votes').select('*', { count: 'exact', head: true }).eq('comment_id', comment_id).eq('vote', 1),
    db.from('comment_votes').select('*', { count: 'exact', head: true }).eq('comment_id', comment_id).eq('vote', -1),
  ]);

  // Fire notification (non-blocking)
  if (notifAction !== 'none') {
    try {
      const { data: comment } = await db
        .from('review_comments').select('profile_id, review_id').eq('id', comment_id).single();
      if (comment && comment.profile_id !== profile.id) {
        const notifType = newVote === 1 ? 'comment_upvote' : 'comment_downvote';
        const { data: existingNotif } = await db
          .from('notifications')
          .select('id')
          .eq('profile_id', comment.profile_id)
          .eq('actor_profile_id', profile.id)
          .eq('comment_id', comment_id)
          .in('type', ['comment_upvote', 'comment_downvote'])
          .maybeSingle();
        if (existingNotif) {
          await db.from('notifications').update({ type: notifType, read: false }).eq('id', existingNotif.id);
        } else {
          await db.from('notifications').insert({
            profile_id: comment.profile_id,
            actor_profile_id: profile.id,
            comment_id,
            review_id: comment.review_id,
            type: notifType,
          });
        }
      }
    } catch (e) {
      console.error('[comment vote] notification error (non-fatal):', e);
    }
  }

  return json({ vote: newVote, up: upCount ?? 0, down: downCount ?? 0 });
};
