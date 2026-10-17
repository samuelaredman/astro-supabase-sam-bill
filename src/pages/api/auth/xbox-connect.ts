import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext } from "../../../utils/database";

// Starts the OpenXBL "Sign in with Xbox" flow. The user is redirected to
// api.xbl.io/app/auth/<APP_KEY>, signs in with their Microsoft account
// (seeing our app's Azure consent screen), and OpenXBL redirects them
// back to the callback URL registered in our OpenXBL dashboard app
// (currently /api/auth/xbox-callback) with `?code=`. The callback then
// POSTs to api.xbl.io/app/claim to exchange that code for the
// persistent per-user API key + XUID + gamertag.
//
// If OPENXBL_APP_KEY isn't set in prod, fall through to the manual
// paste-key flow in /settings#xbox — same end-state, different UX.
//
// OpenXBL doesn't preserve a state query param across the flow, so we
// set an HttpOnly `xbox_oauth_state` cookie here as a simple proof-of-
// start signal. The callback requires it to be present, which prevents
// a drive-by CSRF where an attacker sends a user directly to the
// callback URL with an attacker-controlled code.
export const GET: APIRoute = async (context) => {
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return context.redirect('/signin');

  const appKey = import.meta.env.OPENXBL_APP_KEY;
  if (!appKey) {
    // Nothing to redirect to — nudge the user toward the paste-key flow.
    return context.redirect('/settings?xbox=oauth-unavailable#xbox');
  }

  const stateBytes = new Uint8Array(24);
  crypto.getRandomValues(stateBytes);
  const state = Array.from(stateBytes, (b) => b.toString(16).padStart(2, '0')).join('');

  // 10-min TTL covers any realistic time on the Microsoft login screen.
  // SameSite=Lax so it survives the top-level cross-site redirect back.
  context.cookies.set('xbox_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10,
  });

  return context.redirect(`https://api.xbl.io/app/auth/${encodeURIComponent(appKey)}`);
};
