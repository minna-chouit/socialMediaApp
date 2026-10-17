-- FR-26: Cadence has exactly one owner.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@example.test');

select throws_ok(
  $$ insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000b', 'second@example.test') $$,
  'P0001',
  'Cadence has a single owner; sign-up is closed',
  'FR-26: a second sign-up is rejected'
);

select results_eq(
  $$ select timezone, phase, report_time::text, batch_time::text, reply_window_minutes,
            quiet_start::text, quiet_end::text, work_on_personal, max_upload_mb
     from public.settings where owner_id = '00000000-0000-0000-0000-00000000000a' $$,
  $$ values ('Africa/Algiers', 1, '20:00:00', '20:15:00', 15, '23:30:00', '08:00:00', false, 100) $$,
  'FR-26: the owner gets a settings row on sign-up, with section 5 defaults'
);

select is(
  (select checkin_offsets from public.settings where owner_id = '00000000-0000-0000-0000-00000000000a'),
  '{"instagram":[3,7],"tiktok":[3,7,14],"linkedin":[3,7]}'::jsonb,
  'FR-26: the settings row starts with the default check-in offsets'
);

select * from finish();
rollback;
