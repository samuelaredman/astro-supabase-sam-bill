import { isAllowedGameCategory } from './games';

export type SimilarGame = {
  id: string;
  title: string;
  slug: string;
  cover_img_url: string | null;
  game_description: string | null;
  score: number;
};

const GENRE_WEIGHT = 2;
const THEME_WEIGHT = 1;
const FRANCHISE_WEIGHT = 5;
const COLLECTION_WEIGHT = 5;
const CO_RATED_WEIGHT = 3;
const HIGH_SCORE_THRESHOLD = 7;

// Cap on how many top-scored candidates we fetch full game rows for. Keeps the
// final .in() query small regardless of how many games share a tag — a common
// genre can link thousands of games, which blows past PostgREST's URL length
// limit if queried directly (same failure mode as scripts/audit-game-categories.ts).
const CANDIDATE_FETCH_CAP = 50;

// Every game_id a profile has already reviewed OR tracked in their library
// (playing/completed/dropped/owned/etc — any status at all). Pass this as
// `excludeIds` to every recommendation function below. Tracking a game with
// any status is a deliberate "I already know about this one" signal, same as
// a review — a user who marks something "Dropped" doesn't want to see it
// recommended again either.
export async function getExcludedGameIds(db: any, profileId: string): Promise<Set<string>> {
  const [{ data: reviewed }, { data: tracked }] = await Promise.all([
    db.from('reviews').select('game_id').eq('profile_id', profileId).eq('status', 'published'),
    db.from('user_game_status').select('game_id').eq('profile_id', profileId),
  ]);
  return new Set([
    ...(reviewed ?? []).map((r: any) => r.game_id),
    ...(tracked ?? []).map((r: any) => r.game_id),
  ]);
}

// Games "similar" to gameId, ranked by shared genres/themes/franchise/collection
// plus a collaborative signal (other users who rated gameId highly also rated
// the candidate highly). Excludes noise-category games (ports, DLC, etc.) —
// see src/utils/games.ts.
export async function getSimilarGames(
  db: any,
  gameId: string,
  limit = 6,
  excludeIds: Set<string> = new Set()
): Promise<SimilarGame[]> {
  const [{ data: genreRows }, { data: themeRows }, { data: franchiseRows }, { data: collectionRows }] =
    await Promise.all([
      db.from('game_genres').select('genre_id').eq('game_id', gameId),
      db.from('game_themes').select('theme_id').eq('game_id', gameId),
      db.from('game_franchises').select('franchise_id').eq('game_id', gameId),
      db.from('game_collections').select('collection_id').eq('game_id', gameId),
    ]);

  const genreIds = (genreRows ?? []).map((r: any) => r.genre_id);
  const themeIds = (themeRows ?? []).map((r: any) => r.theme_id);
  const franchiseIds = (franchiseRows ?? []).map((r: any) => r.franchise_id);
  const collectionIds = (collectionRows ?? []).map((r: any) => r.collection_id);

  const scoreByGame = new Map<string, number>();
  const bump = (id: string, amount: number) => {
    if (excludeIds.has(id)) return;
    scoreByGame.set(id, (scoreByGame.get(id) ?? 0) + amount);
  };

  const contentQueries: Promise<void>[] = [];
  if (genreIds.length > 0) {
    contentQueries.push(
      db.from('game_genres').select('game_id').in('genre_id', genreIds).neq('game_id', gameId)
        .then(({ data }: any) => { for (const r of data ?? []) bump(r.game_id, GENRE_WEIGHT); })
    );
  }
  if (themeIds.length > 0) {
    contentQueries.push(
      db.from('game_themes').select('game_id').in('theme_id', themeIds).neq('game_id', gameId)
        .then(({ data }: any) => { for (const r of data ?? []) bump(r.game_id, THEME_WEIGHT); })
    );
  }
  if (franchiseIds.length > 0) {
    contentQueries.push(
      db.from('game_franchises').select('game_id').in('franchise_id', franchiseIds).neq('game_id', gameId)
        .then(({ data }: any) => { for (const r of data ?? []) bump(r.game_id, FRANCHISE_WEIGHT); })
    );
  }
  if (collectionIds.length > 0) {
    contentQueries.push(
      db.from('game_collections').select('game_id').in('collection_id', collectionIds).neq('game_id', gameId)
        .then(({ data }: any) => { for (const r of data ?? []) bump(r.game_id, COLLECTION_WEIGHT); })
    );
  }

  // Collaborative signal: reviewers who rated this game highly, and what else they rated highly.
  // Capped at 500 raters — a sample is enough for a similarity signal and keeps
  // the profile_id list small for the follow-up query.
  const collaborativePromise = db
    .from('reviews')
    .select('profile_id')
    .eq('game_id', gameId)
    .eq('status', 'published')
    .gte('score', HIGH_SCORE_THRESHOLD)
    .limit(500)
    .then(async ({ data: raters }: any) => {
      const profileIds = (raters ?? []).map((r: any) => r.profile_id);
      if (profileIds.length === 0) return;
      const { data: coRated } = await db
        .from('reviews')
        .select('game_id')
        .in('profile_id', profileIds)
        .eq('status', 'published')
        .gte('score', HIGH_SCORE_THRESHOLD)
        .neq('game_id', gameId);
      for (const r of coRated ?? []) bump(r.game_id, CO_RATED_WEIGHT);
    });

  await Promise.all([...contentQueries, collaborativePromise]);

  if (scoreByGame.size === 0) return [];

  // Rank by score in memory first, then only fetch full rows for the top
  // candidates — keeps the .in() below small no matter how many games share
  // a tag (a common genre alone can link thousands of games).
  const topCandidateIds = [...scoreByGame.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, CANDIDATE_FETCH_CAP)
    .map(([id]) => id);

  const { data: candidateGames } = await db
    .from('games')
    .select('id, title, slug, cover_img_url, game_description, igdb_category')
    .in('id', topCandidateIds);

  return (candidateGames ?? [])
    .filter((g: any) => isAllowedGameCategory(g.igdb_category))
    .map((g: any) => ({
      id: g.id,
      title: g.title,
      slug: g.slug,
      cover_img_url: g.cover_img_url,
      game_description: g.game_description,
      score: scoreByGame.get(g.id) ?? 0,
    }))
    .sort((a: SimilarGame, b: SimilarGame) => b.score - a.score)
    .slice(0, limit);
}

