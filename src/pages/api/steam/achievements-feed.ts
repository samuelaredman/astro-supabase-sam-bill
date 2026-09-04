import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../utils/database";
import { json } from "../../../utils/api";

const PAGE = 50;

export const GET: APIRoute = async (context) => {
  const params = context.url.searchParams;
  const profileId = params.get('profile_id');
  if (!profileId) return json({ error: 'Missing profile_id.' }, 400);

  const cursor = params.get('cursor'); // ISO timestamp — fetch items older than this

  const db = getSupabaseAdmin() as any;
  let q = db
    .from('user_achievements')
    .select('display_name, description, icon_url, global_percent, unlock_time, steam_appid, games(title, slug)')
    .eq('profile_id', profileId)
    .eq('unlocked', true)
    .not('unlock_time', 'is', null)
    .order('unlock_time', { ascending: false })
    .limit(PAGE + 1); // +1 to detect whether more pages exist

  if (cursor) q = q.lt('unlock_time', cursor);

  const { data, error } = await q;
  if (error) {
    console.error('[achievements-feed] error:', JSON.stringify(error));
    return json({ error: 'Failed to load achievements.' }, 500);
  }

  const all = data ?? [];
  const hasMore = all.length > PAGE;
  const items = hasMore ? all.slice(0, PAGE) : all;
  const nextCursor = hasMore ? items[items.length - 1]?.unlock_time ?? null : null;

  return json({ achievements: items, nextCursor, done: !hasMore });
};
