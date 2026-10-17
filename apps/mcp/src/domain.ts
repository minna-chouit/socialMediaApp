// Database rows ↔ @cadence/core shapes, so tools reuse core's rules instead of re-implementing them.
import type { Post, Settings, Variant } from '@cadence/core';
import { Temporal } from 'temporal-polyfill';
import type { Tx } from './db';

type Json = Record<string, unknown>;

const instant = (value: unknown) => (value ? Temporal.Instant.from(String(value)) : undefined);
const hhmm = (value: unknown) => String(value).slice(0, 5);

export function coreSettings(row: Json): Settings {
  return {
    timeZone: String(row.timezone),
    phase: row.phase === 2 ? 2 : 1,
    workOnPersonal: Boolean(row.work_on_personal),
    replyWindowMinutes: Number(row.reply_window_minutes),
    checkinOffsets: row.checkin_offsets as Settings['checkinOffsets'],
    reportTime: hhmm(row.report_time),
    batchTime: hhmm(row.batch_time),
    quietStart: hhmm(row.quiet_start),
    quietEnd: hhmm(row.quiet_end),
    replyRemindersTikTok: Boolean(row.reply_reminders_tiktok),
  };
}

function corePost(row: Json): Post {
  return {
    id: String(row.id),
    title: String(row.title),
    pillar: row.pillar as Post['pillar'],
    topics: row.topics as Post['topics'],
    status: row.status as Post['status'],
    goLiveAt: instant(row.go_live_at)!,
    isLeftovers: Boolean(row.is_leftovers),
    variants: (row.variants as Json[]).map((v): Variant => ({
      id: String(v.id),
      platform: v.platform as Variant['platform'],
      format: v.format as Variant['format'],
      scheduledAt: instant(v.scheduled_at),
      postedAt: instant(v.posted_at),
      scheduledNatively: Boolean(v.scheduled_natively),
    })),
  };
}

// ponytail: loads every post; one owner has a few hundred a year. Filter by date when it grows.
export async function loadPosts(tx: Tx): Promise<Post[]> {
  const rows = await tx.query<{ post: Json }>(
    `select to_jsonb(p) || jsonb_build_object('variants', coalesce(
       (select jsonb_agg(to_jsonb(v)) from public.variants v where v.post_id = p.id), '[]'::jsonb)) as post
     from public.posts p`,
  );
  return rows.map((r) => corePost(r.post));
}

/** A post described by Claude (propose_post / check_balance input) as a core Post. */
export function inputPost(input: Json, id: string): Post {
  return {
    id,
    title: String(input.title),
    pillar: input.pillar as Post['pillar'],
    topics: (input.topics ?? []) as Post['topics'],
    status: 'approved',
    goLiveAt: instant(input.goLiveAt)!,
    isLeftovers: Boolean(input.isLeftovers),
    variants: (input.variants as Json[]).map((v, i) => ({
      id: `${id}-${i}`,
      platform: v.platform as Variant['platform'],
      format: v.format as Variant['format'],
      scheduledAt: instant(v.scheduledAt),
    })),
  };
}
