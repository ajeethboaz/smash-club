import type { ClubData } from './api';
import {
  attendanceDays, attendanceStats, badges, gameStats, kingOfCourt, monthMoney, rankAttendance, rankGames,
  replayGames, weekStart, type AttendanceStats, type GameStats, type Player,
} from './engine';

export type Model = ReturnType<typeof buildModel>;

/** Everything the screens show, derived from the raw club data. */
export function buildModel(d: ClubData) {
  const tz = d.settings.timezone;
  const name = (id: string) => d.players.find((p) => p.id === id)?.name ?? '—';
  const monthLineup = d.lineup.filter((x) => x.month === d.month);
  const playing = new Set(monthLineup.filter((x) => x.playing).map((x) => x.player_id));
  // Rank everyone playing this month plus anyone active (so new players show up).
  const roster: Player[] = d.players.filter((p) => playing.has(p.id) || (p.active && !monthLineup.some((x) => x.player_id === p.id)));

  const days = attendanceDays(d.checkins, d.settings);
  const att = attendanceStats(roster, days, d.settings, d.month, d.today, playing);
  const { results, rating } = replayGames(d.games, d.players, tz);
  const gms = gameStats(roster, results, rating, d.month, d.today);

  const attRank = rankAttendance([...att.values()]);
  const gameRank = rankGames([...gms.values()]);
  const rankOf = (list: { player_id: string }[], id: string) => list.findIndex((x) => x.player_id === id) + 1;

  const todayDay = days.find((x) => x.date === d.today);
  const todayArrivals = todayDay?.arrivals ?? [];
  const meToday = todayArrivals.find((x) => x.player_id === d.me.id);
  const nextMedal = todayArrivals.filter((x) => x.medal).length; // 0..3 → which medal is still open

  const week = weekStart(d.today);
  const kings = kingOfCourt(results, week, rating);

  const myAtt: AttendanceStats = att.get(d.me.id)!;
  const myGames: GameStats = gms.get(d.me.id)!;

  // Trophy leaders (monthly)
  const punctuality = attRank[0];
  const ironMen = [...att.values()].filter((x) => x.strikes === 0 && x.days > 0).sort((a, b) => b.days - a.days);
  const potm = gameRank[0];
  const giant = [...gms.values()].filter((x) => x.bestUpsetGap > 0).sort((a, b) => b.bestUpsetGap - a.bestUpsetGap)[0];

  const money = monthMoney(d.months.find((m) => m.month === d.month), monthLineup, d.payments.filter((p) => p.month === d.month));

  return {
    data: d, tz, name, roster, days, att, gms, attRank, gameRank, rankOf, rating, results,
    todayArrivals, meToday, nextMedal, kings, week, myAtt, myGames,
    myBadges: badges(myAtt, myGames),
    trophies: { punctuality, ironMen, potm, giant },
    money,
    recentGames: [...results].reverse().slice(0, 6),
    flaggedGames: d.games.filter((g) => g.flagged_by),
  };
}
