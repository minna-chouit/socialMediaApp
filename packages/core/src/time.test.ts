import fc from 'fast-check';
import { Temporal } from 'temporal-polyfill';
import { describe, expect, it } from 'vitest';
import { planningWeek } from './time';

const ALGIERS = 'Africa/Algiers';
const at = (iso: string) => Temporal.Instant.from(iso);

describe('NFR-8: planning week in the owner timezone', () => {
  it('NFR-8: Friday 23:59 and Saturday 00:00 Algiers fall in different planning weeks', () => {
    const friday = planningWeek(at('2026-10-16T23:59:00+01:00'), ALGIERS);
    const saturday = planningWeek(at('2026-10-17T00:00:00+01:00'), ALGIERS);
    expect(saturday.start.equals(friday.start)).toBe(false);
    expect(saturday.start.equals(friday.end)).toBe(true);
  });

  it('NFR-8: Saturday 00:00 Algiers (Friday 23:00 UTC) starts the new week', () => {
    expect(planningWeek(at('2026-10-16T23:00:00Z'), ALGIERS).start.toString()).toBe(
      '2026-10-16T23:00:00Z',
    );
    expect(planningWeek(at('2026-10-16T22:59:59Z'), ALGIERS).start.toString()).toBe(
      '2026-10-09T23:00:00Z',
    );
  });

  it('NFR-8: week runs Saturday 00:00 to the next Saturday 00:00 local, returned as UTC instants', () => {
    const week = planningWeek(at('2026-10-21T12:00:00Z'), ALGIERS);
    expect(week.start.toString()).toBe('2026-10-16T23:00:00Z');
    expect(week.end.toString()).toBe('2026-10-23T23:00:00Z');
  });

  it('NFR-8: a week in Europe/Paris that spans the DST change is 169 hours', () => {
    const week = planningWeek(at('2026-10-25T12:00:00Z'), 'Europe/Paris');
    expect(week.start.toString()).toBe('2026-10-23T22:00:00Z');
    expect(week.start.until(week.end).total('hours')).toBe(169);
  });

  it('NFR-8: any instant falls inside its own week, which starts on a Saturday at 00:00 local', () => {
    const zones = ['Africa/Algiers', 'Europe/Paris', 'America/New_York', 'Pacific/Auckland'];
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2035, 0, 1) }),
        fc.constantFrom(...zones),
        (ms, zone) => {
          const instant = Temporal.Instant.fromEpochMilliseconds(ms);
          const { start, end } = planningWeek(instant, zone);
          const local = start.toZonedDateTimeISO(zone);
          expect(Temporal.Instant.compare(start, instant)).toBeLessThanOrEqual(0);
          expect(Temporal.Instant.compare(instant, end)).toBe(-1);
          expect([local.dayOfWeek, local.hour, local.minute, local.second]).toEqual([6, 0, 0, 0]);
        },
      ),
    );
  });
});
