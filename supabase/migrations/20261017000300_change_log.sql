-- FR-3: every changed post and variant field is appended to change_log, which is insert-only.
-- Actor: claude for cadence_mcp, else the transaction's cadence.actor setting, else owner.
-- Reason: the transaction's cadence.reason setting (required from the connector, section 6.2).
-- Runs as the caller (not security definer) so current_user identifies cadence_mcp and RLS applies.
create function public.log_changes() returns trigger
language plpgsql set search_path = '' as $$
declare
  old_row jsonb := to_jsonb(old);
  new_row jsonb := to_jsonb(new);
  field text;
  who public.actor := case
    when current_user = 'cadence_mcp' then 'claude'
    else coalesce(nullif(current_setting('cadence.actor', true), ''), 'owner')
  end::public.actor;
  why text := nullif(current_setting('cadence.reason', true), '');
begin
  for field in select jsonb_object_keys(new_row) loop
    if field <> 'updated_at' and new_row -> field is distinct from old_row -> field then
      insert into public.change_log (owner_id, entity_type, entity_id, actor, field, old_value, new_value, reason)
      values (new.owner_id, tg_argv[0], new.id, who, field, old_row -> field, new_row -> field, why);
    end if;
  end loop;
  return new;
end $$;

create trigger log_changes after update on public.posts
  for each row execute function public.log_changes('post');
create trigger log_changes after update on public.variants
  for each row execute function public.log_changes('variant');

revoke update, delete, truncate on public.change_log from authenticated, cadence_mcp, anon;
