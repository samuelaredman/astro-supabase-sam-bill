import type { APIRoute } from "astro";
import { getSupabaseAdmin, createSupabaseServerClientFromContext } from "../../../utils/database";
import { json } from "../../../utils/api";

const PAGE_SIZE = 96;

export const GET: APIRoute = async (context) => {
  const db = getSupabaseAdmin() as any;
  const p = context.url.searchParams;

  const username  = p.get('username');
  const page      = Math.max(1, parseInt(p.get('page') || '1'));
  const filter    = p.get('filter') || 'all';
  const sort      = p.get('sort')   || 'recent';
  const search    = (p.get('search') || '').trim();
  const showHidden = p.get('hidden') === 'true';

  if (!username) return json({ error: 'username required' }, 400);

  const { data: profile } = await db
    .from('profiles')
    .select('id, want_to_play_privacy, dropped_privacy')
    .eq('username', username)
    .single();
  if (!profile) return json({ error: 'Not found' }, 404);

  const { data: libSettings } = await db
    .from('profile_library_settings')
    .select('library_visibility')
    .eq('profile_id', profile.id)
    .maybeSingle();
  const libraryVisibility = libSettings?.library_visibility ?? 'public';

  // Auth
  let isOwn = false;
  let isMutualFollow = false;
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (user) {
    const { data: vp } = await db.from('profiles').select('id').eq('auth_user_id', user.id).single();
    if (vp) {
      isOwn = vp.id === profile.id;
      if (!isOwn) {
        const [{ data: f1 }, { data: f2 }] = await Promise.all([
          db.from('follows').select('id').eq('follower_id', profile.id).eq('following_id', vp.id).maybeSingle(),
          db.from('follows').select('id').eq('follower_id', vp.id).eq('following_id', profile.id).maybeSingle(),
        ]);
        isMutualFollow = !!(f1 && f2);
      }
    }
  }

  if (libraryVisibility === 'private' && !isOwn)
    return json({ items: [], total: 0, page: 1, pageSize: PAGE_SIZE, hasMore: false });

  const canSeeWantToPlay = isOwn || !(
    profile.want_to_play_privacy === 'private' ||
    (profile.want_to_play_privacy === 'friends' && !isMutualFollow)
  );
  const canSeeDropped = isOwn || !(
    profile.dropped_privacy === 'private' ||
    (profile.dropped_privacy === 'friends' && !isMutualFollow)
  );

  // Use !inner join when searching so the title filter is applied correctly
  const gamesJoin = search
    ? 'games!inner(id, title, slug, cover_img_url, game_genres(genres(name, slug)))'
    : 'games(id, title, slug, cover_img_url, game_genres(genres(name, slug)))';

  let q = db
    .from('user_game_status')
    .select(`status, is_hidden, is_owned, updated_at, steam_playtime_minutes, ${gamesJoin}`, { count: 'exact' })
    .eq('profile_id', profile.id);

  if (showHidden && isOwn) {
    q = q.eq('is_hidden', true);
  } else {
    q = q.eq('is_hidden', false);
    if (!canSeeWantToPlay) q = q.neq('status', 'want_to_play');
    if (!canSeeDropped)    q = q.neq('status', 'dropped');
  }

  // Status filter
  if (filter === 'owned') {
    q = q.eq('is_owned', true);
  } else if (filter === 'completed') {
    q = q.in('status', ['completed', 'hundred_percent']);
  } else if (filter === 'unplayed') {
    q = q
      .not('status', 'in', '(completed,hundred_percent)')
      .or('steam_playtime_minutes.is.null,steam_playtime_minutes.eq.0');
  } else if (filter !== 'all') {
    q = q.eq('status', filter);
  }

  if (search) q = q.ilike('games.title', `%${search}%`);

  if (sort === 'alpha') {
    q = q.order('title', { foreignTable: 'games', ascending: true });
  } else if (sort === 'hours') {
    q = q.order('steam_playtime_minutes', { ascending: false, nullsFirst: false });
  } else {
    q = q.order('updated_at', { ascending: false });
  }

  const from = (page - 1) * PAGE_SIZE;
  const { data: rows, count: total, error } = await q.range(from, from + PAGE_SIZE - 1);

  if (error) {
    console.error('[library API] error:', JSON.stringify(error));
    return json({ error: 'Failed to load library' }, 500);
  }

  const items = (rows ?? []).map((r: any) => ({
    gameId:   r.games?.id ?? '',
    title:    r.games?.title ?? '',
    slug:     r.games?.slug ?? '',
    cover:    r.games?.cover_img_url ?? null,
    status:   r.status,
    owned:    r.is_owned ?? false,
    isHidden: r.is_hidden ?? false,
    updatedAt: r.updated_at ?? '',
    playtime: r.steam_playtime_minutes ?? null,
    genres:   (r.games?.game_genres ?? []).map((gg: any) => gg.genres?.name).filter(Boolean),
  }));

  return json({ items, total: total ?? 0, page, pageSize: PAGE_SIZE, hasMore: items.length === PAGE_SIZE });
};
