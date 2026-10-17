import type { PGlite } from '@electric-sql/pglite';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAppHandler, runAction } from '../src/app';
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
    expect(inbox[0].warnings).toContainEqual(expect.objectContaining({ rule: 'R4' }));
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
