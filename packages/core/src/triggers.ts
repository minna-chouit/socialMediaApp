import { Temporal } from 'temporal-polyfill';
import type { Checkin } from './checkins';
import { goesLiveAt, type Pillar, type Post, type Settings } from './model';
import { isApprovedOrLater } from './stages';
import { isWithin, planningWeek } from './time';
import { PLATFORMS, type Platform } from './variants';

export type TriggerRule = 'T1' | 'T2' | 'T3' | 'T4';

/** A stored trigger, used to avoid firing again while one is unresolved. */
export interface TriggerRecord {
  rule: TriggerRule;
  platform: Platform | null;
  resolvedAt?: Temporal.Instant;
}

export interface FiredTrigger {
  rule: TriggerRule;
  platform: Platform | null;
  params: Record<string, unknown>;
}

export interface TriggerData {
  posts: Post[];
  checkins: Checkin[];
  triggers: TriggerRecord[];
}

const PERSONAL: Platform[] = ['instagram', 'tiktok'];
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const localDate = (at: Temporal.Instant, timeZone: string) =>
  at.toZonedDateTimeISO(timeZone).toPlainDate().toString();
const daysBefore = (at: Temporal.Instant, days: number, timeZone: string) =>
  at.toZonedDateTimeISO(timeZone).subtract({ days }).toInstant();

/** Evaluates T1–T3 (section 4.3); skips any rule and platform that already has an unresolved trigger. */
export function evaluateTriggers(
  data: TriggerData,
  settings: Settings,
  now: Temporal.Instant,
): FiredTrigger[] {
  const open = data.triggers.filter((t) => !t.resolvedAt);
  return [
    ...t1(data, settings, now),
    ...t2(data, settings, now),
    ...t3(data, settings, now),
  ].filter((fired) => !open.some((t) => t.rule === fired.rule && t.platform === fired.platform));
}

// Day-7 check-ins joined to their posted variant and post.
function daySevenResults(data: TriggerData) {
  const variants = new Map(
    data.posts.flatMap((post) =>
      post.variants.map((variant) => [variant.id, { post, variant }] as const),
    ),
  );
  return data.checkins
    .filter((c) => c.dayOffset === 7)
    .flatMap((checkin) => {
      const found = variants.get(checkin.variantId);
      if (!found?.variant.postedAt) return [];
      return [{ ...found, postedAt: found.variant.postedAt, checkin }];
    });
}

// The `count` planning weeks ending at `end` (a Saturday 00:00 local), oldest first.
function weeksEndingAt(end: Temporal.Instant, count: number, timeZone: string) {
  const weeks: { from: Temporal.Instant; to: Temporal.Instant; label: string }[] = [];
  for (let to = end; weeks.length < count; to = weeks[0].from) {
    const from = to.toZonedDateTimeISO(timeZone).subtract({ weeks: 1 }).toInstant();
    weeks.unshift({ from, to, label: localDate(from, timeZone) });
  }
  return weeks;
}

// T1: reach falls week over week 3 times in a row, over the last 4 weeks whose day-7 check-ins are due.
function t1(data: TriggerData, settings: Settings, now: Temporal.Instant): FiredTrigger[] {
  const timeZone = settings.timeZone;
  const lastDue = planningWeek(daysBefore(now, 7, timeZone), timeZone).start;
  const weeks = weeksEndingAt(lastDue, 4, timeZone);
  const results = daySevenResults(data);
  return PLATFORMS.flatMap((platform): FiredTrigger[] => {
    const reach = weeks.map((week) => {
      const values = results
        .filter((r) => r.variant.platform === platform && isWithin(r.postedAt, week.from, week.to))
        .flatMap((r) => (r.checkin.reach === null ? [] : [r.checkin.reach]));
      return values.length ? sum(values) : null; // no data, not zero
    });
    const falling = reach.every((r, i) => r !== null && (i === 0 || r < reach[i - 1]!));
    if (!falling) return [];
    return [{ rule: 'T1', platform, params: { weeks: weeks.map((w) => w.label), reach } }];
  });
}

// T2: completion under 75% in the last 2 finished planning weeks that had anything planned.
function t2(data: TriggerData, settings: Settings, now: Temporal.Instant): FiredTrigger[] {
  const timeZone = settings.timeZone;
  const currentWeek = planningWeek(now, timeZone).start;
  const byWeek = new Map<string, { planned: number; done: number }>();
  for (const post of data.posts.filter((p) => isApprovedOrLater(p.status))) {
    for (const variant of post.variants) {
      const at = goesLiveAt(post, variant);
      if (Temporal.Instant.compare(at, currentWeek) >= 0) continue;
      const label = localDate(planningWeek(at, timeZone).start, timeZone);
      const week = byWeek.get(label) ?? { planned: 0, done: 0 };
      byWeek.set(label, {
        planned: week.planned + 1,
        done: week.done + (variant.postedAt ? 1 : 0),
      });
    }
  }
  const lastTwo = [...byWeek].sort(([a], [b]) => a.localeCompare(b)).slice(-2);
  const rates = lastTwo.map(([, w]) => w.done / w.planned);
  if (lastTwo.length < 2 || !rates.every((r) => r < 0.75)) return [];
  return [
    { rule: 'T2', platform: null, params: { weeks: lastTwo.map(([label]) => label), rates } },
  ];
}

// T3: over 28 days, one pillar's mean (sends + saves) per personal variant is ≥ 2x every other pillar's.
function t3(data: TriggerData, settings: Settings, now: Temporal.Instant): FiredTrigger[] {
  const from = daysBefore(now, 28, settings.timeZone);
  const values = new Map<Pillar, number[]>();
  for (const r of daySevenResults(data)) {
    const { shares, saves } = r.checkin; // sends = shares
    if (!PERSONAL.includes(r.variant.platform) || !isWithin(r.postedAt, from, now)) continue;
    if (shares === null || saves === null) continue;
    values.set(r.post.pillar, [...(values.get(r.post.pillar) ?? []), shares + saves]);
  }
  const means = Object.fromEntries(
    [...values].filter(([, v]) => v.length >= 2).map(([pillar, v]) => [pillar, sum(v) / v.length]),
  );
  const [top, ...rest] = Object.entries(means).sort(([, a], [, b]) => b - a);
  if (!top || !rest.length || top[1] === 0 || !rest.every(([, m]) => top[1] >= 2 * m)) return [];
  return [{ rule: 'T3', platform: null, params: { pillar: top[0], means } }];
}
