# Smash Club

A small, fun web app for a daily badminton group: check in, race for the podium, log games, and settle the monthly court bill.
It installs on a phone like an app ("Add to Home Screen") and needs no app store.

## What it does

**Two separate tracks — showing up and playing — ranked independently.**

| Showing up (gold) | Playing (lime) |
|---|---|
| Tap **"I'm here"** when you reach the court | Log a game right after you play it |
| First three on-time arrivals each day win gold, silver and bronze | Points: +10 a win, +2 a loss, +5 for beating a higher-rated side |
| On-time streak; a **strike** for each day you miss while others play | Elo-style rating that moves more when you beat stronger players |
| Trophies: Punctuality King, Iron Man | Weekly **King of the Court** medals; trophies: Player of the Month, Giant Killer |
| Weekly challenge: podium on 4 days | Weekly challenge: win with 3 different partners |

12 badges (6 per track) unlock automatically. Monthly trophies update live and reset each month.

**Money:** each month's court + cork (+ any extra) is split equally among the players switched on for that month.
Players tap "I've paid"; the admin confirms. Matches the existing spreadsheet: ₹9,400 ÷ 5 = ₹1,880 for November 2026.

**Admin screen:** monthly costs, confirm payments, add players and their sign-in emails, switch players in/out for the month,
resolve flagged scores, fix a check-in (dead phone etc.), set the gates time and grace minutes, and turn on the location check.

**Fair play built in:**
- Check-in time is set by the server, so nobody can backdate.
- Optional location check: when the admin taps "I'm at the court", check-ins only work within 300 m of it.
- Any player in a game can flag its score for 24 hours; flagged games don't count until the admin decides.

## Run it locally

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # scoring engine tests
```

With no Supabase keys the app runs in **demo mode** with sample data (nothing is saved) — handy for a quick look.

## Going live (about 15 minutes, all free tiers)

### 1. Supabase (database + login)
1. Create a project at [supabase.com](https://supabase.com) (region: Mumbai).
2. **SQL Editor** → paste and run `supabase/migrations/20261103000000_init.sql`, then `supabase/seed.sql`.
   The seed adds the six players, makes `ajeethboaz@gmail.com` the admin, and sets Oct/Nov 2026 costs (Ramakrishnan out from November).
3. **Authentication → Sign In / Providers → Email**: keep it on, but turn **off "Confirm email"**. Logins are username + password,
   so no emails are ever sent. Run `supabase/migrations/20261103010000_username_logins.sql` after the first migration.
4. **Project Settings → API**: copy the Project URL and the `anon` public key.

### 2. Hosting (Vercel or Netlify)
1. Import this GitHub repo.
2. Add environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see `.env.example`).
3. Deploy. `vercel.json` / `public/_redirects` already handle page routing.
4. In Supabase **Authentication → URL Configuration**, set the Site URL to your new address.

### 3. Invite the crew
Open the app, sign in with your email, go to **Admin** (gear icon) and add everyone's email. Share the link;
each person signs in with their email, gets a code, and is in. On iPhone: Share → Add to Home Screen. On Android: menu → Install app.

## Notes and choices

- **Sign-in is username + password.** Usernames map to made-up `@smash-club.app` addresses that never get mail. The admin creates each login from the Admin screen; the first visit lets the admin (`ajeeth`) set their own password.
- "On time" means checking in at or before the gates time plus grace minutes (default 6:00 AM, 0 grace, Asia/Kolkata).
- A strike is counted only on days when at least one person checked in, so days the court is closed never count against anyone. Today never counts as a strike.
- Weekly win medals are awarded when a Monday–Sunday week finishes, and counted in the month that week ends.

## Project layout

```
src/lib/engine.ts      scoring rules (pure functions, unit-tested)
src/lib/model.ts       turns raw data into what each screen shows
src/lib/api.ts         Supabase calls (falls back to demo.ts with no keys)
src/pages/             Login, Home, LogGame, Board, Pay, Admin
supabase/migrations/   tables, row-level security, server-side actions
supabase/seed.sql      starting players and months
```

Later: the AI camera coaching idea can hang off the `games` table (a video per game) without changing anything here.
