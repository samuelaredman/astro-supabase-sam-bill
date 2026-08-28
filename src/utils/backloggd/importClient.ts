// Browser-side driver for the Backloggd import. Used by the /settings section
// and the onboarding wizard step. Framework-free: give it callbacks, it POSTs
// through the scrape -> process pipeline and reports progress.

export type ImportPhase = "scraping" | "importing" | "rate-limited" | "done" | "error";

export type ImportProgress = {
  phase: ImportPhase;
  /** 0–1 for the current phase, when known. */
  fraction: number | null;
  message: string;
  counts?: {
    imported: number;
    drafted: number;
    skipped: number;
    needs_mapping: number;
    failed: number;
    total: number;
  };
};

export type StartBody = { username: string } | { rows: unknown[] };

export type ImportHandlers = {
  onProgress: (p: ImportProgress) => void;
  signal?: AbortSignal;
};

async function postJson(url: string, body: unknown, signal?: AbortSignal) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  return { res, data } as { res: Response; data: any };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST /preview — used by the UI to confirm before starting. */
export async function previewBackloggd(username: string, signal?: AbortSignal) {
  const { res, data } = await postJson("/api/import/backloggd/preview", { username }, signal);
  if (!res.ok) throw new Error(data?.error ?? "Preview failed.");
  return data as { username: string; totalReviews: number; totalPages: number; sample: any[] };
}

/** POST /start then run the pipeline to completion. Returns the final job status payload. */
export async function startAndDrive(start: StartBody, handlers: ImportHandlers) {
  const { res, data } = await postJson("/api/import/backloggd/start", start, handlers.signal);
  if (!res.ok) {
    // 409 = a job is already running; resume it instead of erroring.
    if (res.status === 409 && data?.job_id) return driveJob(data.job_id, handlers);
    throw new Error(data?.error ?? "Could not start the import.");
  }
  return driveJob(data.job_id, handlers);
}

export type LibraryTotals = {
  applied: number;
  already: number;
  unmatched: number;
  imported: number;
  unmatchedSample: string[];
};

/**
 * Drive the (cursor-chunked) library import for an uploaded rows array to
 * completion. Shared by the settings page and the onboarding wizard.
 */
export async function importLibraryFile(
  rows: unknown[],
  handlers: ImportHandlers,
): Promise<LibraryTotals> {
  const { onProgress, signal } = handlers;
  const totals: LibraryTotals = { applied: 0, already: 0, unmatched: 0, imported: 0, unmatchedSample: [] };
  let cursor: number | null = 0;

  while (cursor != null) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const { res, data } = await postJson("/api/import/backloggd/library", { rows, cursor }, signal);
    if (!res.ok) {
      if (res.status === 429 && data?.retry_after) {
        onProgress({
          phase: "rate-limited",
          fraction: null,
          message: `Rate-limited — retrying in ${data.retry_after}s…`,
        });
        await sleep((data.retry_after + 1) * 1000);
        continue;
      }
      throw new Error(data?.error ?? "Library import failed.");
    }

    totals.applied += data.applied ?? 0;
    totals.already += data.already ?? 0;
    totals.unmatched += data.unmatched ?? 0;
    totals.imported += data.imported_from_igdb ?? 0;
    for (const t of data.unmatched_sample ?? []) {
      if (totals.unmatchedSample.length < 12) totals.unmatchedSample.push(t);
    }

    const doneCount = data.done ? data.total : data.next_cursor;
    onProgress({
      phase: data.done ? "done" : "importing",
      fraction: data.total ? doneCount / data.total : null,
      message: data.done ? "Library import complete" : `Matching games… ${doneCount} / ${data.total}`,
    });
    cursor = data.done ? null : data.next_cursor;
  }

  return totals;
}

/** GET /status with no id — if the user has an unfinished job, resume it. */
export async function resumeActive(handlers: ImportHandlers) {
  const res = await fetch("/api/import/backloggd/status", { signal: handlers.signal });
  const data = await res.json().catch(() => ({}));
  if (!data?.job || data.job.status === "complete" || data.job.status === "failed") return null;
  return driveJob(data.job.id, handlers);
}

export async function mapItem(itemId: string, igdbId: number, signal?: AbortSignal) {
  const { res, data } = await postJson(
    "/api/import/backloggd/map",
    { item_id: itemId, igdb_id: igdbId },
    signal,
  );
  if (!res.ok) throw new Error(data?.error ?? "Could not match that game.");
  return data as { status: string; game: { id: string; title: string; slug: string }; job: any };
}

export async function fetchStatus(jobId: string, signal?: AbortSignal) {
  const res = await fetch(`/api/import/backloggd/status?job_id=${encodeURIComponent(jobId)}`, {
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? "Could not load import status.");
  return data as { job: any; needs_mapping: any[] };
}

/** Run an existing job through scrape (if needed) then process, until done. */
export async function driveJob(jobId: string, handlers: ImportHandlers): Promise<{ job: any; needs_mapping: any[] }> {
  const { onProgress, signal } = handlers;

  // ── Scrape phase ────────────────────────────────────────────────────────────
  const initial = await fetchStatus(jobId, signal);
  let job = initial.job;
  // Resume where a previous run left off rather than re-fetching from page 1.
  let fromPage = Math.max(1, (job.scraped_pages ?? 0) + 1);

  while (job.status === "scraping") {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const { res, data } = await postJson(
      "/api/import/backloggd/scrape",
      { job_id: jobId, from_page: fromPage },
      signal,
    );
    if (res.status === 503) {
      const wait = Math.max(3, Math.min(60, data?.retry_after ?? 10));
      onProgress({
        phase: "rate-limited",
        fraction: job.total_pages ? (fromPage - 1) / job.total_pages : null,
        message: `Backloggd is rate-limiting us — retrying in ${wait}s…`,
      });
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) throw new Error(data?.error ?? "Scrape failed.");

    onProgress({
      phase: "scraping",
      fraction: data.total_pages ? Math.min(1, (data.next_page ?? data.total_pages) / data.total_pages) : null,
      message: `Reading your Backloggd reviews… ${data.total_items} found`,
    });

    if (data.done) break;
    fromPage = data.next_page;
  }

  // ── Import phase ────────────────────────────────────────────────────────────
  while (true) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const { res, data } = await postJson("/api/import/backloggd/process", { job_id: jobId }, signal);
    if (!res.ok) throw new Error(data?.error ?? "Import failed.");

    const counts = {
      imported: data.imported ?? 0,
      drafted: data.drafted ?? 0,
      skipped: data.skipped ?? 0,
      needs_mapping: data.needs_mapping ?? 0,
      failed: data.failed ?? 0,
      total: data.total ?? 0,
    };
    const doneCount = counts.total - (data.remaining ?? 0);
    onProgress({
      phase: data.done ? "done" : "importing",
      fraction: counts.total ? doneCount / counts.total : null,
      message: data.done
        ? "Import complete"
        : `Importing reviews… ${doneCount} / ${counts.total}`,
      counts,
    });

    if (data.done) break;
    // Tiny gap so we're not hammering; the server also self-throttles on IGDB.
    await sleep(150);
  }

  return fetchStatus(jobId, signal);
}
