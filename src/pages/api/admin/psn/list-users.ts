export const prerender = false;
import type { APIRoute } from "astro";
import { requireAdmin, json } from "../../../../utils/api";

// Lists every PSN-connected profile for the /admin/psn-resync page. The page
// iterates this list on the client to resync each user via sync-library +
// sync-trophies in admin-impersonation mode. Admin-only — surfaces ids and
// last-synced timestamps that aren't meant for public consumption.
export const GET: APIRoute = async (context) => {
  const { auth, response } = await requireAdmin(context);
  if (!auth) return response;
  const { db } = auth;

  const { data, error } = await (db as any)
    .from('profiles')
    .select('id, username, psn_online_id, psn_account_id, psn_synced_at, psn_trophies_synced_at')
    .not('psn_account_id', 'is', null)
    .order('username', { ascending: true });

  if (error) {
    console.error('[admin/psn/list-users] query error:', JSON.stringify(error));
    return json({ error: 'Failed to list PSN users.' }, 500);
  }

  return json({ users: data ?? [] });
};
