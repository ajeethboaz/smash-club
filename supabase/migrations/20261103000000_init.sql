-- Smash Club: initial schema
-- Run this once in the Supabase SQL editor (or `supabase db push`).

create extension if not exists pgcrypto;

-- ─── Tables ────────────────────────────────────────────────────────────────

create table public.players (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text unique,
  user_id     uuid unique references auth.users(id) on delete set null,
  is_admin    boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.settings (
  id             int primary key default 1 check (id = 1),
  club_name      text not null default 'Smash Club',
  court_start    time not null default '06:00',
  grace_minutes  int  not null default 0 check (grace_minutes between 0 and 60),
  timezone       text not null default 'Asia/Kolkata',
  court_lat      double precision,
  court_lng      double precision,
  court_radius_m int  not null default 300
);

create table public.months (
  month      date primary key check (extract(day from month) = 1),
  court_fee  numeric(10,2) not null default 0,
  cork_fee   numeric(10,2) not null default 0,
  other_fee  numeric(10,2) not null default 0
);

create table public.month_players (
  month      date references public.months(month) on delete cascade,
  player_id  uuid references public.players(id) on delete cascade,
  playing    boolean not null default true,
  primary key (month, player_id)
);

create table public.payments (
  month           date references public.months(month) on delete cascade,
  player_id       uuid references public.players(id) on delete cascade,
  marked_paid_at  timestamptz,
  confirmed_at    timestamptz,
  confirmed_by    uuid references public.players(id),
  primary key (month, player_id)
);

create table public.checkins (
  id             uuid primary key default gen_random_uuid(),
  player_id      uuid not null references public.players(id) on delete cascade,
  play_date      date not null,
  checked_in_at  timestamptz not null default now(),
  edited_by      uuid references public.players(id),
  unique (player_id, play_date)
);

create table public.games (
  id           uuid primary key default gen_random_uuid(),
  played_at    timestamptz not null default now(),
  format       text not null check (format in ('singles','doubles')),
  score_a      int not null check (score_a >= 0 and score_a <= 99),
  score_b      int not null check (score_b >= 0 and score_b <= 99),
  logged_by    uuid references public.players(id),
  flagged_by   uuid references public.players(id),
  flag_reason  text,
  created_at   timestamptz not null default now(),
  check (score_a <> score_b)
);

create table public.game_players (
  game_id    uuid references public.games(id) on delete cascade,
  player_id  uuid references public.players(id) on delete cascade,
  team       char(1) not null check (team in ('A','B')),
  primary key (game_id, player_id)
);

create index on public.checkins (play_date);
create index on public.games (played_at);

-- ─── Helpers ───────────────────────────────────────────────────────────────

create or replace function public.current_player_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from players where user_id = auth.uid()
$$;

create or replace function public.is_player() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from players where user_id = auth.uid())
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from players where user_id = auth.uid() and is_admin)
$$;

create or replace function public.club_today() returns date
language sql stable security definer set search_path = public as $$
  select (now() at time zone (select timezone from settings where id = 1))::date
$$;

-- Link the signed-in account to the player row the admin created for that email.
create or replace function public.claim_player() returns public.players
language plpgsql security definer set search_path = public as $$
declare
  me players;
  mail text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  select * into me from players where user_id = auth.uid();
  if found then return me; end if;
  if mail = '' then return null; end if;
  update players set user_id = auth.uid()
   where lower(email) = mail and user_id is null
  returning * into me;
  return me;
end $$;

-- Make sure the current month exists, copying fees and line-up from the latest month.
create or replace function public.ensure_current_month() returns date
language plpgsql security definer set search_path = public as $$
declare
  m date := date_trunc('month', club_today())::date;
  prev months;
begin
  if not is_player() then raise exception 'not a player'; end if;
  if exists (select 1 from months where month = m) then return m; end if;
  select * into prev from months where month < m order by month desc limit 1;
  insert into months (month, court_fee, cork_fee, other_fee)
  values (m, coalesce(prev.court_fee, 0), coalesce(prev.cork_fee, 0), 0)
  on conflict do nothing;
  if prev.month is not null then
    insert into month_players (month, player_id, playing)
    select m, mp.player_id, mp.playing
      from month_players mp join players p on p.id = mp.player_id
     where mp.month = prev.month and p.active
    on conflict do nothing;
  end if;
  insert into month_players (month, player_id, playing)
  select m, p.id, true from players p where p.active
  on conflict do nothing;
  return m;
end $$;

-- ─── Player actions (RPCs) ─────────────────────────────────────────────────

-- Check in for today. The server sets the time, so nobody can backdate.
create or replace function public.check_in() returns public.checkins
language plpgsql security definer set search_path = public as $$
declare
  me uuid := current_player_id();
  row checkins;
begin
  if me is null then raise exception 'not a player'; end if;
  insert into checkins (player_id, play_date) values (me, club_today())
  on conflict (player_id, play_date) do nothing
  returning * into row;
  if row.id is null then
    select * into row from checkins where player_id = me and play_date = club_today();
  end if;
  return row;
end $$;

create or replace function public.log_game(
  p_format text, p_team_a uuid[], p_team_b uuid[], p_score_a int, p_score_b int
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := current_player_id();
  size int := case p_format when 'singles' then 1 when 'doubles' then 2 else 0 end;
  all_ids uuid[] := p_team_a || p_team_b;
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
  if (select count(*) from players where id = any(all_ids)) <> size * 2 then
    raise exception 'unknown player';
  end if;
  if not (me = any(all_ids) or is_admin()) then
    raise exception 'only someone who played can log this game';
  end if;
  insert into games (format, score_a, score_b, logged_by)
  values (p_format, p_score_a, p_score_b, me) returning id into gid;
  insert into game_players (game_id, player_id, team)
  select gid, unnest(p_team_a), 'A' union all select gid, unnest(p_team_b), 'B';
  return gid;
end $$;

create or replace function public.flag_game(p_game uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := current_player_id();
begin
  if not exists (select 1 from game_players where game_id = p_game and player_id = me) and not is_admin() then
    raise exception 'only players in the game can flag it';
  end if;
  if not is_admin() and (select created_at from games where id = p_game) < now() - interval '24 hours' then
    raise exception 'games can only be flagged within 24 hours';
  end if;
  update games set flagged_by = me, flag_reason = left(p_reason, 200) where id = p_game;
end $$;

create or replace function public.mark_paid(p_month date) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := current_player_id();
begin
  if me is null then raise exception 'not a player'; end if;
  insert into payments (month, player_id, marked_paid_at) values (p_month, me, now())
  on conflict (month, player_id) do update set marked_paid_at = coalesce(payments.marked_paid_at, now());
end $$;

-- ─── Row-level security ────────────────────────────────────────────────────

alter table public.players       enable row level security;
alter table public.settings      enable row level security;
alter table public.months        enable row level security;
alter table public.month_players enable row level security;
alter table public.payments      enable row level security;
alter table public.checkins      enable row level security;
alter table public.games         enable row level security;
alter table public.game_players  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['players','settings','months','month_players','payments','checkins','games','game_players'] loop
    execute format('create policy "players can read" on public.%I for select to authenticated using (public.is_player())', t);
    execute format('create policy "admin can write" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

grant execute on function public.claim_player, public.ensure_current_month, public.check_in,
  public.log_game, public.flag_game, public.mark_paid, public.club_today to authenticated;
