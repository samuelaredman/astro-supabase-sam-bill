// Taste matching — how alike two reviewers' scoring tastes are.
//
// The pure scorer (computeTasteMatch) joins two users' published reviews on game_id
// and derives an explainable "% match" plus a structured breakdown. getTasteMatch wraps
// it with a per-pair JSONB cache (taste_matches) keyed on the unordered pair, mirroring
// the recommendation_cache pattern. Everything the scorer returns is symmetric except the
// per-game "your score vs their score" orientation, which getTasteMatch flips so the
// caller always sees themselves as the viewer.

import type { SupabaseAdmin } from './api';
import type { Json } from '../../supabase/types';
import { tasteMatchLabel } from './format';

/** Shrinkage pseudo-count: agreement is pulled toward NEUTRAL_PRIOR by this many
 *  virtual "neutral" games, so a single coincidental match isn't read as 100%. */
export const TASTE_MATCH_C = 5;
/** Neutral prior (0.5 = "no information") that small samples shrink toward. */
export const NEUTRAL_PRIOR = 0.5;
/** How long a cached pair stays fresh before recomputation (24h). */
export const TASTE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Max games surfaced in the top agreements / disagreements lists. */
export const TOP_N = 3;
/** A genre needs at least this many shared games to appear in the breakdown. */
export const MIN_GENRE_SHARED = 2;

export type Confidence = 'none' | 'low' | 'medium' | 'high';

/** One user's review of a game, as fed to the pure scorer. */
export interface TasteReview {
  game_id: string;
  score: number;
  published_at: string | null;
  game: { title: string; slug: string | null; cover_img_url: string | null };
  genres: string[];
}

const publishedTs = (d: string | null) => (d ? new Date(d).getTime() : 0);

/**
 * Collapse a review list to one row per game — the most recently published score.
 *
 * Taste match compares "what each user thinks now". A re-review model (separate
 * in-flight work) allows multiple dated published reviews per (user, game), so a
 * user may have several rows for one game; we keep only their latest, which mirrors
 * the semantics of the planned `current_reviews` view. Today's schema has one
 * published review per (user, game), so this is a no-op — but it keeps the scorer
 * correct either way, and independent of which data source feeds it.
 */
export function latestPerGame(reviews: TasteReview[]): TasteReview[] {
  const map = new Map<string, TasteReview>();
  for (const r of reviews) {
    const prev = map.get(r.game_id);
    if (!prev || publishedTs(r.published_at) >= publishedTs(prev.published_at)) {
      map.set(r.game_id, r);
    }
  }
  return [...map.values()];
}

/** A game both users reviewed. scoreA is the viewer's, scoreB the other user's. */
export interface SharedGame {
  game_id: string;
  title: string;
  slug: string | null;
  cover_img_url: string | null;
  scoreA: number;
  scoreB: number;
  agreement: number; // 0..1
}

export interface GenreAgreement {
  genre: string;
  agreement: number; // 0..1
  pct: number; // 0..100
  shared: number;
}

export interface TasteMatchResult {
  disabled: boolean;
  matchPct: number; // 0..100
  label: string;
  confidence: Confidence;
  sharedCount: number;
  viewerReviewCount: number;
  targetReviewCount: number;
  viewerAvg: number | null; // avg over shared games
  targetAvg: number | null;
  correlation: number | null; // Pearson r over shared scores (secondary signal)
  sharedGames: SharedGame[]; // full list, agreement desc
  topAgreements: SharedGame[];
  topDisagreements: SharedGame[];
  genreBreakdown: GenreAgreement[];
  computedAt: string;
}

function emptyResult(overrides: Partial<TasteMatchResult> = {}): TasteMatchResult {
  return {
    disabled: false,
    matchPct: 0,
    label: tasteMatchLabel(0),
    confidence: 'none',
    sharedCount: 0,
    viewerReviewCount: 0,
    targetReviewCount: 0,
    viewerAvg: null,
    targetAvg: null,
    correlation: null,
    sharedGames: [],
    topAgreements: [],
    topDisagreements: [],
    genreBreakdown: [],
    computedAt: new Date().toISOString(),
    ...overrides,
  };
}

