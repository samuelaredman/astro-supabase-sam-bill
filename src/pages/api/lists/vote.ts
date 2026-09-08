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

  // One select of this list's votes instead of two count(*) scans; the author
  // lookup runs in parallel since it doesn't depend on the counts.
  const [votesRes, listRes] = await Promise.all([
    (db as any).from('list_votes').select('vote').eq('list_id', list_id),
    notifAction !== 'none'
      ? (db as any).from('lists').select('profile_id').eq('id', list_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const voteRows = votesRes.data ?? [];
  const upCount = voteRows.filter((v: any) => v.vote === 1).length;
  const downCount = voteRows.filter((v: any) => v.vote === -1).length;

  const list = listRes.data as { profile_id: string } | null;
  if (notifAction !== 'none' && list && list.profile_id !== profile.id) {
    try {
      const notifType = newVote === 1 ? 'list_upvote' : 'list_downvote';
      const { data: updated } = await (db as any)
        .from('notifications')
        .update({ type: notifType, read: false })
        .eq('profile_id', list.profile_id)
        .eq('actor_profile_id', profile.id)
        .eq('list_id', list_id)
        .in('type', ['list_upvote', 'list_downvote'])
        .select('id');
      if (!updated || updated.length === 0) {
        await (db as any).from('notifications').insert({
          profile_id: list.profile_id,
          actor_profile_id: profile.id,
          list_id,
          type: notifType,
        });
      }
    } catch (e) {
      console.error('[lists/vote] notification error (non-fatal):', e);
    }
  }

  return json({ vote: newVote, up: upCount, down: downCount });
};
