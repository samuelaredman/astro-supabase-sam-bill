/**
 * Tracked links — chekpoint.gg/r/<code> (see migration 20261101000000).
 *
 * The link's code rides along as ?ref=<code> from the redirect to /signup
 * (Layout carries it across clicks), and /api/auth/signup records it on the
 * new profile. Nothing is stored on the visitor's device.
 */

/** Same rule as the tracked_links.code CHECK constraint. */
export const LINK_CODE_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function isValidLinkCode(code: unknown): code is string {
  return typeof code === 'string' && LINK_CODE_RE.test(code);
}

/** Turns a label like "FuriousDuck giveaway!" into a code: "furiousduck-giveaway". */
export function suggestLinkCode(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/**
 * A destination must be a path on our own site. Accepts a full chekpoint.gg URL
 * and keeps just its path. Returns null for anything that could leave the site.
 */
export function normalizeDestination(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return '/';
  const full = s.match(/^https?:\/\/(?:www\.)?chekpoint\.gg(\/.*)?$/i);
  if (full) s = full[1] ?? '/';
  if (!s.startsWith('/') || s.startsWith('//') || s.includes('\\')) return null;
  if (/[\s<>"]/.test(s) || s.length > 300) return null;
  return s;
}

/** The destination with ?ref=<code> added (replacing any ref already there). */
export function withRef(destination: string, code: string): string {
  const url = new URL(destination, 'https://chekpoint.gg');
  url.searchParams.set('ref', code);
  return url.pathname + url.search + url.hash;
}

// Link-preview fetchers and crawlers that load a link without a person
// clicking it. Their visits still redirect; they just aren't counted.
const BOT_UA_RE =
  /bot\b|bot\/|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|skype|iframely|vkshare|bitlyurl|headless|lighthouse|curl\/|wget\/|python-requests|go-http-client|okhttp/i;

export function isBotUserAgent(ua: string | null | undefined): boolean {
  return !ua || BOT_UA_RE.test(ua);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

export type LinkFields = {
  label: string;
  destination: string;
  campaign_id: string | null;
  owner_profile_id: string | null;
};

function optionalUuid(v: unknown): string | null | undefined {
  if (v === null || v === undefined || v === '') return null;
  return isUuid(v) ? v : undefined;
}

/**
 * The editable fields of a tracked link, shared by /api/admin/links/(create,
 * update). The code isn't here: it can't change once created, because it's
 * already printed in videos and posts.
 */
export function parseLinkFields(body: any): { value: LinkFields } | { error: string } {
  const label = typeof body?.label === 'string' ? body.label.trim() : '';
  if (!label || label.length > 80) return { error: 'Label is required (max 80 characters).' };

  const destination = normalizeDestination(body?.destination ?? '/');
  if (!destination) return { error: 'Destination must be a page on chekpoint.gg, like /giveaway.' };

  const campaignId = optionalUuid(body?.campaign_id);
  if (campaignId === undefined) return { error: 'Invalid campaign.' };
  const ownerId = optionalUuid(body?.owner_profile_id);
  if (ownerId === undefined) return { error: 'Invalid creator.' };

  return { value: { label, destination, campaign_id: campaignId, owner_profile_id: ownerId } };
}
