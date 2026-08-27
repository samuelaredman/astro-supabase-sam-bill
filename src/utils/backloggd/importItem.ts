// Turn one scraped Backloggd review (an `import_job_items` row) into a native
// `reviews` row. Shared by the batch processor (api/import/backloggd/process.ts)
// and the manual game-match endpoint (api/import/backloggd/map.ts).
//
// Deliberately does NOT go through /api/reviews/create or finalizePublishedReview:
// that path fires a watchlist/follower notification per published review, which
// would mean hundreds of notifications for a migrating user. We insert the row
// directly and do just the one harmless side-effect a normal review has — mark
// the game "completed" in the author's library.

import { foldDiacritics } from "../games";
import { importGameByIgdbId } from "../games";
import { igdbGameBySlug } from "../igdb";
import type { BackloggdRow } from "./parse";

export type ImportItemInput = BackloggdRow & { id: string; matched_game_id?: string | null };

export type ImportItemOutcome = {
  status: "imported" | "drafted" | "skipped" | "needs_mapping" | "failed";
  matched_game_id?: string | null;
  review_id?: string | null;
  detail?: string | null;
};

function titlesMatch(a: string, b: string): boolean {
  const norm = (s: string) => foldDiacritics(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

/** Resolve a Backloggd platform name to a platforms.id, cached per run. Best effort. */
export async function resolvePlatformId(
  db: any,
  name: string | null | undefined,
  cache?: Map<string, string | null>,
): Promise<string | null> {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  if (cache?.has(key)) return cache.get(key) ?? null;

  const { data } = await db
    .from("platforms")
    .select("id, name")
    .ilike("name", name.trim())
    .limit(1)
    .maybeSingle();
  const id = data?.id ?? null;
  cache?.set(key, id);
  return id;
}

/**
 * Match the item's game (local slug -> IGDB slug -> conservative fuzzy) and,
 * on a hit, insert the review. Every branch returns an outcome; the caller
 * writes it back to the item row and bumps the matching job counter.
 */
export async function importBacklogItem(
  db: any,
  profileId: string,
  item: ImportItemInput,
  opts: { platformCache?: Map<string, string | null> } = {},
): Promise<ImportItemOutcome> {
  // ── 1. Match the game ──────────────────────────────────────────────────────
  let gameId: string | null = item.matched_game_id ?? null;
  let matchMethod = item.matched_game_id ? "manual" : "";

  if (!gameId) {
    const { data: bySlug } = await db
      .from("games")
      .select("id, title, slug")
      .eq("slug", item.game_slug)
      .maybeSingle();
    if (bySlug) {
      gameId = bySlug.id;
      matchMethod = "slug";
    }
  }

  if (!gameId) {
    const igdb = await igdbGameBySlug(item.game_slug);
    if (igdb) {
      const imported = await importGameByIgdbId(db, igdb.id);
      if (imported.ok) {
        gameId = imported.game.id;
        matchMethod = "igdb-slug";
      }
    }
  }

  if (!gameId) {
    const { data: candidates } = await db.rpc("search_games", {
      search_query: item.game_title,
      result_limit: 3,
    });
    const top = Array.isArray(candidates) ? candidates[0] : null;
    if (top && titlesMatch(top.title ?? "", item.game_title)) {
      const yearOk =
        item.release_year == null ||
        !top.date_released ||
        new Date(top.date_released).getFullYear() === item.release_year;
      if (yearOk) {
        gameId = top.id;
        matchMethod = "fuzzy";
      }
    }
  }

  if (!gameId) {
    return { status: "needs_mapping", matched_game_id: null, detail: "no game match" };
  }

  // ── 2. Skip if this user already has a review for the game ─────────────────
  const { data: existing } = await db
    .from("reviews")
    .select("id, status")
    .eq("profile_id", profileId)
    .eq("game_id", gameId)
    .maybeSingle();
  if (existing) {
    return {
      status: "skipped",
      matched_game_id: gameId,
      detail: `already has a ${existing.status ?? "existing"} review`,
    };
  }

  // ── 3. Insert the review directly ────────────────────────────────────────
  const published = item.rating != null;
  const score = published
    ? Math.min(10, Math.max(1, Math.round((item.rating as number) * 2)))
    : null;
  const platformId = await resolvePlatformId(db, item.platform_name, opts.platformCache);
  const dateIso = item.review_date ? `${item.review_date}T12:00:00Z` : null;

  const insertRow: Record<string, unknown> = {
    profile_id: profileId,
    game_id: gameId,
    score,
    title: null,
    body: item.review_text,
    status: published ? "published" : "draft",
    platform_played_on: platformId,
    contains_spoilers: item.contains_spoilers,
    published_at: published ? (dateIso ?? new Date().toISOString()) : null,
  };
  if (dateIso) insertRow.created_at = dateIso; // keep the review's original chronology

  const { data: inserted, error } = await db
    .from("reviews")
    .insert(insertRow)
    .select("id")
    .single();

  if (error) {
    // 23505 = reviews_one_published_per_game — a race with step 2 or a prior run.
    if ((error as { code?: string }).code === "23505") {
      return { status: "skipped", matched_game_id: gameId, detail: "duplicate review" };
    }
    return {
      status: "failed",
      matched_game_id: gameId,
      detail: (error as { message?: string }).message ?? "insert failed",
    };
  }

  // ── 4. Mark the game completed in the author's library (best effort) ──────
  try {
    await db.from("user_game_status").upsert(
      { profile_id: profileId, game_id: gameId, status: "completed", updated_at: new Date().toISOString() },
      { onConflict: "profile_id,game_id", ignoreDuplicates: true },
    );
  } catch {
    /* non-fatal */
  }

  return {
    status: published ? "imported" : "drafted",
    matched_game_id: gameId,
    review_id: inserted.id,
    detail: `matched by ${matchMethod}`,
  };
}
