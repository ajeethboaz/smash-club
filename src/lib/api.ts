import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Checkin, Game, MonthPlayer, MonthRow, Payment, Player, Settings } from './engine';
import { localDate, monthOf } from './engine';
import { demoApi } from './demo';

export type FullSettings = Settings & {
  club_name: string; court_lat: number | null; court_lng: number | null; court_radius_m: number;
};

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
  sendCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;
  /** Links the signed-in account to its player row. Null when the email isn't on the list. */
  claim(): Promise<Player | null>;
  load(): Promise<ClubData>;
  checkIn(): Promise<void>;
  logGame(format: 'singles' | 'doubles', a: string[], b: string[], scoreA: number, scoreB: number): Promise<void>;
  flagGame(id: string, reason: string): Promise<void>;
  markPaid(month: string): Promise<void>;
  admin: {
    saveMonth(m: MonthRow): Promise<void>;
    setPlaying(month: string, playerId: string, playing: boolean): Promise<void>;
    confirmPayment(month: string, playerId: string, confirmed: boolean): Promise<void>;
    addPlayer(name: string, email: string | null): Promise<void>;
    updatePlayer(id: string, patch: Partial<Pick<Player, 'name' | 'email' | 'active' | 'is_admin'>>): Promise<void>;
    resolveGame(id: string, keep: boolean): Promise<void>;
    setCheckin(playerId: string, date: string, isoTime: string | null): Promise<void>;
    saveSettings(patch: Partial<FullSettings>): Promise<void>;
  };
}

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

function supabaseApi(sb: SupabaseClient): Api {
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
    async sendCode(email) {
      fail((await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })).error);
    },
    async verifyCode(email, token) {
      fail((await sb.auth.verifyOtp({ email, token, type: 'email' })).error);
    },
    async signOut() {
      await sb.auth.signOut();
    },
    async claim() {
      const { data, error } = await sb.rpc('claim_player');
      fail(error);
      return data?.id ? (data as Player) : null;
    },
    async load() {
      const ensured = await sb.rpc('ensure_current_month');
      fail(ensured.error);
      const [settings, players, checkins, games, months, lineup, payments, me] = await Promise.all([
        sb.from('settings').select('*').eq('id', 1).single(),
        sb.from('players').select('id,name,email,active,is_admin').order('name'),
        sb.from('checkins').select('player_id,play_date,checked_in_at'),
        sb.from('games').select('id,played_at,format,score_a,score_b,flagged_by,game_players(player_id,team)').order('played_at'),
        sb.from('months').select('*').order('month'),
        sb.from('month_players').select('*'),
        sb.from('payments').select('*'),
        sb.rpc('claim_player'),
      ]);
      for (const r of [settings, players, checkins, games, months, lineup, payments, me]) fail(r.error);
      const s = settings.data as FullSettings;
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
        fail((await sb.from('months').upsert(m)).error);
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
      async addPlayer(name, email) {
        fail((await sb.from('players').insert({ name, email: email?.toLowerCase() || null })).error);
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
        fail((await sb.from('settings').update(patch).eq('id', 1)).error);
      },
    },
  };
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Real backend when Supabase keys are set; otherwise an in-memory demo club. */
export const api: Api = url && key ? supabaseApi(createClient(url, key)) : demoApi();
