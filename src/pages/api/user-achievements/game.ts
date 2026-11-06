import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../utils/database";
import { json } from "../../../utils/api";

// Full achievement list for one (user, game) pair, including locked rows.
// Powers the modal opened from the detailed library view's completion bar.
// The feed endpoint (user-achievements/feed.ts) reads user_unlocks and only
// returns unlocked rows; this one reads the raw per-source tables so the
// modal can show earned + unearned side-by-side.
//
// Achievements are publicly readable (RLS: USING (true)), so no auth gate —
// matching the feed endpoint. Admin client is used for the join on games(title).
//
// Response is grouped: a single "Base Game" group for Steam (Steam's schema
// exposes no DLC tagging), per-trophy-group groups for PSN (native), and
// base+DLC-children groups for Xbox (resolved via game_relationships).

type Source = "steam" | "psn" | "xbox";

interface Achievement {
  name: string | null;
  description: string | null;
  icon_url: string | null;
  icon_gray_url: string | null;
  unlocked: boolean;
  unlock_time: string | null;
  global_percent: number | null;
  trophy_type: string | null;
  gamerscore: number | null;
  hidden: boolean;
}

interface GroupOut {
  key: string;
  label: string;
  count: number;
  unlocked: number;
  percent: number;
  xp_earned: number | null;
  xp_total: number | null;
  achievements: Achievement[];
}

const DLC_RELATION_TYPES = ['dlc', 'expansion', 'standalone_expansion'];

export const GET: APIRoute = async ({ url }) => {
  const db = getSupabaseAdmin() as any;
  const p = url.searchParams;

  const username = p.get("username");
  const source = (p.get("source") || "") as Source;
  const id = p.get("id") || "";

  if (!username) return json({ error: "username required" }, 400);
  if (source !== "steam" && source !== "psn" && source !== "xbox") {
    return json({ error: "invalid source" }, 400);
  }
  if (!id) return json({ error: "id required" }, 400);

  const { data: profile } = await db
    .from("profiles").select("id").eq("username", username).maybeSingle();
  if (!profile) return json({ error: "Not found" }, 404);

  if (source === "steam") return handleSteam(db, profile.id, id);
  if (source === "psn") return handlePsn(db, profile.id, id);
  return handleXbox(db, profile.id, id);
};

// ── Steam ────────────────────────────────────────────────────────────────
// No DLC grouping: Steam's achievement schema has no dlcappid / dlc_id /
// group field. DLC achievements are appended to the base appid with no
// discriminator. Everything renders as a single "Base Game" group.
async function handleSteam(db: any, profileId: string, id: string): Promise<Response> {
  const appid = parseInt(id, 10);
  if (!Number.isFinite(appid)) return json({ error: "invalid id" }, 400);

  const { data, error } = await db
    .from("user_achievements")
    .select("display_name, description, icon_url, icon_gray_url, unlocked, unlock_time, global_percent, hidden, steam_game_title, games(title)")
    .eq("profile_id", profileId)
    .eq("steam_appid", appid)
    .limit(2000);
  if (error) {
    console.error("[ach modal steam] error:", JSON.stringify(error));
    return json({ error: "Failed to load achievements" }, 500);
  }

  const rows = (data ?? []) as any[];
  const gameTitle = rows[0]?.games?.title ?? rows[0]?.steam_game_title ?? null;
  const achievements = rows.map((r) => ({
    name: r.display_name ?? null,
    description: r.description ?? null,
    icon_url: r.icon_url ?? null,
    icon_gray_url: r.icon_gray_url ?? null,
    unlocked: !!r.unlocked,
    unlock_time: r.unlock_time ?? null,
    global_percent: r.global_percent ?? null,
    trophy_type: null as string | null,
    gamerscore: null as number | null,
    hidden: !!r.hidden,
  })).sort(sortAchievements);

  const group: GroupOut = buildGroup('base', 'Base Game', achievements);
  return json(wrap('steam', 'Steam', gameTitle, [group]));
}

