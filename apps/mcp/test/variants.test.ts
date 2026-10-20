import { beforeEach, describe, expect, it } from 'vitest';
import { call, connect, seedPost } from './harness';

let c: Awaited<ReturnType<typeof connect>>;
beforeEach(async () => {
  c = await connect();
}, 30_000);

// Tuesday of the week of 24 Oct 2026, in Algiers.
const goLiveAt = '2026-10-27T18:00:00Z';
const changeLog = async (entityId: string) =>
  (
    await c.pg.query<{ actor: string; field: string; reason: string }>(
      'select actor, field, reason from public.change_log where entity_id = $1 order by at, field',
      [entityId],
    )
  ).rows;

describe('add_variant', () => {
  it('add_variant: FR-29 adds a variant to a post, logged with the reason and a Claude badge', async () => {
    const { postId } = await seedPost(c.pg, { title: 'Gym vlog', goLiveAt });
    const { post, warnings } = await call(c, 'add_variant', {
      postId,
      variant: {
        platform: 'tiktok',
        format: 'video',
        hook: 'POV: 6am gym',
        hashtags: ['gym'],
        language: 'darija',
      },
      reason: 'Pair the reel with TikTok (R7)',
    });
    const added = post.variants.find((v: any) => v.platform === 'tiktok');
    expect(added).toMatchObject({
      format: 'video',
      hook: 'POV: 6am gym',
      hashtags: ['gym'],
      language: 'darija',
      scheduledAt: null, // goes live with the post
      createdBy: 'claude',
    });
    expect(warnings.some((w: any) => w.rule === 'R7')).toBe(false);
    expect(await changeLog(added.id)).toEqual([
      { actor: 'claude', field: 'created', reason: 'Pair the reel with TikTok (R7)' },
    ]);
  });

  it('add_variant: FR-29 a second variant on the same platform or a bad format is refused', async () => {
    const { postId } = await seedPost(c.pg, { title: 'Gym vlog', goLiveAt });
    const add = (platform: string, format: string) =>
      call(c, 'add_variant', { postId, variant: { platform, format }, reason: 'x' });
    expect((await add('instagram', 'carousel')).error).toBe(
      'a post can have only one instagram variant',
    );
    expect((await add('linkedin', 'reel')).error).toBe('linkedin does not support the reel format');
    const unknown = '99999999-9999-9999-9999-999999999999';
    expect(
      await call(c, 'add_variant', {
        postId: unknown,
        variant: { platform: 'tiktok', format: 'video' },
        reason: 'x',
      }),
    ).toEqual({ error: `No post with id ${unknown}` });
  });
});

describe('remove_variant', () => {
  it('remove_variant: FR-29 hides the variant, keeps it in the change log, and frees the platform', async () => {
    const {
      postId,
      variantIds: [, tiktok],
    } = await seedPost(c.pg, { title: 'Gym vlog', goLiveAt }, [
      { platform: 'instagram', format: 'reel' },
      { platform: 'tiktok', format: 'video' },
    ]);
    const { post } = await call(c, 'remove_variant', {
      id: tiktok,
      reason: 'TikTok is full this week',
    });
    expect(post.variants.map((v: any) => v.platform)).toEqual(['instagram']);
    expect(post.changeLog).toContainEqual(
      expect.objectContaining({
        actor: 'claude',
        field: 'removed_at',
        reason: 'TikTok is full this week',
      }),
    );
    const { rows } = await c.pg.query('select id from public.variants where id = $1', [tiktok]);
    expect(rows).toHaveLength(1); // hidden, not erased
    expect(
      await call(c, 'update_variant', { id: tiktok, patch: { hook: 'x' }, reason: 'x' }),
    ).toEqual({ error: `No variant with id ${tiktok}` });
    const again = await call(c, 'add_variant', {
      postId,
      variant: { platform: 'tiktok', format: 'photo' },
      reason: 'Photo mode instead',
    });
    expect(again.post.variants.map((v: any) => [v.platform, v.format])).toEqual([
      ['instagram', 'reel'],
      ['tiktok', 'photo'],
    ]);
  });

  it('remove_variant: FR-29 a posted variant or the post’s last variant is refused', async () => {
    const {
      variantIds: [ig, tiktok],
    } = await seedPost(c.pg, { title: 'Gym vlog', goLiveAt: '2026-10-20T18:00:00Z' }, [
      { platform: 'instagram', format: 'reel' },
      { platform: 'tiktok', format: 'video', postedAt: '2026-10-20T18:05:00Z' },
    ]);
    expect((await call(c, 'remove_variant', { id: tiktok, reason: 'x' })).error).toMatch(
      /already posted/,
    );
    const { variantIds } = await seedPost(c.pg, { title: 'Solo', goLiveAt });
    expect((await call(c, 'remove_variant', { id: variantIds[0], reason: 'x' })).error).toMatch(
      /only variant/,
    );
    expect((await call(c, 'remove_variant', { id: ig, reason: 'x' })).post).toBeDefined();
    const missing = '99999999-9999-9999-9999-999999999999';
    expect(await call(c, 'remove_variant', { id: missing, reason: 'x' })).toEqual({
      error: `No variant with id ${missing}`,
    });
  });

  it('remove_variant: FR-29 removed variants leave the calendar and the balance check', async () => {
    const {
      variantIds: [, tiktok],
    } = await seedPost(c.pg, { title: 'Gym vlog', goLiveAt }, [
      { platform: 'instagram', format: 'reel' },
      { platform: 'tiktok', format: 'video' },
    ]);
    const range = { from: '2026-10-24', to: '2026-10-30' };
    const r4 = async () =>
      (await call(c, 'check_balance', range))
        .filter((w: any) => w.rule === 'R4')
        .map((w: any) => w.message.split(' ')[1]);
    expect(await r4()).not.toContain('tiktok');
    await call(c, 'remove_variant', { id: tiktok, reason: 'Not this week' });
    expect((await call(c, 'get_calendar', range)).map((v: any) => v.platform)).toEqual([
      'instagram',
    ]);
    expect(await r4()).toContain('tiktok');
  });
});
