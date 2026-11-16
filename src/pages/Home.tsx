import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useClub } from '../club';
import { api } from '../lib/api';
import { fmtTime, localMinutes, MEDALS, startMinutes, type Medal } from '../lib/engine';
import { dailyRecap, whatsappLink } from '../lib/activity';
import { Icon, MEDAL_COLOR, initials } from '../ui';

/** Metres between two lat/lng points. */
function distance(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000, rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function here(): Promise<GeolocationPosition> {
  return new Promise((ok, no) => navigator.geolocation.getCurrentPosition(ok, no, { enableHighAccuracy: true, timeout: 15000 }));
}

/** Home is only about today: check in, log a game, who's here. Everything else lives on Board and Me. */
export default function Home() {
  const { m, run } = useClub();
  const d = m.data;
  const me = d.me;
  const [busy, setBusy] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);

  const nowMin = localMinutes(new Date().toISOString(), m.tz);
  const start = startMinutes(d.settings);
  const startLabel = fmtTime(new Date(Date.parse('2000-01-01T00:00:00Z') + start * 60000).toISOString(), 'UTC');
  const dateLabel = new Intl.DateTimeFormat('en-IN', { timeZone: m.tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date());
  const hour = Math.floor(nowMin / 60);
  const greeting = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';

  const openMedal: Medal | null = MEDALS[m.nextMedal] ?? null;
  const late = nowMin > start + d.settings.grace_minutes;
  const minsLeft = start + d.settings.grace_minutes - nowMin;
  const checkInSub = late ? 'Gates closed · you still count for today'
    : minsLeft > 120 ? `Gates open at ${startLabel}`
    : `${openMedal ? `${openMedal[0].toUpperCase()}${openMedal.slice(1)} is still open` : 'Keep your streak alive'} · ${minsLeft} min to ${startLabel}`;

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

  const attRank = m.rankOf(m.attRank, me.id);
  const gameRank = m.myGames.played ? m.rankOf(m.gameRank, me.id) : 0;
  const playing = m.roster.filter((p) => p.active).length;

  return (
    <div className="screen">
      <header className="stack" style={{ gap: 4 }}>
        <span className="eyebrow">{dateLabel} · {d.settings.club_name}</span>
        <h1 className="h1">{greeting}, {me.name}</h1>
      </header>

      <div className="stack" style={{ gap: 12 }}>
        {m.meToday ? (
          <div className="action action-done celebrate">
            <span>
              <span className="action-title" style={{ fontSize: 24 }}>
                {m.meToday.medal ? `${MEDAL_COLOR[m.meToday.medal].label[0]}${MEDAL_COLOR[m.meToday.medal].label.slice(1).toLowerCase()}!` : m.meToday.onTime ? "You're in" : "You're in, a bit late"}
              </span>
              <span className="action-sub muted">
                Checked in {fmtTime(m.meToday.at, m.tz)}{m.meToday.onTime ? ` · ${m.myAtt.streak}-day streak` : ''}
              </span>
            </span>
            <span className="action-icon" style={{ background: m.meToday.medal ? MEDAL_COLOR[m.meToday.medal].fill : 'var(--lime)' }}>
              <Icon name="check" color="var(--ink)" width={3} />
            </span>
          </div>
        ) : (
          <button className="action action-checkin" onClick={checkIn} disabled={busy}>
            <span>
              <span className="action-title">Check in</span>
              <span className="action-sub">{checkInSub}</span>
            </span>
            <span className="action-icon"><Icon name="pin" color="var(--ink)" width={2.4} /></span>
          </button>
        )}

        <Link to="/win" className="action action-log">
          <span>
            <span className="action-title">Log a game</span>
            <span className="action-sub">Won or lost · takes 10 seconds</span>
          </span>
          <span className="action-icon"><Icon name="plus" color="var(--lime)" width={2.6} /></span>
        </Link>

        {m.meToday && (
          <button className="link-quiet" style={{ alignSelf: 'center', color: confirmUndo ? 'var(--warn)' : undefined, fontWeight: confirmUndo ? 700 : 500 }}
            disabled={busy}
            onClick={() => { if (confirmUndo) { setConfirmUndo(false); void run(() => api.undoCheckIn(), 'Check-in removed'); } else setConfirmUndo(true); }}>
            {confirmUndo ? 'Tap again to undo your check-in' : 'Checked in by mistake? Undo'}
          </button>
        )}
      </div>

      <section className="stack" style={{ gap: 12 }}>
        <div className="between" style={{ alignItems: 'baseline' }}>
          <h2 className="h2" style={{ fontSize: 18 }}>On court today</h2>
          <span className="small muted">{m.todayArrivals.length} of {playing}</span>
        </div>
        <div className="row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {m.todayArrivals.map((x) => {
            const c = x.medal ? MEDAL_COLOR[x.medal] : null;
            return (
              <div key={x.player_id} className="stack" style={{ gap: 6, alignItems: 'center', width: 56 }} title={m.name(x.player_id)}>
                <span className="ring-face" style={{ background: c ? c.tint : '#fff', border: `3px solid ${c ? c.fill : 'var(--line)'}` }}>{initials(m.name(x.player_id))}</span>
                <span className="tiny muted" style={{ color: x.onTime ? undefined : 'var(--warn)' }}>{fmtTime(x.at, m.tz).replace(/ ?[AP]M$/, '')}</span>
              </div>
            );
          })}
          {!m.meToday && (
            <div className="stack" style={{ gap: 6, alignItems: 'center', width: 56 }}>
              <span className="ring-face" style={{ border: '2px dashed #B9C4BC', color: 'var(--muted)' }}>{initials(me.name)}</span>
              <span className="tiny muted">You?</span>
            </div>
          )}
        </div>
        {m.todayArrivals.length > 0 && (
          <a className="link-quiet" style={{ alignSelf: 'flex-start' }} href={whatsappLink(dailyRecap(m, location.origin))} target="_blank" rel="noreferrer">
            Share today's scoreboard on WhatsApp
          </a>
        )}
      </section>

      <Link to="/cam" className="panel" style={{ textDecoration: 'none' }}>
        <span className="prow">
          <span className="row" style={{ gap: 12 }}>
            <span className="action-icon" style={{ width: 40, height: 40, background: 'var(--ink)' }}><Icon name="camera" size={20} color="var(--lime)" width={2.2} /></span>
            <span className="stack" style={{ gap: 1 }}><b>Court Cam <span className="tag" style={{ color: 'var(--lime-text)' }}>BETA</span></b><span className="small muted">Smash speed, rallies, score and tips</span></span>
          </span>
          <Icon name="chevron" size={18} color="var(--muted)" width={2.4} />
        </span>
      </Link>

      <Link to="/board" className="panel" style={{ marginTop: 'auto', textDecoration: 'none' }}>
        <span className="prow">
          <span className="row" style={{ gap: 18 }}>
            <span className="row" style={{ gap: 8 }}><span className="medal-dot" style={{ width: 10, height: 10, background: 'var(--gold)' }} />On time <b>#{attRank}</b></span>
            <span className="row" style={{ gap: 8 }}><span className="medal-dot" style={{ width: 10, height: 10, background: 'var(--lime-edge)' }} />Games <b>{gameRank ? `#${gameRank}` : '–'}</b></span>
          </span>
          <Icon name="chevron" size={18} color="var(--muted)" width={2.4} />
        </span>
      </Link>
    </div>
  );
}
