import { Temporal } from 'temporal-polyfill';
import type { Checkin } from './checkins';
import { goesLiveAt, type Post, type Settings } from './model';
import { isApprovedOrLater, STAGES } from './stages';
import { isWithin, planningWeek } from './time';

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
  /** Only the first such weekday of the month. */
  firstInMonth?: boolean;
}[] = [
  { code: 'WEEKLY_REPORT', weekday: 5, time: (s) => s.reportTime, mirror: true },
  { code: 'BATCH_NIGHT', weekday: 5, time: (s) => s.batchTime, mirror: true },
  { code: 'SHOT_LIST', weekday: 7, time: () => '18:00', mirror: false },
  { code: 'SCHEDULE', weekday: 5, time: () => '22:00', mirror: false },
  { code: 'LI_CAPTURE', weekday: 1, time: () => '18:00', mirror: false },
  { code: 'LI_FALLBACK', weekday: 2, time: () => '21:00', mirror: false },
  { code: 'MONTHLY_REVIEW', weekday: 6, time: () => '11:00', mirror: true, firstInMonth: true },
];

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
    WEEKLY.filter((w) => w.weekday === date.dayOfWeek && (!w.firstInMonth || date.day <= 7)).map(
      (w) => ({
        code: w.code,
        entityType: null,
        entityId: null,
        at: atLocal(date, w.time(settings), settings.timeZone),
        urgent: false,
        mirror: w.mirror,
      }),
    ),
  );
}

// Reminders tied to each approved-or-later variant.
function perVariant(data: ReminderData, settings: Settings): Spec[] {
  return data.posts
    .filter((post) => isApprovedOrLater(post.status))
    .flatMap((post) =>
      post.variants.flatMap((variant): Spec[] => {
        const live = goesLiveAt(post, variant);
        const spec = (code: ReminderCode, at: Temporal.Instant, urgent = true): Spec => ({
          code,
          entityType: 'variant',
          entityId: variant.id,
          at,
          urgent,
          mirror: false,
        });
        const dayAfter = live.toZonedDateTimeISO(settings.timeZone).toPlainDate().add({ days: 1 });
        const replies = variant.platform !== 'tiktok' || settings.replyRemindersTikTok;
        const replyWindow = post.reminders?.replyWindowMinutes ?? settings.replyWindowMinutes;
        return [
          spec('POST_NOW', live),
          spec('MISSED', atLocal(dayAfter, '09:00', settings.timeZone), false),
          ...(replies
            ? [spec('REPLY_START', live), spec('REPLY_END', live.add({ minutes: replyWindow }))]
            : []),
        ].filter((r) => !post.reminders?.off?.includes(r.code));
      }),
    );
}

// A check-in has no id of its own in core; (variant, day offset) is unique.
const checkinId = (c: Checkin) => `${c.variantId}:d${c.dayOffset}`;

function perCheckin(data: ReminderData): Spec[] {
  return data.checkins.map((c) => ({
    code: 'CHECKIN',
    entityType: 'checkin',
    entityId: checkinId(c),
    at: c.dueAt,
    urgent: false,
    mirror: false,
  }));
}

const findVariant = (data: ReminderData, id: string | null) =>
  data.posts.flatMap((post) => post.variants).find((v) => v.id === id);

/** Reminders scheduled in the window (section 4.2); idempotent by key. */
export function generateReminders(
  data: ReminderData,
  settings: Settings,
  window: Window,
): Reminder[] {
  const timeZone = settings.timeZone;
  return [
    ...weekly(localDates(window, timeZone), settings),
    ...perVariant(data, settings),
    ...perCheckin(data),
  ]
    .filter((spec) => isWithin(spec.at, window.from, window.to))
    .map((spec) => ({
      ...spec,
      key: `${spec.code}:${spec.entityId ?? ''}:${spec.at.toZonedDateTimeISO(timeZone).toPlainDate()}`,
      sendAt: applyQuietHours(spec.at, spec.urgent, settings),
    }));
}

/** Re-checks a reminder's condition at send time; false means cancel it (section 4.2). */
export function shouldSend(reminder: Reminder, data: ReminderData, settings: Settings): boolean {
  const week = planningWeek(reminder.at, settings.timeZone);
  const goesLiveThisWeek = (post: Post) =>
    post.variants.some((v) => isWithin(goesLiveAt(post, v), week.start, week.end));
  switch (reminder.code) {
    case 'SHOT_LIST':
      return data.posts.some(
        (p) => STAGES.indexOf(p.status) <= STAGES.indexOf('capture') && goesLiveThisWeek(p),
      );
    case 'SCHEDULE': {
      const next = planningWeek(week.end, settings.timeZone);
      return data.posts.some(
        (p) =>
          isApprovedOrLater(p.status) &&
          p.variants.some(
            (v) =>
              !v.postedAt &&
              !v.scheduledNatively &&
              isWithin(goesLiveAt(p, v), next.start, next.end),
          ),
      );
    }
    case 'POST_NOW': {
      const variant = findVariant(data, reminder.entityId);
      return !!variant && !variant.postedAt && !variant.scheduledNatively;
    }
    case 'MISSED': {
      const variant = findVariant(data, reminder.entityId);
      return !!variant && !variant.postedAt;
    }
    case 'LI_FALLBACK':
      return !data.captureItems.some(
        (item) =>
          item.tags.includes('linkedin-capture') &&
          Temporal.Instant.compare(item.createdAt, week.start) >= 0,
      );
    case 'CHECKIN': {
      const checkin = data.checkins.find((c) => checkinId(c) === reminder.entityId);
      return !!checkin && !checkin.doneAt;
    }
    case 'REPLY_START':
    case 'REPLY_END':
      return !!findVariant(data, reminder.entityId)?.postedAt;
    default:
      return true;
  }
}
