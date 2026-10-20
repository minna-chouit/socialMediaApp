-- FR-29: variants can be added to and removed from a post. Removing hides the row (removed_at) so it
-- stays in the change log; created_by drives the Claude badge, as on tasks.
alter table public.variants
  add column created_by public.actor not null default 'owner',
  add column removed_at timestamptz,
  add constraint posted_variant_not_removed check (removed_at is null or posted_at is null);

-- FR-4 now counts only variants that are not removed, so a removed platform can be added again.
alter table public.variants drop constraint one_variant_per_platform;
create unique index one_variant_per_platform on public.variants (post_id, platform)
  where removed_at is null;

-- Anything cadence_mcp inserts is Claude's.
create function public.variant_defaults() returns trigger
language plpgsql as $$
begin
  if current_user = 'cadence_mcp' then
    new.created_by := 'claude';
  end if;
  return new;
end $$;
create trigger variant_defaults before insert on public.variants
  for each row execute function public.variant_defaults();

-- Variants of Claude's existing proposals are Claude's too (not a change worth logging).
alter table public.variants disable trigger log_changes;
update public.variants v set created_by = 'claude'
  from public.posts p where p.id = v.post_id and p.created_by = 'claude';
alter table public.variants enable trigger log_changes;
