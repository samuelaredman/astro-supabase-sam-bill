import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const POST: APIRoute = async (context) => {
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Unauthorized." }, 401);

  const { following_id } = await context.request.json();
  if (!following_id) return json({ error: "following_id is required." }, 400);

  const db = getSupabaseAdmin() as any;

  const { data: profile } = await db
    .from('profiles').select('id').eq('auth_user_id', user.id).single();
  if (!profile) return json({ error: "Profile not found." }, 404);

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
