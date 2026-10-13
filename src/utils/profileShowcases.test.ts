import { describe, it, expect } from 'vitest';
import { readShowcaseKeys, readShowcaseOrder } from './profileShowcases';

describe('readShowcaseKeys', () => {
  it('accepts known keys and dedupes', () => {
    expect(readShowcaseKeys([])).toEqual([]);
    expect(readShowcaseKeys(['video', 'games', 'video'])).toEqual(['video', 'games']);
  });

  it('rejects unknown keys and non-arrays', () => {
    expect(readShowcaseKeys(['video', 'bio'])).toBeNull();
    expect(readShowcaseKeys('video')).toBeNull();
    expect(readShowcaseKeys(null)).toBeNull();
    expect(readShowcaseKeys([1])).toBeNull();
  });
});

describe('readShowcaseOrder', () => {
  const DEFAULT = ['favorite_game', 'featured_group', 'video', 'games', 'achievements'];

  it('falls back to the default order', () => {
    expect(readShowcaseOrder([])).toEqual(DEFAULT);
    expect(readShowcaseOrder(null)).toEqual(DEFAULT);
  });

  it('puts saved keys first, then the rest in default order', () => {
    expect(readShowcaseOrder(['games', 'video'])).toEqual(['games', 'video', 'favorite_game', 'featured_group', 'achievements']);
  });

  it('ignores unknown and duplicate keys', () => {
    expect(readShowcaseOrder(['achievements', 'bio', 'achievements', 3])).toEqual(['achievements', 'favorite_game', 'featured_group', 'video', 'games']);
  });
});
