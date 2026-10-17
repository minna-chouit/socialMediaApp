import { beforeAll, describe, expect, it } from 'vitest';
import { call, connect, seedPost } from './harness';

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
