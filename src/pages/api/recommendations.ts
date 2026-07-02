import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../utils/database";
import {
  getReviewedGameIds,
  getSimilarGames,
  getGenreBasedRecommendations,
  getSocialRecommendations,
} from "../../utils/recommendations";
import { json } from "../../utils/api";

const HIGH_SCORE = 7;
const SEED_GAME_LIMIT = 5;
const RECS_PER_GAME = 4;
const GENRE_RECS_LIMIT = 6;
const SOCIAL_RECS_LIMIT = 6;

export const GET: APIRoute = async ({ url }) => {
  const username = url.searchParams.get("username")?.trim();
  if (!username) return json({ error: "Missing username." }, 400);

  const db = getSupabaseAdmin();

  const { data: profile } = await db
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (!profile) return json({ error: "Reviewer not found." }, 404);

  // Everything already reviewed is off-limits everywhere below. Grows as each
  // section picks recommendations, so later sections don't repeat an earlier
  // section's picks (e.g. the same game showing up under two different seeds).
  const excludeIds = await getReviewedGameIds(db, profile.id);
  const claim = (recs: { id: string }[]) => { for (const r of recs) excludeIds.add(r.id); };

  const { data: reviews } = await db
    .from("reviews")
    .select("score, games(id, title, slug, cover_img_url)")
    .eq("profile_id", profile.id)
    .eq("status", "published")
    .gte("score", HIGH_SCORE)
    .order("score", { ascending: false })
    .limit(SEED_GAME_LIMIT);

  const seedGames = (reviews ?? []).map((r: any) => r.games).filter(Boolean);

  const gameSections: any[] = [];
  for (const game of seedGames) {
    const recs = await getSimilarGames(db, game.id, RECS_PER_GAME, excludeIds);
    if (recs.length === 0) continue;
    claim(recs);
    gameSections.push({ type: "game", game, recs });
  }

  const genreResult = await getGenreBasedRecommendations(db, profile.id, GENRE_RECS_LIMIT, excludeIds);
  claim(genreResult.recs);
  const genreSection = genreResult.recs.length > 0
    ? { type: "genre", genreNames: genreResult.genreNames, recs: genreResult.recs }
    : null;

  const socialRecs = await getSocialRecommendations(db, profile.id, SOCIAL_RECS_LIMIT, excludeIds);
  claim(socialRecs);
  const socialSection = socialRecs.length > 0 ? { type: "social", recs: socialRecs } : null;

  // Intersperse: first game block, then the genre block (breaks up the
  // sequence of per-game blocks), then remaining game blocks, then social.
  const recommendations = [
    ...gameSections.slice(0, 1),
    ...(genreSection ? [genreSection] : []),
    ...gameSections.slice(1),
    ...(socialSection ? [socialSection] : []),
  ];

  return json({ recommendations });
};
