import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useClub } from '../club';
import { api } from '../lib/api';

/** "I won!" page: the logged-in player records a win — partner, who they beat, and the points. */
export default function LogGame() {
  const { m, run } = useClub();
  const nav = useNavigate();
  const me = m.data.me.id;
  const [format, setFormat] = useState<'doubles' | 'singles'>('doubles');
  const [partner, setPartner] = useState<string | null>(null);
  const [beat, setBeat] = useState<string[]>([]);
  const [score, setScore] = useState({ us: 21, them: 15 });
  const [busy, setBusy] = useState(false);
  const doubles = format === 'doubles';
  const size = doubles ? 2 : 1;

  // Players who checked in today come first, so the usual picks are at the top.
  const here = new Set(m.todayArrivals.map((x) => x.player_id));
  const others = m.roster
    .filter((p) => p.active && p.id !== me)
    .sort((x, y) => Number(here.has(y.id)) - Number(here.has(x.id)) || x.name.localeCompare(y.name));

  const choosePartner = (id: string) => {
    setPartner((p) => (p === id ? null : id));
    setBeat((b) => b.filter((x) => x !== id));
  };
  const chooseBeat = (id: string) => {
    setBeat((b) => (b.includes(id) ? b.filter((x) => x !== id) : [...b, id].slice(-size)));
    if (partner === id) setPartner(null);
  };
  const changeFormat = (f: 'doubles' | 'singles') => {
    setFormat(f);
    if (f === 'singles') { setPartner(null); setBeat((b) => b.slice(0, 1)); }
  };
  const bump = (side: 'us' | 'them', by: number) => setScore((s) => ({ ...s, [side]: Math.max(0, Math.min(40, s[side] + by)) }));
  const type = (side: 'us' | 'them', v: string) => setScore((s) => ({ ...s, [side]: Math.min(40, Number(v.replace(/\D/g, '')) || 0) }));

  const winners = doubles ? (partner ? [me, partner] : [me]) : [me];
  const teamsReady = winners.length === size && beat.length === size;
  const scoreOk = score.us > score.them;
  const save = async () => {
    setBusy(true);
    const ok = await run(() => api.logGame(format, winners, beat, score.us, score.them), 'Win saved!');
    setBusy(false);
    if (ok) nav('/');
  };

  const pills = (selected: (id: string) => boolean, onPick: (id: string) => void, disabled?: (id: string) => boolean) => (
    <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
      {others.map((p) => (
        <button key={p.id} className="pill" aria-pressed={selected(p.id)} disabled={disabled?.(p.id)} onClick={() => onPick(p.id)}>
          {p.name}{here.has(p.id) && <span aria-label="here today" style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 4, background: 'var(--lime-edge)', marginLeft: 6, verticalAlign: 'middle' }} />}
        </button>
      ))}
    </div>
  );

  const scoreBox = (side: 'us' | 'them', label: string) => (
    <div className="stack" style={{ alignItems: 'center', gap: 8, flex: 1 }}>
      <span className="label" style={{ color: side === 'us' ? 'var(--lime-text)' : 'var(--muted)' }}>{label}</span>
      <input aria-label={`${label} points`} inputMode="numeric" value={score[side]} onChange={(e) => type(side, e.target.value)}
        className="num" style={{ width: 90, textAlign: 'center', fontSize: 52, border: 0, background: 'transparent' }} />
      <div className="row">
        <button className="avatar" aria-label={`Lower ${label} points`} onClick={() => bump(side, -1)} style={{ width: 44, height: 44, border: 0, background: 'var(--line)', fontSize: 22 }}>–</button>
        <button className="avatar" aria-label={`Raise ${label} points`} onClick={() => bump(side, 1)} style={{ width: 44, height: 44, border: 0, background: 'var(--green)', color: 'var(--lime)', fontSize: 22 }}>+</button>
      </div>
    </div>
  );

  return (
    <div className="page">
      <div className="stack" style={{ gap: 4 }}>
        <h1 className="h1">You won!</h1>
        <span className="small muted">Log it now, while everyone still remembers the score.</span>
      </div>

      <div className="seg" role="group" aria-label="Format">
        <button aria-pressed={doubles} onClick={() => changeFormat('doubles')}>Doubles</button>
        <button aria-pressed={!doubles} onClick={() => changeFormat('singles')}>Singles</button>
      </div>

      {doubles && (
        <section className="card" style={{ border: '2px solid var(--lime)' }}>
          <div className="between">
            <h2 className="h3">Who was your partner?</h2>
            <span className="tiny muted">{partner ? '1/1' : '0/1'}</span>
          </div>
          {pills((id) => partner === id, choosePartner)}
        </section>
      )}

      <section className="card">
        <div className="between">
          <h2 className="h3">Who did you beat?</h2>
          <span className="tiny muted">{beat.length}/{size}</span>
        </div>
        {pills((id) => beat.includes(id), chooseBeat, (id) => id === partner)}
      </section>

      <section className="card">
        <h2 className="h3">Points</h2>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          {scoreBox('us', doubles ? 'Your team' : 'You')}
          <span className="num muted" style={{ fontSize: 32, marginTop: 40 }}>–</span>
          {scoreBox('them', doubles ? 'Their team' : 'Them')}
        </div>
        {!scoreOk && <p className="small" style={{ margin: 0, color: 'var(--warn)' }}>Your points need to be higher than theirs for a win.</p>}
      </section>

      <p className="tiny muted" style={{ margin: 0 }}>Green dot = checked in today. Everyone in the game can flag the score for 24 hours if it looks wrong.</p>
      <button className="btn btn-lime" style={{ height: 60, borderRadius: 18, fontSize: 18 }} disabled={!teamsReady || !scoreOk || busy} onClick={save}>
        {teamsReady ? 'Save my win' : doubles && !partner ? 'Pick your partner' : `Pick who you beat (${beat.length}/${size})`}
      </button>
      <Link to="/" className="small" style={{ alignSelf: 'center', color: 'var(--muted)' }}>Cancel</Link>
    </div>
  );
}
