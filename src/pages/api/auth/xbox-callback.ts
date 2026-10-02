import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";

// OpenXBL callback. After the user signs in with Microsoft on xbl.io,
// they land here with `?code=<one-time>`. The code is NOT the API key —
// it must be exchanged via POST https://xbl.io/app/claim, which returns
// the persistent per-user API key plus XUID + gamertag. That response
// shape is documented in the OpenXBL PHP SDK's ClaimsResponse
// (appKey, xuid, gamertag, email, avatar).
//
// OpenXBL doesn't preserve a `?state=` param across the flow, so we
// can't compare state values. We do require our own start-flow cookie
// to be present, which proves the user began this flow on our site
// rather than being tricked into landing on the callback URL directly
// with an attacker-controlled code.
export const GET: APIRoute = async (context) => {
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return context.redirect('/signin');

  const stateCookie = context.cookies.get('xbox_oauth_state')?.value ?? '';
  context.cookies.delete('xbox_oauth_state', { path: '/' });
  if (!stateCookie) {
    console.error('[xbox-callback] missing start-flow cookie');
    return context.redirect('/settings?xbox=error#xbox');
  }

  const code = (context.url.searchParams.get('code') ?? '').trim();
  if (!code) {
    console.error('[xbox-callback] missing code in callback params');
    return context.redirect('/settings?xbox=error#xbox');
  }

  const appKey = import.meta.env.OPENXBL_APP_KEY;
  if (!appKey) {
    console.error('[xbox-callback] OPENXBL_APP_KEY is not set');
    return context.redirect('/settings?xbox=error#xbox');
  }

  let claim: { appKey?: string; xuid?: string; gamertag?: string } | null = null;
  try {
    const res = await fetch('https://xbl.io/app/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ code, app_key: appKey }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error('[xbox-callback] claim returned', res.status, await res.text().catch(() => ''));
      return context.redirect('/settings?xbox=expired#xbox');
    }
    claim = await res.json();
  } catch (e) {
    console.error('[xbox-callback] claim fetch error:', e);
    return context.redirect('/settings?xbox=error#xbox');
  }

  if (!claim?.appKey || !claim.xuid) {
    console.error('[xbox-callback] claim response missing appKey/xuid:', claim);
    return context.redirect('/settings?xbox=error#xbox');
  }

  const db = getSupabaseAdmin() as any;
  const { data: profile } = await db
    .from('profiles').select('id').eq('auth_user_id', user.id).single();
  if (!profile) return context.redirect('/settings?xbox=error#xbox');

  const { error } = await db.from('profiles').update({
    xbox_xuid: String(claim.xuid),
    xbox_gamertag: claim.gamertag ?? null,
    xbox_api_key: claim.appKey,
  }).eq('id', profile.id);

  if (error) {
    if (error.code === '23505') {
      return context.redirect('/settings?xbox=duplicate#xbox');
    }
    console.error('[xbox-callback] profile update error:', JSON.stringify(error));
    return context.redirect('/settings?xbox=error#xbox');
  }

  return context.redirect('/settings?xbox=connected#xbox');
};
