import { describe, expect, it } from 'vitest';
import { at, post } from '../test/fixtures';
import type { Checkin } from './checkins';
import { DEFAULT_SETTINGS as S, type Pillar, type Post } from './model';
import { evaluateTriggers, type TriggerData, type TriggerRecord } from './triggers';
import type { Platform } from './variants';

const FORMAT = { instagram: 'reel', tiktok: 'video', linkedin: 'text' } as const;

/** A posted variant with one check-in carrying the given metrics. */
function posted(
  day: string,
  metrics: Partial<Checkin> = {},
  { platform = 'instagram', pillar = 'life_style' }: { platform?: Platform; pillar?: Pillar } = {},
) {
  const p = post({
    pillar,
    goLiveAt: at(`${day}T10:00:00Z`),
    variants: [{ platform, format: FORMAT[platform], postedAt: at(`${day}T10:00:00Z`) }],
  });
  const checkin: Checkin = {
    variantId: p.variants[0].id,
    dayOffset: 7,
    dueAt: at(`${day}T19:00:00Z`).add({ hours: 7 * 24 }),
    doneAt: at(`${day}T19:00:00Z`).add({ hours: 7 * 24 }),
    views: null,
    reach: null,
    likes: null,
    comments: null,
    saves: null,
    shares: null,
    follows: null,
    avgWatchSeconds: null,
    ...metrics,
  };
  return { post: p, checkin };
}

type Posted = ReturnType<typeof posted>;
const evaluate = (
  entries: Posted[],
  now: string,
  triggers: TriggerRecord[] = [],
  extra: Post[] = [],
) => {
  const data: TriggerData = {
    posts: [...entries.map((e) => e.post), ...extra],
    checkins: entries.map((e) => e.checkin),
    triggers,
  };
  return evaluateTriggers(data, S, at(now));
};
const rule = (fired: ReturnType<typeof evaluate>, id: string) => fired.filter((t) => t.rule === id);

// Sat 7 Nov 08:00 Algiers: weeks ending by Sat 31 Oct 00:00 have their day-7 check-ins due.
const T1_NOW = '2026-11-07T07:00:00Z';
const MONDAYS = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'];
const weeklyReach = (reach: (number | null)[], platform: Platform = 'instagram') =>
  MONDAYS.flatMap((day, i) =>
    reach[i] === undefined ? [] : [posted(day, { reach: reach[i] }, { platform })],
  );

describe('T1: weekly reach falls 3 weeks in a row', () => {
  it('T1: fires when weekly reach falls 3 weeks in a row', () => {
    const dayThree = posted('2026-10-26', { reach: 999, dayOffset: 3 });
    const tiktokRising = weeklyReach([10, 20, 30, 40], 'tiktok');
    expect(
      rule(evaluate([...weeklyReach([100, 90, 80, 70]), dayThree, ...tiktokRising], T1_NOW), 'T1'),
    ).toEqual([
      {
        rule: 'T1',
        platform: 'instagram',
        params: {
          weeks: ['2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24'],
          reach: [100, 90, 80, 70],
        },
      },
    ]);
  });

  it('T1: needs exactly 4 weeks of data; 3 does not fire', () => {
    expect(rule(evaluate(weeklyReach([100, 90, 80, 70]).slice(1), T1_NOW), 'T1')).toEqual([]);
  });

  it('T1: no fire when any week holds or rises', () => {
    expect(rule(evaluate(weeklyReach([100, 90, 90, 80]), T1_NOW), 'T1')).toEqual([]);
  });

  it("T1: ignores weeks whose day-7 check-ins aren't due yet", () => {
    // Falling 100 → 70 only if the week of 31 Oct (day-7 check-ins not due until 9 Nov) counted.
    const shifted = [100, 90, 80].map((reach, i) => posted(MONDAYS[i + 1], { reach }));
    const tooRecent = posted('2026-11-02', { reach: 70 });
    expect(rule(evaluate([...shifted, tooRecent], T1_NOW), 'T1')).toEqual([]);
  });

  it('T1: null reach is missing, not zero', () => {
    const nullInFalling = posted('2026-10-26', { reach: null });
    expect(
      rule(evaluate([...weeklyReach([100, 90, 80, 70]), nullInFalling], T1_NOW), 'T1'),
    ).toHaveLength(1);
    expect(rule(evaluate(weeklyReach([100, 90, 80, null]), T1_NOW), 'T1')).toEqual([]);
  });
});

// Sat 24 Oct 08:00 Algiers: the finished weeks are those starting 3, 10 and 17 Oct.
const NOW = '2026-10-24T07:00:00Z';
const week = (monday: string, done: number, notDone: number): Post[] => [
  ...Array.from({ length: done }, () => posted(monday).post),
  ...Array.from({ length: notDone }, () => post({ goLiveAt: at(`${monday}T10:00:00Z`) })),
];

