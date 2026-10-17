import { Temporal } from 'temporal-polyfill';
import { checkBalance, metricsSummary, planningWeek } from '@cadence/core';
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

/** Tool handlers by name; each runs inside one owner transaction (see createServer). */
export const HANDLERS: Record<string, Handler> = {
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

  get_post: async ({ id }, { tx, settings }) => {
    const tz = settings.timezone;
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
  },

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
