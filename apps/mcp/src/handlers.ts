import { Temporal } from 'temporal-polyfill';
import {
  checkBalance,
  checkVariants,
  metricsSummary,
  planningWeek,
  reviewIdea,
} from '@cadence/core';
import type { Tx } from './db';
import { coreSettings, inputPost, loadCheckins, loadPosts } from './domain';
import { output } from './rows';
import type { ServerDeps } from './server';

type Row = Record<string, unknown>;

/** What a handler gets: the owner's transaction, settings and the server's dependencies. */
export interface Context {
  tx: Tx;
  settings: Row & { timezone: string };
  deps: ServerDeps;
}

/** An error Claude should see as the tool result (not found, rejected input, rate limit). */
export class ToolError extends Error {}

/** A text[] parameter as a Postgres array literal; works with both PGlite and postgres.js. */
const textArray = (values: unknown) =>
  `{${((values as string[] | undefined) ?? [])
    .map((v) => `"${v.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`)
    .join(',')}}`;

/**
 * Section 6.2 rule 3 for writes the database triggers do not log (creates; milestone and trigger
 * updates). Post and variant updates are logged by the FR-3 trigger with the same reason.
 */
async function logWrite(
  tx: Tx,
  entity: { type: string; id: unknown },
  field: string,
  change: { old?: unknown; new: unknown },
  reason: unknown,
) {
  await tx.query(
    `insert into public.change_log (entity_type, entity_id, actor, field, old_value, new_value, reason)
     values ($1, $2, 'claude', $3, $4, $5, $6)`,
    [
      entity.type,
      entity.id,
      field,
      JSON.stringify(change.old ?? null),
      JSON.stringify(change.new),
      reason,
    ],
  );
}

// Enum arrays come back from the drivers as '{a,b}' text, so these cast topics to text[].
const IDEA = 'id, text, source, tags, pillar, topics::text[] as topics, status, created_at';
const POST = `id, title, pillar, topics::text[] as topics, status, go_live_at, notes, is_leftovers,
  idea_id, created_by, reminder_overrides, created_at`;

type Handler = (args: Record<string, unknown>, ctx: Context) => Promise<unknown>;

/** [start of `from`, start of the day after `to`) in the owner's timezone, as ISO instants. */
const dayRange = (from: unknown, to: unknown, timeZone: string) => [
  Temporal.PlainDate.from(String(from)).toZonedDateTime(timeZone).toInstant().toString(),
  Temporal.PlainDate.from(String(to))
    .add({ days: 1 })
    .toZonedDateTime(timeZone)
    .toInstant()
    .toString(),
];

/** A post with its variants, linked media and change log (get_post, and the result of post writes). */
async function readPost(tx: Tx, id: unknown, tz: string): Promise<Row & { variants: Row[] }> {
  const [post] = await tx.query(`select ${POST} from public.posts where id = $1`, [id]);
  if (!post) throw new ToolError(`No post with id ${id}`);
  const variants = await tx.query(
    'select * from public.variants where post_id = $1 order by platform',
    [id],
  );
  const media = await tx.query(
    `select m.* from public.media m join public.post_media pm on pm.media_id = m.id
      where pm.post_id = $1 order by m.taken_at nulls last, m.created_at`,
    [id],
  );
  const changeLog = await tx.query(
    `select actor, field, old_value, new_value, reason, at from public.change_log
      where entity_id = $1 or entity_id = any($2::uuid[]) order by at, field`,
    [id, `{${variants.map((v) => v.id).join(',')}}`],
  );
  return {
    ...output(post, tz),
    variants: variants.map((v) =>
      output(v, tz, ['owner_id', 'created_at', 'updated_at', 'post_id']),
    ),
    media: media.map((m) => output(m, tz)),
    changeLog: changeLog.map((row) => output(row, tz)),
  };
}

/** Balance warnings for the planning week a post goes live in, as Claude sees after a write. */
async function weekWarnings(tx: Tx, goLiveAt: unknown, settings: Context['settings']) {
  const week = planningWeek(Temporal.Instant.from(String(goLiveAt)), settings.timezone);
  return checkBalance(
    await loadPosts(tx),
    { from: week.start, to: week.end },
    coreSettings(settings),
  );
}

/** Patch keys Claude may change, mapped to columns. Stage and postedAt are not here (rule 2). */
type Columns = Record<
  string,
  { column: string; cast?: string; toDb?: (value: unknown) => unknown }
>;
const POST_PATCH: Columns = {
  title: { column: 'title' },
  pillar: { column: 'pillar' },
  topics: { column: 'topics', cast: '::public.topic[]', toDb: textArray },
  goLiveAt: { column: 'go_live_at' },
  ideaId: { column: 'idea_id' },
  isLeftovers: { column: 'is_leftovers' },
  notes: { column: 'notes' },
};

const VARIANT_PATCH: Columns = {
  platform: { column: 'platform' },
  format: { column: 'format' },
  language: { column: 'language' },
  caption: { column: 'caption' },
  hook: { column: 'hook' },
  hashtags: { column: 'hashtags', cast: '::text[]', toDb: textArray },
  scheduledAt: { column: 'scheduled_at' },
};

/** Applies a validated patch; false when no row with that id is visible to the owner. */
async function applyPatch(tx: Tx, table: string, id: unknown, patch: Row, columns: Columns) {
  const entries = Object.entries(patch).filter(([key]) => key in columns);
  if (!entries.length) throw new ToolError('The patch changes nothing');
  const sets = entries.map(
    ([key], i) => `${columns[key].column} = $${i + 2}${columns[key].cast ?? ''}`,
  );
  const values = entries.map(([key, value]) => columns[key].toDb?.(value) ?? value);
  const rows = await tx.query(
    `update public.${table} set ${sets.join(', ')} where id = $1 returning id`,
    [id, ...values],
  );
  return rows.length > 0;
}

export const WRITES_PER_HOUR = 60;

/**
 * Section 6.2 rule 4. Counts Claude's writes in the last hour from change_log: every write logs
 * there, one tool call is one transaction (one now()), so distinct timestamps are tool calls.
 * Stored in the database so it holds across serverless instances.
 */
export async function enforceWriteLimit(tx: Tx) {
  const [{ writes }] = await tx.query<{ writes: number }>(
    `select count(distinct at)::int as writes from public.change_log
      where actor = 'claude' and at > now() - interval '1 hour'`,
  );
  if (writes >= WRITES_PER_HOUR) {
    throw new ToolError(`Write limit reached: ${WRITES_PER_HOUR} writes per hour. Try again later.`);
  }
}

/** Tool handlers by name; each runs inside one owner transaction (see createServer). */
export const HANDLERS: Record<string, Handler> = {
  resolve_trigger: async ({ id, note, reason }, { tx, settings, deps }) => {
    const [before] = await tx.query('select note, resolved_at from public.triggers where id = $1', [
      id,
    ]);
    if (!before) throw new ToolError(`No trigger with id ${id}`);
    if (before.resolved_at) throw new ToolError(`Trigger ${id} is already resolved`);
    const resolvedAt = deps.clock.now().toString();
    const [trigger] = await tx.query(
      `update public.triggers set resolved_at = $2, resolved_by = 'claude',
         note = coalesce(note || E'\n', '') || 'Resolved: ' || $3
       where id = $1 returning *`,
      [id, resolvedAt, note],
    );
    await logWrite(tx, { type: 'trigger', id }, 'resolved_at', { new: resolvedAt }, reason);
    return output(trigger, settings.timezone);
  },

  create_trigger: async ({ rule, platform, note, reason }, { tx, settings, deps }) => {
    const open = await tx.query(
      'select id from public.triggers where rule = $1 and platform = $2 and resolved_at is null',
      [rule, platform],
    );
    // The FR-22 unique index enforces this too; checking first gives Claude a readable message.
    if (open.length) {
      throw new ToolError(
        `There is already an unresolved ${rule} trigger for ${platform}; resolve it first`,
      );
    }
    const [trigger] = await tx.query(
      'insert into public.triggers (rule, platform, note, fired_at) values ($1, $2, $3, $4) returning *',
      [rule, platform, note, deps.clock.now().toString()],
    );
    const created = output(trigger, settings.timezone);
    await logWrite(tx, { type: 'trigger', id: trigger.id }, 'created', { new: created }, reason);
    return created;
  },

  update_milestone: async ({ id, outcome, decision, reason }, { tx, settings }) => {
    const [before] = await tx.query(
      'select outcome, decision from public.milestones where id = $1',
      [id],
    );
    if (!before) throw new ToolError(`No milestone with id ${id}`);
    const [milestone] = await tx.query(
      'update public.milestones set outcome = $2, decision = $3 where id = $1 returning *',
      [id, outcome, decision],
    );
    const entity = { type: 'milestone', id };
    await logWrite(tx, entity, 'outcome', { old: before.outcome, new: outcome }, reason);
    await logWrite(tx, entity, 'decision', { old: before.decision, new: decision }, reason);
    return output(milestone, settings.timezone);
  },

  update_variant: async ({ id, patch }, { tx, settings }) => {
    const [current] = await tx.query(
      'select post_id, platform, format from public.variants where id = $1',
      [id],
    );
    if (!current) throw new ToolError(`No variant with id ${id}`);
    const next = { platform: current.platform, format: current.format, ...(patch as Row) };
    const problems = checkVariants([next] as Parameters<typeof checkVariants>[0]);
    if (problems.length) throw new ToolError(problems.join('; '));
    await applyPatch(tx, 'variants', id, patch as Row, VARIANT_PATCH);
    const post = await readPost(tx, current.post_id, settings.timezone);
    return { post, warnings: await weekWarnings(tx, post.goLiveAt, settings) };
  },

  update_post: async ({ id, patch }, { tx, settings }) => {
    if (!(await applyPatch(tx, 'posts', id, patch as Row, POST_PATCH))) {
      throw new ToolError(`No post with id ${id}`);
    }
    const post = await readPost(tx, id, settings.timezone);
    return { post, warnings: await weekWarnings(tx, post.goLiveAt, settings) };
  },

  propose_post: async (args, { tx, settings }) => {
    const variants = args.variants as Row[];
    const problems = checkVariants(variants as Parameters<typeof checkVariants>[0]);
    if (problems.length) throw new ToolError(problems.join('; '));
    // The FR-1 trigger makes anything cadence_mcp inserts created_by claude and proposed.
    const [{ id }] = await tx.query(
      `insert into public.posts (title, pillar, topics, go_live_at, idea_id, is_leftovers, notes)
       values ($1, $2, $3::public.topic[], $4, $5, $6, $7) returning id`,
      [
        args.title,
        args.pillar,
        textArray(args.topics),
        args.goLiveAt,
        args.ideaId ?? null,
        Boolean(args.isLeftovers),
        args.notes ?? null,
      ],
    );
    for (const v of variants) {
      await tx.query(
        `insert into public.variants (post_id, platform, format, language, caption, hook, hashtags, scheduled_at)
         values ($1, $2, $3, $4, $5, $6, $7::text[], $8)`,
        [
          id,
          v.platform,
          v.format,
          v.language ?? 'en',
          v.caption ?? null,
          v.hook ?? null,
          textArray(v.hashtags),
          v.scheduledAt ?? null,
        ],
      );
    }
    const post = await readPost(tx, id, settings.timezone);
    await logWrite(tx, { type: 'post', id }, 'created', { new: post }, args.reason);
    return { post, warnings: await weekWarnings(tx, args.goLiveAt, settings) };
  },

  review_idea: async ({ ideaId, scores, notes, alternatives }, { tx, settings }) => {
    const [idea] = await tx.query('select id from public.ideas where id = $1', [ideaId]);
    if (!idea) throw new ToolError(`No idea with id ${ideaId}`);
    const review = reviewIdea({ scores, notes, alternatives }); // core computes total and verdict
    const [stored] = await tx.query(
      `insert into public.idea_verdicts (idea_id, scores, total, verdict, notes, alternatives, by)
       values ($1, $2, $3, $4, $5, $6::text[], 'claude') returning *`,
      [
        ideaId,
        JSON.stringify(review.scores),
        review.total,
        review.verdict,
        review.notes,
        textArray(review.alternatives),
      ],
    );
    await tx.query('update public.ideas set status = $2 where id = $1', [
      ideaId,
      review.verdict === 'bank' ? 'banked' : 'reviewed',
    ]);
    const verdict = output(stored, settings.timezone);
    await logWrite(tx, { type: 'idea', id: ideaId }, 'verdict', { new: verdict }, review.notes);
    return verdict;
  },

  create_idea: async ({ text, pillar, topics, tags, reason }, { tx, settings }) => {
    const [idea] = await tx.query(
      `insert into public.ideas (text, source, pillar, topics, tags)
       values ($1, 'chat', $2, $3::public.topic[], $4::text[]) returning ${IDEA}`,
      [text, pillar ?? null, textArray(topics), textArray(tags)],
    );
    await logWrite(
      tx,
      { type: 'idea', id: idea.id },
      'created',
      { new: output(idea, settings.timezone) },
      reason,
    );
    return output(idea, settings.timezone);
  },

  list_triggers: async ({ unresolvedOnly }, { tx, settings }) => {
    const rows = await tx.query(
      'select * from public.triggers where not $1 or resolved_at is null order by fired_at desc',
      [Boolean(unresolvedOnly)],
    );
    return rows.map((row) => output(row, settings.timezone));
  },

  list_milestones: async ({ unresolvedOnly }, { tx, settings }) => {
    const rows = await tx.query(
      'select * from public.milestones where not $1 or outcome is null order by due_at',
      [Boolean(unresolvedOnly)],
    );
    return rows.map((row) => output(row, settings.timezone));
  },

  get_metrics_summary: async ({ month }, { tx, settings }) =>
    metricsSummary(
      await loadPosts(tx),
      await loadCheckins(tx),
      String(month),
      coreSettings(settings),
    ),

  get_follower_history: async ({ platform, weeks }, { tx, settings, deps }) => {
    const tz = settings.timezone;
    const thisWeek = planningWeek(deps.clock.now(), tz).start.toZonedDateTimeISO(tz);
    const firstWeek = thisWeek
      .subtract({ weeks: Number(weeks ?? 12) - 1 })
      .toPlainDate()
      .toString();
    return tx.query(
      `select platform, week_start::text as "weekStart", count from public.follower_snapshots
        where week_start >= $1::date and ($2::public.platform is null or platform = $2)
        order by week_start, platform`,
      [firstWeek, platform ?? null],
    );
  },

  get_checkins: async ({ from, to }, { tx, settings }) => {
    const rows = await tx.query(
      `select c.*, v.platform, p.id as post_id, p.title from public.checkins c
         join public.variants v on v.id = c.variant_id join public.posts p on p.id = v.post_id
        where c.due_at >= $1 and c.due_at < $2 order by c.due_at, v.platform`,
      dayRange(from, to, settings.timezone),
    );
    return rows.map((row) => output(row, settings.timezone));
  },

  get_weekly_report: async ({ weekStart }, { tx, settings }) => {
    const [report] = await tx.query(
      `select week_start::text, payload, generated_at, ready_for_claude_at from public.weekly_reports
        where ($1::date is null and ready_for_claude_at is not null) or week_start = $1::date
        order by week_start desc limit 1`,
      [weekStart ?? null],
    );
    if (!report) {
      throw new ToolError(
        weekStart
          ? `No weekly report for the week of ${weekStart}`
          : 'No weekly report is ready for Claude yet',
      );
    }
    return output(report, settings.timezone);
  },

  list_media: async ({ tags, unusedOnly, limit }, { tx, settings, deps }) => {
    const rows = await tx.query(
      `select m.* from public.media m
        where m.tags @> $1::text[]
          and (not $2 or not exists (select 1 from public.post_media pm where pm.media_id = m.id))
        order by m.taken_at desc nulls last, m.created_at desc limit $3`,
      [textArray(tags), Boolean(unusedOnly), limit ?? 50],
    );
    return Promise.all(
      rows.map(async (row) => ({
        ...output(row, settings.timezone),
        thumbnailUrl: await deps.signUrl(String(row.storage_path)),
      })),
    );
  },

  list_ideas: async ({ status, limit }, { tx, settings }) => {
    const rows = await tx.query(
      `select ${IDEA}, (select to_jsonb(v) - 'owner_id' - 'updated_at' - 'idea_id' from public.idea_verdicts v
                     where v.idea_id = i.id order by v.created_at desc limit 1) as latest_verdict
         from public.ideas i
        where $1::public.idea_status is null or i.status = $1
        order by i.created_at desc limit $2`,
      [status ?? null, limit ?? 20],
    );
    return rows.map((row) => output(row, settings.timezone));
  },

  check_balance: async ({ from, to, hypothetical }, { tx, settings }) => {
    const [start, end] = dayRange(from, to, settings.timezone);
    return checkBalance(
      await loadPosts(tx),
      { from: Temporal.Instant.from(start), to: Temporal.Instant.from(end) },
      coreSettings(settings),
      hypothetical ? inputPost(hypothetical as Row, 'hypothetical') : undefined,
    );
  },

  get_post: async ({ id }, { tx, settings }) => readPost(tx, id, settings.timezone),

  get_calendar: async ({ from, to }, { tx, settings }) => {
    const rows = await tx.query(
      `select v.id as variant_id, p.id as post_id, p.title, p.pillar, p.status as stage, v.platform,
              v.format, coalesce(v.scheduled_at, p.go_live_at) as go_live_at, v.scheduled_natively,
              v.posted_at
         from public.variants v join public.posts p on p.id = v.post_id
        where p.status <> 'archived'
          and coalesce(v.scheduled_at, p.go_live_at) >= $1 and coalesce(v.scheduled_at, p.go_live_at) < $2
        order by go_live_at, v.platform`,
      dayRange(from, to, settings.timezone),
    );
    return rows.map((row) => output(row, settings.timezone));
  },

  get_settings: async (_args, { settings }) =>
    output(settings, settings.timezone, ['id', 'owner_id', 'created_at', 'updated_at']),
};
