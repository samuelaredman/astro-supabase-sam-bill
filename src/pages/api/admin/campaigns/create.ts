export const prerender = false;
import type { APIRoute } from "astro";
import { requireAdmin, json } from "../../../../utils/api";

// Adds a marketing campaign (a date window) to the admin Activity page, which
// shades it on the chart and compares its signups' retention with organic ones.
// Body: { name, kind, starts_on: 'YYYY-MM-DD', ends_on?: 'YYYY-MM-DD' | null, notes? }

const KINDS = ["giveaway", "creator", "ad", "social", "other"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(s: unknown): s is string {
  return typeof s === "string" && DATE_RE.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
}

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAdmin(context);
  if (!auth) return response;
  const { db, profile } = auth;

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const kind = typeof body?.kind === "string" ? body.kind : "other";
  const startsOn = body?.starts_on;
  const endsOn = body?.ends_on || null;
  const notes = typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

  if (!name || name.length > 80) return json({ error: "Name is required (max 80 characters)." }, 400);
  if (!KINDS.includes(kind)) return json({ error: "Invalid campaign type." }, 400);
  if (!validDate(startsOn)) return json({ error: "Start date is required." }, 400);
  if (endsOn !== null && !validDate(endsOn)) return json({ error: "Invalid end date." }, 400);
  if (endsOn !== null && endsOn < startsOn) return json({ error: "End date can't be before the start date." }, 400);
  if (notes && notes.length > 500) return json({ error: "Notes are limited to 500 characters." }, 400);

  const { data, error } = await (db as any)
    .from("marketing_campaigns")
    .insert({ name, kind, starts_on: startsOn, ends_on: endsOn, notes, created_by: profile.id })
    .select("id")
    .single();
  if (error) {
    console.error("[admin/campaigns/create] insert error:", JSON.stringify(error));
    return json({ error: "Could not save the campaign." }, 500);
  }

  return json({ ok: true, id: data.id });
};
