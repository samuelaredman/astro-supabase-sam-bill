// Shared helpers for the api/import/* routes (Backloggd + Steam). The
// import_jobs and import_job_items tables are generic — only the scraper
// per source differs, so the job lifecycle (load, count, resume) is one
// implementation used by both.

/**
 * Turn a scraped review date (YYYY-MM-DD) into an ISO timestamp suitable
 * for created_at / published_at. Anchors at noon UTC (Backloggd and Steam
 * only give us the date, not the time) and clamps at now so a same-day
 * date on a source whose clock is ahead of ours — or noon-UTC being ahead
 * of a viewer's local now — doesn't land in the future. Returns null when
 * the input is empty or unparseable.
 */
export function clampImportedDateIso(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const t = new Date(`${dateStr}T12:00:00Z`).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(Math.min(Date.now(), t)).toISOString();
}

export type ImportJob = {
  id: string;
  profile_id: string;
  source: string;
  /** Backloggd-only — Steam jobs leave this null. */
  backloggd_username: string | null;
  status: string;
  total_pages: number | null;
  scraped_pages: number;
  total_items: number;
  processed_items: number;
  imported_count: number;
  draft_count: number;
  skipped_count: number;
  needs_mapping_count: number;
  failed_count: number;
  error: string | null;
  created_at: string;
};

export async function loadOwnedJob(
  db: any,
  profileId: string,
  jobId: string,
): Promise<ImportJob | null> {
  const { data } = await db
    .from("import_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("profile_id", profileId)
    .maybeSingle();
  return (data as ImportJob) ?? null;
}

/**
 * Force-fail any of this user's import jobs that are still marked
 * scraping/importing but haven't been touched in `thresholdMinutes` minutes.
 *
 * Why this exists: `import_jobs_one_active_per_profile` is a partial unique
 * index on (profile_id) WHERE status IN ('scraping', 'importing'). If a job
 * dies mid-flight (function timeout, tab closed mid-scrape, network drop
 * during the polling loop) it stays in one of those statuses forever, and
 * the user can never start a new import — start.ts always 409s them.
 *
 * The client polls process/scrape in a tight loop (150ms between batches;
 * rate-limit sleeps top out around 60s in importClient.ts). Any gap longer
 * than a few minutes means the driver is dead — 5 minutes is a wide margin
 * that avoids racing an in-flight rate-limit sleep.
 *
 * Best-effort: any error is logged but never thrown. If the reap fails, the
 * caller falls through to `loadActiveJob` and 409s the user the same as
 * before — no regression compared to not having the reaper at all.
 */
export async function reapStaleJobs(
  db: any,
  profileId: string,
  thresholdMinutes = 5,
): Promise<number> {
  try {
    const { data: active } = await db
      .from("import_jobs")
      .select("id, status, created_at, updated_at")
      .eq("profile_id", profileId)
      .in("status", ["scraping", "importing"]);
    if (!active || active.length === 0) return 0;

    const cutoff = Date.now() - thresholdMinutes * 60_000;
    const stale = (active as Array<{
      id: string;
      status: string;
      created_at: string;
      updated_at: string | null;
    }>).filter((j) => {
      // updated_at is null on brand-new jobs that never made it past insert
      // (crashed before the first recountJob call). Fall back to created_at
      // so those get reaped too.
      const lastActivity = j.updated_at ?? j.created_at;
      const t = new Date(lastActivity).getTime();
      return Number.isFinite(t) && t < cutoff;
    });
    if (stale.length === 0) return 0;

    const { error } = await db
      .from("import_jobs")
      .update({
        status: "failed",
        error: `Import timed out — no activity for ${thresholdMinutes}+ minutes.`,
        updated_at: new Date().toISOString(),
      })
      .in("id", stale.map((j) => j.id));
    if (error) {
      console.error("[reapStaleJobs] update error:", JSON.stringify(error));
      return 0;
    }
    return stale.length;
  } catch (e) {
    console.error("[reapStaleJobs] unexpected:", e);
    return 0;
  }
}

/**
 * The caller's most recent unfinished job (any source). The `one active per
 * profile` unique index means at most one row matches — same rule applies
 * across Backloggd and Steam, so a user can't start a Steam import while a
 * Backloggd one is still running (and vice versa).
 */
export async function loadActiveJob(
  db: any,
  profileId: string,
  opts: { source?: string } = {},
): Promise<ImportJob | null> {
  let q = db
    .from("import_jobs")
    .select("*")
    .eq("profile_id", profileId)
    .in("status", ["scraping", "importing"]);
  if (opts.source) q = q.eq("source", opts.source);
  const { data } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as ImportJob) ?? null;
}

async function countItems(db: any, jobId: string, status: string): Promise<number> {
  const { count } = await db
    .from("import_job_items")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .eq("status", status);
  return count ?? 0;
}

/**
 * Recompute a job's counters straight from its items and persist them. Cheap
 * (six head counts) and fully idempotent, so a retried batch never double-counts.
 * Flips the job to 'complete' once nothing is left pending. Returns the fresh row.
 */
export async function recountJob(db: any, jobId: string): Promise<ImportJob | null> {
  const [pending, imported, drafted, skipped, needsMapping, failed] = await Promise.all([
    countItems(db, jobId, "pending"),
    countItems(db, jobId, "imported"),
    countItems(db, jobId, "drafted"),
    countItems(db, jobId, "skipped"),
    countItems(db, jobId, "needs_mapping"),
    countItems(db, jobId, "failed"),
  ]);

  const processed = imported + drafted + skipped + needsMapping + failed;

  const { data: current } = await db
    .from("import_jobs")
    .select("status")
    .eq("id", jobId)
    .maybeSingle();

  const patch: Record<string, unknown> = {
    processed_items: processed,
    imported_count: imported,
    draft_count: drafted,
    skipped_count: skipped,
    needs_mapping_count: needsMapping,
    failed_count: failed,
    updated_at: new Date().toISOString(),
  };
  if (current?.status === "importing" && pending === 0) patch.status = "complete";

  const { data } = await db
    .from("import_jobs")
    .update(patch)
    .eq("id", jobId)
    .select("*")
    .maybeSingle();
  return (data as ImportJob) ?? null;
}
