import { describe, expect, it } from 'vitest';
import { isBotUserAgent, isValidLinkCode, normalizeDestination, suggestLinkCode, withRef } from './trackedLinks';

describe('isValidLinkCode', () => {
  it('accepts lowercase codes with inner dashes', () => {
    expect(isValidLinkCode('furiousduck')).toBe(true);
    expect(isValidLinkCode('pbz-giveaway-2')).toBe(true);
    expect(isValidLinkCode('a')).toBe(true);
  });
  it('rejects uppercase, edge dashes, symbols and over-long codes', () => {
    expect(isValidLinkCode('FuriousDuck')).toBe(false);
    expect(isValidLinkCode('-duck')).toBe(false);
    expect(isValidLinkCode('duck-')).toBe(false);
    expect(isValidLinkCode('duck_1')).toBe(false);
    expect(isValidLinkCode('a'.repeat(41))).toBe(false);
    expect(isValidLinkCode('')).toBe(false);
    expect(isValidLinkCode(null)).toBe(false);
  });
});

describe('suggestLinkCode', () => {
  it('slugifies a label into a valid code', () => {
    expect(suggestLinkCode('FuriousDuck — PBZ Giveaway!')).toBe('furiousduck-pbz-giveaway');
    expect(isValidLinkCode(suggestLinkCode('x'.repeat(60) + ' tail'))).toBe(true);
  });
});

describe('normalizeDestination', () => {
  it('keeps site paths and strips our own domain', () => {
    expect(normalizeDestination('/giveaway')).toBe('/giveaway');
    expect(normalizeDestination('https://chekpoint.gg/groups/abc?tab=games')).toBe('/groups/abc?tab=games');
    expect(normalizeDestination('https://www.chekpoint.gg')).toBe('/');
    expect(normalizeDestination('')).toBe('/');
  });
  it('refuses anything that could leave the site', () => {
    expect(normalizeDestination('https://evil.com/')).toBeNull();
    expect(normalizeDestination('//evil.com')).toBeNull();
    expect(normalizeDestination('/\\evil.com')).toBeNull();
    expect(normalizeDestination('https://chekpoint.gg.evil.com/')).toBeNull();
    expect(normalizeDestination('javascript:alert(1)')).toBeNull();
  });
});

describe('withRef', () => {
  it('adds or replaces ref and keeps the rest of the URL', () => {
    expect(withRef('/giveaway', 'duck')).toBe('/giveaway?ref=duck');
    expect(withRef('/groups/x?tab=games#top', 'duck')).toBe('/groups/x?tab=games&ref=duck#top');
    expect(withRef('/signup?ref=old', 'duck')).toBe('/signup?ref=duck');
  });
});

describe('isBotUserAgent', () => {
  it('flags preview fetchers and empty agents', () => {
    expect(isBotUserAgent('Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)')).toBe(true);
    expect(isBotUserAgent('facebookexternalhit/1.1')).toBe(true);
    expect(isBotUserAgent('Googlebot/2.1')).toBe(true);
    expect(isBotUserAgent('')).toBe(true);
  });
  it('lets ordinary browsers through', () => {
    expect(isBotUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36')).toBe(false);
    expect(isBotUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe(false);
  });
});
