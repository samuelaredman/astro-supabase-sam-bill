import {
  exchangeNpssoForAccessCode,
  exchangeAccessCodeForAuthTokens,
  exchangeRefreshTokenForAuthTokens,
  getUserTitles,
  getTitleTrophies,
  getUserTrophiesEarnedForTitle,
  getProfileFromAccountId,
  getUserPlayedGames,
  type AuthorizationPayload,
  type AuthTokensResponse,
  type TrophyTitle,
  type TitleThinTrophy,
  type UserThinTrophy,
} from "psn-api";

export type PsnTokens = {
  access_token: string;
  refresh_token: string;
  expires_at: string; // ISO
};

// One minute of slack — access tokens are ~1h, but we treat "expiring soon" as
// "expired" so a sync doesn't fail mid-flight.
const ACCESS_TOKEN_LEEWAY_MS = 60_000;

function tokensFromResponse(r: AuthTokensResponse): PsnTokens {
  return {
    access_token: r.accessToken,
    refresh_token: r.refreshToken,
    expires_at: new Date(Date.now() + r.expiresIn * 1000).toISOString(),
  };
}

// NPSSO → access + refresh tokens. Called once at connect time. NPSSO itself
// isn't stored — only the derived tokens are. Refresh token TTL is ~60 days.
export async function tokensFromNpsso(npsso: string): Promise<PsnTokens> {
  const code = await exchangeNpssoForAccessCode(npsso);
  return tokensFromResponse(await exchangeAccessCodeForAuthTokens(code));
}

// Called before every sync. If the access token is still fresh, reuse it;
// otherwise swap the refresh token for a new pair. Caller must persist the
// returned tokens when they differ from what was passed in.
export async function getFreshAuth(current: PsnTokens): Promise<{
  auth: AuthorizationPayload;
  tokens: PsnTokens;
  refreshed: boolean;
}> {
  const stillFresh =
    Date.now() < new Date(current.expires_at).getTime() - ACCESS_TOKEN_LEEWAY_MS;

  if (stillFresh) {
    return {
      auth: { accessToken: current.access_token },
      tokens: current,
      refreshed: false,
    };
  }

  const refreshed = tokensFromResponse(
    await exchangeRefreshTokenForAuthTokens(current.refresh_token),
  );
  return {
    auth: { accessToken: refreshed.access_token },
    tokens: refreshed,
    refreshed: true,
  };
}

// A refresh token that Sony rejects (~60 day expiry or manually revoked) throws
// a specific error from psn-api. The caller uses this to distinguish "prompt
// user to re-paste NPSSO" from "transient Sony API failure, retry later".
export function isPsnAuthExpired(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /refresh_token|invalid_grant|4401|4102/i.test(msg);
}

// Fetch the display handle + numeric account ID for a freshly authenticated
// user. Sony returns onlineId (username) via a call keyed on accountId, so at
// connect time we read the accountId out of the JWT payload before calling.
export async function fetchOnlineId(
  auth: AuthorizationPayload,
  accountId: string,
): Promise<string | null> {
  try {
    const res = await getProfileFromAccountId(auth, accountId);
    return res.onlineId ?? null;
  } catch {
    return null;
  }
}

// Sony's access token is a signed JWT — decode the middle segment to read the
// `sub` claim, which is the numeric account ID. Used at connect time before we
// know who the token belongs to.
export function decodeAccountIdFromAccessToken(accessToken: string): string | null {
  const parts = accessToken.split('.');
  if (parts.length < 2) return null;
  try {
    const padded = parts[1].padEnd(parts[1].length + (4 - (parts[1].length % 4)) % 4, '=');
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    return typeof payload?.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

// Paginated getUserTitles — Sony caps a single call at 800. Every title the
// user has earned at least one trophy in comes back here, across PS3/PS4/PS5.
export async function fetchAllTitles(
  auth: AuthorizationPayload,
  accountId: string,
): Promise<TrophyTitle[]> {
  const all: TrophyTitle[] = [];
  const PAGE = 800;
  for (let offset = 0; ; offset += PAGE) {
    const res = await getUserTitles(auth, accountId, { limit: PAGE, offset });
    const batch = res.trophyTitles ?? [];
    all.push(...batch);
    if (batch.length < PAGE) break;
    if (offset > 20000) break; // hard safety cap
  }
  return all;
}

// Paginated recently-played — only source of playtime data for PSN, and only
// for PS4/PS5. titleId here is a CUSA/PPSA code, not npCommunicationId, so
// callers match by name against fetchAllTitles output.
export async function fetchRecentPlayedGames(
  auth: AuthorizationPayload,
): Promise<Array<{ name: string; titleId: string; playDurationMinutes: number; lastPlayedDateTime: string | null }>> {
  try {
    const res = await getUserPlayedGames(auth, 'me');
    return (res.titles ?? []).map((t: any) => ({
      name: t.name,
      titleId: t.titleId,
      playDurationMinutes: parseIsoDurationToMinutes(t.playDuration),
      lastPlayedDateTime: t.lastPlayedDateTime ?? null,
    }));
  } catch {
    return [];
  }
}

// Sony returns playtime as an ISO-8601 duration ("PT12H34M56S"). Convert to
// minutes to match steam_playtime_minutes. Missing/malformed → 0.
function parseIsoDurationToMinutes(dur: string | null | undefined): number {
  if (!dur || typeof dur !== 'string') return 0;
  const m = dur.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!m) return 0;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2] ?? 0);
  const s = Number(m[3] ?? 0);
  return Math.round(h * 60 + min + s / 60);
}

// The full schema for a title — every trophy's name, description, icon,
// rarity — flattened across every trophy group (default + DLC groups).
// Cached per-title, since it's the same for every user.
export async function fetchTitleTrophySchema(
  auth: AuthorizationPayload,
  npCommunicationId: string,
  npServiceName: 'trophy' | 'trophy2',
): Promise<TitleThinTrophy[] | null> {
  try {
    // "all" pulls the default group + every DLC group in one call.
    const res = await getTitleTrophies(auth, npCommunicationId, 'all', { npServiceName });
    return res.trophies ?? null;
  } catch {
    return null;
  }
}

// This user's earned status for every trophy in a title. Combined with the
// schema above to produce user_trophies rows.
export async function fetchEarnedTrophies(
  auth: AuthorizationPayload,
  accountId: string,
  npCommunicationId: string,
  npServiceName: 'trophy' | 'trophy2',
): Promise<UserThinTrophy[] | null> {
  try {
    const res = await getUserTrophiesEarnedForTitle(
      auth,
      accountId,
      npCommunicationId,
      'all',
      { npServiceName },
    );
    return res.trophies ?? null;
  } catch {
    return null;
  }
}

// TrophyTitle.trophyTitlePlatform may be a comma-separated list ("PS4,PSVITA")
// when Sony shares one trophy set across two platforms. Collapse to a single
// canonical value for our platform filter chips:
//   PS5 > PS4 > PS3 > VITA/PSP/other
// Vita/PSP are collapsed to null (no chip in the library UI — matches the
// user's target design of PS3/PS4/PS5 only).
export function primaryPsnPlatform(raw: string): 'PS3' | 'PS4' | 'PS5' | null {
  const parts = raw.split(',').map((p) => p.trim().toUpperCase());
  if (parts.includes('PS5')) return 'PS5';
  if (parts.includes('PS4')) return 'PS4';
  if (parts.includes('PS3')) return 'PS3';
  return null;
}

export type { AuthorizationPayload, TrophyTitle, TitleThinTrophy, UserThinTrophy };
