import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { api, emailToUsername } from './lib/api';
import { ClubProvider } from './club';
import { BottomNav, ToastProvider } from './ui';
import Login from './pages/Login';
import Home from './pages/Home';
import LogGame from './pages/LogGame';
import Board from './pages/Board';
import Pay from './pages/Pay';
import Admin from './pages/Admin';

type Gate = 'loading' | 'signed-out' | 'not-listed' | 'in';

export default function App() {
  const [gate, setGate] = useState<Gate>('loading');
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const check = async () => {
      const e = await api.getSessionEmail();
      setEmail(e);
      if (!e) return setGate('signed-out');
      try { setGate((await api.claim()) ? 'in' : 'not-listed'); } catch { setGate('not-listed'); }
    };
    void check();
    return api.onAuthChange(() => void check());
  }, []);

  return (
    <ToastProvider>
      {api.demo && <div className="demo-banner">Demo mode: sample data, nothing is saved</div>}
      {gate === 'loading' && <div className="center-screen muted">Loading…</div>}
      {gate === 'signed-out' && <Login />}
      {gate === 'not-listed' && (
        <div className="center-screen">
          <div className="stack" style={{ maxWidth: 320 }}>
            <h1 className="h1">Almost there</h1>
            <p className="muted">The username <b>{emailToUsername(email)}</b> isn't linked to a player. Ask your admin to set up your login.</p>
                        <button className="btn btn-ghost" onClick={() => api.signOut()}>Use a different username</button>
          </div>
        </div>
      )}
      {gate === 'in' && (
        <BrowserRouter>
          <ClubProvider>
            <div className="app">
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/log" element={<LogGame />} />
                <Route path="/board" element={<Board />} />
                <Route path="/pay" element={<Pay />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
            <BottomNav />
          </ClubProvider>
        </BrowserRouter>
      )}
    </ToastProvider>
  );
}
