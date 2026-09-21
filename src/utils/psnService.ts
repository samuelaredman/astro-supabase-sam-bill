// Chekpoint-controlled PSN service token.
//
// Any endpoint on web.np.playstation.com requires an `Authorization: Bearer
// <access_token>`. For the "connect by PSN username" flow the user never
// pastes anything, so we hold one service credential centrally and use it to
// query public data on any user's behalf — the same pattern psnprofiles /
// exophase / truetrophies use.
//
// Bootstrap: PSN_SERVICE_NPSSO env var → exchanged once for a refresh token
// (stored in the psn_service_auth table so we don't re-exchange on every
// cold start). From then on the refresh token self-renews on use.
//
// getServiceAuth() is the only public export. It returns an AuthorizationPayload
// ready to hand to any psn-api function. Callers don't care whether the
// underlying access token was cached, refreshed, or freshly minted from NPSSO.

import {
  exchangeNpssoForAccessCode,
  exchangeAccessCodeForAuthTokens,
  exchangeRefreshTokenForAuthTokens,
  type AuthorizationPayload,
  type AuthTokensResponse,
} from 'psn-api';
import { getSupabaseAdmin } from './database';

// Refresh access token when there's less than a minute left, so a long sync
// doesn't fail mid-flight from expiry drift.
const ACCESS_TOKEN_LEEWAY_MS = 60_000;

type ServiceAuthRow = {
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: string | null;
};

function tokensToAccessExpiry(r: AuthTokensResponse): {
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
} {
  return {
    access_token: r.accessToken,
    refresh_token: r.refreshToken,
    access_token_expires_at: new Date(Date.now() + r.expiresIn * 1000).toISOString(),
  };
}

async function readRow(db: any): Promise<ServiceAuthRow | null> {
  const { data } = await db
    .from('psn_service_auth')
    .select('refresh_token, access_token, access_token_expires_at')
    .eq('id', 'singleton')
    .maybeSingle();
  return (data as ServiceAuthRow | null) ?? null;
}

async function writeRow(
  db: any,
  next: { refresh_token: string; access_token: string; access_token_expires_at: string },
): Promise<void> {
  const { error } = await db
    .from('psn_service_auth')
    .upsert(
      {
        id: 'singleton',
        refresh_token: next.refresh_token,
        access_token: next.access_token,
        access_token_expires_at: next.access_token_expires_at,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );
  if (error) {
    console.error('[psnService] persist error:', JSON.stringify(error));
  }
}

// Bootstraps from PSN_SERVICE_NPSSO. Only called when the DB row is missing —
// i.e. the first time this deployment ever runs, or after a manual reset.
async function bootstrapFromNpsso(db: any): Promise<AuthorizationPayload> {
  const npsso = import.meta.env.PSN_SERVICE_NPSSO;
  if (!npsso) {
    throw new Error(
      'psn_service_missing_npsso: PSN_SERVICE_NPSSO env var is not set and no cached refresh token exists.',
    );
  }
  const code = await exchangeNpssoForAccessCode(npsso);
  const tokens = tokensToAccessExpiry(await exchangeAccessCodeForAuthTokens(code));
  await writeRow(db, tokens);
  return { accessToken: tokens.access_token };
}

/**
 * Returns an AuthorizationPayload for the Chekpoint service account. Caller
 * hands it straight to any `psn-api` function.
 *
 * Throws only when both the cached refresh token AND the PSN_SERVICE_NPSSO
 * env var are missing/invalid — in that case there's no way to talk to Sony.
 */
export async function getServiceAuth(): Promise<AuthorizationPayload> {
  const db = getSupabaseAdmin() as any;
  const row = await readRow(db);

  if (!row) {
    return bootstrapFromNpsso(db);
  }

  // If we have a fresh access token, use it.
  if (
    row.access_token &&
    row.access_token_expires_at &&
    Date.now() < new Date(row.access_token_expires_at).getTime() - ACCESS_TOKEN_LEEWAY_MS
  ) {
    return { accessToken: row.access_token };
  }

  // Refresh from the stored refresh token.
  try {
    const refreshed = tokensToAccessExpiry(
      await exchangeRefreshTokenForAuthTokens(row.refresh_token),
    );
    await writeRow(db, refreshed);
    return { accessToken: refreshed.access_token };
  } catch (e) {
    // Refresh token expired/revoked → fall back to NPSSO if we still have one.
    console.error('[psnService] refresh failed, falling back to NPSSO:', e);
    return bootstrapFromNpsso(db);
  }
}

/** Wipes the cached row so the next call re-bootstraps from NPSSO. Admin op. */
export async function resetServiceAuth(): Promise<void> {
  const db = getSupabaseAdmin() as any;
  await db.from('psn_service_auth').delete().eq('id', 'singleton');
}
