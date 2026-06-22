import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { list_id, vote } = await context.request.json();
  if (!list_id || ![1, -1].includes(vote)) return json({ error: "Invalid request." }, 400);

  const { data: existing } = await (db as any)
    .from('list_votes')
    .select('vote')
    .eq('profile_id', profile.id)
    .eq('list_id', list_id)
    .maybeSingle();

  let newVote: number | null;
  let notifAction: 'insert' | 'update' | 'none' = 'none';

  if (existing) {
    if (existing.vote === vote) {
      const { error } = await (db as any)
        .from('list_votes')
        .delete()
        .eq('profile_id', profile.id)
        .eq('list_id', list_id);
      if (error) {
        console.error('[lists/vote] delete error:', JSON.stringify(error));
        return json({ error: "Failed to remove vote." }, 500);
      }
      newVote = null;
    } else {
      const { error } = await (db as any)
        .from('list_votes')
        .update({ vote })
        .eq('profile_id', profile.id)
        .eq('list_id', list_id);
      if (error) {
        console.error('[lists/vote] update error:', JSON.stringify(error));
        return json({ error: "Failed to update vote." }, 500);
      }
      newVote = vote;
      notifAction = 'update';
    }
  } else {
    const { error } = await (db as any)
      .from('list_votes')
      .insert({ profile_id: profile.id, list_id, vote });
    if (error) {
      console.error('[lists/vote] insert error:', JSON.stringify(error));
      return json({ error: "Failed to save vote." }, 500);
    }
    newVote = vote;
    notifAction = 'insert';
  }

  const [{ count: upCount }, { count: downCount }] = await Promise.all([
    (db as any).from('list_votes').select('*', { count: 'exact', head: true }).eq('list_id', list_id).eq('vote', 1),
    (db as any).from('list_votes').select('*', { count: 'exact', head: true }).eq('list_id', list_id).eq('vote', -1),
  ]);

  if (notifAction !== 'none') {
    try {
      const { data: list } = await (db as any)
        .from('lists').select('profile_id').eq('id', list_id).single();
      if (list && list.profile_id !== profile.id) {
        const notifType = newVote === 1 ? 'list_upvote' : 'list_downvote';
        const { data: existingNotif } = await (db as any)
          .from('notifications')
          .select('id')
          .eq('profile_id', list.profile_id)
          .eq('actor_profile_id', profile.id)
          .eq('list_id', list_id)
          .in('type', ['list_upvote', 'list_downvote'])
          .maybeSingle();
        if (existingNotif) {
          await (db as any).from('notifications').update({ type: notifType, read: false }).eq('id', existingNotif.id);
        } else {
          await (db as any).from('notifications').insert({
            profile_id: list.profile_id,
            actor_profile_id: profile.id,
            list_id,
            type: notifType,
          });
        }
      }
    } catch (e) {
      console.error('[lists/vote] notification error (non-fatal):', e);
    }
  }

  return json({ vote: newVote, up: upCount ?? 0, down: downCount ?? 0 });
};
