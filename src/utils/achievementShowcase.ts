// The profile's Achievement showcase can feature unlocks from any synced
// platform: Steam achievements, PSN trophies and Xbox achievements. This turns
// a row from each platform's table into one shape for the picker, and marks
// the games the user has unlocks for on more than one platform, so the picker
// and showcase can put a "Steam" / "PSN" / "Xbox" tag in front of them.

export type AchievementSource = 'steam' | 'psn' | 'xbox';

export const SOURCE_TAGS: Record<AchievementSource, string> = {
  steam: 'Steam',
  psn: 'PSN',
  xbox: 'Xbox',
};

export interface ShowcaseAchievement {
  source: AchievementSource;
  /** The game on that platform: Steam app id, PSN NP communication id, Xbox title id. */
  external_id: string;
  /** The achievement within that game. */
  api_name: string;
  display_name: string | null;
  description: string | null;
  icon_url: string | null;
  global_percent: number | null;
  game_title: string | null;
  /** PSN trophy tier; null elsewhere. */
  trophy_type: string | null;
  /** The user has unlocks for this game on another platform too. */
  multi_platform: boolean;
  /** Kept for Steam so showcases saved before other platforms still match. */
  steam_appid?: number;
}

type Row = Record<string, any>;

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

export function fromSteam(r: Row): Omit<ShowcaseAchievement, 'multi_platform'> & { game_id: string | null } {
  return {
    source: 'steam',
    external_id: String(r.steam_appid),
    api_name: r.api_name,
    steam_appid: r.steam_appid,
    display_name: r.display_name ?? null,
    description: r.description ?? null,
    icon_url: r.icon_url ?? null,
    global_percent: num(r.global_percent),
    game_title: r.games?.title ?? r.steam_game_title ?? null,
    trophy_type: null,
    game_id: r.game_id ?? null,
  };
}

export function fromPsn(r: Row): Omit<ShowcaseAchievement, 'multi_platform'> & { game_id: string | null } {
  return {
    source: 'psn',
    external_id: r.np_communication_id,
    // A trophy is only unique within its group
    api_name: `${r.trophy_group_id}:${r.trophy_id}`,
    display_name: r.name ?? null,
    description: r.description ?? null,
    icon_url: r.icon_url ?? null,
    global_percent: num(r.earned_rate),
    game_title: r.games?.title ?? r.psn_game_title ?? null,
    trophy_type: r.trophy_type ?? null,
    game_id: r.game_id ?? null,
  };
}

export function fromXbox(r: Row): Omit<ShowcaseAchievement, 'multi_platform'> & { game_id: string | null } {
  return {
    source: 'xbox',
    external_id: r.xbox_title_id,
    api_name: r.achievement_id,
    display_name: r.name ?? null,
    description: r.description ?? null,
    icon_url: r.icon_url ?? null,
    global_percent: num(r.rarity),
    game_title: r.games?.title ?? r.xbox_game_title ?? null,
    trophy_type: null,
    game_id: r.game_id ?? null,
  };
}

/**
 * Which game an unlock belongs to, across platforms: the linked games row when
 * there is one, otherwise the title with case, ™/® marks and punctuation
 * dropped ("ELDEN RING™" and "Elden Ring" are the same game).
 */
export function gameKey(a: { game_id: string | null; game_title: string | null; source: string; external_id: string }): string {
  if (a.game_id) return `g:${a.game_id}`;
  const title = (a.game_title ?? '').toLowerCase().replace(/[™®©]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return title ? `t:${title}` : `x:${a.source}:${a.external_id}`;
}

/**
 * Merge every platform's unlocks into one list, rarest first, with
 * multi_platform set on games unlocked on more than one platform. A game that
 * is linked on one platform and not on another is matched by title too.
 */
export function mergeShowcaseAchievements(
  rows: Array<Omit<ShowcaseAchievement, 'multi_platform'> & { game_id: string | null }>,
): ShowcaseAchievement[] {
  const titleKey = (a: { game_title: string | null }) => gameKey({ game_id: null, game_title: a.game_title, source: '', external_id: '' });

  // Union the id key and the title key so either one joins two platforms
  const sourcesByKey = new Map<string, Set<string>>();
  const add = (key: string, source: string) => {
    if (!sourcesByKey.has(key)) sourcesByKey.set(key, new Set());
    sourcesByKey.get(key)!.add(source);
  };
  for (const r of rows) {
    add(gameKey(r), r.source);
    if (r.game_title) add(titleKey(r), r.source);
  }
  const isMulti = (r: (typeof rows)[number]) =>
    (sourcesByKey.get(gameKey(r))?.size ?? 0) > 1 ||
    (!!r.game_title && (sourcesByKey.get(titleKey(r))?.size ?? 0) > 1);

  return rows
    .map((r) => {
      const { game_id: _gameId, ...rest } = r;
      return { ...rest, multi_platform: isMulti(r) };
    })
    .sort((a, b) => {
      // Rarest first; unknown rarity last
      if (a.global_percent == null && b.global_percent == null) return 0;
      if (a.global_percent == null) return 1;
      if (b.global_percent == null) return -1;
      return a.global_percent - b.global_percent;
    });
}
