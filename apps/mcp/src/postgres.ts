import postgres from 'postgres';
import type { Db } from './db';

/**
 * Production Db over postgres.js. The connector runs as cadence_mcp (DATABASE_URL logs in as it);
 * the owner's web app runs as authenticated (APP_DATABASE_URL logs in as postgres).
 */
export function postgresDb(url: string, role: 'cadence_mcp' | 'authenticated' = 'cadence_mcp'): Db {
  // prepare: false for Supabase's transaction pooler; one connection per serverless instance.
  const sql = postgres(url, { prepare: false, max: 1 });
  return (ownerId, reason, fn) =>
    sql.begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId })}, true)`;
      if (reason) await tx`select set_config('cadence.reason', ${reason}, true)`;
      return fn({
        query: async (text, params = []) => (await tx.unsafe(text, params as never[])) as never[],
      });
    }) as never;
}
