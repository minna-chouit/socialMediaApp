import { Temporal } from 'temporal-polyfill';
import { TOPICS, type Pillar, type Post, type Settings, type Variant } from './model';
import { PLATFORMS, type Platform } from './variants';
import { STAGES } from './stages';
import { planningWeek } from './time';

export type Severity = 'info' | 'warning' | 'error';

export interface BalanceWarning {
  rule: string;
  severity: Severity;
  message: string;
  postId?: string;
}

export interface Window {
  from: Temporal.Instant;
  to: Temporal.Instant;
}

/** A variant that counts toward balance, placed at the time it goes live. */
interface Item {
  post: Post;
  variant: Variant;
  at: Temporal.Instant;
}

const COUNTED = new Set(STAGES.slice(STAGES.indexOf('approved'), STAGES.indexOf('archived')));
const PROFESSIONAL: Pillar[] = ['work_lessons', 'pov_journey'];
const PERSONAL: Platform[] = ['instagram', 'tiktok'];
const R1_TARGETS = {
  1: { life_style: 5, student_life: 2, pov_journey: 1 },
  2: { life_style: 7, student_life: 3, pov_journey: 2 },
} as const;
const R6_WEEKLY_TARGET = { 1: 2, 2: 3 } as const;

const within = (at: Temporal.Instant, from: Temporal.Instant, to: Temporal.Instant) =>
  Temporal.Instant.compare(at, from) >= 0 && Temporal.Instant.compare(at, to) < 0;

const daysBefore = (to: Temporal.Instant, days: number, timeZone: string) =>
  to.toZonedDateTimeISO(timeZone).subtract({ days }).toInstant();

// Planning weeks overlapping the window, each with its local start date as a label.
function planningWeeks(window: Window, timeZone: string) {
  const weeks: (Window & { label: string })[] = [];
  for (
    let from = planningWeek(window.from, timeZone).start;
    Temporal.Instant.compare(from, window.to) < 0;
  ) {
    const week = planningWeek(from, timeZone);
    weeks.push({
      from: week.start,
      to: week.end,
      label: week.start.toZonedDateTimeISO(timeZone).toPlainDate().toString(),
    });
    from = week.end;
  }
  return weeks;
}

// Approved-or-later, non-archived variants; stories never count toward balance.
function countedItems(posts: Post[]): Item[] {
  return posts
    .filter((p) => COUNTED.has(p.status))
    .flatMap((post) =>
      post.variants
        .filter((v) => v.format !== 'story')
        .map((variant) => ({ post, variant, at: variant.scheduledAt ?? post.goLiveAt })),
    );
}

/** Evaluates rules R1–R8 for a window, optionally with a hypothetical post treated as approved (FR-8). */
export function checkBalance(
  posts: Post[],
  window: Window,
  settings: Settings,
  hypothetical?: Post,
): BalanceWarning[] {
  const all = countedItems(
    hypothetical ? [...posts, { ...hypothetical, status: 'approved' }] : posts,
  );
  const inWindow = all.filter((i) => within(i.at, window.from, window.to));
  const weeks = planningWeeks(window, settings.timeZone);
  return [
    ...r1(all, window, settings),
    ...r2(all, window),
    ...r3(all, window, settings),
    ...r4(all, weeks),
    ...r5(inWindow),
    ...r6(all, weeks, settings),
  ];
}

function r5(items: Item[]): BalanceWarning[] {
  return items
    .filter((i) => i.variant.platform === 'linkedin' && !PROFESSIONAL.includes(i.post.pillar))
    .map((i) => ({
      rule: 'R5',
      severity: 'error',
      postId: i.post.id,
      message: `LinkedIn variant of "${i.post.title}" is ${i.post.pillar}; LinkedIn takes work_lessons or pov_journey only`,
    }));
}

