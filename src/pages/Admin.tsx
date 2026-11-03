import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useClub } from '../club';
import { api, emailToUsername } from '../lib/api';
import { localMinutes, rupees } from '../lib/engine';
import { Icon } from '../ui';
import { AccountCard } from '../account';
import { STATUS_LABEL } from './Pay';

/** ISO instant for a local club date + HH:MM, in a fixed-offset or named zone. */
function zonedIso(date: string, hhmm: string, tz: string) {
  const guess = Date.parse(`${date}T${hhmm}:00Z`);
  const offset = localMinutes(new Date(guess).toISOString(), tz) - localMinutes(new Date(guess).toISOString(), 'UTC');
  const off = ((offset + 720) % 1440) - 720;
  return new Date(guess - off * 60000).toISOString();
}

export default function Admin() {
  const { m, run } = useClub();
  const d = m.data;
  const mo = d.months.find((x) => x.month === d.month);
  const [fees, setFees] = useState({ court: String(mo?.court_fee ?? 0), cork: String(mo?.cork_fee ?? 0), other: String(mo?.other_fee ?? 0) });
  const [newName, setNewName] = useState('');
  const [login, setLogin] = useState<{ id: string; username: string; password: string } | null>(null);
  const [shared, setShared] = useState<{ id: string; text: string } | null>(null);
  const [fix, setFix] = useState({ player: d.players[0]?.id ?? '', date: d.today, time: '05:55' });
  const [start, setStart] = useState(d.settings.court_start.slice(0, 5));
  const [grace, setGrace] = useState(String(d.settings.grace_minutes));
  if (!d.me.is_admin) return <Navigate to="/" replace />;

  const monthName = new Date(`${d.month}T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const lineup = (id: string) => d.lineup.find((x) => x.month === d.month && x.player_id === id)?.playing ?? false;
  const total = Number(fees.court) + Number(fees.cork) + Number(fees.other);
  const playingCount = d.players.filter((p) => lineup(p.id)).length;

  const useMyLocation = () => navigator.geolocation.getCurrentPosition(
    (pos) => void run(() => api.admin.saveSettings({ court_lat: pos.coords.latitude, court_lng: pos.coords.longitude }), 'Court location saved. Check-ins now need to be at the court.'),
    () => void run(async () => { throw new Error('Could not get your location.'); }),
    { enableHighAccuracy: true, timeout: 15000 },
  );

  return (
    <div className="page">
      <header className="row" style={{ gap: 12 }}>
        <Link to="/" className="icon-btn" aria-label="Back to home" style={{ background: '#fff', color: 'var(--ink)' }}><Icon name="back" size={22} /></Link>
        <h1 className="h1" style={{ fontSize: 28 }}>Admin</h1>
      </header>

      <section className="card">
        <h2 className="h3">{monthName} costs</h2>
        <div className="grid3">
          {([['court', 'Court'], ['cork', 'Cork'], ['other', 'Other']] as const).map(([k, label]) => (
            <div className="field" key={k}>
              <label htmlFor={`fee-${k}`}>{label} (₹)</label>
              <input id={`fee-${k}`} className="input" inputMode="decimal" value={fees[k]} onChange={(e) => setFees({ ...fees, [k]: e.target.value.replace(/[^\d.]/g, '') })} />
            </div>
          ))}
        </div>
        <span className="small muted">{rupees(total)} ÷ {playingCount} playing = {rupees(playingCount ? total / playingCount : 0)} each</span>
        <button className="btn btn-green btn-sm" onClick={() => run(() => api.admin.saveMonth({ month: d.month, court_fee: Number(fees.court), cork_fee: Number(fees.cork), other_fee: Number(fees.other) }), 'Costs saved')}>Save costs</button>
      </section>

      <section className="card" style={{ gap: 0 }}>
        <h2 className="h3" style={{ paddingBottom: 8 }}>Payments</h2>
        {d.players.filter((p) => lineup(p.id)).map((p) => {
          const st = m.money.status(p.id);
          return (
            <div key={p.id} className="list-row" style={{ justifyContent: 'space-between' }}>
              <span className="stack" style={{ gap: 2 }}><b>{p.name}</b><span className={`status s-${st}`} style={{ alignSelf: 'flex-start' }}>{STATUS_LABEL[st]}</span></span>
              {st === 'confirmed'
                ? <button className="btn btn-ghost btn-sm" onClick={() => run(() => api.admin.confirmPayment(d.month, p.id, false))}>Undo</button>
                : <button className="btn btn-green btn-sm" onClick={() => run(() => api.admin.confirmPayment(d.month, p.id, true), `${p.name}'s payment confirmed`)}>Confirm</button>}
            </div>
          );
        })}
      </section>

      {m.flaggedGames.length > 0 && (
        <section className="card" style={{ gap: 0 }}>
          <h2 className="h3" style={{ paddingBottom: 8 }}>Flagged games</h2>
          {m.flaggedGames.map((g) => (
            <div key={g.id} className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <span><b>{g.a.map(m.name).join(' & ')}</b> {g.score_a}–{g.score_b} <b>{g.b.map(m.name).join(' & ')}</b></span>
              <span className="small muted">Flagged by {m.name(g.flagged_by!)}</span>
              <div className="row">
                <button className="btn btn-green btn-sm" onClick={() => run(() => api.admin.resolveGame(g.id, true), 'Score kept')}>Score is right</button>
                <button className="btn btn-ghost btn-sm" onClick={() => run(() => api.admin.resolveGame(g.id, false), 'Game removed')}>Remove game</button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="card" style={{ gap: 0 }}>
        <div className="between" style={{ paddingBottom: 8 }}><h2 className="h3">Players</h2><span className="tiny muted">Playing in {monthName.split(' ')[0]}</span></div>
        {d.players.map((p) => (
          <div key={p.id} className="list-row" style={{ alignItems: 'flex-start' }}>
            <span className="stack" style={{ gap: 6, flexGrow: 1, minWidth: 0 }}>
              <b style={{ color: lineup(p.id) ? 'var(--ink)' : 'var(--muted)' }}>{p.name}{p.is_admin ? ' · admin' : ''}</b>
              {login?.id === p.id ? (
                <form className="stack" style={{ gap: 6 }} onSubmit={(e) => {
                  e.preventDefault();
                  const { username, password } = login;
                  void run(() => api.admin.setLogin(p.id, username, password), `Login ready for ${p.name}`).then((ok) => {
                    if (ok) { setShared({ id: p.id, text: `Smash Club 🏸\n${location.origin}\nUsername: ${username.trim().toLowerCase()}\nPassword: ${password}` }); setLogin(null); }
                  });
                }}>
                  <input className="input" style={{ height: 40, fontSize: 14 }} placeholder="Username" autoCapitalize="none" autoCorrect="off" aria-label={`${p.name}'s username`}
                    value={login.username} onChange={(e) => setLogin({ ...login, username: e.target.value })} />
                  <input className="input" style={{ height: 40, fontSize: 14 }} placeholder="Password (6+ characters)" aria-label={`${p.name}'s password`}
                    value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} />
                  <div className="grid2">
                    <button className="btn btn-green btn-sm">Save login</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLogin(null)}>Cancel</button>
                  </div>
                </form>
              ) : (
                <span className="row" style={{ gap: 8 }}>
                  <span className="small muted">{p.email ? `@${emailToUsername(p.email)}` : 'No login yet'}</span>
                  {p.id !== d.me.id && (
                    <button className="btn btn-ghost btn-sm" style={{ height: 32, padding: '0 10px' }}
                      onClick={() => setLogin({ id: p.id, username: emailToUsername(p.email) || p.name.toLowerCase().replace(/[^a-z0-9]/g, ''), password: '' })}>
                      {p.email ? 'Reset login' : 'Set login'}
                    </button>
                  )}
                </span>
              )}
              {shared?.id === p.id && (
                <div className="stack" style={{ gap: 8, padding: 12, marginTop: 8, borderRadius: 12, background: 'var(--lime-soft, #EEF7D2)' }}>
                  <b className="small">Send this to them on WhatsApp</b>
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14 }}>{shared.text}</pre>
                  <div className="grid3">
                    <button className="btn btn-ghost btn-sm" onClick={() => void navigator.clipboard.writeText(shared.text)}>Copy</button>
                    <a className="btn btn-green btn-sm" style={{ color: '#fff', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }} href={`https://wa.me/?text=${encodeURIComponent(shared.text)}`} target="_blank" rel="noreferrer">WhatsApp</a>
                    <button className="btn btn-ghost btn-sm" onClick={() => setShared(null)}>Done</button>
                  </div>
                </div>
              )}
            </span>
            <button className="switch" role="switch" aria-checked={lineup(p.id)} aria-label={`${p.name} playing this month`}
              onClick={() => run(async () => {
                await api.admin.setPlaying(d.month, p.id, !lineup(p.id));
                await api.admin.updatePlayer(p.id, { active: !lineup(p.id) });
              })}>
              <span />
            </button>
          </div>
        ))}
        <form className="stack" style={{ paddingTop: 12, gap: 8 }} onSubmit={(e) => {
          e.preventDefault();
          if (!newName.trim()) return;
          const name = newName.trim();
          void run(async () => {
            const id = await api.admin.addPlayer(name);
            setLogin({ id, username: name.toLowerCase().replace(/[^a-z0-9]/g, ''), password: '' });
          }, `${name} added. Now set their login above.`).then((ok) => { if (ok) setNewName(''); });
        }}>
          <input className="input" placeholder="New player's name" aria-label="New player name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="btn btn-ghost btn-sm">+ Add player</button>
        </form>
      </section>

      <section className="card">
        <h2 className="h3">Fix a check-in</h2>
        <p className="small muted" style={{ margin: 0 }}>For a dead phone or a GPS glitch. Medals and streaks recalculate automatically.</p>
        <div className="field"><label htmlFor="fix-p">Player</label>
          <select id="fix-p" className="input" value={fix.player} onChange={(e) => setFix({ ...fix, player: e.target.value })}>
            {d.players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></div>
        <div className="grid2">
          <div className="field"><label htmlFor="fix-d">Date</label><input id="fix-d" className="input" type="date" value={fix.date} max={d.today} onChange={(e) => setFix({ ...fix, date: e.target.value })} /></div>
          <div className="field"><label htmlFor="fix-t">Time</label><input id="fix-t" className="input" type="time" value={fix.time} onChange={(e) => setFix({ ...fix, time: e.target.value })} /></div>
        </div>
        <div className="grid2">
          <button className="btn btn-green btn-sm" onClick={() => run(() => api.admin.setCheckin(fix.player, fix.date, zonedIso(fix.date, fix.time, m.tz)), 'Check-in saved')}>Save check-in</button>
          <button className="btn btn-ghost btn-sm" onClick={() => run(() => api.admin.setCheckin(fix.player, fix.date, null), 'Check-in removed')}>Remove</button>
        </div>
      </section>

      <section className="card">
        <h2 className="h3">Court rules</h2>
        <div className="grid2">
          <div className="field"><label htmlFor="start">Gates close at</label><input id="start" className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div className="field"><label htmlFor="grace">Grace (minutes)</label><input id="grace" className="input" inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value.replace(/\D/g, ''))} /></div>
        </div>
        <button className="btn btn-green btn-sm" onClick={() => run(() => api.admin.saveSettings({ court_start: start, grace_minutes: Math.min(60, Number(grace) || 0) }), 'Rules saved')}>Save rules</button>
        <div className="stack" style={{ gap: 6 }}>
          <b className="small">Location check</b>
          <span className="small muted">
            {d.settings.court_lat != null
              ? `On: check-ins must be within ${d.settings.court_radius_m} m of the court.`
              : 'Off: anyone can check in from anywhere. Stand on the court and tap below to turn it on.'}
          </span>
          <div className="grid2">
            <button className="btn btn-lime btn-sm" onClick={useMyLocation}>{d.settings.court_lat != null ? 'Reset to here' : "I'm at the court"}</button>
            {d.settings.court_lat != null && <button className="btn btn-ghost btn-sm" onClick={() => run(() => api.admin.saveSettings({ court_lat: null, court_lng: null }), 'Location check off')}>Turn off</button>}
          </div>
        </div>
      </section>

      <AccountCard />
    </div>
  );
}
