import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useToast } from '../ui';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => { void api.needsFirstAdmin().then(setSetup); }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (setup) await api.createFirstAdmin(username, password);
      else await api.signIn(username, password);
    } catch (err) { toast((err as Error).message, true); }
    setBusy(false);
  };

  const inputStyle = { height: 56, border: '1.5px solid #E2E5DC', borderRadius: 16, background: '#F7F8EF', color: 'var(--ink)', padding: '0 16px', fontSize: 17, fontWeight: 500 } as const;
  const labelStyle = { fontSize: 14, fontWeight: 700, color: 'var(--muted)' } as const;

  return (
    <main style={{ minHeight: '100dvh', color: 'var(--ink)', display: 'flex', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
      {/* Big faint shuttlecock, same as the in-app watermark */}
      <svg aria-hidden="true" width="340" height="340" viewBox="0 0 24 24" fill="none" stroke="rgba(15,77,54,0.08)" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round"
        style={{ position: 'absolute', right: -90, top: 10, transform: 'rotate(-28deg)', pointerEvents: 'none' }}>
        <path d="M6 3l6 11 6-11M9 3l3 11 3-11M5 3h14" /><circle cx="12" cy="17.5" r="3.5" />
      </svg>
      <div style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', padding: 'calc(64px + env(safe-area-inset-top)) 24px calc(32px + env(safe-area-inset-bottom))', gap: 28, position: 'relative' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, flexGrow: 1, justifyContent: 'center' }}>
          <span style={{ width: 76, height: 76, borderRadius: 24, background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 28px rgba(15,31,23,.18)' }}>
            <svg width="48" height="48" viewBox="0 0 72 72" fill="none" stroke="#C8F04B" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="36" cy="52" r="10" /><path d="M28 46 L16 12 M36 42 L36 8 M44 46 L56 12 M22 28 L50 28 M19 20 L53 20" />
            </svg>
          </span>
          <h1 style={{ margin: 0, fontFamily: 'var(--display)', fontWeight: 800, fontSize: 52, lineHeight: 0.95, letterSpacing: -1.5 }}>Smash<br />Club</h1>
          <p style={{ margin: 0, fontSize: 17, lineHeight: 1.45, color: 'var(--muted)', maxWidth: 280 }}>Show up, play, settle up. Your daily badminton crew in one place.</p>
        </div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12, background: '#fff', borderRadius: 24, padding: 20, boxShadow: '0 1px 2px rgba(15,31,23,.04), 0 12px 32px rgba(15,31,23,.08)' }}>
          {setup && (
            <p style={{ margin: 0, padding: '12px 14px', borderRadius: 14, background: 'var(--gold-tint)', fontSize: 14, lineHeight: 1.4, color: 'var(--ink)' }}>
              <b>First-time setup.</b> Enter the admin username (<b>ajeeth</b>) and choose your password.
            </p>
          )}
          <label htmlFor="username" style={labelStyle}>Username</label>
          <input id="username" required autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. monish" style={inputStyle} />
          <label htmlFor="password" style={labelStyle}>{setup ? 'Choose a password' : 'Password'}</label>
          <input id="password" type="password" required minLength={6} autoComplete={setup ? 'new-password' : 'current-password'}
            value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
          <button className="btn" style={{ height: 58, borderRadius: 18, fontSize: 18, marginTop: 6, background: 'var(--green)', color: '#fff', fontFamily: 'var(--display)', fontWeight: 800 }} disabled={busy}>
            {setup ? 'Create admin login' : 'Sign in'}
          </button>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>
            {setup ? 'This shows only until the admin has signed in once.' : 'Ask your admin for your username and password.'}
          </p>
        </form>
      </div>
    </main>
  );
}
