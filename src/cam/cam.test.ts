import { describe, expect, it } from 'vitest';
import { ShuttleTracker } from './tracker';
import { calibrate, likelyWinner, RallyEngine, Score, type Rally } from './rally';

const W = 320, H = 180, FPS = 60;

/** A dark court with a little noise, a big moving "player" and a small bright shuttle. */
function frame(shuttle: { x: number; y: number } | null, playerX: number, seed: number) {
  const g = new Uint8Array(W * H);
  let s = seed;
  for (let i = 0; i < g.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; g[i] = 40 + (s % 12); }
  // a white court line the player walks across (revealing it looks like a bright moving speck)
  for (let x = 10; x < W - 10; x++) g[150 * W + x] = 230;
  // player: 24x60 mid-grey block (moves, but far too big to be the shuttle) — covers the line
  for (let y = 100; y < 160; y++) for (let x = playerX; x < playerX + 24; x++) if (x >= 0 && x < W) g[y * W + x] = 110;
  if (shuttle) {
    const cx = Math.round(shuttle.x), cy = Math.round(shuttle.y);
    for (let y = cy - 1; y <= cy; y++) for (let x = cx - 1; x <= cx; x++) if (x >= 0 && x < W && y >= 0 && y < H) g[y * W + x] = 250;
  }
  return g;
}

/** Shuttle path: serve from the left, three exchanges, a smash down on the left side, then nothing. */
function rallyPath() {
  const path: ({ x: number; y: number } | null)[] = [];
  const leg = (x0: number, y0: number, x1: number, y1: number, frames: number) => {
    for (let i = 0; i < frames; i++) path.push({ x: x0 + ((x1 - x0) * i) / frames, y: y0 + ((y1 - y0) * i) / frames });
  };
  for (let i = 0; i < 80; i++) path.push(null); // before the serve (the tracker spends the first second learning the court)
  leg(40, 80, 270, 60, 50); // serve left → right
  leg(270, 60, 60, 50, 50); // clear back to the left
  leg(60, 50, 260, 70, 45); // to the right
  leg(260, 70, 70, 150, 12); // smash: fast and steep, lands on the left
  for (let i = 0; i < 120; i++) path.push(null); // 2 s of nothing: rally over
  return path;
}

function run(path: ({ x: number; y: number } | null)[]) {
  const tracker = new ShuttleTracker(W, H);
  const engine = new RallyEngine(W, { net: 0.5, pxPerM: calibrate(20, 300) });
  const ended: Rally[] = [];
  let seen = 0;
  path.forEach((p, i) => {
    const t = i / FPS;
    const pt = tracker.step(frame(p, 30 + Math.round(40 * Math.sin(i / 15)), i + 1), t);
    if (pt) seen++;
    for (const e of engine.feed(pt, t)) if (e.type === 'end') ended.push(e.rally);
  });
  for (const e of engine.flush()) if (e.type === 'end') ended.push(e.rally);
  return { ended, seen };
}

describe('shuttle tracker', () => {
  it('follows a small bright shuttle and ignores a moving player and the court line they uncover', () => {
    const path = rallyPath();
    const tracker = new ShuttleTracker(W, H);
    let hits = 0, near = 0;
    path.forEach((p, i) => {
      const pt = tracker.step(frame(p, 30 + Math.round(40 * Math.sin(i / 15)), i + 1), i / FPS);
      if (pt && p) { hits++; if (Math.hypot(pt.x - p.x, pt.y - p.y) < 3) near++; }
      if (pt && !p) throw new Error(`false sighting at frame ${i}`);
    });
    const shown = path.filter(Boolean).length;
    expect(hits).toBeGreaterThan(shown * 0.9);
    expect(near).toBe(hits);
  });
});

describe('rally engine', () => {
  it('counts the shots, spots the smash and ends the rally', () => {
    const { ended } = run(rallyPath());
    expect(ended).toHaveLength(1);
    const r = ended[0];
    expect(r.shots).toBe(4); // serve, clear, drive, smash
    expect(r.hits.map((h) => h.side)).toEqual(['left', 'right', 'left', 'right']);
    expect(r.lastSide).toBe('left');
    expect(likelyWinner(r)).toBe('right');
    // smash: ~200 px in 12 frames at 60 fps, 20.9 px/m → roughly 55-60 m/s ≈ 200 km/h
    expect(r.smashKmh).toBeGreaterThan(150);
    expect(r.smashKmh).toBeLessThan(260);
    expect(r.smashSide).toBe('right');
    expect(r.peakKmh).toBeGreaterThanOrEqual(r.smashKmh);
  });

  it('ignores a single stray speck', () => {
    const path: ({ x: number; y: number } | null)[] = Array(30).fill(null);
    path[10] = { x: 100, y: 40 };
    expect(run(path).ended).toHaveLength(0);
  });
});

