// Game-scoped achievement loader for the game detail page's Achievements tab.
//
// Mirrors the per-user modal (src/pages/api/user-achievements/game.ts) but
// reads the schema tables (steam_app_schema / psn_title_schema /
// xbox_title_schema) instead of user_* so the tab works for anonymous visitors
// and for games nobody has synced yet.
//
// Rarity lives in the schema tables for all three platforms:
//   - Steam: steam_app_schema.global_percents (jsonb map { api_name → % })
//   - PSN:   psn_title_schema.trophies[].trophyEarnedRate
//   - Xbox:  xbox_title_schema.achievements[].rarity
// so no per-user sampling is needed.

export type AchievementSource = "steam" | "psn" | "xbox";

export interface GameAchievement {
  name: string | null;
  description: string | null;
  icon_url: string | null;
  tier: "bronze" | "silver" | "gold" | "platinum" | null; // PSN only
  gamerscore: number | null;                              // Xbox only
  rarity_percent: number | null;
  hidden: boolean;
}

export interface GameAchievementGroup {
  key: string;       // 'base' | 'psn:<groupId>' | 'xbox:<gameId>'
  label: string;     // 'Base Game' | DLC name
  achievements: GameAchievement[];
}

export interface GameAchievementPlatform {
  source: AchievementSource;
  platform_label: string;
  count: number;     // total across all groups
  groups: GameAchievementGroup[];
}

export interface GameAchievementsData {
  platforms: GameAchievementPlatform[];
  debug?: GameAchievementsDebug;
}

export interface GameAchievementsDebug {
  game_id: string;
  games_psn_np_communication_id: string | null;
  games_xbox_title_id: string | null;
  resolved_psn_np_comm_ids: string[];
  resolved_xbox_title_ids: string[];
  xbox_dlc_game_ids: string[];
  xbox_title_id_by_game_id: Record<string, string>;
  xbox_schema_rows_found: string[];
  psn_schema_rows_found: string[];
  steam_appids: number[];
  steam_schema_rows_found: number[];
}

const DLC_RELATION_TYPES = ["dlc", "expansion", "standalone_expansion"];

// Steam's GetSchemaForGame returns icon hashes; rewrite them onto Valve's
// public CDN. Same transform the sync route uses.
function steamIconUrl(icon: string | null | undefined, appid: number): string | null {
  if (!icon) return null;
  const filename = icon.split("/").pop();
  if (!filename) return null;
  return `https://shared.fastly.steamstatic.com/community_assets/images/apps/${appid}/${filename}`;
}

// Locked rarity-ascending sort so rarest-first bubbles the sunshine rows up.
function sortByRarity(a: GameAchievement, b: GameAchievement): number {
  const ap = a.rarity_percent ?? 101;
  const bp = b.rarity_percent ?? 101;
  return ap - bp;
}

export async function loadGameAchievements(
  db: any,
  game: { id: string; psn_np_communication_id: string | null; xbox_title_id: string | null },
  opts: { debug?: boolean } = {},
): Promise<GameAchievementsData> {
  const platforms: GameAchievementPlatform[] = [];

  // Resolve every known platform id for this Chekpoint game. The games row
  // only stores a single first-matched psn_np_communication_id / xbox_title_id
  // (set by whichever user synced first); a cross-platform game routinely has
  // additional ids (PS4 + PS5 versions, Xbox DLC children, etc.) that only
  // show up in the per-user tables. Pull both paths and dedupe.
  const [npCommIds, xboxTitleIds] = await Promise.all([
    resolveAllPsnNpCommIds(db, game),
    resolveAllXboxTitleIds(db, game),
  ]);

  const debug: GameAchievementsDebug | undefined = opts.debug ? {
    game_id: game.id,
    games_psn_np_communication_id: game.psn_np_communication_id,
    games_xbox_title_id: game.xbox_title_id,
    resolved_psn_np_comm_ids: npCommIds,
    resolved_xbox_title_ids: xboxTitleIds,
    xbox_dlc_game_ids: [],
    xbox_title_id_by_game_id: {},
    xbox_schema_rows_found: [],
    psn_schema_rows_found: [],
    steam_appids: [],
    steam_schema_rows_found: [],
  } : undefined;

  const [steam, psn, xbox] = await Promise.all([
    loadSteam(db, game.id, debug),
    npCommIds.length > 0 ? loadPsn(db, npCommIds, debug) : Promise.resolve(null),
    xboxTitleIds.length > 0 ? loadXbox(db, game.id, debug) : Promise.resolve(null),
  ]);

  if (steam) platforms.push(steam);
  if (psn) platforms.push(psn);
  if (xbox) platforms.push(xbox);

  return debug ? { platforms, debug } : { platforms };
}

