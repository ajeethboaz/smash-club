import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useClub } from '../club';
import { api, emailToUsername, type ClubSummary } from '../lib/api';
import { ago } from '../lib/activity';
import type { Player } from '../lib/engine';
import { Icon } from '../ui';

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Super admin: every club's people (never their money). */
export default function Clubs() {
  const { m, run } = useClub();
  const me = m.data.me;
  const [clubs, setClubs] = useState<ClubSummary[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [newClub, setNewClub] = useState('');
  const [newPerson, setNewPerson] = useState({ name: '', admin: true });
  const [login, setLogin] = useState<{ id: string; username: string; password: string } | null>(null);
  const [shared, setShared] = useState<{ id: string; text: string } | null>(null);

  const refresh = useCallback(async () => setClubs(await api.super.listClubs()), []);
  useEffect(() => { void refresh().catch(() => setClubs([])); }, [refresh]);
  if (!me.is_super) return <Navigate to="/" replace />;

  /** Run an action, then refresh the club list. */
  const act = async (fn: () => Promise<unknown>, msg?: string) => {
    const ok = await run(fn, msg);
    if (ok) await refresh();
    return ok;
  };

  const loginRow = (p: Player, club: ClubSummary) => login?.id === p.id ? (
    <form className="stack" style={{ gap: 6 }} onSubmit={(e) => {
      e.preventDefault();
      const { username, password } = login;
      void act(() => api.admin.setLogin(p.id, username, password), `Login ready for ${p.name}`).then((ok) => {
        if (ok) { setShared({ id: p.id, text: `${club.name} 🏸\n${location.origin}\nUsername: ${username.trim().toLowerCase()}\nPassword: ${password}` }); setLogin(null); }
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
    <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <span className="small muted">{p.email ? `@${emailToUsername(p.email)}` : 'No login yet'}</span>
      {p.id !== me.id && (
        <>
          <button className="btn btn-ghost btn-sm" style={{ height: 32, padding: '0 10px' }}
            onClick={() => setLogin({ id: p.id, username: emailToUsername(p.email) || slug(p.name), password: '' })}>
            {p.email ? 'Reset login' : 'Set login'}
          </button>
          <button className="btn btn-ghost btn-sm" style={{ height: 32, padding: '0 10px' }}
            onClick={() => act(() => api.admin.updatePlayer(p.id, { is_admin: !p.is_admin }), p.is_admin ? `${p.name} is no longer an admin` : `${p.name} is now an admin of ${club.name}`)}>
            {p.is_admin ? 'Remove admin' : 'Make admin'}
          </button>
        </>
      )}
    </span>
  );

  return (
    <div className="page">
      <header className="row" style={{ gap: 12 }}>
        <Link to="/admin" className="icon-btn" aria-label="Back to admin" style={{ background: '#fff', color: 'var(--ink)' }}><Icon name="back" size={22} /></Link>
        <h1 className="h1" style={{ fontSize: 28 }}>Clubs</h1>
      </header>
      <p className="small muted" style={{ margin: 0 }}>Each club is private. Their admins handle players, logins, costs and payments. You can manage anyone's login and admin access, but you never see another club's money or games.</p>

      {clubs === null && <p className="muted">Loading…</p>}
      {clubs?.map((c) => {
        const people = c.players;
        const admins = people.filter((p) => p.is_admin);
        const opened = people.filter((p) => p.last_seen_at).length;
        const isOpen = open === c.id;
        return (
          <section key={c.id} className="card" style={{ gap: 0 }}>
            <button onClick={() => { setOpen(isOpen ? null : c.id); setLogin(null); setShared(null); }}
              className="between" style={{ border: 0, background: 'none', padding: 0, textAlign: 'left', width: '100%' }} aria-expanded={isOpen}>
              <span className="stack" style={{ gap: 4 }}>
                <span className="h3">{c.name}{c.id === me.club_id ? ' · your club' : ''}</span>
                <span className="tiny muted">{people.length} player{people.length === 1 ? '' : 's'} · {opened} opened the app · Admins: {admins.length ? admins.map((a) => a.name).join(', ') : 'none yet'}</span>
              </span>
              <span style={{ fontSize: 22, color: 'var(--muted)', transform: isOpen ? 'rotate(90deg)' : undefined }}>›</span>
            </button>

            {isOpen && (
              <>
                <div style={{ height: 12 }} />
                {people.length === 0 && <p className="small muted" style={{ margin: '0 0 8px' }}>No one here yet. Add the club's admin below.</p>}
                {people.map((p) => (
                  <div key={p.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                    <span className="stack" style={{ gap: 6, flexGrow: 1, minWidth: 0 }}>
                      <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                        <b style={{ color: p.active ? 'var(--ink)' : 'var(--muted)' }}>{p.name}</b>
                        {p.is_admin && <span className="status s-confirmed">Admin</span>}
                        <span className="tiny muted">{p.last_seen_at ? `Opened ${ago(p.last_seen_at)}` : p.email ? 'Never opened' : ''}</span>
                      </span>
                      {loginRow(p, c)}
                      {shared?.id === p.id && (
                        <div className="stack" style={{ gap: 8, padding: 12, borderRadius: 12, background: '#EEF7D2' }}>
                          <b className="small">Send this to {p.name} on WhatsApp</b>
                          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14 }}>{shared.text}</pre>
                          <div className="grid3">
                            <button className="btn btn-ghost btn-sm" onClick={() => void navigator.clipboard.writeText(shared.text)}>Copy</button>
                            <a className="btn btn-green btn-sm" style={{ color: '#fff', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }} href={`https://wa.me/?text=${encodeURIComponent(shared.text)}`} target="_blank" rel="noreferrer">WhatsApp</a>
                            <button className="btn btn-ghost btn-sm" onClick={() => setShared(null)}>Done</button>
                          </div>
                        </div>
                      )}
                    </span>
                  </div>
                ))}
                <form className="stack" style={{ paddingTop: 12, gap: 8 }} onSubmit={(e) => {
                  e.preventDefault();
                  const name = newPerson.name.trim();
                  if (!name) return;
                  void act(async () => {
                    const id = await api.super.addPlayer(c.id, name, newPerson.admin);
                    setLogin({ id, username: slug(name), password: '' });
                  }, `${name} added to ${c.name}. Now set their login.`).then((ok) => { if (ok) setNewPerson({ name: '', admin: newPerson.admin }); });
                }}>
                  <input className="input" placeholder={`Add someone to ${c.name}`} aria-label={`New person for ${c.name}`} value={newPerson.name} onChange={(e) => setNewPerson({ ...newPerson, name: e.target.value })} />
                  <label className="row small" style={{ gap: 8 }}>
                    <input type="checkbox" checked={newPerson.admin} onChange={(e) => setNewPerson({ ...newPerson, admin: e.target.checked })} />
                    Make them a club admin
                  </label>
                  <button className="btn btn-ghost btn-sm">+ Add person</button>
                </form>
              </>
            )}
          </section>
        );
      })}

      <section className="card">
        <h2 className="h3">New club</h2>
        <form className="stack" style={{ gap: 8 }} onSubmit={(e) => {
          e.preventDefault();
          const name = newClub.trim();
          if (!name) return;
          void act(async () => {
            const id = await api.super.createClub(name);
            setOpen(id);
            setNewPerson({ name: '', admin: true });
          }, `${name} created. Now add its admins.`).then((ok) => { if (ok) setNewClub(''); });
        }}>
          <input className="input" placeholder="Club name, e.g. BORN Smashers" aria-label="New club name" value={newClub} onChange={(e) => setNewClub(e.target.value)} />
          <button className="btn btn-green btn-sm">Create club</button>
        </form>
        <p className="tiny muted" style={{ margin: 0 }}>A new club starts with court time 6:00 AM and no costs. Its admins can change these from their own Admin page.</p>
      </section>
    </div>
  );
}
