// Thin wrapper around OpenXBL (xbl.io) — the community REST proxy for
// Xbox Live. The user authenticates once at xbl.io with their Microsoft
// account, receives a personal API key, and pastes it into our Settings
// page. We store the key on the profile and forward it as
// `X-Authorization` on every request.
//
// No token refresh flow like PSN — the API key is long-lived until the
// user regenerates it at xbl.io/profile. Rate limits are per-key (free
// tier is 150/hour), so heavy users may need to upgrade their own key
// or wait between full re-syncs.

const XBL_BASE = 'https://xbl.io/api/v2';

async function xblFetch(path: string, apiKey: string, timeoutMs = 8000): Promise<any> {
  try {
    const res = await fetch(`${XBL_BASE}${path}`, {
      headers: {
        'X-Authorization': apiKey,
        'Accept': 'application/json',
        'Accept-Language': 'en-US',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401 || res.status === 403) throw new Error('xbox_auth_invalid');
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch (e) {
    // Preserve the auth-invalid signal so the caller can flip the user
    // into a "reconnect" state; other failures degrade to null so the
    // sync cursor advances instead of wedging.
    if (e instanceof Error && e.message === 'xbox_auth_invalid') throw e;
    return null;
  }
}

// OpenXBL API keys are UUIDish alphanumerics with dashes — accept a permissive
// range of 30-80 chars so upstream format drift doesn't break the paste flow.
export function looksLikeApiKey(raw: string): boolean {
  return /^[A-Za-z0-9-]{30,80}$/.test(raw.trim());
}

// Validates the pasted key by calling /account and returns the caller's
// XUID + gamertag. Throws 'xbox_auth_invalid' if the key is bad.
export async function fetchAccount(apiKey: string): Promise<{ xuid: string; gamertag: string | null } | null> {
  const data = await xblFetch('/account', apiKey);
  const user = data?.profileUsers?.[0];
  if (!user?.id) return null;
  const settings: Array<{ id: string; value: string }> = user.settings ?? [];
  const gamertag = settings.find((s) => s.id === 'Gamertag')?.value ?? null;
  return { xuid: String(user.id), gamertag };
}

export function isXboxAuthInvalid(err: unknown): boolean {
  return err instanceof Error && err.message === 'xbox_auth_invalid';
}

// Full played-titles list. Xbox's /player/titleHistory endpoint returns
// every title the account has ever touched, with cached progress + last-
// played date at the top level — the same shape PSN's getUserTitles gives.
export type XboxConsole = 'Xbox 360' | 'Xbox One' | 'Xbox Series X|S';

export type XboxTitleSummary = {
  titleId: string;
  name: string;
  displayImage: string | null;
  lastPlayed: string | null;
  currentAchievements: number;
  totalAchievements: number;
  currentGamerscore: number;
  maxGamerscore: number;
  // Primary console this title is played on for this user. OpenXBL's
  // titleHistory returns a `devices` array like ["XboxSeries"] or
  // ["XboxOne","XboxSeries"] for cross-gen titles. We collapse it to the
  // newest generation the account has touched — same "one label per game"
  // rule the PSN sync uses for psn_platform. Null when devices is absent
  // (old cached rows / unusual OpenXBL responses).
  platform: XboxConsole | null;
};

// Map an OpenXBL device string to our display label. Values seen in the
// wild: "Xbox360", "XboxOne", "XboxSeries", "XboxSeriesX", "XboxSeriesS",
// "Xbox_Durango" (dev sku). Anything unrecognised → null so unknowns don't
// masquerade as a specific console in the filter.
function normalizeXboxDevice(raw: string): XboxConsole | null {
  const d = raw.toLowerCase().replace(/[\s_]/g, '');
  if (d.includes('series')) return 'Xbox Series X|S';
  if (d.includes('one') || d === 'durango') return 'Xbox One';
  if (d.includes('360')) return 'Xbox 360';
  return null;
}

// Pick the newest console generation from a title's devices array.
export function primaryXboxConsole(devices: unknown): XboxConsole | null {
  if (!Array.isArray(devices)) return null;
  const rank: Record<XboxConsole, number> = { 'Xbox Series X|S': 3, 'Xbox One': 2, 'Xbox 360': 1 };
  let best: XboxConsole | null = null;
  for (const d of devices) {
    if (typeof d !== 'string') continue;
    const c = normalizeXboxDevice(d);
    if (c && (!best || rank[c] > rank[best])) best = c;
  }
  return best;
}

export async function fetchAllTitles(apiKey: string, xuid: string): Promise<XboxTitleSummary[]> {
  const data = await xblFetch(`/player/titleHistory/${xuid}`, apiKey);
  const titles = data?.titles ?? [];
  const out: XboxTitleSummary[] = [];
  for (const t of titles) {
    const ach = t.achievement ?? {};
    out.push({
      titleId: String(t.titleId),
      name: String(t.name ?? '').trim(),
      displayImage: t.displayImage ?? null,
      lastPlayed: t.titleHistory?.lastTimePlayed ?? null,
      currentAchievements: Number(ach.currentAchievements ?? 0),
      totalAchievements: Number(ach.totalAchievements ?? 0),
      currentGamerscore: Number(ach.currentGamerscore ?? 0),
      maxGamerscore: Number(ach.totalGamerscore ?? 0),
      platform: primaryXboxConsole(t.devices),
    });
  }
  return out;
}

// Full per-title achievement list — includes both earned and locked, with
// metadata (name, description, icon, rarity, gamerscore). The response is
// paginated by continuation token; a single title rarely exceeds 100
// achievements so one page is usually enough.
export type XboxAchievement = {
  id: string;
  name: string | null;
  description: string | null;
  iconUrl: string | null;
  gamerscore: number;
  rarity: number | null;
  unlocked: boolean;
  unlockedAt: string | null;
};

export async function fetchAchievementsForTitle(
  apiKey: string,
  xuid: string,
  titleId: string,
): Promise<XboxAchievement[] | null> {
  const data = await xblFetch(`/achievements/player/${xuid}/${titleId}`, apiKey);
  if (data === null) return null;
  const list: any[] = data?.achievements ?? [];
  return list.map((a) => {
    const rewards: Array<{ value: string; type: string }> = a.rewards ?? [];
    const gsReward = rewards.find((r) => r?.type === 'Gamerscore');
    const gamerscore = gsReward ? Number(gsReward.value) || 0 : 0;
    const media: Array<{ url: string; type: string }> = a.mediaAssets ?? [];
    const iconUrl = media.find((m) => m?.type === 'Icon')?.url ?? media[0]?.url ?? null;
    // OpenXBL's progressState is 'Achieved' | 'InProgress' | 'NotStarted'.
    // Fall back to timeUnlocked presence if progressState is missing.
    const progression = a.progression ?? {};
    const timeUnlocked: string | null = progression.timeUnlocked ?? null;
    const unlocked =
      (a.progressState ?? '').toLowerCase() === 'achieved' ||
      (typeof timeUnlocked === 'string' && timeUnlocked.length > 0 && !timeUnlocked.startsWith('1601'));
    // Xbox uses the .NET epoch "1601-01-01T00:00:00" as a placeholder for
    // "never" — filter that out so it doesn't render as a real timestamp.
    const unlockedAt = unlocked && timeUnlocked && !timeUnlocked.startsWith('1601') ? timeUnlocked : null;
    const rarityRaw = a.rarity?.currentPercentage;
    const rarity = typeof rarityRaw === 'string' ? Number(rarityRaw)
                 : typeof rarityRaw === 'number' ? rarityRaw
                 : null;
    return {
      id: String(a.id),
      name: a.name ?? null,
      description: (a.description ?? a.lockedDescription ?? null) as string | null,
      iconUrl,
      gamerscore,
      rarity: Number.isFinite(rarity as number) ? (rarity as number) : null,
      unlocked,
      unlockedAt,
    };
  });
}
