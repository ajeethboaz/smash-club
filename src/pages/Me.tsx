import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useClub } from '../club';
import { api } from '../lib/api';
import { MEDALS } from '../lib/engine';
import { BADGE_ICON, Icon, MEDAL_COLOR, Steps, initials } from '../ui';

/** Me: your own numbers, medals, badges and account. */
export default function Me() {
  const { m, run } = useClub();
  const me = m.data.me;
  const a = m.myAtt, g = m.myGames;
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const earned = m.myBadges.filter((b) => b.earned).length;
  const role = me.is_super ? 'Super admin' : me.is_admin ? 'Admin' : 'Player';
  const anyWinMedals = MEDALS.some((x) => g.weekMedals[x] > 0);

  return (
    <div className="screen" style={{ gap: 22 }}>
      <header className="row" style={{ gap: 16 }}>
        <span className="avatar" style={{ width: 64, height: 64, background: 'var(--green)', color: 'var(--lime)', fontFamily: 'var(--display)', fontSize: 24 }}>{initials(me.name)}</span>
        <span className="stack" style={{ gap: 2 }}>
          <h1 className="h1" style={{ fontSize: 26 }}>{me.name}</h1>
          <span className="small muted">{m.data.settings.club_name} · {role}</span>
        </span>
      </header>

      <section className="grid3">
        <div className="stat"><b>{g.played}</b><span>Games this month</span></div>
        <div className="stat"><b style={{ color: 'var(--lime-text)' }}>{g.won}–{g.lost}</b><span>Won–lost</span></div>
        <div className="stat"><b style={{ color: 'var(--gold-text)' }}>{a.streak}</b><span>On-time streak</span></div>
      </section>

      <section className="stack" style={{ gap: 10 }}>
        <span className="section-label">Medals this month</span>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {MEDALS.map((x) => (
            <span key={x} className="medal-pill" title={`${x} arrival medals`}><span className="medal-dot" style={{ background: MEDAL_COLOR[x].fill }} />{a.medals[x]}</span>
          ))}
          {anyWinMedals && <span className="small muted">+ {MEDALS.map((x) => g.weekMedals[x]).reduce((s, n) => s + n, 0)} King of the Court</span>}
        </div>
      </section>

      <section className="stack" style={{ gap: 10 }}>
        <span className="section-label">This week</span>
        <div className="panel" style={{ padding: '4px 16px' }}>
          {[
            { label: 'On the podium 4 days', done: Math.min(4, a.medalDaysThisWeek), total: 4, color: 'var(--gold)' },
            { label: 'Win with 3 different partners', done: Math.min(3, g.partnersThisWeek), total: 3, color: 'var(--lime-edge)' },
          ].map((c) => (
            <div key={c.label} className="prow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <span className="between"><span>{c.label}</span><span className="small muted">{c.done >= c.total ? 'Done!' : `${c.done} of ${c.total}`}</span></span>
              <Steps total={c.total} done={c.done} color={c.color} />
            </div>
          ))}
        </div>
      </section>

      <section className="stack" style={{ gap: 10 }}>
        <div className="between"><span className="section-label">Badges</span><span className="small muted">{earned} of {m.myBadges.length}</span></div>
        <div className="grid4">
          {m.myBadges.map((b) => {
            const gold = b.track === 'attendance';
            return (
              <span key={b.key} className="stack" style={{ gap: 6, alignItems: 'center' }} title={b.hint}>
                <span className="avatar" style={{
                  width: 52, height: 52,
                  background: !b.earned ? 'var(--bg)' : gold ? 'var(--gold-tint)' : '#F1FBD2',
                  border: `3px solid ${!b.earned ? 'var(--line)' : gold ? 'var(--gold)' : 'var(--lime)'}`,
                  color: b.earned ? 'var(--ink)' : '#8A968E',
                }}><Icon name={BADGE_ICON[b.key]} size={22} /></span>
                <span className="tiny" style={{ fontWeight: 700, textAlign: 'center', lineHeight: 1.2, fontSize: 11, color: b.earned ? 'var(--ink)' : 'var(--muted)' }}>{b.name}</span>
              </span>
            );
          })}
        </div>
        <span className="tiny muted">Tap and hold a badge to see how to earn it.</span>
      </section>

      <section className="panel">
        {me.is_admin && <Link to="/admin" className="prow">Admin<Icon name="chevron" size={18} color="var(--muted)" width={2.4} /></Link>}
        {me.is_super && <Link to="/clubs" className="prow">Clubs<Icon name="chevron" size={18} color="var(--muted)" width={2.4} /></Link>}
        {pwOpen ? (
          <form className="prow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }} onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              if (pw !== pw2) throw new Error("Passwords don't match");
              await api.changePassword(pw);
            }, 'Password changed').then((ok) => { if (ok) { setPwOpen(false); setPw(''); setPw2(''); } });
          }}>
            <input className="input" type="password" autoComplete="new-password" placeholder="New password (6+ characters)" aria-label="New password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <input className="input" type="password" autoComplete="new-password" placeholder="Type it again" aria-label="Repeat new password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            <div className="grid2">
              <button className="btn btn-green btn-sm">Save password</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPwOpen(false)}>Cancel</button>
            </div>
          </form>
        ) : (
          <button className="prow" onClick={() => setPwOpen(true)}>Change password<Icon name="chevron" size={18} color="var(--muted)" width={2.4} /></button>
        )}
        <button className="prow" style={{ color: 'var(--warn)' }} onClick={() => api.signOut()}>Sign out</button>
      </section>
    </div>
  );
}
