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

describe('list_media', () => {
  it('list_media: tags filter, unusedOnly and short-lived signed thumbnail URLs', async () => {
    const media = async (path: string, tags: string, takenAt: string) =>
      (
        await c.pg.query<{ id: string }>(
          `insert into public.media (owner_id, storage_path, kind, tags, size_bytes, taken_at)
           values ($1, $2, 'photo', $3, 1000, $4) returning id`,
          [OWNER, path, tags, takenAt],
        )
      ).rows[0].id;
    const used = await media('o/campus-day.jpg', '{campus}', '2026-10-10T10:00:00Z');
    const unused = await media('o/campus-night.jpg', '{campus,night}', '2026-10-11T20:00:00Z');
    await media('o/gym.jpg', '{gym}', '2026-10-12T08:00:00Z');
    const { postId } = await seedPost(c.pg, { title: 'Campus', goLiveAt: '2026-10-20T17:00:00Z' });
    await c.pg.query(
      'insert into public.post_media (owner_id, post_id, media_id) values ($1, $2, $3)',
      [OWNER, postId, used],
    );

    const campus = await call(c, 'list_media', { tags: ['campus'] });
    expect(campus.map((m: { id: string }) => m.id)).toEqual([unused, used]);
    expect(campus[0]).toMatchObject({
      storagePath: 'o/campus-night.jpg',
      tags: ['campus', 'night'],
      takenAt: '2026-10-11T21:00:00+01:00',
      thumbnailUrl: 'https://storage.test/sign/o/campus-night.jpg?expiresIn=600',
    });
    const unusedCampus = await call(c, 'list_media', { tags: ['campus'], unusedOnly: true });
    expect(unusedCampus.map((m: { id: string }) => m.id)).toEqual([unused]);
  });
});

describe('get_weekly_report', () => {
  it('get_weekly_report: no report ready yet is a clear error', async () => {
    expect(await call(c, 'get_weekly_report')).toEqual({
      error: 'No weekly report is ready for Claude yet',
    });
  });

  it('get_weekly_report: defaults to the latest report the owner marked ready for Claude', async () => {
    const report = (week: string, ready: string | null) =>
      c.pg.query(
        `insert into public.weekly_reports (owner_id, week_start, payload, generated_at, ready_for_claude_at)
         values ($1, $2, $3, $4, $5)`,
        [OWNER, week, JSON.stringify({ weekStart: week }), `${week}T19:00:00Z`, ready],
      );
    await report('2026-10-10', '2026-10-16T21:00:00Z');
    await report('2026-10-17', '2026-10-23T21:00:00Z');
    await report('2026-10-24', null);
    expect(await call(c, 'get_weekly_report')).toEqual({
      weekStart: '2026-10-17',
      payload: { weekStart: '2026-10-17' },
      generatedAt: '2026-10-17T20:00:00+01:00',
      readyForClaudeAt: '2026-10-23T22:00:00+01:00',
    });
    expect(
      (await call(c, 'get_weekly_report', { weekStart: '2026-10-24' })).readyForClaudeAt,
    ).toBeNull();
  });
});

describe('get_checkins', () => {
  it('get_checkins: check-ins due in range with metrics; missing metrics stay null', async () => {
    const { variantIds } = await seedPost(
      c.pg,
      { title: 'Reel for check-ins', goLiveAt: '2026-09-28T17:00:00Z' },
      [{ platform: 'instagram', format: 'reel', postedAt: '2026-09-28T17:05:00Z' }],
    );
    const checkin = (offset: number, due: string, reach: number | null, doneAt: string | null) =>
      c.pg.query(
        `insert into public.checkins (owner_id, variant_id, day_offset, due_at, done_at, views, reach)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [OWNER, variantIds[0], offset, due, doneAt, reach === null ? null : reach * 3, reach],
      );
    await checkin(3, '2026-10-01T19:00:00Z', 400, '2026-10-01T19:30:00Z');
    await checkin(7, '2026-10-05T19:00:00Z', null, null);

    expect(await call(c, 'get_checkins', { from: '2026-10-01', to: '2026-10-03' })).toEqual([
      expect.objectContaining({
        variantId: variantIds[0],
        platform: 'instagram',
        title: 'Reel for check-ins',
        dayOffset: 3,
        dueAt: '2026-10-01T20:00:00+01:00',
        doneAt: '2026-10-01T20:30:00+01:00',
        views: 1200,
        reach: 400,
        likes: null,
        saves: null,
      }),
    ]);
    const [pending] = await call(c, 'get_checkins', { from: '2026-10-04', to: '2026-10-06' });
    expect(pending).toMatchObject({ dayOffset: 7, doneAt: null, views: null, reach: null });
  });
});

describe('get_follower_history', () => {
  it('get_follower_history: weekly counts, default 12 weeks, platform filter', async () => {
    const snapshot = (platform: string, week: string, count: number) =>
      c.pg.query(
        'insert into public.follower_snapshots (owner_id, platform, count, week_start) values ($1, $2, $3, $4)',
        [OWNER, platform, count, week],
      );
    // The clock is in the week of 17 Oct; 12 weeks including it start on 1 Aug, so 18 Jul is week 14.
    await snapshot('instagram', '2026-07-18', 90);
    await snapshot('instagram', '2026-10-10', 118);
    await snapshot('instagram', '2026-10-17', 120);
    await snapshot('tiktok', '2026-10-17', 40);

    expect(await call(c, 'get_follower_history', { platform: 'instagram' })).toEqual([
      { platform: 'instagram', weekStart: '2026-10-10', count: 118 },
      { platform: 'instagram', weekStart: '2026-10-17', count: 120 },
    ]);
    expect(await call(c, 'get_follower_history', {})).toHaveLength(3);
    expect(
      await call(c, 'get_follower_history', { platform: 'instagram', weeks: 14 }),
    ).toHaveLength(3);
  });
});

describe('get_metrics_summary', () => {
  it('get_metrics_summary: the tool summarises stored posts and day-7 check-ins for a month', async () => {
    const { variantIds } = await seedPost(
      c.pg,
      { title: 'Summary reel', pillar: 'pov_journey', goLiveAt: '2026-08-03T17:00:00Z' },
      [{ platform: 'instagram', format: 'reel', postedAt: '2026-08-03T17:02:00Z' }],
    );
    await c.pg.query(
      `insert into public.checkins (owner_id, variant_id, day_offset, due_at, views, saves)
       values ($1, $2, 7, '2026-08-10T19:00:00Z', 2000, 40)`,
      [OWNER, variantIds[0]],
    );
    const summary = await call(c, 'get_metrics_summary', { month: '2026-08' });
    expect(summary.month).toBe('2026-08');
    expect(summary.byPlatform.instagram).toMatchObject({
      variants: 1,
      totals: { views: 2000, saves: 40, likes: null },
    });
    expect(summary.byPillar.pov_journey.means.views).toBe(2000);
  });
});
