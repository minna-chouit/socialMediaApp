import { Temporal } from 'temporal-polyfill';
import type { Pillar, Post, Settings, Variant } from './model';
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

const within = (at: Temporal.Instant, from: Temporal.Instant, to: Temporal.Instant) =>
  Temporal.Instant.compare(at, from) >= 0 && Temporal.Instant.compare(at, to) < 0;

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
  _settings: Settings,
  hypothetical?: Post,
): BalanceWarning[] {
  const all = countedItems(
    hypothetical ? [...posts, { ...hypothetical, status: 'approved' }] : posts,
  );
  const inWindow = all.filter((i) => within(i.at, window.from, window.to));
  return [...r5(inWindow)];
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
