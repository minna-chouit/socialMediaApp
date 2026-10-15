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

describe('R1: personal pillar mix', () => {
  const many = (n: number, fields: Parameters<typeof post>[0]) =>
    Array.from({ length: n }, () => post(fields));
  const mix = (life: number, student: number, pov: number) => [
    ...many(life, { pillar: 'life_style' }),
    ...many(student, { pillar: 'student_life' }),
    ...many(pov, { pillar: 'pov_journey' }),
  ];
  const r1 = (posts: Post[], settings = S) =>
    only(checkBalance(posts, WEEK, settings), 'R1').map((w) => [w.severity, w.message]);

  it('R1: none when the Instagram mix matches Phase 1 (5/2/1) over 28 days', () => {
    expect(r1(mix(5, 2, 1))).toEqual([]);
  });

  it('R1: info when a pillar is off target by 1', () => {
    expect(r1(mix(4, 2, 1))).toEqual([
      ['info', 'Instagram life_style: 4 in the last 28 days, target 5'],
    ]);
  });

  it('R1: warning when off by 2 or more, too many or too few', () => {
    expect(r1(mix(7, 0, 1))).toEqual([
      ['warning', 'Instagram life_style: 7 in the last 28 days, target 5'],
      ['warning', 'Instagram student_life: 0 in the last 28 days, target 2'],
    ]);
  });

  it('R1: Phase 2 targets are 7/3/2', () => {
    expect(r1(mix(7, 3, 2), { ...S, phase: 2 })).toEqual([]);
    expect(r1(mix(5, 2, 1), { ...S, phase: 2 })).toHaveLength(3);
  });

  it('R1: only counts Instagram variants in the 28 days before the window end', () => {
    const outside = post({ pillar: 'life_style', goLiveAt: at('2026-09-25T22:59:00Z') });
    const firstMinute = post({ pillar: 'pov_journey', goLiveAt: at('2026-09-25T23:00:00Z') });
    const tiktok = post({
      pillar: 'life_style',
      variants: [{ platform: 'tiktok', format: 'video' }],
    });
    expect(r1([...mix(5, 2, 0), outside, firstMinute, tiktok])).toEqual([]);
  });

  it('R1: error for work_lessons on Instagram or TikTok while workOnPersonal is false', () => {
    const work = post({
      title: 'Standup notes',
      pillar: 'work_lessons',
      variants: [
        {},
        { platform: 'tiktok', format: 'video' },
        { platform: 'linkedin', format: 'text' },
      ],
    });
    expect(r1([...mix(5, 2, 1), work])).toEqual([
      [
        'error',
        '"Standup notes" is work_lessons on instagram while work on personal platforms is off',
      ],
      [
        'error',
        '"Standup notes" is work_lessons on tiktok while work on personal platforms is off',
      ],
    ]);
  });

  it('R1: no error when workOnPersonal is true', () => {
    const work = post({
      pillar: 'work_lessons',
      variants: [{ platform: 'tiktok', format: 'video' }],
    });
    expect(r1([...mix(5, 2, 1), work], { ...S, workOnPersonal: true })).toEqual([]);
  });
});

describe('R2: no same pillar twice in a row on one platform', () => {
  const r2 = (posts: Post[]) =>
    only(check(posts), 'R2').map((w) => [w.severity, w.postId, w.message]);
  const on = (day: number, fields: Parameters<typeof post>[0] = {}) =>
    post({ goLiveAt: at(`2026-10-${day}T10:00:00Z`), ...fields });

  it('R2: warns on two life_style posts in a row on Instagram', () => {
    const second = on(20, { title: 'Cafe run' });
    expect(r2([on(19), second])).toEqual([
      ['warning', second.id, '"Cafe run" is the second life_style post in a row on instagram'],
    ]);
  });

  it('R2: no warning when pillars alternate', () => {
    expect(r2([on(19), on(20, { pillar: 'student_life' }), on(21)])).toEqual([]);
  });

  it('R2: no warning for the same pillar on different platforms', () => {
    expect(r2([on(19), on(20, { variants: [{ platform: 'tiktok', format: 'video' }] })])).toEqual(
      [],
    );
  });

  it('R2: compares with the previous variant even when it is before the window', () => {
    expect(r2([on(15), on(16), on(19)])).toHaveLength(1);
  });
});
