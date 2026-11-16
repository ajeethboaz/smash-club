import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShuttleTracker, toGray, type Pt } from '../cam/tracker';
import { calibrate, likelyWinner, RallyEngine, Score, type Rally, type Side } from '../cam/rally';
import { addToTally, emptyTally, judgeHit, loadPose, poseAt, summarise, type PoseFrame, type Tally } from '../cam/tips';
import { Icon } from '../ui';

/**
 * Court Cam (beta): film the court from the side and the phone works out rallies, shot counts,
 * smash speeds and the score, keeps the best rallies as clips, and gives tips from body position.
 * Everything is worked out on the phone. Nothing is uploaded.
 */

type Phase = 'start' | 'setup' | 'live' | 'summary';
type Marks = { left: number; net: number; right: number }; // 0-1 across the picture
type Clip = { rally: Rally; url?: string; blob?: Blob; at?: number }; // live: a recorded clip; video: a time to jump to

const PROC_W = 320; // frames are shrunk to this width before looking for the shuttle
const MARKS_KEY = 'smash-club:cam-marks';
const loadMarks = (): Marks => { try { return JSON.parse(localStorage.getItem(MARKS_KEY) ?? '') as Marks; } catch { return { left: 0.06, net: 0.5, right: 0.94 }; } };
const sideName = (s: Side) => (s === 'left' ? 'Left' : 'Right');

