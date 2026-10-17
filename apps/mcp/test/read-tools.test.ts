import { beforeAll, describe, expect, it } from 'vitest';
import { call, connect, OWNER, seedPost } from './harness';

let c: Awaited<ReturnType<typeof connect>>;
beforeAll(async () => {
  c = await connect();
}, 30_000);

describe('get_settings', () => {
  it("get_settings: returns the owner's settings", async () => {
    expect(await call(c, 'get_settings')).toEqual({
      timezone: 'Africa/Algiers',
      phase: 1,
      reportTime: '20:00',
      batchTime: '20:15',
      replyWindowMinutes: 15,
      quietStart: '23:30',
      quietEnd: '08:00',
      checkinOffsets: { instagram: [3, 7], tiktok: [3, 7, 14], linkedin: [3, 7] },
      ruleParams: {},
      workOnPersonal: false,
      replyRemindersTikTok: false,
      maxUploadMb: 100,
      firstPostAt: null,
    });
  });
});

describe('get_calendar', () => {
  it('get_calendar: variants with post summary, stage and local times for a date range', async () => {
    const lab = await seedPost(
      c.pg,
      { title: 'Lab day', pillar: 'student_life', goLiveAt: '2026-10-21T17:00:00Z' },
      [
        { platform: 'instagram', format: 'reel' },
        { platform: 'tiktok', format: 'video', scheduledAt: '2026-10-23T22:30:00Z' }, // Fri 23:30 local
      ],
    );
    await seedPost(c.pg, {
      title: 'Archived',
      status: 'archived',
      goLiveAt: '2026-10-22T17:00:00Z',
    });
    await seedPost(c.pg, { title: 'Next week', goLiveAt: '2026-10-23T23:00:00Z' }); // Sat 00:00 local
    expect(await call(c, 'get_calendar', { from: '2026-10-17', to: '2026-10-23' })).toEqual([
      {
        variantId: lab.variantIds[0],
        postId: lab.postId,
        title: 'Lab day',
        pillar: 'student_life',
        stage: 'approved',
        platform: 'instagram',
        format: 'reel',
        goLiveAt: '2026-10-21T18:00:00+01:00',
        scheduledNatively: false,
        postedAt: null,
      },
      {
        variantId: lab.variantIds[1],
        postId: lab.postId,
        title: 'Lab day',
        pillar: 'student_life',
        stage: 'approved',
        platform: 'tiktok',
        format: 'video',
        goLiveAt: '2026-10-23T23:30:00+01:00',
        scheduledNatively: false,
        postedAt: null,
      },
    ]);
  });
});

describe('get_post', () => {
  it('get_post: post with variants, linked media and change log', async () => {
    const { postId, variantIds } = await seedPost(c.pg, {
      title: 'Dorm tour',
      goLiveAt: '2026-10-20T17:00:00Z',
    });
    const {
      rows: [media],
    } = await c.pg.query<{ id: string }>(
      `insert into public.media (owner_id, storage_path, kind, size_bytes) values ($1, 'o/a.jpg', 'photo', 10) returning id`,
      [OWNER],
    );
    await c.pg.query(
      'insert into public.post_media (owner_id, post_id, media_id) values ($1, $2, $3)',
      [OWNER, postId, media.id],
    );
    await c.pg.query(`update public.posts set title = 'Dorm tour v2' where id = $1`, [postId]);

    const post = await call(c, 'get_post', { id: postId });
    expect(post).toMatchObject({
      id: postId,
      title: 'Dorm tour v2',
      status: 'approved',
      goLiveAt: '2026-10-20T18:00:00+01:00',
      variants: [{ id: variantIds[0], platform: 'instagram', format: 'reel', postedAt: null }],
      media: [{ id: media.id, storagePath: 'o/a.jpg', kind: 'photo' }],
      changeLog: [
        { actor: 'owner', field: 'title', oldValue: 'Dorm tour', newValue: 'Dorm tour v2' },
      ],
    });
  });

  it('get_post: an unknown id returns a not-found error', async () => {
    const id = '99999999-9999-9999-9999-999999999999';
    expect(await call(c, 'get_post', { id })).toEqual({ error: `No post with id ${id}` });
  });
});

describe('check_balance', () => {
  const week = { from: '2026-11-07', to: '2026-11-13' }; // an empty planning week
  const linkedinLifeStyle = {
    title: 'Dorm tour on LinkedIn',
    pillar: 'life_style',
    topics: [],
    goLiveAt: '2026-11-10T12:00:00+01:00',
    variants: [{ platform: 'linkedin', format: 'text' }],
  };

  it('check_balance: warnings for the range, with a hypothetical post', async () => {
    const without = await call(c, 'check_balance', week);
    expect(without.filter((w: { rule: string }) => w.rule === 'R5')).toEqual([]);
    expect(without).toContainEqual({
      rule: 'R4',
      severity: 'warning',
      message: 'No instagram post in the week of 2026-11-07',
    });

    const withPost = await call(c, 'check_balance', { ...week, hypothetical: linkedinLifeStyle });
    expect(withPost).toContainEqual({
      rule: 'R5',
      severity: 'error',
      postId: 'hypothetical',
      message:
        'LinkedIn variant of "Dorm tour on LinkedIn" is life_style; LinkedIn takes work_lessons or pov_journey only',
    });
  });
});

describe('list_ideas', () => {
  it('list_ideas: filters by status, limits, and includes the latest verdict', async () => {
    const idea = async (text: string, status: string, at: string) =>
      (
        await c.pg.query<{ id: string }>(
          `insert into public.ideas (owner_id, text, source, status, created_at) values ($1, $2, 'phone', $3, $4) returning id`,
          [OWNER, text, status, at],
        )
      ).rows[0].id;
    await idea('Gym vlog', 'new', '2026-10-01T10:00:00Z');
    const reviewed = await idea('Exam week POV', 'reviewed', '2026-10-02T10:00:00Z');
    await idea('Thrift haul', 'banked', '2026-10-03T10:00:00Z');
    const verdict = (total: number, verdict: string, scores: string, at: string) =>
      c.pg.query(
        `insert into public.idea_verdicts (owner_id, idea_id, scores, total, verdict, notes, alternatives, by, created_at)
         values ($1, $2, $3, $4, $5, 'notes', '{"Try a carousel"}', 'claude', $6)`,
        [OWNER, reviewed, scores, total, verdict, at],
      );
    await verdict(
      7,
      'bank',
      '{"forwardable":1,"fills_gap":1,"doable":2,"original":2,"hook":1}',
      '2026-10-02T11:00:00Z',
    );
    await verdict(
      11,
      'go',
      '{"forwardable":3,"fills_gap":2,"doable":2,"original":2,"hook":2}',
      '2026-10-04T11:00:00Z',
    );

    const [onlyReviewed, ...rest] = await call(c, 'list_ideas', { status: 'reviewed' });
    expect(rest).toEqual([]);
    expect(onlyReviewed).toMatchObject({
      id: reviewed,
      text: 'Exam week POV',
      status: 'reviewed',
      latestVerdict: { verdict: 'go', total: 11, alternatives: ['Try a carousel'], by: 'claude' },
    });

    const newestTwo = await call(c, 'list_ideas', { limit: 2 });
    expect(
      newestTwo.map((i: { text: string; latestVerdict: unknown }) => [i.text, i.latestVerdict]),
    ).toEqual([
      ['Thrift haul', null],
      ['Exam week POV', expect.objectContaining({ verdict: 'go' })],
    ]);
  });
});
