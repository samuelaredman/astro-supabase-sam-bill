import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { recommendation_id, reaction_type } = await context.request.json();
  if (!recommendation_id || !reaction_type)
    return json({ error: "recommendation_id and reaction_type are required." }, 400);

  const { data: existing } = await (db as any)
    .from('recommendation_reactions')
    .select('id')
    .eq('recommendation_id', recommendation_id)
    .eq('profile_id', profile.id)
    .eq('reaction_type', reaction_type)
    .maybeSingle();

  let reacted: boolean;
  if (existing) {
    await (db as any).from('recommendation_reactions').delete()
      .eq('recommendation_id', recommendation_id)
      .eq('profile_id', profile.id)
      .eq('reaction_type', reaction_type);
    reacted = false;
  } else {
    await (db as any).from('recommendation_reactions')
      .insert({ recommendation_id, profile_id: profile.id, reaction_type });
    reacted = true;
  }

  const { count } = await (db as any)
    .from('recommendation_reactions')
    .select('*', { count: 'exact', head: true })
    .eq('recommendation_id', recommendation_id)
    .eq('reaction_type', reaction_type);

  if (reacted) {
    try {
      const { data: rec } = await (db as any)
        .from('recommendations').select('profile_id').eq('id', recommendation_id).single();
      if (rec && rec.profile_id !== profile.id) {
        await (db as any).from('notifications').insert({
          profile_id: rec.profile_id,
          actor_profile_id: profile.id,
          recommendation_id,
          type: 'recommendation_reaction',
        });
      }
    } catch (e) {
      console.error('[recommendations/react] notification error (non-fatal):', e);
    }
  }

  return json({ reacted, count: count ?? 0, reaction_type });
};
