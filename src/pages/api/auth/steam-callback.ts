import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";

export const GET: APIRoute = async (context) => {
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return context.redirect('/signin');

  const params = context.url.searchParams;

  // Only same-site paths ("/settings", "/?x=1") — never "//evil.com" or a full
  // URL, which would turn this into an open redirect off chekpoint.gg.
  const rawFrom = params.get('from') ?? '';
  const from = /^\/(?![\/\\])/.test(rawFrom) ? rawFrom : '';
  function appendParam(base: string, kv: string) {
    return base ? `${base}${base.includes('?') ? '&' : '?'}${kv}` : '';
  }
  const successRedirect = from ? appendParam(from, 'steam=connected') : '/settings?steam=connected';
  const errorRedirect   = from ? appendParam(from, 'steam=error')     : '/settings?steam=error';
  // Steam account already linked to a different Chekpoint profile (profiles_steam_id_key).
  // Reported separately so it isn't shown as a generic "couldn't connect".
  const duplicateRedirect = from ? appendParam(from, 'steam=duplicate') : '/settings?steam=duplicate';

  if (params.get('openid.mode') !== 'id_res') {
    return context.redirect(from ? appendParam(from, 'steam=cancelled') : '/settings?steam=cancelled');
  }

  // Verify the assertion with Steam to prevent forgery. Only the openid.* fields
  // go back to Steam — not our own `from` param from the return_to URL.
  const verifyParams = new URLSearchParams();
  params.forEach((value, key) => { if (key.startsWith('openid.')) verifyParams.append(key, value); });
  verifyParams.set('openid.mode', 'check_authentication');

  const verifyRes = await fetch('https://steamcommunity.com/openid/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: verifyParams.toString(),
  });
  const verifyText = await verifyRes.text();

  if (!verifyText.includes('is_valid:true')) {
    console.error('[steam-callback] OpenID verification failed:', verifyText);
    return context.redirect(errorRedirect);
  }

  // Extract Steam ID from the claimed identity URL
  // Format: https://steamcommunity.com/openid/id/76561198012345678
  const claimedId = params.get('openid.claimed_id') ?? '';
  const steamIdMatch = claimedId.match(/\/id\/(\d+)$/);
  if (!steamIdMatch) {
    console.error('[steam-callback] Could not extract Steam ID from:', claimedId);
    return context.redirect(errorRedirect);
  }
  const steamId = steamIdMatch[1];

  // Fetch Steam display name
  const steamApiKey = import.meta.env.STEAM_API_KEY;
  let steamUsername: string | null = null;
  try {
    const summaryRes = await fetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${steamApiKey}&steamids=${steamId}`
    );
    const summaryData = await summaryRes.json();
    steamUsername = summaryData?.response?.players?.[0]?.personaname ?? null;
  } catch (e) {
    console.error('[steam-callback] GetPlayerSummaries error:', e);
    // Non-fatal — we still save the Steam ID, just without a display name
  }

  const db = getSupabaseAdmin() as any;
  const { data: profile } = await db
    .from('profiles').select('id').eq('auth_user_id', user.id).single();
  if (!profile) return context.redirect(errorRedirect);

  const { error } = await db.from('profiles').update({
    steam_id: steamId,
    steam_username: steamUsername,
  }).eq('id', profile.id);

  if (error) {
    if (error.code === '23505') {
      console.warn('[steam-callback] steam_id already linked to another profile:', steamId);
      return context.redirect(duplicateRedirect);
    }
    console.error('[steam-callback] profile update error:', JSON.stringify(error));
    return context.redirect(errorRedirect);
  }

  return context.redirect(successRedirect);
};
