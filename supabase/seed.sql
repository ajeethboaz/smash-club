-- Smash Club: starting data. Run once after the migration.
-- Logins are username + password. Ajeeth's username is "ajeeth"; he sets his
-- password on first visit, then creates everyone else's login from Admin.

insert into public.settings (id, club_name, court_start, grace_minutes, timezone)
values (1, 'Smash Club', '06:00', 0, 'Asia/Kolkata')
on conflict (id) do nothing;

insert into public.players (name, email, is_admin, active) values
  ('Ajeeth',       'ajeeth@smash-club.app', true,  true),
  ('Monish',       null,                   false, true),
  ('Krishna',      null,                   false, true),
  ('Ramakrishnan', null,                   false, false),
  ('Rebin',        null,                   false, true),
  ('Kanakaraj',    null,                   false, true);

-- Costs come from the existing spreadsheet: court ₹8,000 + cork ₹1,400 per month.
insert into public.months (month, court_fee, cork_fee) values
  ('2026-10-01', 8000, 1400),
  ('2026-11-01', 8000, 1400);

-- October: all six played. November onwards: Ramakrishnan is out.
insert into public.month_players (month, player_id, playing)
select '2026-10-01', id, true from public.players;

insert into public.month_players (month, player_id, playing)
select '2026-11-01', id, name <> 'Ramakrishnan' from public.players;
