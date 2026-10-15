import { describe, expect, it } from 'vitest';
import { at } from '../test/fixtures';
import { markPosted } from './checkins';
import { DEFAULT_SETTINGS as S, type Variant } from './model';
import type { Platform } from './variants';

const MONDAY_NOON = at('2026-10-19T11:00:00Z');
const variant = (platform: Platform): Variant => ({
  id: `${platform}-1`,
  platform,
  format: platform === 'linkedin' ? 'text' : 'video',
});
const offsets = (platform: Platform, settings = S) =>
  markPosted(variant(platform), MONDAY_NOON, settings).checkins.map((c) => c.dayOffset);

describe('FR-5: marking a variant posted', () => {
  it('FR-5: Instagram and LinkedIn get check-ins at day 3 and 7', () => {
    expect(offsets('instagram')).toEqual([3, 7]);
    expect(offsets('linkedin')).toEqual([3, 7]);
  });

  it('FR-5: TikTok also gets day 14', () => {
    expect(offsets('tiktok')).toEqual([3, 7, 14]);
  });

  it('FR-5: a check-in is due at 20:00 local, offset days after the local posting date', () => {
    const due = (postedAt: string) =>
      markPosted(variant('instagram'), at(postedAt), S).checkins[0].dueAt.toString();
    expect(due('2026-10-19T22:30:00Z')).toBe('2026-10-22T19:00:00Z'); // Mon 23:30 local → Thu 20:00
    expect(due('2026-10-19T23:30:00Z')).toBe('2026-10-23T19:00:00Z'); // Tue 00:30 local → Fri 20:00
  });

  it('FR-5: check-in offsets come from settings', () => {
    const settings = { ...S, checkinOffsets: { ...S.checkinOffsets, instagram: [1, 30] } };
    expect(offsets('instagram', settings)).toEqual([1, 30]);
  });

  it('FR-5: sets postedAt, and the reply timer ends after the reply window', () => {
    const result = markPosted(variant('instagram'), MONDAY_NOON, S);
    expect(result.variant).toEqual({ ...variant('instagram'), postedAt: MONDAY_NOON });
    expect(result.replyEndsAt.toString()).toBe('2026-10-19T11:15:00Z');
    const longer = markPosted(variant('instagram'), MONDAY_NOON, { ...S, replyWindowMinutes: 30 });
    expect(longer.replyEndsAt.toString()).toBe('2026-10-19T11:30:00Z');
  });

  it('FR-5: missing metrics stay null, never zero', () => {
    const [checkin] = markPosted(variant('tiktok'), MONDAY_NOON, S).checkins;
    expect(checkin).toMatchObject({
      variantId: 'tiktok-1',
      views: null,
      reach: null,
      likes: null,
      comments: null,
      saves: null,
      shares: null,
      follows: null,
      avgWatchSeconds: null,
    });
    expect(checkin.doneAt).toBeUndefined();
  });
});
