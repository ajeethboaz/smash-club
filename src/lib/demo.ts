// In-memory demo club, used when no Supabase keys are configured.
// Lets anyone click through the app before the backend is set up.
import type { Api, ClubData, FullSettings } from './api';
import type { Checkin, Game, MonthPlayer, MonthRow, Payment, Player } from './engine';
import { addDays, localDate, monthOf } from './engine';

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const TZ = 'Asia/Kolkata';
/** ISO instant for a local IST date + minutes after midnight. */
const ist = (date: string, minutes: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + (minutes - 330) * 60000).toISOString();

export function demoApi(): Api {
  const players: Player[] = [
    { id: 'aj', name: 'Ajeeth', email: 'ajeeth@smash-club.app', active: true, is_admin: true },
    { id: 'mo', name: 'Monish', email: null, active: true, is_admin: false },
    { id: 'kr', name: 'Krishna', email: null, active: true, is_admin: false },
    { id: 'ra', name: 'Ramakrishnan', email: null, active: false, is_admin: false },
    { id: 're', name: 'Rebin', email: null, active: true, is_admin: false },
    { id: 'ka', name: 'Kanakaraj', email: null, active: true, is_admin: false },
  ];
  const settings: FullSettings = {
    club_name: 'Smash Club', court_start: '06:00', grace_minutes: 0, timezone: TZ,
    court_lat: null, court_lng: null, court_radius_m: 300,
  };
  const today = localDate(new Date().toISOString(), TZ);
  const month = monthOf(today);
  const active = players.filter((p) => p.active).map((p) => p.id);

  // Personalities: Krishna and Monish are punctual; Kanakaraj is late but wins a lot.
  const arrival: Record<string, [number, number]> = { kr: [-14, 6], mo: [-9, 9], aj: [-10, 12], re: [-4, 14], ka: [2, 18] };
  const skill: Record<string, number> = { ka: 0.8, kr: 0.65, aj: 0.6, re: 0.4, mo: 0.3 };
  const r = rng(7);
  const checkins: Checkin[] = [];
  const games: Game[] = [];
  for (let i = 24; i >= 1; i--) {
    const date = addDays(today, -i);
    if (r() < 0.12) continue; // court off
    const here: string[] = [];
    for (const id of active) {
      if (r() < (id === 're' ? 0.15 : 0.05)) continue;
      const [base, spread] = arrival[id];
      checkins.push({ player_id: id, play_date: date, checked_in_at: ist(date, 360 + base + Math.floor(r() * spread)) });
      here.push(id);
    }
    for (let g = 0; g < 3 && here.length >= 4; g++) {
      const pool = [...here].sort(() => r() - 0.5);
      const doubles = r() < 0.75;
      const a = doubles ? pool.slice(0, 2) : pool.slice(0, 1);
      const b = doubles ? pool.slice(2, 4) : pool.slice(1, 2);
      const sa = a.reduce((t, x) => t + skill[x], 0) / a.length, sb = b.reduce((t, x) => t + skill[x], 0) / b.length;
      const aWins = r() < 0.5 + (sa - sb);
      const lose = 10 + Math.floor(r() * 10);
      games.push({
        id: `g${games.length}`, played_at: ist(date, 375 + g * 20), format: doubles ? 'doubles' : 'singles',
        score_a: aWins ? 21 : lose, score_b: aWins ? lose : 21, flagged_by: null, a, b,
      });
    }
  }
  // Today: Krishna is already in.
  checkins.push({ player_id: 'kr', play_date: today, checked_in_at: ist(today, 349) });

  const months: MonthRow[] = [...new Set([monthOf(addDays(today, -40)), monthOf(addDays(today, -25)), month])]
    .map((m) => ({ month: m, court_fee: 8000, cork_fee: 1400, other_fee: 0 }));
  const lineup: MonthPlayer[] = months.flatMap((m) =>
    players.map((p) => ({ month: m.month, player_id: p.id, playing: p.active || m.month < '2026-11-01' })));
  const payments: Payment[] = [
    { month, player_id: 'kr', marked_paid_at: ist(today, 400), confirmed_at: ist(today, 420) },
    { month, player_id: 'mo', marked_paid_at: ist(today, 400), confirmed_at: ist(today, 420) },
    { month, player_id: 'ka', marked_paid_at: ist(today, 410), confirmed_at: null },
  ];

  let signedIn = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((f) => f());
  const nowIso = () => new Date().toISOString();

  const data = (): ClubData => ({
    settings, players, me: players[0], checkins, games, months, lineup, payments, today, month,
  });

  return {
    demo: true,
    async getSessionEmail() { return signedIn ? players[0].email! : null; },
    onAuthChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    async signIn() { signedIn = true; emit(); },
    async needsFirstAdmin() { return false; },
    async createFirstAdmin() { signedIn = true; emit(); },
    async signOut() { signedIn = false; emit(); },
    async claim() { return players[0]; },
    async load() { return structuredClone(data()); },
    async checkIn() {
      if (!checkins.some((c) => c.player_id === 'aj' && c.play_date === today))
        checkins.push({ player_id: 'aj', play_date: today, checked_in_at: ist(today, 356) });
    },
    async logGame(format, a, b, sa, sb) {
      games.push({ id: `g${games.length}`, played_at: nowIso(), format, score_a: sa, score_b: sb, flagged_by: null, a, b });
    },
    async flagGame(id) { const g = games.find((x) => x.id === id); if (g) g.flagged_by = 'aj'; },
    async markPaid(m) {
      const p = payments.find((x) => x.month === m && x.player_id === 'aj');
      if (p) p.marked_paid_at ??= nowIso(); else payments.push({ month: m, player_id: 'aj', marked_paid_at: nowIso(), confirmed_at: null });
    },
    admin: {
      async saveMonth(m) { Object.assign(months.find((x) => x.month === m.month)!, m); },
      async setPlaying(m, id, playing) {
        const row = lineup.find((x) => x.month === m && x.player_id === id);
        if (row) row.playing = playing; else lineup.push({ month: m, player_id: id, playing });
      },
      async confirmPayment(m, id, ok) {
        let p = payments.find((x) => x.month === m && x.player_id === id);
        if (!p) payments.push((p = { month: m, player_id: id, marked_paid_at: null, confirmed_at: null }));
        p.confirmed_at = ok ? nowIso() : null;
      },
      async addPlayer(name) {
        const id = `p${players.length}`;
        players.push({ id, name, email: null, active: true, is_admin: false });
        lineup.push({ month, player_id: id, playing: true });
        return id;
      },
      async setLogin(id, username) {
        players.find((p) => p.id === id)!.email = `${username.trim().toLowerCase()}@smash-club.app`;
      },
      async updatePlayer(id, patch) { Object.assign(players.find((p) => p.id === id)!, patch); },
      async resolveGame(id, keep) {
        const i = games.findIndex((g) => g.id === id);
        if (keep) games[i].flagged_by = null; else games.splice(i, 1);
      },
      async setCheckin(id, date, iso) {
        const i = checkins.findIndex((c) => c.player_id === id && c.play_date === date);
        if (i >= 0) checkins.splice(i, 1);
        if (iso) checkins.push({ player_id: id, play_date: date, checked_in_at: iso });
      },
      async saveSettings(patch) { Object.assign(settings, patch); },
    },
  };
}
