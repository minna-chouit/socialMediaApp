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
