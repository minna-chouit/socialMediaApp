import { describe, expect, it } from 'vitest';
import type { ZodError } from 'zod';
import { reviewIdea } from './ideas';

const CRITERIA = ['forwardable', 'fills_gap', 'doable', 'original', 'hook'];

// Five 1–3 scores adding up to `total` (5–15).
const scoresTotalling = (total: number) =>
  Object.fromEntries(CRITERIA.map((k, i) => [k, 1 + Math.min(2, Math.max(0, total - 5 - 2 * i))]));

const review = (overrides: Record<string, unknown> = {}) => ({
  scores: scoresTotalling(9),
  notes: 'Strong hook, weak payoff.',
  alternatives: ['Open with the result instead.'],
  ...overrides,
});

// Paths of the validation issues reviewIdea raised, or [] if it accepted the input.
function rejectedPaths(input: unknown): string[] {
  try {
    reviewIdea(input);
    return [];
  } catch (e) {
    return (e as ZodError).issues.map((issue) => issue.path.join('.'));
  }
}

describe('FR-10: idea verdicts', () => {
  it('FR-10: totals 7, 8, 10, 11 map to bank, improve, improve, go', () => {
    const results = [7, 8, 10, 11].map((t) => reviewIdea(review({ scores: scoresTotalling(t) })));
    expect(results.map((r) => [r.total, r.verdict])).toEqual([
      [7, 'bank'],
      [8, 'improve'],
      [10, 'improve'],
      [11, 'go'],
    ]);
  });

  it('FR-10: minimum total 5 is bank, maximum 15 is go', () => {
    expect(reviewIdea(review({ scores: scoresTotalling(5) })).verdict).toBe('bank');
    expect(reviewIdea(review({ scores: scoresTotalling(15) })).verdict).toBe('go');
  });

  it('FR-10: rejects a score outside 1–3 or not a whole number', () => {
    for (const bad of [0, 4, 2.5]) {
      const scores = { ...scoresTotalling(9), hook: bad };
      expect(rejectedPaths(review({ scores })), String(bad)).toEqual(['scores.hook']);
    }
  });

  it('FR-10: rejects a missing or unknown criterion', () => {
    const missing = scoresTotalling(9);
    delete missing.hook;
    expect(rejectedPaths(review({ scores: missing }))).toEqual(['scores.hook']);
    expect(rejectedPaths(review({ scores: { ...scoresTotalling(9), vibes: 3 } }))).toEqual([
      'scores',
    ]);
  });

  it('FR-10: requires non-empty notes', () => {
    expect(rejectedPaths(review({ notes: '   ' }))).toEqual(['notes']);
    expect(rejectedPaths(review({ notes: undefined }))).toEqual(['notes']);
  });

  it('FR-10: requires at least one alternative', () => {
    expect(rejectedPaths(review({ alternatives: [] }))).toEqual(['alternatives']);
    expect(rejectedPaths(review({ alternatives: [' '] }))).toEqual(['alternatives.0']);
  });

  it('FR-10: ignores a total or verdict supplied in the input and computes its own', () => {
    const result = reviewIdea(review({ scores: scoresTotalling(7), total: 15, verdict: 'go' }));
    expect([result.total, result.verdict]).toEqual([7, 'bank']);
  });
});
