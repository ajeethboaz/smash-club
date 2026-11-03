import { useState } from 'react';
import { useClub } from '../club';
import { Avatar } from '../ui';

const RANK_BG = ['#F2C230', '#CDD3DB', '#E3A673'];

export default function Board() {
  const { m } = useClub();
  const [tab, setTab] = useState<'att' | 'games'>('att');
  const monthName = new Date(`${m.data.month}T00:00:00Z`).toLocaleString('en-IN', { month: 'long', timeZone: 'UTC' });
  const you = (id: string) => (id === m.data.me.id ? `${m.name(id)} (you)` : m.name(id));

  return (
    <div className="page">
      <div className="between"><h1 className="h1">Leaderboard</h1><span className="small muted">{monthName}</span></div>
      <div className="seg" role="group" aria-label="Table">
        <button aria-pressed={tab === 'att'} onClick={() => setTab('att')}>Showing up</button>
        <button aria-pressed={tab === 'games'} onClick={() => setTab('games')}>Playing</button>
      </div>

      {tab === 'att' ? (
        <section className="card" style={{ gap: 0, padding: '8px 16px' }}>
          <div className="row tiny" style={{ fontWeight: 700, color: 'var(--muted)', padding: '10px 0' }}>
            <span style={{ width: 28 }}>#</span><span style={{ flexGrow: 1 }}>Player</span>
            <span style={{ width: 46, textAlign: 'right' }}>On time</span>
            <span style={{ width: 64, textAlign: 'right' }}>Medals</span>
            <span style={{ width: 50, textAlign: 'right' }}>Strikes</span>
          </div>
          {m.attRank.map((x, i) => (
            <div key={x.player_id} className="list-row" style={{ fontSize: 15 }}>
              <span className="avatar" style={{ width: 28, height: 28, fontSize: 13, background: RANK_BG[i] ?? 'var(--line-2)' }}>{i + 1}</span>
              <span className="row" style={{ flexGrow: 1, minWidth: 0, gap: 8 }}><Avatar name={m.name(x.player_id)} size={32} /><b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{you(x.player_id)}</b></span>
              <span style={{ width: 46, textAlign: 'right', fontWeight: 700 }}>{x.onTime}</span>
              <span className="tiny muted" style={{ width: 64, textAlign: 'right' }}>{x.medals.gold}·{x.medals.silver}·{x.medals.bronze}</span>
              <span style={{ width: 50, textAlign: 'right', fontWeight: 700, color: x.strikes ? 'var(--strike)' : 'var(--muted)' }}>{x.strikes}</span>
            </div>
          ))}
        </section>
      ) : (
        <section className="card" style={{ gap: 0, padding: '8px 16px' }}>
          <div className="row tiny" style={{ fontWeight: 700, color: 'var(--muted)', padding: '10px 0' }}>
            <span style={{ width: 28 }}>#</span><span style={{ flexGrow: 1 }}>Player</span>
            <span style={{ width: 46, textAlign: 'right' }}>Points</span>
            <span style={{ width: 48, textAlign: 'right' }}>W–L</span>
            <span style={{ width: 54, textAlign: 'right' }}>Rating</span>
          </div>
          {m.gameRank.map((x, i) => (
            <div key={x.player_id} className="list-row" style={{ fontSize: 15 }}>
              <span className="avatar" style={{ width: 28, height: 28, fontSize: 13, background: RANK_BG[i] ?? 'var(--line-2)' }}>{i + 1}</span>
              <span className="row" style={{ flexGrow: 1, minWidth: 0, gap: 8 }}><Avatar name={m.name(x.player_id)} size={32} /><b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{you(x.player_id)}</b></span>
              <span style={{ width: 46, textAlign: 'right', fontWeight: 700 }}>{x.points}</span>
              <span className="muted" style={{ width: 48, textAlign: 'right' }}>{x.won}–{x.lost}</span>
              <span className="muted" style={{ width: 54, textAlign: 'right' }}>{x.rating}</span>
            </div>
          ))}
        </section>
      )}

      <p className="small muted" style={{ margin: 0, lineHeight: 1.45 }}>
        {tab === 'att'
          ? 'The first three on-time arrivals each day win gold, silver and bronze. A strike is a day you missed while the others played. Ties are broken by medals, then fewer strikes.'
          : 'Game points: +10 a win, +2 a loss, +5 bonus for beating a higher-rated side. Rating moves more when you beat stronger players. Flagged games don\'t count until the admin checks them.'}
      </p>
    </div>
  );
}
