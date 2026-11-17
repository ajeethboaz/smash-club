import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useClub } from '../club';
import { api } from '../lib/api';
import { dayLabel } from '../lib/engine';
import { Icon } from '../ui';

type Tab = 'time' | 'games' | 'history';
const RANK_BG = ['#F2C230', '#CDD3DB', '#E3A673'];

/** Board: the two tables, the monthly trophies and every past game. */
export default function Board() {
  const { m, run } = useClub();
  const [params, setParams] = useSearchParams();
  const tab = (['time', 'games', 'history'].includes(params.get('tab') ?? '') ? params.get('tab') : 'games') as Tab;
  const setTab = (t: Tab) => setParams(t === 'games' ? {} : { tab: t }, { replace: true });
  const [mine, setMine] = useState(false);
  const [showTrophies, setShowTrophies] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const me = m.data.me.id;
  const you = (id: string) => (id === me ? 'You' : m.name(id));
  const monthName = new Date(`${m.data.month}T00:00:00Z`).toLocaleString('en-IN', { month: 'long', timeZone: 'UTC' });

  const rank = (i: number) => (
    <span className="avatar" style={{ width: 28, height: 28, fontSize: 13, background: RANK_BG[i] ?? 'var(--line-2)' }}>{i + 1}</span>
  );

  // ── Trophies (this month) ──
  const t = m.trophies;
  const trophies = [
    { title: 'Punctuality King', who: t.punctuality?.onTime ? t.punctuality.player_id : null, detail: t.punctuality?.onTime ? `${t.punctuality.onTime} on-time days` : 'Most on-time days' },
    { title: 'Iron Man', who: null, detail: t.ironMen.length ? `${t.ironMen.length} still haven't missed a day` : 'Nobody left this month' },
    { title: 'Player of the Month', who: t.potm?.points ? t.potm.player_id : null, detail: t.potm?.points ? `${t.potm.points} game points` : 'Most game points' },
    { title: 'Team Player', who: t.teamPlayer?.player_id ?? null, detail: t.teamPlayer ? `Won with ${t.teamPlayer.partnersThisMonth} different partner${t.teamPlayer.partnersThisMonth === 1 ? '' : 's'}` : 'Win with the most different partners' },
  ];
  const leading = trophies.filter((x) => x.who === me).length + (t.ironMen.some((x) => x.player_id === me) ? 1 : 0);

  // ── History: newest day first ──
  const games = [...m.results]
    .filter((r) => !mine || r.winners.includes(me) || r.losers.includes(me))
    .sort((a, b) => b.played_at.localeCompare(a.played_at))
    .slice(0, 60);
  const byDay = games.reduce<Record<string, typeof games>>((acc, r) => ((acc[r.date] ??= []).push(r), acc), {});
  const flag = (id: string) => {
    const reason = window.prompt('What looks wrong with this score?');
    if (reason) void run(() => api.flagGame(id, reason), 'Flagged. The admin will check it.');
  };

  return (
    <div className="screen" style={{ gap: 20 }}>
      <header className="between" style={{ alignItems: 'baseline' }}>
        <h1 className="h1">Board</h1>
        <span className="small muted">{monthName}</span>
      </header>

      <div className="tabs" role="group" aria-label="Board view">
        <button aria-pressed={tab === 'time'} onClick={() => setTab('time')}>On time</button>
        <button aria-pressed={tab === 'games'} onClick={() => setTab('games')}>Games</button>
        <button aria-pressed={tab === 'history'} onClick={() => setTab('history')}>History</button>
      </div>

      {tab === 'time' && (
        <>
          <section className="panel">
            <div className="tbl-head" style={{ gridTemplateColumns: '28px minmax(0,1fr) 52px 64px 48px' }}>
              <span>#</span><span>Player</span><span style={{ textAlign: 'right' }}>On time</span><span style={{ textAlign: 'right' }}>Medals</span><span style={{ textAlign: 'right' }}>Missed</span>
            </div>
            {m.attRank.map((x, i) => (
              <div key={x.player_id} className="tbl-row" style={{ gridTemplateColumns: '28px minmax(0,1fr) 52px 64px 48px' }}>
                {rank(i)}
                <span style={{ fontWeight: x.player_id === me ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{you(x.player_id)}</span>
                <b style={{ textAlign: 'right' }}>{x.onTime}</b>
                <span className="small muted" style={{ textAlign: 'right' }}>{x.medals.gold}·{x.medals.silver}·{x.medals.bronze}</span>
                <span style={{ textAlign: 'right', color: x.strikes ? 'var(--strike)' : 'var(--muted)' }}>{x.strikes}</span>
              </div>
            ))}
          </section>
          <p className="tiny muted" style={{ margin: 0 }}>First three on time each day get gold, silver and bronze (shown as gold·silver·bronze).</p>
        </>
      )}

      {tab === 'games' && (
        <>
          {m.kings[0] && (
            <div className="banner">
              <span className="action-icon" style={{ width: 44, height: 44, background: 'var(--lime)' }}><Icon name="crown" size={22} color="var(--ink)" width={2.4} /></span>
              <span className="stack" style={{ gap: 2 }}>
                <span className="tiny" style={{ color: 'var(--muted-dark)', letterSpacing: .4, textTransform: 'uppercase' }}>King of the Court · this week</span>
                <span className="num" style={{ fontSize: 20 }}>{you(m.kings[0].player_id)} · {m.kings[0].wins} win{m.kings[0].wins === 1 ? '' : 's'}</span>
              </span>
            </div>
          )}
          <section className="panel">
            <div className="tbl-head" style={{ gridTemplateColumns: '28px minmax(0,1fr) 56px 44px' }}>
              <span>#</span><span>Player</span><span style={{ textAlign: 'right' }}>W–L</span><span style={{ textAlign: 'right' }}>Pts</span>
            </div>
            {m.gameRank.map((x, i) => (
              <div key={x.player_id} className="tbl-row" style={{ gridTemplateColumns: '28px minmax(0,1fr) 56px 44px' }}>
                {rank(i)}
                <span style={{ fontWeight: x.player_id === me ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{you(x.player_id)}</span>
                <span className="muted" style={{ textAlign: 'right' }}>{x.won}–{x.lost}</span>
                <span className="num" style={{ textAlign: 'right', fontSize: 16 }}>{x.points}</span>
              </div>
            ))}
          </section>
          <p className="tiny muted" style={{ margin: 0 }}>10 points a win, 5 for every game played and lost.</p>
        </>
      )}

      {tab !== 'history' && (
        <section className="panel">
          <button className="prow" aria-expanded={showTrophies} onClick={() => setShowTrophies((v) => !v)}>
            <span><b>Monthly trophies</b> <span className="muted">· {leading ? `you lead ${leading} of 4` : '4 up for grabs'}</span></span>
            <span style={{ transform: showTrophies ? 'rotate(90deg)' : undefined, display: 'flex' }}><Icon name="chevron" size={18} color="var(--muted)" width={2.4} /></span>
          </button>
          {showTrophies && trophies.map((x) => (
            <div key={x.title} className="prow">
              <span className="stack" style={{ gap: 2 }}>
                <b>{x.title}</b>
                <span className="small muted">{x.who ? `${you(x.who)} · ` : ''}{x.detail}</span>
              </span>
            </div>
          ))}
        </section>
      )}

      {tab === 'history' && (
        <>
          <div className="row" style={{ gap: 8 }}>
            <button className="chip-btn" aria-pressed={!mine} onClick={() => setMine(false)}>Everyone</button>
            <button className="chip-btn" aria-pressed={mine} onClick={() => setMine(true)}>My games</button>
          </div>
          {games.length === 0 && <p className="small muted" style={{ margin: 0 }}>No games logged yet.</p>}
          {Object.entries(byDay).map(([date, rs]) => (
            <section key={date} className="stack" style={{ gap: 8 }}>
              <span className="section-label">{dayLabel(date, m.data.today)}</span>
              <div className="panel">
                {rs.map((r) => {
                  const inIt = r.winners.includes(me) || r.losers.includes(me);
                  const fresh = Date.now() - Date.parse(r.created_at ?? r.played_at) < 24 * 3600 * 1000;
                  const canDelete = m.data.me.is_admin || (r.logged_by === me && fresh);
                  const asking = confirmDelete === r.id;
                  const [ws, ls] = r.score_a > r.score_b ? [r.score_a, r.score_b] : [r.score_b, r.score_a];
                  return (
                    <div key={r.id} className="prow">
                      <span className="stack" style={{ gap: 3, minWidth: 0 }}>
                        <span><b>{r.winners.map(you).join(' & ')}</b> <span className="muted">beat</span> {r.losers.map(you).join(' & ')}</span>
                        {r.late && <span className="tag">Logged late</span>}
                      </span>
                      <span className="row" style={{ gap: 2, flexShrink: 0 }}>
                        <span className="num" style={{ fontSize: 17 }}>{ws}–{ls}</span>
                        {canDelete ? (
                          asking ? (
                            <button className="chip-btn" style={{ height: 32, padding: '0 12px', marginLeft: 6, background: 'var(--warn)', color: '#fff', fontWeight: 700 }}
                              onClick={() => { setConfirmDelete(null); void run(() => api.deleteGame(r.id), 'Game deleted'); }}>Delete?</button>
                          ) : (
                            <button className="round-btn" style={{ width: 36, height: 36, background: 'none' }} aria-label="Delete this game" onClick={() => setConfirmDelete(r.id)}>
                              <Icon name="trash" size={16} color="var(--muted)" />
                            </button>
                          )
                        ) : inIt && fresh && (
                          <button className="round-btn" style={{ width: 36, height: 36, background: 'none' }} aria-label="Flag this score" onClick={() => flag(r.id)}>
                            <Icon name="flag" size={16} color="var(--muted)" />
                          </button>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          <p className="tiny muted" style={{ margin: 0 }}>Logged a game by mistake? Delete it with the bin icon within 24 hours. Think someone else got a score wrong? Flag it.</p>
        </>
      )}
    </div>
  );
}