const FAVORITE_GENRE_COUNT = 2;

// Games in the profile's highest-scoring genres (weighted by review score, so
// a genre from a 9/10 review counts more than one from a 4/10 review) that
// they haven't already reviewed. Ranked by how many other users rated the
// candidate highly, as a proxy for "well-liked in that genre."
export type GenreRecommendations = { genreNames: string[]; recs: SimilarGame[] };

export async function getGenreBasedRecommendations(
  db: any,
  profileId: string,
  limit = 6,
  excludeIds: Set<string> = new Set()
): Promise<GenreRecommendations> {
  const { data: ownReviews } = await db
    .from('reviews')
    .select('score, games(id, game_genres(genre_id))')
    .eq('profile_id', profileId)
    .eq('status', 'published');

  const genreScore = new Map<string, number>();
  for (const r of ownReviews ?? []) {
    for (const gg of r.games?.game_genres ?? []) {
      genreScore.set(gg.genre_id, (genreScore.get(gg.genre_id) ?? 0) + r.score);
    }
  }
  if (genreScore.size === 0) return { genreNames: [], recs: [] };

  const topGenreIds = [...genreScore.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, FAVORITE_GENRE_COUNT)
    .map(([id]) => id);

  const { data: genreNameRows } = await db.from('genres').select('name').in('id', topGenreIds);
  const genreNames = (genreNameRows ?? []).map((r: any) => r.name);

  const { data: genreGameRows } = await db
    .from('game_genres')
    .select('game_id')
    .in('genre_id', topGenreIds);

  const candidateIds = [...new Set((genreGameRows ?? []).map((r: any) => r.game_id))]
    .filter((id) => !excludeIds.has(id as string));
  if (candidateIds.length === 0) return { genreNames, recs: [] };

  // Rank candidates by how many highly-scored reviews they have — cap the
  // lookup list for the same URL-length reason noted on getSimilarGames.
  const { data: candidateReviews } = await db
    .from('reviews')
    .select('game_id')
    .in('game_id', candidateIds.slice(0, CANDIDATE_FETCH_CAP * 4))
    .eq('status', 'published')
    .gte('score', HIGH_SCORE_THRESHOLD);

  const popularity = new Map<string, number>();
  for (const r of candidateReviews ?? []) {
    popularity.set(r.game_id, (popularity.get(r.game_id) ?? 0) + 1);
  }

  const topCandidateIds = [...popularity.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, CANDIDATE_FETCH_CAP)
    .map(([id]) => id);
  if (topCandidateIds.length === 0) return { genreNames, recs: [] };

  const { data: candidateGames } = await db
    .from('games')
    .select('id, title, slug, cover_img_url, game_description, igdb_category')
    .in('id', topCandidateIds);

  const recs = (candidateGames ?? [])
    .filter((g: any) => isAllowedGameCategory(g.igdb_category))
    .map((g: any) => ({
      id: g.id,
      title: g.title,
      slug: g.slug,
      cover_img_url: g.cover_img_url,
      game_description: g.game_description,
      score: popularity.get(g.id) ?? 0,
    }))
    .sort((a: SimilarGame, b: SimilarGame) => b.score - a.score)
    .slice(0, limit);

  return { genreNames, recs };
}

