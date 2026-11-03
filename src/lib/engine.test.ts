import { describe, expect, it } from 'vitest';
import {
  attendanceDays, attendanceStats, badges, gameStats, kingOfCourt, monthMoney, rankAttendance,
  replayGames, weekStart, type Checkin, type Game, type Player, type Settings,
} from './engine';

const s: Settings = { court_start: '06:00', grace_minutes: 0, timezone: 'Asia/Kolkata' };
const P = (id: string): Player => ({ id, name: id, active: true, is_admin: false });
const players = ['aj', 'kr', 'mo', 'ka', 're'].map(P);
// 05:49 IST = 00:19 UTC
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h, m) - 330 * 60000);
  return d.toISOString();
};
const ci = (player_id: string, date: string, hhmm: string): Checkin => ({ player_id, play_date: date, checked_in_at: at(date, hhmm) });

describe('attendance', () => {
  const checkins = [
    ci('kr', '2026-11-02', '05:49'), ci('aj', '2026-11-02', '05:56'), ci('ka', '2026-11-02', '06:14'),
    ci('mo', '2026-11-02', '05:59'),
    ci('aj', '2026-11-03', '05:40'), ci('ka', '2026-11-03', '06:05'),
  ];
  const days = attendanceDays(checkins, s);
  const stats = attendanceStats(players, days, s, '2026-11-01', '2026-11-03', new Set(players.map((p) => p.id)));

  it('gives medals to the first three on-time arrivals only', () => {
    const d = days[0].arrivals;
    expect(d.map((x) => [x.player_id, x.medal])).toEqual([['kr', 'gold'], ['aj', 'silver'], ['mo', 'bronze'], ['ka', null]]);
    // Kanakaraj was first on 3 Nov but late, so no medal; Ajeeth still gets gold.
    expect(days[1].arrivals.find((x) => x.player_id === 'aj')?.medal).toBe('gold');
    expect(days[1].arrivals.find((x) => x.player_id === 'ka')?.medal).toBeNull();
  });

  it('counts streaks, lates and strikes, without striking today', () => {
    expect(stats.get('aj')).toMatchObject({ onTime: 2, streak: 2, strikes: 0, medals: { gold: 1, silver: 1, bronze: 0 }, earlyBird: true });
    expect(stats.get('ka')).toMatchObject({ onTime: 0, late: 2, streak: 0 });
    // Krishna missed nothing yet: 3 Nov is today and he may still arrive.
    expect(stats.get('kr')).toMatchObject({ strikes: 0, streak: 1 });
    // Rebin missed 2 Nov: one strike.
    expect(stats.get('re')!.strikes).toBe(1);
  });

  it('ranks showing up by on-time days then medals', () => {
    expect(rankAttendance([...stats.values()]).map((x) => x.player_id).slice(0, 2)).toEqual(['aj', 'kr']);
  });
});

describe('games', () => {
  const g = (id: string, date: string, a: string[], b: string[], sa: number, sb: number, flagged = false): Game =>
    ({ id, played_at: at(date, '06:30'), format: a.length === 2 ? 'doubles' : 'singles', score_a: sa, score_b: sb, flagged_by: flagged ? 'x' : null, a, b });
  const games = [
    g('1', '2026-11-02', ['aj', 'kr'], ['mo', 're'], 21, 17),
    g('2', '2026-11-02', ['ka'], ['kr'], 21, 19),
    g('3', '2026-11-03', ['mo'], ['aj'], 21, 10, true), // flagged: ignored
  ];
  const { results, rating } = replayGames(games, players, s.timezone);
  const st = gameStats(players, results, rating, '2026-11-01', '2026-11-03');

  it('ignores flagged games and scores wins, losses and upsets', () => {
    expect(results).toHaveLength(2);
    expect(st.get('aj')).toMatchObject({ played: 1, won: 1, points: 10 });
    expect(st.get('mo')).toMatchObject({ played: 1, lost: 1, points: 2 });
    // Krishna won game 1 so was rated above Kanakaraj: Kanakaraj's win is an upset (+5).
    expect(results[1].upset).toBe(true);
    expect(st.get('ka')!.points).toBe(15);
  });

  it('crowns King of the Court by weekly wins', () => {
    const podium = kingOfCourt(results, weekStart('2026-11-03'), rating);
    expect(podium[0].wins).toBe(1);
    expect(podium).toHaveLength(3);
  });

  it('awards badges per track', () => {
    const days = attendanceDays([], s);
    const a = attendanceStats(players, days, s, '2026-11-01', '2026-11-03', new Set())!.get('ka')!;
    const b = badges(a, st.get('ka')!);
    expect(b.find((x) => x.key === 'giant-killer')!.earned).toBe(true);
    expect(b.find((x) => x.key === 'first-gold')!.earned).toBe(false);
    expect(b.filter((x) => x.track === 'attendance')).toHaveLength(6);
  });
});

describe('money', () => {
  it('splits the month equally among players marked as playing', () => {
    const lineup = players.map((p) => ({ month: '2026-11-01', player_id: p.id, playing: true }))
      .concat([{ month: '2026-11-01', player_id: 'ra', playing: false }]);
    const m = monthMoney({ month: '2026-11-01', court_fee: 8000, cork_fee: 1400, other_fee: 0 }, lineup,
      [{ month: '2026-11-01', player_id: 'kr', marked_paid_at: 'x', confirmed_at: 'y' },
       { month: '2026-11-01', player_id: 'ka', marked_paid_at: 'x', confirmed_at: null }]);
    expect(m.share).toBe(1880);
    expect(m.status('kr')).toBe('confirmed');
    expect(m.status('ka')).toBe('marked');
    expect(m.status('aj')).toBe('pending');
    expect(m.status('ra')).toBe('not-playing');
    expect(m.collected).toBe(1880);
  });
});
