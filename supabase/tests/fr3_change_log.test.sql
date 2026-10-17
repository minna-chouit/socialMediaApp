-- FR-3: every post and variant edit is recorded in an insert-only change_log.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@example.test');
insert into public.posts (id, owner_id, title, pillar, go_live_at)
  values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
          'Dorm tour', 'life_style', '2026-10-20 18:00+00');
insert into public.variants (id, owner_id, post_id, platform, format, hook)
  values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
          '20000000-0000-0000-0000-000000000001', 'instagram', 'reel', 'Old hook');
grant usage on schema extensions to cadence_mcp;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

update public.posts set title = 'Dorm tour v2' where id = '20000000-0000-0000-0000-000000000001';
select results_eq(
  $$ select entity_type, entity_id::text, actor::text, field, old_value, new_value, at is not null
     from public.change_log where field = 'title' $$,
  $$ values ('post', '20000000-0000-0000-0000-000000000001', 'owner', 'title',
             '"Dorm tour"'::jsonb, '"Dorm tour v2"'::jsonb, true) $$,
  'FR-3: editing a post field appends a change_log row with actor, field, old value, new value and time'
);

update public.variants set scheduled_at = '2026-10-21 18:00+00', hook = 'New hook', caption = null
  where id = '30000000-0000-0000-0000-000000000001';
select set_eq(
  $$ select field from public.change_log where entity_type = 'variant' $$,
  array['scheduled_at', 'hook'],
  'FR-3: editing a variant date is logged, one row per changed field; unchanged fields are not logged'
);

select throws_ok(
  $$ update public.change_log set reason = 'rewrite history' $$,
  '42501',
  null,
  'FR-3: change_log is insert-only: the owner cannot update it'
);
select throws_ok(
  $$ delete from public.change_log $$,
  '42501',
  null,
  'FR-3: change_log is insert-only: the owner cannot delete from it'
);
reset role;

set local role cadence_mcp;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', true);
select set_config('cadence.reason', 'Tighter hook for the first second', true);
update public.variants set hook = 'Claude hook' where id = '30000000-0000-0000-0000-000000000001';
select results_eq(
  $$ select actor::text, reason, new_value from public.change_log
     where entity_type = 'variant' and field = 'hook' and actor = 'claude' $$,
  $$ values ('claude', 'Tighter hook for the first second', '"Claude hook"'::jsonb) $$,
  'FR-3: writes by the cadence_mcp role log actor = claude, with the reason given'
);
select throws_ok(
  $$ update public.change_log set reason = 'rewrite history' $$,
  '42501',
  null,
  'FR-3: change_log is insert-only: cadence_mcp cannot update it'
);
reset role;

select * from finish();
rollback;
