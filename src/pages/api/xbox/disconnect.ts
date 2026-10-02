import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  // Mirror steam/psn disconnect: clear the connection fields but leave
  // historical library rows and achievements in place. Users expect their
  // tracked games and unlock history to survive a reconnect.
  const { error } = await (db as any).from('profiles').update({
    xbox_xuid: null,
    xbox_gamertag: null,
    xbox_api_key: null,
    xbox_synced_at: null,
    xbox_achievements_synced_at: null,
    xbox_sync_cursor: null,
    xbox_sync_snapshot: null,
  }).eq('id', profile.id);

  if (error) {
    console.error('[xbox/disconnect] error:', JSON.stringify(error));
    return json({ error: 'Failed to disconnect Xbox.' }, 500);
  }

  return json({ success: true });
};
