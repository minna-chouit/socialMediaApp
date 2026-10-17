// Vercel entry point; bundled to api/mcp.js by `pnpm build`.
import { Temporal } from 'temporal-polyfill';
import { createHttpHandler } from './http';
import { postgresDb } from './postgres';
import { createServer } from './server';
import { supabaseSigner } from './storage';

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const db = postgresDb(env('DATABASE_URL'));
const signUrl = supabaseSigner(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
const ownerId = env('OWNER_ID');

export default createHttpHandler({
  secret: env('MCP_SECRET'),
  makeServer: () =>
    createServer({ db, ownerId, clock: { now: () => Temporal.Now.instant() }, signUrl }),
});
