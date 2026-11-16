/**
 * Tips from body position at the moment of each hit.
 *
 * Uses Google's MediaPipe pose model, which runs on the phone (nothing is uploaded).
 * At each hit we take the player whose hand is nearest the shuttle and check a few
 * simple, well-known basics. These are friendly suggestions, not a judgement of anyone.
 */
import type { Hit, Side } from './rally';

export type Lm = { x: number; y: number; visibility?: number }; // 0-1 across the picture
export type Pose = Lm[]; // MediaPipe's 33 body points
export type PoseFrame = { t: number; poses: Pose[] };

// MediaPipe body point numbers
const NOSE = 0, L_SH = 11, R_SH = 12, L_EL = 13, R_EL = 14, L_WR = 15, R_WR = 16, L_HIP = 23, R_HIP = 24, L_KN = 25, R_KN = 26, L_AN = 27, R_AN = 28;

export type CheckKey = 'contact-high' | 'arm-straight' | 'other-arm' | 'knees-bent';

export const CHECKS: Record<CheckKey, { good: string; tip: string; when: string }> = {
  'contact-high': {
    good: 'Meeting overhead shots high, above your head',
    tip: 'Reach up and meet overhead shots above your head. Hitting it higher gives you a steeper, faster shot.',
    when: 'overhead shots',
  },
  'arm-straight': {
    good: 'Hitting arm nicely straight at contact',
    tip: 'Straighten your hitting arm as you hit overhead. A bent elbow at contact loses a lot of power.',
    when: 'overhead shots',
  },
  'other-arm': {
    good: 'Using the other arm for balance',
    tip: 'Lift your non-racket arm and point it at the shuttle before an overhead shot. It helps balance and timing.',
    when: 'overhead shots',
  },
  'knees-bent': {
    good: 'Getting low for the low shots',
    tip: 'Bend your knees and get low for shots below the waist, instead of bending at the back.',
    when: 'low shots',
  },
};

export type Tally = Record<CheckKey, { good: number; total: number }>;
export const emptyTally = (): Tally => ({
  'contact-high': { good: 0, total: 0 }, 'arm-straight': { good: 0, total: 0 },
  'other-arm': { good: 0, total: 0 }, 'knees-bent': { good: 0, total: 0 },
});

/** Angle at b (degrees) between a-b-c. */
function angle(a: Lm, b: Lm, c: Lm) {
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const cos = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}
const seen = (...l: Lm[]) => l.every((p) => p && (p.visibility ?? 1) > 0.5);

/**
 * Check the hitter's body at one hit. `sx`, `sy` are the shuttle position as 0-1 of the picture.
 * Returns which checks applied and whether each looked right, or null if no clear player.
 */
export function judgeHit(poses: Pose[], sx: number, sy: number): { side: 'L' | 'R'; results: Partial<Record<CheckKey, boolean>> } | null {
  // The hitter: whoever has a wrist nearest the shuttle.
  let best: { pose: Pose; right: boolean; d: number } | null = null;
  for (const pose of poses) {
    for (const right of [false, true]) {
      const w = pose[right ? R_WR : L_WR];
      if (!w) continue;
      const d = Math.hypot(w.x - sx, w.y - sy);
      if (!best || d < best.d) best = { pose, right, d };
    }
  }
  if (!best || best.d > 0.25) return null;
  const p = best.pose;
  const [sh, el, wr] = best.right ? [p[R_SH], p[R_EL], p[R_WR]] : [p[L_SH], p[L_EL], p[L_WR]];
  const [osh, owr] = best.right ? [p[L_SH], p[L_WR]] : [p[R_SH], p[R_WR]];
  const nose = p[NOSE];
  const results: Partial<Record<CheckKey, boolean>> = {};
  if (!seen(sh, el, wr, nose)) return null;

  const overhead = sy < nose.y; // shuttle above the head (y grows downward)
  const low = sy > (p[L_HIP].y + p[R_HIP].y) / 2;

  if (overhead) {
    results['contact-high'] = wr.y < nose.y;
    results['arm-straight'] = angle(sh, el, wr) >= 145;
    if (seen(osh, owr)) results['other-arm'] = owr.y < osh.y;
  } else if (low && seen(p[L_HIP], p[L_KN], p[L_AN], p[R_HIP], p[R_KN], p[R_AN])) {
    const knee = Math.min(angle(p[L_HIP], p[L_KN], p[L_AN]), angle(p[R_HIP], p[R_KN], p[R_AN]));
    results['knees-bent'] = knee < 155;
  }
  return Object.keys(results).length ? { side: best.right ? 'R' : 'L', results } : null;
}

/** Add one hit's results to a team's tally. */
export function addToTally(t: Tally, results: Partial<Record<CheckKey, boolean>>) {
  for (const [k, ok] of Object.entries(results) as [CheckKey, boolean][]) { t[k].total++; if (ok) t[k].good++; }
}

/** What went well and what to try, from a tally. Needs a few hits before saying anything. */
export function summarise(t: Tally) {
  const well: string[] = [], tips: string[] = [];
  for (const k of Object.keys(t) as CheckKey[]) {
    const { good, total } = t[k];
    if (total < 3) continue;
    const share = good / total;
    if (share >= 0.7) well.push(CHECKS[k].good);
    else if (share < 0.5) tips.push(`${CHECKS[k].tip} (looked right on ${good} of ${total} ${CHECKS[k].when})`);
  }
  return { well, tips };
}

/** Pose frame closest in time to a hit (within 0.2 s). */
export function poseAt(frames: PoseFrame[], hit: Hit): PoseFrame | null {
  let best: PoseFrame | null = null;
  for (const f of frames) if (Math.abs(f.t - hit.t) <= 0.2 && (!best || Math.abs(f.t - hit.t) < Math.abs(best.t - hit.t))) best = f;
  return best;
}

// ─── Loading the model (only when tips are switched on) ───────────────────────

type Landmarker = { detectForVideo(v: HTMLVideoElement, ms: number): { landmarks: Pose[] }; close(): void };

const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export async function loadPose(): Promise<Landmarker> {
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
  const files = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm');
  return PoseLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numPoses: 4,
  }) as unknown as Landmarker;
}

export type { Side };