describe('score keeper', () => {
  it('plays to 21, win by two, capped at 30', () => {
    const s = new Score();
    for (let i = 0; i < 20; i++) { s.point('left'); s.point('right'); }
    expect(s.winner).toBeNull();
    s.point('left');
    expect(s.winner).toBeNull(); // 21-20
    s.point('left');
    expect(s.winner).toBe('left'); // 22-20
    s.undo(); s.undo();
    for (let i = 0; i < 9; i++) { s.point('left'); s.point('right'); }
    s.point('right');
    expect([s.left, s.right]).toEqual([29, 30]);
    expect(s.winner).toBe('right');
  });
});

import { addToTally, emptyTally, judgeHit, summarise, type Lm } from './tips';

/** A standing player (right-handed) at horizontal position cx; arm can be straight up or bent. */
function body(cx: number, armUp: 'straight' | 'bent' | 'low', otherArmUp: boolean, kneesBent = false): Lm[] {
  const p: Lm[] = Array.from({ length: 33 }, () => ({ x: cx, y: 0.5, visibility: 1 }));
  p[0] = { x: cx, y: 0.30 }; // nose
  p[11] = { x: cx - 0.04, y: 0.38 }; p[12] = { x: cx + 0.04, y: 0.38 }; // shoulders
  p[23] = { x: cx - 0.03, y: 0.58 }; p[24] = { x: cx + 0.03, y: 0.58 }; // hips
  p[25] = { x: cx - (kneesBent ? 0.09 : 0.03), y: 0.72 }; p[26] = { x: cx + (kneesBent ? 0.09 : 0.03), y: 0.72 }; // knees
  p[27] = { x: cx - 0.03, y: 0.86 }; p[28] = { x: cx + 0.03, y: 0.86 }; // ankles
  if (armUp === 'straight') { p[14] = { x: cx + 0.05, y: 0.28 }; p[16] = { x: cx + 0.06, y: 0.18 }; }
  else if (armUp === 'bent') { p[14] = { x: cx + 0.10, y: 0.34 }; p[16] = { x: cx + 0.06, y: 0.33 }; }
  else { p[14] = { x: cx + 0.06, y: 0.50 }; p[16] = { x: cx + 0.08, y: 0.62 }; }
  p[13] = { x: cx - 0.06, y: otherArmUp ? 0.30 : 0.48 }; p[15] = { x: cx - 0.07, y: otherArmUp ? 0.22 : 0.56 };
  return p;
}

describe('tips', () => {
  it('praises a high, straight-arm overhead and flags a bent, low one', () => {
    const good = judgeHit([body(0.3, 'straight', true)], 0.36, 0.16)!;
    expect(good.results).toEqual({ 'contact-high': true, 'arm-straight': true, 'other-arm': true });
    const bad = judgeHit([body(0.3, 'bent', false)], 0.36, 0.28)!;
    expect(bad.results).toEqual({ 'contact-high': false, 'arm-straight': false, 'other-arm': false });
  });

  it('picks the player whose hand is nearest the shuttle', () => {
    const j = judgeHit([body(0.2, 'low', false), body(0.7, 'straight', true)], 0.76, 0.16)!;
    expect(j.results['arm-straight']).toBe(true);
  });

  it('checks knee bend on low shots', () => {
    expect(judgeHit([body(0.5, 'low', false, true)], 0.58, 0.64)!.results).toEqual({ 'knees-bent': true });
    expect(judgeHit([body(0.5, 'low', false, false)], 0.58, 0.64)!.results).toEqual({ 'knees-bent': false });
  });

  it('only gives advice after a few hits', () => {
    const t = emptyTally();
    addToTally(t, { 'arm-straight': false });
    addToTally(t, { 'arm-straight': false });
    expect(summarise(t).tips).toHaveLength(0);
    addToTally(t, { 'arm-straight': false });
    addToTally(t, { 'contact-high': true }); addToTally(t, { 'contact-high': true }); addToTally(t, { 'contact-high': true });
    const s = summarise(t);
    expect(s.tips[0]).toMatch(/Straighten your hitting arm/);
    expect(s.well).toEqual(['Meeting overhead shots high, above your head']);
  });
});
