// Smash Club gamification engine.
// Pure functions: raw rows in, everything the screens show out.
// Attendance and games are two separate tracks and never feed each other.

export type Player = { id: string; name: string; active: boolean; is_admin: boolean; email?: string | null };
export type Settings = { court_start: string; grace_minutes: number; timezone: string };
export type Checkin = { player_id: string; play_date: string; checked_in_at: string };
export type Game = {
  id: string; played_at: string; format: 'singles' | 'doubles';
  score_a: number; score_b: number; flagged_by: string | null; a: string[]; b: string[];
};
export type MonthRow = { month: string; court_fee: number; cork_fee: number; other_fee: number };
export type MonthPlayer = { month: string; player_id: string; playing: boolean };
export type Payment = { month: string; player_id: string; marked_paid_at: string | null; confirmed_at: string | null };

export type Medal = 'gold' | 'silver' | 'bronze';
export const MEDALS: Medal[] = ['gold', 'silver', 'bronze'];

export const POINTS = { win: 10, loss: 2, upset: 5 } as const;
export const START_RATING = 1200;
const K = 24;

// ─── Time helpers (everything in the club's time zone) ─────────────────────

function parts(iso: string, tz: string) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export const localDate = (iso: string, tz: string) => parts(iso, tz).date;
export const localMinutes = (iso: string, tz: string) => parts(iso, tz).minutes;

export function startMinutes(s: Settings) {
  const [h, m] = s.court_start.split(':').map(Number);
  return h * 60 + m;
}

export function fmtTime(iso: string, tz: string) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(iso)).toUpperCase();
}

export const monthOf = (date: string) => `${date.slice(0, 7)}-01`;

/** Monday of the week containing `date` (YYYY-MM-DD). */
export function weekStart(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ─── Attendance track ──────────────────────────────────────────────────────

export type DayResult = {
  date: string;
  arrivals: { player_id: string; at: string; minutes: number; onTime: boolean; medal: Medal | null }[];
};

export function isOnTime(c: Checkin, s: Settings) {
  return localMinutes(c.checked_in_at, s.timezone) <= startMinutes(s) + s.grace_minutes;
}

/** Each day anyone played, with arrival order and medals for the first three on-time arrivals. */
export function attendanceDays(checkins: Checkin[], s: Settings): DayResult[] {
  const byDay = new Map<string, Checkin[]>();
  for (const c of checkins) byDay.set(c.play_date, [...(byDay.get(c.play_date) ?? []), c]);
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => {
      const sorted = [...rows].sort((x, y) => x.checked_in_at.localeCompare(y.checked_in_at));
      let next = 0;
      return {
        date,
        arrivals: sorted.map((c) => {
          const onTime = isOnTime(c, s);
          const medal = onTime && next < 3 ? MEDALS[next++] : null;
          return { player_id: c.player_id, at: c.checked_in_at, minutes: localMinutes(c.checked_in_at, s.timezone), onTime, medal };
        }),
      };
    });
}

export type AttendanceStats = {
  player_id: string;
  onTime: number; late: number; strikes: number; days: number;
  medals: Record<Medal, number>;
  streak: number; bestStreak: number;
  medalDaysThisWeek: number;
  earlyBird: boolean; everGold: boolean; medalsAllTime: number;
};

/**
 * Attendance stats for a month. A strike is a session day (any day someone checked in)
 * that the player missed while playing that month. Today never counts as a strike —
 * there is still time to turn up.
 */
export function attendanceStats(
  players: Player[], days: DayResult[], s: Settings, month: string, today: string,
  playingThisMonth: Set<string>,
): Map<string, AttendanceStats> {
  const out = new Map<string, AttendanceStats>();
  const thisWeek = weekStart(today);
  for (const p of players) {
    const st: AttendanceStats = {
      player_id: p.id, onTime: 0, late: 0, strikes: 0, days: 0,
      medals: { gold: 0, silver: 0, bronze: 0 }, streak: 0, bestStreak: 0,
      medalDaysThisWeek: 0, earlyBird: false, everGold: false, medalsAllTime: 0,
    };
    let run = 0;
    for (const d of days) {
      const a = d.arrivals.find((x) => x.player_id === p.id);
      const inMonth = monthOf(d.date) === month;
      if (a?.medal) {
        st.medalsAllTime++;
        if (a.medal === 'gold') st.everGold = true;
        if (inMonth) st.medals[a.medal]++;
        if (d.date >= thisWeek) st.medalDaysThisWeek++;
      }
      if (a && a.minutes <= startMinutes(s) - 10) st.earlyBird = true;
      if (a?.onTime) run++;
      else if (!(d.date === today && !a)) run = 0; // not here yet today: streak still alive
      st.bestStreak = Math.max(st.bestStreak, run);
      if (inMonth) {
        if (a) { st.days++; if (a.onTime) st.onTime++; else st.late++; }
        else if (d.date !== today && playingThisMonth.has(p.id)) st.strikes++;
      }
    }
    st.streak = run;
    out.set(p.id, st);
  }
  return out;
}

