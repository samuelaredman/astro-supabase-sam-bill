import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";
import {
  importSteamReviewItem,
  type SteamImportItemInput,
} from "../../../../utils/steam-reviews/importItem";
import { loadOwnedJob, recountJob } from "../../../../utils/importJob";

const BATCH = 6;
// Stop starting new items past this — one item can do an IGDB import when the
// game isn't yet in our DB, so keep headroom under the function limit.
const TIME_BUDGET_MS = 6500;

// POST { job_id } -> process the next batch of pending items, return progress.
// The client calls this in a loop until { done: true }.
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

  const jobId = String(body?.job_id ?? "");
  if (!jobId) return json({ error: "Missing job_id." }, 400);

  const job = await loadOwnedJob(db, profile.id, jobId);
  if (!job) return json({ error: "Import job not found." }, 404);
  if (job.source !== "steam") {
    return json({ error: "This job isn't a Steam import.", status: job.status }, 409);
  }
  if (job.status === "scraping") {
    return json({ error: "Still scraping — call /scrape first.", status: job.status }, 409);
  }
  if (job.status === "complete" || job.status === "failed") {
    return json({ done: true, status: job.status });
  }

  const { data: items } = await db
    .from("import_job_items")
    .select("*")
    .eq("job_id", jobId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(BATCH);

  const started = Date.now();
  const pcPlatformCache: { pcPlatformId?: string | null } = {};
  // One dismissals fetch per batch instead of per item — see loadDismissedAppids.
  const dismissedAppidsCache: { dismissedAppids?: Set<number> } = {};
  let processed = 0;

  for (const item of items ?? []) {
    if (processed > 0 && Date.now() - started > TIME_BUDGET_MS) break;

    let outcome;
    try {
      const input: SteamImportItemInput = {
        id: item.id,
        steam_appid: item.steam_appid,
        game_title: item.game_title ?? "",
        review_text: item.review_text,
        review_date: item.review_date,
        hours_at_review: item.hours_at_review,
        source_url: item.source_url ?? "",
        matched_game_id: item.matched_game_id,
      };
      outcome = await importSteamReviewItem(db, profile.id, input, {
        pcPlatformCache,
        dismissedAppidsCache,
      });
    } catch (e) {
      outcome = { status: "failed" as const, detail: e instanceof Error ? e.message : "error" };
    }

    await db
      .from("import_job_items")
      .update({
        status: outcome.status,
        matched_game_id: outcome.matched_game_id ?? item.matched_game_id ?? null,
        review_id: outcome.review_id ?? null,
        detail: outcome.detail ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);

    processed++;
  }

  const fresh = await recountJob(db, jobId);
  const remaining = fresh ? fresh.total_items - fresh.processed_items : 0;

  return json({
    processed,
    imported: fresh?.imported_count ?? 0,
    drafted: fresh?.draft_count ?? 0,
    skipped: fresh?.skipped_count ?? 0,
    needs_mapping: fresh?.needs_mapping_count ?? 0,
    failed: fresh?.failed_count ?? 0,
    total: fresh?.total_items ?? 0,
    remaining: Math.max(0, remaining),
    done: (fresh?.status ?? "complete") === "complete" || remaining <= 0,
  });
};
