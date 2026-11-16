-- Warn before saving the same game twice.
-- log_game gets p_allow_duplicate (default false). If an unflagged game with the same players,
-- same score and same day already exists, it refuses with 'DUPLICATE:<who logged it>' so the app
-- can ask "same game, or a new one?". Saying "new game" calls again with p_allow_duplicate = true.

drop function if exists public.log_game(text, uuid[], uuid[], int, int, date);

create or replace function public.log_game(
  p_format text, p_team_a uuid[], p_team_b uuid[], p_score_a int, p_score_b int,
  p_played_on date default null, p_allow_duplicate boolean default false
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
  tz text;
  sa uuid[] := (select array_agg(x order by x) from unnest(p_team_a) x);
  sb uuid[] := (select array_agg(x order by x) from unnest(p_team_b) x);
  dup_by text;
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

  -- Same players, same score, same day, not flagged: probably someone already logged it.
  if not p_allow_duplicate then
    select timezone into tz from clubs where id = c;
    select p.name into dup_by
    from games g
    join players p on p.id = g.logged_by
    cross join lateral (
      select array_agg(gp.player_id order by gp.player_id) filter (where gp.team = 'A') ta,
             array_agg(gp.player_id order by gp.player_id) filter (where gp.team = 'B') tb
      from game_players gp where gp.game_id = g.id
    ) t
    where g.club_id = c and g.flagged_by is null and g.format = p_format
      and (g.played_at at time zone tz)::date = coalesce(p_played_on, today)
      and ((g.score_a = p_score_a and g.score_b = p_score_b and t.ta = sa and t.tb = sb)
        or (g.score_a = p_score_b and g.score_b = p_score_a and t.ta = sb and t.tb = sa))
    limit 1;
    if dup_by is not null then
      raise exception 'DUPLICATE:%', case when dup_by = (select name from players where id = me) then 'You' else dup_by end;
    end if;
  end if;

  insert into games (club_id, played_at, format, score_a, score_b, logged_by)
  values (c, at, p_format, p_score_a, p_score_b, me) returning id into gid;
  insert into game_players (club_id, game_id, player_id, team)
  select c, gid, unnest(p_team_a), 'A' union all select c, gid, unnest(p_team_b), 'B';
  return gid;
end $$;

revoke all on function public.log_game(text, uuid[], uuid[], int, int, date, boolean) from public, anon;
grant execute on function public.log_game(text, uuid[], uuid[], int, int, date, boolean) to authenticated;
