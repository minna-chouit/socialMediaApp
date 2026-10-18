import type { PGlite } from '@electric-sql/pglite';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAppHandler, runAction } from '../src/app';
import type { PushPayload, PushTarget } from '../src/push';
import type { ServerDeps } from '../src/server';
import { freshDatabase, NOW, OWNER, pgliteDb, seedPost } from './harness';

let pg: PGlite;
let deps: ServerDeps;
beforeEach(async () => {
  pg = await freshDatabase();
  deps = {
    db: pgliteDb(pg, 'authenticated'),
    ownerId: OWNER,
    clock: { now: () => NOW },
    signUrl: async () => null,
  };
}, 30_000);

const app = (action: string, args: Record<string, unknown> = {}) =>
  runAction(deps, action, args) as Promise<any>;
const log = async (id: string) =>
  (
    await pg.query<{ actor: string; field: string; reason: string | null }>(
      'select actor, field, reason from public.change_log where entity_id = $1 order by at, field',
      [id],
    )
  ).rows;

describe('owner web app', () => {
  it('FR-7: the inbox lists proposed posts with their balance warnings', async () => {
    const { postId } = await seedPost(pg, {
      title: 'From Claude',
      status: 'proposed',
      goLiveAt: '2026-10-22T17:00:00Z',
    });
    await seedPost(pg, { title: 'Already approved', goLiveAt: '2026-10-22T17:00:00Z' });
    const inbox = await app('inbox');
    expect(inbox.map((i: any) => i.post.id)).toEqual([postId]);
    // Judged as if approved: the proposal's own Instagram reel counts, so only the others are missing.
    const r4 = inbox[0].warnings.filter((w: any) => w.rule === 'R4').map((w: any) => w.message);
    expect(r4).toEqual([
      'No tiktok post in the week of 2026-10-17',
      'No linkedin post in the week of 2026-10-17',
    ]);
  });

  it('FR-7: approve moves a proposed post to approved, logged as the owner', async () => {
    const { postId } = await seedPost(pg, {
      title: 'From Claude',
      status: 'proposed',
      goLiveAt: '2026-10-22T17:00:00Z',
    });
    expect((await app('approve', { id: postId })).status).toBe('approved');
    expect(await log(postId)).toEqual([{ actor: 'owner', field: 'status', reason: null }]);
  });

  it('FR-7: reject archives with a reason, logged as the owner', async () => {
    const { postId } = await seedPost(pg, {
      title: 'Meh',
      status: 'proposed',
      goLiveAt: '2026-10-22T17:00:00Z',
    });
    await expect(app('reject', { id: postId, reason: ' ' })).rejects.toThrow('Say why');
    expect((await app('reject', { id: postId, reason: 'Too similar to last week' })).status).toBe(
      'archived',
    );
    expect(await log(postId)).toEqual([
      { actor: 'owner', field: 'status', reason: 'Too similar to last week' },
    ]);
  });

  it('FR-2: advance moves one stage forward and stops at reviewed', async () => {
    const { postId } = await seedPost(pg, { title: 'Next', goLiveAt: '2026-10-22T17:00:00Z' });
    expect((await app('advance', { id: postId })).status).toBe('capture');
    await pg.query(`update public.posts set status = 'reviewed' where id = $1`, [postId]);
    await expect(app('advance', { id: postId })).rejects.toThrow(
      'A reviewed post has no next stage',
    );
  });

  it('FR-5: mark posted sets postedAt and creates the check-ins', async () => {
    const { postId, variantIds } = await seedPost(
      pg,
      { title: 'Live', goLiveAt: '2026-10-21T10:00:00Z' },
      [{ platform: 'tiktok', format: 'video' }],
    );
    const post = await app('mark_posted', { variantId: variantIds[0] });
    expect(post.id).toBe(postId);
    expect(post.variants[0].postedAt).toBe('2026-10-21T12:00:00+01:00');
    const offsets = await pg.query<{ day_offset: number }>(
      'select day_offset from public.checkins order by day_offset',
    );
    expect(offsets.rows.map((r) => r.day_offset)).toEqual([3, 7, 14]);
    await expect(app('mark_posted', { variantId: variantIds[0] })).rejects.toThrow(
      'Already marked posted',
    );
  });

  it('FR-6: the week runs Saturday to Friday in local time; changing a date is one update', async () => {
    const { postId } = await seedPost(pg, { title: 'Tuesday', goLiveAt: '2026-10-20T17:00:00Z' });
    const week = await app('week');
    expect([week.weekStart, week.weekEnd]).toEqual(['2026-10-17', '2026-10-23']);
    expect(week.items.map((i: any) => [i.title, i.goLiveAt])).toEqual([
      ['Tuesday', '2026-10-20T18:00:00+01:00'],
    ]);
    await app('update_post', { id: postId, patch: { goLiveAt: '2026-10-27T18:00:00+01:00' } });
    expect((await app('week')).items).toEqual([]);
    expect((await app('week', { offset: 1 })).items).toHaveLength(1);
    expect(await log(postId)).toEqual([{ actor: 'owner', field: 'go_live_at', reason: null }]);
  });

  it('FR-9: an idea is added with its source', async () => {
    const idea = await app('add_idea', { text: 'Sunset run', source: 'phone' });
    expect(idea).toMatchObject({ text: 'Sunset run', source: 'phone', status: 'new' });
    expect((await app('ideas')).map((i: any) => i.text)).toEqual(['Sunset run']);
  });

  it('FR-28: the app API needs the secret key header', async () => {
    const secret = 'not-a-real-secret-'.padEnd(40, 'x');
    const http = createHttpServer(createAppHandler({ secret, deps }));
    await new Promise<void>((resolve) => http.listen(0, resolve));
    const url = `http://localhost:${(http.address() as AddressInfo).port}/api/app`;
    const post = (key: string) =>
      fetch(url, {
        method: 'POST',
        headers: { 'x-cadence-key': key },
        body: JSON.stringify({ action: 'ideas' }),
      });
    expect((await post('wrong')).status).toBe(404);
    const ok = await post(secret);
    expect([ok.status, await ok.json()]).toEqual([200, []]);
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });
});