function r1(all: Item[], window: Window, settings: Settings): BalanceWarning[] {
  const recent = all.filter((i) =>
    within(i.at, daysBefore(window.to, 28, settings.timeZone), window.to),
  );
  const mix = Object.entries(R1_TARGETS[settings.phase]).flatMap(
    ([pillar, target]): BalanceWarning[] => {
      const count = recent.filter(
        (i) => i.variant.platform === 'instagram' && i.post.pillar === pillar,
      ).length;
      const off = Math.abs(count - target);
      if (off === 0) return [];
      return [
        {
          rule: 'R1',
          severity: off === 1 ? 'info' : 'warning',
          message: `Instagram ${pillar}: ${count} in the last 28 days, target ${target}`,
        },
      ];
    },
  );
  const work = settings.workOnPersonal
    ? []
    : recent
        .filter((i) => i.post.pillar === 'work_lessons' && PERSONAL.includes(i.variant.platform))
        .map((i): BalanceWarning => ({
          rule: 'R1',
          severity: 'error',
          postId: i.post.id,
          message: `"${i.post.title}" is work_lessons on ${i.variant.platform} while work on personal platforms is off`,
        }));
  return [...mix, ...work];
}

function r2(all: Item[], window: Window): BalanceWarning[] {
  const sorted = [...all].sort((a, b) => Temporal.Instant.compare(a.at, b.at));
  return sorted.flatMap((item, index): BalanceWarning[] => {
    const previous = sorted
      .slice(0, index)
      .findLast((p) => p.variant.platform === item.variant.platform);
    if (previous?.post.pillar !== item.post.pillar || !within(item.at, window.from, window.to)) {
      return [];
    }
    return [
      {
        rule: 'R2',
        severity: 'warning',
        postId: item.post.id,
        message: `"${item.post.title}" is the second ${item.post.pillar} post in a row on ${item.variant.platform}`,
      },
    ];
  });
}

function r3(all: Item[], window: Window, settings: Settings): BalanceWarning[] {
  return TOPICS.flatMap((topic): BalanceWarning[] => {
    const days = topic === 'accessibility' ? 28 : 42;
    const from = daysBefore(window.to, days, settings.timeZone);
    const covered = all.some(
      (i) =>
        i.variant.platform === 'linkedin' &&
        i.post.topics.includes(topic) &&
        within(i.at, from, window.to),
    );
    if (covered) return [];
    return [
      {
        rule: 'R3',
        severity: 'warning',
        message: `No LinkedIn post on ${topic} in the last ${days} days`,
      },
    ];
  });
}

function r4(all: Item[], weeks: ReturnType<typeof planningWeeks>): BalanceWarning[] {
  return weeks.flatMap((week) =>
    PLATFORMS.filter(
      (platform) =>
        !all.some((i) => i.variant.platform === platform && within(i.at, week.from, week.to)),
    ).map((platform): BalanceWarning => ({
      rule: 'R4',
      severity: 'warning',
      message: `No ${platform} post in the week of ${week.label}`,
    })),
  );
}

function r6(
  all: Item[],
  weeks: ReturnType<typeof planningWeeks>,
  settings: Settings,
): BalanceWarning[] {
  const target = R6_WEEKLY_TARGET[settings.phase];
  return weeks.flatMap((week) => {
    const posts = all.filter(
      (i) => i.variant.platform === 'instagram' && within(i.at, week.from, week.to),
    );
    const missing = (['reel', 'carousel'] as const)
      .filter((format) => !posts.some((i) => i.variant.format === format))
      .map((format) => `Instagram has no ${format} in the week of ${week.label}`);
    const volume =
      posts.length < target
        ? [
            `Instagram has ${posts.length} post${posts.length === 1 ? '' : 's'} in the week of ${week.label}, target ${target}`,
          ]
        : [];
    return [...missing, ...volume].map((message): BalanceWarning => ({
      rule: 'R6',
      severity: 'warning',
      message,
    }));
  });
}
