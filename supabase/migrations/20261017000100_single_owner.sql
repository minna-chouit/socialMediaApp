-- FR-26: one owner. The first sign-up becomes the owner and gets a settings row; later ones fail.
create function public.on_sign_up() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from auth.users where id <> new.id) then
    raise exception 'Cadence has a single owner; sign-up is closed';
  end if;
  insert into public.settings (owner_id) values (new.id);
  return new;
end $$;

revoke execute on function public.on_sign_up() from public, anon, authenticated;

create trigger on_sign_up after insert on auth.users
  for each row execute function public.on_sign_up();
