import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../utils/database";
import { json } from "../../../utils/api";

const PER_PAGE = 60;

export const GET: APIRoute = async (context) => {
  const p = context.url.searchParams;
  const profileId = p.get('profile_id');
  if (!profileId) return json({ error: 'Missing profile_id.' }, 400);

  const page    = Math.max(1, parseInt(p.get('page') ?? '1'));
  const perPage = Math.min(120, Math.max(10, parseInt(p.get('per_page') ?? String(PER_PAGE))));
  const q       = p.get('q')?.trim() ?? '';
  const rarity  = p.get('rarity') ?? 'all';
  const days    = parseInt(p.get('days') ?? '0') || 0;

  const db = getSupabaseAdmin() as any;
  let query = db
    .from('user_achievements')
    .select('display_name, description, icon_url, global_percent, unlock_time, steam_appid, api_name, steam_game_title, games(title)', { count: 'exact' })
    .eq('profile_id', profileId)
    .eq('unlocked', true)
    .not('unlock_time', 'is', null);

  if (q)               query = query.ilike('display_name', `%${q}%`);
  if (rarity === 'gold')     query = query.lt('global_percent', 10);
  else if (rarity === 'rare')     query = query.gte('global_percent', 10).lt('global_percent', 25);
  else if (rarity === 'uncommon') query = query.gte('global_percent', 25).lt('global_percent', 50);
  else if (rarity === 'common')   query = query.gte('global_percent', 50);

  if (days > 0) {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    query = query.gte('unlock_time', cutoff);
  }

  query = query
    .order('unlock_time', { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  const { data, count, error } = await query;
  if (error) {
    console.error('[achievements-feed] error:', JSON.stringify(error));
    return json({ error: 'Failed to load achievements.' }, 500);
  }

  const total = count ?? 0;
  return json({
    achievements: data ?? [],
    total,
    page,
    pages: Math.max(1, Math.ceil(total / perPage)),
    perPage,
  });
};
