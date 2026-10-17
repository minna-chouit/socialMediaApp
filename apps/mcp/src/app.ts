// The owner's web app API (FR-6, FR-7, FR-9 basics): one POST endpoint taking { action, args }.
// Runs as the owner (role authenticated), so change_log records actor = owner and stage moves are
// allowed, within core's canMove rules.
import { canMove, markPosted, planningWeek, STAGES, type Stage } from '@cadence/core';
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { coreSettings } from './domain';
import {
  applyPatch,
  HANDLERS,
  IDEA,
  POST_PATCH,
  readPost,
  ToolError,
  VARIANT_PATCH,
  weekWarnings,
  type Context,
} from './handlers';
import { output } from './rows';
import type { ServerDeps } from './server';

type Row = Record<string, unknown>;
type Action = (args: Row, ctx: Context) => Promise<unknown>;

async function setStage(ctx: Context, id: unknown, to: Stage, reason?: unknown) {
  const [post] = await ctx.tx.query<{ status: Stage }>(
    'select status from public.posts where id = $1',
    [id],
  );
  if (!post) throw new ToolError(`No post with id ${id}`);
  if (!canMove(post.status, to))
    throw new ToolError(`A post cannot move from ${post.status} to ${to}`);
  if (reason) await ctx.tx.query("select set_config('cadence.reason', $1, true)", [reason]);
  await ctx.tx.query('update public.posts set status = $2 where id = $1', [id, to]);
  return readPost(ctx.tx, id, ctx.settings.timezone);
}

export const APP_ACTIONS: Record<string, Action> = {
  inbox: async (_args, ctx) => {
    const ids = await ctx.tx.query<{ id: string }>(
      "select id from public.posts where status = 'proposed' order by go_live_at",
    );
    return Promise.all(
      ids.map(async ({ id }) => {
        const post = await readPost(ctx.tx, id, ctx.settings.timezone);
        return { post, warnings: await weekWarnings(ctx.tx, post.goLiveAt, ctx.settings) };
      }),
    );
  },

  week: async ({ offset }, ctx) => {
    const tz = ctx.settings.timezone;
    const start = planningWeek(ctx.deps.clock.now(), tz)
      .start.toZonedDateTimeISO(tz)
      .add({ weeks: Number(offset ?? 0) })
      .toPlainDate();
    const range = { from: start.toString(), to: start.add({ days: 6 }).toString() };
    return {
      weekStart: range.from,
      weekEnd: range.to,
      items: await HANDLERS.get_calendar(range, ctx),
      warnings: await HANDLERS.check_balance(range, ctx),
    };
  },

  post: async ({ id }, ctx) => readPost(ctx.tx, id, ctx.settings.timezone),

  approve: async ({ id }, ctx) => setStage(ctx, id, 'approved'),

  reject: async ({ id, reason }, ctx) => {
    if (!String(reason ?? '').trim()) throw new ToolError('Say why you are rejecting it');
    return setStage(ctx, id, 'archived', reason);
  },

  advance: async ({ id }, ctx) => {
    const [post] = await ctx.tx.query<{ status: Stage }>(
      'select status from public.posts where id = $1',
      [id],
    );
    if (!post) throw new ToolError(`No post with id ${id}`);
    const next = STAGES[STAGES.indexOf(post.status) + 1];
    if (!next || next === 'archived')
      throw new ToolError(`A ${post.status} post has no next stage`);
    return setStage(ctx, id, next);
  },

  update_post: async ({ id, patch }, ctx) => {
    if (!(await applyPatch(ctx.tx, 'posts', id, patch as Row, POST_PATCH))) {
      throw new ToolError(`No post with id ${id}`);
    }
    return readPost(ctx.tx, id, ctx.settings.timezone);
  },

  update_variant: async ({ id, patch }, ctx) => {
    const [variant] = await ctx.tx.query('select post_id from public.variants where id = $1', [id]);
    if (!variant) throw new ToolError(`No variant with id ${id}`);
    await applyPatch(ctx.tx, 'variants', id, patch as Row, VARIANT_PATCH);
    return readPost(ctx.tx, variant.post_id, ctx.settings.timezone);
  },

  mark_posted: async ({ variantId }, ctx) => {
    const [v] = await ctx.tx.query<{
      post_id: string;
      platform: string;
      format: string;
      posted_at: Date | null;
    }>('select post_id, platform, format, posted_at from public.variants where id = $1', [
      variantId,
    ]);
    if (!v) throw new ToolError(`No variant with id ${variantId}`);
    if (v.posted_at) throw new ToolError('Already marked posted');
    const now = ctx.deps.clock.now();
    const variant = { id: String(variantId), platform: v.platform, format: v.format } as Parameters<
      typeof markPosted
    >[0];
    const { checkins } = markPosted(variant, now, coreSettings(ctx.settings)); // FR-5
    await ctx.tx.query('update public.variants set posted_at = $2 where id = $1', [
      variantId,
      now.toString(),
    ]);
    for (const c of checkins) {
      await ctx.tx.query(
        `insert into public.checkins (variant_id, day_offset, due_at) values ($1, $2, $3)
         on conflict (variant_id, day_offset) do nothing`,
        [variantId, c.dayOffset, c.dueAt.toString()],
      );
    }
    return readPost(ctx.tx, v.post_id, ctx.settings.timezone);
  },

  ideas: async (_args, ctx) => HANDLERS.list_ideas({ limit: 50 }, ctx),

  add_idea: async ({ text, pillar, source }, ctx) => {
    if (!String(text ?? '').trim()) throw new ToolError('Write the idea first');
    const [idea] = await ctx.tx.query(
      `insert into public.ideas (text, source, pillar) values ($1, $2, $3) returning ${IDEA}`,
      [String(text).trim(), source === 'pc' ? 'pc' : 'phone', pillar || null],
    );
    return output(idea, ctx.settings.timezone);
  },
};

/** Runs one action in an owner transaction. ToolError messages are for the person using the app. */
export async function runAction(deps: ServerDeps, action: string, args: Row = {}) {
  const run = APP_ACTIONS[action];
  if (!run) throw new ToolError(`Unknown action ${action}`);
  return deps.db(deps.ownerId, null, async (tx) => {
    const [settings] = await tx.query<Context['settings']>('select * from public.settings');
    return run(args, { tx, settings, deps });
  });
}

const matches = (given: string, secret: string) =>
  given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));

/** POST /api/app with header x-cadence-key: the same secret as the connector URL. */
export function createAppHandler({ secret, deps }: { secret: string; deps: ServerDeps }) {
  if (secret.length < 32) throw new Error('MCP_SECRET must be at least 32 characters');
  return async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: unknown) =>
      res
        .writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify(body));
    if (!matches(String(req.headers['x-cadence-key'] ?? ''), secret))
      return void res.writeHead(404).end();
    if (req.method !== 'POST') return send(405, { error: 'Use POST' });
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    try {
      const { action, args } = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      send(200, await runAction(deps, String(action), args ?? {}));
    } catch (error) {
      if (error instanceof ToolError) return send(422, { error: error.message });
      console.error(error);
      send(500, { error: 'Something went wrong; check the Vercel logs' });
    }
  };
}
