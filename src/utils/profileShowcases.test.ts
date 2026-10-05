import { describe, it, expect } from 'vitest';
import { readHiddenShowcases } from './profileShowcases';

describe('readHiddenShowcases', () => {
  it('accepts known keys and dedupes', () => {
    expect(readHiddenShowcases([])).toEqual([]);
    expect(readHiddenShowcases(['video', 'games', 'video'])).toEqual(['video', 'games']);
  });

  it('rejects unknown keys and non-arrays', () => {
    expect(readHiddenShowcases(['video', 'bio'])).toBeNull();
    expect(readHiddenShowcases('video')).toBeNull();
    expect(readHiddenShowcases(null)).toBeNull();
    expect(readHiddenShowcases([1])).toBeNull();
  });
});
