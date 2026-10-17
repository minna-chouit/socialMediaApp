import { Temporal } from 'temporal-polyfill';
import type { Checkin } from './checkins';
import type { Post, Settings } from './model';
import { isWithin } from './time';

/** Moves a non-urgent reminder inside quiet hours [quietStart, quietEnd) to the end of quiet hours (FR-13). */
export function applyQuietHours(
  at: Temporal.Instant,
  urgent: boolean,
  settings: Settings,
): Temporal.Instant {
  if (urgent) return at;
  const local = at.toZonedDateTimeISO(settings.timeZone);
  const time = local.toPlainTime();
  const start = Temporal.PlainTime.from(settings.quietStart);
  const end = Temporal.PlainTime.from(settings.quietEnd);
  const afterStart = Temporal.PlainTime.compare(time, start) >= 0;
  const beforeEnd = Temporal.PlainTime.compare(time, end) < 0;
  const crossesMidnight = Temporal.PlainTime.compare(start, end) > 0;
  const quiet = crossesMidnight ? afterStart || beforeEnd : afterStart && beforeEnd;
  if (!quiet) return at;
  // Before midnight in a window that crosses it, quiet hours end tomorrow.
  const endDay =
    crossesMidnight && afterStart ? local.toPlainDate().add({ days: 1 }) : local.toPlainDate();
  return endDay.toZonedDateTime({ timeZone: settings.timeZone, plainTime: end }).toInstant();
}

export type ReminderCode =
  | 'SHOT_LIST'
  | 'WEEKLY_REPORT'
  | 'BATCH_NIGHT'
  | 'SCHEDULE'
  | 'POST_NOW'
  | 'REPLY_START'
  | 'REPLY_END'
  | 'CHECKIN'
  | 'MISSED'
  | 'LI_CAPTURE'
  | 'LI_FALLBACK'
  | 'MILESTONE'
  | 'MONTHLY_REVIEW'
  | 'TRIGGER';

export interface Reminder {
  code: ReminderCode;
  /** code:entityId:local date of `at`; regenerating yields the same key (section 4.2). */
  key: string;
  entityType: 'variant' | 'checkin' | 'milestone' | 'trigger' | null;
  entityId: string | null;
  /** The scheduled time, before quiet hours. */
  at: Temporal.Instant;
  sendAt: Temporal.Instant;
  urgent: boolean;
  /** Mirrored to Google Calendar (FR-15). */
  mirror: boolean;
}

export interface ReminderData {
  posts: Post[];
  checkins: Checkin[];
  /** Ideas and media, for the linkedin-capture tag. */
  captureItems: { tags: string[]; createdAt: Temporal.Instant }[];
}

export interface Window {
  from: Temporal.Instant;
  to: Temporal.Instant;
}

type Spec = Pick<Reminder, 'code' | 'entityType' | 'entityId' | 'at' | 'urgent' | 'mirror'>;

/** Owner-wide reminders on a fixed weekday (ISO: Monday 1 … Sunday 7) and local time. */
const WEEKLY: {
  code: ReminderCode;
  weekday: number;
  time: (s: Settings) => string;
  mirror: boolean;
}[] = [{ code: 'WEEKLY_REPORT', weekday: 5, time: (s) => s.reportTime, mirror: true }];

const atLocal = (date: Temporal.PlainDate, time: string, timeZone: string) =>
  date.toZonedDateTime({ timeZone, plainTime: Temporal.PlainTime.from(time) }).toInstant();

// Every local date the window touches.
function localDates(window: Window, timeZone: string): Temporal.PlainDate[] {
  const dates: Temporal.PlainDate[] = [];
  const last = window.to.toZonedDateTimeISO(timeZone).toPlainDate();
  for (
    let date = window.from.toZonedDateTimeISO(timeZone).toPlainDate();
    Temporal.PlainDate.compare(date, last) <= 0;
    date = date.add({ days: 1 })
  ) {
    dates.push(date);
  }
  return dates;
}

function weekly(dates: Temporal.PlainDate[], settings: Settings): Spec[] {
  return dates.flatMap((date) =>
    WEEKLY.filter((w) => w.weekday === date.dayOfWeek).map((w) => ({
      code: w.code,
      entityType: null,
      entityId: null,
      at: atLocal(date, w.time(settings), settings.timeZone),
      urgent: false,
      mirror: w.mirror,
    })),
  );
}

/** Reminders scheduled in the window (section 4.2); idempotent by key. */
export function generateReminders(
  _data: ReminderData,
  settings: Settings,
  window: Window,
): Reminder[] {
  const timeZone = settings.timeZone;
  return weekly(localDates(window, timeZone), settings)
    .filter((spec) => isWithin(spec.at, window.from, window.to))
    .map((spec) => ({
      ...spec,
      key: `${spec.code}:${spec.entityId ?? ''}:${spec.at.toZonedDateTimeISO(timeZone).toPlainDate()}`,
      sendAt: applyQuietHours(spec.at, spec.urgent, settings),
    }));
}
