/**
 * Turns shuttle positions into badminton events: rallies, hits, speeds and who won the point.
 *
 * Assumes the phone films the court from the side, so the net is a vertical line in the
 * picture with one team on the left and one on the right.
 */
import type { Pt } from './tracker';

export type Side = 'left' | 'right';

export type Hit = { t: number; x: number; y: number; side: Side };

export type Rally = {
  id: number;
  start: number; // seconds
  end: number;
  hits: Hit[];
  shots: number; // number of times the shuttle was hit
  peakKmh: number; // fastest the shuttle went in this rally
  smashKmh: number; // fastest downward shot (a smash), 0 if none
  smashSide: Side | null; // which team hit that smash
  lastSide: Side; // where the shuttle was last seen: it probably landed on this side
};

export type RallyEvent =
  | { type: 'start'; t: number }
  | { type: 'hit'; hit: Hit; shots: number }
  | { type: 'end'; rally: Rally };

export type CourtSetup = {
  /** Net position across the picture, 0 (left edge) – 1 (right edge). */
  net: number;
  /** Pixels per metre in the processing frame; from tapping the two baselines (13.4 m apart). */
  pxPerM: number;
};

export const COURT_LENGTH_M = 13.4;
const MAX_KMH = 420; // faster than the world record: a tracking glitch

export class RallyEngine {
  private setup: CourtSetup;
  private width: number;
  private pending: Pt[] = [];
  private pts: Pt[] = [];
  private cur: Rally | null = null;
  private lastSeen = -Infinity;
  private dir = 0; // horizontal direction of travel: -1 left, 1 right
  private speeds: { kmh: number; down: boolean; side: Side }[] = [];
  private nextId = 1;
  /** No shuttle for this long ends the rally. */
  idleEnd = 1.2;

  constructor(width: number, setup: CourtSetup) {
    this.width = width;
    this.setup = setup;
  }

  get active() { return !!this.cur; }
  get current() { return this.cur; }

  side(x: number): Side { return x < this.setup.net * this.width ? 'left' : 'right'; }

  feed(p: Pt | null, t: number): RallyEvent[] {
    const ev: RallyEvent[] = [];
    if (!p) {
      if (this.cur && t - this.lastSeen > this.idleEnd) ev.push(this.finish());
      if (this.pending.length && t - this.pending[this.pending.length - 1].t > 0.4) this.pending = [];
      return ev;
    }
    this.lastSeen = t;

    if (!this.cur) {
      // A rally starts only after a few sightings in quick succession (filters out stray specks).
      this.pending.push(p);
      this.pending = this.pending.filter((q) => p.t - q.t < 0.5);
      if (this.pending.length < 3) return ev;
      const first = this.pending[0];
      this.cur = { id: this.nextId++, start: first.t, end: t, hits: [], shots: 0, peakKmh: 0, smashKmh: 0, smashSide: null, lastSide: this.side(p.x) };
      this.pts = [];
      this.speeds = [];
      this.dir = 0;
      ev.push({ type: 'start', t: first.t });
      // The first sighting is the serve.
      const serve: Hit = { t: first.t, x: first.x, y: first.y, side: this.side(first.x) };
      this.cur.hits.push(serve); this.cur.shots = 1;
      ev.push({ type: 'hit', hit: serve, shots: 1 });
      for (const q of this.pending) ev.push(...this.track(q));
      this.pending = [];
      return ev;
    }
    ev.push(...this.track(p));
    return ev;
  }

  /** Call when the video ends or the camera stops. */
  flush(): RallyEvent[] { return this.cur ? [this.finish()] : []; }

  private track(p: Pt): RallyEvent[] {
    const ev: RallyEvent[] = [];
    const r = this.cur!;
    const prev = this.pts[this.pts.length - 1];
    this.pts.push(p);
    r.end = p.t;
    r.lastSide = this.side(p.x);
    if (!prev || p.t <= prev.t) return ev;

    const dt = p.t - prev.t;
    const dx = p.x - prev.x, dy = p.y - prev.y;

    // Speed between two close sightings.
    if (dt <= 0.12) {
      const kmh = (Math.hypot(dx, dy) / this.setup.pxPerM / dt) * 3.6;
      if (kmh <= MAX_KMH) this.speeds.push({ kmh, down: dy > 0 && dy > Math.abs(dx) * 0.25, side: this.side(prev.x) });
    }

    // A hit flips the horizontal direction. Ignore tiny wobbles.
    const minMove = this.width * 0.004;
    if (Math.abs(dx) >= minMove) {
      const d = Math.sign(dx);
      if (this.dir !== 0 && d !== this.dir) {
        const hit: Hit = { t: prev.t, x: prev.x, y: prev.y, side: this.side(prev.x) };
        const lastHit = r.hits[r.hits.length - 1];
        // Two "hits" a split second apart on the same side are one shot.
        if (!lastHit || hit.t - lastHit.t > 0.25 || hit.side !== lastHit.side) {
          r.hits.push(hit); r.shots = r.hits.length;
          ev.push({ type: 'hit', hit, shots: r.shots });
        }
      }
      this.dir = d;
    }
    return ev;
  }

  private finish(): RallyEvent {
    const r = this.cur!;
    // Peak speed: the higher of two neighbouring readings agreeing (drops one-frame glitches).
    let peak = 0, smash = 0, smashSide: Side | null = null;
    for (let i = 1; i < this.speeds.length; i++) {
      const a = this.speeds[i - 1], b = this.speeds[i];
      const v = Math.min(a.kmh, b.kmh);
      if (v > peak) peak = v;
      if (a.down && b.down && v > smash) { smash = v; smashSide = a.side; }
    }
    if (this.speeds.length === 1) peak = this.speeds[0].kmh;
    r.peakKmh = Math.round(peak);
    r.smashKmh = smash >= 80 ? Math.round(smash) : 0; // slower than this is a drop or a push, not a smash
    r.smashSide = r.smashKmh ? smashSide : null;
    this.cur = null;
    this.pts = [];
    return { type: 'end', rally: r };
  }
}

/** Pixels per metre from the two baselines' x positions (processing pixels). */
export const calibrate = (leftBaselineX: number, rightBaselineX: number) =>
  Math.max(1, Math.abs(rightBaselineX - leftBaselineX)) / COURT_LENGTH_M;

// ─── Score keeper ─────────────────────────────────────────────────────────────

/** Badminton rally scoring: 21 points, win by 2, 30 caps it. */
export class Score {
  left = 0;
  right = 0;
  private log: Side[] = [];

  point(side: Side) { if (this.winner) return; this.log.push(side); side === 'left' ? this.left++ : this.right++; }
  undo() { const s = this.log.pop(); if (s === 'left') this.left--; else if (s === 'right') this.right--; }
  get points() { return this.log.length; }

  get winner(): Side | null {
    const { left: l, right: r } = this;
    if (l >= 30 || (l >= 21 && l - r >= 2)) return 'left';
    if (r >= 30 || (r >= 21 && r - l >= 2)) return 'right';
    return null;
  }
}

/** The shuttle landed on `lastSide`, so the other side probably won the point. */
export const likelyWinner = (r: Rally): Side => (r.lastSide === 'left' ? 'right' : 'left');
