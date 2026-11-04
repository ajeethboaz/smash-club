import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import type { Medal } from './lib/engine';

export const initials = (name: string) => name.slice(0, 2).toUpperCase();

export const MEDAL_COLOR: Record<Medal, { fill: string; edge: string; tint: string; label: string }> = {
  gold: { fill: '#F2C230', edge: '#B8860B', tint: '#FFF6D6', label: 'GOLD' },
  silver: { fill: '#CDD3DB', edge: '#8C96A3', tint: '#F1F3F6', label: 'SILVER' },
  bronze: { fill: '#E3A673', edge: '#9C5B2A', tint: '#FBEBDD', label: 'BRONZE' },
};

const PATHS: Record<string, string> = {
  home: 'M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z',
  plus: 'M12 6v12M6 12h12',
  plusCircle: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8v8M8 12h8',
  board: 'M8 21V11M12 21V5M16 21v-7M4 21h16',
  card: 'M3 6h18v13H3zM3 10h18M7 15h3',
  gear: 'M12 9a3 3 0 100 6 3 3 0 000-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  pin: 'M12 21s-7-6.3-7-11a7 7 0 0114 0c0 4.7-7 11-7 11zM12 7.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
  check: 'M5 12l5 5L20 7',
  back: 'M15 6l-6 6 6 6',
  flame: 'M12 22c4 0 7-3 7-7 0-5-5-7-4-12-3 2-6 5-6 9-1-1-2-2-2-4-1 2-2 4-2 7 0 4 3 7 7 7z',
  crown: 'M3 18h18L19 7l-4 4-3-6-3 6-4-4z',
  trophy: 'M8 4h8v5a4 4 0 01-8 0zM8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4M12 13v4M8 20h8',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M2 12h2M20 12h2',
  target: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8a4 4 0 100 8 4 4 0 000-8z',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  clock: 'M12 4a8 8 0 100 16 8 8 0 000-16zM12 8v4l3 2',
  users: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a6 6 0 0112 0v1M17 11a3 3 0 100-6M22 21v-1a5 5 0 00-4-5',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  medal: 'M8 2h3l2 6M16 2h-3M12 9a6 6 0 100 12 6 6 0 000-12z',
  flag: 'M5 21V4h11l-2 4 2 4H5',
};

export function Icon({ name, size = 24, color = 'currentColor', width = 2 }: { name: keyof typeof PATHS | string; size?: number; color?: string; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export const BADGE_ICON: Record<string, string> = {
  'early-bird': 'sun', 'first-gold': 'crown', 'perfect-week': 'clock', 'streak-10': 'flame', 'streak-30': 'flame',
  'podium-regular': 'trophy', 'first-win': 'target', 'hat-trick': 'bolt', 'giant-killer': 'shield',
  'team-player': 'users', king: 'crown', marathon: 'star',
};

export function MedalSvg({ medal, size = 44, text }: { medal: Medal; size?: number; text?: string }) {
  const c = MEDAL_COLOR[medal];
  return (
    <svg width={size} height={size * 1.14} viewBox="0 0 44 50" aria-hidden="true">
      <path d="M12 0h8l4 14h-8zM32 0h-8l-4 14h8z" fill="#0F4D36" />
      <circle cx="22" cy="32" r="16" fill={c.fill} stroke={c.edge} strokeWidth="3" />
      {text && <text x="22" y="38" textAnchor="middle" fontFamily="Bricolage Grotesque, sans-serif" fontWeight="800" fontSize="16" fill="#0F1F17">{text}</text>}
    </svg>
  );
}

export function Avatar({ name, size = 40, bg = 'var(--green)', fg = '#F4F5EF', ring }: { name: string; size?: number; bg?: string; fg?: string; ring?: string }) {
  return (
    <span className="avatar" style={{ width: size, height: size, background: bg, color: fg, fontSize: size * 0.32, border: ring ? `4px solid ${ring}` : undefined }}>
      {name === '?' ? '?' : initials(name)}
    </span>
  );
}

export type PodiumSpot = { medal: Medal; name: string | null; sub: string; who?: string };

/** Silver – gold – bronze, like a real podium. */
export function Podium({ spots }: { spots: PodiumSpot[] }) {
  const order: Medal[] = ['silver', 'gold', 'bronze'];
  const dims: Record<Medal, { h: number; a: number; place: string }> = {
    gold: { h: 98, a: 70, place: '1' }, silver: { h: 70, a: 58, place: '2' }, bronze: { h: 50, a: 54, place: '3' },
  };
  return (
    <div className="podium">
      {order.map((m) => {
        const s = spots.find((x) => x.medal === m);
        const c = MEDAL_COLOR[m];
        const open = !s?.name;
        return (
          <div className="podium-col" key={m}>
            <Avatar name={open ? '?' : s!.who ?? s!.name!} size={dims[m].a} ring={c.fill} bg={open ? 'var(--ink-2)' : 'var(--green)'} fg={open ? 'var(--muted-dark)' : '#F4F5EF'} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', maxWidth: '100%' }}>
              <span className="podium-name">{open ? 'Open' : s!.name}</span>
              <span className="tiny" style={{ color: 'var(--muted-dark)' }}>{open ? 'up for grabs' : s!.sub}</span>
            </div>
            <div className="pedestal" style={{ height: dims[m].h, background: c.fill }}>
              <span className="num" style={{ fontSize: 26 }}>{dims[m].place}</span>
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1 }}>{c.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Steps({ total, done, color }: { total: number; done: number; color: string }) {
  return (
    <div className="steps" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}>
      {Array.from({ length: total }, (_, i) => <div key={i} style={i < done ? { background: color } : undefined} />)}
    </div>
  );
}

export function BottomNav() {
  const items = [
    { to: '/', icon: 'home', label: 'Home' },
    { to: '/win', icon: 'trophy', label: 'Log win' },
    { to: '/board', icon: 'board', label: 'Board' },
    { to: '/pay', icon: 'card', label: 'Pay' },
  ];
  return (
    <nav className="nav" aria-label="Main">
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name={i.icon} />{i.label}
        </NavLink>
      ))}
    </nav>
  );
}

// ─── Toasts ────────────────────────────────────────────────────────────────

const ToastCtx = createContext<(msg: string, error?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; error: boolean } | null>(null);
  const show = useCallback((msg: string, error = false) => {
    setT({ msg, error });
    window.setTimeout(() => setT((cur) => (cur?.msg === msg ? null : cur)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && <div className={`toast${t.error ? ' error' : ''}`} role="status">{t.msg}</div>}
    </ToastCtx.Provider>
  );
}
