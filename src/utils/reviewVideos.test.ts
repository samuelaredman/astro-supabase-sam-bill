import { describe, it, expect } from 'vitest';
import { attachReviewVideos } from './reviewVideos';

// Minimal stand-in for the Supabase query builder: from().select().in().not() → result.
function fakeDb(result: { data?: any[]; error?: any } | (() => never)) {
  const chain: any = {
    from: () => chain,
    select: () => chain,
    in: () => chain,
    not: () => (typeof result === 'function' ? result() : Promise.resolve(result)),
  };
  return chain;
}

describe('attachReviewVideos', () => {
  it('attaches ids to matching rows', async () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    await attachReviewVideos(fakeDb({ data: [{ id: 'b', youtube_video_id: 'dQw4w9WgXcQ' }] }), rows);
    expect(rows).toEqual([{ id: 'a' }, { id: 'b', youtube_video_id: 'dQw4w9WgXcQ' }]);
  });

  it('returns rows untouched when the column does not exist (42703)', async () => {
    const rows = [{ id: 'a', title: 't' }];
    const out = await attachReviewVideos(
      fakeDb({ error: { code: '42703', message: 'column reviews.youtube_video_id does not exist' } }),
      rows,
    );
    expect(out).toEqual([{ id: 'a', title: 't' }]);
  });

  it('returns rows untouched when the lookup throws', async () => {
    const rows = [{ id: 'a' }];
    const out = await attachReviewVideos(fakeDb(() => { throw new Error('network'); }), rows);
    expect(out).toEqual([{ id: 'a' }]);
  });

  it('handles null and empty input', async () => {
    expect(await attachReviewVideos(fakeDb({ data: [] }), null)).toEqual([]);
    expect(await attachReviewVideos(fakeDb({ data: [] }), [])).toEqual([]);
  });
});
