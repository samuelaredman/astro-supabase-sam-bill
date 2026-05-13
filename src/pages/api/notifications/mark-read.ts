import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const POST: APIRoute = async (context) => {
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Unauthorized." }, 401);

  const db = getSupabaseAdmin() as any;
  const { data: profile } = await db
    .from('profiles').select('id').eq('auth_user_id', user.id).single();
  if (!profile) return json({ error: "Profile not found." }, 404);

  const body = await context.request.json().catch(() => ({}));
  const { notification_id } = body;

  // Mark a single notification or all unread ones
  let query = db.from('notifications').update({ read: true }).eq('profile_id', profile.id);
  if (notification_id) query = query.eq('id', notification_id);
  else query = query.eq('read', false);

  await query;
  return json({ success: true });
};