export default function CourtCam() {
  const nav = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<Phase>('start');
  const [source, setSource] = useState<'camera' | 'file'>('camera');
  const [slowmo, setSlowmo] = useState(1); // a slow-motion video plays this many times slower than real life
  const [wantTips, setWantTips] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marks, setMarks] = useState<Marks>(loadMarks);
  const [step, setStep] = useState<keyof Marks>('left');

  // live numbers
  const [shots, setShots] = useState(0);
  const [inRally, setInRally] = useState(false);
  const [rallies, setRallies] = useState<Rally[]>([]);
  const [score, setScore] = useState({ left: 0, right: 0, winner: null as Side | null, points: 0 });
  const [lastCall, setLastCall] = useState<{ side: Side; rally: Rally } | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [tally, setTally] = useState<{ left: Tally; right: Tally }>({ left: emptyTally(), right: emptyTally() });
  const [tipsState, setTipsState] = useState<'off' | 'loading' | 'on' | 'failed'>('off');
  const [mySide, setMySide] = useState<Side | null>(null);

  // the engine bits live in refs so the frame loop doesn't re-render
  const run = useRef<{
    stop: () => void; score: Score; engine: RallyEngine | null; tracker: ShuttleTracker | null;
    trail: Pt[]; poses: PoseFrame[]; stream: MediaStream | null; recorder: MediaRecorder | null; segStart: number; chunks: Blob[];
  }>({ stop: () => {}, score: new Score(), engine: null, tracker: null, trail: [], poses: [], stream: null, recorder: null, segStart: 0, chunks: [] });

  useEffect(() => () => { run.current.stop(); run.current.stream?.getTracks().forEach((t) => t.stop()); }, []);

  // ── 1. Get pictures: camera or a video file ──
  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
      });
      run.current.stream = stream;
      const v = videoRef.current!;
      v.srcObject = stream; v.muted = true;
      await v.play();
      setSource('camera'); setPhase('setup'); setStep('left');
    } catch {
      setError("Couldn't open the camera. Allow camera access for this site in your browser settings and try again.");
    }
  };
  const openFile = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    const v = videoRef.current!;
    v.srcObject = null; v.src = URL.createObjectURL(f); v.muted = true;
    await new Promise((ok) => { v.onloadeddata = ok; });
    v.currentTime = 0;
    setSource('file'); setPhase('setup'); setStep('left');
  };

  // ── 2. Setup: tap left back line, net, right back line ──
  const tapSetup = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const next = { ...marks, [step]: x };
    setMarks(next);
    setStep(step === 'left' ? 'net' : step === 'net' ? 'right' : 'right');
  };
  const marksOk = marks.left < marks.net && marks.net < marks.right && marks.right - marks.left > 0.3;

  // ── 3. Live: the frame loop ──
  const go = async () => {
    try { localStorage.setItem(MARKS_KEY, JSON.stringify(marks)); } catch { /* private mode */ }
    const v = videoRef.current!;
    const ph = Math.round((PROC_W * v.videoHeight) / v.videoWidth) || 180;
    const R = run.current;
    R.tracker = new ShuttleTracker(PROC_W, ph);
    R.engine = new RallyEngine(PROC_W, { net: marks.net, pxPerM: calibrate(marks.left * PROC_W, marks.right * PROC_W) });
    R.score = new Score(); R.trail = []; R.poses = [];
    setShots(0); setRallies([]); setClips([]); setLastCall(null); setScore({ left: 0, right: 0, winner: null, points: 0 });
    setTally({ left: emptyTally(), right: emptyTally() });
    setPhase('live');

    // Tips model (downloads once, ~5 MB)
    let pose: Awaited<ReturnType<typeof loadPose>> | null = null;
    if (wantTips) {
      setTipsState('loading');
      loadPose().then((p) => { pose = p; setTipsState('on'); }).catch(() => setTipsState('failed'));
    }

    // Keep the screen awake while filming
    let lock: { release(): Promise<void> } | null = null;
    try { lock = await (navigator as Navigator & { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen') ?? null; } catch { /* not supported */ }

    // Clips (camera only): record in short pieces; a piece that holds a rally is kept.
    const recordable = source === 'camera' && typeof MediaRecorder !== 'undefined' && R.stream;
    const mime = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m));
    const newSegment = () => {
      if (!recordable) return;
      R.chunks = [];
      const rec = new MediaRecorder(R.stream!, mime ? { mimeType: mime, videoBitsPerSecond: 2_500_000 } : undefined);
      rec.ondataavailable = (e) => { if (e.data.size) R.chunks.push(e.data); };
      rec.start(500);
      R.recorder = rec; R.segStart = performance.now();
    };
    const endSegment = (keep: Rally | null) => {
      const rec = R.recorder; if (!rec) return;
      const chunks = R.chunks;
      rec.onstop = () => {
        if (!keep) return;
        const blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' });
        setClips((cs) => {
          const all = [...cs, { rally: keep, blob, url: URL.createObjectURL(blob) }]
            .sort((a, b) => b.rally.shots - a.rally.shots || b.rally.smashKmh - a.rally.smashKmh);
          all.slice(3).forEach((c) => c.url && URL.revokeObjectURL(c.url));
          return all.slice(0, 3);
        });
      };
      if (rec.state !== 'inactive') rec.stop();
      R.recorder = null;
    };
    newSegment();

    const canvas = document.createElement('canvas');
    canvas.width = PROC_W; canvas.height = ph;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const gray = new Uint8Array(PROC_W * ph);
    let stopped = false, frameNo = 0;
    const t0 = performance.now();

    const handle = (now: number, mediaTime?: number) => {
      if (stopped) return;
      // Real-life seconds: for a slow-motion file, video time runs `slowmo` times too slow.
      const t = source === 'file' ? (mediaTime ?? v.currentTime) / slowmo : (now - t0) / 1000;
      ctx.drawImage(v, 0, 0, PROC_W, ph);
      const p = R.tracker!.step(toGray(ctx.getImageData(0, 0, PROC_W, ph).data, gray), t);

      // Body positions for tips: every 3rd frame is plenty
      if (pose && frameNo++ % 3 === 0) {
        try {
          const res = pose.detectForVideo(v, performance.now());
          R.poses.push({ t, poses: res.landmarks });
          while (R.poses.length && t - R.poses[0].t > 2) R.poses.shift();
        } catch { /* skip a frame */ }
      }

      if (p) { R.trail.push(p); if (R.trail.length > 12) R.trail.shift(); }
      for (const ev of R.engine!.feed(p, t)) {
        if (ev.type === 'start') { setInRally(true); setShots(1); }
        if (ev.type === 'hit') {
          setShots(ev.shots);
          const f = poseAt(R.poses, ev.hit);
          if (f) {
            const j = judgeHit(f.poses, ev.hit.x / PROC_W, ev.hit.y / ph);
            if (j) setTally((tl) => { const next = { left: { ...tl.left }, right: { ...tl.right } }; addToTally(next[ev.hit.side], j.results); return next; });
          }
        }
        if (ev.type === 'end') {
          const r = ev.rally;
          setInRally(false);
          if (r.shots >= 2 || r.end - r.start > 1.5) {
            setRallies((rs) => [...rs, r]);
            const win = likelyWinner(r);
            R.score.point(win);
            setScore({ left: R.score.left, right: R.score.right, winner: R.score.winner, points: R.score.points });
            setLastCall({ side: win, rally: r });
            if (source === 'file') setClips((cs) => [...cs, { rally: r, at: r.start * slowmo }].sort((a, b) => b.rally.shots - a.rally.shots).slice(0, 3));
            endSegment(r); newSegment();
          }
        }
      }
      // While nobody's playing, keep restarting the recording so a clip starts just before the serve.
      if (recordable && !R.engine!.active && performance.now() - R.segStart > 4000) { endSegment(null); newSegment(); }
      drawOverlay();
      next();
    };
    type VFC = HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number };
    const next = () => {
      const vv = v as VFC;
      if (vv.requestVideoFrameCallback) vv.requestVideoFrameCallback((now, meta) => handle(now, meta.mediaTime));
      else requestAnimationFrame((now) => handle(now));
    };
    const finish = () => {
      if (stopped) return;
      stopped = true;
      for (const ev of R.engine!.flush()) if (ev.type === 'end') setRallies((rs) => [...rs, ev.rally]);
      endSegment(null);
      lock?.release().catch(() => {});
      pose?.close();
      setPhase('summary');
    };
    R.stop = finish;
    if (source === 'file') { v.onended = finish; v.currentTime = 0; await v.play(); }
    next();
  };

  const drawOverlay = () => {
    const c = overlayRef.current, v = videoRef.current;
    if (!c || !v) return;
    const R = run.current;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(200,240,75,.8)'; g.lineWidth = 2; g.setLineDash([6, 6]);
    g.beginPath(); g.moveTo(marks.net * w, 0); g.lineTo(marks.net * w, h); g.stroke(); g.setLineDash([]);
    const ph = R.tracker?.h ?? 180;
    R.trail.forEach((p, i) => {
      g.fillStyle = `rgba(242,194,48,${(i + 1) / R.trail.length})`;
      g.beginPath(); g.arc((p.x / PROC_W) * w, (p.y / ph) * h, 3 + i * 0.4, 0, Math.PI * 2); g.fill();
    });
  };

  const fix = (action: 'undo' | 'swap') => {
    const R = run.current;
    if (!lastCall) return;
    R.score.undo();
    if (action === 'swap') R.score.point(lastCall.side === 'left' ? 'right' : 'left');
    setScore({ left: R.score.left, right: R.score.right, winner: R.score.winner, points: R.score.points });
    setLastCall(action === 'swap' ? { ...lastCall, side: lastCall.side === 'left' ? 'right' : 'left' } : null);
  };
  const manualPoint = (s: Side) => {
    const R = run.current; R.score.point(s);
    setScore({ left: R.score.left, right: R.score.right, winner: R.score.winner, points: R.score.points });
    setLastCall(null);
  };

  // ── Numbers for the summary ──
  const longest = rallies.reduce<Rally | null>((b, r) => (!b || r.shots > b.shots ? r : b), null);
  const fastest = rallies.reduce<Rally | null>((b, r) => (r.smashKmh && (!b || r.smashKmh > b.smashKmh) ? r : b), null);
  const tipsFor = (s: Side) => summarise(tally[s]);
  const share = async (c: Clip) => {
    if (!c.blob) return;
    const ext = c.blob.type.includes('mp4') ? 'mp4' : 'webm';
    const file = new File([c.blob], `smash-club-rally-${c.rally.shots}-shots.${ext}`, { type: c.blob.type });
    const nav2 = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    if (nav2.canShare?.({ files: [file] })) await navigator.share({ files: [file], text: `${c.rally.shots}-shot rally at Smash Club 🏸` }).catch(() => {});
    else { const a = document.createElement('a'); a.href = c.url!; a.download = file.name; a.click(); }
  };
  const summaryText = () => [
    `🏸 *Smash Club · Court Cam*`,
    `Score: Left ${score.left} – ${score.right} Right`,
    `${rallies.length} rallies${longest ? ` · longest ${longest.shots} shots` : ''}`,
    fastest ? `💥 Fastest smash: ${fastest.smashKmh} km/h (${sideName(fastest.smashSide ?? 'left')} side)` : '',
  ].filter(Boolean).join('\n');

  const dark = { background: '#0B1A12', color: '#fff', minHeight: '100dvh' } as const;

  return (
    <div style={phase === 'start' || phase === 'summary' ? undefined : dark} className={phase === 'start' || phase === 'summary' ? 'screen' : undefined}>
      {/* the video stays mounted the whole time; it's only visible during setup and live */}
      <div style={{ position: 'relative', display: phase === 'setup' || phase === 'live' ? 'block' : 'none', background: '#000' }}>
        <video ref={videoRef} playsInline muted style={{ width: '100%', maxHeight: '70dvh', display: 'block', objectFit: 'contain' }} />
        <canvas ref={overlayRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
        {phase === 'setup' && (
          <div onPointerDown={tapSetup} style={{ position: 'absolute', inset: 0, cursor: 'crosshair' }} aria-label="Tap to mark the court">
            {(['left', 'net', 'right'] as const).map((k) => (
              <div key={k} style={{ position: 'absolute', top: 0, bottom: 0, left: `${marks[k] * 100}%`, width: 0, borderLeft: `3px ${k === 'net' ? 'dashed' : 'solid'} ${step === k ? '#F2C230' : '#C8F04B'}` }}>
                <span style={{ position: 'absolute', top: 8, left: 6, fontSize: 12, fontWeight: 700, background: 'rgba(0,0,0,.6)', padding: '2px 6px', borderRadius: 6, whiteSpace: 'nowrap' }}>
                  {k === 'left' ? 'Left back line' : k === 'net' ? 'Net' : 'Right back line'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {phase === 'start' && (
        <>
          <header className="between">
            <Link to="/" className="round-btn" aria-label="Back"><Icon name="back" size={20} width={2.4} /></Link>
            <span className="tag" style={{ background: 'var(--lime)', color: 'var(--ink)', padding: '4px 10px', borderRadius: 10 }}>Beta</span>
          </header>
          <div className="stack" style={{ gap: 6 }}>
            <h1 className="h1">Court Cam</h1>
            <p className="small muted" style={{ margin: 0 }}>Film a game from the side of the court. Your phone counts rallies, measures smash speed, keeps score, saves the best rallies and gives tips. Nothing is uploaded.</p>
          </div>
          <section className="panel" style={{ padding: '4px 16px' }}>
            {[
              ['Rally counter', 'Shots in every rally, and the longest one'],
              ['Smash speed', 'How fast each smash goes, in km/h'],
              ['Score keeper', 'Guesses who won each point; one tap to fix it'],
              ['Rally highlights', 'Keeps the 3 best rallies as clips to share'],
              ['Tips', 'Simple things to try, from body position at each hit'],
            ].map(([a, b]) => (
              <div key={a} className="prow" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}><b>{a}</b><span className="small muted">{b}</span></div>
            ))}
          </section>
          <section className="card" style={{ gap: 8 }}>
            <b>Before you start</b>
            <span className="small muted">Stand the phone sideways on something steady at the side of the court, level with the net, so you can see both back lines. Good lighting helps a lot.</span>
            <label className="between" style={{ paddingTop: 4 }}>
              <span className="small"><b>Tips</b> <span className="muted">· downloads a 5 MB body-position model once</span></span>
              <button className="switch" role="switch" aria-checked={wantTips} onClick={() => setWantTips((x) => !x)}><span /></button>
            </label>
          </section>
          {error && <p className="small" style={{ color: 'var(--warn)', margin: 0 }}>{error}</p>}
          <div className="stack" style={{ gap: 10 }}>
            <button className="save-btn" onClick={startCamera}>Use the camera</button>
            <label className="btn btn-ghost" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              Analyse a video you filmed
              <input type="file" accept="video/*" style={{ display: 'none' }} onChange={(e) => void openFile(e.target.files?.[0])} />
            </label>
          </div>
        </>
      )}

      {phase === 'setup' && (
        <div className="stack" style={{ gap: 14, padding: 18 }}>
          <b style={{ fontSize: 18 }}>
            {step === 'left' ? '1. Tap the left back line' : step === 'net' ? '2. Tap the net' : '3. Tap the right back line'}
          </b>
          <span className="small" style={{ color: '#B9CCBF' }}>This tells the app where each half is, and how big the court is so speeds come out in km/h. Tap again to adjust.</span>
          <div className="row" style={{ gap: 8 }}>
            {(['left', 'net', 'right'] as const).map((k) => (
              <button key={k} className="chip-btn" aria-pressed={step === k} onClick={() => setStep(k)} style={step === k ? { background: '#F2C230', color: '#0F1F17' } : undefined}>
                {k === 'left' ? 'Left line' : k === 'net' ? 'Net' : 'Right line'}
              </button>
            ))}
          </div>
          {source === 'file' && (
            <label className="stack" style={{ gap: 6 }}>
              <span className="small" style={{ color: '#B9CCBF' }}>Is this a slow-motion video?</span>
              <select className="date-chip" value={slowmo} onChange={(e) => setSlowmo(Number(e.target.value))} style={{ width: '100%' }}>
                <option value={1}>No, normal speed</option>
                <option value={4}>Slow-mo 120 fps (4× slower)</option>
                <option value={8}>Slow-mo 240 fps (8× slower)</option>
              </select>
            </label>
          )}
          {!marksOk && <span className="small" style={{ color: '#F2C230' }}>The net should sit between the two back lines.</span>}
          <button className="save-btn" style={{ background: 'var(--lime)', color: 'var(--ink)' }} disabled={!marksOk} onClick={() => void go()}>Start</button>
        </div>
      )}

      {phase === 'live' && (
        <div className="stack" style={{ gap: 14, padding: 16 }}>
          <div className="between">
            <span className="stack" style={{ alignItems: 'center', gap: 0, width: 90 }}>
              <span className="tiny" style={{ color: '#B9CCBF' }}>LEFT</span>
              <span className="num" style={{ fontSize: 44 }}>{score.left}</span>
            </span>
            <span className="stack" style={{ alignItems: 'center', gap: 2 }}>
              <span className="tiny" style={{ color: inRally ? '#C8F04B' : '#B9CCBF', fontWeight: 700 }}>{inRally ? 'RALLY ON' : 'WAITING FOR SERVE'}</span>
              <span className="num" style={{ fontSize: 22, color: '#C8F04B' }}>{inRally ? `${shots} shot${shots === 1 ? '' : 's'}` : `${rallies.length} rallies`}</span>
            </span>
            <span className="stack" style={{ alignItems: 'center', gap: 0, width: 90 }}>
              <span className="tiny" style={{ color: '#B9CCBF' }}>RIGHT</span>
              <span className="num" style={{ fontSize: 44 }}>{score.right}</span>
            </span>
          </div>
          {score.winner && <div className="row btn" style={{ background: '#C8F04B', color: '#0F1F17', justifyContent: 'center' }}>{sideName(score.winner)} side wins the game!</div>}
          {lastCall ? (
            <div className="stack" style={{ gap: 8, padding: 12, borderRadius: 16, background: 'rgba(255,255,255,.08)' }}>
              <span>Point to <b>{sideName(lastCall.side)}</b> · {lastCall.rally.shots} shots{lastCall.rally.smashKmh ? ` · smash ${lastCall.rally.smashKmh} km/h` : ''}</span>
              <div className="grid2">
                <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,.12)', color: '#fff' }} onClick={() => fix('swap')}>Wrong side</button>
                <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,.12)', color: '#fff' }} onClick={() => fix('undo')}>Not a point</button>
              </div>
            </div>
          ) : (
            <div className="grid2">
              <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,.12)', color: '#fff' }} onClick={() => manualPoint('left')}>+1 Left</button>
              <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,.12)', color: '#fff' }} onClick={() => manualPoint('right')}>+1 Right</button>
            </div>
          )}
          <div className="grid2">
            <div className="stack" style={{ gap: 2, padding: 12, borderRadius: 16, background: 'rgba(255,255,255,.06)' }}>
              <span className="tiny" style={{ color: '#B9CCBF' }}>Longest rally</span><b style={{ fontSize: 20 }}>{longest ? `${longest.shots} shots` : '–'}</b>
            </div>
            <div className="stack" style={{ gap: 2, padding: 12, borderRadius: 16, background: 'rgba(255,255,255,.06)' }}>
              <span className="tiny" style={{ color: '#B9CCBF' }}>Fastest smash</span><b style={{ fontSize: 20 }}>{fastest ? `${fastest.smashKmh} km/h` : '–'}</b>
            </div>
          </div>
          <span className="tiny" style={{ color: '#B9CCBF', textAlign: 'center' }}>
            {tipsState === 'loading' ? 'Loading tips…' : tipsState === 'on' ? 'Tips: watching body position' : tipsState === 'failed' ? "Tips couldn't load on this phone" : ''}
          </span>
          <button className="save-btn" style={{ background: '#fff', color: 'var(--ink)' }} onClick={() => run.current.stop()}>Stop & see summary</button>
        </div>
      )}

      {phase === 'summary' && (
        <>
          <header className="between">
            <Link to="/" className="round-btn" aria-label="Home"><Icon name="back" size={20} width={2.4} /></Link>
            <h1 className="h2" style={{ fontSize: 22 }}>Court Cam summary</h1>
            <span style={{ width: 44 }} />
          </header>

          <section className="card" style={{ alignItems: 'center', gap: 4 }}>
            <span className="small muted">Score</span>
            <span className="num" style={{ fontSize: 44 }}>{score.left} – {score.right}</span>
            <span className="small muted">Left · Right · {rallies.length} rallies</span>
          </section>

          <section className="grid2">
            <div className="stat"><b>{longest ? longest.shots : '–'}</b><span>Longest rally (shots)</span></div>
            <div className="stat"><b style={{ color: 'var(--lime-text)' }}>{fastest ? fastest.smashKmh : '–'}</b><span>Fastest smash (km/h){fastest?.smashSide ? ` · ${sideName(fastest.smashSide)}` : ''}</span></div>
          </section>

          {clips.length > 0 && (
            <section className="stack" style={{ gap: 10 }}>
              <span className="section-label">Best rallies</span>
              {clips.map((c, i) => (
                <div key={i} className="panel" style={{ padding: 12, gap: 10 }}>
                  {c.url && <video src={c.url} controls playsInline style={{ width: '100%', borderRadius: 12 }} />}
                  <div className="between">
                    <span><b>{c.rally.shots} shots</b>{c.rally.smashKmh ? <span className="muted"> · smash {c.rally.smashKmh} km/h</span> : null}</span>
                    {c.blob ? <button className="btn btn-green btn-sm" onClick={() => void share(c)}>Share</button>
                      : c.at != null && <span className="small muted">at {Math.floor(c.at / 60)}:{String(Math.floor(c.at % 60)).padStart(2, '0')} in your video</span>}
                  </div>
                </div>
              ))}
            </section>
          )}

          {(['left', 'right'] as const).map((s) => {
            const { well, tips } = tipsFor(s);
            if (!well.length && !tips.length) return null;
            return (
              <section key={s} className="panel" style={{ padding: '6px 16px 12px' }}>
                <span className="prow" style={{ paddingBottom: 6 }}><b>Tips · {sideName(s)} side</b></span>
                {well.map((w) => <span key={w} className="small" style={{ display: 'block', padding: '4px 0' }}>✓ {w}</span>)}
                {tips.map((t) => <span key={t} className="small" style={{ display: 'block', padding: '6px 0', color: 'var(--ink)' }}>→ {t}</span>)}
              </section>
            );
          })}
          {tipsState === 'on' && !(['left', 'right'] as const).some((s) => { const x = tipsFor(s); return x.well.length || x.tips.length; }) && (
            <p className="small muted" style={{ margin: 0 }}>Not enough clear hits for tips yet. Film a longer game with the players fully in view.</p>
          )}

          <section className="card" style={{ gap: 10 }}>
            <b>Log this game?</b>
            <span className="small muted">Which side were you on?</span>
            <div className="grid2">
              <button className="chip-btn" aria-pressed={mySide === 'left'} onClick={() => setMySide('left')}>Left</button>
              <button className="chip-btn" aria-pressed={mySide === 'right'} onClick={() => setMySide('right')}>Right</button>
            </div>
            <button className="btn btn-green" disabled={!mySide || score.left === score.right}
              onClick={() => { const us = mySide === 'left' ? score.left : score.right, them = mySide === 'left' ? score.right : score.left; nav('/win', { state: { us, them } }); }}>
              Log it with this score
            </button>
          </section>
          <div className="grid2">
            <a className="btn btn-ghost" href={`https://wa.me/?text=${encodeURIComponent(summaryText())}`} target="_blank" rel="noreferrer" style={{ textAlign: 'center', textDecoration: 'none' }}>Share on WhatsApp</a>
            <button className="btn btn-ghost" onClick={() => { setPhase('start'); run.current.stream?.getTracks().forEach((t) => t.stop()); run.current.stream = null; }}>New session</button>
          </div>
        </>
      )}
    </div>
  );
}
