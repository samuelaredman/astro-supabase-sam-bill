import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { list_id, reaction_type } = await context.request.json();
  if (!list_id || !reaction_type)
    return json({ error: "list_id and reaction_type are required." }, 400);

  const { data: existing } = await (db as any)
    .from('list_reactions')
    .select('id')
    .eq('list_id', list_id)
    .eq('profile_id', profile.id)
    .eq('reaction_type', reaction_type)
    .maybeSingle();

  let reacted: boolean;
  if (existing) {
    await (db as any).from('list_reactions').delete()
      .eq('list_id', list_id)
      .eq('profile_id', profile.id)
      .eq('reaction_type', reaction_type);
    reacted = false;
  } else {
    await (db as any).from('list_reactions')
      .insert({ list_id, profile_id: profile.id, reaction_type });
    reacted = true;
  }

  const { count } = await (db as any)
    .from('list_reactions')
    .select('*', { count: 'exact', head: true })
    .eq('list_id', list_id)
    .eq('reaction_type', reaction_type);

  if (reacted) {
    try {
      const { data: list } = await (db as any)
        .from('lists').select('profile_id').eq('id', list_id).single();
      if (list && list.profile_id !== profile.id) {
        await (db as any).from('notifications').insert({
          profile_id: list.profile_id,
          actor_profile_id: profile.id,
          list_id,
          type: 'list_reaction',
        });
      }
    } catch (e) {
      console.error('[lists/react] notification error (non-fatal):', e);
    }
  }

  return json({ reacted, count: count ?? 0, reaction_type });
};
