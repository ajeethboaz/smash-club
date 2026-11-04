-- Lets the admin see who has actually opened the app.
-- The app calls mark_seen() each time it loads; it only writes once every few minutes.
alter table public.players add column if not exists last_seen_at timestamptz;

create or replace function public.mark_seen() returns void
language plpgsql security definer set search_path = public as $$
begin
  update players set last_seen_at = now()
   where id = current_player_id()
     and (last_seen_at is null or last_seen_at < now() - interval '5 minutes');
end $$;

revoke all on function public.mark_seen() from public, anon;
grant execute on function public.mark_seen() to authenticated;
