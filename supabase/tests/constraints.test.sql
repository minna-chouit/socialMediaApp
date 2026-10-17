-- Per-table constraints from SRS section 5, each named with the requirement it enforces.
-- Runs as postgres: constraints apply to every role, RLS is covered in nfr6_*.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@example.test');
\set owner '''00000000-0000-0000-0000-00000000000a'''
insert into public.ideas (id, owner_id, text, source)
  values ('10000000-0000-0000-0000-000000000001', :owner, 'Dorm tour', 'phone');
insert into public.posts (id, owner_id, title, pillar, go_live_at)
  values ('20000000-0000-0000-0000-000000000001', :owner, 'Lab day', 'student_life', '2026-10-20 18:00+00');
insert into public.variants (id, owner_id, post_id, platform, format)
  values ('30000000-0000-0000-0000-000000000001', :owner, '20000000-0000-0000-0000-000000000001', 'instagram', 'reel');
insert into public.media (id, owner_id, storage_path, kind, size_bytes)
  values ('40000000-0000-0000-0000-000000000001', :owner, 'owner/a.jpg', 'photo', 1000);

-- variants
select throws_ok(
  format($$ insert into public.variants (owner_id, post_id, platform, format)
            values (%L, '20000000-0000-0000-0000-000000000001', 'linkedin', 'reel') $$, :owner),
  '23514', null, 'FR-4: a LinkedIn reel insert fails'
);
select throws_ok(
  format($$ insert into public.variants (owner_id, post_id, platform, format)
            values (%L, '20000000-0000-0000-0000-000000000001', 'instagram', 'carousel') $$, :owner),
  '23505', null, 'FR-4: one variant per platform per post'
);

-- checkins
insert into public.checkins (owner_id, variant_id, day_offset, due_at)
  values (:owner, '30000000-0000-0000-0000-000000000001', 3, '2026-10-23 19:00+00');
select throws_ok(
  format($$ insert into public.checkins (owner_id, variant_id, day_offset, due_at)
            values (%L, '30000000-0000-0000-0000-000000000001', 3, '2026-10-23 19:00+00') $$, :owner),
  '23505', null, 'FR-5: one check-in per variant per day offset'
);
select is(
  (select reach from public.checkins where day_offset = 3),
  null,
  'FR-5: check-in metrics are nullable, never defaulted to zero'
);

-- idea_verdicts
\set verdict 'insert into public.idea_verdicts (owner_id, idea_id, scores, total, verdict, notes, alternatives, by) values (''00000000-0000-0000-0000-00000000000a'', ''10000000-0000-0000-0000-000000000001'', '
select throws_ok(
  :'verdict' || $$ '{"forwardable":4,"fills_gap":2,"doable":2,"original":2,"hook":2}', 12, 'go', 'n', array['a'], 'claude') $$,
  '23514', null, 'FR-10: verdict scores must be whole numbers from 1 to 3 for the five criteria'
);
select throws_ok(
  :'verdict' || $$ '{"forwardable":3,"fills_gap":2,"doable":2,"original":1,"hook":1}', 9, 'improve', 'n', '{}', 'claude') $$,
  '23514', null, 'FR-10: a verdict needs at least one alternative'
);
select throws_ok(
  :'verdict' || $$ '{"forwardable":3,"fills_gap":2,"doable":2,"original":1,"hook":1}', 12, 'go', 'n', array['a'], 'claude') $$,
  '23514', null, 'FR-10: the stored total must match the scores'
);
select throws_ok(
  :'verdict' || $$ '{"forwardable":3,"fills_gap":2,"doable":2,"original":1,"hook":1}', 9, 'go', 'n', array['a'], 'claude') $$,
  '23514', null, 'FR-10: the verdict must follow the 11 / 8 thresholds'
);

-- posts ← ideas
insert into public.posts (owner_id, title, pillar, go_live_at, idea_id)
  values (:owner, 'Dorm tour', 'life_style', '2026-10-21 18:00+00', '10000000-0000-0000-0000-000000000001');
select is(
  (select status::text from public.ideas where id = '10000000-0000-0000-0000-000000000001'),
  'promoted',
  'FR-11: promoting an idea to a post links it and marks the idea promoted'
);

-- media
select throws_ok(
  format($$ insert into public.media (owner_id, storage_path, kind, size_bytes)
            values (%L, 'owner/big.mov', 'video', 101 * 1024 * 1024) $$, :owner),
  'P0001', 'Upload is 101 MB; the limit is 100 MB', 'FR-12: an upload above max_upload_mb is rejected'
);
select lives_ok(
  format($$ insert into public.media (owner_id, storage_path, kind, size_bytes)
            values (%L, 'owner/ok.mov', 'video', 100 * 1024 * 1024) $$, :owner),
  'FR-12: an upload at the limit is accepted'
);
insert into public.post_media (owner_id, post_id, media_id)
  values (:owner, '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001');
