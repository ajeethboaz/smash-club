-- Players can undo their own check-in for today (e.g. tapped by mistake).
-- Past days stay locked; the admin can still fix any day from Admin → Fix a check-in.
create or replace function public.undo_check_in() returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := current_player_id();
begin
  if me is null then raise exception 'not a player'; end if;
  delete from checkins where player_id = me and play_date = club_today();
end $$;

revoke all on function public.undo_check_in() from public, anon;
grant execute on function public.undo_check_in() to authenticated;
