import type { Temporal } from 'temporal-polyfill';
import type { Settings } from './model';
import { planningWeek } from './time';

export interface Milestone {
  /** Stable per owner: kind and week. */
  id: string;
  kind: 'checkpoint' | 'research_refresh';
  week: number;
  title: string;
  checks: string[];
  dueAt: Temporal.Instant;
  outcome: string | null;
  decision: string | null;
}

// From the strategy doc's milestone table; "Decide:" items are the possible decisions.
const CHECKPOINTS = [
  {
    week: 1,
    title: 'Setup',
    checks: ['Creator accounts', 'App on the Home Screen', 'Baseline follower counts'],
  },
  {
    week: 2,
    title: 'First posts out',
    checks: ['First 4 Instagram posts out', 'No missed week', 'Decide: move slots or batch time'],
  },
  {
    week: 4,
    title: 'Phase 1 complete',
    checks: [
      'Compare English vs Darija',
      'Decide: go to Phase 2 or repeat',
      'Set follower targets for week 10',
    ],
  },
  {
    week: 6,
    title: 'Topic coverage',
    checks: ['Review LinkedIn topic coverage', 'Decide: rebalance'],
  },
  {
    week: 10,
    title: 'Habit checkpoint',
    checks: ['Decide: Phase 3', 'Decide: whether work moves onto Instagram and TikTok'],
  },
];
// ponytail: first year only; seed further refreshes when the pilot shows Cadence is kept.
const REFRESH_WEEKS = [13, 26, 39, 52];

/** Milestones relative to the first scheduled post; week 1 is its planning week (FR-21). */
export function seedMilestones(firstPostAt: Temporal.Instant, settings: Settings): Milestone[] {
  const timeZone = settings.timeZone;
  const week1 = planningWeek(firstPostAt, timeZone).start.toZonedDateTimeISO(timeZone);
  // Due at 20:00 on the Friday that ends the week.
  const dueAt = (week: number) =>
    week1
      .add({ weeks: week - 1, days: 6 })
      .with({ hour: 20 })
      .toInstant();
  const milestone = (
    kind: Milestone['kind'],
    week: number,
    title: string,
    checks: string[],
  ): Milestone => ({
    id: `${kind}:${week}`,
    kind,
    week,
    title,
    checks,
    dueAt: dueAt(week),
    outcome: null,
    decision: null,
  });
  return [
    ...CHECKPOINTS.map((c) => milestone('checkpoint', c.week, c.title, c.checks)),
    ...REFRESH_WEEKS.map((week) =>
      milestone('research_refresh', week, 'Research refresh', ['Update rules']),
    ),
  ];
}
