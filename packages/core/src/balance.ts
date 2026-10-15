import { Temporal } from 'temporal-polyfill';
import type { Pillar, Post, Settings, Variant } from './model';
import type { Platform } from './variants';
import { STAGES } from './stages';

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

const within = (at: Temporal.Instant, from: Temporal.Instant, to: Temporal.Instant) =>
  Temporal.Instant.compare(at, from) >= 0 && Temporal.Instant.compare(at, to) < 0;

const daysBefore = (to: Temporal.Instant, days: number, timeZone: string) =>
  to.toZonedDateTimeISO(timeZone).subtract({ days }).toInstant();

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
  return [...r1(all, window, settings), ...r2(all, window), ...r5(inWindow)];
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
