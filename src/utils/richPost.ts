// Rendering helpers for forum-style posts (Updates, group announcements) that
// may be stored as Tiptap HTML or as legacy plain text. Keep in sync with the
// shared composer in src/components/forum/PostComposer.astro.

import { IMAGE_EMOTE_MAP } from './reactions';

export function isHtmlPost(body: string): boolean {
  return /<(p|h[1-6]|ul|ol|li|img|figure|blockquote|iframe|div)[\s>/]/i.test(body);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderLegacy(body: string): string {
  const escaped = escapeHtml(body);
  const withMentions = escaped.replace(/(^|\s)(@([\w]+))/g, '$1<a class="mention" href="/reviewers/$3">$2</a>');
  return withMentions
    .replace(/:([A-Za-z0-9_]+):/g, (_m, key) => {
      const path = IMAGE_EMOTE_MAP[key];
      return path ? `<img src="${path}" class="comment-emote" alt=":${key}:" title=":${key}:">` : `:${key}:`;
    })
    .replace(/\n/g, '<br>');
}

/** Render a forum post body for display. HTML passes through; plain text is escaped and line-broken. */
export function renderPostBody(body: string): string {
  if (!body) return '';
  return isHtmlPost(body) ? body : renderLegacy(body);
}

/** Short plain-text excerpt — strips tags, collapses whitespace, trims at a word boundary. */
export function postExcerpt(body: string, max = 220): string {
  const clean = (body ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : clean.slice(0, max).replace(/\s+\S*$/, '') + '…';
}
