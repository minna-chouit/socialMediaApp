-- Cadence schema (SRS section 5): tables, owner-only RLS and the cadence_mcp role (NFR-6).

create type public.stage as enum (
  'idea', 'proposed', 'approved', 'capture', 'edit', 'write', 'scheduled', 'posted', 'replied',
  'reviewed', 'archived'
);
create type public.pillar as enum ('life_style', 'student_life', 'pov_journey', 'work_lessons');
create type public.topic as enum ('ai', 'uiux', 'gamedev', 'ar', 'accessibility');
create type public.platform as enum ('instagram', 'tiktok', 'linkedin');
create type public.format as enum (
  'reel', 'carousel', 'photo', 'story', 'video', 'text', 'image', 'document'
);
create type public.language as enum ('en', 'darija', 'mixed');
create type public.actor as enum ('owner', 'claude', 'system');
create type public.verdict as enum ('go', 'improve', 'bank');
create type public.media_kind as enum ('photo', 'video');
create type public.idea_source as enum ('phone', 'pc', 'chat');
create type public.idea_status as enum ('new', 'reviewed', 'promoted', 'banked');
create type public.milestone_kind as enum ('checkpoint', 'research_refresh');
create type public.trigger_rule as enum ('T1', 'T2', 'T3', 'T4');

-- Columns every table has.
--   id, owner_id (defaults to the signed-in user), created_at, updated_at

create table public.ideas (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  text text not null,
  source public.idea_source not null,
  tags text[] not null default '{}',
  pillar public.pillar,
  topics public.topic[] not null default '{}',
  status public.idea_status not null default 'new'
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null,
  pillar public.pillar not null,
  topics public.topic[] not null default '{}',
  status public.stage not null default 'idea',
  go_live_at timestamptz not null,
  notes text,
  is_leftovers boolean not null default false,
  idea_id uuid references public.ideas (id) on delete set null,
  created_by public.actor not null default 'owner',
  -- Per-post reminder overrides: { off: [codes], replyWindowMinutes } (SRS 4.7).
  reminder_overrides jsonb
);

create table public.variants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  post_id uuid not null references public.posts (id) on delete cascade,
  platform public.platform not null,
  format public.format not null,
  language public.language not null default 'en',
  caption text,
  hook text,
  hashtags text[] not null default '{}',
  scheduled_at timestamptz,
  scheduled_natively boolean not null default false,
  posted_at timestamptz,
  url text
);

create table public.change_log (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  entity_type text not null,
  entity_id uuid not null,
  actor public.actor not null,
  field text not null,
  old_value jsonb,
  new_value jsonb,
  reason text,
  at timestamptz not null default now()
);

create table public.media (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  storage_path text not null,
  kind public.media_kind not null,
  tags text[] not null default '{}',
  taken_at timestamptz,
  size_bytes bigint not null
);

create table public.post_media (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  post_id uuid not null references public.posts (id) on delete cascade,
  media_id uuid not null references public.media (id) on delete cascade,
  primary key (post_id, media_id)
);

create table public.idea_media (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  idea_id uuid not null references public.ideas (id) on delete cascade,
  media_id uuid not null references public.media (id) on delete cascade,
  primary key (idea_id, media_id)
);

create table public.idea_verdicts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  idea_id uuid not null references public.ideas (id) on delete cascade,
  scores jsonb not null,
  total int not null,
  verdict public.verdict not null,
  notes text not null,
  alternatives text[] not null,
  by public.actor not null
);

create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  variant_id uuid not null references public.variants (id) on delete cascade,
  day_offset int not null,
  due_at timestamptz not null,
  done_at timestamptz,
  views int,
  reach int,
  likes int,
  comments int,
  saves int,
  shares int,
  follows int,
  avg_watch_seconds int
);

create table public.follower_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  platform public.platform not null,
  count int not null,
  week_start date not null,
  taken_at timestamptz not null default now()
);

create table public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  week_start date not null,
  payload jsonb not null,
  generated_at timestamptz not null,
  ready_for_claude_at timestamptz
);

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  kind public.milestone_kind not null,
  week int not null,
  title text not null,
  checks text[] not null default '{}',
  due_at timestamptz not null,
  outcome text,
  decision text
);

create table public.triggers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  rule public.trigger_rule not null,
  platform public.platform,
  params jsonb not null default '{}',
  note text,
  fired_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by public.actor
);

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  code text not null,
  key text not null,
  -- Check-in reminders use "variantId:dN" (SRS 4.7), so this is text, not uuid.
  entity_type text,
  entity_id text,
  send_at timestamptz not null,
  sent_at timestamptz,
  cancelled_at timestamptz,
  urgent boolean not null default false,
  calendar_event_id text
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  endpoint text not null,
  keys jsonb not null,
  device_label text
);

create table public.settings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  timezone text not null default 'Africa/Algiers',
  phase int not null default 1,
  report_time time not null default '20:00',
  batch_time time not null default '20:15',
  reply_window_minutes int not null default 15,
  quiet_start time not null default '23:30',
  quiet_end time not null default '08:00',
  checkin_offsets jsonb not null default '{"instagram":[3,7],"tiktok":[3,7,14],"linkedin":[3,7]}',
  rule_params jsonb not null default '{}',
  work_on_personal boolean not null default false,
  reply_reminders_tiktok boolean not null default false,
  max_upload_mb int not null default 100,
  first_post_at timestamptz
);

create function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- The MCP server's role: read and write, never delete (section 6.2 rule 1).
create role cadence_mcp nologin;
grant usage on schema public, auth to cadence_mcp;
grant execute on function auth.uid() to cadence_mcp;

-- Every table: owner-only RLS for the app and the connector, and updated_at upkeep.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy owner_only on public.%I for all to authenticated, cadence_mcp
         using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))',
      t
    );
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()',
      t
    );
  end loop;
end $$;

revoke all on all tables in schema public from anon;
grant select, insert, update on all tables in schema public to cadence_mcp;
-- Tables added later get the same grants.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public
  grant select, insert, update on tables to cadence_mcp;
