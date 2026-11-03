import { useState } from 'react';
import { useClub } from './club';
import { api } from './lib/api';

/** Change my password + sign out. Shown at the bottom of Pay (players) and Admin (admin). */
export function AccountCard() {
  const { run } = useClub();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  return (
    <section className="card">
      <h2 className="h3">My account</h2>
      {open ? (
        <form className="stack" style={{ gap: 8 }} onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            if (pw !== pw2) throw new Error("Passwords don't match");
            await api.changePassword(pw);
          }, 'Password changed').then((ok) => { if (ok) { setOpen(false); setPw(''); setPw2(''); } });
        }}>
          <input className="input" type="password" autoComplete="new-password" placeholder="New password (6+ characters)" aria-label="New password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <input className="input" type="password" autoComplete="new-password" placeholder="Type it again" aria-label="Repeat new password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          <div className="grid2">
            <button className="btn btn-green btn-sm">Save password</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="grid2">
          <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>Change password</button>
          <button className="btn btn-ghost btn-sm" onClick={() => api.signOut()}>Sign out</button>
        </div>
      )}
    </section>
  );
}
