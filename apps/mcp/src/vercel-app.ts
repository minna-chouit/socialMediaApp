// Vercel entry point for the owner's web app API; bundled to /api/app by `pnpm build`.
import { Temporal } from 'temporal-polyfill';
import { createAppHandler } from './app';
import { postgresDb } from './postgres';
import { webPush } from './push';
import { supabaseSigner } from './storage';

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const secret = env('MCP_SECRET');
const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, VERCEL_PROJECT_PRODUCTION_URL } =
  process.env;

export default createAppHandler({
  secret,
  deps: {
    // Push is on once the VAPID keys are set in Vercel; until then the scheduler just records reminders.
    push:
      VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY
        ? webPush(
            VAPID_PUBLIC_KEY,
            VAPID_PRIVATE_KEY,
            VAPID_SUBJECT || 'mailto:owner@cadence.invalid',
          )
        : undefined,
    vapidPublicKey: VAPID_PUBLIC_KEY,
    appUrl: `https://${VERCEL_PROJECT_PRODUCTION_URL}/app/${secret}`,
    // Logs in as postgres and acts as the owner (role authenticated), so edits log actor = owner.
    db: postgresDb(env('APP_DATABASE_URL'), 'authenticated'),
    ownerId: env('OWNER_ID'),
    clock: { now: () => Temporal.Now.instant() },
    signUrl: supabaseSigner(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY')),
  },
});
