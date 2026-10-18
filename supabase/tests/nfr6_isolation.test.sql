-- NFR-6 isolation: rows are visible only to the owner they belong to.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- Fixture: the owner and one row in every table (inserted as postgres, which bypasses RLS).
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@example.test');
\set owner '''00000000-0000-0000-0000-00000000000a'''
\set other '''00000000-0000-0000-0000-00000000000b'''

insert into public.ideas (id, owner_id, text, source)
  values ('10000000-0000-0000-0000-000000000001', :owner, 'Dorm tour', 'phone');
insert into public.posts (id, owner_id, title, pillar, go_live_at, idea_id)
  values ('20000000-0000-0000-0000-000000000001', :owner, 'Seed post', 'life_style', '2026-10-19 10:00+00',
          '10000000-0000-0000-0000-000000000001');
insert into public.variants (id, owner_id, post_id, platform, format)
  values ('30000000-0000-0000-0000-000000000001', :owner, '20000000-0000-0000-0000-000000000001', 'instagram', 'reel');
insert into public.media (id, owner_id, storage_path, kind, size_bytes)
  values ('40000000-0000-0000-0000-000000000001', :owner, 'owner/a.jpg', 'photo', 1000);
insert into public.post_media (owner_id, post_id, media_id)
  values (:owner, '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001');
insert into public.idea_media (owner_id, idea_id, media_id)
  values (:owner, '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001');
insert into public.idea_verdicts (owner_id, idea_id, scores, total, verdict, notes, alternatives, by)
  values (:owner, '10000000-0000-0000-0000-000000000001',
          '{"forwardable":3,"fills_gap":2,"doable":2,"original":1,"hook":1}', 9, 'improve',
          'Weak payoff', array['Open with the result'], 'claude');
insert into public.checkins (owner_id, variant_id, day_offset, due_at)
  values (:owner, '30000000-0000-0000-0000-000000000001', 3, '2026-10-22 19:00+00');
insert into public.follower_snapshots (owner_id, platform, count, week_start)
  values (:owner, 'instagram', 120, '2026-10-17');
insert into public.weekly_reports (owner_id, week_start, payload, generated_at)
  values (:owner, '2026-10-17', '{}', '2026-10-23 19:00+00');
insert into public.milestones (owner_id, kind, week, title, checks, due_at)
  values (:owner, 'checkpoint', 1, 'Setup', array['Creator accounts'], '2026-10-23 19:00+00');
insert into public.triggers (owner_id, rule, platform, note)
  values (:owner, 'T4', 'instagram', 'Algorithm change');
insert into public.reminders (owner_id, code, key, send_at)
  values (:owner, 'WEEKLY_REPORT', 'WEEKLY_REPORT::2026-10-23', '2026-10-23 19:00+00');
insert into public.push_subscriptions (owner_id, endpoint, keys)
  values (:owner, 'https://push.example.test/1', '{}');
insert into public.settings (owner_id) values (:owner) on conflict (owner_id) do nothing;
insert into public.tasks (owner_id, title, due_at) values (:owner, 'Shoot B-roll', '2026-10-20 16:00+00');
insert into public.change_log (owner_id, entity_type, entity_id, actor, field, new_value)
  values (:owner, 'post', '20000000-0000-0000-0000-000000000001', 'owner', 'title', '"Seed post"');

-- Tables with at least one row visible to the current role and claims.
create schema tests;
create function tests.visible_tables() returns setof text language plpgsql as $$
declare t text; n bigint;
begin
  for t in select tablename from pg_tables where schemaname = 'public' order by 1 loop
    execute format('select count(*) from public.%I', t) into n;
    if n > 0 then return next t; end if;
  end loop;
end $$;
grant usage on schema tests to authenticated, cadence_mcp;
-- pgTAP lives in extensions; the production role needs no access there.
grant usage on schema extensions to cadence_mcp;
grant execute on function tests.visible_tables() to authenticated, cadence_mcp;

select set_eq(
  $$ select tests.visible_tables() $$,
  $$ select tablename::text from pg_tables where schemaname = 'public' $$,
  'NFR-6: the fixture has a row in every table'
);

-- As the owner.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_eq(
  $$ select tests.visible_tables() $$,
  $$ select tablename::text from pg_tables where schemaname = 'public' $$,
  'NFR-6: the owner sees their rows in every table'
);

-- As another signed-in user.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is_empty($$ select tests.visible_tables() $$, 'NFR-6: another user sees 0 rows in every table');
select throws_ok(
  format($$ insert into public.ideas (owner_id, text, source) values (%L, 'x', 'pc') $$, :owner),
  '42501',
  null,
  'NFR-6: another user cannot insert rows for the owner'
);
update public.posts set title = 'Hijacked';
delete from public.posts;
reset role;
select is(
  (select title from public.posts where id = '20000000-0000-0000-0000-000000000001'),
  'Seed post',
  'NFR-6: another user cannot update or delete the owner''s rows'
);

-- As the MCP server's role.
set local role cadence_mcp;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', true);
select set_eq(
  $$ select tests.visible_tables() $$,
  $$ select tablename::text from pg_tables where schemaname = 'public' $$,
  'NFR-6: cadence_mcp with the owner''s claims sees the owner''s rows'
);
select throws_ok(
  $$ delete from public.posts $$,
  '42501',
  null,
  'NFR-6: a DELETE as cadence_mcp fails'
);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b"}', true);
select is_empty($$ select tests.visible_tables() $$, 'NFR-6: cadence_mcp sees only rows of the owner whose claims it carries');
reset role;

select * from finish();
rollback;
