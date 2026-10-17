// Vercel entry point for the owner's web app API; bundled to /api/app by `pnpm build`.
import { Temporal } from 'temporal-polyfill';
import { createAppHandler } from './app';
import { postgresDb } from './postgres';
import { supabaseSigner } from './storage';

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

export default createAppHandler({
  secret: env('MCP_SECRET'),
  deps: {
    // Logs in as postgres and acts as the owner (role authenticated), so edits log actor = owner.
    db: postgresDb(env('APP_DATABASE_URL'), 'authenticated'),
    ownerId: env('OWNER_ID'),
    clock: { now: () => Temporal.Now.instant() },
    signUrl: supabaseSigner(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY')),
  },
});
