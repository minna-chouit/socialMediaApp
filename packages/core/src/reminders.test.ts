import fc from 'fast-check';
import { Temporal } from 'temporal-polyfill';
import { describe, expect, it } from 'vitest';
import { at, post, WEEK } from '../test/fixtures';
import { DEFAULT_SETTINGS as S } from './model';
import {
  applyQuietHours,
  generateReminders,
  shouldSend,
  type Reminder,
  type ReminderCode,
  type ReminderData,
  type Window,
} from './reminders';

// Algiers is UTC+1, so local 23:45 on the 19th is 22:45 UTC.
const quiet = (utc: string, urgent = false, settings = S) =>
  applyQuietHours(at(utc), urgent, settings).toString();

describe('FR-13: quiet hours', () => {
  it('FR-13: a non-urgent reminder inside quiet hours moves to the end of quiet hours', () => {
    expect(quiet('2026-10-19T22:45:00Z')).toBe('2026-10-20T07:00:00Z'); // 23:45 → next day 08:00
    expect(quiet('2026-10-19T22:30:00Z')).toBe('2026-10-20T07:00:00Z'); // 23:30, the start, is quiet
    expect(quiet('2026-10-19T23:30:00Z')).toBe('2026-10-20T07:00:00Z'); // 00:30 → same day 08:00
    expect(quiet('2026-10-19T22:29:00Z')).toBe('2026-10-19T22:29:00Z'); // 23:29 is before quiet hours
    expect(quiet('2026-10-20T07:00:00Z')).toBe('2026-10-20T07:00:00Z'); // 08:00, the end, is not quiet
  });

  it('FR-13: urgent reminders ignore quiet hours', () => {
    expect(quiet('2026-10-19T22:45:00Z', true)).toBe('2026-10-19T22:45:00Z');
  });

  it('FR-13: quiet hours come from settings, including a window that does not cross midnight', () => {
    const siesta = { ...S, quietStart: '13:00', quietEnd: '15:00' };
    expect(quiet('2026-10-19T13:00:00Z', false, siesta)).toBe('2026-10-19T14:00:00Z'); // 14:00 → 15:00
    expect(quiet('2026-10-19T22:45:00Z', false, siesta)).toBe('2026-10-19T22:45:00Z');
  });
});

const EMPTY: ReminderData = { posts: [], checkins: [], captureItems: [] };
const remind = (fields: Partial<ReminderData> = {}, settings = S, window = WEEK) =>
  generateReminders({ ...EMPTY, ...fields }, settings, window);
const ofCode = (reminders: Reminder[], code: ReminderCode) =>
  reminders.filter((r) => r.code === code);
const summary = (r: Reminder) => ({
  key: r.key,
  at: r.at.toString(),
  sendAt: r.sendAt.toString(),
  urgent: r.urgent,
  mirror: r.mirror,
});

