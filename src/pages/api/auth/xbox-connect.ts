import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext } from "../../../utils/database";

// Starts the OpenXBL "Sign in with Xbox" flow. The user is redirected to
// xbl.io/app/auth/<APP_KEY>, signs in with their Microsoft account there,
// and OpenXBL redirects them back to this app's configured redirect URL
// (set in the OpenXBL app dashboard on xbl.io/profile) with `?code=`.
// The callback then POSTs to xbl.io/app/claim to exchange that code for
// the persistent per-user API key + XUID + gamertag.
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

  // OpenXBL rebuilt their site and removed the `/app/auth/<key>` OAuth
  // endpoint we used to redirect to — it now returns a 404 page. Until
  // they publish a replacement URL, send users to the Xbox section of
  // Settings where the manual paste-your-API-key flow lives.
  return context.redirect('/settings?xbox=oauth-removed#xbox');
};
