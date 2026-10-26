import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";
import { coerceHltbRow, mapHltbStatus, minutesToHours, reviewStatusFor } from "../../../../utils/hltb/parse";
import { matchOrImportGame } from "../../../../utils/backloggd/matchGame";
import { finalizePublishedReview } from "../../../../utils/reviewPublish";

// POST { rows: HltbRow[], cursor?: number }
// Applies an uploaded HowLongToBeat library export. Every row produces at most
// one user_game_status row (library + playtime) and, when the entry has a
// score, one reviews row — draft if the user only rated it, published if they
// also wrote a note.
//
// Chunked (modelled on /api/import/backloggd/library) because each row can
// trigger an IGDB import for a game we don't have yet. The client POSTs with
// an advancing `cursor` until { done: true }.
//
// Never overwrites existing data: a row is skipped silently if the user
// already has a status on that game OR already has any review (draft or
// published) on it.

const MAX_ROWS = 5000;
const COOLDOWN_MS = 60_000;
const COUNT_LIMIT = 30; // rows processed per call
const IGDB_LIMIT = 10;  // IGDB game imports per call (rate-limit guard)
const TIME_BUDGET_MS = 8000;
const IGDB_GAP_MS = 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type HltbIncomingRow = ReturnType<typeof coerceHltbRow>;

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const raw = Array.isArray(body?.rows) ? body.rows : Array.isArray(body) ? body : null;
  if (!raw) return json({ error: "The file doesn't contain an HLTB export." }, 400);
  if (raw.length === 0) return json({ error: "No games found in that file." }, 400);
  if (raw.length > MAX_ROWS) return json({ error: `That's more than ${MAX_ROWS} games — please contact us.` }, 400);

  const cursor = Math.max(0, parseInt(String(body?.cursor ?? "0"), 10) || 0);

  // ── Normalise + dedupe by (hltb_id || title) so cursor is stable across calls ──
  const seenKey = new Set<string>();
  const rows: NonNullable<HltbIncomingRow>[] = [];
  for (const r of raw) {
    const row = coerceHltbRow(r);
    if (!row) continue;
    const key = (row.hltb_id || row.game_title).toLowerCase();
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    rows.push(row);
  }
  if (rows.length === 0) return json({ error: "None of the rows in that file were valid." }, 400);

  // ── Cooldown — only on the first chunk ──
  if (cursor === 0) {
    const { data: me } = await db
      .from("profiles")
      .select("hltb_synced_at")
      .eq("id", profile.id)
      .maybeSingle();
    if (me?.hltb_synced_at) {
      const elapsed = Date.now() - new Date(me.hltb_synced_at).getTime();
      if (elapsed < COOLDOWN_MS) {
        return json(
          { error: "You just synced — try again in a minute.", retry_after: Math.ceil((COOLDOWN_MS - elapsed) / 1000) },
          429,
        );
      }
    }
  }

  // ── Process a bounded slice ──
  const started = Date.now();
  const unmatchedSample: string[] = [];
  // Two HLTB rows that resolve to the same Chekpoint game (e.g. the same
  // game sitting on multiple HLTB shelves, or an alt-name entry) must not
  // both insert a review — the second would race against the first on the
  // reviews_one_published_per_game constraint. Mirror the Backloggd library
  // importer's per-chunk `seenGame` guard.
  const seenGame = new Set<string>();
  let processed = 0;
  let appliedStatus = 0;
  let appliedPublished = 0;
  let appliedDraft = 0;
  let alreadyStatus = 0;
  let alreadyReview = 0;
  let unmatched = 0;
  let importedFromIgdb = 0;
  let igdbCalls = 0;
  let i = cursor;

  for (; i < rows.length; i++) {
    if (
      processed > 0 &&
      (processed >= COUNT_LIMIT || igdbCalls >= IGDB_LIMIT || Date.now() - started > TIME_BUDGET_MS)
    ) {
      break;
    }
    const row = rows[i];
    processed++;

    // Derive a slug from the title so matchOrImportGame can take its slug
    // fast-paths; otherwise it falls to IGDB title+year search.
    const derivedSlug = row.game_title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

    let match;
    try {
      match = await matchOrImportGame(db, {
        slug: derivedSlug,
        title: row.game_title,
        year: row.release_year,
      });
    } catch (e) {
      console.error("[import/hltb/library] match error:", e instanceof Error ? e.message : e);
      match = null;
    }

    if (match?.imported) {
      importedFromIgdb++;
      igdbCalls++;
      await sleep(IGDB_GAP_MS);
    } else if (!match) {
      igdbCalls++;
    }

    if (!match) {
      unmatched++;
      if (unmatchedSample.length < 15) unmatchedSample.push(row.game_title);
      continue;
    }

    // Resolve to canonical so library + review land on the main game, not a
    // collapsed edition.
    const { data: canon } = await db
      .from("games")
      .select("canonical_game_id")
      .eq("id", match.gameId)
      .maybeSingle();
    const gameId = (canon?.canonical_game_id as string | null) ?? match.gameId;

    if (seenGame.has(gameId)) continue;
    seenGame.add(gameId);

    // ── Library status + playtime ──
    const chekpointStatus = mapHltbStatus(row.hltb_status);
    if (chekpointStatus) {
      const { data: existing } = await db
        .from("user_game_status")
        .select("game_id")
        .eq("profile_id", profile.id)
        .eq("game_id", gameId)
        .maybeSingle();
      if (existing) {
        alreadyStatus++;
      } else {
        const insertRow: {
          profile_id: string;
          game_id: string;
          status: string;
          updated_at: string;
          hltb_playtime_minutes?: number | null;
        } = {
          profile_id: profile.id,
          game_id: gameId,
          status: chekpointStatus,
          updated_at: new Date().toISOString(),
        };
        if (row.minutes_played != null) insertRow.hltb_playtime_minutes = row.minutes_played;
        const { error } = await db
          .from("user_game_status")
          .upsert(insertRow, { onConflict: "profile_id,game_id", ignoreDuplicates: true });
        if (error) {
          console.error("[import/hltb/library] status upsert error:", JSON.stringify(error));
        } else {
          appliedStatus++;
        }
      }
    }

    // ── Review (score required) ──
    if (row.score != null) {
      // Skip if the user already has ANY review for this game — mirrors how
      // the Backloggd review import avoids clobbering what the user wrote
      // here. Drafts count too, so a half-written Chekpoint review doesn't
      // get buried under an HLTB-sourced duplicate.
      const { data: existingReview } = await db
        .from("reviews")
        .select("id")
        .eq("profile_id", profile.id)
        .eq("game_id", gameId)
        .maybeSingle();
      if (existingReview) {
        alreadyReview++;
      } else {
        const reviewStatus = reviewStatusFor(row);
        const nowIso = new Date().toISOString();
        const insert: {
          profile_id: string;
          game_id: string;
          score: number;
          body: string;
          status: string;
          contains_spoilers: boolean;
          published_at?: string;
          play_time_hours?: number;
        } = {
          profile_id: profile.id,
          game_id: gameId,
          score: row.score,
          body: row.review_text ?? "",
          status: reviewStatus,
          contains_spoilers: row.contains_spoilers,
        };
        if (reviewStatus === "published") {
          insert.published_at = row.review_date ? `${row.review_date}T00:00:00Z` : nowIso;
        }
        const hours = minutesToHours(row.minutes_played);
        if (hours != null) insert.play_time_hours = hours;

        const { data: inserted, error: revErr } = await db
          .from("reviews")
          .insert(insert)
          .select("id")
          .maybeSingle();
        if (revErr) {
          console.error("[import/hltb/library] review insert error:", JSON.stringify(revErr));
        } else if (inserted) {
          if (reviewStatus === "published") {
            appliedPublished++;
            // Non-blocking — notifications/library auto-track for the public post.
            try {
              await finalizePublishedReview(db, {
                reviewId: inserted.id,
                gameId,
                profileId: profile.id,
                score: row.score,
              });
            } catch (e) {
              console.error("[import/hltb/library] finalize error (non-fatal):", e);
            }
          } else {
            appliedDraft++;
          }
        }
      }
    }
  }

  const nextCursor = i;
  const done = nextCursor >= rows.length;
  if (done) {
    await db.from("profiles").update({ hltb_synced_at: new Date().toISOString() }).eq("id", profile.id);
  }

  return json({
    processed,
    applied_status: appliedStatus,
    applied_published: appliedPublished,
    applied_draft: appliedDraft,
    already_status: alreadyStatus,
    already_review: alreadyReview,
    unmatched,
    imported_from_igdb: importedFromIgdb,
    unmatched_sample: unmatchedSample,
    next_cursor: done ? null : nextCursor,
    total: rows.length,
    done,
  });
};
