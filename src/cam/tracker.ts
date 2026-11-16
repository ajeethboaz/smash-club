/**
 * Shuttle tracker: finds the shuttlecock in a stream of small greyscale frames.
 *
 * The shuttle is small, bright (white) and fast, so we look for small bright blobs
 * that moved since the last frame. Players also move, but they make big blobs, so
 * we drop anything too large. When several small blobs remain we pick the one
 * nearest to where the shuttle should be, given its last position and speed.
 * Everything runs on-device; frames never leave the phone.
 */

export type Pt = { x: number; y: number; t: number }; // pixels in the processing frame, t in seconds

export type TrackerOptions = {
  /** How much brighter than last frame a pixel must be to count as moving (0-255). */
  diff: number;
  /** Minimum brightness for the shuttle (0-255). */
  bright: number;
  /** Largest blob, as a share of the frame, that can still be the shuttle. */
  maxArea: number;
  /** If this many blobs show up at once the camera probably moved: ignore the frame. */
  maxBlobs: number;
};

export const DEFAULT_TRACKER: TrackerOptions = { diff: 28, bright: 150, maxArea: 0.0025, maxBlobs: 60 };

type Blob = { x: number; y: number; area: number; w: number; h: number; lum: number };

export class ShuttleTracker {
  readonly w: number;
  readonly h: number;
  private prev: Uint8Array | null = null;
  private mask: Uint8Array;
  private stack: Int32Array;
  private hist: Pt[] = [];
  private t0: number | null = null; // first frame time: spend a second learning the court first
  /** How often each pixel has been bright lately (0-1). Court lines and lights score high; the shuttle never stays. */
  private staticBright: Float32Array;
  opts: TrackerOptions;

  constructor(w: number, h: number, opts: Partial<TrackerOptions> = {}) {
    this.w = w; this.h = h;
    this.mask = new Uint8Array(w * h);
    this.stack = new Int32Array(w * h);
    this.staticBright = new Float32Array(w * h);
    this.opts = { ...DEFAULT_TRACKER, ...opts };
  }

  reset() { this.prev = null; this.hist = []; this.t0 = null; this.staticBright.fill(0); }

  /** The last few positions (newest last). */
  get history(): readonly Pt[] { return this.hist; }

  /** Feed one greyscale frame (w*h bytes). Returns the shuttle position, or null if not seen. */
  step(gray: Uint8Array, t: number): Pt | null {
    const { w, h, mask } = this;
    const prev = this.prev;
    this.prev = gray.slice();
    const { diff, bright } = this.opts;
    const sb = this.staticBright;
    if (!prev) {
      for (let i = 0; i < w * h; i++) sb[i] = gray[i] >= bright ? 1 : 0;
      return null;
    }

    let moving = 0;
    for (let i = 0; i < w * h; i++) {
      const isBright = gray[i] >= bright;
      // Remember what's usually bright (slowly forgets: ~2 s to fade)
      sb[i] = sb[i] * 0.99 + (isBright ? 0.01 : 0);
      const on = isBright && gray[i] - prev[i] >= diff && sb[i] < 0.12 ? 1 : 0;
      mask[i] = on;
      moving += on;
    }
    if (this.t0 === null) this.t0 = t;
    if (t - this.t0 < 1) return null; // still learning where the lines are
    if (moving === 0) return this.miss(t);
    // Whole-frame change (camera bumped, lights flicker): skip.
    if (moving > w * h * 0.08) return this.miss(t);

    const blobs = this.blobs(gray, prev);
    if (blobs.length === 0 || blobs.length > this.opts.maxBlobs) return this.miss(t);

    const pick = this.choose(blobs, t);
    if (!pick) return this.miss(t);
    const p = { x: pick.x, y: pick.y, t };
    this.hist.push(p);
    if (this.hist.length > 8) this.hist.shift();
    return p;
  }