describe('owner web app: today, check-ins, followers, report', () => {
  it('FR-13: today lists the reminders still due, with what they are about', async () => {
    await seedPost(pg, { title: 'Wednesday reel', goLiveAt: '2026-10-21T17:00:00Z' }); // today 18:00 local
    const today = await app('today');
    expect(today.map((r: any) => [r.code, r.at, r.about])).toEqual([
      ['POST_NOW', '2026-10-21T18:00:00+01:00', 'Wednesday reel (instagram)'],
    ]);
  });

  it('FR-21: approving the first post seeds the milestones', async () => {
    const { postId } = await seedPost(pg, {
      title: 'First',
      status: 'proposed',
      goLiveAt: '2026-10-21T17:00:00Z',
    });
    await app('approve', { id: postId });
    const { rows } = await pg.query<{ kind: string; week: number }>(
      'select kind, week from public.milestones order by due_at',
    );
    expect(rows.map((r) => r.week)).toEqual([1, 2, 4, 6, 10, 13, 26, 39, 52]);
    const { rows: settings } = await pg.query<{ set: boolean }>(
      'select first_post_at is not null as set from public.settings',
    );
    expect(settings[0].set).toBe(true);
  });

  it('FR-19: logging a check-in saves metrics, keeps blanks null and marks it done', async () => {
    const { variantIds } = await seedPost(pg, { title: 'Live', goLiveAt: '2026-10-18T10:00:00Z' });
    await app('mark_posted', { variantId: variantIds[0] });
    const { rows } = await pg.query<{ id: string }>(
      'select id from public.checkins where day_offset = 3',
    );
    await app('log_checkin', { id: rows[0].id, metrics: { views: 1200, reach: '', saves: '14' } });
    const { rows: saved } = await pg.query(
      'select views, reach, saves, done_at is not null as done from public.checkins where id = $1',
      [rows[0].id],
    );
    expect(saved[0]).toEqual({ views: 1200, reach: null, saves: 14, done: true });
    await expect(app('log_checkin', { id: rows[0].id, metrics: { views: -3 } })).rejects.toThrow(
      '0 or more',
    );
  });

  it('FR-20: follower counts are logged once per platform per week', async () => {
    await app('log_followers', { platform: 'instagram', count: 120 });
    await app('log_followers', { platform: 'instagram', count: 125 });
    const followers = await app('followers');
    expect(followers.weekStart).toBe('2026-10-17');
    expect(followers.missing).toEqual(['tiktok', 'linkedin']);
    expect(followers.history).toEqual([
      { platform: 'instagram', weekStart: '2026-10-17', count: 125 },
    ]);
  });

  it('FR-18: sending the report saves it and marks it ready for Claude', async () => {
    await seedPost(pg, { title: 'Monday', goLiveAt: '2026-10-19T17:00:00Z' });
    const { live } = await app('report');
    expect(live).toMatchObject({ weekStart: '2026-10-17', total: { planned: 1, done: 0 } });
    expect(await app('send_report')).toMatchObject({
      weekStart: '2026-10-17',
      readyForClaudeAt: '2026-10-21T12:00:00+01:00',
    });
    await app('send_report'); // again: only readiness changes, the payload stays immutable
    expect((await app('report')).sent).toHaveLength(1);
  });
});

