import { describe, expect, it } from 'vitest';
import { at, post } from '../test/fixtures';
import type { Checkin } from './checkins';
import { metricsSummary } from './metrics';
import { DEFAULT_SETTINGS as S } from './model';

const checkin = (variantId: string, fields: Partial<Checkin>): Checkin => ({
  variantId,
  dayOffset: 7,
  dueAt: at('2026-10-30T19:00:00Z'),
  views: null,
  reach: null,
  likes: null,
  comments: null,
  saves: null,
  shares: null,
  follows: null,
  avgWatchSeconds: null,
  ...fields,
});
const posted = (iso: string, fields: Parameters<typeof post>[0] = {}) =>
  post({
    ...fields,
    variants: (fields.variants ?? [{}]).map((v) => ({ ...v, postedAt: at(iso) })),
  });

describe('get_metrics_summary: monthly metrics', () => {
  it('get_metrics_summary: totals and means per platform and pillar from day-7 check-ins of variants posted in the month', () => {
    const a = posted('2026-10-05T10:00:00Z', { pillar: 'life_style' });
    const b = posted('2026-10-12T10:00:00Z', { pillar: 'student_life' });
    const t = posted('2026-10-12T20:00:00Z', {
      pillar: 'life_style',
      variants: [{ platform: 'tiktok', format: 'video' }],
    });
    const checkins = [
      checkin(a.variants[0].id, { views: 1000, reach: 800, saves: 30 }),
      checkin(b.variants[0].id, { views: 500, reach: 400, saves: 10 }),
      checkin(b.variants[0].id, { dayOffset: 3, views: 99999 }), // not day 7
      checkin(t.variants[0].id, { views: 3000, reach: 2500, saves: 50 }),
    ];
    const summary = metricsSummary([a, b, t], checkins, '2026-10', S);
    expect(summary.byPlatform.instagram).toMatchObject({
      variants: 2,
      totals: { views: 1500, reach: 1200, saves: 40 },
      means: { views: 750, reach: 600, saves: 20 },
    });
    expect(summary.byPlatform.tiktok.totals.views).toBe(3000);
    expect(summary.byPillar.life_style).toMatchObject({
      variants: 2,
      totals: { views: 4000 },
      means: { views: 2000 },
    });
    expect(summary.byPillar.student_life.means.reach).toBe(400);
  });

  it('get_metrics_summary: missing metrics are left out; a metric with no values is null', () => {
    const a = posted('2026-10-05T10:00:00Z');
    const b = posted('2026-10-06T10:00:00Z');
    const summary = metricsSummary(
      [a, b],
      [checkin(a.variants[0].id, { views: 100 }), checkin(b.variants[0].id, { views: null })],
      '2026-10',
      S,
    );
    expect(summary.byPlatform.instagram).toMatchObject({
      variants: 2,
      totals: { views: 100, likes: null },
      means: { views: 100, likes: null },
    });
  });

  it("get_metrics_summary: the month is in the owner's timezone", () => {
    const lastOfOctober = posted('2026-10-31T22:30:00Z'); // 31 Oct 23:30 Algiers
    const firstOfNovember = posted('2026-10-31T23:30:00Z'); // 1 Nov 00:30 Algiers
    const checkins = [lastOfOctober, firstOfNovember].map((p) =>
      checkin(p.variants[0].id, { views: 1 }),
    );
    expect(
      metricsSummary([lastOfOctober, firstOfNovember], checkins, '2026-10', S).byPlatform.instagram
        .variants,
    ).toBe(1);
    expect(
      metricsSummary([lastOfOctober, firstOfNovember], checkins, '2026-11', S).byPlatform.instagram
        .variants,
    ).toBe(1);
  });
});
