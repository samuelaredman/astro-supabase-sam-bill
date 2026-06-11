import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { error } = await db.from('profiles').update({
    steam_id: null,
    steam_username: null,
    steam_synced_at: null,
  }).eq('id', profile.id);

  if (error) {
    console.error('[steam/disconnect] error:', JSON.stringify(error));
    return json({ error: 'Failed to disconnect Steam.' }, 500);
  }

  return json({ success: true });
};