async function resolveAllPsnNpCommIds(
  db: any,
  game: { id: string; psn_np_communication_id: string | null },
): Promise<string[]> {
  const ids = new Set<string>();
  if (game.psn_np_communication_id) ids.add(game.psn_np_communication_id);
  const { data } = await db
    .from("user_game_status")
    .select("psn_np_communication_id")
    .eq("game_id", game.id)
    .not("psn_np_communication_id", "is", null);
  for (const row of (data ?? []) as any[]) {
    if (row.psn_np_communication_id) ids.add(row.psn_np_communication_id);
  }
  return [...ids];
}

async function resolveAllXboxTitleIds(
  db: any,
  game: { id: string; xbox_title_id: string | null },
): Promise<string[]> {
  const ids = new Set<string>();
  if (game.xbox_title_id) ids.add(game.xbox_title_id);
  // user_game_status.xbox_title_id is populated on every Xbox library sync
  // (sync-library.ts) — more reliably present than user_xbox_achievements,
  // which only fills once the user also runs the achievements sync. Check
  // both so a library-only sync still surfaces the game's achievements.
  const [statusRes, achRes] = await Promise.all([
    db.from("user_game_status")
      .select("xbox_title_id")
      .eq("game_id", game.id)
      .not("xbox_title_id", "is", null),
    db.from("user_xbox_achievements")
      .select("xbox_title_id")
      .eq("game_id", game.id)
      .not("xbox_title_id", "is", null),
  ]);
  for (const row of (statusRes.data ?? []) as any[]) {
    if (row.xbox_title_id) ids.add(row.xbox_title_id);
  }
  for (const row of (achRes.data ?? []) as any[]) {
    if (row.xbox_title_id) ids.add(row.xbox_title_id);
  }
  return [...ids];
}

// ── Steam ────────────────────────────────────────────────────────────────
// A game can map to multiple Steam appids via game_steam_apps (e.g. different
// regional / deluxe SKUs). Merge them into a single "Base Game" group — Steam
// has no DLC achievement grouping.
async function loadSteam(db: any, gameId: string, debug?: GameAchievementsDebug): Promise<GameAchievementPlatform | null> {
  const { data: mappings } = await db
    .from("game_steam_apps")
    .select("steam_appid")
    .eq("game_id", gameId);
  const appids: number[] = (mappings ?? []).map((m: any) => m.steam_appid).filter((n: any) => Number.isFinite(n));
  if (debug) debug.steam_appids = appids;
  if (appids.length === 0) return null;

  const { data: schemas } = await db
    .from("steam_app_schema")
    .select("steam_appid, achievements, global_percents, no_achievements")
    .in("steam_appid", appids);
  if (debug) debug.steam_schema_rows_found = ((schemas ?? []) as any[]).map((r) => r.steam_appid);

  const merged: GameAchievement[] = [];
  for (const row of (schemas ?? []) as any[]) {
    if (row.no_achievements) continue;
    const appid = row.steam_appid as number;
    const globalPercents: Record<string, number> = row.global_percents ?? {};
    const achs: any[] = Array.isArray(row.achievements) ? row.achievements : [];
    for (const a of achs) {
      const apiName = a.name ?? null;
      merged.push({
        name: a.displayName ?? apiName,
        description: a.description ?? null,
        icon_url: steamIconUrl(a.icon || a.icongray, appid),
        tier: null,
        gamerscore: null,
        rarity_percent: apiName != null && globalPercents[apiName] != null ? globalPercents[apiName] : null,
        hidden: a.hidden === 1,
      });
    }
  }
  if (merged.length === 0) return null;
  merged.sort(sortByRarity);

  return {
    source: "steam",
    platform_label: "Steam",
    count: merged.length,
    groups: [{ key: "base", label: "Base Game", achievements: merged }],
  };
}

