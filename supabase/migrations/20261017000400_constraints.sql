-- Per-table constraints from SRS section 5. Core enforces the same rules; these are the backstop.

-- FR-4: formats allowed per platform, one variant per platform per post.
alter table public.variants
  add constraint format_allowed_for_platform check (
    (platform = 'instagram' and format in ('reel', 'carousel', 'photo', 'story'))
    or (platform = 'tiktok' and format in ('video', 'photo'))
    or (platform = 'linkedin' and format in ('text', 'image', 'document', 'video'))
  ),
  add constraint one_variant_per_platform unique (post_id, platform);

-- FR-5: one check-in per variant per day offset.
alter table public.checkins add constraint one_checkin_per_offset unique (variant_id, day_offset);

-- FR-10: the verdict is computed by core; the database rejects anything inconsistent.
create function public.verdict_scores_valid(scores jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(scores) = 'object'
    and (select array_agg(k order by k) from jsonb_object_keys(scores) as k)
        = array['doable', 'fills_gap', 'forwardable', 'hook', 'original']
    and (select bool_and(jsonb_typeof(v) = 'number' and v::numeric in (1, 2, 3))
         from jsonb_each(scores) as e (k, v))
$$;
create function public.verdict_total(scores jsonb) returns int
language sql immutable set search_path = '' as $$
  select sum(v::int)::int from jsonb_each(scores) as e (k, v)
$$;
alter table public.idea_verdicts
  add constraint scores_valid check (public.verdict_scores_valid(scores)),
  add constraint at_least_one_alternative check (cardinality(alternatives) >= 1),
  add constraint total_matches_scores check (total = public.verdict_total(scores)),
  add constraint verdict_matches_total check (
    verdict = case when total >= 11 then 'go' when total >= 8 then 'improve' else 'bank' end::public.verdict
  );

-- FR-11: linking a post to an idea marks the idea promoted.
create function public.promote_idea() returns trigger
language plpgsql set search_path = '' as $$
begin
  update public.ideas set status = 'promoted' where id = new.idea_id;
  return new;
end $$;
create trigger promote_idea after insert or update of idea_id on public.posts
  for each row when (new.idea_id is not null) execute function public.promote_idea();

-- FR-12: uploads above the owner's limit are rejected with a clear message.
create function public.check_upload_size() returns trigger
language plpgsql set search_path = '' as $$
declare limit_mb int := coalesce(
  (select max_upload_mb from public.settings where owner_id = new.owner_id), 100);
begin
  if new.size_bytes > limit_mb::bigint * 1024 * 1024 then
    raise exception 'Upload is % MB; the limit is % MB', ceil(new.size_bytes / 1048576.0), limit_mb;
  end if;
  return new;
end $$;
create trigger check_upload_size before insert or update of size_bytes on public.media
  for each row execute function public.check_upload_size();

-- FR-13 / FR-14: idempotent reminder keys, one row per push endpoint.
alter table public.reminders add constraint reminder_key_unique unique (owner_id, key);
alter table public.push_subscriptions add constraint endpoint_unique unique (endpoint);

-- FR-17: one report per week; only ready_for_claude_at may change.
alter table public.weekly_reports add constraint one_report_per_week unique (owner_id, week_start);
create function public.weekly_report_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- set_updated_at runs first (triggers fire in name order), so updated_at is ignored too.
  if to_jsonb(new) - 'ready_for_claude_at' - 'updated_at'
     is distinct from to_jsonb(old) - 'ready_for_claude_at' - 'updated_at' then
    raise exception 'Weekly reports are immutable except ready_for_claude_at';
  end if;
  return new;
end $$;
create trigger weekly_report_immutable before update on public.weekly_reports
  for each row execute function public.weekly_report_immutable();

-- FR-20: one non-negative count per platform per week.
alter table public.follower_snapshots
  add constraint one_count_per_week unique (owner_id, platform, week_start),
  add constraint count_not_negative check (count >= 0);

-- FR-21: one milestone per kind and week.
alter table public.milestones add constraint one_milestone_per_week unique (owner_id, kind, week);

-- FR-22: one unresolved trigger per rule and platform (platform may be null for T2, T3).
create unique index one_unresolved_trigger on public.triggers (owner_id, rule, coalesce(platform::text, ''))
  where resolved_at is null;
