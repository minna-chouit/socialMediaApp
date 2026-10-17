-- FR-1: posts from Claude (created_by = claude, or anything inserted through cadence_mcp) start as proposed.
create function public.claude_posts_start_proposed() returns trigger
language plpgsql as $$
begin
  if current_user = 'cadence_mcp' then
    new.created_by := 'claude';
  end if;
  if new.created_by = 'claude' then
    new.status := 'proposed';
  end if;
  return new;
end $$;

create trigger claude_posts_start_proposed before insert on public.posts
  for each row execute function public.claude_posts_start_proposed();
