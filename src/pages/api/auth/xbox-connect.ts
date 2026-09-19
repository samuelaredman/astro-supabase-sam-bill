import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";
import { fetchAccount, isXboxAuthInvalid, looksLikeApiKey } from "../../../utils/xbox";

// User pastes an OpenXBL API key from xbl.io/profile. We validate it by
// calling /account (which also returns the XUID + gamertag), then save
// the key + identity to the profile. Unlike Steam (OpenID redirect) or
// PSN (NPSSO exchange), no server-side token exchange is needed —
// OpenXBL's key IS the credential.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json().catch(() => ({} as any));
  const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : '';

  if (!looksLikeApiKey(apiKey)) {
    return json({
      error: "That doesn't look like a valid OpenXBL API key. Copy it from https://xbl.io/profile — it should be a 30–80 character alphanumeric string.",
    }, 400);
  }

  let account;
  try {
    account = await fetchAccount(apiKey);
  } catch (e) {
    if (isXboxAuthInvalid(e)) {
      return json({ error: 'Xbox Live rejected that key. Make sure you copied it from xbl.io/profile.' }, 400);
    }
    console.error('[xbox-connect] fetchAccount error:', e);
    return json({ error: 'Xbox Live is temporarily unavailable. Try again in a minute.' }, 502);
  }

  if (!account) {
    return json({ error: 'Could not read your Xbox profile. Double-check the key or try again in a minute.' }, 502);
  }

  // Cast until supabase/types.ts is regenerated post-migration.
  const { error } = await (db as any).from('profiles').update({
    xbox_xuid: account.xuid,
    xbox_gamertag: account.gamertag,
    xbox_api_key: apiKey,
  }).eq('id', profile.id);

  if (error) {
    if ((error as any).code === '23505') {
      return json({ error: 'That Xbox account is already linked to another Chekpoint profile.' }, 409);
    }
    console.error('[xbox-connect] profile update error:', JSON.stringify(error));
    return json({ error: 'Failed to save Xbox connection.' }, 500);
  }

  return json({ success: true, gamertag: account.gamertag });
};
