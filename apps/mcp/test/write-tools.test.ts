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
