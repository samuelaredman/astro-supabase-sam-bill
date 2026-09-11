import { createSupabaseServerClientFromContext, getSupabaseAdmin } from './database';

type ServerClient = ReturnType<typeof createSupabaseServerClientFromContext>;
type PageContext = Parameters<typeof createSupabaseServerClientFromContext>[0] & { locals: App.Locals };

export interface PageUser {
  id: string;
  email: string | null;
}

/**
 * Resolves the logged-in user for a page render. Pages only — API routes that
 * write keep using `requireAuth` (getUser), see below.
 *
 * Uses getClaims(), not getUser(). The project signs JWTs with an asymmetric
 * key (ES256), so getClaims verifies the token locally against a JWKS that
 * auth-js caches for the life of the function instance, where getUser() makes
 * a round trip to Supabase Auth on every render — ~56 ms per logged-in page,
 * measured on the Netlify deploy preview. The trade-off: a token is trusted
 * until it expires (≤ 1 h) even if its session was revoked server-side. Fine
 * for deciding what to render; not for authorizing writes.
 *
 * Also starts the Layout's onboarding lookup, so that query overlaps the page's
 * own instead of running after them (see `awaitOnboardingProfile`).
 */
export async function getPageUser(
  context: PageContext,
  client: ServerClient = createSupabaseServerClientFromContext(context),
): Promise<PageUser | null> {
  let claims;
  try {
    const { data } = await client.auth.getClaims();
    claims = data?.claims;
  } catch (e) {
    // getClaims rethrows non-auth errors (e.g. WebCrypto). getUser() never
    // threw, so render logged-out rather than 500 the page.
    console.error('[getPageUser] getClaims error:', e);
    return null;
  }
  if (!claims?.sub) return null;

  context.locals.onboardingProfile = loadOnboardingProfile('auth_user_id', claims.sub);
  return { id: claims.sub, email: claims.email ?? null };
}

// Never rejects: the promise can be dropped unawaited when a page redirects.
async function loadOnboardingProfile(column: 'id' | 'auth_user_id', value: string) {
  try {
    const { data } = await getSupabaseAdmin()
      .from('profiles')
      .select('id, avatar_url, favorite_game_id, showcase_games, backloggd_import_done_at, onboarding_completed_at, favorite_game:games!favorite_game_id (id, title, slug, cover_img_url)')
      .eq(column, value)
      .maybeSingle();
    return data;
  } catch (e) {
    console.error('[loadOnboardingProfile] error:', e);
    return null;
  }
}

export type OnboardingProfile = NonNullable<Awaited<ReturnType<typeof loadOnboardingProfile>>>;

/**
 * The onboarding fields for `profileId`: the lookup getPageUser() already
 * started when there is one, otherwise a fresh query.
 */
export async function awaitOnboardingProfile(
  locals: App.Locals,
  profileId: string,
): Promise<OnboardingProfile | null> {
  const started = await locals.onboardingProfile;
  if (started && started.id === profileId) return started;
  return loadOnboardingProfile('id', profileId);
}
