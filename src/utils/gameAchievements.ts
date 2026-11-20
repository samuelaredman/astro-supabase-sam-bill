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
): Promise<GameAchievementsData> {
  const platforms: GameAchievementPlatform[] = [];

  const [steam, psn, xbox] = await Promise.all([
    loadSteam(db, game.id),
    game.psn_np_communication_id ? loadPsn(db, game.psn_np_communication_id) : Promise.resolve(null),
    game.xbox_title_id ? loadXbox(db, game.id) : Promise.resolve(null),
  ]);

  if (steam) platforms.push(steam);
  if (psn) platforms.push(psn);
  if (xbox) platforms.push(xbox);

  return { platforms };
}

// ── Steam ────────────────────────────────────────────────────────────────
// A game can map to multiple Steam appids via game_steam_apps (e.g. different
// regional / deluxe SKUs). Merge them into a single "Base Game" group — Steam
// has no DLC achievement grouping.
async function loadSteam(db: any, gameId: string): Promise<GameAchievementPlatform | null> {
  const { data: mappings } = await db
    .from("game_steam_apps")
    .select("steam_appid")
    .eq("game_id", gameId);
  const appids: number[] = (mappings ?? []).map((m: any) => m.steam_appid).filter((n: any) => Number.isFinite(n));
  if (appids.length === 0) return null;

  const { data: schemas } = await db
    .from("steam_app_schema")
    .select("steam_appid, achievements, global_percents, no_achievements")
    .in("steam_appid", appids);

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
// Trophy_group_id in the schema buckets trophies into 'default' (base) + DLC
// packs. trophy_groups payload gives us display names for each group.
async function loadPsn(db: any, npCommId: string): Promise<GameAchievementPlatform | null> {
  const { data: schema } = await db
    .from("psn_title_schema")
    .select("trophies, trophy_groups, no_trophies")
    .eq("np_communication_id", npCommId)
    .maybeSingle();
  if (!schema || schema.no_trophies) return null;

  const trophies: any[] = Array.isArray(schema.trophies) ? schema.trophies : [];
  if (trophies.length === 0) return null;

  // Label lookup by trophy group id.
  const labelById = new Map<string, string>();
  for (const g of (schema.trophy_groups ?? []) as any[]) {
    if (g?.trophyGroupId) labelById.set(g.trophyGroupId, g.name ?? g.trophyGroupId);
  }

  const byGroup = new Map<string, GameAchievement[]>();
  for (const t of trophies) {
    const gid = t.trophyGroupId ?? "default";
    if (!byGroup.has(gid)) byGroup.set(gid, []);
    byGroup.get(gid)!.push({
      name: t.trophyName ?? null,
      description: t.trophyDetail ?? null,
      icon_url: t.trophyIconUrl ?? null,
      tier: normalisePsnTier(t.trophyType),
      gamerscore: null,
      rarity_percent: typeof t.trophyEarnedRate === "number"
        ? t.trophyEarnedRate
        : (typeof t.trophyEarnedRate === "string" ? Number(t.trophyEarnedRate) : null),
      hidden: t.trophyHidden === true || t.trophyHidden === "true",
    });
  }

  // Stable group order: default first, then natural sort of remaining ids.
  const ids = [...byGroup.keys()].sort((a, b) => {
    if (a === "default") return -1;
    if (b === "default") return 1;
    return a.localeCompare(b, undefined, { numeric: true });
  });

  const groups: GameAchievementGroup[] = ids.map((gid) => {
    const label = gid === "default" ? "Base Game" : (labelById.get(gid) ?? `DLC ${gid}`);
    const achievements = byGroup.get(gid)!.sort(sortByRarity);
    return { key: gid === "default" ? "base" : `psn:${gid}`, label, achievements };
  });

  const count = groups.reduce((n, g) => n + g.achievements.length, 0);
  if (count === 0) return null;

  return { source: "psn", platform_label: "PlayStation", count, groups };
}

function normalisePsnTier(v: any): "bronze" | "silver" | "gold" | "platinum" | null {
  if (v === "bronze" || v === "silver" || v === "gold" || v === "platinum") return v;
  return null;
}

// ── Xbox ─────────────────────────────────────────────────────────────────
// Base game lives on games.xbox_title_id. DLC children are separate games
// linked via game_relationships(relation_type IN (dlc, expansion, standalone)).
// Each DLC has its own xbox_title_id → xbox_title_schema row.
async function loadXbox(db: any, baseGameId: string): Promise<GameAchievementPlatform | null> {
  const { data: dlcRels } = await db
    .from("game_relationships")
    .select("to_game_id")
    .eq("from_game_id", baseGameId)
    .in("relation_type", DLC_RELATION_TYPES);
  const dlcIds: string[] = (dlcRels ?? []).map((r: any) => r.to_game_id);

  const allGameIds = [baseGameId, ...dlcIds];
  const { data: gameRows } = await db
    .from("games")
    .select("id, title, xbox_title_id")
    .in("id", allGameIds);
  const gamesList: Array<{ id: string; title: string; xbox_title_id: string | null }> =
    (gameRows ?? []).filter((g: any) => g.xbox_title_id);
  if (gamesList.length === 0) return null;

  const titleIds = gamesList.map((g) => g.xbox_title_id!);
  const { data: schemaRows } = await db
    .from("xbox_title_schema")
    .select("xbox_title_id, achievements, no_achievements")
    .in("xbox_title_id", titleIds);
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
    const schema = schemaByTitleId.get(g.xbox_title_id!);
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
