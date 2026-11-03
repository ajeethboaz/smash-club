# Contributing to Smash Club

## Get running (no keys needed)

```bash
git clone https://github.com/ajeethboaz/smash-club.git
cd smash-club
npm install
npm run dev      # opens on http://localhost:5173 with sample data
```

Without Supabase keys the app runs in demo mode: any email and code signs you in as the admin, and nothing is saved.

## Making a change

1. Pull the latest: `git checkout main && git pull`
2. Make a branch: `git checkout -b your-name/what-you-are-changing`
3. Make the change, then check it:
   ```bash
   npm test        # scoring rules must still pass
   npm run build   # must build without errors
   ```
4. Push and open a pull request: `git push -u origin HEAD`, then follow the link GitHub prints.
5. Ajeeth reviews and merges. Merged changes go live automatically.

## Where things live

- `src/lib/engine.ts`: scoring rules (medals, streaks, points, badges). Add a test in `engine.test.ts` when you change a rule.
- `src/pages/`: one file per screen.
- `src/styles.css`: colours and shared styles. Gold is for showing up, lime is for playing.
- `supabase/migrations/`: database changes. Add a **new** file for any change; never edit an old one.

## Ground rules

- Never commit a `.env` file or any Supabase key or password.
- Keep attendance and game points separate. That's a deliberate design choice.
