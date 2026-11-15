import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";

// OpenXBL callback. After the user signs in with Microsoft (consent screen
// shows our Azure app), they land here with `?code=<one-time>`. The code is
// NOT the API key — it must be exchanged via POST https://api.xbl.io/app/claim,
// which returns the persistent per-user API key plus XUID + gamertag. That
// response shape is documented in the OpenXBL PHP SDK's ClaimsResponse
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
    return context.redirect('/settings?xbox=error&reason=no_cookie#xbox');
  }

  const code = (context.url.searchParams.get('code') ?? '').trim();
  if (!code) {
    console.error('[xbox-callback] missing code in callback params');
    return context.redirect('/settings?xbox=error&reason=no_code#xbox');
  }

  const appKey = import.meta.env.OPENXBL_APP_KEY;
  if (!appKey) {
    console.error('[xbox-callback] OPENXBL_APP_KEY is not set');
    return context.redirect('/settings?xbox=error&reason=no_key#xbox');
  }

  let claim: { appKey?: string; xuid?: string; gamertag?: string } | null = null;
  let res: Response;
  try {
    res = await fetch('https://api.xbl.io/app/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ code, app_key: appKey }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e: any) {
    const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    console.error('[xbox-callback] claim fetch error:', e?.name, e?.message);
    return context.redirect(`/settings?xbox=error&reason=${isTimeout ? 'fetch_timeout' : 'fetch_network'}#xbox`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[xbox-callback] claim returned', res.status, body.slice(0, 300));
    return context.redirect(`/settings?xbox=expired&status=${res.status}#xbox`);
  }
  const bodyText = await res.text().catch(() => '');
  try {
    claim = JSON.parse(bodyText);
  } catch (e) {
    console.error('[xbox-callback] claim body was not JSON. first 200 chars:', bodyText.slice(0, 200));
    return context.redirect('/settings?xbox=error&reason=bad_json#xbox');
  }

  if (!claim?.appKey || !claim.xuid) {
    console.error('[xbox-callback] claim response missing appKey/xuid:', claim);
    return context.redirect('/settings?xbox=error&reason=bad_claim#xbox');
  }

  const db = getSupabaseAdmin() as any;
  const { data: profile } = await db
    .from('profiles').select('id').eq('auth_user_id', user.id).single();
  if (!profile) return context.redirect('/settings?xbox=error&reason=no_profile#xbox');

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
    return context.redirect('/settings?xbox=error&reason=db_error#xbox');
  }

  return context.redirect('/settings?xbox=connected#xbox');
};
