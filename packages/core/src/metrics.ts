import type { Checkin } from './checkins';
import type { Post, Settings, Variant } from './model';

export const METRICS = [
  'views',
  'reach',
  'likes',
  'comments',
  'saves',
  'shares',
  'follows',
] as const;
export type Metric = (typeof METRICS)[number];

export interface MetricGroup {
  /** Variants posted in the month in this group. */
  variants: number;
  /** Sum of the values that were logged; null when none were. */
  totals: Record<Metric, number | null>;
  /** Mean over the variants that logged the metric; null when none did. */
  means: Record<Metric, number | null>;
}

export interface MetricsSummary {
  month: string;
  byPlatform: Record<string, MetricGroup>;
  byPillar: Record<string, MetricGroup>;
}

interface Posted {
  post: Post;
  variant: Variant;
  checkin?: Checkin;
}

function group(items: Posted[]): MetricGroup {
  const totals = {} as MetricGroup['totals'];
  const means = {} as MetricGroup['means'];
  for (const metric of METRICS) {
    const values = items.flatMap((i) => (i.checkin?.[metric] == null ? [] : [i.checkin[metric]]));
    const sum = values.reduce((a, b) => a + b, 0);
    totals[metric] = values.length ? sum : null;
    means[metric] = values.length ? sum / values.length : null;
  }
  return { variants: items.length, totals, means };
}

function groupBy(items: Posted[], key: (i: Posted) => string): Record<string, MetricGroup> {
  const groups = new Map<string, Posted[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return Object.fromEntries([...groups].map(([name, members]) => [name, group(members)]));
}

/**
 * Totals and means per platform and pillar for a local month (YYYY-MM), from the day-7 check-in of
 * each variant posted that month (get_metrics_summary, section 6.1).
 */
export function metricsSummary(
  posts: Post[],
  checkins: Checkin[],
  month: string,
  settings: Settings,
): MetricsSummary {
  const daySeven = new Map(checkins.filter((c) => c.dayOffset === 7).map((c) => [c.variantId, c]));
  const items = posts.flatMap((post) =>
    post.variants
      .filter(
        (v) =>
          v.postedAt &&
          v.postedAt
            .toZonedDateTimeISO(settings.timeZone)
            .toPlainDate()
            .toString()
            .startsWith(month),
      )
      .map((variant) => ({ post, variant, checkin: daySeven.get(variant.id) })),
  );
  return {
    month,
    byPlatform: groupBy(items, (i) => i.variant.platform),
    byPillar: groupBy(items, (i) => i.post.pillar),
  };
}
