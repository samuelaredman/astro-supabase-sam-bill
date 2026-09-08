import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;
  const adb = db as any;

  const { post_id, vote } = await context.request.json();
  if (!post_id || ![1, -1].includes(vote)) return json({ error: "Invalid request." }, 400);

  const { data: existing } = await adb
    .from('forum_post_votes')
    .select('vote')
    .eq('profile_id', profile.id)
    .eq('post_id', post_id)
    .maybeSingle();

  let newVote: number | null;

  if (existing) {
    if (existing.vote === vote) {
      await adb.from('forum_post_votes').delete()
        .eq('profile_id', profile.id).eq('post_id', post_id);
      newVote = null;
    } else {
      await adb.from('forum_post_votes').update({ vote })
        .eq('profile_id', profile.id).eq('post_id', post_id);
      newVote = vote;
    }
  } else {
    const { error } = await adb.from('forum_post_votes')
      .insert({ profile_id: profile.id, post_id, vote });
    if (error) {
      console.error('[forum/vote] insert error:', JSON.stringify(error));
      return json({ error: "Failed to save vote." }, 500);
    }
    newVote = vote;
  }

  // One select of this post's votes instead of two count(*) scans.
  const { data: voteRows } = await adb
    .from('forum_post_votes').select('vote').eq('post_id', post_id);
  const rows = voteRows ?? [];
  const up = rows.filter((v: any) => v.vote === 1).length;
  const down = rows.filter((v: any) => v.vote === -1).length;

  return json({ vote: newVote, up, down });
};