/** Showing-up table: on-time days, then golds, silvers, bronzes, then fewer strikes. */
export function rankAttendance(stats: AttendanceStats[]) {
  return [...stats].sort((a, b) =>
    b.onTime - a.onTime || b.medals.gold - a.medals.gold || b.medals.silver - a.medals.silver ||
    b.medals.bronze - a.medals.bronze || a.strikes - b.strikes);
}

// ─── Games track ───────────────────────────────────────────────────────────

export type GameResult = Game & {
  date: string; winners: string[]; losers: string[];
  upset: boolean; ratingGap: number; // gap the winners overcame (0 when not an upset)
};

export type GameStats = {
  player_id: string;
  played: number; won: number; lost: number; points: number; rating: number;
  bestUpsetGap: number;
  weekWins: number; weekMedals: Record<Medal, number>;
  everWin: boolean; hatTrick: boolean; partnersWonWith: number; partnersThisWeek: number;
  upsetEver: boolean; everWeekGold: boolean; playedAllTime: number;
};

/** Replays every unflagged game in order: ratings (Elo), upsets and points. */
export function replayGames(games: Game[], players: Player[], tz: string) {
  const rating = new Map(players.map((p) => [p.id, START_RATING]));
  const results: GameResult[] = [];
  const valid = games.filter((g) => !g.flagged_by).sort((x, y) => x.played_at.localeCompare(y.played_at));
  for (const g of valid) {
    const avg = (ids: string[]) => ids.reduce((t, id) => t + (rating.get(id) ?? START_RATING), 0) / ids.length;
    const ra = avg(g.a), rb = avg(g.b);
    const aWon = g.score_a > g.score_b;
    const ea = 1 / (1 + 10 ** ((rb - ra) / 400));
    const delta = K * ((aWon ? 1 : 0) - ea);
    for (const id of g.a) rating.set(id, (rating.get(id) ?? START_RATING) + delta);
    for (const id of g.b) rating.set(id, (rating.get(id) ?? START_RATING) - delta);
    const [wr, lr] = aWon ? [ra, rb] : [rb, ra];
    results.push({
      ...g, date: localDate(g.played_at, tz),
      winners: aWon ? g.a : g.b, losers: aWon ? g.b : g.a,
      upset: wr < lr, ratingGap: wr < lr ? Math.round(lr - wr) : 0,
    });
  }
  return { results, rating };
}

export function gamePoints(r: GameResult, playerId: string) {
  if (r.winners.includes(playerId)) return POINTS.win + (r.upset ? POINTS.upset : 0);
  if (r.losers.includes(playerId)) return POINTS.loss;
  return 0;
}

/** Wins per player for one Monday–Sunday week. */
export function weeklyWins(results: GameResult[], week: string) {
  const end = addDays(week, 6);
  const wins = new Map<string, number>();
  for (const r of results) if (r.date >= week && r.date <= end) for (const id of r.winners) wins.set(id, (wins.get(id) ?? 0) + 1);
  return wins;
}

/** King of the Court podium for a week: top three by wins (needs at least one win). */
export function kingOfCourt(results: GameResult[], week: string, rating: Map<string, number>) {
  return [...weeklyWins(results, week).entries()]
    .sort(([a, x], [b, y]) => y - x || (rating.get(b) ?? 0) - (rating.get(a) ?? 0))
    .slice(0, 3)
    .map(([player_id, wins], i) => ({ player_id, wins, medal: MEDALS[i] }));
}