  private miss(t: number) {
    // Forget the track after a short gap so a new rally starts clean.
    const last = this.hist[this.hist.length - 1];
    if (last && t - last.t > 0.5) this.hist = [];
    return null;
  }

  /** Connected bright-moving regions small enough to be a shuttle. */
  private blobs(gray: Uint8Array, prev: Uint8Array): Blob[] {
    const { w, h, mask, stack } = this;
    const maxArea = Math.max(4, Math.round(this.opts.maxArea * w * h));
    const out: Blob[] = [];
    for (let start = 0; start < w * h; start++) {
      if (mask[start] !== 1) continue;
      let sp = 0, area = 0, sx = 0, sy = 0, lum = 0;
      let minX = w, maxX = 0, minY = h, maxY = 0;
      stack[sp++] = start; mask[start] = 2;
      while (sp > 0) {
        const i = stack[--sp];
        const x = i % w, y = (i / w) | 0;
        area++; sx += x; sy += y; lum += gray[i];
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
        // 8-neighbourhood so a motion-blurred streak stays one blob
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= w) continue;
            const j = yy * w + xx;
            if (mask[j] === 1) { mask[j] = 2; stack[sp++] = j; }
          }
        }
      }
      if (area > maxArea) continue; // a player, a racket swing, not the shuttle
      const bw = maxX - minX + 1, bh = maxY - minY + 1;
      if (Math.max(bw, bh) > 10 * Math.max(1, Math.min(bw, bh)) && area > 6) continue; // long thin line: a racket shaft
      // The shuttle flies on its own. A bright speck glued to something big that's moving
      // (a player walking over a court line, a swinging arm) isn't it.
      // Also skip specks right next to something that's always bright: the rest of a court line
      // showing up again as a player walks off it.
      let around = 0, lineNear = false;
      const pad = 3, d = this.opts.diff, sb = this.staticBright;
      for (let y = Math.max(0, minY - pad); y <= Math.min(h - 1, maxY + pad); y++)
        for (let x = Math.max(0, minX - pad); x <= Math.min(w - 1, maxX + pad); x++) {
          const i = y * w + x;
          if (mask[i] !== 2 && Math.abs(gray[i] - prev[i]) >= d) around++;
          if (sb[i] > 0.5) lineNear = true;
        }
      if (around > area * 2 + 4 || lineNear) continue;
      out.push({ x: sx / area, y: sy / area, area, w: bw, h: bh, lum: lum / area });
    }
    return out;
  }

  /** The blob most likely to be the shuttle. */
  private choose(blobs: Blob[], t: number): Blob | null {
    const hist = this.hist;
    const last = hist[hist.length - 1];
    if (last && t - last.t < 0.4) {
      // Predict from the last two points; accept the nearest blob within a sensible jump.
      const before = hist[hist.length - 2];
      const dt = t - last.t;
      let px = last.x, py = last.y;
      if (before && last.t > before.t) {
        const vx = (last.x - before.x) / (last.t - before.t), vy = (last.y - before.y) / (last.t - before.t);
        px += vx * dt; py += vy * dt;
      }
      const reach = Math.max(this.w, this.h) * Math.min(0.6, 0.15 + dt * 2);
      let best: Blob | null = null, bestD = Infinity;
      for (const b of blobs) {
        const d = Math.hypot(b.x - px, b.y - py);
        if (d < bestD && d <= reach) { best = b; bestD = d; }
      }
      if (best) return best;
    }
    // No track yet: the brightest compact blob.
    let best: Blob | null = null;
    for (const b of blobs) if (!best || b.lum * Math.min(b.area, 9) > best.lum * Math.min(best.area, 9)) best = b;
    return best;
  }
}

/** Downscale an RGBA frame to greyscale (w*h) — cheap enough to run every frame on a phone. */
export function toGray(rgba: Uint8ClampedArray, out?: Uint8Array): Uint8Array {
  const n = rgba.length / 4;
  const g = out ?? new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return g;
}
