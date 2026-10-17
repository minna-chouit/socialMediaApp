import { Temporal } from 'temporal-polyfill';
import type { Tx } from './db';
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
  get_post: async ({ id }, { tx, settings }) => {
    const tz = settings.timezone;
    const [post] = await tx.query('select * from public.posts where id = $1', [id]);
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