function pearson(shared: SharedGame[]): number | null {
  const n = shared.length;
  if (n < 2) return null;
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (const g of shared) {
    sa += g.scoreA; sb += g.scoreB;
    saa += g.scoreA * g.scoreA; sbb += g.scoreB * g.scoreB;
    sab += g.scoreA * g.scoreB;
  }
  const num = n * sab - sa * sb;
  const den = Math.sqrt((n * saa - sa * sa) * (n * sbb - sb * sb));
  if (den === 0) return null;
  return num / den;
}

/**
 * Pure taste-match scorer. `aReviews` is the viewer's side (scoreA), `bReviews` the
 * other user's (scoreB). No I/O — safe to unit test.
 */
export function computeTasteMatch(aReviewsRaw: TasteReview[], bReviewsRaw: TasteReview[]): TasteMatchResult {
  // Reduce to one row per game (latest score) so re-reviews don't double-count.
  const aReviews = latestPerGame(aReviewsRaw);
  const bReviews = latestPerGame(bReviewsRaw);

  const bByGame = new Map<string, TasteReview>();
  for (const r of bReviews) bByGame.set(r.game_id, r);

  const shared: SharedGame[] = [];
  const genresByGame: string[][] = [];
  for (const a of aReviews) {
    const b = bByGame.get(a.game_id);
    if (!b) continue;
    const agreement = 1 - Math.abs(a.score - b.score) / 9;
    shared.push({
      game_id: a.game_id,
      title: a.game.title,
      slug: a.game.slug,
      cover_img_url: a.game.cover_img_url,
      scoreA: a.score,
      scoreB: b.score,
      agreement,
    });
    genresByGame.push(a.genres);
  }

  const n = shared.length;
  if (n === 0) {
    return emptyResult({
      viewerReviewCount: aReviews.length,
      targetReviewCount: bReviews.length,
    });
  }

  const sumAgreement = shared.reduce((s, g) => s + g.agreement, 0);
  const adjusted = (TASTE_MATCH_C * NEUTRAL_PRIOR + sumAgreement) / (TASTE_MATCH_C + n);
  const matchPct = Math.round(adjusted * 100);
  const confidence: Confidence = n < 5 ? 'low' : n < 10 ? 'medium' : 'high';

  const viewerAvg = shared.reduce((s, g) => s + g.scoreA, 0) / n;
  const targetAvg = shared.reduce((s, g) => s + g.scoreB, 0) / n;

  // Genre breakdown: a game counts toward each of its genres.
  const genreAgg = new Map<string, { sum: number; count: number }>();
  shared.forEach((g, i) => {
    for (const genre of genresByGame[i]) {
      const e = genreAgg.get(genre) ?? { sum: 0, count: 0 };
      e.sum += g.agreement;
      e.count += 1;
      genreAgg.set(genre, e);
    }
  });
  const genreBreakdown: GenreAgreement[] = [...genreAgg.entries()]
    .filter(([, e]) => e.count >= MIN_GENRE_SHARED)
    .map(([genre, e]) => ({
      genre,
      agreement: e.sum / e.count,
      pct: Math.round((e.sum / e.count) * 100),
      shared: e.count,
    }))
    .sort((x, y) => y.agreement - x.agreement || y.shared - x.shared);

  const sharedGames = [...shared].sort(
    (x, y) => y.agreement - x.agreement || (y.scoreA + y.scoreB) - (x.scoreA + x.scoreB),
  );
  const topAgreements = sharedGames.slice(0, TOP_N);
  const topDisagreements = [...shared]
    .filter((g) => g.scoreA !== g.scoreB)
    .sort((x, y) => Math.abs(y.scoreA - y.scoreB) - Math.abs(x.scoreA - x.scoreB) || (x.scoreA + x.scoreB) - (y.scoreA + y.scoreB))
    .slice(0, TOP_N);

  return {
    disabled: false,
    matchPct,
    label: tasteMatchLabel(matchPct),
    confidence,
    sharedCount: n,
    viewerReviewCount: aReviews.length,
    targetReviewCount: bReviews.length,
    viewerAvg,
    targetAvg,
    correlation: pearson(shared),
    sharedGames,
    topAgreements,
    topDisagreements,
    genreBreakdown,
    computedAt: new Date().toISOString(),
  };
}