// ── PSN ──────────────────────────────────────────────────────────────────
// trophy_group_id buckets trophies into 'default' (base) + DLC packs. A
// Chekpoint game can resolve to multiple np_communication_ids (PS4 vs PS5
// re-release, etc.) with near-identical trophy lists — rendering them all
// produces duplicate base + DLC groups, so pick the single most complete
// schema (prefer one with trophy_groups populated for proper DLC labels,
// then largest trophy count).
//
// trophyEarnedRate is NOT present in psn_title_schema.trophies (Sony only
// returns it on the per-user "earned" response). Pull distinct (trophy_id,
// earned_rate) from user_trophies for the chosen npCommId and overlay —
// the rate is game-wide so any synced user's row has the correct value.
async function loadPsn(db: any, npCommIds: string[], debug?: GameAchievementsDebug): Promise<GameAchievementPlatform | null> {
  const { data: schemas } = await db
    .from("psn_title_schema")
    .select("np_communication_id, trophies, trophy_groups, no_trophies")
    .in("np_communication_id", npCommIds);
  if (debug) debug.psn_schema_rows_found = ((schemas ?? []) as any[]).map((r) => r.np_communication_id);

  const viable = ((schemas ?? []) as any[])
    .filter((s) => !s.no_trophies && Array.isArray(s.trophies) && s.trophies.length > 0);
  if (viable.length === 0) return null;

  // Prefer schemas with trophy_groups populated (gives proper DLC pack names),
  // then by trophy count. Picking exactly one avoids the duplicate base +
  // double-DLC listings a merge would produce.
  viable.sort((a, b) => {
    const aGroups = Array.isArray(a.trophy_groups) ? a.trophy_groups.length : 0;
    const bGroups = Array.isArray(b.trophy_groups) ? b.trophy_groups.length : 0;
    if (aGroups !== bGroups) return bGroups - aGroups;
    return (b.trophies?.length ?? 0) - (a.trophies?.length ?? 0);
  });
  const schema = viable[0];
  const chosenNpCommId: string = schema.np_communication_id;
  const trophies: any[] = schema.trophies as any[];

  // Rarity overlay from user_trophies. earned_rate is a game-wide stat
  // (every user sees the same %), so pulling one row per trophy_id is
  // sufficient. Bucket by (trophyGroupId, trophyId) because PSN reuses
  // trophy IDs across groups within the same title.
  const { data: rateRows } = await db
    .from("user_trophies")
    .select("trophy_id, trophy_group_id, earned_rate")
    .eq("np_communication_id", chosenNpCommId)
    .not("earned_rate", "is", null);
  const rateByKey = new Map<string, number>();
  for (const r of (rateRows ?? []) as any[]) {
    const gid = r.trophy_group_id ?? "default";
    const key = `${gid}:${r.trophy_id}`;
    if (!rateByKey.has(key) && typeof r.earned_rate === "number") {
      rateByKey.set(key, r.earned_rate);
    }
  }

  const labelById = new Map<string, string>();
  for (const g of (schema.trophy_groups ?? []) as any[]) {
    if (g?.trophyGroupId) labelById.set(g.trophyGroupId, g.name ?? g.trophyGroupId);
  }

  const byGroup = new Map<string, GameAchievement[]>();
  for (const t of trophies) {
    const gid = t.trophyGroupId ?? "default";
    if (!byGroup.has(gid)) byGroup.set(gid, []);
    // trophyEarnedRate if present in the schema (legacy — may be from a
    // fresher version of psn-api that includes it); otherwise overlay from
    // user_trophies.
    const schemaRate = typeof t.trophyEarnedRate === "number"
      ? t.trophyEarnedRate
      : (typeof t.trophyEarnedRate === "string" ? Number(t.trophyEarnedRate) : null);
    const rarity = schemaRate != null && Number.isFinite(schemaRate)
      ? schemaRate
      : (rateByKey.get(`${gid}:${t.trophyId}`) ?? null);
    byGroup.get(gid)!.push({
      name: t.trophyName ?? null,
      description: t.trophyDetail ?? null,
      icon_url: t.trophyIconUrl ?? null,
      tier: normalisePsnTier(t.trophyType),
      gamerscore: null,
      rarity_percent: rarity,
      hidden: t.trophyHidden === true || t.trophyHidden === "true",
    });
  }

  const ids = [...byGroup.keys()].sort((a, b) => {
    if (a === "default") return -1;
    if (b === "default") return 1;
    return a.localeCompare(b, undefined, { numeric: true });
  });

  const groups: GameAchievementGroup[] = ids.map((gid) => ({
    key: gid === "default" ? "base" : `psn:${gid}`,
    label: gid === "default" ? "Base Game" : (labelById.get(gid) ?? `DLC ${gid}`),
    achievements: byGroup.get(gid)!.sort(sortByRarity),
  }));

  const count = groups.reduce((n, g) => n + g.achievements.length, 0);
  if (count === 0) return null;

  return { source: "psn", platform_label: "PlayStation", count, groups };
}

function normalisePsnTier(v: any): "bronze" | "silver" | "gold" | "platinum" | null {
  if (v === "bronze" || v === "silver" || v === "gold" || v === "platinum") return v;
  return null;
}

