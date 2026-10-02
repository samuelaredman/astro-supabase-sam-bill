import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";
import {
  tokensFromNpsso,
  decodeAccountIdFromAccessToken,
  fetchOnlineId,
} from "../../../utils/psn";

// User-pasted NPSSO token, exchanged for a durable access + refresh pair.
// Unlike Steam's OpenID redirect, PSN has no round-trip — the client POSTs the
// token, we exchange it server-side, and return success. UI redirects itself.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json().catch(() => ({} as any));
  const npsso = typeof body.npsso === 'string' ? body.npsso.trim() : '';

  // NPSSO from ca.account.sony.com is a 64-char alphanumeric string. Reject
  // obvious paste errors before hitting Sony's endpoint — their error page
  // for a malformed NPSSO is unhelpful and hard to distinguish from an
  // expired one.
  if (!/^[A-Za-z0-9]{64}$/.test(npsso)) {
    return json({
      error: "That doesn't look like a valid NPSSO token. It should be a 64-character string with no spaces or quotes.",
    }, 400);
  }

  let tokens;
  try {
    tokens = await tokensFromNpsso(npsso);
  } catch (e) {
    console.error('[psn-connect] exchange error:', e);
    return json({
      error: 'PlayStation rejected that NPSSO. Make sure you copied it from ca.account.sony.com/api/v1/ssocookie while signed in.',
    }, 400);
  }

  const accountId = decodeAccountIdFromAccessToken(tokens.access_token);
  if (!accountId) {
    console.error('[psn-connect] could not decode account id from access token');
    return json({ error: 'PlayStation returned an unrecognized token. Please try again.' }, 502);
  }

  const onlineId = await fetchOnlineId({ accessToken: tokens.access_token }, accountId);

  // Cast until supabase/types.ts is regenerated post-migration.
  const { error } = await (db as any).from('profiles').update({
    psn_account_id: accountId,
    psn_online_id: onlineId,
    psn_access_token: tokens.access_token,
    psn_refresh_token: tokens.refresh_token,
    psn_token_expires_at: tokens.expires_at,
  }).eq('id', profile.id);

  if (error) {
    // Unique-violation on psn_account_id means someone else on the site already
    // linked this PSN account. Surface it cleanly.
    if ((error as any).code === '23505') {
      return json({ error: 'That PlayStation account is already linked to another Chekpoint profile.' }, 409);
    }
    console.error('[psn-connect] profile update error:', JSON.stringify(error));
    return json({ error: 'Failed to save PlayStation connection.' }, 500);
  }

  return json({ success: true, online_id: onlineId });
};
