// Game-scoped achievement loader for the game detail page's Achievements tab.
//
// Mirrors the per-user modal (src/pages/api/user-achievements/game.ts) but
// reads the schema tables (steam_app_schema / psn_title_schema /
// xbox_title_schema) instead of user_* so the tab works for anonymous visitors
// and for games nobody has synced yet.
//
// Rarity lives in the schema tables for all three platforms:
//   - Steam: steam_app_schema.global_percents (jsonb map { api_name → % })
//   - PSN:   psn_title_schema.trophies[].trophyEarnedRate (not populated —
//            overlaid from user_trophies.earned_rate, which is a game-wide
//            stat Sony returns on the per-user earned payload)
//   - Xbox:  xbox_title_schema.achievements[].rarity
// so no per-user sampling is needed for the data itself.
//
// Canonical/edition handling: canonical game pages must show achievements
// from EVERY edition that collapses into them (Okami was PS2-only but
// Okami HD is Steam+PS, Spider-Man and Spider-Man Remastered have different
// trophy sets, etc.). The loader therefore resolves "siblings" = canonical +
// every row whose canonical_game_id = canonical.id, then runs each platform
// loader across that entire set. When multiple siblings contribute,
// group labels get prefixed with the edition title so viewers can tell
// "Spider-Man" trophies apart from "Spider-Man Remastered" trophies.

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
  key: string;
  label: string;
  achievements: GameAchievement[];
}

export interface GameAchievementPlatform {
  source: AchievementSource;
  platform_label: string;
  count: number;
  groups: GameAchievementGroup[];
}

export interface GameAchievementsData {
  platforms: GameAchievementPlatform[];
  debug?: GameAchievementsDebug;
}

export interface GameAchievementsDebug {
  canonical_id: string;
  siblings: Array<{ id: string; title: string; psn_np_communication_id: string | null; xbox_title_id: string | null; isCanonical: boolean }>;
  resolved_psn_np_comm_ids: string[];
  resolved_xbox_title_ids: string[];
  xbox_dlc_game_ids: string[];
  xbox_title_id_by_game_id: Record<string, string>;
  xbox_schema_rows_found: string[];
  psn_schema_rows_found: string[];
  steam_appids: number[];
  steam_schema_rows_found: number[];
}

type Sibling = {
  id: string;
  title: string;
  psn_np_communication_id: string | null;
  xbox_title_id: string | null;
  isCanonical: boolean;
};

const DLC_RELATION_TYPES = ["dlc", "expansion", "standalone_expansion"];

function steamIconUrl(icon: string | null | undefined, appid: number): string | null {
  if (!icon) return null;
  const filename = icon.split("/").pop();
  if (!filename) return null;
  return `https://shared.fastly.steamstatic.com/community_assets/images/apps/${appid}/${filename}`;
}

function sortByRarity(a: GameAchievement, b: GameAchievement): number {
  const ap = a.rarity_percent ?? -Infinity;
  const bp = b.rarity_percent ?? -Infinity;
  return bp - ap;
}

function normalisePsnTier(v: any): "bronze" | "silver" | "gold" | "platinum" | null {
  if (v === "bronze" || v === "silver" || v === "gold" || v === "platinum") return v;
  return null;
}

