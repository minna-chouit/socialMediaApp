import { Temporal } from 'temporal-polyfill';
import type { Post, Variant } from '../src/model';

export const at = (iso: string) => Temporal.Instant.from(iso);

/** Planning week Saturday 2026-10-17 00:00 to Saturday 2026-10-24 00:00, Algiers. */
export const WEEK = { from: at('2026-10-16T23:00:00Z'), to: at('2026-10-23T23:00:00Z') };

let next = 0;

/** An approved life_style post going live Monday of WEEK, with one Instagram reel unless told otherwise. */
export function post(
  fields: Partial<Omit<Post, 'variants'>> & { variants?: Partial<Variant>[] } = {},
): Post {
  const id = fields.id ?? `p${++next}`;
  return {
    title: id,
    pillar: 'life_style',
    topics: [],
    status: 'approved',
    goLiveAt: at('2026-10-19T10:00:00Z'),
    isLeftovers: false,
    ...fields,
    id,
    variants: (fields.variants ?? [{}]).map((v, i) => ({
      id: `${id}-v${i}`,
      platform: 'instagram',
      format: 'reel',
      ...v,
    })),
  };
}

export const only = <T extends { rule: string }>(warnings: T[], rule: string) =>
  warnings.filter((w) => w.rule === rule);
