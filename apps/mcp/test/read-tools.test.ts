import { beforeAll, describe, expect, it } from 'vitest';
import { call, connect } from './harness';

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
