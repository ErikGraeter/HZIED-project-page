// Part 2 — from (mass, radius) to normalized density versus absorbed flux.
// One canvas, five steps morphing smoothly into each other:
//   0  P5 planets in mass–radius space with the Earth-like rocky relation
//   1  orthogonal projection of every planet onto the relation
//   2  ρ_norm = ρ / ρ_ref for one example planet
//   3  the population moves to ρ_norm versus absorbed flux (threshold 280 W m⁻²)
//   4  RV + PLATO measurement noise: observed ρ_norm with Monte Carlo error bars
// In step 4 the planets observed so far (N slider) are shown; planets beyond
// the predicted P5 sample come from independent P5 realizations (hollow).

import { useEffect, useMemo, useRef, useState } from 'react';
import { scaleLinear, scaleLog } from 'd3-scale';
import { projectOntoCurve, type RvBlock, type Welch } from '../../model/rv';

const C = {
  hot: '#E86A30', cold: '#2F9AD0', hotRGB: '232,106,48', coldRGB: '47,154,208',
  ink: '#E9EDF4', ink2: 'rgba(233,237,244,0.74)', muted: 'rgba(233,237,244,0.52)', faint: 'rgba(233,237,244,0.3)',
  grid: 'rgba(255,255,255,0.065)', surface: '#070A12', curve: '#F6ECDE',
};
const FONT = '"Inter Variable", Inter, system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

export interface DensityProps {
  rv: RvBlock;
  comp: string;
  primary: number[];
  shown: number[];
  obs: Map<number, number>;
  sd: number[];
  sigmaM: number[];
  welch: Welch | null;
  step: number;
  reducedMotion: boolean;
}

