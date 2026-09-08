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

  // One select of this comment's votes instead of two count(*) scans; the
  // comment-author lookup runs in parallel since it doesn't depend on the counts.
  const [votesRes, commentRes] = await Promise.all([
    db.from('comment_votes').select('vote').eq('comment_id', comment_id),
    notifAction !== 'none'
      ? db.from('review_comments').select('profile_id, review_id').eq('id', comment_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const voteRows = votesRes.data ?? [];
  const upCount = voteRows.filter((v: { vote: number }) => v.vote === 1).length;
  const downCount = voteRows.filter((v: { vote: number }) => v.vote === -1).length;

  // Fire notification (non-fatal — must never fail the vote itself)
  const comment = commentRes.data as { profile_id: string; review_id: string } | null;
  if (notifAction !== 'none' && comment && comment.profile_id !== profile.id) {
    try {
      const notifType = newVote === 1 ? 'comment_upvote' : 'comment_downvote';
      const { data: updated } = await db
        .from('notifications')
        .update({ type: notifType, read: false })
        .eq('profile_id', comment.profile_id)
        .eq('actor_profile_id', profile.id)
        .eq('comment_id', comment_id)
        .in('type', ['comment_upvote', 'comment_downvote'])
        .select('id');
      if (!updated || updated.length === 0) {
        await db.from('notifications').insert({
          profile_id: comment.profile_id,
          actor_profile_id: profile.id,
          comment_id,
          review_id: comment.review_id,
          type: notifType,
        });
      }
    } catch (e) {
      console.error('[comment vote] notification error (non-fatal):', e);
    }
  }

  return json({ vote: newVote, up: upCount, down: downCount });
};
