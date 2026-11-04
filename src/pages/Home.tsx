import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useClub } from '../club';
import { api } from '../lib/api';
import { fmtTime, localMinutes, MEDALS, startMinutes, type Medal } from '../lib/engine';
import { dailyRecap, whatsappLink } from '../lib/activity';
import { Avatar, BADGE_ICON, Icon, MEDAL_COLOR, MedalSvg, Podium, Steps } from '../ui';

const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th'}`;
const RANK_BG = ['#F2C230', '#CDD3DB', '#E3A673'];

/** Metres between two lat/lng points. */
function distance(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000, rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function here(): Promise<GeolocationPosition> {
  return new Promise((ok, no) => navigator.geolocation.getCurrentPosition(ok, no, { enableHighAccuracy: true, timeout: 15000 }));
}

export default function Home() {
  const { m, run } = useClub();
  const d = m.data;
  const [busy, setBusy] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const me = d.me;
  const you = (id: string) => (id === me.id ? 'You' : m.name(id));
  const nowMin = localMinutes(new Date().toISOString(), m.tz);
  const start = startMinutes(d.settings);
  const startLabel = fmtTime(new Date(Date.parse(`2000-01-01T00:00:00Z`) + start * 60000).toISOString(), 'UTC');
  const dateLabel = new Intl.DateTimeFormat('en-IN', { timeZone: m.tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date());
  const hour = Math.floor(nowMin / 60);
  const greeting = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';

  const attRank = m.rankOf(m.attRank, me.id);
  const gameRank = m.rankOf(m.gameRank, me.id);
  const a = m.myAtt, g = m.myGames;

  // ── Check-in ──
  const openMedal: Medal | null = MEDALS[m.nextMedal] ?? null;
  const late = nowMin > start + d.settings.grace_minutes;
  const minsLeft = start + d.settings.grace_minutes - nowMin;
  const checkIn = async () => {
    setBusy(true);
    const { court_lat, court_lng, court_radius_m } = d.settings;
    if (court_lat != null && court_lng != null && !api.demo) {
      try {
        const pos = await here();
        const dist = distance(pos.coords.latitude, pos.coords.longitude, court_lat, court_lng);
        if (dist > court_radius_m) {
          setBusy(false);
          return run(async () => { throw new Error(`You're ${Math.round(dist)} m from the court. Check in when you get there!`); });
        }
      } catch {
        setBusy(false);
        return run(async () => { throw new Error('Allow location access so we know you are at the court.'); });
      }
    }
    await run(() => api.checkIn());
    setBusy(false);
  };

  const arrivalSpots = m.todayArrivals.filter((x) => x.medal).map((x) => ({ medal: x.medal!, name: you(x.player_id), who: m.name(x.player_id), sub: fmtTime(x.at, m.tz) }));
  const kingSpots = m.kings.map((k) => ({ medal: k.medal, name: you(k.player_id), who: m.name(k.player_id), sub: `${k.wins} win${k.wins === 1 ? '' : 's'}` }));
  const leaderWins = m.kings[0]?.wins ?? 0;
  const gameNudge = !m.kings.length ? 'No games yet this week. Get the first win!'
    : m.kings[0].player_id === me.id ? "You're King of the Court this week. Defend it!"
    : leaderWins <= g.weekWins ? `You're level with ${m.name(m.kings[0].player_id)}. One more win takes the crown`
    : `${leaderWins - g.weekWins} more win${leaderWins - g.weekWins === 1 ? '' : 's'} puts you level with ${m.name(m.kings[0].player_id)}`;

  // ── Trophies ──
  const pill = (leader: string | undefined, myRank: number) => leader === me.id ? { text: 'You lead', lead: true } : { text: myRank ? `You: ${ordinal(myRank)}` : 'Open', lead: false };
  const pk = m.trophies.punctuality, potm = m.trophies.potm, giant = m.trophies.giant;
  const trophyGroups = [
    { label: 'Showing up', color: 'var(--gold-text)', disc: ['#F2C230', '#B8860B'], items: [
      { title: 'Punctuality King', icon: 'crown', detail: pk?.onTime ? `Most on-time days · ${m.name(pk.player_id)} (${pk.onTime})` : 'Most on-time days this month', ...pill(pk?.onTime ? pk.player_id : undefined, attRank) },
      { title: 'Iron Man', icon: 'flame', detail: `Never miss a day · ${m.trophies.ironMen.length} still in`, text: a.strikes ? `Out · ${a.strikes} strike${a.strikes > 1 ? 's' : ''}` : 'On track', lead: !a.strikes },
    ] },
    { label: 'Playing', color: 'var(--lime-text)', disc: ['#C8F04B', '#6E9A12'], items: [
      { title: 'Player of the Month', icon: 'trophy', detail: potm?.points ? `Most game points · ${m.name(potm.player_id)} (${potm.points})` : 'Most game points this month', ...pill(potm?.points ? potm.player_id : undefined, g.played ? gameRank : 0) },
      { title: 'Giant Killer', icon: 'bolt', detail: giant ? `Biggest upset · ${m.name(giant.player_id)} beat a side ${giant.bestUpsetGap} pts higher` : 'Beat a higher-rated side to claim it', ...(giant?.player_id === me.id ? { text: 'You lead', lead: true } : { text: giant ? 'Beat it' : 'Open', lead: false }) },
    ] },
  ];

  const flag = (id: string) => {
    const reason = window.prompt('What looks wrong with this score?');
    if (reason) void run(() => api.flagGame(id, reason), 'Flagged. The admin will check it.');
  };

  return (
    <>
      <section className="hero">
        <header className="between">
          <div className="stack" style={{ gap: 4 }}>
            <span className="sub">{d.settings.club_name} · {dateLabel} · court opens {startLabel}</span>
            <h1 className="h1" style={{ fontSize: 28 }}>{greeting}, {me.name}</h1>
          </div>
          {me.is_admin && <Link to="/admin" className="icon-btn" aria-label="Admin settings" style={{ background: 'var(--ink-2)', color: '#F4F5EF' }}><Icon name="gear" size={22} /></Link>}
        </header>

        {m.meToday ? (
          <div className="cta cta-hero celebrate" style={{ background: m.meToday.medal ? MEDAL_COLOR[m.meToday.medal].fill : m.meToday.onTime ? 'var(--lime)' : '#F5B347' }}>
            <span className="row" style={{ gap: 14 }}>
              {m.meToday.medal ? <MedalSvg medal={m.meToday.medal} size={46} text={String(MEDALS.indexOf(m.meToday.medal) + 1)} /> : <span className="cta-icon"><Icon name="check" color="var(--lime)" width={3} /></span>}
              <span className="stack" style={{ gap: 2 }}>
                <span className="cta-title" style={{ fontSize: 24 }}>{m.meToday.medal ? `${MEDAL_COLOR[m.meToday.medal].label}!` : m.meToday.onTime ? "You're in, on time" : "You're in"}</span>
                <span className="small">Checked in {fmtTime(m.meToday.at, m.tz)}{m.meToday.onTime ? ` · on-time streak ${a.streak}` : ' · late today, streak resets'}</span>
              </span>
            </span>
          </div>
        ) : null}
        {m.meToday && (
          <button onClick={() => { if (confirmUndo) { setConfirmUndo(false); void run(() => api.undoCheckIn(), 'Check-in removed'); } else setConfirmUndo(true); }}
            disabled={busy}
            style={{ alignSelf: 'center', background: 'none', border: 0, color: confirmUndo ? '#F5B347' : 'var(--muted-dark, #9AA79F)', fontSize: 14, fontWeight: confirmUndo ? 700 : 500, textDecoration: 'underline', padding: '4px 8px' }}>
            {confirmUndo ? 'Tap again to undo your check-in' : 'Checked in by mistake? Undo'}
          </button>
        )}
        {!m.meToday && (
          <button className="cta cta-hero cta-glow-gold" onClick={checkIn} disabled={busy} style={{ background: late ? '#F5B347' : 'var(--gold)' }}>
            <span className="stack" style={{ gap: 4 }}>
              <span className="cta-title">{late ? 'Check in' : openMedal ? `Claim ${openMedal}` : 'Check in'}</span>
              <span className="small" style={{ fontWeight: 500 }}>
                {late ? 'Gates closed. You still count for today.'
                  : minsLeft > 120 ? `Gates open at ${startLabel}. Streak: ${a.streak} days`
                  : `${minsLeft} min to gates · ${openMedal ? `${openMedal} is still open` : 'keep your streak alive'}`}
              </span>
            </span>
            <span className="cta-icon"><Icon name="pin" color="var(--gold)" width={2.5} /></span>
          </button>
        )}

        <Link to="/win" className="cta cta-hero cta-glow-lime" style={{ background: 'var(--lime)' }}>
          <span className="stack" style={{ gap: 4 }}>
            <span className="cta-title">I won!</span>
            <span className="small" style={{ fontWeight: 500 }}>Log the points and who you played with · {gameNudge}</span>
          </span>
          <span className="cta-icon"><Icon name="trophy" color="var(--lime)" width={2.5} /></span>
        </Link>

        <div className="divider" />

        <div className="grid2">
          <div className="tile-dark">
            <span className="label" style={{ color: 'var(--gold)' }}>Showing up</span>
            <span className="num" style={{ fontSize: 40 }}>#{attRank}</span>
            <span className="small" style={{ color: 'var(--soft-dark)' }}>{a.medals.gold} gold · {a.medals.silver} silver · {a.medals.bronze} bronze</span>
          </div>
          <div className="tile-dark">
            <span className="label" style={{ color: 'var(--lime)' }}>Playing</span>
            <span className="num" style={{ fontSize: 40 }}>{g.played ? `#${gameRank}` : '–'}</span>
            <span className="small" style={{ color: 'var(--soft-dark)' }}>{g.won}–{g.lost}{g.played ? ` · ${Math.round((g.won / g.played) * 100)}% win rate` : ' · no games yet'}</span>
          </div>
        </div>

        <div className="between">
          <span className="num" style={{ fontSize: 22, color: 'var(--gold)', letterSpacing: 0.5 }}>TODAY'S ARRIVAL RACE</span>
          <span className="chip" style={{ background: 'var(--gold)', color: 'var(--ink)' }}>Gates {startLabel}</span>
        </div>
        <Podium spots={arrivalSpots} />

        <div className="divider" />

        <div className="between">
          <span className="num" style={{ fontSize: 22, color: 'var(--lime)', letterSpacing: 0.5 }}>KING OF THE COURT</span>
          <span className="chip" style={{ background: 'var(--lime)', color: 'var(--ink)' }}>Wins this week</span>
        </div>
        <Podium spots={kingSpots} />
      </section>

      <div className="page">
        <section className="card" style={{ gap: 4 }}>
          <h2 className="h2">The two tables</h2>
          <p className="small muted" style={{ margin: '4px 0 8px' }}>Showing up and playing are ranked separately. Top both to be a legend.</p>
          <div className="row tiny" style={{ fontWeight: 800, letterSpacing: 0.6, color: 'var(--muted)', padding: '6px 0' }}>
            <span style={{ flexGrow: 1 }}>PLAYER</span>
            <span style={{ width: 108, textAlign: 'center', color: 'var(--gold-text)' }}>SHOWING UP</span>
            <span style={{ width: 84, textAlign: 'center', color: 'var(--lime-text)' }}>PLAYING</span>
          </div>
          {m.attRank.map((x) => {
            const ar = m.rankOf(m.attRank, x.player_id), gr = m.rankOf(m.gameRank, x.player_id);
            const gs = m.gms.get(x.player_id)!;
            const aStat = x.medals.gold ? `${x.medals.gold}G · ${x.medals.silver}S` : x.late > x.onTime ? `${x.late} late` : `${x.onTime} on time`;
            return (
              <div key={x.player_id} className="list-row">
                <span style={{ flexGrow: 1, fontWeight: 700, fontSize: 15 }}>{you(x.player_id)}</span>
                <span className="row" style={{ width: 108, justifyContent: 'center', gap: 6 }}>
                  <span className="avatar" style={{ width: 30, height: 30, fontSize: 13, background: RANK_BG[ar - 1] ?? 'var(--line-2)' }}>{ar}</span>
                  <span className="tiny muted" style={{ width: 56 }}>{aStat}</span>
                </span>
                <span className="row" style={{ width: 84, justifyContent: 'center', gap: 6 }}>
                  <span className="avatar" style={{ width: 30, height: 30, fontSize: 13, background: gs.played ? RANK_BG[gr - 1] ?? 'var(--line-2)' : 'var(--line-2)' }}>{gs.played ? gr : '–'}</span>
                  <span className="tiny muted" style={{ width: 36 }}>{gs.won}–{gs.lost}</span>
                </span>
              </div>
            );
          })}
        </section>

        <section className="card">
          <div className="between">
            <h2 className="h2">Your medals</h2>
            <span className="row small" style={{ gap: 4, fontWeight: 700, color: 'var(--strike)' }}><Icon name="flame" size={16} />{a.streak}-day streak</span>
          </div>
          {[
            { label: 'Showing up · arrival medals', color: 'var(--gold-text)', counts: a.medals },
            { label: 'Playing · weekly win medals', color: 'var(--lime-text)', counts: g.weekMedals },
          ].map((r) => (
            <div key={r.label} className="stack" style={{ gap: 8 }}>
              <span className="label" style={{ color: r.color }}>{r.label}</span>
              <div className="grid3">
                {MEDALS.map((md) => (
                  <div key={md} className="row" style={{ background: MEDAL_COLOR[md].tint, borderRadius: 16, padding: 10, gap: 8 }}>
                    <MedalSvg medal={md} size={30} />
                    <span className="stack" style={{ gap: 0 }}><span className="num" style={{ fontSize: 22 }}>{r.counts[md]}</span><span className="tiny muted" style={{ fontWeight: 700, textTransform: 'capitalize' }}>{md}</span></span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {(a.strikes > 0 || a.late > 0) && <p className="small muted" style={{ margin: 0 }}>This month: {a.late} late, {a.strikes} strike{a.strikes === 1 ? '' : 's'} (missed days).</p>}
        </section>

        <section className="card gold" style={{ gap: 12 }}>
          <div className="between"><h2 className="h2" style={{ fontSize: 22 }}>Trophy race</h2><span className="small" style={{ fontWeight: 700, color: 'var(--gold-text)' }}>This month</span></div>
          {trophyGroups.map((grp) => (
            <div key={grp.label} className="stack" style={{ gap: 8 }}>
              <span className="label" style={{ color: grp.color }}>{grp.label}</span>
              {grp.items.map((t) => (
                <div key={t.title} className="row" style={{ background: '#fff', borderRadius: 18, padding: 12, gap: 12 }}>
                  <span className="avatar" style={{ width: 48, height: 48, background: grp.disc[0], border: `3px solid ${grp.disc[1]}`, color: 'var(--ink)' }}><Icon name={t.icon} /></span>
                  <span className="stack" style={{ gap: 2, flexGrow: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 800, fontSize: 15 }}>{t.title}</span>
                    <span className="tiny muted">{t.detail}</span>
                  </span>
                  <span className="chip" style={t.lead ? { background: 'var(--green)', color: 'var(--gold)' } : { background: 'var(--gold-tint)', color: 'var(--gold-text)' }}>{t.text}</span>
                </div>
              ))}
            </div>
          ))}
        </section>

        <section className="grid2">
          <div className="card dark" style={{ gap: 10, padding: 16 }}>
            <span className="label" style={{ color: 'var(--gold)', fontSize: 10 }}>Attendance challenge</span>
            <span className="num" style={{ fontSize: 17, lineHeight: 1.15 }}>Podium on 4 days this week</span>
            <Steps total={4} done={Math.min(4, a.medalDaysThisWeek)} color="var(--gold)" />
            <span className="tiny" style={{ color: 'var(--soft-dark)' }}>{a.medalDaysThisWeek >= 4 ? 'Done! Nice work' : `${a.medalDaysThisWeek} of 4 done`}</span>
          </div>
          <div className="card dark" style={{ gap: 10, padding: 16 }}>
            <span className="label" style={{ color: 'var(--lime)', fontSize: 10 }}>Game challenge</span>
            <span className="num" style={{ fontSize: 17, lineHeight: 1.15 }}>Win with 3 different partners</span>
            <Steps total={3} done={Math.min(3, g.partnersThisWeek)} color="var(--lime)" />
            <span className="tiny" style={{ color: 'var(--soft-dark)' }}>{g.partnersThisWeek >= 3 ? 'Done! Nice work' : `${g.partnersThisWeek} of 3 done`}</span>
          </div>
        </section>

        <section className="card">
          <div className="between"><h2 className="h2">Badges</h2><span className="small muted">{m.myBadges.filter((b) => b.earned).length} of {m.myBadges.length} unlocked</span></div>
          <div className="grid4">
            {[...m.myBadges].sort((x, y) => Number(y.earned) - Number(x.earned)).map((b) => {
              const [bg, ring] = !b.earned ? ['#EEF0E9', '#E2E5DC'] : b.track === 'attendance' ? ['#F2C230', '#B8860B'] : ['#C8F04B', '#6E9A12'];
              return (
                <div key={b.key} className="stack" style={{ alignItems: 'center', gap: 6 }} title={b.hint}>
                  <span className="avatar" style={{ width: 56, height: 56, background: bg, border: `3px solid ${ring}`, color: b.earned ? 'var(--ink)' : '#6B7A70' }}><Icon name={BADGE_ICON[b.key]} /></span>
                  <span className="tiny" style={{ fontWeight: 700, textAlign: 'center', lineHeight: 1.2, color: b.earned ? 'var(--ink)' : 'var(--muted)', fontSize: 11 }}>{b.name}</span>
                </div>
              );
            })}
          </div>
          <p className="tiny muted" style={{ margin: 0 }}>Gold rims are for showing up, lime rims for playing. Tap and hold a badge to see how to earn it.</p>
        </section>

        <section className="card" style={{ gap: 10 }}>
          <h2 className="h3">Latest games</h2>
          {m.recentGames.length === 0 && <p className="small muted" style={{ margin: 0 }}>No games logged yet.</p>}
          {m.recentGames.map((r) => {
            const mine = r.winners.includes(me.id) || r.losers.includes(me.id);
            const fresh = Date.now() - Date.parse(r.played_at) < 24 * 3600 * 1000;
            const [ws, ls] = r.score_a > r.score_b ? [r.score_a, r.score_b] : [r.score_b, r.score_a];
            return (
              <div key={r.id} className="between" style={{ fontSize: 15 }}>
                <span><b>{r.winners.map(you).join(' & ')}</b> beat {r.losers.map(you).join(' & ')}{r.upset && <span className="chip" style={{ marginLeft: 6, background: 'var(--lime)', fontSize: 11, padding: '2px 6px' }}>upset</span>}</span>
                <span className="row" style={{ gap: 6, flexShrink: 0, whiteSpace: 'nowrap' }}>
                  <b>{ws}–{ls}</b>
                  {mine && fresh && <button aria-label="Flag this score" onClick={() => flag(r.id)} style={{ border: 0, background: 'none', color: 'var(--muted)', padding: 4 }}><Icon name="flag" size={16} /></button>}
                </span>
              </div>
            );
          })}
          <p className="tiny muted" style={{ margin: 0 }}>Logged by a player after each game. Players in a game can flag its score for 24 hours.</p>
        </section>

        <section className="card" style={{ gap: 4 }}>
          <h2 className="h3" style={{ marginBottom: 6 }}>Who's on court today</h2>
          {m.todayArrivals.length === 0 && <p className="small muted" style={{ margin: 0 }}>Nobody yet. Be the first and take gold!</p>}
          {m.todayArrivals.map((x, i) => (
            <div key={x.player_id} className="list-row">
              <span className="num" style={{ width: 20, fontSize: 16, color: 'var(--muted)' }}>{i + 1}</span>
              <Avatar name={m.name(x.player_id)} size={36} />
              <span style={{ flexGrow: 1, fontWeight: 700 }}>{you(x.player_id)}</span>
              <span className="small muted">{fmtTime(x.at, m.tz)}</span>
              <span className={`status ${x.onTime ? 's-confirmed' : 's-pending'}`}>{x.onTime ? 'On time' : 'Late'}</span>
            </div>
          ))}
          <a className="btn btn-green btn-sm" href={whatsappLink(dailyRecap(m, location.origin))} target="_blank" rel="noreferrer"
            style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', color: 'var(--lime)' }}>
            Share today's scoreboard on WhatsApp
          </a>
        </section>
      </div>
    </>
  );
}