// ── PSN ──────────────────────────────────────────────────────────────────
// Native grouping via trophy_group_id. 'default' is the base game; other
// group IDs are DLC/expansion packs. Group display names come from
// psn_title_schema.trophy_groups (populated at sync time via the 'all'
// scope — see src/utils/psn.ts fetchTitleTrophySchema).
async function handlePsn(db: any, profileId: string, id: string): Promise<Response> {
  const [{ data: rowsData, error: rowsErr }, { data: schema }] = await Promise.all([
    db.from("user_trophies")
      .select("name, description, icon_url, earned, earned_at, earned_rate, trophy_type, hidden, psn_platform, psn_game_title, trophy_group_id, games(title)")
      .eq("profile_id", profileId)
      .eq("np_communication_id", id)
      .limit(2000),
    db.from("psn_title_schema")
      .select("trophy_groups")
      .eq("np_communication_id", id)
      .maybeSingle(),
  ]);
  if (rowsErr) {
    console.error("[ach modal psn] error:", JSON.stringify(rowsErr));
    return json({ error: "Failed to load achievements" }, 500);
  }

  const rows = (rowsData ?? []) as any[];
  const gameTitle = rows[0]?.games?.title ?? rows[0]?.psn_game_title ?? null;
  const platformLabel = rows[0]?.psn_platform ?? "PSN";

  // Build label lookup from the schema's trophy_groups jsonb (if cached).
  // Shape: [{ trophyGroupId, name, iconUrl, definedTrophies }]. The 'default'
  // group is sometimes present with its own display name; otherwise we
  // override it to "Base Game" for consistency.
  const labelByGroupId = new Map<string, string>();
  for (const g of (schema?.trophy_groups ?? []) as any[]) {
    if (g?.trophyGroupId) labelByGroupId.set(g.trophyGroupId, g.name ?? g.trophyGroupId);
  }

  // Bucket rows by trophy_group_id
  const byGroup = new Map<string, Achievement[]>();
  for (const r of rows) {
    const gid = r.trophy_group_id ?? 'default';
    if (!byGroup.has(gid)) byGroup.set(gid, []);
    byGroup.get(gid)!.push({
      name: r.name ?? null,
      description: r.description ?? null,
      icon_url: r.icon_url ?? null,
      icon_gray_url: null,
      unlocked: !!r.earned,
      unlock_time: r.earned_at ?? null,
      global_percent: r.earned_rate ?? null,
      trophy_type: r.trophy_type ?? null,
      gamerscore: null,
      hidden: !!r.hidden,
    });
  }

  // Stable order: default/base first, then by numeric or lexical group id
  const groupIds = [...byGroup.keys()].sort((a, b) => {
    if (a === 'default') return -1;
    if (b === 'default') return 1;
    return a.localeCompare(b, undefined, { numeric: true });
  });

  const groups: GroupOut[] = groupIds.map((gid) => {
    const label = gid === 'default'
      ? 'Base Game'
      : (labelByGroupId.get(gid) ?? `DLC ${gid}`);
    const achievements = byGroup.get(gid)!.sort(sortAchievements);
    return buildGroup(gid === 'default' ? 'base' : `psn:${gid}`, label, achievements);
  });

  return json(wrap('psn', platformLabel, gameTitle, groups));
}

