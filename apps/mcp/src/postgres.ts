import postgres from 'postgres';
import type { Db } from './db';

/** Production Db over postgres.js. DATABASE_URL should log in as cadence_mcp (SRS section 5). */
export function postgresDb(url: string): Db {
  // prepare: false for Supabase's transaction pooler; one connection per serverless instance.
  const sql = postgres(url, { prepare: false, max: 1 });
  return (ownerId, reason, fn) =>
    sql.begin(async (tx) => {
      await tx`set local role cadence_mcp`;
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId })}, true)`;
      if (reason) await tx`select set_config('cadence.reason', ${reason}, true)`;
      return fn({
        query: async (text, params = []) => (await tx.unsafe(text, params as never[])) as never[],
      });
    }) as never;
}