// ── Xbox ─────────────────────────────────────────────────────────────────
// Base game lives on games.xbox_title_id; DLC children are separate games
// linked via game_relationships(relation_type IN (dlc, expansion, standalone))
// with their own xbox_title_id → xbox_title_schema row.
//
// games.xbox_title_id is set by whichever user synced the match first — a
// game first matched by a Steam or PSN user leaves it NULL even when Xbox
// users later populate user_xbox_achievements / xbox_title_schema for the
// same Chekpoint game. So resolve the title id per game_id by unioning
// games.xbox_title_id with the distinct xbox_title_id values observed on
// user_xbox_achievements rows for that game_id.
async function loadXbox(db: any, baseGameId: string, debug?: GameAchievementsDebug): Promise<GameAchievementPlatform | null> {
  const { data: dlcRels } = await db
    .from("game_relationships")
    .select("to_game_id")
    .eq("from_game_id", baseGameId)
    .in("relation_type", DLC_RELATION_TYPES);
  const dlcIds: string[] = (dlcRels ?? []).map((r: any) => r.to_game_id);
  if (debug) debug.xbox_dlc_game_ids = dlcIds;

  const allGameIds = [baseGameId, ...dlcIds];
  const [gamesRes, userStatusRes, userAchRes] = await Promise.all([
    db.from("games").select("id, title, xbox_title_id").in("id", allGameIds),
    db.from("user_game_status")
      .select("game_id, xbox_title_id")
      .in("game_id", allGameIds)
      .not("xbox_title_id", "is", null),
    db.from("user_xbox_achievements")
      .select("game_id, xbox_title_id")
      .in("game_id", allGameIds)
      .not("xbox_title_id", "is", null),
  ]);

  // title id per game_id: prefer the games column, then user_game_status
  // (populated by the library sync), then user_xbox_achievements (populated
  // only once achievements sync has also run).
  const titleIdByGameId = new Map<string, string>();
  for (const g of (gamesRes.data ?? []) as any[]) {
    if (g.xbox_title_id) titleIdByGameId.set(g.id, g.xbox_title_id);
  }
  for (const r of (userStatusRes.data ?? []) as any[]) {
    if (r.xbox_title_id && !titleIdByGameId.has(r.game_id)) {
      titleIdByGameId.set(r.game_id, r.xbox_title_id);
    }
  }
  for (const r of (userAchRes.data ?? []) as any[]) {
    if (r.xbox_title_id && !titleIdByGameId.has(r.game_id)) {
      titleIdByGameId.set(r.game_id, r.xbox_title_id);
    }
  }

  const gamesList: Array<{ id: string; title: string; xbox_title_id: string }> = (
    (gamesRes.data ?? []) as any[]
  )
    .map((g: any) => ({
      id: g.id,
      title: g.title,
      xbox_title_id: titleIdByGameId.get(g.id) ?? null,
    }))
    .filter((g: any): g is { id: string; title: string; xbox_title_id: string } => !!g.xbox_title_id);
  if (gamesList.length === 0) return null;

  const titleIds = [...new Set(gamesList.map((g) => g.xbox_title_id))];
  if (debug) {
    for (const [k, v] of titleIdByGameId) debug.xbox_title_id_by_game_id[k] = v;
  }
  const { data: schemaRows } = await db
    .from("xbox_title_schema")
    .select("xbox_title_id, achievements, no_achievements")
    .in("xbox_title_id", titleIds);
  if (debug) debug.xbox_schema_rows_found = ((schemaRows ?? []) as any[]).map((r) => r.xbox_title_id);
  const schemaByTitleId = new Map<string, any>(
    (schemaRows ?? []).map((r: any) => [r.xbox_title_id, r]),
  );

  const groups: GameAchievementGroup[] = [];
  // Base first (if it has achievements), then DLC in title order.
  const ordered = [...gamesList].sort((a, b) => {
    if (a.id === baseGameId) return -1;
    if (b.id === baseGameId) return 1;
    return a.title.localeCompare(b.title);
  });

  for (const g of ordered) {
    const schema = schemaByTitleId.get(g.xbox_title_id);
    if (!schema || schema.no_achievements) continue;
    const achs: any[] = Array.isArray(schema.achievements) ? schema.achievements : [];
    if (achs.length === 0) continue;
    const normalised: GameAchievement[] = achs.map((a) => ({
      name: a.name ?? null,
      description: a.description ?? null,
      icon_url: a.icon_url ?? null,
      tier: null,
      gamerscore: typeof a.gamerscore === "number" ? a.gamerscore : null,
      rarity_percent: typeof a.rarity === "number" ? a.rarity : null,
      hidden: false,
    })).sort(sortByRarity);

    const isBase = g.id === baseGameId;
    groups.push({
      key: isBase ? "base" : `xbox:${g.id}`,
      label: isBase ? "Base Game" : g.title,
      achievements: normalised,
    });
  }

  const count = groups.reduce((n, g) => n + g.achievements.length, 0);
  if (count === 0) return null;

  return { source: "xbox", platform_label: "Xbox", count, groups };
}
