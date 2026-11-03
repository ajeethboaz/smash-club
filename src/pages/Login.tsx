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

  const inputStyle = { height: 56, border: 0, borderRadius: 16, background: 'var(--green-2)', color: '#F4F5EF', padding: '0 16px', fontSize: 17, fontWeight: 500 } as const;
  const labelStyle = { fontSize: 14, fontWeight: 500, color: 'var(--soft-dark)' } as const;

  return (
    <main style={{ minHeight: '100dvh', background: 'var(--green)', color: '#F4F5EF', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', padding: '72px 28px 40px', gap: 32 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, flexGrow: 1, justifyContent: 'center' }}>
          <svg width="72" height="72" viewBox="0 0 72 72" fill="none" stroke="#C8F04B" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="36" cy="52" r="10" /><path d="M28 46 L16 12 M36 42 L36 8 M44 46 L56 12 M22 28 L50 28 M19 20 L53 20" />
          </svg>
          <h1 style={{ margin: 0, fontFamily: 'var(--display)', fontWeight: 800, fontSize: 52, lineHeight: 0.95, letterSpacing: -1.5 }}>Smash<br />Club</h1>
          <p style={{ margin: 0, fontSize: 17, lineHeight: 1.45, color: 'var(--soft-dark)', maxWidth: 280 }}>Show up, play, settle up. Your daily badminton crew in one place.</p>
        </div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {setup && (
            <p style={{ margin: 0, padding: '12px 14px', borderRadius: 14, background: 'var(--green-2)', fontSize: 14, lineHeight: 1.4, color: '#F4F5EF' }}>
              <b>First-time setup.</b> Enter the admin username (<b>ajeeth</b>) and choose your password.
            </p>
          )}
          <label htmlFor="username" style={labelStyle}>Username</label>
          <input id="username" required autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. monish" style={inputStyle} />
          <label htmlFor="password" style={labelStyle}>{setup ? 'Choose a password' : 'Password'}</label>
          <input id="password" type="password" required minLength={6} autoComplete={setup ? 'new-password' : 'current-password'}
            value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
          <button className="btn btn-lime" style={{ height: 58, borderRadius: 18, fontSize: 17 }} disabled={busy}>
            {setup ? 'Create admin login' : 'Sign in'}
          </button>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted-dark)', textAlign: 'center' }}>
            {setup ? 'This shows only until the admin has signed in once.' : 'Ask your admin for your username and password.'}
          </p>
        </form>
      </div>
    </main>
  );
}