export function gameStats(
  players: Player[], results: GameResult[], rating: Map<string, number>, month: string, today: string,
): Map<string, GameStats> {
  const out = new Map<string, GameStats>();
  const thisWeek = weekStart(today);
  // Weekly win medals are awarded for finished weeks whose Sunday falls in this month.
  const finishedWeeks = [...new Set(results.map((r) => weekStart(r.date)))].filter((w) => w < thisWeek);
  const medalsByWeek = new Map(finishedWeeks.map((w) => [w, kingOfCourt(results, w, rating)]));
  for (const p of players) {
    const st: GameStats = {
      player_id: p.id, played: 0, won: 0, lost: 0, points: 0, rating: Math.round(rating.get(p.id) ?? START_RATING),
      bestUpsetGap: 0, weekWins: 0, weekMedals: { gold: 0, silver: 0, bronze: 0 },
      everWin: false, hatTrick: false, partnersWonWith: 0, partnersThisWeek: 0,
      upsetEver: false, everWeekGold: false, playedAllTime: 0,
    };
    let winRun = 0;
    const partners = new Set<string>(), partnersWeek = new Set<string>();
    for (const r of results) {
      const inGame = r.winners.includes(p.id) || r.losers.includes(p.id);
      if (!inGame) continue;
      const won = r.winners.includes(p.id);
      st.playedAllTime++;
      winRun = won ? winRun + 1 : 0;
      if (winRun >= 3) st.hatTrick = true;
      if (won) {
        st.everWin = true;
        if (r.upset) st.upsetEver = true;
        for (const mate of r.winners) if (mate !== p.id) {
          partners.add(mate);
          if (r.date >= thisWeek) partnersWeek.add(mate);
        }
      }
      if (monthOf(r.date) === month) {
        st.played++;
        if (won) { st.won++; st.bestUpsetGap = Math.max(st.bestUpsetGap, r.ratingGap); } else st.lost++;
        st.points += gamePoints(r, p.id);
      }
      if (won && r.date >= thisWeek) st.weekWins++;
    }
    st.partnersWonWith = partners.size;
    st.partnersThisWeek = partnersWeek.size;
    for (const [w, podium] of medalsByWeek) {
      const mine = podium.find((x) => x.player_id === p.id);
      if (mine?.medal === 'gold') st.everWeekGold = true;
      if (mine && monthOf(addDays(w, 6)) === month) st.weekMedals[mine.medal]++;
    }
    out.set(p.id, st);
  }
  return out;
}

/** Playing table: points, then wins, then rating. */
export function rankGames(stats: GameStats[]) {
  return [...stats].sort((a, b) => b.points - a.points || b.won - a.won || b.rating - a.rating);
}

// ─── Badges ────────────────────────────────────────────────────────────────

export type Badge = { key: string; name: string; track: 'attendance' | 'games'; earned: boolean; hint: string };

export function badges(a: AttendanceStats, g: GameStats): Badge[] {
  return [
    { key: 'early-bird', name: 'Early Bird', track: 'attendance', earned: a.earlyBird, hint: 'Check in 10+ minutes early' },
    { key: 'first-gold', name: 'First Gold', track: 'attendance', earned: a.everGold, hint: 'First on court once' },
    { key: 'perfect-week', name: 'Never Late Week', track: 'attendance', earned: a.bestStreak >= 7, hint: '7 on-time days in a row' },
    { key: 'streak-10', name: '10-Day Streak', track: 'attendance', earned: a.bestStreak >= 10, hint: '10 on-time days in a row' },
    { key: 'streak-30', name: '30-Day Streak', track: 'attendance', earned: a.bestStreak >= 30, hint: '30 on-time days in a row' },
    { key: 'podium-regular', name: 'Podium Regular', track: 'attendance', earned: a.medalsAllTime >= 10, hint: '10 arrival medals' },
    { key: 'first-win', name: 'First Win', track: 'games', earned: g.everWin, hint: 'Win a game' },
    { key: 'hat-trick', name: 'Hat-trick', track: 'games', earned: g.hatTrick, hint: '3 wins in a row' },
    { key: 'giant-killer', name: 'Giant Killer', track: 'games', earned: g.upsetEver, hint: 'Beat a higher-rated side' },
    { key: 'team-player', name: 'Team Player', track: 'games', earned: g.partnersWonWith >= 3, hint: 'Win with 3 different partners' },
    { key: 'king', name: 'King of Court', track: 'games', earned: g.everWeekGold, hint: 'Most wins in a week' },
    { key: 'marathon', name: 'Marathon', track: 'games', earned: g.playedAllTime >= 50, hint: 'Play 50 games' },
  ];
}

// ─── Money ─────────────────────────────────────────────────────────────────

export type PayStatus = 'confirmed' | 'marked' | 'pending' | 'not-playing';

export function monthMoney(m: MonthRow | undefined, lineup: MonthPlayer[], payments: Payment[]) {
  const playing = lineup.filter((x) => x.playing);
  const total = m ? Number(m.court_fee) + Number(m.cork_fee) + Number(m.other_fee) : 0;
  const share = playing.length ? total / playing.length : 0;
  const status = (playerId: string): PayStatus => {
    if (!playing.some((x) => x.player_id === playerId)) return 'not-playing';
    const p = payments.find((x) => x.player_id === playerId);
    return p?.confirmed_at ? 'confirmed' : p?.marked_paid_at ? 'marked' : 'pending';
  };
  const collected = playing.filter((x) => status(x.player_id) === 'confirmed').length * share;
  return { total, share, players: playing.length, status, collected };
}

export const rupees = (n: number) =>
  '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
