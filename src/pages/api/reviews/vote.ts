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

  // Recompute counts and (if we might notify) the review author in a single
  // round trip instead of three separate ones. One select of this review's
  // votes is cheaper than two count(*) scans and gives us both totals.
  const [votesRes, reviewRes] = await Promise.all([
    db.from('review_votes').select('vote').eq('review_id', review_id),
    notifAction !== 'none'
      ? db.from('reviews').select('profile_id').eq('id', review_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const voteRows = votesRes.data ?? [];
  const upCount = voteRows.filter((v: { vote: number }) => v.vote === 1).length;
  const downCount = voteRows.filter((v: { vote: number }) => v.vote === -1).length;

  // Fire vote notification (non-fatal — must never fail the vote itself)
  const review = reviewRes.data as { profile_id: string } | null;
  if (notifAction !== 'none' && review && review.profile_id !== profile.id) {
    try {
      const notifType = newVote === 1 ? 'review_upvote' : 'review_downvote';
      // Update an existing upvote/downvote notification in place; only insert a
      // new row when nothing was updated. Avoids the prior select-then-write.
      const { data: updated } = await db
        .from('notifications')
        .update({ type: notifType, read: false })
        .eq('profile_id', review.profile_id)
        .eq('actor_profile_id', profile.id)
        .eq('review_id', review_id)
        .in('type', ['review_upvote', 'review_downvote'])
        .select('id');
      if (!updated || updated.length === 0) {
        await db.from('notifications').insert({
          profile_id: review.profile_id,
          actor_profile_id: profile.id,
          review_id,
          type: notifType,
        });
      }
    } catch (e) {
      console.error('[vote] notification error (non-fatal):', e);
    }
  }

  return json({ vote: newVote, up: upCount, down: downCount });
};