export function DensityFigure(props: DensityProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const P = useRef(props);
  P.current = props;
  const anim = useRef({ proj: 0, annot: 0, morph: 0, noise: 0 });
  const geom = useRef<{ x: number; y: number; i: number }[]>([]);
  const [tip, setTip] = useState<number>(-1);

  const { rv, primary, comp } = props;
  const curve = rv.curves[comp] ?? rv.curves[rv.reference_default];
  // static per-planet quantities: true ρ_norm and projected points
  const base = useMemo(() => {
    const n = rv.planets.M.length;
    const Mref = new Array(n), Rref = new Array(n), rhoN = new Array(n);
    for (let i = 0; i < n; i++) {
      const pr = projectOntoCurve(rv.planets.M[i], rv.planets.R[i], curve.M, curve.R);
      Mref[i] = pr.M_ref; Rref[i] = pr.R_ref;
      rhoN[i] = (rv.planets.M[i] / rv.planets.R[i] ** 3) / (pr.M_ref / pr.R_ref ** 3);
    }
    // example planet: a hot steam planet near 2 M⊕
    const hotSteam = primary.filter((i) => rv.planets.steam[i]);
    const ex = (hotSteam.length ? hotSteam : primary).reduce((a, b) => (Math.abs(rv.planets.M[b] - 2) < Math.abs(rv.planets.M[a] - 2) ? b : a));
    return { Mref, Rref, rhoN, ex, curve };
  }, [rv, primary, curve]);

  useEffect(() => {
    const c = ref.current!;
    const g = c.getContext('2d')!;
    let raf = 0, w = 0, h = 0, dpr = 1, last = -1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = c.clientWidth; h = c.clientHeight;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      kick();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(c);

    function frame(now: number) {
      raf = 0;
      const p = P.current;
      const a = anim.current;
      const dt = last < 0 ? 0.016 : Math.min(0.05, (now - last) / 1000);
      last = now;
      const target = { proj: p.step >= 1 ? 1 : 0, annot: p.step === 2 ? 1 : 0, morph: p.step >= 3 ? 1 : 0, noise: p.step >= 4 ? 1 : 0 };
      let moving = false;
      (Object.keys(target) as (keyof typeof target)[]).forEach((k) => {
        const rate = k === 'morph' ? 0.7 : 1.6;
        const d = target[k] - a[k];
        if (Math.abs(d) > 1e-3) {
          a[k] = p.reducedMotion ? target[k] : a[k] + Math.sign(d) * Math.min(Math.abs(d), rate * dt);
          moving = true;
        } else a[k] = target[k];
      });
      draw();
      if (moving) raf = requestAnimationFrame(frame); else last = -1;
    }
    function kick() { if (!raf) raf = requestAnimationFrame(frame); }

    function draw() {
      const p = P.current;
      const a = anim.current;
      if (!w || !h) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const small = w < 520;
      const m = { l: small ? 44 : 56, r: 14, t: 20, b: 46 };
      const { M, R, S_abs, steam } = p.rv.planets;
      const prim = p.primary;
      // mass–radius frame
      const rVals = prim.flatMap((i) => [R[i], base.Rref[i]]);
      const xMR = scaleLog().domain([0.45, 5.5]).range([m.l, w - m.r]);
      const yMR = scaleLinear().domain([Math.min(...rVals) - 0.06, Math.max(...rVals) + 0.06]).range([h - m.b, m.t]);
      // flux frame
      const shownSet = new Set(p.shown);
      const yv = [...prim.map((i) => base.rhoN[i]), ...[...p.obs.values()]].filter(Number.isFinite).sort((x, y) => x - y);
      const q = (f: number) => yv[Math.min(yv.length - 1, Math.max(0, Math.round(f * (yv.length - 1))))];
      const yLo = Math.max(0.2, Math.min(q(0.01) - 0.12, yv[0] - 0.04)), yHi = Math.min(2.2, Math.max(q(0.99) + 0.12, yv[yv.length - 1] + 0.05));
      const sAll = p.shown.concat(prim).map((i) => S_abs[i]);
      const xFS = scaleLog().domain([Math.max(...sAll) * 1.15, Math.min(...sAll) / 1.25]).range([m.l, w - m.r]);
      const yFS = scaleLinear().domain([yLo, yHi]).range([h - m.b, m.t]);
      const u = ease(a.morph), v = ease(a.noise);

      // axes: cross-fade between the two frames
      drawAxes(g, w, h, m, 1 - u, xMR, yMR, [0.5, 1, 2, 3, 5], 'planet mass M [M⊕]', 'planet radius R [R⊕]', (t) => String(t), small);
      drawAxes(g, w, h, m, u, xFS, yFS, (small ? [1000, 300, 100, 30] : [1000, 500, 200, 100, 50, 20]).filter((t) => t <= xFS.domain()[0] && t >= xFS.domain()[1]),
        '← hotter    absorbed flux S_abs [W m⁻²]    colder →', 'normalized density ρ / ρ_ref', (t) => String(t), small);

      // rocky reference relation
      if (u < 0.999) {
        g.save(); g.globalAlpha = 1 - u;
        g.strokeStyle = C.curve; g.lineWidth = 2;
        g.beginPath();
        let started = false;
        const cv = base.curve;
        for (let k = 0; k < cv.M.length; k += 4) {
          const mm = cv.M[k];
          if (mm < 0.45 || mm > 5.5) continue;
          const X = xMR(mm), Y = yMR(cv.R[k]);
          if (Y < m.t - 4 || Y > h - m.b + 4) continue;
          started ? g.lineTo(X, Y) : g.moveTo(X, Y); started = true;
        }
        g.stroke();
        // label below the relation, where no planets sit
        g.fillStyle = C.ink2; g.font = `500 ${small ? 10 : 11}px ${FONT}`; g.textAlign = 'left';
        const lx = xMR(1.25), ly = yMR(curveR(cv, 1.25));
        g.fillText(cv.label, lx + 6, ly + 20);
        g.restore();
      }
      // threshold + side washes in the flux frame
      if (u > 0.001) {
        const X = xFS(p.rv.S_thresh);
        g.save(); g.globalAlpha = u;
        g.fillStyle = `rgba(${C.hotRGB},0.045)`; g.fillRect(m.l, m.t, X - m.l, h - m.b - m.t);
        g.fillStyle = `rgba(${C.coldRGB},0.045)`; g.fillRect(X, m.t, w - m.r - X, h - m.b - m.t);
        g.strokeStyle = 'rgba(246,236,222,0.85)'; g.setLineDash([6, 5]); g.lineWidth = 1.3;
        g.beginPath(); g.moveTo(X, m.t); g.lineTo(X, h - m.b); g.stroke(); g.setLineDash([]);
        g.fillStyle = C.ink2; g.font = `600 ${small ? 10 : 11}px ${FONT}`; g.textAlign = 'right';
        g.fillText(`S_thresh = ${Math.round(p.rv.S_thresh)} W m⁻²`, X - 6, h - m.b - 8);
        g.strokeStyle = 'rgba(255,255,255,0.18)'; g.setLineDash([2, 4]);
        g.beginPath(); g.moveTo(m.l, yFS(1)); g.lineTo(w - m.r, yFS(1)); g.stroke(); g.setLineDash([]);
        g.restore();
      }
      // projections onto the relation
      if (a.proj > 0.001 && u < 0.999) {
        g.save(); g.globalAlpha = a.proj * (1 - u);
        for (const i of prim) {
          const x0 = xMR(M[i]), y0 = yMR(R[i]), x1 = xMR(base.Mref[i]), y1 = yMR(base.Rref[i]);
          g.strokeStyle = S_abs[i] > p.rv.S_thresh ? `rgba(${C.hotRGB},0.45)` : `rgba(${C.coldRGB},0.55)`;
          g.lineWidth = 1;
          g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + (x1 - x0) * a.proj, y0 + (y1 - y0) * a.proj); g.stroke();
          g.strokeStyle = C.curve; g.globalAlpha = a.proj * (1 - u) * 0.8;
          g.beginPath(); g.arc(x1, y1, 2.2, 0, Math.PI * 2); g.stroke();
          g.globalAlpha = a.proj * (1 - u);
        }
        g.restore();
      }

      // points (and the morph between the two frames)
      const pts: { x: number; y: number; i: number }[] = [];
      const drawn = new Set<number>();
      const plot = (i: number, isPrimary: boolean) => {
        const hot = S_abs[i] > p.rv.S_thresh;
        const yTrueFS = yFS(base.rhoN[i]);
        const o = p.obs.get(i);
        const yObs = o !== undefined ? yFS(o) : yTrueFS;
        const inSample = shownSet.has(i) && o !== undefined;
        let x = xMR(M[i]) + (xFS(S_abs[i]) - xMR(M[i])) * u;
        let y = yMR(R[i]) + (yTrueFS - yMR(R[i])) * u;
        if (v > 0 && inSample) y = yTrueFS + (yObs - yTrueFS) * v;
        x = Math.round(x * 2) / 2;
        let alpha = isPrimary ? 1 : v;
        if (v > 0 && !inSample) alpha *= 1 - 0.85 * v;
        if (alpha <= 0.01) return;
        // error bar
        if (v > 0 && inSample && Number.isFinite(p.sd[i])) {
          g.globalAlpha = alpha * v * 0.6;
          g.strokeStyle = hot ? `rgba(${C.hotRGB},0.9)` : `rgba(${C.coldRGB},0.95)`;
          g.lineWidth = 1;
          g.beginPath(); g.moveTo(x, yFS(o! - p.sd[i])); g.lineTo(x, yFS(o! + p.sd[i])); g.stroke();
        }
        g.globalAlpha = alpha;
        const r = small ? 3.2 : 4;
        g.fillStyle = C.surface; g.beginPath(); g.arc(x, y, r + 1.2, 0, Math.PI * 2); g.fill();
        const col = hot ? C.hot : C.cold;
        if (!isPrimary) {
          g.strokeStyle = col; g.lineWidth = 1.4; g.fillStyle = hot ? `rgba(${C.hotRGB},0.25)` : `rgba(${C.coldRGB},0.25)`;
          g.beginPath(); g.arc(x, y, r - 0.4, 0, Math.PI * 2); g.fill(); g.stroke();
        } else if (hot && !steam[i]) {
          g.strokeStyle = col; g.lineWidth = 1.6; g.fillStyle = `rgba(${C.hotRGB},0.22)`;
          g.beginPath(); g.arc(x, y, r - 0.5, 0, Math.PI * 2); g.fill(); g.stroke();
        } else {
          g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
        }
        g.globalAlpha = 1;
        if (alpha > 0.3) pts.push({ x, y, i });
        drawn.add(i);
      };
      g.save();
      for (const i of prim) plot(i, true);
      if (v > 0) for (const i of p.shown) if (!drawn.has(i)) plot(i, false);
      g.restore();
      geom.current = pts;

      // side means and test result (step 4)
      if (v > 0.01 && p.welch) {
        const X = xFS(p.rv.S_thresh);
        g.save(); g.globalAlpha = v;
        const meanLine = (x0: number, x1: number, mu: number, rgb: string) => {
          g.strokeStyle = `rgba(${rgb},1)`; g.lineWidth = 2.4;
          g.beginPath(); g.moveTo(x0, yFS(mu)); g.lineTo(x1, yFS(mu)); g.stroke();
        };
        meanLine(m.l, X, p.welch.muHot, C.hotRGB);
        meanLine(X, w - m.r, p.welch.muCold, C.coldRGB);
        const txt = `Welch t = ${p.welch.t.toFixed(2)} · p = ${fmtP(p.welch.p)} · ${p.welch.sigma.toFixed(1)}σ`;
        g.font = `600 ${small ? 10.5 : 11.5}px ${FONT}`;
        const tw = g.measureText(txt).width + 16;
        g.fillStyle = 'rgba(7,10,18,0.88)';
        g.beginPath(); g.rect(w - m.r - tw, m.t + 2, tw, 22); g.fill();
        g.fillStyle = C.ink; g.textAlign = 'left'; g.textBaseline = 'middle';
        g.fillText(txt, w - m.r - tw + 8, m.t + 13.5);
        g.textBaseline = 'alphabetic';
        g.restore();
      }

      // example calculation (step 2)
      if (a.annot > 0.01 && u < 0.99) {
        const i = base.ex;
        const x0 = xMR(M[i]), y0 = yMR(R[i]);
        const rho = 5.513 * M[i] / R[i] ** 3, rhoRef = 5.513 * base.Mref[i] / base.Rref[i] ** 3;
        g.save(); g.globalAlpha = a.annot * (1 - u);
        g.strokeStyle = C.ink; g.lineWidth = 1.6;
        g.beginPath(); g.arc(x0, y0, 9, 0, Math.PI * 2); g.stroke();
        const lines = [
          `M = ${M[i].toFixed(2)} M⊕,  R = ${R[i].toFixed(3)} R⊕`,
          `ρ = ${rho.toFixed(2)} g cm⁻³`,
          `projected: M_ref = ${base.Mref[i].toFixed(2)}, R_ref = ${base.Rref[i].toFixed(3)}`,
          `ρ_ref = ${rhoRef.toFixed(2)} g cm⁻³`,
          `ρ_norm = ρ / ρ_ref = ${(rho / rhoRef).toFixed(3)}`,
        ];
        g.font = `500 ${small ? 10 : 11}px ${MONO}`;
        const bw = Math.max(...lines.map((l) => g.measureText(l).width)) + 20, bh = lines.length * 16 + 14;
        let bx = x0 + 18, by = y0 - bh - 10;
        if (bx + bw > w - m.r) bx = x0 - bw - 18;
        if (by < m.t) by = y0 + 14;
        g.fillStyle = 'rgba(7,10,18,0.92)'; g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1;
        g.beginPath(); g.rect(bx, by, bw, bh); g.fill(); g.stroke();
        lines.forEach((l, k) => { g.fillStyle = k === lines.length - 1 ? C.ink : C.ink2; g.fillText(l, bx + 10, by + 20 + 16 * k); });
        g.restore();
      }
    }

    kick();
    const onChange = () => kick();
    window.addEventListener('rv-density-change', onChange);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('rv-density-change', onChange); };
  }, [base]);

  useEffect(() => { window.dispatchEvent(new Event('rv-density-change')); });

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = -1, bd = 14 * 14;
    for (const pt of geom.current) { const d = (pt.x - x) ** 2 + (pt.y - y) ** 2; if (d < bd) { bd = d; best = pt.i; } }
    setTip(best);
    const t = tipRef.current;
    if (t) {
      if (best >= 0) {
        const pt = geom.current.find((q) => q.i === best)!;
        t.style.left = `${Math.min(pt.x + 12, r.width - 220)}px`; t.style.top = `${pt.y}px`; t.style.opacity = '1';
      } else t.style.opacity = '0';
    }
  };
  const pl = props.rv.planets;
  const ti = tip;
  return (
    <div className="chart" style={{ position: 'relative' }}>
      <canvas ref={ref} className="density-canvas" onPointerMove={onMove} onPointerLeave={() => { setTip(-1); if (tipRef.current) tipRef.current.style.opacity = '0'; }}
        role="img" aria-label="Planets move from mass–radius space, through projection onto a rocky mass–radius relation, to normalized density versus absorbed flux with measurement uncertainties." />
      <div className="tooltip" ref={tipRef}>
        {ti >= 0 && (
          <>
            <div className="tt-head"><span className="lg-dot" style={{ background: pl.S_abs[ti] > props.rv.S_thresh ? C.hot : C.cold }} />
              P5 planet{pl.seed[ti] !== props.rv.primary_seed ? ' · forecast' : ''}</div>
            <dl>
              <dt>Mass · radius</dt><dd>{pl.M[ti].toFixed(2)} M⊕ · {pl.R[ti].toFixed(3)} R⊕</dd>
              <dt>ρ_norm (true)</dt><dd>{base.rhoN[ti].toFixed(3)}</dd>
              {props.obs.has(ti) && <><dt>ρ_norm (measured)</dt><dd>{props.obs.get(ti)!.toFixed(3)} ± {props.sd[ti].toFixed(3)}</dd></>}
              <dt>σ_M / M</dt><dd>{(100 * props.sigmaM[ti]).toFixed(0)} %</dd>
              <dt>S_abs · P</dt><dd>{Math.round(pl.S_abs[ti])} W m⁻² · {pl.P[ti].toFixed(1)} d</dd>
            </dl>
            <div className="tt-foot">{pl.S_abs[ti] > props.rv.S_thresh ? (pl.steam[ti] ? 'hot side · steam envelope' : 'hot side · no envelope') : 'cold side'}</div>
          </>
        )}
      </div>
    </div>
  );
}

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const fmtP = (p: number) => (p < 1e-4 ? p.toExponential(1) : p.toFixed(p < 0.01 ? 4 : 3));

