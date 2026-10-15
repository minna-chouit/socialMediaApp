import type { Temporal } from 'temporal-polyfill';
import type { Settings, Variant } from './model';

export interface Checkin {
  variantId: string;
  dayOffset: number;
  dueAt: Temporal.Instant;
  doneAt?: Temporal.Instant;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  follows: number | null;
  avgWatchSeconds: number | null;
}

const CHECKIN_TIME = { hour: 20 };

/** Sets postedAt, starts the reply timer and creates the variant's check-ins (FR-5). */
export function markPosted(variant: Variant, postedAt: Temporal.Instant, settings: Settings) {
  const postedOn = postedAt.toZonedDateTimeISO(settings.timeZone).toPlainDate();
  const checkins = settings.checkinOffsets[variant.platform].map((dayOffset): Checkin => ({
    variantId: variant.id,
    dayOffset,
    dueAt: postedOn
      .add({ days: dayOffset })
      .toZonedDateTime({ timeZone: settings.timeZone, plainTime: CHECKIN_TIME })
      .toInstant(),
    views: null,
    reach: null,
    likes: null,
    comments: null,
    saves: null,
    shares: null,
    follows: null,
    avgWatchSeconds: null,
  }));
  return {
    variant: { ...variant, postedAt },
    replyEndsAt: postedAt.add({ minutes: settings.replyWindowMinutes }),
    checkins,
  };
}
