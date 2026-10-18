-- Tasks: owner or Claude to-dos, optionally linked to a post. They do not affect balance rules.
create type public.task_type as enum ('shoot', 'edit', 'write', 'post', 'log', 'other');

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null check (length(trim(title)) > 0),
  type public.task_type not null default 'other',
  due_at timestamptz not null,
  done boolean not null default false,
  notes text,
  post_id uuid references public.posts (id) on delete set null,
  created_by public.actor not null default 'owner',
  completed_at timestamptz,
  -- Claude cannot delete (section 6.2): its delete_task hides the task by setting this instead.
  cancelled_at timestamptz
);
create index tasks_due on public.tasks (owner_id, due_at) where cancelled_at is null;

alter table public.tasks enable row level security;
create policy owner_only on public.tasks for all to authenticated, cadence_mcp
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create trigger set_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();
create trigger log_changes after update on public.tasks
  for each row execute function public.log_changes('task');

-- Anything cadence_mcp inserts is Claude's; done stamps completed_at.
create function public.task_defaults() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' and current_user = 'cadence_mcp' then
    new.created_by := 'claude';
  end if;
  if new.done and (tg_op = 'INSERT' or not old.done) then
    new.completed_at := now();
  elsif not new.done then
    new.completed_at := null;
  end if;
  return new;
end $$;
create trigger task_defaults before insert or update on public.tasks
  for each row execute function public.task_defaults();

revoke all on public.tasks from anon;
grant select, insert, update on public.tasks to cadence_mcp;
