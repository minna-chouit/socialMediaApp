// The owner's web app API (FR-6, FR-7, FR-9 basics): one POST endpoint taking { action, args }.
// Runs as the owner (role authenticated), so change_log records actor = owner and stage moves are
// allowed, within core's canMove rules.
import {
  canMove,
  checkBalance,
  generateReminders,
  markPosted,
  METRICS,
  planningWeek,
  PLATFORMS,
  seedMilestones,
  shouldSend,
  STAGES,
  weeklyReport,
  type Stage,
} from '@cadence/core';
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Temporal } from 'temporal-polyfill';
import {
  coreSettings,
  loadCaptureItems,
  loadCheckins,
  loadFollowerSnapshots,
  loadMilestones,
  loadPosts,
  loadTasks,
  loadTriggers,
} from './domain';
import {
  addVariant,
  applyPatch,
  HANDLERS,
  IDEA,
  openTask,
  openVariant,
  removeVariant,
  TASK,
  TASK_PATCH,
  TASK_TYPES,
  POST_PATCH,
  readPost,
  ToolError,
  VARIANT_PATCH,
  type Context,
} from './handlers';
import { output } from './rows';
import type { Push, PushTarget } from './push';
import type { ServerDeps } from './server';

/** The web app also sends push notifications and links them back to itself. */
export interface AppDeps extends ServerDeps {
  push?: Push;
  vapidPublicKey?: string;
  /** The app's own URL, opened when a notification is tapped. */
  appUrl?: string;
}

const REMINDER_TEXT: Record<string, string> = {
  SHOT_LIST: 'Make the shot list for this week',
  WEEKLY_REPORT: 'Weekly report: log followers, then send it to Claude',
  BATCH_NIGHT: 'Batch night with Claude',
  SCHEDULE: "Schedule next week's approved posts",
  POST_NOW: 'Post now',
  REPLY_START: 'Reply window: answer comments for 15 minutes',
  REPLY_END: 'Reply window is over',
  CHECKIN: 'Log check-in metrics',
  MISSED: 'Missed yesterday: post it or use a leftovers post',
  LI_CAPTURE: 'Capture one piece of real work for LinkedIn',
  LI_FALLBACK: 'No LinkedIn capture yet: write a reflection post',
  MILESTONE: 'Milestone review',
  MONTHLY_REVIEW: 'Monthly review',
  TRIGGER: 'Strategy trigger: review with Claude',
  TASK: 'Task due',
};

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

const iso = (at: Temporal.Instant, tz: string) =>
  at.toZonedDateTimeISO(tz).toString({ timeZoneName: 'never' });

// FR-21: the first approval seeds the milestones, counted from the earliest approved post.
async function seedMilestonesOnce(ctx: Context) {
  const [{ n }] = await ctx.tx.query<{ n: number }>(
    'select count(*)::int as n from public.milestones',
  );
  if (n > 0) return;
  const [first] = await ctx.tx.query<{ at: string | null }>(
    `select to_json(min(go_live_at)) #>> '{}' as at from public.posts
      where status not in ('idea', 'proposed', 'archived')`,
  );
  if (!first?.at) return;
  const firstPostAt = Temporal.Instant.from(first.at);
  for (const m of seedMilestones(firstPostAt, coreSettings(ctx.settings))) {
    await ctx.tx.query(
      'insert into public.milestones (kind, week, title, checks, due_at) values ($1, $2, $3, $4::text[], $5)',
      [
        m.kind,
        m.week,
        m.title,
        `{${m.checks.map((c) => JSON.stringify(c)).join(',')}}`,
        m.dueAt.toString(),
      ],
    );
  }
  await ctx.tx.query('update public.settings set first_post_at = $1', [firstPostAt.toString()]);
}

