import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";
import { loadActiveJob, loadOwnedJob } from "../../../../utils/importJob";

// GET ?job_id=<id>  -> that job (any source)
// GET (no job_id)   -> the caller's most recent unfinished Steam job, if any
// Returns the job row + the items still needing a manual game match + the
// items skipped because they collide with an existing Chekpoint review
// (with both sides' content so the UI can render a compare view).
export const GET: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const jobId = new URL(context.request.url).searchParams.get("job_id");
  const job = jobId
    ? await loadOwnedJob(db, profile.id, jobId)
    : await loadActiveJob(db, profile.id, { source: "steam" });

  if (!job) return json({ job: null });

  const { data: needsMapping } = await db
    .from("import_job_items")
    .select("id, game_title, steam_appid, source_url")
    .eq("job_id", job.id)
    .eq("status", "needs_mapping")
    .order("game_title", { ascending: true });

  // Skipped rows written by the current importer carry detail 'conflict:draft'
  // or 'conflict:published' and point at the conflicting review via
  // review_id (see importItem.ts). Older 'already has a X review' shapes
  // aren't part of prod data (this is a feature branch) so aren't handled.
  const { data: skippedRows } = await db
    .from("import_job_items")
    .select(
      "id, matched_game_id, review_id, detail, game_title, steam_appid, review_text, review_date, hours_at_review, source_url",
    )
    .eq("job_id", job.id)
    .eq("status", "skipped")
    .like("detail", "conflict:%")
    .order("created_at", { ascending: true });

  const conflictItems = (skippedRows ?? []) as Array<{
    id: string;
    matched_game_id: string | null;
    review_id: string | null;
    detail: string | null;
    game_title: string | null;
    steam_appid: number | null;
    review_text: string;
    review_date: string | null;
    hours_at_review: number | null;
    source_url: string | null;
  }>;

  const gameIds = Array.from(
    new Set(conflictItems.map((c) => c.matched_game_id).filter((v): v is string => !!v)),
  );
  const reviewIds = Array.from(
    new Set(conflictItems.map((c) => c.review_id).filter((v): v is string => !!v)),
  );

  const [gamesRes, reviewsRes] = await Promise.all([
    gameIds.length
      ? db.from("games").select("id, title, slug, cover_img_url").in("id", gameIds)
      : Promise.resolve({ data: [] as any[] }),
    reviewIds.length
      ? db
          .from("reviews")
          .select("id, status, score, title, body, published_at, created_at")
          .in("id", reviewIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const gameById = new Map<string, any>((gamesRes.data ?? []).map((g: any) => [g.id, g]));
  const reviewById = new Map<string, any>(
    (reviewsRes.data ?? []).map((r: any) => [r.id, r]),
  );

  // If a conflict's review has since been deleted (rare — user cleaned up
  // between import and viewing), fall back to a plain skipped indicator with
  // no compare view. We DON'T flip the item back to drafted automatically:
  // the user would need to re-run the import for that.
  const skipped_conflicts = conflictItems
    .map((c) => {
      const kind =
        c.detail === "conflict:published" ? "published" : "draft";
      const game = c.matched_game_id ? gameById.get(c.matched_game_id) ?? null : null;
      const existing = c.review_id ? reviewById.get(c.review_id) ?? null : null;
      if (!game || !existing) return null;
      return {
        item_id: c.id,
        kind,
        steam: {
          appid: c.steam_appid,
          review_text: c.review_text,
          review_date: c.review_date,
          hours_at_review: c.hours_at_review,
          source_url: c.source_url,
        },
        game: {
          id: game.id,
          title: game.title,
          slug: game.slug,
          cover_img_url: game.cover_img_url,
        },
        existing: {
          id: existing.id,
          status: existing.status,
          score: existing.score,
          title: existing.title,
          body: existing.body,
          published_at: existing.published_at,
          created_at: existing.created_at,
        },
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  return json({
    job,
    needs_mapping: needsMapping ?? [],
    skipped_conflicts,
  });
};