describe('FR-13: reminder generation', () => {
  it('FR-13: generates every reminder due in the window, keyed code:entity:local date', () => {
    const [report] = ofCode(remind(), 'WEEKLY_REPORT');
    expect(report).toMatchObject({
      entityType: null,
      entityId: null,
      key: 'WEEKLY_REPORT::2026-10-23',
    });
    const endsBeforeFriday = { from: WEEK.from, to: at('2026-10-23T19:00:00Z') };
    expect(ofCode(remind({}, S, endsBeforeFriday), 'WEEKLY_REPORT')).toEqual([]);
  });

  it('FR-13: generating twice yields the same set', () => {
    const start = Date.UTC(2026, 0, 1);
    const day = 24 * 3600 * 1000;
    fc.assert(
      fc.property(
        fc.integer({ min: start, max: start + 365 * day }),
        fc.integer({ min: 7 * day, max: 40 * day }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (fromMs, length, split) => {
          const from = Temporal.Instant.fromEpochMilliseconds(fromMs);
          const to = from.add({ milliseconds: length });
          const mid = from.add({ milliseconds: Math.floor(length * split) });
          const keys = (w: Window) => remind({}, S, w).map((r) => r.key);
          const whole = keys({ from, to });
          expect(whole.length).toBeGreaterThan(0);
          expect(new Set(whole).size).toBe(whole.length);
          expect(keys({ from, to })).toEqual(whole);
          expect([...keys({ from, to: mid }), ...keys({ from: mid, to })].sort()).toEqual(
            [...whole].sort(),
          );
        },
      ),
    );
  });

  it('FR-13: report time and quiet hours come from settings', () => {
    const late = { ...S, reportTime: '23:45' };
    expect(ofCode(remind({}, late), 'WEEKLY_REPORT').map(summary)).toEqual([
      {
        key: 'WEEKLY_REPORT::2026-10-23',
        at: '2026-10-23T22:45:00Z',
        sendAt: '2026-10-24T07:00:00Z', // moved to Saturday 08:00, still keyed Friday
        urgent: false,
        mirror: true,
      },
    ]);
  });
});

describe('WEEKLY_REPORT', () => {
  it('WEEKLY_REPORT: Friday 20:00, not urgent, mirrored to the calendar', () => {
    expect(ofCode(remind(), 'WEEKLY_REPORT').map(summary)).toEqual([
      {
        key: 'WEEKLY_REPORT::2026-10-23',
        at: '2026-10-23T19:00:00Z',
        sendAt: '2026-10-23T19:00:00Z',
        urgent: false,
        mirror: true,
      },
    ]);
  });
});

describe('BATCH_NIGHT', () => {
  it('BATCH_NIGHT: Friday at batch time (default 20:15), not urgent, mirrored', () => {
    expect(ofCode(remind(), 'BATCH_NIGHT').map(summary)).toEqual([
      {
        key: 'BATCH_NIGHT::2026-10-23',
        at: '2026-10-23T19:15:00Z',
        sendAt: '2026-10-23T19:15:00Z',
        urgent: false,
        mirror: true,
      },
    ]);
    const later = { ...S, batchTime: '21:00' };
    expect(ofCode(remind({}, later), 'BATCH_NIGHT')[0].at.toString()).toBe('2026-10-23T20:00:00Z');
  });
});

describe('SHOT_LIST', () => {
  const shotList = (fields: Partial<ReminderData>) => {
    const [reminder] = ofCode(remind(fields), 'SHOT_LIST');
    return shouldSend(reminder, { ...EMPTY, ...fields }, S);
  };

  it('SHOT_LIST: Sunday 18:00, not urgent, not mirrored', () => {
    expect(ofCode(remind(), 'SHOT_LIST').map(summary)).toEqual([
      {
        key: 'SHOT_LIST::2026-10-18',
        at: '2026-10-18T17:00:00Z',
        sendAt: '2026-10-18T17:00:00Z',
        urgent: false,
        mirror: false,
      },
    ]);
  });

  it("SHOT_LIST: sends only while this week's posts are at capture or earlier", () => {
    expect(shotList({ posts: [post({ status: 'capture' })] })).toBe(true);
    expect(shotList({ posts: [post({ status: 'idea' })] })).toBe(true);
    expect(shotList({ posts: [post({ status: 'edit' })] })).toBe(false);
    expect(shotList({ posts: [post({ status: 'archived' })] })).toBe(false);
    const nextWeek = post({ status: 'capture', goLiveAt: at('2026-10-26T10:00:00Z') });
    expect(shotList({ posts: [nextWeek] })).toBe(false);
  });
});

describe('FR-13: send-time re-check', () => {
  it('FR-13: a reminder whose condition no longer holds at send time is cancelled', () => {
    const p = post({ status: 'capture' });
    const [reminder] = ofCode(remind({ posts: [p] }), 'SHOT_LIST');
    expect(shouldSend(reminder, { ...EMPTY, posts: [{ ...p, status: 'edit' }] }, S)).toBe(false);
    const [report] = ofCode(remind(), 'WEEKLY_REPORT');
    expect(shouldSend(report, EMPTY, S)).toBe(true);
  });
});

// Generates the week's reminder with this code and re-checks it against the same data.
const sends = (code: ReminderCode, fields: Partial<ReminderData>, settings = S) => {
  const [reminder] = ofCode(remind(fields, settings), code);
  return shouldSend(reminder, { ...EMPTY, ...fields }, settings);
};

describe('SCHEDULE', () => {
  const nextWeek = (fields: Parameters<typeof post>[0] = {}) =>
    post({ goLiveAt: at('2026-10-27T18:00:00Z'), ...fields });

  it('SCHEDULE: Friday 22:00, not urgent, not mirrored', () => {
    expect(ofCode(remind(), 'SCHEDULE').map(summary)).toEqual([
      {
        key: 'SCHEDULE::2026-10-23',
        at: '2026-10-23T21:00:00Z',
        sendAt: '2026-10-23T21:00:00Z',
        urgent: false,
        mirror: false,
      },
    ]);
  });

  it('SCHEDULE: cancelled once every approved variant for next week is scheduled', () => {
    expect(sends('SCHEDULE', { posts: [nextWeek()] })).toBe(true);
    expect(
      sends('SCHEDULE', { posts: [nextWeek({ variants: [{ scheduledNatively: true }] })] }),
    ).toBe(false);
    expect(
      sends('SCHEDULE', {
        posts: [nextWeek({ variants: [{ postedAt: at('2026-10-23T10:00:00Z') }] })],
      }),
    ).toBe(false);
    expect(sends('SCHEDULE', { posts: [nextWeek({ status: 'proposed' })] })).toBe(false);
    expect(sends('SCHEDULE', { posts: [post()] })).toBe(false); // this week, not next
  });
});
