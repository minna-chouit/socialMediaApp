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

describe('propose_post', () => {
  const proposal = {
    title: 'Exam week POV',
    pillar: 'student_life',
    topics: [],
    goLiveAt: '2026-10-27T19:00:00+01:00', // Tuesday of the week of 24 Oct
    variants: [
      { platform: 'instagram', format: 'reel', hook: 'Three exams, one week' },
      { platform: 'tiktok', format: 'video', scheduledAt: '2026-10-27T21:00:00+01:00' },
    ],
    reason: 'Student_life is under target this month',
  };

  it('propose_post: saved as proposed whatever is sent, with variants and balance warnings', async () => {
    const { id: ideaId } = await call(c, 'create_idea', { text: 'Exam week', reason: 'From chat' });
    const result = await call(c, 'propose_post', { ...proposal, ideaId, status: 'approved' });
    expect(result.post).toMatchObject({
      title: 'Exam week POV',
      status: 'proposed',
      createdBy: 'claude',
      ideaId,
      goLiveAt: '2026-10-27T19:00:00+01:00',
      variants: [
        { platform: 'instagram', format: 'reel', hook: 'Three exams, one week' },
        { platform: 'tiktok', format: 'video', scheduledAt: '2026-10-27T21:00:00+01:00' },
      ],
    });
    expect(result.warnings).toContainEqual({
      rule: 'R4',
      severity: 'warning',
      message: 'No linkedin post in the week of 2026-10-24',
    });
    expect((await call(c, 'list_ideas', {}))[0].status).toBe('promoted');
    expect(await changeLog(result.post.id)).toEqual([
      expect.objectContaining({ actor: 'claude', field: 'created', reason: proposal.reason }),
    ]);
  });

  it('propose_post: a LinkedIn reel is rejected with a clear message', async () => {
    const result = await call(c, 'propose_post', {
      ...proposal,
      pillar: 'work_lessons',
      variants: [{ platform: 'linkedin', format: 'reel' }],
    });
    expect(result).toEqual({ error: 'linkedin does not support the reel format' });
    expect(await call(c, 'get_calendar', { from: '2026-10-24', to: '2026-10-30' })).toEqual([]);
  });
});

describe('update_post', () => {
  const propose = async () =>
    (
      await call(c, 'propose_post', {
        title: 'Gym vlog',
        pillar: 'life_style',
        topics: [],
        goLiveAt: '2026-10-27T19:00:00+01:00',
        variants: [{ platform: 'instagram', format: 'reel' }],
        reason: 'Fills the life_style slot',
      })
    ).post.id as string;

  it('update_post: applies the patch and logs actor claude with the reason', async () => {
    const id = await propose();
    const result = await call(c, 'update_post', {
      id,
      patch: { title: 'Gym vlog: leg day', goLiveAt: '2026-10-28T19:00:00+01:00' },
      reason: 'Wednesday has no other post',
    });
    expect(result.post).toMatchObject({
      id,
      title: 'Gym vlog: leg day',
      goLiveAt: '2026-10-28T19:00:00+01:00',
      status: 'proposed',
    });
    expect(Array.isArray(result.warnings)).toBe(true);
    const updates = (await changeLog(id)).filter((row) => row.field !== 'created');
    expect(updates.map((row) => [row.actor, row.field, row.reason])).toEqual([
      ['claude', 'go_live_at', 'Wednesday has no other post'],
      ['claude', 'title', 'Wednesday has no other post'],
    ]);
  });

  it('update_post: a patch with status or postedAt is rejected', async () => {
    const id = await propose();
    for (const patch of [{ status: 'approved' }, { postedAt: '2026-10-27T19:00:00+01:00' }]) {
      const result = await call(c, 'update_post', { id, patch, reason: 'Approve it' });
      expect(result.error).toMatch(/status|postedAt/);
    }
    expect((await call(c, 'get_post', { id })).status).toBe('proposed');
  });

  it('update_post: an unknown post is a clear error', async () => {
    const id = '99999999-9999-9999-9999-999999999999';
    expect(await call(c, 'update_post', { id, patch: { title: 'x' }, reason: 'y' })).toEqual({
      error: `No post with id ${id}`,
    });
  });
});
