-- Lets the admin reset a player's password from the Admin screen (no emails).
create extension if not exists pgcrypto with schema extensions;

create or replace function public.admin_set_password(p_username text, p_password text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then raise exception 'Only the admin can reset passwords'; end if;
  if length(p_password) < 6 then raise exception 'Password must be at least 6 characters'; end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
   where email = lower(p_username) || '@smash-club.app';
  if not found then raise exception 'No login with that username'; end if;
end $$;

revoke all on function public.admin_set_password(text, text) from public, anon;
grant execute on function public.admin_set_password(text, text) to authenticated;
