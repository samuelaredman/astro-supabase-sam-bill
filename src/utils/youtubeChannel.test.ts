import { describe, it, expect } from 'vitest';
import { parseChannelUrl, parseLatestFromVideosPage } from './youtubeChannel';

describe('parseChannelUrl', () => {
  it('reads each accepted profile link shape', () => {
    expect(parseChannelUrl('https://youtube.com/@handle')).toEqual({ kind: 'handle', value: 'handle' });
    expect(parseChannelUrl('https://www.youtube.com/channel/UCBR8-60-B28hp2BmDPdntcQ/')).toEqual({ kind: 'channel', value: 'UCBR8-60-B28hp2BmDPdntcQ' });
    expect(parseChannelUrl('https://www.youtube.com/c/Name')).toEqual({ kind: 'c', value: 'Name' });
    expect(parseChannelUrl('https://www.youtube.com/user/name')).toEqual({ kind: 'user', value: 'name' });
  });

  it('rejects anything else', () => {
    expect(parseChannelUrl(null)).toBeNull();
    expect(parseChannelUrl('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseChannelUrl('https://evil.com/@handle')).toBeNull();
  });
});

// Trimmed from a real /videos tab: two lockups, newest first.
const lockup = (id: string, title: string) =>
  `"richItemRenderer":{"content":{"lockupViewModel":{"contentImage":{"thumbnailViewModel":{"image":{"sources":[{"url":"https://i.ytimg.com/vi/${id}/hq720.jpg"}]}}},` +
  `"metadata":{"lockupMetadataViewModel":{"title":{"content":"${title}"}}},"contentId":"${id}","contentType":"LOCKUP_CONTENT_TYPE_VIDEO"}}}`;

describe('parseLatestFromVideosPage', () => {
  it('returns the first (newest) video', () => {
    const html = `{"header":{}},${lockup('pRrmQUm6Zvg', 'Turning the YouTube Logo Into a Monster')},${lockup('wGA27zJEnaU', 'Older')}`;
    expect(parseLatestFromVideosPage(html)).toEqual({ id: 'pRrmQUm6Zvg', title: 'Turning the YouTube Logo Into a Monster' });
  });

  it('decodes escaped titles', () => {
    expect(parseLatestFromVideosPage(lockup('pRrmQUm6Zvg', 'Tom \\u0026 Jerry \\"live\\"'))?.title).toBe('Tom & Jerry "live"');
  });

  it('returns null when there are no uploads', () => {
    expect(parseLatestFromVideosPage('<html>no videos</html>')).toBeNull();
  });
});