async function reportData(ctx: Context) {
  return {
    posts: await loadPosts(ctx.tx),
    checkins: await loadCheckins(ctx.tx),
    captureItems: await loadCaptureItems(ctx.tx),
    followerSnapshots: await loadFollowerSnapshots(ctx.tx),
  };
}

// What reminders need, and a short label for what each one is about.
async function reminderContext(ctx: Context) {
  const data = {
    posts: await loadPosts(ctx.tx),
    checkins: await loadCheckins(ctx.tx),
    captureItems: await loadCaptureItems(ctx.tx),
    milestones: await loadMilestones(ctx.tx),
    triggers: await loadTriggers(ctx.tx),
    tasks: await loadTasks(ctx.tx),
  };
  const variantTitle = new Map(
    data.posts.flatMap((p) => p.variants.map((v) => [v.id, `${p.title} (${v.platform})`] as const)),
  );
  const about = ({
    entityType,
    entityId,
  }: {
    entityType: string | null;
    entityId: string | null;
  }) => {
    if (entityType === 'variant') return variantTitle.get(String(entityId)) ?? null;
    if (entityType === 'checkin') {
      const [variantId, offset] = String(entityId).split(':d');
      return `${variantTitle.get(variantId) ?? 'post'}, day ${offset}`;
    }
    if (entityType === 'milestone')
      return data.milestones.find((m) => m.id === entityId)?.title ?? null;
    if (entityType === 'trigger') return data.triggers.find((t) => t.id === entityId)?.rule ?? null;
    if (entityType === 'task') return data.tasks.find((t) => t.id === entityId)?.title ?? null;
    return null;
  };
  return { data, settings: coreSettings(ctx.settings), about };
}

const weekStartOf = (ctx: Context) => {
  const tz = ctx.settings.timezone;
  return planningWeek(ctx.deps.clock.now(), tz)
    .start.toZonedDateTimeISO(tz)
    .toPlainDate()
    .toString();
};

