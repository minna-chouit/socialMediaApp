-- FR-1: creating posts; Claude's posts always start as proposed.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@example.test');
grant usage on schema extensions to cadence_mcp;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

insert into public.posts (id, title, pillar, go_live_at)
  values ('20000000-0000-0000-0000-000000000001', 'Dorm tour', 'life_style', '2026-10-20 18:00+00');
select results_eq(
  $$ select status::text, created_by::text from public.posts where id = '20000000-0000-0000-0000-000000000001' $$,
  $$ values ('idea', 'owner') $$,
  'FR-1: an owner-created post defaults to status idea'
);

insert into public.posts (id, title, pillar, go_live_at, created_by, status)
  values ('20000000-0000-0000-0000-000000000002', 'Lab day', 'student_life', '2026-10-21 18:00+00', 'claude', 'approved');
select is(
  (select status::text from public.posts where id = '20000000-0000-0000-0000-000000000002'),
  'proposed',
  'FR-1: created_by = claude forces status proposed on insert'
);

select throws_ok(
  $$ insert into public.posts (pillar, go_live_at) values ('life_style', now()) $$,
  '23502',
  null,
  'FR-1: title, pillar and go_live_at are required; topics only accept the topic enum'
);
reset role;

set local role cadence_mcp;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', true);
insert into public.posts (id, title, pillar, go_live_at, status)
  values ('20000000-0000-0000-0000-000000000003', 'Hackathon recap', 'pov_journey', '2026-10-22 18:00+00', 'scheduled');
select results_eq(
  $$ select status::text, created_by::text from public.posts where id = '20000000-0000-0000-0000-000000000003' $$,
  $$ values ('proposed', 'claude') $$,
  'FR-1: posts inserted through cadence_mcp are created_by claude and proposed'
);
reset role;

select * from finish();
rollback;
