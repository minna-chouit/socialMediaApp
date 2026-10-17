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

/** Tool handlers by name; each runs inside one owner transaction (see createServer). */
export const HANDLERS: Record<string, Handler> = {
  get_settings: async (_args, { settings }) =>
    output(settings, settings.timezone, ['id', 'owner_id', 'created_at', 'updated_at']),
};