export const APP_ACTIONS: Record<string, Action> = {
  // Overdue first, then today's; done tasks from today stay visible so they can be unticked.
  tasks_today: async (_args, ctx) => {
    const tz = ctx.settings.timezone;
    const day = ctx.deps.clock.now().toZonedDateTimeISO(tz).toPlainDate();
    const start = day.toZonedDateTime(tz).toInstant().toString();
    const end = day.add({ days: 1 }).toZonedDateTime(tz).toInstant().toString();
    const rows = await ctx.tx.query(
      `select ${TASK}, (select title from public.posts p where p.id = t.post_id) as post_title,
              due_at < $1 as overdue
         from public.tasks t
        where cancelled_at is null and ((due_at < $1 and not done) or (due_at >= $1 and due_at < $2))
        order by due_at < $1 desc, due_at`,
      [start, end],
    );
    return rows.map((row) => output(row, tz));
  },

  add_task: async ({ title, type, dueAt, postId, notes }, ctx) => {
    if (!String(title ?? '').trim()) throw new ToolError('Give the task a title');
    if (!dueAt) throw new ToolError('Pick when it is due');
    if (type && !TASK_TYPES.includes(type as never)) throw new ToolError('Unknown task type');
    const [task] = await ctx.tx.query(
      `insert into public.tasks (title, type, due_at, post_id, notes) values ($1, $2, $3, $4, $5)
       returning ${TASK}`,
      [String(title).trim(), type || 'other', dueAt, postId || null, notes || null],
    );
    return output(task, ctx.settings.timezone);
  },

  update_task: async ({ id, patch }, ctx) => {
    await openTask(ctx.tx, id);
    await applyPatch(ctx.tx, 'tasks', id, patch as Row, TASK_PATCH);
    const [task] = await ctx.tx.query(`select ${TASK} from public.tasks where id = $1`, [id]);
    return output(task, ctx.settings.timezone);
  },

  // The owner can really delete (Claude only hides its own).
  delete_task: async ({ id }, ctx) => {
    const rows = await ctx.tx.query('delete from public.tasks where id = $1 returning id', [id]);
    if (!rows.length) throw new ToolError(`No task with id ${id}`);
    return { ok: true };
  },

  // Reminders still due today (section 4.2).
  today: async (_args, ctx) => {
    const tz = ctx.settings.timezone;
    const { data, settings, about } = await reminderContext(ctx);
    const day = ctx.deps.clock.now().toZonedDateTimeISO(tz).toPlainDate();
    const window = {
      from: day.toZonedDateTime(tz).toInstant(),
      to: day.add({ days: 1 }).toZonedDateTime(tz).toInstant(),
    };
    return generateReminders(data, settings, window)
      .filter((r) => shouldSend(r, data, settings))
      .sort((a, b) => Temporal.Instant.compare(a.sendAt, b.sendAt))
      .map((r) => ({ code: r.code, at: iso(r.sendAt, tz), urgent: r.urgent, about: about(r) }));
  },

  push_key: async (_args, ctx) => ({ publicKey: (ctx.deps as AppDeps).vapidPublicKey ?? null }),

  // FR-14: one row per device; subscribing again refreshes its keys.
  subscribe: async ({ subscription, deviceLabel }, ctx) => {
    const sub = subscription as { endpoint?: string; keys?: unknown };
    if (!sub?.endpoint || !sub.keys) throw new ToolError('That is not a push subscription');
    await ctx.tx.query(
      `insert into public.push_subscriptions (endpoint, keys, device_label) values ($1, $2, $3)
       on conflict (endpoint) do update set keys = excluded.keys, device_label = excluded.device_label`,
      [sub.endpoint, JSON.stringify(sub.keys), deviceLabel ?? null],
    );
    return { ok: true };
  },

  // FR-14 / NFR-7: called every few minutes by the scheduler. Each reminder key is claimed once in
  // the reminders table before sending, so overlapping or repeated runs never send twice.
  tick: async (_args, ctx) => {
    const deps = ctx.deps as AppDeps;
    const now = deps.clock.now();
    const { data, settings, about } = await reminderContext(ctx);
    // 12 h back covers reminders that quiet hours moved to the end of the night.
    const due = generateReminders(data, settings, {
      from: now.subtract({ hours: 12 }),
      to: now.add({ seconds: 1 }),
    }).filter((r) => Temporal.Instant.compare(r.sendAt, now) <= 0);
    const subscriptions = await ctx.tx.query<{ endpoint: string; keys: PushTarget['keys'] }>(
      'select endpoint, keys from public.push_subscriptions',
    );
    let sent = 0;
    let skipped = 0;
    for (const r of due) {
      const claimed = await ctx.tx.query(
        `insert into public.reminders (code, key, entity_type, entity_id, send_at, urgent)
         values ($1, $2, $3, $4, $5, $6) on conflict (owner_id, key) do nothing returning id`,
        [r.code, r.key, r.entityType, r.entityId, r.sendAt.toString(), r.urgent],
      );
      if (!claimed.length) continue; // already handled by an earlier run
      // A run that missed more than 30 minutes catches up silently instead of sending stale nudges.
      const stale = Temporal.Instant.compare(r.sendAt, now.subtract({ minutes: 30 })) < 0;
      const send = !stale && shouldSend(r, data, settings) && Boolean(deps.push);
      if (send) {
        const label = about(r);
        const payload = {
          title: REMINDER_TEXT[r.code] ?? r.code,
          body: label ?? 'Open Cadence',
          url: deps.appUrl ?? '/',
          tag: r.key,
        };
        for (const target of subscriptions) {
          if ((await deps.push!(target, payload)) === 'gone') {
            await ctx.tx.query('delete from public.push_subscriptions where endpoint = $1', [
              target.endpoint,
            ]);
          }
        }
        sent++;
      } else {
        skipped++;
      }
      await ctx.tx.query(
        `update public.reminders set ${send ? 'sent_at' : 'cancelled_at'} = $2 where key = $1`,
        [r.key, now.toString()],
      );
    }
    return { sent, skipped, devices: subscriptions.length };
  },

  checkins: async (_args, ctx) => {
    const rows = await ctx.tx.query(
      `select c.*, v.platform, v.format, p.title, c.due_at + interval '2 days' <= $1::timestamptz as overdue
         from public.checkins c join public.variants v on v.id = c.variant_id join public.posts p on p.id = v.post_id
        where c.done_at is null and c.due_at <= $1::timestamptz + interval '1 day'
        order by c.due_at`,
      [ctx.deps.clock.now().toString()],
    );
    return rows.map((row) => output(row, ctx.settings.timezone));
  },

  log_checkin: async ({ id, metrics }, ctx) => {
    const values = (metrics ?? {}) as Record<string, unknown>;
    const columns = [...METRICS, 'avg_watch_seconds'];
    // Missing fields are stored as null, never zero (section 4.4).
    const toNumber = (v: unknown) =>
      v === '' || v === null || v === undefined ? null : Math.round(Number(v));
    const params = columns.map((c) =>
      toNumber(values[c === 'avg_watch_seconds' ? 'avgWatchSeconds' : c]),
    );
    if (params.some((p) => p !== null && (Number.isNaN(p) || p < 0))) {
      throw new ToolError('Metrics must be whole numbers, 0 or more');
    }
    const sets = columns.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const rows = await ctx.tx.query(
      `update public.checkins set ${sets}, done_at = $${columns.length + 2} where id = $1 returning id`,
      [id, ...params, ctx.deps.clock.now().toString()],
    );
    if (!rows.length) throw new ToolError(`No check-in with id ${id}`);
    return { ok: true };
  },

  followers: async (_args, ctx) => {
    const weekStart = weekStartOf(ctx);
    const history = (await HANDLERS.get_follower_history({ weeks: 12 }, ctx)) as {
      platform: string;
      weekStart: string;
      count: number;
    }[];
    const logged = new Set(history.filter((h) => h.weekStart === weekStart).map((h) => h.platform));
    return { weekStart, missing: PLATFORMS.filter((p) => !logged.has(p)), history };
  },

  log_followers: async ({ platform, count }, ctx) => {
    if (!PLATFORMS.includes(platform as never)) throw new ToolError('Pick a platform');
    const n = Number(count);
    if (!Number.isInteger(n) || n < 0)
      throw new ToolError('Follower count must be a whole number, 0 or more');
    await ctx.tx.query(
      `insert into public.follower_snapshots (platform, count, week_start) values ($1, $2, $3)
       on conflict (owner_id, platform, week_start) do update set count = excluded.count, taken_at = now()`,
      [platform, n, weekStartOf(ctx)],
    );
    return { ok: true };
  },

  // FR-17: this week's report, computed live; plus the ones already sent to Claude.
  report: async (_args, ctx) => {
    const live = weeklyReport(
      await reportData(ctx),
      coreSettings(ctx.settings),
      ctx.deps.clock.now(),
    );
    const sent = await ctx.tx.query(
      `select week_start::text, ready_for_claude_at from public.weekly_reports order by week_start desc limit 8`,
    );
    return { live, sent: sent.map((row) => output(row, ctx.settings.timezone)) };
  },

  // FR-18: save this week's report (immutable) and mark it ready for Claude.
  send_report: async (_args, ctx) => {
    const now = ctx.deps.clock.now();
    const payload = weeklyReport(await reportData(ctx), coreSettings(ctx.settings), now);
    const [saved] = await ctx.tx.query(
      `insert into public.weekly_reports (week_start, payload, generated_at, ready_for_claude_at)
       values ($1, $2, $3, $3)
       on conflict (owner_id, week_start) do update set ready_for_claude_at = excluded.ready_for_claude_at
       returning week_start::text, ready_for_claude_at`,
      [payload.weekStart, JSON.stringify(payload), now.toString()],
    );
    return output(saved, ctx.settings.timezone);
  },

  inbox: async (_args, ctx) => {
    const ids = await ctx.tx.query<{ id: string }>(
      "select id from public.posts where status = 'proposed' order by go_live_at",
    );
    const tz = ctx.settings.timezone;
    const all = await loadPosts(ctx.tx);
    return Promise.all(
      ids.map(async ({ id }) => {
        const post = await readPost(ctx.tx, id, tz);
        // FR-7: the week as it would be if this proposal were approved.
        const week = planningWeek(Temporal.Instant.from(String(post.goLiveAt)), tz);
        const ifApproved = all.find((p) => p.id === id);
        const warnings = checkBalance(
          all,
          { from: week.start, to: week.end },
          coreSettings(ctx.settings),
          ifApproved,
        );
        return { post, warnings };
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
      tasks: (
        await ctx.tx.query(
          `select ${TASK} from public.tasks t where cancelled_at is null and post_id in (
             select p.id from public.posts p join public.variants v on v.post_id = p.id
              where v.removed_at is null and coalesce(v.scheduled_at, p.go_live_at) >= $1 and coalesce(v.scheduled_at, p.go_live_at) < $2)
            order by due_at`,
          [
            start.toZonedDateTime(tz).toInstant().toString(),
            start.add({ days: 7 }).toZonedDateTime(tz).toInstant().toString(),
          ],
        )
      ).map((t) => output(t, tz)),
      warnings: await HANDLERS.check_balance(range, ctx),
    };
  },

  post: async ({ id }, ctx) => readPost(ctx.tx, id, ctx.settings.timezone),

  approve: async ({ id }, ctx) => {
    const post = await setStage(ctx, id, 'approved');
    await seedMilestonesOnce(ctx);
    return post;
  },

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

  add_variant: async ({ postId, variant }, ctx) => {
    await addVariant(ctx.tx, postId, (variant ?? {}) as Row);
    return readPost(ctx.tx, postId, ctx.settings.timezone);
  },

  // FR-29: hidden, not deleted, so it stays in the change log with the owner's reason.
  remove_variant: async ({ id, reason }, ctx) => {
    if (reason) await ctx.tx.query("select set_config('cadence.reason', $1, true)", [reason]);
    const postId = await removeVariant(ctx.tx, id, ctx.deps.clock.now().toString());
    return readPost(ctx.tx, postId, ctx.settings.timezone);
  },

  update_variant: async ({ id, patch }, ctx) => {
    const variant = await openVariant(ctx.tx, id);
    await applyPatch(ctx.tx, 'variants', id, patch as Row, VARIANT_PATCH);
    return readPost(ctx.tx, variant.post_id, ctx.settings.timezone);
  },

  // postedAt (optional, owner only) lets a late tap record when it really went live.
  mark_posted: async ({ variantId, postedAt }, ctx) => {
    const [v] = await ctx.tx.query<{
      post_id: string;
      platform: string;
      format: string;
      posted_at: Date | null;
    }>(
      'select post_id, platform, format, posted_at from public.variants where id = $1 and removed_at is null',
      [variantId],
    );
    if (!v) throw new ToolError(`No variant with id ${variantId}`);
    if (v.posted_at) throw new ToolError('Already marked posted');
    let now = ctx.deps.clock.now();
    if (postedAt) {
      let at: Temporal.Instant;
      try {
        at = Temporal.Instant.from(String(postedAt));
      } catch {
        throw new ToolError('That is not a valid posted time');
      }
      if (Temporal.Instant.compare(at, now) > 0)
        throw new ToolError('The posted time cannot be in the future');
      now = at;
    }
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
export async function runAction(deps: AppDeps, action: string, args: Row = {}) {
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
export function createAppHandler({ secret, deps }: { secret: string; deps: AppDeps }) {
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
