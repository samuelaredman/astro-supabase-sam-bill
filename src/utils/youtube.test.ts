import { describe, it, expect } from 'vitest';
import { parseYouTubeId, readYouTubeField, formatYouTubeDuration, formatViewCount, parseWatchPage } from './youtube';

describe('parseYouTubeId', () => {
  const id = 'dQw4w9WgXcQ';

  it.each([
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&t=42s`,
    `https://m.youtube.com/watch?feature=share&v=${id}`,
    `https://youtu.be/${id}`,
    `https://youtu.be/${id}?si=abc123`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/live/${id}?feature=share`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    `youtube.com/watch?v=${id}`,
    `  https://youtu.be/${id}  `,
    id,
  ])('extracts the id from %s', (input) => {
    expect(parseYouTubeId(input)).toBe(id);
  });

  it.each([
    '',
    '   ',
    'not a url',
    `https://vimeo.com/${id}`,
    `https://evil.com/watch?v=${id}`,
    `https://youtube.com.evil.com/watch?v=${id}`,
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/@somechannel',
    'https://www.youtube.com/playlist?list=PL123',
    `javascript:alert(1)//youtu.be/${id}`,
  ])('rejects %s', (input) => {
    expect(parseYouTubeId(input)).toBeNull();
  });
});

describe('readYouTubeField', () => {
  it('leaves the column alone when the key is absent', () => {
    expect(readYouTubeField({ title: 'x' })).toEqual({ present: false });
  });

  it('clears on empty string or null', () => {
    expect(readYouTubeField({ youtube_url: '' })).toEqual({ present: true, id: null });
    expect(readYouTubeField({ youtube_url: null })).toEqual({ present: true, id: null });
  });

  it('parses a valid link', () => {
    expect(readYouTubeField({ youtube_url: 'https://youtu.be/dQw4w9WgXcQ' }))
      .toEqual({ present: true, id: 'dQw4w9WgXcQ' });
  });

  it('errors on a non-YouTube link', () => {
    expect(readYouTubeField({ youtube_url: 'https://vimeo.com/123' })).toHaveProperty('error');
    expect(readYouTubeField({ youtube_url: 42 })).toHaveProperty('error');
  });
});

describe('formatYouTubeDuration', () => {
  it.each([
    ['PT4M5S', '4:05'],
    ['PT1H2M3S', '1:02:03'],
    ['PT45S', '0:45'],
    ['PT10M', '10:00'],
    ['P1DT2H', '26:00:00'],
  ])('%s → %s', (iso, out) => expect(formatYouTubeDuration(iso)).toBe(out));

  it.each(['P0D', 'PT0S', '', null, 'garbage'])('returns null for %s', (iso) => {
    expect(formatYouTubeDuration(iso as any)).toBeNull();
  });
});

describe('formatViewCount', () => {
  it.each([
    ['1', '1 view'],
    ['999', '999 views'],
    ['1234', '1.2K views'],
    ['56789', '57K views'],
    ['1234567', '1.2M views'],
    ['2500000000', '2.5B views'],
  ])('%s → %s', (raw, out) => expect(formatViewCount(raw)).toBe(out));

  it('returns null for missing values', () => {
    expect(formatViewCount(undefined)).toBeNull();
    expect(formatViewCount('abc')).toBeNull();
  });
});

describe('parseWatchPage', () => {
  // Trimmed from a real watch page.
  const html = `<meta name="description" content="Truncated desc &amp; more...">
    <meta itemprop="duration" content="PT3M34S">
    <meta itemprop="datePublished" content="2009-10-24T23:57:33-07:00">
    <meta itemprop="genre" content="Gaming">
    <script>var ytInitialPlayerResponse = {"videoDetails":{"viewCount":"1821400717","shortDescription":"Full \\"quoted\\" description.\\n\\nSecond line."}};</script>`;

  it('reads description, duration, views, date and category', () => {
    expect(parseWatchPage(html)).toEqual({
      description: 'Full "quoted" description. Second line.',
      duration: '3:34',
      views: '1.8B views',
      published: '2009-10-24T23:57:33-07:00',
      category: 'Gaming',
    });
  });

  it('falls back to the meta description and decodes entities', () => {
    const noJson = html.replace(/<script>.*<\/script>/, '');
    expect(parseWatchPage(noJson)?.description).toBe('Truncated desc & more...');
  });

  it('returns null for a page with no video metadata (consent screen)', () => {
    expect(parseWatchPage('<html><body>Before you continue to YouTube</body></html>')).toBeNull();
  });
});
