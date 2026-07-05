import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { recommendation_id, vote } = await context.request.json();
  if (!recommendation_id || ![1, -1].includes(vote)) return json({ error: "Invalid request." }, 400);

  const { data: existing } = await (db as any)
    .from('recommendation_votes')
    .select('vote')
    .eq('profile_id', profile.id)
    .eq('recommendation_id', recommendation_id)
    .maybeSingle();

  let newVote: number | null;
  let notifAction: 'insert' | 'update' | 'none' = 'none';

  if (existing) {
    if (existing.vote === vote) {
      const { error } = await (db as any)
        .from('recommendation_votes')
        .delete()
        .eq('profile_id', profile.id)
        .eq('recommendation_id', recommendation_id);
      if (error) {
        console.error('[recommendations/vote] delete error:', JSON.stringify(error));
        return json({ error: "Failed to remove vote." }, 500);
      }
      newVote = null;
    } else {
      const { error } = await (db as any)
        .from('recommendation_votes')
        .update({ vote })
        .eq('profile_id', profile.id)
        .eq('recommendation_id', recommendation_id);
      if (error) {
        console.error('[recommendations/vote] update error:', JSON.stringify(error));
        return json({ error: "Failed to update vote." }, 500);
      }
      newVote = vote;
      notifAction = 'update';
    }
  } else {
    const { error } = await (db as any)
      .from('recommendation_votes')
      .insert({ profile_id: profile.id, recommendation_id, vote });
    if (error) {
      console.error('[recommendations/vote] insert error:', JSON.stringify(error));
      return json({ error: "Failed to save vote." }, 500);
    }
    newVote = vote;
    notifAction = 'insert';
  }

  const [{ count: upCount }, { count: downCount }] = await Promise.all([
    (db as any).from('recommendation_votes').select('*', { count: 'exact', head: true }).eq('recommendation_id', recommendation_id).eq('vote', 1),
    (db as any).from('recommendation_votes').select('*', { count: 'exact', head: true }).eq('recommendation_id', recommendation_id).eq('vote', -1),
  ]);

  if (notifAction !== 'none') {
    try {
      const { data: rec } = await (db as any)
        .from('recommendations').select('profile_id').eq('id', recommendation_id).single();
      if (rec && rec.profile_id !== profile.id) {
        const notifType = newVote === 1 ? 'recommendation_upvote' : 'recommendation_downvote';
        const { data: existingNotif } = await (db as any)
          .from('notifications')
          .select('id')
          .eq('profile_id', rec.profile_id)
          .eq('actor_profile_id', profile.id)
          .eq('recommendation_id', recommendation_id)
          .in('type', ['recommendation_upvote', 'recommendation_downvote'])
          .maybeSingle();
        if (existingNotif) {
          await (db as any).from('notifications').update({ type: notifType, read: false }).eq('id', existingNotif.id);
        } else {
          await (db as any).from('notifications').insert({
            profile_id: rec.profile_id,
            actor_profile_id: profile.id,
            recommendation_id,
            type: notifType,
          });
        }
      }
    } catch (e) {
      console.error('[recommendations/vote] notification error (non-fatal):', e);
    }
  }

  return json({ vote: newVote, up: upCount ?? 0, down: downCount ?? 0 });
};