const COMMENT_INTERACTION_WEIGHT = 2;
const REACTION_INTERACTION_WEIGHT = 1;
const SOCIAL_REVIEW_LIMIT = 200;

// Games mutual follows (people who follow the profile back) rated highly and
// recently, weighted by how much the profile has interacted with that specific
// person (comments count more than a reaction/vote). Games the profile already
// reviewed are excluded.
export async function getSocialRecommendations(
  db: any,
  profileId: string,
  limit = 6,
  excludeIds: Set<string> = new Set()
): Promise<SimilarGame[]> {
  const [{ data: iFollow }, { data: followMe }] = await Promise.all([
    db.from('follows').select('following_id').eq('follower_id', profileId),
    db.from('follows').select('follower_id').eq('following_id', profileId),
  ]);

  const followingSet = new Set((iFollow ?? []).map((r: any) => r.following_id));
  const mutualIds = [...new Set((followMe ?? []).map((r: any) => r.follower_id))]
    .filter((id) => followingSet.has(id));
  if (mutualIds.length === 0) return [];

  const { data: friendReviews } = await db
    .from('reviews')
    .select('id, profile_id, game_id, score, games(id, title, slug, cover_img_url, game_description, igdb_category)')
    .in('profile_id', mutualIds)
    .eq('status', 'published')
    .gte('score', HIGH_SCORE_THRESHOLD)
    .order('published_at', { ascending: false })
    .limit(SOCIAL_REVIEW_LIMIT);

  const qualifyingReviews = (friendReviews ?? []).filter((r: any) => !excludeIds.has(r.game_id));
  if (qualifyingReviews.length === 0) return [];

  // How much has this profile interacted with each mutual friend? Comments on
  // their reviews count double a reaction/vote.
  const interactionWeight = new Map<string, number>();
  const [{ data: myComments }, { data: myReactions }, { data: myVotes }] = await Promise.all([
    db.from('review_comments').select('review_id').eq('profile_id', profileId),
    db.from('review_reactions').select('review_id').eq('profile_id', profileId),
    db.from('review_votes').select('review_id').eq('profile_id', profileId),
  ]);

  const interactedReviewIds = [...new Set([
    ...(myComments ?? []).map((r: any) => r.review_id),
    ...(myReactions ?? []).map((r: any) => r.review_id),
    ...(myVotes ?? []).map((r: any) => r.review_id),
  ])];

  if (interactedReviewIds.length > 0) {
    const { data: interactedReviews } = await db
      .from('reviews')
      .select('id, profile_id')
      .in('id', interactedReviewIds.slice(0, CANDIDATE_FETCH_CAP * 4));
    const authorByReviewId = new Map<string, string>((interactedReviews ?? []).map((r: any) => [r.id, r.profile_id]));

    const bumpInteraction = (reviewId: string, amount: number) => {
      const authorId = authorByReviewId.get(reviewId);
      if (!authorId) return;
      interactionWeight.set(authorId, (interactionWeight.get(authorId) ?? 0) + amount);
    };
    for (const r of myComments ?? []) bumpInteraction(r.review_id, COMMENT_INTERACTION_WEIGHT);
    for (const r of myReactions ?? []) bumpInteraction(r.review_id, REACTION_INTERACTION_WEIGHT);
    for (const r of myVotes ?? []) bumpInteraction(r.review_id, REACTION_INTERACTION_WEIGHT);
  }

  const scoreByGame = new Map<string, number>();
  const gameById = new Map<string, any>();
  for (const r of qualifyingReviews) {
    if (!r.games || !isAllowedGameCategory(r.games.igdb_category)) continue;
    const weight = 1 + (interactionWeight.get(r.profile_id) ?? 0);
    scoreByGame.set(r.game_id, (scoreByGame.get(r.game_id) ?? 0) + weight);
    gameById.set(r.game_id, r.games);
  }

  return [...scoreByGame.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([gameId, score]) => {
      const g = gameById.get(gameId);
      return { id: g.id, title: g.title, slug: g.slug, cover_img_url: g.cover_img_url, game_description: g.game_description, score };
    });
}
