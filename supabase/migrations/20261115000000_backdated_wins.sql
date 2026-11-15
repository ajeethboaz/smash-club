-- Log a win for an earlier day (up to 7 days back).
-- log_game gets an optional p_played_on date. Left out (or today) it behaves exactly as before.
-- For an earlier day the game is stamped at court start + 30 min that day, in the club's time zone.
-- created_at still records when it was actually logged, so the app can tag it "logged late",
-- and the 24-hour flag window runs from when it was logged.

drop function if exists public.log_game(text, uuid[], uuid[], int, int);

create or replace function public.log_game(
  p_format text, p_team_a uuid[], p_team_b uuid[], p_score_a int, p_score_b int,
  p_played_on date default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := current_player_id();
  c uuid := current_club_id();
  size int := case p_format when 'singles' then 1 when 'doubles' then 2 else 0 end;
  all_ids uuid[] := p_team_a || p_team_b;
  today date := club_today();
  at timestamptz := now();
  gid uuid;
begin
  if me is null then raise exception 'not a player'; end if;
  if size = 0 then raise exception 'format must be singles or doubles'; end if;
  if coalesce(array_length(p_team_a,1),0) <> size or coalesce(array_length(p_team_b,1),0) <> size then
    raise exception 'each team needs % player(s)', size;
  end if;
  if (select count(distinct x) from unnest(all_ids) x) <> size * 2 then
    raise exception 'a player cannot be on both teams';
  end if;
  if (select count(*) from players where id = any(all_ids) and club_id = c) <> size * 2 then
    raise exception 'unknown player';
  end if;
  if not (me = any(all_ids) or is_admin()) then
    raise exception 'only someone who played can log this game';
  end if;

  if p_played_on is not null and p_played_on <> today then
    if p_played_on > today then raise exception 'You can''t log a game for a future date'; end if;
    if p_played_on < today - 7 then raise exception 'Wins can only be logged up to 7 days back'; end if;
    select ((p_played_on + cl.court_start + interval '30 minutes') at time zone cl.timezone)
      into at from clubs cl where cl.id = c;
  end if;

  insert into games (club_id, played_at, format, score_a, score_b, logged_by)
  values (c, at, p_format, p_score_a, p_score_b, me) returning id into gid;
  insert into game_players (club_id, game_id, player_id, team)
  select c, gid, unnest(p_team_a), 'A' union all select c, gid, unnest(p_team_b), 'B';
  return gid;
end $$;

revoke all on function public.log_game(text, uuid[], uuid[], int, int, date) from public, anon;
grant execute on function public.log_game(text, uuid[], uuid[], int, int, date) to authenticated;
