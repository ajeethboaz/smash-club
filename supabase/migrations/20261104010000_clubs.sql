-- Multiple clubs in one app.
-- Every row now belongs to a club. Players only ever see their own club.
-- Club admins run their own club (players, logins, costs, payments, settings, other admins).
-- The super admin (Ajeeth) can create clubs and manage any club's players, logins and admins,
-- but cannot see other clubs' money, check-ins or games.
-- Existing data becomes the club "Smash Club".

begin;

-- ─── Clubs (replaces the single settings row) ─────────────────────────────

create table public.clubs (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  court_start    time not null default '06:00',
  grace_minutes  int  not null default 0 check (grace_minutes between 0 and 60),
  timezone       text not null default 'Asia/Kolkata',
  court_lat      double precision,
  court_lng      double precision,
  court_radius_m int  not null default 300,
  created_at     timestamptz not null default now()
);

alter table public.players add column is_super boolean not null default false;

do $$
declare c uuid;
begin
  insert into clubs (name, court_start, grace_minutes, timezone, court_lat, court_lng, court_radius_m)
  select club_name, court_start, grace_minutes, timezone, court_lat, court_lng, court_radius_m from settings where id = 1
  returning id into c;
  if c is null then insert into clubs (name) values ('Smash Club') returning id into c; end if;

  alter table players       add column club_id uuid references clubs(id) on delete cascade;
  alter table months        add column club_id uuid references clubs(id) on delete cascade;
  alter table month_players add column club_id uuid references clubs(id) on delete cascade;
  alter table payments      add column club_id uuid references clubs(id) on delete cascade;
  alter table checkins      add column club_id uuid references clubs(id) on delete cascade;
  alter table games         add column club_id uuid references clubs(id) on delete cascade;
  alter table game_players  add column club_id uuid references clubs(id) on delete cascade;

  update players set club_id = c;       update months set club_id = c;
  update month_players set club_id = c; update payments set club_id = c;
  update checkins set club_id = c;      update games set club_id = c;
  update game_players set club_id = c;

  update players set is_super = true where email = 'ajeeth@smash-club.app';
end $$;

-- Months are now per club: key (club_id, month).
alter table public.month_players drop constraint month_players_month_fkey;
alter table public.payments      drop constraint payments_month_fkey;
alter table public.months        drop constraint months_pkey;
alter table public.months        add primary key (club_id, month);
alter table public.month_players add foreign key (club_id, month) references public.months(club_id, month) on delete cascade;
alter table public.payments      add foreign key (club_id, month) references public.months(club_id, month) on delete cascade;

-- ─── Helpers ───────────────────────────────────────────────────────────────

create or replace function public.current_club_id() returns uuid
language sql stable security definer set search_path = public as $$
  select club_id from players where user_id = auth.uid()
$$;

create or replace function public.is_super() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from players where user_id = auth.uid() and is_super)
$$;

-- New rows default to the signed-in player's club.
do $$
declare t text;
begin
  foreach t in array array['players','months','month_players','payments','checkins','games','game_players'] loop
    execute format('alter table public.%I alter column club_id set default public.current_club_id()', t);
    execute format('alter table public.%I alter column club_id set not null', t);
    execute format('create index on public.%I (club_id)', t);
  end loop;
end $$;

-- Only the super admin can make someone super or move a player to another club.
-- (Skipped for SQL-editor / service work, where there is no signed-in user.)
create or replace function public.guard_players() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_super() then return new; end if;
  if tg_op = 'INSERT' then
    new.is_super := false;
    if new.club_id is distinct from public.current_club_id() then raise exception 'You can only add players to your own club'; end if;
  else
    if new.is_super is distinct from old.is_super then raise exception 'Only the super admin can change that'; end if;
    if new.club_id is distinct from old.club_id then raise exception 'Players cannot move between clubs'; end if;
  end if;
  return new;
end $$;
create trigger guard_players before insert or update on public.players
  for each row execute function public.guard_players();

create or replace function public.club_today() returns date
language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce((select timezone from clubs where id = current_club_id()), 'Asia/Kolkata'))::date
$$;

-- ─── Player actions, now scoped to the player's club ──────────────────────

create or replace function public.ensure_current_month() returns date
language plpgsql security definer set search_path = public as $$
declare
  c uuid := current_club_id();
  m date := date_trunc('month', club_today())::date;
  prev months;
