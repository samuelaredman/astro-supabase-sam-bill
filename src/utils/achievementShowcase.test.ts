import { describe, expect, it } from 'vitest';
import { fromPsn, fromSteam, fromXbox, gameKey, mergeShowcaseAchievements } from './achievementShowcase';

const steam = (over: Record<string, any> = {}) => fromSteam({
  steam_appid: 1245620, api_name: 'ACH_1', game_id: null, display_name: 'Elden Lord',
  description: null, icon_url: 's.jpg', global_percent: 12.5, steam_game_title: 'ELDEN RING', games: null, ...over,
});
const psn = (over: Record<string, any> = {}) => fromPsn({
  np_communication_id: 'NPWR123', trophy_group_id: 'default', trophy_id: 3, trophy_type: 'gold', game_id: null,
  name: 'Elden Lord', description: null, icon_url: 'p.png', earned_rate: '4.2', psn_game_title: 'Elden Ring™', games: null, ...over,
});
const xbox = (over: Record<string, any> = {}) => fromXbox({
  xbox_title_id: '999', achievement_id: '7', game_id: null, name: 'Win', description: null,
  icon_url: 'x.png', rarity: 30, xbox_game_title: 'Halo Infinite', games: null, ...over,
});

describe('platform rows', () => {
  it('shapes a PSN trophy, keyed by group and id, with its tier', () => {
    expect(psn()).toMatchObject({ source: 'psn', external_id: 'NPWR123', api_name: 'default:3', trophy_type: 'gold', global_percent: 4.2 });
  });

  it('keeps steam_appid on Steam rows for showcases saved before other platforms', () => {
    expect(steam()).toMatchObject({ source: 'steam', external_id: '1245620', steam_appid: 1245620, api_name: 'ACH_1' });
  });

  it('prefers the linked game title', () => {
    expect(xbox({ games: { title: 'Halo Infinite (2021)' } }).game_title).toBe('Halo Infinite (2021)');
  });

  it('treats a missing rarity as unknown, not zero', () => {
    expect(xbox({ rarity: null }).global_percent).toBeNull();
    expect(psn({ earned_rate: null }).global_percent).toBeNull();
  });
});

describe('gameKey', () => {
  it('matches titles across case and trademark marks', () => {
    expect(gameKey(steam())).toBe(gameKey(psn()));
  });

  it('uses the linked game when there is one', () => {
    expect(gameKey(psn({ game_id: 'g1' }))).toBe('g:g1');
  });
});

describe('mergeShowcaseAchievements', () => {
  it('tags a game unlocked on two platforms, and not a game on one', () => {
    const out = mergeShowcaseAchievements([steam(), psn(), xbox()]);
    const by = (s: string) => out.find((a) => a.source === s)!;
    expect(by('steam').multi_platform).toBe(true);
    expect(by('psn').multi_platform).toBe(true);
    expect(by('xbox').multi_platform).toBe(false);
  });

  it('matches by title when only one platform is linked to the game', () => {
    const out = mergeShowcaseAchievements([steam({ game_id: 'g1', games: { title: 'Elden Ring' } }), psn()]);
    expect(out.every((a) => a.multi_platform)).toBe(true);
  });

  it('matches by linked game even when the titles differ', () => {
    const out = mergeShowcaseAchievements([
      steam({ game_id: 'g1', steam_game_title: 'Something' }),
      xbox({ game_id: 'g1', xbox_game_title: 'Something Else' }),
    ]);
    expect(out.every((a) => a.multi_platform)).toBe(true);
  });

  it('does not tag two achievements from the same platform', () => {
    const out = mergeShowcaseAchievements([steam(), steam({ api_name: 'ACH_2' })]);
    expect(out.some((a) => a.multi_platform)).toBe(false);
  });

  it('sorts rarest first with unknown rarity last, and drops game_id', () => {
    const out = mergeShowcaseAchievements([xbox({ rarity: null }), steam(), psn()]);
    expect(out.map((a) => a.source)).toEqual(['psn', 'steam', 'xbox']);
    expect(out[0]).not.toHaveProperty('game_id');
  });
});
