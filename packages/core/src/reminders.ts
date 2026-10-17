import { Temporal } from 'temporal-polyfill';
import type { Settings } from './model';

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
