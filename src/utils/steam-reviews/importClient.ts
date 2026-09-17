// Browser-side driver for the Steam review import. Framework-free —
// mirrors src/utils/backloggd/importClient.ts so the /settings and
// (future) onboarding UIs can drive both flows with the same shape.

export type ImportPhase = "scraping" | "importing" | "rate-limited" | "done" | "error";

export type ImportProgress = {
  phase: ImportPhase;
  fraction: number | null;
  message: string;
  counts?: {
    drafted: number;
    skipped: number;
    needs_mapping: number;
    failed: number;
    total: number;
  };
};

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

export async function previewSteamReviews(signal?: AbortSignal) {
  const { res, data } = await postJson("/api/import/steam/preview", {}, signal);
  if (!res.ok) throw new Error(data?.error ?? "Preview failed.");
  return data as { steamId: string; totalReviews: number; totalPages: number; sample: any[] };
}

/** POST /start then run the pipeline to completion. */
export async function startAndDriveSteam(handlers: ImportHandlers) {
  const { res, data } = await postJson("/api/import/steam/start", {}, handlers.signal);
  if (!res.ok) {
    // 409 = a job is already running; resume it instead of erroring.
    if (res.status === 409 && data?.job_id) return driveSteamJob(data.job_id, handlers);
    throw new Error(data?.error ?? "Could not start the import.");
  }
  return driveSteamJob(data.job_id, handlers);
}

/** GET /status with no id — if the user has an unfinished Steam job, resume it. */
export async function resumeActiveSteam(handlers: ImportHandlers) {
  const res = await fetch("/api/import/steam/status", { signal: handlers.signal });
  const data = await res.json().catch(() => ({}));
  if (!data?.job || data.job.status === "complete" || data.job.status === "failed") return null;
  return driveSteamJob(data.job.id, handlers);
}

export async function mapSteamItem(itemId: string, igdbId: number, signal?: AbortSignal) {
  const { res, data } = await postJson(
    "/api/import/steam/map",
    { item_id: itemId, igdb_id: igdbId },
    signal,
  );
  if (!res.ok) throw new Error(data?.error ?? "Could not match that game.");
  return data as { status: string; game: { id: string; title: string; slug: string }; job: any };
}

export async function fetchSteamStatus(jobId: string, signal?: AbortSignal) {
  const res = await fetch(`/api/import/steam/status?job_id=${encodeURIComponent(jobId)}`, {
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? "Could not load import status.");
  return data as { job: any; needs_mapping: any[] };
}

/** Run an existing Steam job through scrape (if needed) then process, until done. */
export async function driveSteamJob(
  jobId: string,
  handlers: ImportHandlers,
): Promise<{ job: any; needs_mapping: any[] }> {
  const { onProgress, signal } = handlers;

  // ── Scrape phase ────────────────────────────────────────────────────────────
  const initial = await fetchSteamStatus(jobId, signal);
  let job = initial.job;
  let fromPage = Math.max(1, (job.scraped_pages ?? 0) + 1);

  while (job.status === "scraping") {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const { res, data } = await postJson(
      "/api/import/steam/scrape",
      { job_id: jobId, from_page: fromPage },
      signal,
    );
    if (res.status === 503) {
      const wait = Math.max(3, Math.min(60, data?.retry_after ?? 10));
      onProgress({
        phase: "rate-limited",
        fraction: job.total_pages ? (fromPage - 1) / job.total_pages : null,
        message: `Steam is rate-limiting us — retrying in ${wait}s…`,
      });
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) throw new Error(data?.error ?? "Scrape failed.");

    onProgress({
      phase: "scraping",
      fraction: data.total_pages ? Math.min(1, (data.next_page ?? data.total_pages) / data.total_pages) : null,
      message: `Reading your Steam reviews… ${data.total_items} found`,
    });

    if (data.done) break;
    fromPage = data.next_page;
  }

  // ── Import phase ────────────────────────────────────────────────────────────
  while (true) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const { res, data } = await postJson("/api/import/steam/process", { job_id: jobId }, signal);
    if (!res.ok) throw new Error(data?.error ?? "Import failed.");

    const counts = {
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
        : `Importing to drafts… ${doneCount} / ${counts.total}`,
      counts,
    });

    if (data.done) break;
    await sleep(150);
  }

  return fetchSteamStatus(jobId, signal);
}
