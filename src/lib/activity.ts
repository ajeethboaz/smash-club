import type { Model } from './model';
import { fmtTime } from './engine';

export type Usage = 'no-login' | 'never' | 'lapsed' | 'active';

export type PlayerActivity = {
  id: string; name: string;
  usage: Usage; lastSeen: string | null;
  hereToday: boolean; checkinsThisWeek: number; winsThisWeek: number; gamesThisWeek: number;
};

/** "just now", "3h ago", "yesterday", "4 days ago". */
export function ago(iso: string, now = Date.now()) {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (mins < 5) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** Who is actually using the app, for the admin. Most in need of a nudge first. */
export function playerActivity(m: Model): PlayerActivity[] {
  const here = new Set(m.todayArrivals.map((x) => x.player_id));
  const weekDays = m.days.filter((d) => d.date >= m.week);
  const weekGames = m.results.filter((r) => r.date >= m.week);
  const order: Usage[] = ['no-login', 'never', 'lapsed', 'active'];
  return m.roster
    .filter((p) => p.active)
    .map((p) => {
      const seen = p.last_seen_at ?? null;
      const usage: Usage = !p.email ? 'no-login' : !seen ? 'never'
        : Date.now() - Date.parse(seen) > 3 * 86400000 ? 'lapsed' : 'active';
      return {
        id: p.id, name: p.name, usage, lastSeen: seen,
        hereToday: here.has(p.id),
        checkinsThisWeek: weekDays.filter((d) => d.arrivals.some((a) => a.player_id === p.id)).length,
        winsThisWeek: weekGames.filter((r) => r.winners.includes(p.id)).length,
        gamesThisWeek: weekGames.filter((r) => r.winners.includes(p.id) || r.losers.includes(p.id)).length,
      };
    })
    .sort((a, b) => order.indexOf(a.usage) - order.indexOf(b.usage) || a.name.localeCompare(b.name));
}

const MEDAL_EMOJI = { gold: '🥇', silver: '🥈', bronze: '🥉' } as const;

/** A fun daily scoreboard to paste into the group's WhatsApp chat. */
export function dailyRecap(m: Model, url: string) {
  const d = m.data;
  const dateLabel = new Intl.DateTimeFormat('en-IN', { timeZone: m.tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date());
  const lines = [`🏸 *Smash Club · ${dateLabel}*`, ''];

  const podium = m.todayArrivals.filter((x) => x.medal);
  if (podium.length) {
    lines.push('*Arrival race*');
    for (const x of podium) lines.push(`${MEDAL_EMOJI[x.medal!]} ${m.name(x.player_id)} · ${fmtTime(x.at, m.tz)}`);
  } else lines.push('⏰ Nobody has checked in yet. Gold is up for grabs!');

  const playing = m.roster.filter((p) => p.active);
  const missing = playing.filter((p) => !m.todayArrivals.some((x) => x.player_id === p.id));
  lines.push('', `✅ On court: ${m.todayArrivals.length}/${playing.length}`);
  if (missing.length && m.todayArrivals.length) lines.push(`👀 Not checked in: ${missing.map((p) => p.name).join(', ')}`);

  const today = m.results.filter((r) => r.date === d.today);
  lines.push('');
  if (today.length) {
    lines.push(`*Today's wins (${today.length})*`);
    for (const r of today.slice(-5)) {
      const [w, l] = r.score_a > r.score_b ? [r.score_a, r.score_b] : [r.score_b, r.score_a];
      lines.push(`🏆 ${r.winners.map(m.name).join(' & ')} beat ${r.losers.map(m.name).join(' & ')} ${w}–${l}${r.upset ? ' ⚡ upset!' : ''}`);
    }
  } else lines.push('🏆 No wins logged yet today. Won a game? Log it!');

  if (m.kings.length) lines.push('', `👑 King of the Court this week: ${m.name(m.kings[0].player_id)} (${m.kings[0].wins} win${m.kings[0].wins === 1 ? '' : 's'})`);

  const streaker = [...m.att.values()].filter((a) => a.streak >= 3).sort((a, b) => b.streak - a.streak)[0];
  if (streaker) lines.push(`🔥 Longest on-time streak: ${m.name(streaker.player_id)} · ${streaker.streak} days`);

  lines.push('', `Check in & log your wins 👉 ${url}`);
  return lines.join('\n');
}

export const whatsappLink = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