describe('owner web app: push notifications', () => {
  const pushed: { endpoint: string; title: string; body: string; url: string }[] = [];
  const gone = new Set<string>();
  const withPush = () => {
    pushed.length = 0;
    deps = {
      ...deps,
      appUrl: 'https://cadence.test/app/key',
      vapidPublicKey: 'public-key',
      push: async (target: PushTarget, payload: PushPayload) => {
        if (gone.has(target.endpoint)) return 'gone';
        pushed.push({ endpoint: target.endpoint, ...payload });
        return 'sent';
      },
    } as typeof deps;
  };
  const subscribe = (endpoint: string) =>
    app('subscribe', {
      subscription: { endpoint, keys: { p256dh: 'p', auth: 'a' } },
      deviceLabel: 'iPhone',
    });

  it('FR-14: a due reminder is pushed once to every device; running again sends nothing (NFR-7)', async () => {
    withPush();
    await subscribe('https://push.test/phone');
    await subscribe('https://push.test/laptop');
    await seedPost(pg, { title: 'Noon reel', goLiveAt: '2026-10-21T11:00:00Z' }); // now
    expect(await app('tick')).toEqual({ sent: 1, skipped: 1, devices: 2 }); // REPLY_START skipped: not posted
    expect(pushed.map((p) => [p.endpoint, p.title, p.body, p.url])).toEqual([
      [
        'https://push.test/phone',
        'Post now',
        'Noon reel (instagram)',
        'https://cadence.test/app/key',
      ],
      [
        'https://push.test/laptop',
        'Post now',
        'Noon reel (instagram)',
        'https://cadence.test/app/key',
      ],
    ]);
    expect(await app('tick')).toEqual({ sent: 0, skipped: 0, devices: 2 });
    expect(pushed).toHaveLength(2);
  });

  it('FR-14: a reminder more than 30 minutes late is skipped, not sent', async () => {
    withPush();
    await subscribe('https://push.test/phone');
    await seedPost(pg, { title: 'Earlier', goLiveAt: '2026-10-21T10:00:00Z' }); // an hour ago
    expect((await app('tick')).sent).toBe(0);
    expect(pushed).toEqual([]);
  });

  it('FR-14: a device that unsubscribed is forgotten', async () => {
    withPush();
    await subscribe('https://push.test/old');
    await subscribe('https://push.test/old'); // subscribing again updates, not duplicates
    gone.add('https://push.test/old');
    await seedPost(pg, { title: 'Noon reel', goLiveAt: '2026-10-21T11:00:00Z' });
    await app('tick');
    const { rows } = await pg.query('select endpoint from public.push_subscriptions');
    expect(rows).toEqual([]);
  });

  it('FR-14: the page can read the public VAPID key', async () => {
    withPush();
    expect(await app('push_key')).toEqual({ publicKey: 'public-key' });
  });
});

describe('owner web app: tasks', () => {
  it('tasks: today lists overdue tasks first, then today; done overdue ones drop off', async () => {
    const add = (title: string, dueAt: string) => app('add_task', { title, type: 'shoot', dueAt });
    const late = await add('Late one', '2026-10-20T10:00:00+01:00');
    await add('Today one', '2026-10-21T18:00:00+01:00');
    await add('Tomorrow', '2026-10-22T09:00:00+01:00');
    const today = await app('tasks_today');
    expect(today.map((t: any) => [t.title, t.overdue, t.createdBy])).toEqual([
      ['Late one', true, 'owner'],
      ['Today one', false, 'owner'],
    ]);
    await app('update_task', { id: late.id, patch: { done: true } });
    expect((await app('tasks_today')).map((t: any) => t.title)).toEqual(['Today one']);
  });

  it('tasks: a post shows its tasks in the editor and the week; the owner can delete', async () => {
    const { postId } = await seedPost(pg, { title: 'Lab day', goLiveAt: '2026-10-22T17:00:00Z' });
    const t = await app('add_task', {
      title: 'Edit lab clips',
      type: 'edit',
      dueAt: '2026-10-21T20:00:00+01:00',
      postId,
    });
    expect((await app('post', { id: postId })).tasks.map((x: any) => x.title)).toEqual([
      'Edit lab clips',
    ]);
    expect((await app('week')).tasks.map((x: any) => [x.postId, x.title])).toEqual([
      [postId, 'Edit lab clips'],
    ]);
    await app('delete_task', { id: t.id });
    expect((await app('post', { id: postId })).tasks).toEqual([]);
  });

  it('tasks: a title and due time are required', async () => {
    await expect(
      app('add_task', { title: ' ', dueAt: '2026-10-21T18:00:00+01:00' }),
    ).rejects.toThrow('title');
    await expect(app('add_task', { title: 'x' })).rejects.toThrow('due');
  });
});
