import { describe, expect, it } from 'vitest';
import { at, only, post, WEEK } from '../test/fixtures';
import { checkBalance } from './balance';
import { DEFAULT_SETTINGS as S, type Post } from './model';
import { STAGES } from './stages';

const check = (posts: Post[], hypothetical?: Post) => checkBalance(posts, WEEK, S, hypothetical);
const linkedIn = (fields: Parameters<typeof post>[0] = {}) =>
  post({ variants: [{ platform: 'linkedin', format: 'text' }], ...fields });

describe('FR-8: balance checker', () => {
  it('FR-8: each warning carries rule ID, severity and message', () => {
    const p = linkedIn({ title: 'Dorm tour' });
    expect(only(check([p]), 'R5')).toEqual([
      {
        rule: 'R5',
        severity: 'error',
        postId: p.id,
        message:
          'LinkedIn variant of "Dorm tour" is life_style; LinkedIn takes work_lessons or pov_journey only',
      },
    ]);
  });

  it('FR-8: only approved-or-later, non-archived variants count', () => {
    const counted = STAGES.filter((status) => only(check([linkedIn({ status })]), 'R5').length);
    expect(counted).toEqual([
      'approved',
      'capture',
      'edit',
      'write',
      'scheduled',
      'posted',
      'replied',
      'reviewed',
    ]);
  });

  it('FR-8: a hypothetical post is checked as if approved', () => {
    expect(only(check([], linkedIn({ status: 'idea' })), 'R5')).toHaveLength(1);
  });

  it('FR-8: only variants going live inside the window are checked', () => {
    expect(only(check([linkedIn({ goLiveAt: at('2026-10-23T23:00:00Z') })]), 'R5')).toEqual([]);
    expect(only(check([linkedIn({ goLiveAt: at('2026-10-23T22:59:00Z') })]), 'R5')).toHaveLength(1);
  });

  it('FR-8: a variant goes live at its scheduledAt, else at the post goLiveAt', () => {
    const nextWeek = at('2026-10-26T10:00:00Z');
    const movedOut = post({
      variants: [{ platform: 'linkedin', format: 'text', scheduledAt: nextWeek }],
    });
    const movedIn = post({
      goLiveAt: nextWeek,
      variants: [{ platform: 'linkedin', format: 'text', scheduledAt: at('2026-10-20T10:00:00Z') }],
    });
    expect(only(check([movedOut]), 'R5')).toEqual([]);
    expect(only(check([movedIn]), 'R5')).toHaveLength(1);
  });
});

describe('R5: LinkedIn stays professional', () => {
  it('R5: error for a LinkedIn variant on a life_style or student_life post', () => {
    const warnings = only(check([linkedIn(), linkedIn({ pillar: 'student_life' })]), 'R5');
    expect(warnings.map((w) => w.severity)).toEqual(['error', 'error']);
  });

  it('R5: none for work_lessons or pov_journey', () => {
    const posts = [linkedIn({ pillar: 'work_lessons' }), linkedIn({ pillar: 'pov_journey' })];
    expect(only(check(posts), 'R5')).toEqual([]);
  });
});