// ── Xbox ─────────────────────────────────────────────────────────────────
// Xbox treats each DLC as a separate titleId mapped to its own game row.
// Resolve the input xbox_title_id → game_id; if that game is a DLC, climb to
// the parent base game via game_relationships. Then fetch the base game's
// achievements plus every DLC child's achievements in one query, grouped by
// game_id.
async function handleXbox(db: any, profileId: string, id: string): Promise<Response> {
  // 1. Resolve the game_id for this xbox_title_id from the user's rows.
  //    A single xbox_title_id maps to one game_id by sync convention.
  const { data: seedRow } = await db
    .from("user_xbox_achievements")
    .select("game_id, xbox_game_title, games(id, title, igdb_category)")
    .eq("profile_id", profileId)
    .eq("xbox_title_id", id)
    .limit(1)
    .maybeSingle();

  // If we have no rows at all, bail with an empty single group.
  if (!seedRow?.games?.id) return handleXboxFlat(db, profileId, id);

  const seedGame = seedRow.games as { id: string; title: string; igdb_category: number | null };

  // 2. Figure out the base game. If this game IS a DLC, climb up.
  let baseGameId = seedGame.id;
  let baseGameTitle = seedGame.title;
  if (seedGame.igdb_category === 1 || seedGame.igdb_category === 2 || seedGame.igdb_category === 4) {
    const { data: parentRel } = await db
      .from("game_relationships")
      .select("from_game_id")
      .eq("to_game_id", seedGame.id)
      .in("relation_type", DLC_RELATION_TYPES)
      .limit(1)
      .maybeSingle();
    if (parentRel?.from_game_id) {
      baseGameId = parentRel.from_game_id;
      // baseGameTitle resolved below alongside all other group labels
    }
  }

  // 3. Enumerate DLC children of the base.
  const { data: dlcRels } = await db
    .from("game_relationships")
    .select("to_game_id")
    .eq("from_game_id", baseGameId)
    .in("relation_type", DLC_RELATION_TYPES);
  const dlcIds = (dlcRels ?? []).map((r: any) => r.to_game_id);

  // 4. Fetch achievements for base + all DLC children in one query.
  const allIds = [baseGameId, ...dlcIds];
  const { data: rows, error } = await db
    .from("user_xbox_achievements")
    .select("name, description, icon_url, unlocked, unlocked_at, rarity, gamerscore, game_id, xbox_game_title")
    .eq("profile_id", profileId)
    .in("game_id", allIds)
    .limit(5000);
  if (error) {
    console.error("[ach modal xbox] error:", JSON.stringify(error));
    return json({ error: "Failed to load achievements" }, 500);
  }

  // 5. Resolve titles for each game_id that actually has rows (plus always
  //    include the base row so its label is correct even with zero rows).
  const presentGameIds = [...new Set((rows ?? []).map((r: any) => r.game_id))];
  const titleIds = [...new Set([baseGameId, ...presentGameIds])];
  const { data: gameMeta } = await db
    .from("games").select("id, title, igdb_category").in("id", titleIds);
  const metaById = new Map<string, { title: string; igdb_category: number | null }>(
    (gameMeta ?? []).map((g: any) => [g.id, { title: g.title, igdb_category: g.igdb_category }]),
  );
  // Prefer the DB-resolved base-game title over the seed row's value in case
  // the seed was a DLC (seedGame.title was the DLC's title, not the base's).
  if (metaById.has(baseGameId)) baseGameTitle = metaById.get(baseGameId)!.title;

  // 6. Bucket rows by game_id. Also capture the Xbox-native title per game_id
  //    as a fallback label for cases where the Chekpoint games.title is
  //    unavailable (unmatched DLC titleId, orphaned row, etc.).
  const xboxTitleByGame = new Map<string, string>();
  const byGame = new Map<string, Achievement[]>();
  for (const r of (rows ?? [])) {
    if (r.xbox_game_title && !xboxTitleByGame.has(r.game_id)) {
      xboxTitleByGame.set(r.game_id, r.xbox_game_title);
    }
    if (!byGame.has(r.game_id)) byGame.set(r.game_id, []);
    byGame.get(r.game_id)!.push({
      name: r.name ?? null,
      description: r.description ?? null,
      icon_url: r.icon_url ?? null,
      icon_gray_url: null,
      unlocked: !!r.unlocked,
      unlock_time: r.unlocked_at ?? null,
      global_percent: r.rarity ?? null,
      trophy_type: null,
      gamerscore: r.gamerscore ?? null,
      hidden: false,
    });
  }

  // 7. Build groups: base first, then DLC children in title order.
  const sortedGameIds = [...byGame.keys()].sort((a, b) => {
    if (a === baseGameId) return -1;
    if (b === baseGameId) return 1;
    return (metaById.get(a)?.title ?? '').localeCompare(metaById.get(b)?.title ?? '');
  });

  const groups: GroupOut[] = sortedGameIds.map((gid) => {
    const isBase = gid === baseGameId;
    const label = isBase
      ? 'Base Game'
      : (metaById.get(gid)?.title ?? xboxTitleByGame.get(gid) ?? 'DLC');
    const key = isBase ? 'base' : `dlc:${gid}`;
    const achievements = byGame.get(gid)!.sort(sortAchievements);
    return buildGroup(key, label, achievements);
  });

  return json(wrap('xbox', 'Xbox', baseGameTitle, groups));
}

