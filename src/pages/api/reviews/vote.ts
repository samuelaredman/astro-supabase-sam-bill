import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { review_id, vote } = await context.request.json();
  if (!review_id || ![1, -1].includes(vote)) return json({ error: "Invalid request." }, 400);

  // Check for existing vote
  const { data: existing } = await db
    .from('review_votes')
    .select('vote')
    .eq('profile_id', profile.id)
    .eq('review_id', review_id)
    .maybeSingle();

  let newVote: number | null;
  let notifAction: 'insert' | 'update' | 'none' = 'none';

  if (existing) {
    if (existing.vote === vote) {
      // Same vote — toggle off (delete)
      const { error } = await db
        .from('review_votes')
        .delete()
        .eq('profile_id', profile.id)
        .eq('review_id', review_id);
      if (error) {
        console.error('[vote] delete error:', JSON.stringify(error));
        return json({ error: "Failed to remove vote.", detail: error.message, code: error.code }, 500);
      }
      newVote = null;
    } else {
      // Different vote — switch it
      const { error } = await db
        .from('review_votes')
        .update({ vote })
        .eq('profile_id', profile.id)
        .eq('review_id', review_id);
      if (error) {
        console.error('[vote] update error:', JSON.stringify(error));
        return json({ error: "Failed to update vote.", detail: error.message, code: error.code }, 500);
      }
      newVote = vote;
      notifAction = 'update';
    }
  } else {
    // No existing vote — insert
    const { error } = await db.from('review_votes').insert({ profile_id: profile.id, review_id, vote });
    if (error) {
      console.error('[vote] insert error:', JSON.stringify(error));
      return json({ error: "Failed to save vote.", detail: error.message, code: error.code }, 500);
    }
    newVote = vote;
    notifAction = 'insert';
  }

  // Return the real counts from DB so the client never has to guess
  const [{ count: upCount }, { count: downCount }] = await Promise.all([
    db.from('review_votes').select('*', { count: 'exact', head: true }).eq('review_id', review_id).eq('vote', 1),
    db.from('review_votes').select('*', { count: 'exact', head: true }).eq('review_id', review_id).eq('vote', -1),
  ]);

  // Fire vote notification (non-blocking)
  if (notifAction !== 'none') {
    try {
      const { data: review } = await db
        .from('reviews').select('profile_id').eq('id', review_id).single();
      // Don't notify if the voter is the review author
      if (review && review.profile_id !== profile.id) {
        const notifType = newVote === 1 ? 'review_upvote' : 'review_downvote';
        const { data: existingNotif } = await db
          .from('notifications')
          .select('id')
          .eq('profile_id', review.profile_id)
          .eq('actor_profile_id', profile.id)
          .eq('review_id', review_id)
          .in('type', ['review_upvote', 'review_downvote'])
          .maybeSingle();
        if (existingNotif) {
          await db.from('notifications').update({ type: notifType, read: false })
            .eq('id', existingNotif.id);
        } else {
          await db.from('notifications').insert({
            profile_id: review.profile_id,
            actor_profile_id: profile.id,
            review_id,
            type: notifType,
          });
        }
      }
    } catch (e) {
      console.error('[vote] notification error (non-fatal):', e);
    }
  }

  return json({ vote: newVote, up: upCount ?? 0, down: downCount ?? 0 });
};
