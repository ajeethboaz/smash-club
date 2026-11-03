-- Switch to username + password logins (no emails are ever sent).
-- Each username is stored as <username>@smash-club.app in players.email.
-- Also in Supabase: Authentication → Sign In / Providers → Email → turn OFF "Confirm email".

update public.players set email = 'ajeeth@smash-club.app', user_id = null
 where name = 'Ajeeth' and user_id is null;

-- True until the first account is linked, so the admin can create their own login.
create or replace function public.needs_first_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from players where user_id is not null)
$$;
grant execute on function public.needs_first_admin() to anon, authenticated;
