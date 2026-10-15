import { z } from 'zod';

const score = z.number().int().min(1).max(3);
const text = z.string().trim().min(1);

/** Claude's review of an idea. Unknown top-level keys (e.g. a supplied total or verdict) are dropped. */
export const ideaReviewInput = z.object({
  scores: z.strictObject({
    forwardable: score,
    fills_gap: score,
    doable: score,
    original: score,
    hook: score,
  }),
  notes: text,
  alternatives: z.array(text).min(1),
});

export type Verdict = 'go' | 'improve' | 'bank';

/** Validates a review and computes its total and verdict (FR-10); throws ZodError on bad input. */
export function reviewIdea(input: unknown) {
  const review = ideaReviewInput.parse(input);
  const total = Object.values(review.scores).reduce((sum, s) => sum + s, 0);
  const verdict: Verdict = total >= 11 ? 'go' : total >= 8 ? 'improve' : 'bank';
  return { ...review, total, verdict };
}
