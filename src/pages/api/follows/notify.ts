import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { following_id } = await context.request.json();
  if (!following_id) return json({ error: "following_id is required." }, 400);

  const { data: followRow } = await db
    .from('follows')
    .select('id, notify')
    .eq('follower_id', profile.id)
    .eq('following_id', following_id)
    .maybeSingle();

  if (!followRow) return json({ error: "You are not following this user." }, 400);

  const newNotify = !followRow.notify;
  await db.from('follows')
    .update({ notify: newNotify })
    .eq('id', followRow.id);

  return json({ notify: newNotify });
};
