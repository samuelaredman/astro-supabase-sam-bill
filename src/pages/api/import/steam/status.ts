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

  // Skipped rows written by the current importer carry detail 'conflict:draft',
  // 'conflict:published', or 'conflict:identical' (same body as the existing
  // review — user pasted their Steam text into Chekpoint) and point at the
  // conflicting review via review_id (see importItem.ts). Older 'already has
  // a X review' shapes aren't part of prod data (this is a feature branch) so
  // aren't handled.
  //
  // Bandwidth note: only the 'draft' kind needs both bodies for the side-by-side
  // compare view. 'published' and 'identical' render as a summary row (game
  // title + link to existing review) and don't need any body/title/score/etc.
  // Fetching those heavy fields for every conflict would waste up to ~4KB per
  // item over the wire — at 30 conflicts that's ~120KB the browser never uses.
  // Two-phase fetch keeps the heavy columns pulled only for drafts.
  const { data: skippedRowsLite } = await db
    .from("import_job_items")
    .select("id, matched_game_id, review_id, detail")
    .eq("job_id", job.id)
    .eq("status", "skipped")
    .like("detail", "conflict:%")
    .order("created_at", { ascending: true });

  const conflictItems = (skippedRowsLite ?? []) as Array<{
    id: string;
    matched_game_id: string | null;
    review_id: string | null;
    detail: string | null;
  }>;

  const draftItemIds = conflictItems
    .filter((c) => c.detail === "conflict:draft")
    .map((c) => c.id);

  const gameIds = Array.from(
    new Set(conflictItems.map((c) => c.matched_game_id).filter((v): v is string => !!v)),
  );
  const draftReviewIds = Array.from(
    new Set(
      conflictItems
        .filter((c) => c.detail === "conflict:draft")
        .map((c) => c.review_id)
        .filter((v): v is string => !!v),
    ),
  );
  const summaryReviewIds = Array.from(
    new Set(
      conflictItems
        .filter((c) => c.detail !== "conflict:draft")
        .map((c) => c.review_id)
        .filter((v): v is string => !!v),
    ),
  );

  const [gamesRes, draftItemsRes, draftReviewsRes, summaryReviewsRes] = await Promise.all([
    gameIds.length
      ? db.from("games").select("id, title, slug, cover_img_url").in("id", gameIds)
      : Promise.resolve({ data: [] as any[] }),
    draftItemIds.length
      ? db
          .from("import_job_items")
          .select("id, steam_appid, review_text, review_date, hours_at_review, source_url")
          .in("id", draftItemIds)
      : Promise.resolve({ data: [] as any[] }),
    draftReviewIds.length
      ? db
          .from("reviews")
          .select("id, status, score, title, body, created_at")
          .in("id", draftReviewIds)
      : Promise.resolve({ data: [] as any[] }),
    summaryReviewIds.length
      ? db.from("reviews").select("id").in("id", summaryReviewIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const gameById = new Map<string, any>((gamesRes.data ?? []).map((g: any) => [g.id, g]));
  const draftItemById = new Map<string, any>(
    (draftItemsRes.data ?? []).map((r: any) => [r.id, r]),
  );
  const reviewExistsById = new Set<string>([
    ...(draftReviewsRes.data ?? []).map((r: any) => r.id as string),
    ...(summaryReviewsRes.data ?? []).map((r: any) => r.id as string),
  ]);
  const draftReviewById = new Map<string, any>(
    (draftReviewsRes.data ?? []).map((r: any) => [r.id, r]),
  );

  // If a conflict's review has since been deleted (rare — user cleaned up
  // between import and viewing), fall back to a plain skipped indicator with
  // no compare view. We DON'T flip the item back to drafted automatically:
  // the user would need to re-run the import for that.
  const skipped_conflicts = conflictItems
    .map((c) => {
      const kind: "identical" | "published" | "draft" =
        c.detail === "conflict:identical"
          ? "identical"
          : c.detail === "conflict:published"
            ? "published"
            : "draft";
      const game = c.matched_game_id ? gameById.get(c.matched_game_id) ?? null : null;
      if (!game || !c.review_id || !reviewExistsById.has(c.review_id)) return null;

      if (kind === "draft") {
        const draftItem = draftItemById.get(c.id);
        const draftReview = draftReviewById.get(c.review_id);
        if (!draftItem || !draftReview) return null;
        return {
          item_id: c.id,
          kind,
          steam: {
            appid: draftItem.steam_appid,
            review_text: draftItem.review_text,
            review_date: draftItem.review_date,
            hours_at_review: draftItem.hours_at_review,
            source_url: draftItem.source_url,
          },
          game: {
            id: game.id,
            title: game.title,
            slug: game.slug,
            cover_img_url: game.cover_img_url,
          },
          existing: {
            id: draftReview.id,
            status: draftReview.status,
            score: draftReview.score,
            title: draftReview.title,
            body: draftReview.body,
            created_at: draftReview.created_at,
          },
        };
      }

      // Summary path (identical/published): only what the summary row needs —
      // game title + slug + a link target. Heavy fields deliberately omitted.
      return {
        item_id: c.id,
        kind,
        game: {
          id: game.id,
          title: game.title,
          slug: game.slug,
          cover_img_url: game.cover_img_url,
        },
        existing: {
          id: c.review_id,
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