function curveR(cv: { M: number[]; R: number[] }, M: number): number {
  const { M: cm, R: cr } = cv;
  let k = 0;
  while (k < cm.length - 1 && cm[k + 1] < M) k++;
  return cr[k];
}

function drawAxes(g: CanvasRenderingContext2D, w: number, h: number, m: { l: number; r: number; t: number; b: number }, alpha: number,
  x: (v: number) => number, y: ReturnType<typeof scaleLinear<number, number>>, xt: number[], xl: string, yl: string,
  fmt: (v: number) => string, small: boolean) {
  if (alpha <= 0.002) return;
  g.save();
  g.globalAlpha = alpha;
  g.strokeStyle = C.grid; g.lineWidth = 1;
  const yt = y.ticks(5);
  g.beginPath();
  for (const t of xt) { const X = Math.round(x(t)) + 0.5; g.moveTo(X, m.t); g.lineTo(X, h - m.b); }
  for (const t of yt) { const Y = Math.round(y(t)) + 0.5; g.moveTo(m.l, Y); g.lineTo(w - m.r, Y); }
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.2)';
  g.beginPath(); g.moveTo(m.l, h - m.b + 0.5); g.lineTo(w - m.r, h - m.b + 0.5); g.moveTo(m.l + 0.5, m.t); g.lineTo(m.l + 0.5, h - m.b); g.stroke();
  g.fillStyle = C.muted; g.font = `500 ${small ? 9.5 : 10.5}px ${MONO}`;
  g.textAlign = 'center'; g.textBaseline = 'top';
  for (const t of xt) g.fillText(fmt(t), x(t), h - m.b + 6);
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const t of yt) g.fillText(t.toFixed(1), m.l - 7, y(t));
  g.textBaseline = 'alphabetic';
  g.fillStyle = C.ink2; g.font = `500 ${small ? 10.5 : 11.5}px ${FONT}`; g.textAlign = 'center';
  g.fillText(xl, (m.l + w - m.r) / 2, h - 8);
  g.save(); g.translate(small ? 11 : 14, (m.t + h - m.b) / 2); g.rotate(-Math.PI / 2); g.fillText(yl, 0, 0); g.restore();
  g.restore();
}