// Fallback for xbox when we can't resolve a game_id — treat as flat single group.
async function handleXboxFlat(db: any, profileId: string, id: string): Promise<Response> {
  const { data, error } = await db
    .from("user_xbox_achievements")
    .select("name, description, icon_url, unlocked, unlocked_at, rarity, gamerscore, xbox_game_title, games(title)")
    .eq("profile_id", profileId)
    .eq("xbox_title_id", id)
    .limit(2000);
  if (error) {
    console.error("[ach modal xbox flat] error:", JSON.stringify(error));
    return json({ error: "Failed to load achievements" }, 500);
  }
  const rows = (data ?? []) as any[];
  const gameTitle = rows[0]?.games?.title ?? rows[0]?.xbox_game_title ?? null;
  const achievements = rows.map((r) => ({
    name: r.name ?? null,
    description: r.description ?? null,
    icon_url: r.icon_url ?? null,
    icon_gray_url: null as string | null,
    unlocked: !!r.unlocked,
    unlock_time: r.unlocked_at ?? null,
    global_percent: r.rarity ?? null,
    trophy_type: null as string | null,
    gamerscore: r.gamerscore ?? null,
    hidden: false,
  })).sort(sortAchievements);
  return json(wrap('xbox', 'Xbox', gameTitle, [buildGroup('base', 'Base Game', achievements)]));
}

// ── Shaping helpers ──────────────────────────────────────────────────────

function buildGroup(key: string, label: string, achievements: Achievement[]): GroupOut {
  const unlocked = achievements.filter((a) => a.unlocked).length;
  const count = achievements.length;
  const percent = count > 0 ? Math.round((unlocked / count) * 100) : 0;
  // Gamerscore totals — Xbox-only; sum to null for Steam/PSN rows (gamerscore stays null there)
  let xp_earned: number | null = null;
  let xp_total: number | null = null;
  for (const a of achievements) {
    if (a.gamerscore != null) {
      xp_total = (xp_total ?? 0) + a.gamerscore;
      if (a.unlocked) xp_earned = (xp_earned ?? 0) + a.gamerscore;
    }
  }
  return { key, label, count, unlocked, percent, xp_earned, xp_total, achievements };
}

function wrap(
  source: Source,
  platformLabel: string,
  gameTitle: string | null,
  groups: GroupOut[],
) {
  const count = groups.reduce((n, g) => n + g.count, 0);
  const unlocked = groups.reduce((n, g) => n + g.unlocked, 0);
  const percent = count > 0 ? Math.round((unlocked / count) * 100) : 0;
  // XP totals are null unless at least one group has data (Xbox).
  const anyXp = groups.some((g) => g.xp_total != null);
  const xp_earned = anyXp ? groups.reduce((n, g) => n + (g.xp_earned ?? 0), 0) : null;
  const xp_total = anyXp ? groups.reduce((n, g) => n + (g.xp_total ?? 0), 0) : null;

  return {
    source,
    platform_label: platformLabel,
    game_title: gameTitle,
    total: { count, unlocked, percent, xp_earned, xp_total },
    groups,
  };
}

// Unlocked first (most recent unlock on top), then locked by rarity.
function sortAchievements(a: Achievement, b: Achievement): number {
  if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
  if (a.unlocked) {
    const at = a.unlock_time ? new Date(a.unlock_time).getTime() : 0;
    const bt = b.unlock_time ? new Date(b.unlock_time).getTime() : 0;
    return bt - at;
  }
  const ap = a.global_percent ?? -1;
  const bp = b.global_percent ?? -1;
  return bp - ap;
}
