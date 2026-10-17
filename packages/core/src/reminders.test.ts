import { describe, expect, it } from 'vitest';
import { at } from '../test/fixtures';
import { DEFAULT_SETTINGS as S } from './model';
import { applyQuietHours } from './reminders';

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
