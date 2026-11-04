import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Checkin, Game, MonthPlayer, MonthRow, Payment, Player, Settings } from './engine';
import { localDate, monthOf } from './engine';
import { demoApi } from './demo';

export type FullSettings = Settings & {
  club_name: string; court_lat: number | null; court_lng: number | null; court_radius_m: number;
};

/** A club as the super admin sees it: its people, never its money. */
export type ClubSummary = { id: string; name: string; players: Player[] };

export type ClubData = {
  settings: FullSettings;
  players: Player[];
  me: Player;
  checkins: Checkin[];
  games: Game[];
  months: MonthRow[];
  lineup: MonthPlayer[];
  payments: Payment[];
  today: string;
  month: string;
};

export interface Api {
  demo: boolean;
  getSessionEmail(): Promise<string | null>;
  onAuthChange(cb: () => void): () => void;
  signIn(username: string, password: string): Promise<void>;
  /** True until the first account is linked: lets the admin create their own login. */
  needsFirstAdmin(): Promise<boolean>;
  createFirstAdmin(username: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  changePassword(password: string): Promise<void>;
  /** Links the signed-in account to its player row. Null when the email isn't on the list. */
  claim(): Promise<Player | null>;
  load(): Promise<ClubData>;
  checkIn(): Promise<void>;
  undoCheckIn(): Promise<void>;
  logGame(format: 'singles' | 'doubles', a: string[], b: string[], scoreA: number, scoreB: number): Promise<void>;
  flagGame(id: string, reason: string): Promise<void>;
  markPaid(month: string): Promise<void>;
  admin: {
    saveMonth(m: MonthRow): Promise<void>;
    setPlaying(month: string, playerId: string, playing: boolean): Promise<void>;
    confirmPayment(month: string, playerId: string, confirmed: boolean): Promise<void>;
    addPlayer(name: string): Promise<string>;
    /** Creates (or replaces) a player's username + password login. */
    setLogin(playerId: string, username: string, password: string): Promise<void>;
    updatePlayer(id: string, patch: Partial<Pick<Player, 'name' | 'email' | 'active' | 'is_admin'>>): Promise<void>;
    resolveGame(id: string, keep: boolean): Promise<void>;
    setCheckin(playerId: string, date: string, isoTime: string | null): Promise<void>;
    saveSettings(patch: Partial<FullSettings>): Promise<void>;
  };
  /** Super admin only. */
  super: {
    listClubs(): Promise<ClubSummary[]>;
    createClub(name: string): Promise<string>;
    addPlayer(clubId: string, name: string, isAdmin: boolean): Promise<string>;
  };
}

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

/** Logins are username + password. Supabase needs an email, so each username maps to a
 *  made-up address that never receives mail (Confirm email must be off in Supabase). */
const DOMAIN = 'smash-club.app';
export function cleanUsername(u: string) {
  const v = u.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,20}$/.test(v)) throw new Error('Username: 3–20 letters or numbers, no spaces');
  return v;
}
export const usernameToEmail = (u: string) => `${cleanUsername(u)}@${DOMAIN}`;
export const emailToUsername = (e: string | null | undefined) => (e ? e.replace(`@${DOMAIN}`, '') : '');
function checkPassword(pw: string) {
  if (pw.length < 6) throw new Error('Password must be at least 6 characters');
}
function friendly(error: { message: string } | null) {
  if (!error) return;
  if (/invalid login credentials/i.test(error.message)) throw new Error('Wrong username or password');
  if (/already registered|already exists/i.test(error.message)) throw new Error('That username is already taken');
  if (/confirm|email not confirmed/i.test(error.message)) throw new Error('Turn off "Confirm email" in Supabase first');
  throw new Error(error.message);
}