export async function loadGameAchievements(
  db: any,
  game: { id: string; psn_np_communication_id: string | null; xbox_title_id: string | null },
  opts: { debug?: boolean } = {},
): Promise<GameAchievementsData> {
  // Canonical + every edition that collapses into it. Both lookups happen in
  // one query via the OR filter.
  const { data: siblingRows } = await db
    .from("games")
    .select("id, title, psn_np_communication_id, xbox_title_id")
    .or(`id.eq.${game.id},canonical_game_id.eq.${game.id}`);

  const rawSiblings = (siblingRows ?? []) as any[];
  const siblings: Sibling[] = rawSiblings.length > 0
    ? rawSiblings.map((r) => ({
        id: r.id,
        title: r.title,
        psn_np_communication_id: r.psn_np_communication_id,
        xbox_title_id: r.xbox_title_id,
        isCanonical: r.id === game.id,
      }))
    // Defensive fallback: if the query somehow misses, treat just the canonical.
    : [{ id: game.id, title: "", psn_np_communication_id: game.psn_np_communication_id, xbox_title_id: game.xbox_title_id, isCanonical: true }];

  const canonicalId = game.id;

  const debug: GameAchievementsDebug | undefined = opts.debug ? {
    canonical_id: canonicalId,
    siblings: siblings.map((s) => ({
      id: s.id,
      title: s.title,
      psn_np_communication_id: s.psn_np_communication_id,
      xbox_title_id: s.xbox_title_id,
      isCanonical: s.isCanonical,
    })),
    resolved_psn_np_comm_ids: [],
    resolved_xbox_title_ids: [],
    xbox_dlc_game_ids: [],
    xbox_title_id_by_game_id: {},
    xbox_schema_rows_found: [],
    psn_schema_rows_found: [],
    steam_appids: [],
    steam_schema_rows_found: [],
  } : undefined;

  const [steam, psn, xbox] = await Promise.all([
    loadSteam(db, siblings, canonicalId, debug),
    loadPsn(db, siblings, canonicalId, debug),
    loadXbox(db, siblings, canonicalId, debug),
  ]);

  const platforms: GameAchievementPlatform[] = [];
  if (steam) platforms.push(steam);
  if (psn) platforms.push(psn);
  if (xbox) platforms.push(xbox);

  return debug ? { platforms, debug } : { platforms };
}

// Prefix group labels with the edition title when multiple siblings contributed
// achievements on this platform — otherwise keep the plain "Base Game" / DLC
// name. Avoids noisy prefixes on the common single-sibling case.
function decorateLabel(baseLabel: string, siblingTitle: string, multiContributed: boolean): string {
  if (!multiContributed || !siblingTitle) return baseLabel;
  return baseLabel === "Base Game" ? siblingTitle : `${siblingTitle} — ${baseLabel}`;
}

