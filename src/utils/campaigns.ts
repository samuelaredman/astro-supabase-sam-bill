/**
 * Marketing campaigns (migration 20261031000003) — date windows shown on
 * /admin/activity. Shared body parsing for /api/admin/campaigns/(create, update).
 */
export const CAMPAIGN_KINDS = ['giveaway', 'creator', 'ad', 'social', 'other'] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(s: unknown): s is string {
  return typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

export type CampaignFields = {
  name: string;
  kind: string;
  starts_on: string;
  ends_on: string | null;
  notes: string | null;
};

export function parseCampaignFields(body: any): { value: CampaignFields } | { error: string } {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const kind = typeof body?.kind === 'string' ? body.kind : 'other';
  const startsOn = body?.starts_on;
  const endsOn = body?.ends_on || null;
  const notes = typeof body?.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

  if (!name || name.length > 80) return { error: 'Name is required (max 80 characters).' };
  if (!(CAMPAIGN_KINDS as readonly string[]).includes(kind)) return { error: 'Invalid campaign type.' };
  if (!isDate(startsOn)) return { error: 'Start date is required.' };
  if (endsOn !== null && !isDate(endsOn)) return { error: 'Invalid end date.' };
  if (endsOn !== null && endsOn < startsOn) return { error: "End date can't be before the start date." };
  if (notes && notes.length > 500) return { error: 'Notes are limited to 500 characters.' };

  return { value: { name, kind, starts_on: startsOn, ends_on: endsOn, notes } };
}
