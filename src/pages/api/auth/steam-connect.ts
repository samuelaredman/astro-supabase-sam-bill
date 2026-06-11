import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext } from "../../../utils/database";

export const GET: APIRoute = async (context) => {
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return context.redirect('/signin');

  const origin = context.url.origin;
  // Allow callers to pass ?from=<path> so the callback can redirect back there
  const from = context.url.searchParams.get('from') ?? '';
  const callbackUrl = from
    ? `${origin}/api/auth/steam-callback?from=${encodeURIComponent(from)}`
    : `${origin}/api/auth/steam-callback`;

  const params = new URLSearchParams({
    'openid.ns':         'http://specs.openid.net/auth/2.0',
    'openid.mode':       'checkid_setup',
    'openid.return_to':  callbackUrl,
    'openid.realm':      origin,
    'openid.identity':   'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });

  return context.redirect(`https://steamcommunity.com/openid/login?${params}`);
};