// ── Steam ────────────────────────────────────────────────────────────────
async function loadSteam(
  db: any,
  siblings: Sibling[],
  canonicalId: string,
  debug?: GameAchievementsDebug,
): Promise<GameAchievementPlatform | null> {
  const sibIds = siblings.map((s) => s.id);
  const { data: mappings } = await db
    .from("game_steam_apps")
    .select("steam_appid, game_id")
    .in("game_id", sibIds);
  const appidsBySibling = new Map<string, number[]>();
  for (const m of ((mappings ?? []) as any[])) {
    const n = Number(m.steam_appid);
    if (!Number.isFinite(n)) continue;
    if (!appidsBySibling.has(m.game_id)) appidsBySibling.set(m.game_id, []);
    appidsBySibling.get(m.game_id)!.push(n);
  }
  const allAppids = [...new Set(([...appidsBySibling.values()]).flat())];
  if (debug) debug.steam_appids = allAppids;
  if (allAppids.length === 0) return null;

  const { data: schemas } = await db
    .from("steam_app_schema")
    .select("steam_appid, achievements, global_percents, no_achievements")
    .in("steam_appid", allAppids);
  if (debug) debug.steam_schema_rows_found = ((schemas ?? []) as any[]).map((r) => r.steam_appid);
  const schemaByAppid = new Map<number, any>(((schemas ?? []) as any[]).map((r) => [r.steam_appid, r]));

  const contributingSiblings = siblings.filter((s) => (appidsBySibling.get(s.id) ?? []).some((appid) => {
    const sc = schemaByAppid.get(appid);
    return sc && !sc.no_achievements && Array.isArray(sc.achievements) && sc.achievements.length > 0;
  }));
  if (contributingSiblings.length === 0) return null;
  const multi = contributingSiblings.length > 1;

  const groups: GameAchievementGroup[] = [];
  for (const sibling of contributingSiblings) {
    const appids = appidsBySibling.get(sibling.id) ?? [];
    const merged: GameAchievement[] = [];
    for (const appid of appids) {
      const schema = schemaByAppid.get(appid);
      if (!schema || schema.no_achievements) continue;
      const globalPercents: Record<string, number> = schema.global_percents ?? {};
      const achs: any[] = Array.isArray(schema.achievements) ? schema.achievements : [];
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
    if (merged.length === 0) continue;
    merged.sort(sortByRarity);
    groups.push({
      key: sibling.id === canonicalId ? "base" : `steam:${sibling.id}`,
      label: decorateLabel("Base Game", sibling.title, multi),
      achievements: merged,
    });
  }
  if (groups.length === 0) return null;
  return { source: "steam", platform_label: "Steam", count: groups.reduce((n, g) => n + g.achievements.length, 0), groups };
}

// ── PSN ──────────────────────────────────────────────────────────────────
async function loadPsn(
  db: any,
  siblings: Sibling[],
  canonicalId: string,
  debug?: GameAchievementsDebug,
): Promise<GameAchievementPlatform | null> {
  // All npCommIds across all siblings, resolved per sibling so we can label
  // groups with the originating edition title.
  const npCommIdsBySibling = new Map<string, Set<string>>();
  for (const s of siblings) {
    const ids = new Set<string>();
    if (s.psn_np_communication_id) ids.add(s.psn_np_communication_id);
    npCommIdsBySibling.set(s.id, ids);
  }
  const { data: statusRows } = await db
    .from("user_game_status")
    .select("game_id, psn_np_communication_id")
    .in("game_id", siblings.map((s) => s.id))
    .not("psn_np_communication_id", "is", null);
  for (const r of ((statusRows ?? []) as any[])) {
    if (!r.psn_np_communication_id) continue;
    if (!npCommIdsBySibling.has(r.game_id)) npCommIdsBySibling.set(r.game_id, new Set());
    npCommIdsBySibling.get(r.game_id)!.add(r.psn_np_communication_id);
  }

  const allNpCommIds = [...new Set([...npCommIdsBySibling.values()].flatMap((s) => [...s]))];
  if (debug) debug.resolved_psn_np_comm_ids = allNpCommIds;
  if (allNpCommIds.length === 0) return null;

  const { data: schemas } = await db
    .from("psn_title_schema")
    .select("np_communication_id, trophies, trophy_groups, no_trophies")
    .in("np_communication_id", allNpCommIds);
  if (debug) debug.psn_schema_rows_found = ((schemas ?? []) as any[]).map((r) => r.np_communication_id);
  const schemaByNpCommId = new Map<string, any>(((schemas ?? []) as any[]).map((r) => [r.np_communication_id, r]));

  // Rarity overlay from user_trophies across every npCommId we care about.
  const { data: rateRows } = await db
    .from("user_trophies")
    .select("np_communication_id, trophy_group_id, trophy_id, earned_rate")
    .in("np_communication_id", allNpCommIds)
    .not("earned_rate", "is", null);
  const rateByKey = new Map<string, number>(); // `${npCommId}:${gid}:${tid}` → rate
  for (const r of ((rateRows ?? []) as any[])) {
    const gid = r.trophy_group_id ?? "default";
    const key = `${r.np_communication_id}:${gid}:${r.trophy_id}`;
    if (!rateByKey.has(key) && typeof r.earned_rate === "number") {
      rateByKey.set(key, r.earned_rate);
    }
  }

  // Per sibling, pick the best schema from its npCommId set (prefer schemas
  // with trophy_groups populated, then largest). Produces at most ONE
  // schema-worth of trophy groups per sibling — avoids the PS4/PS5
  // re-release doubling that merging every npCommId would cause.
  const perSiblingGroups: Array<{ sibling: Sibling; groups: GameAchievementGroup[]; npCommId: string }> = [];
  for (const sibling of siblings) {
    const ids = [...(npCommIdsBySibling.get(sibling.id) ?? [])];
    const viable = ids
      .map((id) => schemaByNpCommId.get(id))
      .filter((s) => s && !s.no_trophies && Array.isArray(s.trophies) && s.trophies.length > 0);
    if (viable.length === 0) continue;
    viable.sort((a: any, b: any) => {
      const aGroups = Array.isArray(a.trophy_groups) ? a.trophy_groups.length : 0;
      const bGroups = Array.isArray(b.trophy_groups) ? b.trophy_groups.length : 0;
      if (aGroups !== bGroups) return bGroups - aGroups;
      return (b.trophies?.length ?? 0) - (a.trophies?.length ?? 0);
    });
    const schema = viable[0];
    const chosenNpCommId: string = schema.np_communication_id;

    const labelById = new Map<string, string>();
    for (const g of (schema.trophy_groups ?? []) as any[]) {
      if (g?.trophyGroupId) labelById.set(g.trophyGroupId, g.name ?? g.trophyGroupId);
    }

    const byGroup = new Map<string, GameAchievement[]>();
    for (const t of schema.trophies as any[]) {
      const gid = t.trophyGroupId ?? "default";
      if (!byGroup.has(gid)) byGroup.set(gid, []);
      const schemaRate = typeof t.trophyEarnedRate === "number"
        ? t.trophyEarnedRate
        : (typeof t.trophyEarnedRate === "string" ? Number(t.trophyEarnedRate) : null);
      const rarity = schemaRate != null && Number.isFinite(schemaRate)
        ? schemaRate
        : (rateByKey.get(`${chosenNpCommId}:${gid}:${t.trophyId}`) ?? null);
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

    const ids2 = [...byGroup.keys()].sort((a, b) => {
      if (a === "default") return -1;
      if (b === "default") return 1;
      return a.localeCompare(b, undefined, { numeric: true });
    });

    const groups: GameAchievementGroup[] = ids2.map((gid) => ({
      key: gid === "default"
        ? (sibling.id === canonicalId ? "base" : `psn:${sibling.id}:base`)
        : `psn:${sibling.id}:${gid}`,
      label: gid === "default" ? "Base Game" : (labelById.get(gid) ?? `DLC ${gid}`),
      achievements: byGroup.get(gid)!.sort(sortByRarity),
    }));

    perSiblingGroups.push({ sibling, groups, npCommId: chosenNpCommId });
  }

  if (perSiblingGroups.length === 0) return null;
  const multi = perSiblingGroups.length > 1;

  // Flatten, decorating labels with the sibling title when multiple
  // contributed. "Base Game" becomes just the title; DLC labels get prefixed.
  const flat: GameAchievementGroup[] = [];
  for (const { sibling, groups } of perSiblingGroups) {
    for (const g of groups) {
      flat.push({ ...g, label: decorateLabel(g.label, sibling.title, multi) });
    }
  }

  return { source: "psn", platform_label: "PlayStation", count: flat.reduce((n, g) => n + g.achievements.length, 0), groups: flat };
}

// ── Xbox ─────────────────────────────────────────────────────────────────
async function loadXbox(
  db: any,
  siblings: Sibling[],
  canonicalId: string,
  debug?: GameAchievementsDebug,
): Promise<GameAchievementPlatform | null> {
  // For each sibling independently, climb game_relationships to find DLC
  // children. Multiple siblings can each have their own Xbox base + DLC
  // chain; iterate per-sibling so we don't conflate them.

  // Prefetch DLC relationships for every sibling at once.
  const sibIds = siblings.map((s) => s.id);
  const { data: allRels } = await db
    .from("game_relationships")
    .select("from_game_id, to_game_id")
    .in("from_game_id", sibIds)
    .in("relation_type", DLC_RELATION_TYPES);
  const dlcIdsBySibling = new Map<string, string[]>();
  for (const r of ((allRels ?? []) as any[])) {
    if (!dlcIdsBySibling.has(r.from_game_id)) dlcIdsBySibling.set(r.from_game_id, []);
    dlcIdsBySibling.get(r.from_game_id)!.push(r.to_game_id);
  }
  const allDlcIds = [...new Set([...dlcIdsBySibling.values()].flat())];
  if (debug) debug.xbox_dlc_game_ids = allDlcIds;

  // Prefetch titles + xbox_title_id for every sibling + every DLC child.
  const allGameIds = [...new Set([...sibIds, ...allDlcIds])];
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

  const titleIdByGameId = new Map<string, string>();
  const titleByGameId = new Map<string, string>();
  for (const g of ((gamesRes.data ?? []) as any[])) {
    titleByGameId.set(g.id, g.title);
    if (g.xbox_title_id) titleIdByGameId.set(g.id, g.xbox_title_id);
  }
  for (const r of ((userStatusRes.data ?? []) as any[])) {
    if (r.xbox_title_id && !titleIdByGameId.has(r.game_id)) titleIdByGameId.set(r.game_id, r.xbox_title_id);
  }
  for (const r of ((userAchRes.data ?? []) as any[])) {
    if (r.xbox_title_id && !titleIdByGameId.has(r.game_id)) titleIdByGameId.set(r.game_id, r.xbox_title_id);
  }
  if (debug) {
    for (const [k, v] of titleIdByGameId) debug.xbox_title_id_by_game_id[k] = v;
    debug.resolved_xbox_title_ids = [...new Set([...titleIdByGameId.values()])];
  }

  const allTitleIds = [...new Set([...titleIdByGameId.values()])];
  if (allTitleIds.length === 0) return null;

  const { data: schemaRows } = await db
    .from("xbox_title_schema")
    .select("xbox_title_id, achievements, no_achievements")
    .in("xbox_title_id", allTitleIds);
  if (debug) debug.xbox_schema_rows_found = ((schemaRows ?? []) as any[]).map((r) => r.xbox_title_id);
  const schemaByTitleId = new Map<string, any>(((schemaRows ?? []) as any[]).map((r) => [r.xbox_title_id, r]));

  // Build per-sibling group lists; each has a base entry + 0..N DLC entries.
  const perSiblingGroups: Array<{ sibling: Sibling; groups: GameAchievementGroup[] }> = [];
  for (const sibling of siblings) {
    const dlcIds = dlcIdsBySibling.get(sibling.id) ?? [];
    // Order: sibling (base) first, then DLC in title order.
    const ordered = [sibling.id, ...dlcIds.sort((a, b) => (titleByGameId.get(a) ?? "").localeCompare(titleByGameId.get(b) ?? ""))];
    const groups: GameAchievementGroup[] = [];
    for (const gid of ordered) {
      const titleId = titleIdByGameId.get(gid);
      if (!titleId) continue;
      const schema = schemaByTitleId.get(titleId);
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

      const isBase = gid === sibling.id;
      groups.push({
        key: isBase
          ? (sibling.id === canonicalId ? "base" : `xbox:${sibling.id}:base`)
          : `xbox:${gid}`,
        label: isBase ? "Base Game" : (titleByGameId.get(gid) ?? "DLC"),
        achievements: normalised,
      });
    }
    if (groups.length > 0) perSiblingGroups.push({ sibling, groups });
  }

  if (perSiblingGroups.length === 0) return null;
  const multi = perSiblingGroups.length > 1;

  const flat: GameAchievementGroup[] = [];
  for (const { sibling, groups } of perSiblingGroups) {
    for (const g of groups) {
      flat.push({ ...g, label: decorateLabel(g.label, sibling.title, multi) });
    }
  }

  return { source: "xbox", platform_label: "Xbox", count: flat.reduce((n, g) => n + g.achievements.length, 0), groups: flat };
}
