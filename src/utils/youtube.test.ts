import { describe, it, expect } from 'vitest';
import { parseYouTubeId, readYouTubeField } from './youtube';

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