describe('T2: completion under 75% two planning weeks in a row', () => {
  it('T2: fires under 75% for 2 planning weeks in a row', () => {
    const extra = [...week('2026-10-12', 1, 1), ...week('2026-10-19', 2, 1)];
    expect(rule(evaluate([], NOW, [], extra), 'T2')).toEqual([
      {
        rule: 'T2',
        platform: null,
        params: { weeks: ['2026-10-10', '2026-10-17'], rates: [0.5, 2 / 3] },
      },
    ]);
  });

  it('T2: no fire when one week is exactly 75%', () => {
    const extra = [...week('2026-10-12', 1, 1), ...week('2026-10-19', 3, 1)];
    expect(rule(evaluate([], NOW, [], extra), 'T2')).toEqual([]);
  });

  it('T2: skips weeks with nothing planned', () => {
    const extra = [...week('2026-10-05', 1, 1), ...week('2026-10-19', 1, 1)];
    expect(rule(evaluate([], NOW, [], extra), 'T2')[0]?.params).toEqual({
      weeks: ['2026-10-03', '2026-10-17'],
      rates: [0.5, 0.5],
    });
  });

  it('T2: the current week is not finished and does not count', () => {
    const extra = [
      ...week('2026-10-12', 1, 1),
      ...week('2026-10-19', 1, 0),
      ...week('2026-10-26', 0, 2),
    ];
    expect(rule(evaluate([], NOW, [], extra), 'T2')).toEqual([]);
  });
});

describe('T3: one pillar outperforms every other 2x over 28 days', () => {
  const pillarPosts = (pillar: Pillar, ...values: number[]) =>
    values.map((v, i) => posted(`2026-10-${10 + i}`, { shares: v / 2, saves: v / 2 }, { pillar }));

  it("T3: fires when one pillar's mean sends + saves is 2x every other", () => {
    const entries = [
      ...pillarPosts('life_style', 20, 20),
      ...pillarPosts('student_life', 10, 10),
      ...pillarPosts('pov_journey', 6, 10),
    ];
    expect(rule(evaluate(entries, NOW), 'T3')).toEqual([
      {
        rule: 'T3',
        platform: null,
        params: {
          pillar: 'life_style',
          means: { life_style: 20, student_life: 10, pov_journey: 8 },
        },
      },
    ]);
  });

  it('T3: no fire at 1.9x, or when every mean is zero', () => {
    expect(
      rule(
        evaluate(
          [...pillarPosts('life_style', 19, 19), ...pillarPosts('student_life', 10, 10)],
          NOW,
        ),
        'T3',
      ),
    ).toEqual([]);
    expect(
      rule(
        evaluate([...pillarPosts('life_style', 0, 0), ...pillarPosts('student_life', 0, 0)], NOW),
        'T3',
      ),
    ).toEqual([]);
  });

  it('T3: pillars with fewer than 2 variants are left out', () => {
    const lonely = pillarPosts('student_life', 15);
    expect(
      rule(
        evaluate(
          [...pillarPosts('life_style', 20, 20), ...lonely, ...pillarPosts('pov_journey', 10, 10)],
          NOW,
        ),
        'T3',
      ),
    ).toHaveLength(1);
    expect(rule(evaluate([...pillarPosts('life_style', 20, 20), ...lonely], NOW), 'T3')).toEqual(
      [],
    );
  });

  it('T3: ignores LinkedIn, check-ins other than day 7, null metrics and posts older than 28 days', () => {
    const noise = [
      posted(
        '2026-10-12',
        { shares: 500, saves: 500 },
        { platform: 'linkedin', pillar: 'work_lessons' },
      ),
      posted(
        '2026-10-13',
        { shares: 500, saves: 500 },
        { platform: 'linkedin', pillar: 'work_lessons' },
      ),
      posted('2026-10-14', { shares: 500, saves: 500, dayOffset: 3 }, { pillar: 'student_life' }),
      posted('2026-10-15', { shares: null, saves: 500 }, { pillar: 'student_life' }),
      posted('2026-09-20', { shares: 500, saves: 500 }, { pillar: 'student_life' }),
    ];
    const entries = [
      ...pillarPosts('life_style', 20, 20),
      ...pillarPosts('student_life', 10, 10),
      ...noise,
    ];
    expect(rule(evaluate(entries, NOW), 'T3')[0]?.params).toEqual({
      pillar: 'life_style',
      means: { life_style: 20, student_life: 10 },
    });
  });
});

describe('T1, T2, T3: one unresolved trigger per rule and platform', () => {
  it('T1, T2, T3: do not fire again while one is unresolved for that rule and platform', () => {
    const falling = weeklyReach([100, 90, 80, 70]);
    const open = (r: TriggerRecord['rule'], platform: Platform | null): TriggerRecord => ({
      rule: r,
      platform,
    });
    expect(rule(evaluate(falling, T1_NOW, [open('T1', 'instagram')]), 'T1')).toEqual([]);
    expect(rule(evaluate(falling, T1_NOW, [open('T1', 'tiktok')]), 'T1')).toHaveLength(1);
    const resolved = { ...open('T1', 'instagram'), resolvedAt: at('2026-11-01T10:00:00Z') };
    expect(rule(evaluate(falling, T1_NOW, [resolved]), 'T1')).toHaveLength(1);
    const lowCompletion = [...week('2026-10-12', 0, 1), ...week('2026-10-19', 0, 1)];
    expect(rule(evaluate([], NOW, [open('T2', null)], lowCompletion), 'T2')).toEqual([]);
  });
});
