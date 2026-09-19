import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  // Same shape as steam/disconnect: clear connection fields but leave
  // historical trophies and library rows in place. Users expect their game
  // statuses and trophy history to survive a disconnect.
  // Cast until supabase/types.ts is regenerated post-migration.
  const { error } = await (db as any).from('profiles').update({
    psn_account_id: null,
    psn_online_id: null,
    psn_access_token: null,
    psn_refresh_token: null,
    psn_token_expires_at: null,
    psn_synced_at: null,
    psn_trophies_synced_at: null,
    psn_sync_cursor: null,
    psn_sync_snapshot: null,
  }).eq('id', profile.id);

  if (error) {
    console.error('[psn/disconnect] error:', JSON.stringify(error));
    return json({ error: 'Failed to disconnect PlayStation.' }, 500);
  }

  return json({ success: true });
};
