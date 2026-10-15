import { Temporal } from 'temporal-polyfill';
import { checkBalance, type BalanceWarning } from './balance';
import { isOverdue, type Checkin } from './checkins';
import { goesLiveAt, type Post, type Settings } from './model';
import { isApprovedOrLater } from './stages';
import { isWithin, planningWeek } from './time';
import { PLATFORMS, type Platform } from './variants';

export interface ReportData {
  posts: Post[];
  checkins: Checkin[];
  /** Ideas and media, for the linkedin-capture tag. */
  captureItems: { tags: string[]; createdAt: Temporal.Instant }[];
  followerSnapshots: { platform: Platform; weekStart: string }[];
}

interface Completion {
  planned: number;
  done: number;
  completionRate: number | null;
}

export interface WeeklyReport {
  weekStart: string;
  platforms: Record<Platform, Completion>;
  total: Completion;
  missed: {
    postId: string;
    variantId: string;
    title: string;
    platform: Platform;
    goLiveAt: string;
  }[];
  balanceWarnings: BalanceWarning[];
  linkedinCaptured: boolean;
  checkins: { done: number; overdue: number };
  followerSnapshotsMissing: Platform[];
}

/** The weekly report for the planning week containing `now` (FR-17, section 4.5). */
export function weeklyReport(
  data: ReportData,
  settings: Settings,
  now: Temporal.Instant,
): WeeklyReport {
  const timeZone = settings.timeZone;
  const week = planningWeek(now, timeZone);
  const weekStart = week.start.toZonedDateTimeISO(timeZone).toPlainDate().toString();
  const planned = data.posts
    .filter((post) => isApprovedOrLater(post.status))
    .flatMap((post) =>
      post.variants.map((variant) => ({ post, variant, at: goesLiveAt(post, variant) })),
    )
    .filter((i) => isWithin(i.at, week.start, week.end));
  const completion = (items: typeof planned): Completion => {
    const done = items.filter((i) => i.variant.postedAt).length;
    return {
      planned: items.length,
      done,
      completionRate: items.length ? done / items.length : null,
    };
  };
  return {
    weekStart,
    platforms: Object.fromEntries(
      PLATFORMS.map((p) => [p, completion(planned.filter((i) => i.variant.platform === p))]),
    ) as Record<Platform, Completion>,
    total: completion(planned),
    missed: planned
      .filter((i) => !i.variant.postedAt && Temporal.Instant.compare(i.at, now) < 0)
      .map((i) => ({
        postId: i.post.id,
        variantId: i.variant.id,
        title: i.post.title,
        platform: i.variant.platform,
        goLiveAt: i.at.toZonedDateTimeISO(timeZone).toString({ timeZoneName: 'never' }),
      })),
    balanceWarnings: checkBalance(data.posts, { from: week.start, to: week.end }, settings),
    linkedinCaptured: data.captureItems.some(
      (item) =>
        item.tags.includes('linkedin-capture') &&
        Temporal.Instant.compare(item.createdAt, week.start) >= 0,
    ),
    checkins: {
      done: data.checkins.filter((c) => c.doneAt && isWithin(c.doneAt, week.start, week.end))
        .length,
      overdue: data.checkins.filter((c) => isOverdue(c, now)).length,
    },
    followerSnapshotsMissing: PLATFORMS.filter(
      (p) => !data.followerSnapshots.some((s) => s.platform === p && s.weekStart === weekStart),
    ),
  };
}
