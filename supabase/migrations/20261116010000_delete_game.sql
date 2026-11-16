-- Let the person who logged a game delete it within 24 hours (typos, wrong players).
-- Club admins can delete any game in their club, any time.

create or replace function public.delete_game(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := current_player_id();
  g games%rowtype;
begin
  if me is null then raise exception 'not a player'; end if;
  select * into g from games where id = p_game and club_id = current_club_id();
  if not found then raise exception 'game not found'; end if;
  if not is_admin() then
    if g.logged_by is distinct from me then raise exception 'Only the person who logged a game can delete it'; end if;
    if g.created_at < now() - interval '24 hours' then raise exception 'Games can only be deleted within 24 hours. Ask an admin.'; end if;
  end if;
  delete from games where id = p_game; -- game_players go with it
end $$;

revoke all on function public.delete_game(uuid) from public, anon;
grant execute on function public.delete_game(uuid) to authenticated;
