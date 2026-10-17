import { beforeEach, describe, expect, it } from 'vitest';
import { call, connect } from './harness';

let c: Awaited<ReturnType<typeof connect>>;
beforeEach(async () => {
  c = await connect();
}, 30_000);

const changeLog = async (entityId: string) =>
  (
    await c.pg.query<{ actor: string; field: string; reason: string; new_value: unknown }>(
      'select actor, field, reason, new_value from public.change_log where entity_id = $1 order by at, field',
      [entityId],
    )
  ).rows;

describe('create_idea', () => {
  it('create_idea: stores the idea with source chat and logs it', async () => {
    const idea = await call(c, 'create_idea', {
      text: 'Day in the life during exam week',
      pillar: 'student_life',
      topics: ['ai'],
      tags: ['exams'],
      reason: 'Fills the student_life gap this month',
    });
    expect(idea).toMatchObject({
      text: 'Day in the life during exam week',
      source: 'chat',
      status: 'new',
      pillar: 'student_life',
      topics: ['ai'],
      tags: ['exams'],
    });
    expect(await changeLog(idea.id)).toEqual([
      {
        actor: 'claude',
        field: 'created',
        reason: 'Fills the student_life gap this month',
        new_value: expect.objectContaining({ text: 'Day in the life during exam week' }),
      },
    ]);
  });
});

describe('review_idea', () => {
  const scores = { forwardable: 3, fills_gap: 2, doable: 2, original: 2, hook: 2 }; // 11
  const newIdea = async () =>
    (await call(c, 'create_idea', { text: 'Campus at 6am', reason: 'From chat' })).id as string;

  it('review_idea: the verdict is computed by core; a total sent by the client is ignored', async () => {
    const ideaId = await newIdea();
    const stored = await call(c, 'review_idea', {
      ideaId,
      scores,
      notes: 'Strong hook; make the first second count.',
      alternatives: ['Shoot it as a carousel'],
      total: 3,
      verdict: 'bank',
    });
    expect(stored).toMatchObject({
      ideaId,
      total: 11,
      verdict: 'go',
      by: 'claude',
      alternatives: ['Shoot it as a carousel'],
    });
    const [idea] = await call(c, 'list_ideas', {});
    expect(idea).toMatchObject({
      id: ideaId,
      status: 'reviewed',
      latestVerdict: { verdict: 'go', total: 11 },
    });
    expect((await changeLog(ideaId)).map((row) => [row.actor, row.field])).toEqual([
      ['claude', 'created'],
      ['claude', 'verdict'],
    ]);
  });

  it('review_idea: a bank verdict banks the idea', async () => {
    const ideaId = await newIdea();
    const low = { forwardable: 1, fills_gap: 1, doable: 2, original: 1, hook: 1 };
    await call(c, 'review_idea', {
      ideaId,
      scores: low,
      notes: 'Not forwardable.',
      alternatives: ['Pair it with a POV'],
    });
    expect((await call(c, 'list_ideas', {}))[0].status).toBe('banked');
  });

  it('review_idea: at least one alternative is required', async () => {
    const ideaId = await newIdea();
    const result = await call(c, 'review_idea', {
      ideaId,
      scores,
      notes: 'Fine.',
      alternatives: [],
    });
    expect(result.error).toMatch(/alternatives/);
  });

  it('review_idea: an unknown idea is a clear error', async () => {
    const ideaId = '99999999-9999-9999-9999-999999999999';
    const result = await call(c, 'review_idea', {
      ideaId,
      scores,
      notes: 'x',
      alternatives: ['y'],
    });
    expect(result).toEqual({ error: `No idea with id ${ideaId}` });
  });
});
