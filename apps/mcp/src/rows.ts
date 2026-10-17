import { Temporal } from 'temporal-polyfill';

type Row = Record<string, unknown>;

// Names that plain camelCase would get wrong, so output matches @cadence/core.
const RENAMES: Record<string, string> = { reply_reminders_tiktok: 'replyRemindersTikTok' };
const camel = (key: string) =>
  RENAMES[key] ?? key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** ISO 8601 with the owner's offset, e.g. 2026-10-21T12:00:00+01:00 (section 6). */
export const localIso = (at: Date, timeZone: string) =>
  Temporal.Instant.fromEpochMilliseconds(at.getTime())
    .toZonedDateTimeISO(timeZone)
    .toString({ timeZoneName: 'never' });

/** A database row as tool output: camelCase keys, local timestamps, HH:MM times, no bookkeeping. */
export function output(
  row: Row,
  timeZone: string,
  omit = ['owner_id', 'created_at', 'updated_at'],
): Row {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => !omit.includes(key))
      .map(([key, value]) => [
        camel(key),
        value instanceof Date
          ? localIso(value, timeZone)
          : typeof value === 'string' && /^\d\d:\d\d:\d\d$/.test(value)
            ? value.slice(0, 5)
            : value,
      ]),
  );
}
