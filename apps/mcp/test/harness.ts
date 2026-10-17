import { PGlite } from '@electric-sql/pglite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Temporal } from 'temporal-polyfill';
import type { Db } from '../src/db';
import { createServer } from '../src/server';

const root = fileURLToPath(new URL('../../../', import.meta.url));
export const OWNER = '00000000-0000-0000-0000-00000000000a';

/** Real Postgres (PGlite) with the Supabase stand-in and every migration applied, plus the owner. */
export async function freshDatabase() {
  const pg = new PGlite();
  await pg.exec(readFileSync(`${root}apps/mcp/test/supabase-stub.sql`, 'utf8'));
  for (const file of readdirSync(`${root}supabase/migrations`).sort()) {
    await pg.exec(readFileSync(`${root}supabase/migrations/${file}`, 'utf8'));
  }
  await pg.query('insert into auth.users (id, email) values ($1, $2)', [
    OWNER,
    'owner@example.test',
  ]);
  return pg;
}

export function pgliteDb(pg: PGlite): Db {
  return (ownerId, reason, fn) =>
    pg.transaction(async (tx) => {
      await tx.exec('set local role cadence_mcp');
      await tx.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: ownerId }),
      ]);
      if (reason) await tx.query("select set_config('cadence.reason', $1, true)", [reason]);
      return fn({ query: async (sql, params) => (await tx.query(sql, params)).rows as never[] });
    });
}

/** Wednesday 21 Oct 2026, 12:00 Algiers. Tests move it with `clock.set`. */
export const NOW = Temporal.Instant.from('2026-10-21T11:00:00Z');

/** An MCP client connected in memory to a Cadence server over a fresh database. */
export async function connect() {
  const pg = await freshDatabase();
  let now = NOW;
  const clock = { now: () => now, set: (at: Temporal.Instant) => void (now = at) };
  const server = createServer({ db: pgliteDb(pg), ownerId: OWNER, clock });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'contract-test', version: '1.0.0' });
  await client.connect(clientTransport);
  return { client, pg, clock };
}

type Connected = Awaited<ReturnType<typeof connect>>;

/** Calls a tool and returns its parsed JSON result, or `{ error }` when the tool reports one. */
export async function call(c: Connected, name: string, args: Record<string, unknown> = {}) {
  const result = (await c.client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { type: string; text: string }[];
  };
  const text = result.content.map((part) => part.text).join('\n');
  return result.isError ? { error: text } : JSON.parse(text);
}

/** Inserts a post and its variants directly (as postgres), returning their ids. */
export async function seedPost(
  pg: PGlite,
  post: { title: string; pillar?: string; status?: string; goLiveAt: string; topics?: string[] },
  variants: { platform: string; format: string; scheduledAt?: string; postedAt?: string }[] = [
    { platform: 'instagram', format: 'reel' },
  ],
) {
  const [{ id }] = (
    await pg.query<{ id: string }>(
      `insert into public.posts (owner_id, title, pillar, status, go_live_at, topics)
       values ($1, $2, $3, $4, $5, $6::public.topic[]) returning id`,
      [
        OWNER,
        post.title,
        post.pillar ?? 'life_style',
        post.status ?? 'approved',
        post.goLiveAt,
        `{${(post.topics ?? []).join(',')}}`, // PGlite sends [] as "", so pass an array literal
      ],
    )
  ).rows;
  const variantIds: string[] = [];
  for (const v of variants) {
    const { rows } = await pg.query<{ id: string }>(
      `insert into public.variants (owner_id, post_id, platform, format, scheduled_at, posted_at)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [OWNER, id, v.platform, v.format, v.scheduledAt ?? null, v.postedAt ?? null],
    );
    variantIds.push(rows[0].id);
  }
  return { postId: id, variantIds };
}
