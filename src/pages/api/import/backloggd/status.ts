import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";
import { loadActiveJob, loadOwnedJob } from "../../../../utils/backloggd/job";

// GET ?job_id=<id>   -> that job
// GET (no job_id)    -> the caller's most recent unfinished job, if any
// Returns the job row + the items still needing a manual game match.
export const GET: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const jobId = new URL(context.request.url).searchParams.get("job_id");
  const job = jobId
    ? await loadOwnedJob(db, profile.id, jobId)
    : await loadActiveJob(db, profile.id);

  if (!job) return json({ job: null });

  const { data: needsMapping } = await db
    .from("import_job_items")
    .select("id, game_title, game_slug, release_year, source_url")
    .eq("job_id", job.id)
    .eq("status", "needs_mapping")
    .order("game_title", { ascending: true });

  return json({ job, needs_mapping: needsMapping ?? [] });
};
