// Turn one scraped Steam review (an `import_job_items` row) into a native
// `reviews` row. Steam reviews don't have a score — every imported review
// comes in as a draft so the user assigns a score and publishes it themselves.
//
// Deliberately does NOT go through /api/reviews/create or
// finalizePublishedReview: drafts don't fire notifications anyway, but keeping
// the same direct-insert shape as backloggd/importItem.ts means both flows
// share the "skip if a review already exists" branch and the outcome contract
// consumed by /api/import/*/process.ts and /map.ts.

import { matchSteamReviewGame } from "./matchGame";

export type SteamImportItemInput = {
  id: string;
  steam_appid: number | null;
  game_title: string;
  review_text: string;
  review_date: string | null;
  /** From "hrs at review time" (fallback: "hrs on record"). Rounded to int on write. */
  hours_at_review: number | null;
  source_url: string;
  matched_game_id?: string | null;
};

export type SteamImportItemOutcome = {
  status: "drafted" | "skipped" | "needs_mapping" | "failed";
  matched_game_id?: string | null;
  review_id?: string | null;
  detail?: string | null;
};

/** Resolve the PC platform id once per run — Steam reviews are always PC. */
export async function resolvePCPlatformId(
  db: any,
  cache?: { pcPlatformId?: string | null },
): Promise<string | null> {
  if (cache && "pcPlatformId" in cache) return cache.pcPlatformId ?? null;

  // Try in order — the IGDB-derived name is the most likely, but seed data
  // could have collapsed it. First hit wins.
  const candidates = ["PC (Microsoft Windows)", "PC", "Windows"];
  let hit: string | null = null;
  for (const name of candidates) {
    const { data } = await db
      .from("platforms")
      .select("id, name")
      .ilike("name", name)
      .limit(1)
      .maybeSingle();
    if (data?.id) {
      hit = data.id;
      break;
    }
  }
  if (cache) cache.pcPlatformId = hit;
  return hit;
}

export async function importSteamReviewItem(
  db: any,
  profileId: string,
  item: SteamImportItemInput,
  opts: { pcPlatformCache?: { pcPlatformId?: string | null } } = {},
): Promise<SteamImportItemOutcome> {
  // ── 1. Match game (appid -> steam-title RPC -> IGDB search) ────────────────
  let gameId: string | null = item.matched_game_id ?? null;
  let matchMethod = item.matched_game_id ? "manual" : "";

  if (!gameId) {
    if (!item.steam_appid && !item.game_title) {
      return { status: "needs_mapping", matched_game_id: null, detail: "no appid or title" };
    }
    const match = await matchSteamReviewGame(db, {
      steam_appid: item.steam_appid ?? 0,
      title: item.game_title ?? "",
    });
    if (match) {
      gameId = match.gameId;
      matchMethod = match.method;
    }
  }

  if (!gameId) {
    return { status: "needs_mapping", matched_game_id: null, detail: "no game match" };
  }

  // ── 2. Skip if this user already has a review for the game ────────────────
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

  // ── 3. Insert as a draft (Steam has no score — user finalizes) ────────────
  const platformId = await resolvePCPlatformId(db, opts.pcPlatformCache);
  const dateIso = item.review_date ? `${item.review_date}T12:00:00Z` : null;
  const playTimeHours =
    item.hours_at_review != null && Number.isFinite(item.hours_at_review)
      ? Math.max(0, Math.round(item.hours_at_review))
      : null;

  const insertRow: Record<string, unknown> = {
    profile_id: profileId,
    game_id: gameId,
    score: null,
    title: null,
    body: item.review_text,
    status: "draft",
    platform_played_on: platformId,
    play_time_hours: playTimeHours,
    contains_spoilers: false,
    published_at: null,
  };
  // Keep the review's original chronology so the drafts list is ordered
  // the way the user posted them on Steam.
  if (dateIso) insertRow.created_at = dateIso;

  const { data: inserted, error } = await db
    .from("reviews")
    .insert(insertRow)
    .select("id")
    .single();

  if (error) {
    return {
      status: "failed",
      matched_game_id: gameId,
      detail: (error as { message?: string }).message ?? "insert failed",
    };
  }

  return {
    status: "drafted",
    matched_game_id: gameId,
    review_id: inserted.id,
    detail: `matched by ${matchMethod}`,
  };
}
