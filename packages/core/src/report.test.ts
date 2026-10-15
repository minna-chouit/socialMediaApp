import { describe, expect, it } from 'vitest';
import { at, post } from '../test/fixtures';
import type { Checkin } from './checkins';
import { DEFAULT_SETTINGS as S, type Post } from './model';
import { weeklyReport, type ReportData } from './report';

const REPORT_TIME = at('2026-10-23T19:00:00Z'); // Friday 20:00 Algiers
const data = (fields: Partial<ReportData> = {}): ReportData => ({
  posts: [],
  checkins: [],
  captureItems: [],
  followerSnapshots: [],
  ...fields,
});
const report = (fields: Partial<ReportData> = {}) => weeklyReport(data(fields), S, REPORT_TIME);
const planned = (posts: Post[]) => report({ posts }).platforms.instagram.planned;

const checkin = (fields: Partial<Checkin>): Checkin => ({
  variantId: 'v',
  dayOffset: 3,
  dueAt: at('2026-10-22T19:00:00Z'),
  views: null,
  reach: null,
  likes: null,
  comments: null,
  saves: null,
  shares: null,
  follows: null,
  avgWatchSeconds: null,
  ...fields,
});

describe('FR-17: weekly report', () => {
  it('FR-17: covers the planning week containing the report time', () => {
    expect(report().weekStart).toBe('2026-10-17');
  });

  it('FR-17: planned = variants going live in the week, approved or later at report time', () => {
    expect(planned([post()])).toBe(1);
    expect(planned([post({ status: 'proposed' })])).toBe(0);
    expect(planned([post({ status: 'archived' })])).toBe(0);
    expect(planned([post({ goLiveAt: at('2026-10-24T10:00:00Z') })])).toBe(0);
    expect(planned([post({ variants: [{ format: 'story' }] })])).toBe(1);
  });

  it('FR-17: done = planned variants with postedAt set', () => {
    const posted = post({ variants: [{ postedAt: at('2026-10-19T10:05:00Z') }] });
    expect(report({ posts: [posted, post()] }).platforms.instagram).toMatchObject({
      planned: 2,
      done: 1,
    });
  });

  it('FR-17: missed = planned, going live before report time, not posted', () => {
    const missed = post({ title: 'Gym vlog' });
    const later = post({ goLiveAt: at('2026-10-23T20:00:00Z') }); // Friday 21:00 local
    expect(report({ posts: [missed, later] }).missed).toEqual([
      {
        postId: missed.id,
        variantId: missed.variants[0].id,
        title: 'Gym vlog',
        platform: 'instagram',
        goLiveAt: '2026-10-19T11:00:00+01:00',
      },
    ]);
  });

  it('FR-17: completion rate per platform and overall; null when nothing was planned', () => {
    const posts = [
      post({ variants: [{ postedAt: at('2026-10-19T10:05:00Z') }] }),
      post(),
      post({ variants: [{ platform: 'tiktok', format: 'video', postedAt: REPORT_TIME }] }),
    ];
    const r = report({ posts });
    expect(r.platforms.instagram.completionRate).toBe(0.5);
    expect(r.platforms.tiktok.completionRate).toBe(1);
    expect(r.platforms.linkedin.completionRate).toBeNull();
    expect(r.total).toEqual({ planned: 3, done: 2, completionRate: 2 / 3 });
  });

  it("FR-17: includes the week's balance warnings", () => {
    expect(report({ posts: [post()] }).balanceWarnings).toContainEqual({
      rule: 'R4',
      severity: 'warning',
      message: 'No linkedin post in the week of 2026-10-17',
    });
  });

  it('FR-17: LinkedIn captured is yes only if a linkedin-capture item exists since Saturday 00:00', () => {
    const item = (iso: string, tags = ['linkedin-capture']) => ({ tags, createdAt: at(iso) });
    expect(report({ captureItems: [item('2026-10-16T22:59:00Z')] }).linkedinCaptured).toBe(false);
    expect(report({ captureItems: [item('2026-10-20T10:00:00Z', ['gym'])] }).linkedinCaptured).toBe(
      false,
    );
    expect(report({ captureItems: [item('2026-10-16T23:00:00Z')] }).linkedinCaptured).toBe(true);
  });

  it('FR-17: counts check-ins done and overdue (2 days past due)', () => {
    const checkins = [
      checkin({ doneAt: at('2026-10-20T19:00:00Z') }),
      checkin({ dueAt: at('2026-10-21T19:00:00Z') }), // overdue exactly at report time
      checkin({ dueAt: at('2026-10-21T19:01:00Z') }), // due but not yet overdue
    ];
    expect(report({ checkins }).checkins).toEqual({ done: 1, overdue: 1 });
  });

  it("FR-17: follower snapshot status lists platforms missing this week's count", () => {
    const followerSnapshots = [
      { platform: 'instagram', weekStart: '2026-10-17' },
      { platform: 'tiktok', weekStart: '2026-10-10' },
    ] as const;
    expect(report({ followerSnapshots: [...followerSnapshots] }).followerSnapshotsMissing).toEqual([
      'tiktok',
      'linkedin',
    ]);
  });
});
