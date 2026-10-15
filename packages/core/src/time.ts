import { Temporal } from 'temporal-polyfill';

/** The only source of "now" in core (NFR-8). */
export interface Clock {
  now(): Temporal.Instant;
}

/** Planning week containing `at`: Saturday 00:00 local up to (not including) the next Saturday 00:00. */
export function planningWeek(
  at: Temporal.Instant,
  timeZone: string,
): { start: Temporal.Instant; end: Temporal.Instant } {
  const local = at.toZonedDateTimeISO(timeZone);
  const daysSinceSaturday = (local.dayOfWeek + 1) % 7; // ISO dayOfWeek: Monday 1 … Sunday 7
  const start = local.toPlainDate().subtract({ days: daysSinceSaturday }).toZonedDateTime(timeZone);
  return { start: start.toInstant(), end: start.add({ weeks: 1 }).toInstant() };
}

/** True when `at` is in [from, to). */
export const isWithin = (at: Temporal.Instant, from: Temporal.Instant, to: Temporal.Instant) =>
  Temporal.Instant.compare(at, from) >= 0 && Temporal.Instant.compare(at, to) < 0;
