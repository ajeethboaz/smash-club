import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useClub } from '../club';
import { api } from '../lib/api';
import { addDays, dayLabel } from '../lib/engine';
import { Icon, initials } from '../ui';

/** Log a game, won or lost: who you played with and against, and the points. One screen, no scrolling.
 *  Admins can also log a game they weren't in ("Others"): pick the winners and the losers. */
export default function LogGame() {
  const { m, run } = useClub();
  const nav = useNavigate();
  const me = m.data.me.id;
  const today = m.data.today;
  // Court Cam can hand over a finished score: { us, them }
  const pre = (useLocation().state ?? null) as { us?: number; them?: number } | null;
  const [won, setWon] = useState(pre?.us != null && pre?.them != null ? pre.us > pre.them : true);
  const [format, setFormat] = useState<'doubles' | 'singles'>('doubles');
  const [partner, setPartner] = useState<string | null>(null);
  const [against, setAgainst] = useState<string[]>([]);
  const [score, setScore] = useState(pre?.us != null && pre?.them != null ? { us: pre.us, them: pre.them } : { us: 21, them: 15 });
  const [day, setDay] = useState(today);
  const [busy, setBusy] = useState(false);
  const [dupBy, setDupBy] = useState<string | null>(null); // who already logged what looks like this game
  const admin = m.data.me.is_admin;
  const [forOthers, setForOthers] = useState(false); // admin logging a game they weren't in
  const [winners, setWinners] = useState<string[]>([]);
  const [losers, setLosers] = useState<string[]>([]);
  const doubles = format === 'doubles';
  const size = doubles ? 2 : 1;
  const late = day !== today;
  const days = Array.from({ length: 8 }, (_, i) => addDays(today, -i)); // today + the last 7 days

  // Players who checked in that day come first, so the usual picks are at the top.
  const here = new Set((late ? m.days.find((x) => x.date === day)?.arrivals ?? [] : m.todayArrivals).map((x) => x.player_id));
  const byHere = (x: { id: string; name: string }, y: { id: string; name: string }) => Number(here.has(y.id)) - Number(here.has(x.id)) || x.name.localeCompare(y.name);
  const others = m.roster.filter((p) => p.active && p.id !== me).sort(byHere);
  const everyone = m.roster.filter((p) => p.active).sort(byHere);

  const pickPartner = (id: string) => setPartner((p) => (p === id ? null : id));
  const pickAgainst = (id: string) => setAgainst((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id].slice(-size)));
  const pickWinner = (id: string) => setWinners((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id].slice(-size)));
  const pickLoser = (id: string) => setLosers((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id].slice(-size)));
  const changeFormat = (f: 'doubles' | 'singles') => {
    setFormat(f);
    if (f === 'singles') { setPartner(null); setAgainst((a) => a.slice(0, 1)); setWinners((a) => a.slice(0, 1)); setLosers((a) => a.slice(0, 1)); }
  };
  /** 'won' / 'lost' for your own game, 'others' for an admin logging someone else's. */
  const changeMode = (mode: 'won' | 'lost' | 'others') => {
    const w = mode !== 'lost'; // in "others" the left score is the winners'
    if (w !== won) setScore((s) => ({ us: s.them, them: s.us }));
    setWon(w);
    setForOthers(mode === 'others');
  };
  const bump = (side: 'us' | 'them', by: number) => setScore((s) => ({ ...s, [side]: Math.max(0, Math.min(40, s[side] + by)) }));
  const type = (side: 'us' | 'them', v: string) => setScore((s) => ({ ...s, [side]: Math.min(40, Number(v.replace(/\D/g, '')) || 0) }));

  // Side A gets score.us, side B gets score.them.
  const sideA = forOthers ? winners : doubles ? (partner ? [me, partner] : [me]) : [me];
  const sideB = forOthers ? losers : against;
  const ready = sideA.length === size && sideB.length === size;
  const scoreOk = won ? score.us > score.them : score.them > score.us;
  // Any change to the form means it's no longer the game we warned about.
  useEffect(() => setDupBy(null), [won, format, partner, against, score, day, forOthers, winners, losers]);

  /** An unflagged game that day with the same players and the same score, if one exists. */
  const sameSet = (x: string[], y: string[]) => x.length === y.length && x.every((id) => y.includes(id));
  const existing = m.results.find((r) => r.date === day && r.format === format
    && sameSet(won ? r.winners : r.losers, sideA) && sameSet(won ? r.losers : r.winners, sideB)
    && Math.max(r.score_a, r.score_b) === Math.max(score.us, score.them) && Math.min(r.score_a, r.score_b) === Math.min(score.us, score.them));
  const loggedBy = (id: string | null | undefined) => (!id ? 'Someone' : id === me ? 'You' : m.name(id));

  const save = async (allowDuplicate = false) => {
    if (!allowDuplicate && existing) { setDupBy(loggedBy(existing.logged_by)); return; }
    setBusy(true);
    const ok = await run(async () => {
      try {
        await api.logGame(format, sideA, sideB, score.us, score.them, late ? day : undefined, allowDuplicate);
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.startsWith('DUPLICATE:')) { // someone saved it a moment ago
          const who = msg.slice('DUPLICATE:'.length).trim() || 'Someone';
          setDupBy(who);
          throw new Error(`${who} already logged this game`);
        }
        throw e;
      }
    }, `${forOthers ? 'Game' : won ? 'Win' : 'Game'} saved${late ? ` for ${dayLabel(day, today)}` : ''}!`);
    setBusy(false);
    if (ok) nav('/');
  };

  const faces = (kind: 'with' | 'against') => (
    <div className="faces">
      {(forOthers ? everyone : others).map((p) => {
        const on = forOthers ? (kind === 'with' ? winners : losers).includes(p.id) : kind === 'with' ? partner === p.id : against.includes(p.id);
        const taken = forOthers ? (kind === 'with' ? losers : winners).includes(p.id) : kind === 'with' ? against.includes(p.id) : partner === p.id;
        const pick = forOthers ? (kind === 'with' ? pickWinner : pickLoser) : kind === 'with' ? pickPartner : pickAgainst;
        return (
          <button key={p.id} className={`face ${kind}`} aria-pressed={on} disabled={taken}
            onClick={() => pick(p.id)}>
            <span className="avatar">{initials(p.name)}{here.has(p.id) && <span className="dot" aria-label={late ? 'checked in that day' : 'here today'} />}</span>
            <span className="nm">{p.id === me ? 'You' : p.name}</span>
          </button>
        );
      })}
    </div>
  );

  const scoreSide = (side: 'us' | 'them', label: string) => (
    <div className="row" style={{ gap: 2 }}>
      <button className="stepper" aria-label={`Lower ${label} points`} onClick={() => bump(side, -1)}>–</button>
      <input className="score-num" aria-label={`${label} points`} inputMode="numeric" value={score[side]} onChange={(e) => type(side, e.target.value)}
        style={{ color: (side === 'us') === won ? 'var(--lime-text)' : 'var(--ink)' }} />
      <button className="stepper" aria-label={`Raise ${label} points`} onClick={() => bump(side, 1)}>+</button>
    </div>
  );

  const missing = forOthers
    ? winners.length < size ? `Pick the winner${size > 1 ? 's' : ''} (${winners.length}/${size})` : losers.length < size ? `Pick who lost (${losers.length}/${size})` : !scoreOk ? "The winners' score must be higher" : null
    : doubles && !partner ? 'Pick your partner' : !ready ? `Pick who you played (${against.length}/${size})` : !scoreOk ? (won ? 'Your score must be higher' : 'Their score must be higher') : null;

  return (
    <>
      <div className="screen" style={{ gap: 22, paddingBottom: 8 }}>
        <header className="between">
          <Link to="/" className="round-btn" aria-label="Back"><Icon name="back" size={20} width={2.4} /></Link>
          <h1 className="h2" style={{ fontSize: 22 }}>Log a game</h1>
          <select className="date-chip" aria-label="When did you play?" value={day} onChange={(e) => setDay(e.target.value)}>
            {days.map((x) => <option key={x} value={x}>{dayLabel(x, today)}</option>)}
          </select>
        </header>

        <div className="tabs big" role="group" aria-label="Result">
          <button aria-pressed={!forOthers && won} onClick={() => changeMode('won')}>I won</button>
          <button aria-pressed={!forOthers && !won} onClick={() => changeMode('lost')}>I lost</button>
          {admin && <button aria-pressed={forOthers} onClick={() => changeMode('others')}>Others</button>}
        </div>
        {forOthers && <span className="small muted" style={{ marginTop: -10 }}>Log a game you didn't play in. Only admins can do this.</span>}

        <div className="row" style={{ gap: 8 }}>
          <button className="chip-btn" aria-pressed={doubles} onClick={() => changeFormat('doubles')}>Doubles</button>
          <button className="chip-btn" aria-pressed={!doubles} onClick={() => changeFormat('singles')}>Singles</button>
          {late && <span className="tag" style={{ marginLeft: 'auto' }}>Logged late · {dayLabel(day, today)}</span>}
        </div>

        {(doubles || forOthers) && (
          <section className="stack" style={{ gap: 10 }}>
            <span className="section-label">{forOthers ? 'Winners' : 'With'}</span>
            {faces('with')}
          </section>
        )}

        <section className="stack" style={{ gap: 10 }}>
          <span className="section-label">{forOthers ? 'Lost' : 'Against'}</span>
          {faces('against')}
        </section>

        <section className="score-row" aria-label="Points">
          {scoreSide('us', forOthers ? 'winners' : doubles ? 'your team' : 'your')}
          <span className="muted" style={{ fontSize: 15, fontWeight: 700 }}>vs</span>
          {scoreSide('them', forOthers ? 'losers' : doubles ? 'their team' : 'their')}
        </section>
      </div>

      <div className="sticky-save">
        {dupBy ? (
          <div className="stack" style={{ gap: 10, padding: 16, borderRadius: 20, background: '#fff', boxShadow: '0 8px 24px rgba(15,31,23,.12)' }} role="alert">
            <span style={{ fontSize: 15 }}>
              <b>{dupBy} already logged this game</b> ({Math.max(score.us, score.them)}–{Math.min(score.us, score.them)} {dayLabel(day, today).toLowerCase() === 'today' ? 'today' : `on ${dayLabel(day, today)}`}). Is this a different game?
            </span>
            <div className="grid2">
              <button className="btn btn-ghost" onClick={() => { setDupBy(null); nav('/'); }}>Same game</button>
              <button className="btn btn-green" disabled={busy} onClick={() => save(true)}>New game, save</button>
            </div>
          </div>
        ) : (
          <button className="save-btn" disabled={!!missing || busy} onClick={() => save()}>{missing ?? (!forOthers && won ? 'Save win' : 'Save game')}</button>
        )}
      </div>
    </>
  );
}