select throws_ok(
  format($$ insert into public.post_media (owner_id, post_id, media_id)
            values (%L, '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001') $$, :owner),
  '23505', null, 'FR-12: media link tables reject duplicates'
);

-- reminders
insert into public.reminders (owner_id, code, key, send_at)
  values (:owner, 'WEEKLY_REPORT', 'WEEKLY_REPORT::2026-10-23', '2026-10-23 19:00+00');
select throws_ok(
  format($$ insert into public.reminders (owner_id, code, key, send_at)
            values (%L, 'WEEKLY_REPORT', 'WEEKLY_REPORT::2026-10-23', '2026-10-23 19:00+00') $$, :owner),
  '23505', null, 'FR-13: the reminder key is unique'
);

-- push_subscriptions
insert into public.push_subscriptions (owner_id, endpoint, keys)
  values (:owner, 'https://push.example.test/1', '{}');
select throws_ok(
  format($$ insert into public.push_subscriptions (owner_id, endpoint, keys)
            values (%L, 'https://push.example.test/1', '{}') $$, :owner),
  '23505', null, 'FR-14: a push endpoint is stored once'
);

-- weekly_reports
insert into public.weekly_reports (id, owner_id, week_start, payload, generated_at)
  values ('50000000-0000-0000-0000-000000000001', :owner, '2026-10-17', '{"total":{"planned":3}}', '2026-10-23 19:00+00');
select throws_ok(
  $$ update public.weekly_reports set payload = '{}' $$,
  'P0001', 'Weekly reports are immutable except ready_for_claude_at',
  'FR-17: a weekly report payload is immutable'
);
select lives_ok(
  $$ update public.weekly_reports set ready_for_claude_at = '2026-10-23 21:00+00' $$,
  'FR-17: only ready_for_claude_at can change on a weekly report'
);
select throws_ok(
  format($$ insert into public.weekly_reports (owner_id, week_start, payload, generated_at)
            values (%L, '2026-10-17', '{}', now()) $$, :owner),
  '23505', null, 'FR-17: one report per planning week'
);

-- follower_snapshots
insert into public.follower_snapshots (owner_id, platform, count, week_start)
  values (:owner, 'instagram', 120, '2026-10-17');
select throws_ok(
  format($$ insert into public.follower_snapshots (owner_id, platform, count, week_start)
            values (%L, 'instagram', 121, '2026-10-17') $$, :owner),
  '23505', null, 'FR-20: one follower count per platform per week'
);
select throws_ok(
  format($$ insert into public.follower_snapshots (owner_id, platform, count, week_start)
            values (%L, 'tiktok', -1, '2026-10-17') $$, :owner),
  '23514', null, 'FR-20: follower counts cannot be negative'
);

-- milestones
insert into public.milestones (owner_id, kind, week, title, due_at)
  values (:owner, 'checkpoint', 1, 'Setup', '2026-10-23 19:00+00');
select throws_ok(
  format($$ insert into public.milestones (owner_id, kind, week, title, due_at)
            values (%L, 'checkpoint', 1, 'Setup again', '2026-10-23 19:00+00') $$, :owner),
  '23505', null, 'FR-21: one milestone per kind and week'
);

-- triggers
insert into public.triggers (id, owner_id, rule, platform, note)
  values ('60000000-0000-0000-0000-000000000001', :owner, 'T4', 'instagram', 'Algorithm change');
select throws_ok(
  format($$ insert into public.triggers (owner_id, rule, platform, note) values (%L, 'T4', 'instagram', 'again') $$, :owner),
  '23505', null, 'FR-22: one unresolved trigger per rule and platform'
);
insert into public.triggers (owner_id, rule) values (:owner, 'T2');
select throws_ok(
  format($$ insert into public.triggers (owner_id, rule) values (%L, 'T2') $$, :owner),
  '23505', null, 'FR-22: triggers without a platform (T2, T3) are also one unresolved at a time'
);
update public.triggers set resolved_at = now(), resolved_by = 'owner' where id = '60000000-0000-0000-0000-000000000001';
select lives_ok(
  format($$ insert into public.triggers (owner_id, rule, platform, note) values (%L, 'T4', 'instagram', 'new change') $$, :owner),
  'FR-22: a trigger can fire again once the previous one is resolved'
);

-- settings
select throws_ok(
  format($$ insert into public.settings (owner_id) values (%L) $$, :owner),
  '23505', null, 'FR-24: one settings row per owner'
);

select * from finish();
rollback;
