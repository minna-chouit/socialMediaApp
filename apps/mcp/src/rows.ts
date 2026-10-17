import { Temporal } from 'temporal-polyfill';

type Row = Record<string, unknown>;

// Names that plain camelCase would get wrong, so output matches @cadence/core.
const RENAMES: Record<string, string> = { reply_reminders_tiktok: 'replyRemindersTikTok' };
const camel = (key: string) =>
  RENAMES[key] ?? key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

// A timestamptz rendered as text, as jsonb does: 2026-10-20T17:00:00+00:00.
const TIMESTAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?([+-]\d\d:\d\d|Z)$/;
const TIME = /^\d\d:\d\d:\d\d$/;

const isRow = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

/** ISO 8601 with the owner's offset, e.g. 2026-10-21T12:00:00+01:00 (section 6). */
export const localIso = (at: Date, timeZone: string) =>
  Temporal.Instant.fromEpochMilliseconds(at.getTime())
    .toZonedDateTimeISO(timeZone)
    .toString({ timeZoneName: 'never' });

function value(v: unknown, timeZone: string, omit: string[]): unknown {
  if (v instanceof Date) return localIso(v, timeZone);
  if (typeof v === 'string' && TIMESTAMP.test(v)) return localIso(new Date(v), timeZone);
  if (typeof v === 'string' && TIME.test(v)) return v.slice(0, 5);
  if (isRow(v)) return output(v, timeZone, omit);
  return v;
}

/** A database row as tool output: camelCase keys, local timestamps, HH:MM times, no bookkeeping. */
export function output(
  row: Row,
  timeZone: string,
  omit = ['owner_id', 'created_at', 'updated_at'],
): Row {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => !omit.includes(key))
      .map(([key, v]) => [camel(key), value(v, timeZone, omit)]),
  );
}
