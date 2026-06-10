import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json().catch(() => ({}));
  const { notification_id } = body;

  // Mark a single notification or all unread ones
  let query = db.from('notifications').update({ read: true }).eq('profile_id', profile.id);
  if (notification_id) query = query.eq('id', notification_id);
  else query = query.eq('read', false);

  await query;
  return json({ success: true });
};
