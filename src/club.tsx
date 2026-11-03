import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type ClubData } from './lib/api';
import { buildModel, type Model } from './lib/model';
import { useToast } from './ui';

type Club = {
  m: Model;
  reload: () => Promise<void>;
  /** Run an action, show errors as a toast, then refresh. Returns true on success. */
  run: (fn: () => Promise<unknown>, success?: string) => Promise<boolean>;
};

const Ctx = createContext<Club | null>(null);

export function useClub() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useClub outside ClubProvider');
  return c;
}

export function ClubProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<ClubData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const reload = useCallback(async () => {
    try { setData(await api.load()); setError(null); } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  // Refresh when the app comes back to the foreground, so the race stays live.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') void reload(); };
    document.addEventListener('visibilitychange', onVis);
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, 60000);
    return () => { document.removeEventListener('visibilitychange', onVis); window.clearInterval(t); };
  }, [reload]);

  const run = useCallback(async (fn: () => Promise<unknown>, success?: string) => {
    try {
      await fn();
      if (success) toast(success);
      await reload();
      return true;
    } catch (e) {
      toast((e as Error).message, true);
      return false;
    }
  }, [reload, toast]);

  const m = useMemo(() => (data ? buildModel(data) : null), [data]);

  if (error) return <div className="center-screen"><div className="stack"><p>Couldn't load the club: {error}</p><button className="btn btn-green" onClick={reload}>Try again</button></div></div>;
  if (!m) return <div className="center-screen muted">Loading…</div>;
  return <Ctx.Provider value={{ m, reload, run }}>{children}</Ctx.Provider>;
}
