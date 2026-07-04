import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { comment_id, vote } = await context.request.json();
  if (!comment_id || ![1, -1].includes(vote)) return json({ error: "Invalid request." }, 400);

  const { data: existing } = await (db as any)
    .from('list_comment_votes')
    .select('vote')
    .eq('profile_id', profile.id)
    .eq('comment_id', comment_id)
    .maybeSingle();

  let newVote: number | null;

  if (existing) {
    if (existing.vote === vote) {
      const { error } = await (db as any)
        .from('list_comment_votes')
        .delete()
        .eq('profile_id', profile.id)
        .eq('comment_id', comment_id);
      if (error) {
        console.error('[lists/comments/vote] delete error:', JSON.stringify(error));
        return json({ error: "Failed to remove vote." }, 500);
      }
      newVote = null;
    } else {
      const { error } = await (db as any)
        .from('list_comment_votes')
        .update({ vote })
        .eq('profile_id', profile.id)
        .eq('comment_id', comment_id);
      if (error) {
        console.error('[lists/comments/vote] update error:', JSON.stringify(error));
        return json({ error: "Failed to update vote." }, 500);
      }
      newVote = vote;
    }
  } else {
    const { error } = await (db as any)
      .from('list_comment_votes')
      .insert({ profile_id: profile.id, comment_id, vote });
    if (error) {
      console.error('[lists/comments/vote] insert error:', JSON.stringify(error));
      return json({ error: "Failed to save vote." }, 500);
    }
    newVote = vote;
  }

  const [{ count: upCount }, { count: downCount }] = await Promise.all([
    (db as any).from('list_comment_votes').select('*', { count: 'exact', head: true }).eq('comment_id', comment_id).eq('vote', 1),
    (db as any).from('list_comment_votes').select('*', { count: 'exact', head: true }).eq('comment_id', comment_id).eq('vote', -1),
  ]);

  if (newVote !== null) {
    try {
      const { data: comment } = await (db as any)
        .from('list_comments').select('profile_id, list_id').eq('id', comment_id).single();
      if (comment && comment.profile_id !== profile.id) {
        const notifType = newVote === 1 ? 'list_comment_upvote' : 'list_comment_downvote';
        await (db as any).from('notifications').insert({
          profile_id: comment.profile_id,
          actor_profile_id: profile.id,
          list_id: comment.list_id,
          type: notifType,
        });
      }
    } catch (e) {
      console.error('[lists/comments/vote] notification error (non-fatal):', e);
    }
  }

  return json({ vote: newVote, up: upCount ?? 0, down: downCount ?? 0 });
};
