import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { post_id, reaction_type } = await context.request.json();
  if (!post_id || !reaction_type) return json({ error: "post_id and reaction_type required." }, 400);

  const adb = db as any;

  const { data: existing } = await adb
    .from('forum_post_reactions')
    .select('id')
    .eq('post_id', post_id)
    .eq('profile_id', profile.id)
    .eq('reaction_type', reaction_type)
    .maybeSingle();

  let reacted: boolean;
  if (existing) {
    await adb.from('forum_post_reactions').delete()
      .eq('post_id', post_id).eq('profile_id', profile.id).eq('reaction_type', reaction_type);
    reacted = false;
  } else {
    const { error } = await adb.from('forum_post_reactions')
      .insert({ post_id, profile_id: profile.id, reaction_type });
    if (error) {
      console.error('[forum/react] insert error:', JSON.stringify(error));
      return json({ error: "Failed to save reaction." }, 500);
    }
    reacted = true;
  }

  const { count } = await adb
    .from('forum_post_reactions').select('*', { count: 'exact', head: true })
    .eq('post_id', post_id).eq('reaction_type', reaction_type);

  return json({ reacted, count: count ?? 0, reaction_type });
};
