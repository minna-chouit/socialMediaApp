import { beforeEach, describe, expect, it } from 'vitest';
import { call, connect, OWNER, seedPost } from './harness';

let c: Awaited<ReturnType<typeof connect>>;
beforeEach(async () => {
  c = await connect();
}, 30_000);

const task = (fields: Record<string, unknown> = {}) =>
  call(c, 'create_task', {
    title: 'Shoot B-roll at the lab',
    type: 'shoot',
    dueAt: '2026-10-22T17:00:00+01:00',
    reason: 'Needed before Thursday',
    ...fields,
  });
const ownerTask = async () =>
  (
    await c.pg.query<{ id: string }>(
      `insert into public.tasks (owner_id, title, due_at) values ($1, 'Owner task', '2026-10-22T16:00:00Z') returning id`,
      [OWNER],
    )
  ).rows[0].id;

describe('tasks through the connector', () => {
  it('create_task: stores a Claude task, optionally linked to a post, and logs it', async () => {
    const { postId } = await seedPost(c.pg, { title: 'Lab day', goLiveAt: '2026-10-23T17:00:00Z' });
    const created = await task({ postId, notes: 'Wide and close-up shots' });
    expect(created).toMatchObject({
      title: 'Shoot B-roll at the lab',
      type: 'shoot',
      dueAt: '2026-10-22T17:00:00+01:00',
      done: false,
      postId,
      createdBy: 'claude',
      notes: 'Wide and close-up shots',
    });
    const { rows } = await c.pg.query(
      'select actor, field from public.change_log where entity_id = $1',
      [created.id],
    );
    expect(rows).toEqual([{ actor: 'claude', field: 'created' }]);
    expect((await call(c, 'get_post', { id: postId })).tasks.map((t: any) => t.id)).toEqual([
      created.id,
    ]);
  });

  it('create_task: an unknown post is a clear error', async () => {
    const postId = '99999999-9999-9999-9999-999999999999';
    expect(await task({ postId })).toEqual({ error: `No post with id ${postId}` });
  });

  it('list_tasks: by date range, post and done; deleted tasks are hidden', async () => {
    const a = await task();
    const b = await task({
      title: 'Edit the reel',
      type: 'edit',
      dueAt: '2026-10-24T12:00:00+01:00',
    });
    await call(c, 'update_task', { id: b.id, patch: { done: true }, reason: 'Done' });
    const titles = async (args: Record<string, unknown>) =>
      (await call(c, 'list_tasks', args)).map((t: any) => t.title);
    expect(await titles({ from: '2026-10-22', to: '2026-10-24' })).toEqual([
      'Shoot B-roll at the lab',
      'Edit the reel',
    ]);
    expect(await titles({ from: '2026-10-22', to: '2026-10-22' })).toEqual([
      'Shoot B-roll at the lab',
    ]);
    expect(await titles({ from: '2026-10-22', to: '2026-10-24', done: true })).toEqual([
      'Edit the reel',
    ]);
    await call(c, 'delete_task', { id: a.id, reason: 'Not needed' });
    expect(await titles({ from: '2026-10-22', to: '2026-10-24' })).toEqual(['Edit the reel']);
  });

  it('update_task: patches fields; marking done records completedAt; logged as claude', async () => {
    const { id } = await task();
    const updated = await call(c, 'update_task', {
      id,
      patch: { done: true, notes: 'Got 12 clips' },
      reason: 'Shot today',
    });
    expect(updated).toMatchObject({ done: true, notes: 'Got 12 clips' });
    expect(updated.completedAt).not.toBeNull();
    const { rows } = await c.pg.query<{ actor: string; field: string; reason: string }>(
      `select actor, field, reason from public.change_log where entity_id = $1 and field <> 'created' order by field`,
      [id],
    );
    expect(rows.map((r) => [r.actor, r.field, r.reason])).toEqual([
      ['claude', 'completed_at', 'Shot today'],
      ['claude', 'done', 'Shot today'],
      ['claude', 'notes', 'Shot today'],
    ]);
  });

  it('delete_task: hides a task Claude created without erasing it; owner tasks need the owner', async () => {
    const { id } = await task();
    expect(await call(c, 'delete_task', { id, reason: 'Duplicate' })).toEqual({
      id,
      deleted: true,
    });
    const { rows } = await c.pg.query<{ hidden: boolean }>(
      'select cancelled_at is not null as hidden from public.tasks where id = $1',
      [id],
    );
    expect(rows).toEqual([{ hidden: true }]);
    expect(await call(c, 'update_task', { id, patch: { done: true }, reason: 'x' })).toEqual({
      error: `No task with id ${id}`,
    });
    const mine = await ownerTask();
    expect((await call(c, 'delete_task', { id: mine, reason: 'Tidy up' })).error).toMatch(
      /ask the owner/,
    );
  });

  it('withdraw_post: archives your own proposal with the reason; nothing else', async () => {
    const { post } = await call(c, 'propose_post', {
      title: 'Reel idea',
      pillar: 'life_style',
      topics: [],
      goLiveAt: '2026-10-27T19:00:00+01:00',
      variants: [{ platform: 'instagram', format: 'reel' }],
      reason: 'Fills the slot',
    });
    const withdrawn = await call(c, 'withdraw_post', {
      id: post.id,
      reason: 'Clashes with the gym vlog',
    });
    expect(withdrawn.status).toBe('archived');
    const { rows } = await c.pg.query<{ actor: string; reason: string }>(
      `select actor, reason from public.change_log where entity_id = $1 and field = 'status'`,
      [post.id],
    );
    expect(rows).toEqual([{ actor: 'claude', reason: 'Clashes with the gym vlog' }]);
    expect((await call(c, 'withdraw_post', { id: post.id, reason: 'again' })).error).toMatch(
      /still in the inbox/,
    );
    const { postId: owners } = await seedPost(c.pg, {
      title: 'Mine',
      status: 'proposed',
      goLiveAt: '2026-10-27T17:00:00Z',
    });
    expect((await call(c, 'withdraw_post', { id: owners, reason: 'x' })).error).toMatch(
      /your own proposals/,
    );
  });
});