/** Flip a canonically-computed result so the viewer is always "A". */
function orient(result: TasteMatchResult, swap: boolean): TasteMatchResult {
  if (!swap) return result;
  const flip = (g: SharedGame): SharedGame => ({ ...g, scoreA: g.scoreB, scoreB: g.scoreA });
  return {
    ...result,
    viewerReviewCount: result.targetReviewCount,
    targetReviewCount: result.viewerReviewCount,
    viewerAvg: result.targetAvg,
    targetAvg: result.viewerAvg,
    sharedGames: result.sharedGames.map(flip),
    topAgreements: result.topAgreements.map(flip),
    topDisagreements: result.topDisagreements.map(flip),
  };
}

async function fetchReviewVectors(db: SupabaseAdmin, profileId: string): Promise<TasteReview[]> {
  // Reads published reviews directly. When the re-review work lands its
  // `current_reviews` view (latest published review per user+game), switch this
  // `.from('reviews')` to `.from('current_reviews')` for authoritativeness — the
  // latestPerGame() dedup in computeTasteMatch already makes the result identical
  // either way, so this is a drop-in efficiency swap, not a correctness fix.
  const out: TasteReview[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('reviews')
      .select('game_id, score, published_at, games(title, slug, cover_img_url, game_genres(genres(name)))')
      .eq('profile_id', profileId)
      .eq('status', 'published')
      .not('score', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('[tasteMatch] review fetch error:', JSON.stringify(error));
      break;
    }
    if (!data || data.length === 0) break;
    for (const row of data) {
      const g = row.games as any;
      if (!g || row.score == null) continue;
      const genres: string[] = (g.game_genres ?? [])
        .map((gg: any) => gg?.genres?.name)
        .filter((name: unknown): name is string => typeof name === 'string');
      out.push({
        game_id: row.game_id,
        score: row.score,
        published_at: row.published_at,
        game: { title: g.title, slug: g.slug, cover_img_url: g.cover_img_url },
        genres,
      });
    }
    if (data.length < PAGE) break;
  }
  return out;
}

/**
 * Cache-aware taste match between the viewer and a target profile, oriented so the
 * viewer is always "A". Returns { disabled: true } if the target has opted out.
 */
export async function getTasteMatch(
  db: SupabaseAdmin,
  viewerId: string,
  targetId: string,
  opts: { refresh?: boolean } = {},
): Promise<TasteMatchResult> {
  const { data: targetProfile } = await db
    .from('profiles')
    .select('taste_match_enabled')
    .eq('id', targetId)
    .maybeSingle();
  if (!targetProfile) return emptyResult({ disabled: true });
  if (targetProfile.taste_match_enabled === false) return emptyResult({ disabled: true });

  const [a, b] = viewerId < targetId ? [viewerId, targetId] : [targetId, viewerId];
  const swap = viewerId !== a; // viewer is profile_b → flip so "you" = A

  if (!opts.refresh) {
    const { data: cached } = await db
      .from('taste_matches')
      .select('data, computed_at')
      .eq('profile_a', a)
      .eq('profile_b', b)
      .maybeSingle();
    if (cached && Date.now() - new Date(cached.computed_at).getTime() < TASTE_CACHE_TTL_MS) {
      return orient(cached.data as unknown as TasteMatchResult, swap);
    }
  }

  const [aReviews, bReviews] = await Promise.all([
    fetchReviewVectors(db, a),
    fetchReviewVectors(db, b),
  ]);
  const result = computeTasteMatch(aReviews, bReviews);

  const { error: upsertError } = await db
    .from('taste_matches')
    .upsert(
      { profile_a: a, profile_b: b, data: result as unknown as Json, computed_at: new Date().toISOString() },
      { onConflict: 'profile_a,profile_b' },
    );
  if (upsertError) {
    console.error('[tasteMatch] cache upsert error:', JSON.stringify(upsertError));
  }

  return orient(result, swap);
}
