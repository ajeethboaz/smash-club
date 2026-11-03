import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClub } from '../club';
import { api } from '../lib/api';

type Team = 'A' | 'B';

export default function LogGame() {
  const { m, run } = useClub();
  const nav = useNavigate();
  const me = m.data.me.id;
  const [format, setFormat] = useState<'doubles' | 'singles'>('doubles');
  const [teams, setTeams] = useState<Record<Team, string[]>>({ A: [me], B: [] });
  const [score, setScore] = useState<Record<Team, number>>({ A: 21, B: 15 });
  const [busy, setBusy] = useState(false);
  const size = format === 'doubles' ? 2 : 1;
  const players = m.roster.filter((p) => p.active);

  const pick = (team: Team, id: string) => {
    setTeams((t) => {
      const other: Team = team === 'A' ? 'B' : 'A';
      if (t[team].includes(id)) return { ...t, [team]: t[team].filter((x) => x !== id) };
      const mine = [...t[team], id].slice(-size);
      return { [team]: mine, [other]: t[other].filter((x) => x !== id) } as Record<Team, string[]>;
    });
  };
  const changeFormat = (f: 'doubles' | 'singles') => {
    setFormat(f);
    const n = f === 'doubles' ? 2 : 1;
    setTeams((t) => ({ A: t.A.slice(0, n), B: t.B.slice(0, n) }));
  };
  const bump = (team: Team, by: number) => setScore((s) => ({ ...s, [team]: Math.max(0, Math.min(40, s[team] + by)) }));

  const ready = teams.A.length === size && teams.B.length === size && score.A !== score.B;
  const save = async () => {
    setBusy(true);
    const ok = await run(() => api.logGame(format, teams.A, teams.B, score.A, score.B), 'Game saved!');
    setBusy(false);
    if (ok) nav('/');
  };

  return (
    <div className="page">
      <h1 className="h1">Log a game</h1>
      <div className="seg" role="group" aria-label="Format">
        <button aria-pressed={format === 'doubles'} onClick={() => changeFormat('doubles')}>Doubles</button>
        <button aria-pressed={format === 'singles'} onClick={() => changeFormat('singles')}>Singles</button>
      </div>

      {(['A', 'B'] as Team[]).map((team) => (
        <section key={team} className="card">
          <div className="between">
            <h2 className="h3 muted">Team {team}</h2>
            <div className="row">
              <button className="avatar" aria-label={`Lower Team ${team} score`} onClick={() => bump(team, -1)} style={{ width: 44, height: 44, border: 0, background: 'var(--line)', fontSize: 22 }}>–</button>
              <input aria-label={`Team ${team} score`} inputMode="numeric" value={score[team]}
                onChange={(e) => setScore((s) => ({ ...s, [team]: Math.min(40, Number(e.target.value.replace(/\D/g, '')) || 0) }))}
                className="num" style={{ width: 60, textAlign: 'center', fontSize: 40, border: 0, background: 'transparent' }} />
              <button className="avatar" aria-label={`Raise Team ${team} score`} onClick={() => bump(team, 1)} style={{ width: 44, height: 44, border: 0, background: 'var(--green)', color: 'var(--lime)', fontSize: 22 }}>+</button>
            </div>
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {players.map((p) => (
              <button key={p.id} className="pill" aria-pressed={teams[team].includes(p.id)} onClick={() => pick(team, p.id)}>
                {p.id === me ? 'You' : p.name}
              </button>
            ))}
          </div>
          <span className="tiny muted">Pick {size} player{size > 1 ? 's' : ''} · {teams[team].length}/{size}</span>
        </section>
      ))}

      {score.A === score.B && <p className="small" style={{ margin: 0, color: 'var(--warn)' }}>Scores can't be level — someone has to win.</p>}
      <p className="small muted" style={{ margin: 0 }}>Log it right after the game. Everyone in the game can flag the score for 24 hours if it looks wrong.</p>
      <button className="btn btn-lime" style={{ height: 58, borderRadius: 18, fontSize: 17 }} disabled={!ready || busy} onClick={save}>Save game</button>
    </div>
  );
}