begin
  if c is null then raise exception 'not a player'; end if;
  if exists (select 1 from months where club_id = c and month = m) then return m; end if;
  select * into prev from months where club_id = c and month < m order by month desc limit 1;
  insert into months (club_id, month, court_fee, cork_fee, other_fee)
  values (c, m, coalesce(prev.court_fee, 0), coalesce(prev.cork_fee, 0), 0)
  on conflict do nothing;
  if prev.month is not null then
    insert into month_players (club_id, month, player_id, playing)
    select c, m, mp.player_id, mp.playing
      from month_players mp join players p on p.id = mp.player_id
     where mp.club_id = c and mp.month = prev.month and p.active
    on conflict do nothing;
  end if;
  insert into month_players (club_id, month, player_id, playing)
  select c, m, p.id, true from players p where p.club_id = c and p.active
  on conflict do nothing;
  return m;
end $$;

create or replace function public.check_in() returns public.checkins
language plpgsql security definer set search_path = public as $$
declare
  me uuid := current_player_id();
  row checkins;
begin
  if me is null then raise exception 'not a player'; end if;
  insert into checkins (club_id, player_id, play_date) values (current_club_id(), me, club_today())
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
  c uuid := current_club_id();
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
  if (select count(*) from players where id = any(all_ids) and club_id = c) <> size * 2 then
    raise exception 'unknown player';
  end if;
  if not (me = any(all_ids) or is_admin()) then
    raise exception 'only someone who played can log this game';
  end if;
  insert into games (club_id, format, score_a, score_b, logged_by)
  values (c, p_format, p_score_a, p_score_b, me) returning id into gid;
  insert into game_players (club_id, game_id, player_id, team)
  select c, gid, unnest(p_team_a), 'A' union all select c, gid, unnest(p_team_b), 'B';
  return gid;
end $$;

create or replace function public.flag_game(p_game uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := current_player_id();
begin
  if not exists (select 1 from games where id = p_game and club_id = current_club_id()) then
    raise exception 'game not found';
  end if;
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
  insert into payments (club_id, month, player_id, marked_paid_at) values (current_club_id(), p_month, me, now())
  on conflict (month, player_id) do update set marked_paid_at = coalesce(payments.marked_paid_at, now());
end $$;

-- ─── Logins ────────────────────────────────────────────────────────────────

-- Is this username free for this player? Usernames are unique across all clubs.
create or replace function public.username_taken(p_username text, p_player uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from players where email = lower(p_username) || '@smash-club.app' and id <> p_player)
$$;
revoke all on function public.username_taken(text, uuid) from public, anon;
grant execute on function public.username_taken(text, uuid) to authenticated;

-- Reset a password: club admins for their own club's logins, the super admin for anyone.
create or replace function public.admin_set_password(p_username text, p_password text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  mail text := lower(p_username) || '@smash-club.app';
  owner_club uuid := (select club_id from players where email = mail);
begin
  if not (public.is_admin() or public.is_super()) then raise exception 'Only an admin can reset passwords'; end if;
  if owner_club is not null and owner_club is distinct from public.current_club_id() and not public.is_super() then
    raise exception 'That username is already taken. Try another, like %.k', lower(p_username);
  end if;
  if length(p_password) < 6 then raise exception 'Password must be at least 6 characters'; end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
   where email = mail;
  if not found then raise exception 'No login with that username'; end if;
end $$;

-- ─── Row-level security ────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['players','settings','months','month_players','payments','checkins','games','game_players'] loop
    execute format('drop policy if exists "players can read" on public.%I', t);
    execute format('drop policy if exists "admin can write" on public.%I', t);
  end loop;
  -- Club data: only your own club; only your club's admins can write.
  foreach t in array array['months','month_players','payments','checkins','games','game_players'] loop
    execute format('create policy "club can read" on public.%I for select to authenticated using (club_id = public.current_club_id())', t);
    execute format('create policy "club admin can write" on public.%I for all to authenticated
      using (public.is_admin() and club_id = public.current_club_id())
      with check (public.is_admin() and club_id = public.current_club_id())', t);
  end loop;
end $$;

-- Players: your own club; the super admin can see and manage everyone.
create policy "club can read" on public.players for select to authenticated
  using (club_id = public.current_club_id() or public.is_super());
create policy "club admin can write" on public.players for all to authenticated
  using ((public.is_admin() and club_id = public.current_club_id()) or public.is_super())
  with check ((public.is_admin() and club_id = public.current_club_id()) or public.is_super());

alter table public.clubs enable row level security;
create policy "club can read" on public.clubs for select to authenticated
  using (id = public.current_club_id() or public.is_super());
create policy "club admin can update" on public.clubs for update to authenticated
  using ((public.is_admin() and id = public.current_club_id()) or public.is_super())
  with check ((public.is_admin() and id = public.current_club_id()) or public.is_super());
create policy "super can add" on public.clubs for insert to authenticated with check (public.is_super());

drop table public.settings;

grant execute on function public.current_club_id, public.is_super to authenticated;
grant select, insert, update, delete on public.clubs to authenticated;

commit;
