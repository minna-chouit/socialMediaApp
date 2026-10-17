-- The parts of Supabase our migrations rely on, for running them in PGlite (no Docker).
-- CI also runs the contract tests against a real local Supabase, so drift shows up there.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create schema extensions;
grant usage on schema public, auth to anon, authenticated, service_role;

create table auth.users (id uuid primary key, email text);

create function auth.uid() returns uuid
language sql stable as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      current_setting('request.jwt.claims', true)::jsonb ->> 'sub'
    ),
    ''
  )::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Supabase grants table access to its API roles by default; RLS then restricts rows.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
