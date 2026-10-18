-- NFR-6 structure: every section 5 table exists, has RLS, and grants match the roles.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select set_eq(
  $$ select tablename::text from pg_tables where schemaname = 'public' $$,
  array[
    'posts', 'variants', 'change_log', 'media', 'post_media', 'idea_media', 'ideas',
    'idea_verdicts', 'checkins', 'follower_snapshots', 'weekly_reports', 'milestones',
    'triggers', 'reminders', 'push_subscriptions', 'settings', 'tasks'
  ],
  'NFR-6: the public schema has exactly the section 5 tables'
);

select is_empty(
  $$ select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity $$,
  'NFR-6: row-level security is enabled on every table in public'
);

select has_role('cadence_mcp', 'NFR-6: the cadence_mcp role exists');

select is_empty(
  $$ select t.tablename::text from pg_tables t
     where t.schemaname = 'public' and (
       -- change_log is insert-only (FR-3), so it needs no UPDATE.
       (select count(distinct g.privilege_type) from information_schema.role_table_grants g
        where g.table_schema = 'public' and g.table_name = t.tablename and g.grantee = 'cadence_mcp'
          and g.privilege_type in ('SELECT', 'INSERT', 'UPDATE'))
         < case when t.tablename = 'change_log' then 2 else 3 end
       or exists (select 1 from information_schema.role_table_grants g
        where g.table_schema = 'public' and g.table_name = t.tablename and g.grantee = 'cadence_mcp'
          and g.privilege_type in ('DELETE', 'TRUNCATE'))
     ) $$,
  'NFR-6: cadence_mcp has SELECT, INSERT and UPDATE (change_log: no UPDATE) but no DELETE on every table'
);

select is_empty(
  $$ select table_name::text from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'anon' $$,
  'NFR-6: anon has no access to any table'
);

select * from finish();
rollback;