function supabaseApi(sb: SupabaseClient, url: string, key: string): Api {
  /** A throwaway client so creating a friend's login doesn't sign the admin out. */
  const signUpAs = async (username: string, password: string) => {
    checkPassword(password);
    const temp = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'sc-temp' } });
    const { data, error } = await temp.auth.signUp({ email: usernameToEmail(username), password });
    friendly(error);
    if (!data.session) throw new Error('Turn off "Confirm email" in Supabase first');
    await temp.auth.signOut();
  };

  let clubId = ''; // the signed-in player's club, set by load()

  return {
    demo: false,
    async getSessionEmail() {
      const { data } = await sb.auth.getSession();
      return data.session?.user.email ?? null;
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange(() => cb());
      return () => data.subscription.unsubscribe();
    },
    async signIn(username, password) {
      friendly((await sb.auth.signInWithPassword({ email: usernameToEmail(username), password })).error);
    },
    async needsFirstAdmin() {
      const { data, error } = await sb.rpc('needs_first_admin');
      return !error && data === true;
    },
    async createFirstAdmin(username, password) {
      await signUpAs(username, password);
      friendly((await sb.auth.signInWithPassword({ email: usernameToEmail(username), password })).error);
    },
    async signOut() {
      await sb.auth.signOut();
    },
    async changePassword(password) {
      checkPassword(password);
      friendly((await sb.auth.updateUser({ password })).error);
    },
    async claim() {
      const { data, error } = await sb.rpc('claim_player');
      fail(error);
      return data?.id ? (data as Player) : null;
    },
    async load() {
      const ensured = await sb.rpc('ensure_current_month');
      fail(ensured.error);
      void sb.rpc('mark_seen').then(() => {}, () => {}); // best effort: lets the admin see who uses the app
      const me = await sb.rpc('claim_player');
      fail(me.error);
      clubId = (me.data as Player).club_id!;
      const [club, players, checkins, games, months, lineup, payments] = await Promise.all([
        sb.from('clubs').select('*').eq('id', clubId).single(),
        sb.from('players').select('id,name,email,active,is_admin,is_super,club_id,last_seen_at').eq('club_id', clubId).order('name'),
        sb.from('checkins').select('player_id,play_date,checked_in_at').eq('club_id', clubId),
        sb.from('games').select('id,played_at,format,score_a,score_b,flagged_by,game_players(player_id,team)').eq('club_id', clubId).order('played_at'),
        sb.from('months').select('month,court_fee,cork_fee,other_fee').eq('club_id', clubId).order('month'),
        sb.from('month_players').select('month,player_id,playing').eq('club_id', clubId),
        sb.from('payments').select('month,player_id,marked_paid_at,confirmed_at').eq('club_id', clubId),
      ]);
      const settings = club;
      for (const r of [club, players, checkins, games, months, lineup, payments]) fail(r.error);
      const c = settings.data as Omit<FullSettings, 'club_name'> & { name: string };
      const s: FullSettings = { ...c, club_name: c.name };
      const today = localDate(new Date().toISOString(), s.timezone);
      type Row = Omit<Game, 'a' | 'b'> & { game_players: { player_id: string; team: 'A' | 'B' }[] };
      return {
        settings: s,
        players: players.data as Player[],
        me: me.data as Player,
        checkins: checkins.data as Checkin[],
        games: (games.data as Row[]).map(({ game_players, ...g }) => ({
          ...g,
          a: game_players.filter((x) => x.team === 'A').map((x) => x.player_id),
          b: game_players.filter((x) => x.team === 'B').map((x) => x.player_id),
        })),
        months: months.data as MonthRow[],
        lineup: lineup.data as MonthPlayer[],
        payments: payments.data as Payment[],
        today,
        month: monthOf(today),
      };
    },
    async checkIn() {
      fail((await sb.rpc('check_in')).error);
    },
    async undoCheckIn() {
      fail((await sb.rpc('undo_check_in')).error);
    },
    async logGame(format, a, b, scoreA, scoreB) {
      fail((await sb.rpc('log_game', { p_format: format, p_team_a: a, p_team_b: b, p_score_a: scoreA, p_score_b: scoreB })).error);
    },
    async flagGame(id, reason) {
      fail((await sb.rpc('flag_game', { p_game: id, p_reason: reason })).error);
    },
    async markPaid(month) {
      fail((await sb.rpc('mark_paid', { p_month: month })).error);
    },
    admin: {
      async saveMonth(m) {
        fail((await sb.from('months').upsert({ ...m, club_id: clubId }, { onConflict: 'club_id,month' })).error);
      },
      async setPlaying(month, player_id, playing) {
        fail((await sb.from('month_players').upsert({ month, player_id, playing })).error);
      },
      async confirmPayment(month, player_id, confirmed) {
        const me = (await sb.rpc('claim_player')).data as Player;
        fail((await sb.from('payments').upsert({
          month, player_id,
          confirmed_at: confirmed ? new Date().toISOString() : null,
          confirmed_by: confirmed ? me.id : null,
        })).error);
      },
      async addPlayer(name) {
        const { data, error } = await sb.from('players').insert({ name }).select('id').single();
        fail(error);
        return (data as { id: string }).id;
      },
      async setLogin(playerId, username, password) {
        const email = usernameToEmail(username);
        checkPassword(password);
        const taken = await sb.rpc('username_taken', { p_username: cleanUsername(username), p_player: playerId });
        fail(taken.error);
        if (taken.data) throw new Error(`"${cleanUsername(username)}" is taken. Try another, like ${cleanUsername(username)}.k`);
        try {
          await signUpAs(username, password);
        } catch (e) {
          // Login already exists (a reset, or an earlier save): just set the new password.
          if (!/already taken/.test((e as Error).message)) throw e;
          fail((await sb.rpc('admin_set_password', { p_username: cleanUsername(username), p_password: password })).error);
        }
        const current = await sb.from('players').select('email').eq('id', playerId).single();
        fail(current.error);
        if ((current.data as { email: string | null }).email !== email)
          fail((await sb.from('players').update({ email, user_id: null }).eq('id', playerId)).error);
      },
      async updatePlayer(id, patch) {
        if (patch.email !== undefined) patch.email = patch.email?.toLowerCase() || null;
        fail((await sb.from('players').update(patch).eq('id', id)).error);
      },
      async resolveGame(id, keep) {
        fail(keep
          ? (await sb.from('games').update({ flagged_by: null, flag_reason: null }).eq('id', id)).error
          : (await sb.from('games').delete().eq('id', id)).error);
      },
      async setCheckin(player_id, play_date, iso) {
        const me = (await sb.rpc('claim_player')).data as Player;
        fail(iso
          ? (await sb.from('checkins').upsert({ player_id, play_date, checked_in_at: iso, edited_by: me.id }, { onConflict: 'player_id,play_date' })).error
          : (await sb.from('checkins').delete().match({ player_id, play_date })).error);
      },
      async saveSettings(patch) {
        const { club_name, ...rest } = patch;
        fail((await sb.from('clubs').update({ ...rest, ...(club_name ? { name: club_name } : {}) }).eq('id', clubId)).error);
      },
    },
    super: {
      async listClubs() {
        const [clubs, players] = await Promise.all([
          sb.from('clubs').select('id,name').order('created_at'),
          sb.from('players').select('id,name,email,active,is_admin,is_super,club_id,last_seen_at').order('name'),
        ]);
        fail(clubs.error); fail(players.error);
        const all = players.data as Player[];
        return (clubs.data as { id: string; name: string }[]).map((c) => ({ ...c, players: all.filter((p) => p.club_id === c.id) }));
      },
      async createClub(name) {
        const { data, error } = await sb.from('clubs').insert({ name: name.trim() }).select('id').single();
        fail(error);
        return (data as { id: string }).id;
      },
      async addPlayer(club_id, name, is_admin) {
        const { data, error } = await sb.from('players').insert({ name: name.trim(), club_id, is_admin }).select('id').single();
        fail(error);
        return (data as { id: string }).id;
      },
    },
  };
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Real backend when Supabase keys are set; otherwise an in-memory demo club. */
export const api: Api = url && key ? supabaseApi(createClient(url, key), url, key) : demoApi();
