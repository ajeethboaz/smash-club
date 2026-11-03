import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useToast } from '../ui';

export default function Login() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (!sent) { await api.sendCode(email.trim()); setSent(true); toast('Code sent, check your email'); }
      else await api.verifyCode(email.trim(), code.trim());
    } catch (err) { toast((err as Error).message, true); }
    setBusy(false);
  };

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
          <label htmlFor="email" style={{ fontSize: 14, fontWeight: 500, color: 'var(--soft-dark)' }}>Email</label>
          <input id="email" type="email" required autoComplete="email" value={email} disabled={sent}
            onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
            style={{ height: 56, border: 0, borderRadius: 16, background: 'var(--green-2)', color: '#F4F5EF', padding: '0 16px', fontSize: 17, fontWeight: 500 }} />
          {sent && (
            <>
              <label htmlFor="code" style={{ fontSize: 14, fontWeight: 500, color: 'var(--soft-dark)' }}>6-digit code from the email</label>
              <input id="code" inputMode="numeric" autoComplete="one-time-code" required value={code}
                onChange={(e) => setCode(e.target.value)} placeholder="123456" autoFocus
                style={{ height: 56, border: 0, borderRadius: 16, background: 'var(--green-2)', color: '#F4F5EF', padding: '0 16px', fontSize: 22, fontWeight: 700, letterSpacing: 6 }} />
            </>
          )}
          <button className="btn btn-lime" style={{ height: 58, borderRadius: 18, fontSize: 17 }} disabled={busy}>
            {sent ? 'Sign in' : 'Send code'}
          </button>
          {sent
            ? <button type="button" onClick={() => { setSent(false); setCode(''); }} style={{ background: 'none', border: 0, color: 'var(--soft-dark)', fontSize: 14, textDecoration: 'underline' }}>Use a different email</button>
            : <p style={{ margin: 0, fontSize: 13, color: 'var(--muted-dark)', textAlign: 'center' }}>Only players added by your admin can sign in.</p>}
        </form>
      </div>
    </main>
  );
}
