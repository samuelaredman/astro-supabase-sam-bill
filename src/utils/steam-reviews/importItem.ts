// Turn one scraped Steam review (an `import_job_items` row) into a native
// `reviews` row. Steam reviews don't have a score — every imported review
// comes in as a draft so the user assigns a score and publishes it themselves.
//
// Deliberately does NOT go through /api/reviews/create or
// finalizePublishedReview: drafts don't fire notifications anyway, but keeping
// the same direct-insert shape as backloggd/importItem.ts means both flows
// share the "skip if a review already exists" branch and the outcome contract
// consumed by /api/import/*/process.ts and /map.ts.

import { clampImportedDateIso } from "../importJob";
import { matchSteamReviewGame } from "./matchGame";

// Collapse every run of whitespace to a single space and trim. Copy-paste
// between Steam and Chekpoint routinely picks up NBSPs, trailing newlines,
// or a stray double-space — we don't want any of those to make the same
// text register as "different".
function normalizeBodyForCompare(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function isSameReviewBody(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeBodyForCompare(a);
  const nb = normalizeBodyForCompare(b);
  return na.length > 0 && na === nb;
}

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

/**
 * Fetch the full set of appids this user has dismissed once per batch, then
 * serve subsequent lookups from the cache. A user with 100 Steam reviews and
 * 30 dismissals would otherwise do 100 separate table lookups per import —
 * the cache turns that into one SELECT per batch of ~6 items.
 */
export async function loadDismissedAppids(
  db: any,
  profileId: string,
  cache?: { dismissedAppids?: Set<number> },
): Promise<Set<number>> {
  if (cache?.dismissedAppids) return cache.dismissedAppids;
  const { data } = await db
    .from("steam_import_dismissals")
    .select("steam_appid")
    .eq("profile_id", profileId);
  const set = new Set<number>(
    ((data ?? []) as Array<{ steam_appid: number }>).map((r) => r.steam_appid),
  );
  if (cache) cache.dismissedAppids = set;
  return set;
}

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
  opts: {
    pcPlatformCache?: { pcPlatformId?: string | null };
    dismissedAppidsCache?: { dismissedAppids?: Set<number> };
  } = {},
): Promise<SteamImportItemOutcome> {
  // ── 0. Skip if the user has already dismissed this appid ──────────────────
  // Populated when the user clicks "Keep mine" on a draft compare card
  // (see /api/import/steam/dismiss.ts). Detail deliberately has no
  // `conflict:` prefix so status.ts's `.like("detail", "conflict:%")` filter
  // excludes it — the user never sees this appid surface again after they
  // dismissed it, even across re-imports.
  if (item.steam_appid) {
    const dismissed = await loadDismissedAppids(db, profileId, opts.dismissedAppidsCache);
    if (dismissed.has(item.steam_appid)) {
      return { status: "skipped", detail: "dismissed" };
    }
  }

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
  // A user can legitimately have multiple drafts for the same game (the
  // reviews_one_published_per_game unique index is partial — WHERE
  // status='published'). Rank published-over-draft so the surfaced conflict
  // is the one the user most likely cares about, then take a single row —
  // .maybeSingle() would throw the moment there's more than one match.
  const { data: existingRows } = await db
    .from("reviews")
    .select("id, status, body")
    .eq("profile_id", profileId)
    .eq("game_id", gameId)
    .order("status", { ascending: false }) // 'published' > 'draft' lexicographically
    .order("created_at", { ascending: false })
    .limit(1);
  const existing = Array.isArray(existingRows) && existingRows.length > 0
    ? (existingRows[0] as { id: string; status: string | null; body: string | null })
    : null;
  if (existing) {
    // Soft-delete is an implicit dismissal: the user already chose to remove
    // this review from Chekpoint, don't bring it back on the next import. Skip
    // silently (no `conflict:` prefix so status.ts's filter drops it).
    if (existing.status === "deleted") {
      return { status: "skipped", matched_game_id: gameId, detail: "dismissed" };
    }
    // The `conflict:<kind>` detail is machine-readable; the status endpoint
    // parses it to build the "review already exists" UI. review_id points at
    // the EXISTING conflicting review — not a newly-created one — which is
    // the same field the UI already links off of for drafted rows.
    // Users sometimes copy-paste their Steam review verbatim into Chekpoint —
    // treat that as `identical` so we can show it as "already exists, nothing
    // to do" instead of asking the user to reconcile the same text with itself.
    let kind: "identical" | "published" | "draft";
    if (isSameReviewBody(existing.body, item.review_text)) {
      kind = "identical";
    } else if (existing.status === "published") {
      kind = "published";
    } else {
      kind = "draft";
    }
    return {
      status: "skipped",
      matched_game_id: gameId,
      review_id: existing.id,
      detail: `conflict:${kind}`,
    };
  }

  // ── 3. Insert as a draft (Steam has no score — user finalizes) ────────────
  const platformId = await resolvePCPlatformId(db, opts.pcPlatformCache);
  const dateIso = clampImportedDateIso(item.review_date);
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
