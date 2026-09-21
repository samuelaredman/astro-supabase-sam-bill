import type { APIRoute } from "astro";
import { getProfileFromUserName } from "psn-api";
import { requireAuth, json } from "../../../utils/api";
import { getServiceAuth } from "../../../utils/psnService";

// Username-only PSN connect. User types their PSN online ID, we resolve it to
// an accountId via Sony's GraphQL using the Chekpoint service token, and save
// both to the profile. No per-user NPSSO / access token / refresh token —
// syncs against this profile fall back to the service token as well.
//
// Trade-off vs the NPSSO paste flow (psn-connect.ts): this can only read
// PUBLIC data — no playtime (PS4/PS5 playtime isn't public), no private
// profiles. Users who want the extra data can still paste an NPSSO from the
// "Advanced" section of settings.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json().catch(() => ({} as any));
  const rawUsername = typeof body.username === 'string' ? body.username.trim() : '';

  // PSN online IDs: 3–16 chars, letters/digits/hyphen/underscore, case-preserving.
  if (!/^[A-Za-z0-9_-]{3,16}$/.test(rawUsername)) {
    return json({
      error: "That doesn't look like a PSN username. IDs are 3–16 letters, numbers, hyphens, or underscores.",
    }, 400);
  }

  let serviceAuth;
  try {
    serviceAuth = await getServiceAuth();
  } catch (e) {
    console.error('[psn-connect-username] service auth unavailable:', e);
    return json({
      error: "PlayStation connect is temporarily unavailable — please try again in a minute.",
    }, 503);
  }

  let lookup;
  try {
    lookup = await getProfileFromUserName(serviceAuth, rawUsername);
  } catch (e) {
    // Sony returns 404-shaped errors for unknown usernames and 403-shaped ones
    // for private profiles. psn-api surfaces both as thrown Errors — we can't
    // reliably distinguish without inspecting the message, so we present the
    // most common cause first.
    console.error('[psn-connect-username] lookup error:', e);
    return json({
      error: `Couldn't find a PlayStation account named "${rawUsername}". Check the spelling — and if your profile is private, Chekpoint can't read it without an NPSSO (see Advanced below).`,
    }, 404);
  }

  const accountId = lookup?.profile?.accountId;
  const verifiedOnlineId = lookup?.profile?.onlineId ?? rawUsername;
  if (!accountId) {
    return json({ error: 'PlayStation returned an unexpected response. Please try again.' }, 502);
  }

  // Existing psn_access_token / psn_refresh_token / psn_token_expires_at
  // columns stay NULL. Sync routes detect that and use getServiceAuth()
  // instead of the per-user token flow.
  const { error } = await (db as any).from('profiles').update({
    psn_account_id: accountId,
    psn_online_id: verifiedOnlineId,
    psn_access_token: null,
    psn_refresh_token: null,
    psn_token_expires_at: null,
  }).eq('id', profile.id);

  if (error) {
    if ((error as any).code === '23505') {
      return json({ error: 'That PlayStation account is already linked to another Chekpoint profile.' }, 409);
    }
    console.error('[psn-connect-username] profile update error:', JSON.stringify(error));
    return json({ error: 'Failed to save PlayStation connection.' }, 500);
  }

  return json({ success: true, online_id: verifiedOnlineId });
};
