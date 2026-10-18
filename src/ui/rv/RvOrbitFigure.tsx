// Part 1 — how a radial-velocity measurement works and what it delivers.
// One animated canvas, four coordinated panels driven by the same clock:
// (a) planet and star orbiting the barycentre, observed from the VLT;
// (b) the stellar spectrum recorded by ESPRESSO with Doppler-shifted lines;
// (c) a measurement campaign: the N_RV radial velocities (±σ_RV each) arrive
//     one by one at the orbital phase the system is in at that moment, folded
//     on the period known from the transits; the semi-amplitude is fitted live
//     by linear least squares with the phase fixed by the transit ephemeris;
// (d) the result: K̂ ± σ_K̂ and the implied planet mass M̂ ± σ_M, which tighten
//     around the true value as measurements accumulate.
// Physical numbers (K, σ_K, σ_M/M) are exact for the chosen planet; the drawn
// wobble and line shifts are exaggerated.  The campaign's epochs and noise
// draws are seeded: among 31 seeded campaigns the representative one is shown
// (median of the largest deviation |K̂ − K| / σ_K̂ along the run), so every
// cycle shows the same reproducible, typical campaign.

import { useEffect, useRef } from 'react';
import { semiAmplitude, sigmaK } from '../../model/rv';
import { mulberry32 } from '../../model/rng';

export interface OrbitDemo { Mp: number; P: number; Mst: number; sigmaRV: number; nRV: number; e: number; pref: number }

const HOT = '#E86A30', COLD = '#2F9AD0', FIT = '#FF9A5C';
const INK = '#E9EDF4', INK2 = 'rgba(233,237,244,0.74)', MUTED = 'rgba(233,237,244,0.55)', FAINT = 'rgba(233,237,244,0.28)', GRID = 'rgba(255,255,255,0.07)';
const FONT = '"Inter Variable", Inter, system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';
// rest wavelengths of the drawn absorption lines (arbitrary units across the strip)
const LINES = [0.06, 0.11, 0.19, 0.23, 0.31, 0.38, 0.44, 0.52, 0.57, 0.63, 0.71, 0.78, 0.83, 0.9, 0.95];
// campaign timing (seconds of animation): orbits per second, observing run, hold on the result
const ORBIT_RATE = 0.4;
const CAMPAIGN = 13;
const HOLD = 4.5;
const CYCLE = CAMPAIGN + HOLD;

/** Least-squares amplitude of v = K cos φ with the phase fixed (transit ephemeris). */
function fitK(c: number[], v: number[], n: number, sigmaRV: number) {
  let sc = 0, sv = 0;
  for (let i = 0; i < n; i++) { sc += c[i] * c[i]; sv += v[i] * c[i]; }
  return sc > 0 ? { K: sv / sc, sK: sigmaRV / Math.sqrt(sc) } : null;
}

export function RvOrbitFigure({ demo, reducedMotion }: { demo: OrbitDemo; reducedMotion: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const demoRef = useRef(demo);
  demoRef.current = demo;

  useEffect(() => {
    const c = ref.current!;
    const g = c.getContext('2d')!;
    let raf = 0, visible = false, w = 0, h = 0, dpr = 1;
    let clock = reducedMotion ? CAMPAIGN + 0.01 : 0, last = -1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = c.clientWidth; h = c.clientHeight;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    };
    const ro = new ResizeObserver(() => { resize(); draw(); });
    ro.observe(c);
    const io = new IntersectionObserver((e) => { visible = e[0].isIntersecting; if (visible && !raf) raf = requestAnimationFrame(loop); }, { threshold: 0.05 });
    io.observe(c);
    resize();

    // the campaign: epoch times within the run and standard-normal noise draws
    let campKey = '';
    let epochs: { t: number; phase: number; z: number }[] = [];
    const draws = (seed: number, nRV: number) => {
      const r = mulberry32(seed);
      return Array.from({ length: nRV }, () => {
        const t = 0.25 + (CAMPAIGN - 0.5) * r();
        const z = Math.sqrt(-2 * Math.log(Math.max(r(), 1e-9))) * Math.cos(2 * Math.PI * r());
        return { t, phase: (ORBIT_RATE * t) % 1, z };
      }).sort((a, b) => a.t - b.t);
    };
    // largest standardized deviation of the running fit, (K̂ − K)/σ_K̂ = Σ z c / √Σ c²,
    // after the first few points; it depends on the epochs and draws only
    const worst = (eps: { phase: number; z: number }[]) => {
      let sc = 0, sz = 0, m = 0;
      eps.forEach((e, i) => {
        const c = Math.cos(2 * Math.PI * e.phase);
        sc += c * c; sz += e.z * c;
        if (i >= 5 && sc > 0) m = Math.max(m, Math.abs(sz) / Math.sqrt(sc));
      });
      return m;
    };
    const campaign = (nRV: number) => {
      const key = String(nRV);
      if (key === campKey) return epochs;
      campKey = key;
      const cands = Array.from({ length: 31 }, (_, k) => { const e = draws(31 + k, nRV); return { e, m: worst(e) }; })
        .sort((a, b) => a.m - b.m);
      epochs = cands[15].e;
      return epochs;
    };

    function draw() {
      const d = demoRef.current;
      if (!w || !h) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const K = semiAmplitude(d.Mp, d.P, d.Mst, d.e, d.pref);
      const sKfull = sigmaK(d.sigmaRV, d.nRV);
      const tc = clock % CYCLE;
      const phase = (ORBIT_RATE * tc) % 1;
      const ang = 2 * Math.PI * phase;
      const small = w < 640;
      const eps = campaign(d.nRV);
      let nNow = 0;
      while (nNow < eps.length && eps[nNow].t <= tc) nNow++;
      const lastT = nNow ? eps[nNow - 1].t : -9;
      const flash = Math.max(0, 1 - (tc - lastT) / 0.35);
      const fade = 1 - Math.max(0, (tc - (CYCLE - 0.6)) / 0.6);   // clear the plot before the next run

      // ── layout ─────────────────────────────────────────────────────────────
      const topH = small ? h * 0.36 : h * 0.38;
      const ow = small ? w : Math.min(w * 0.4, 320);
      const ox = ow / 2, oy = small ? topH * 0.36 : topH * 0.4;
      const rOrb = Math.min(ow * 0.38, topH * 0.34);
      const specX = small ? 8 : ow + 24, specW = small ? w - 16 : w - ow - 32;
      const specY = small ? topH + 26 : topH * 0.3, specH = small ? 30 : topH * 0.22;
      const plotT = small ? specY + specH + 62 : topH + 34;
      const resH = small ? 104 : 78;
      const plotB = h - resH - 52;
      const barsW = small ? 0 : 92;
      const px0 = 50, px1 = w - 10 - barsW;

      // ── (a) orbit: star and planet about the barycentre ───────────────────
      const vStar = K * Math.cos(ang);              // m/s; > 0 receding (zero at transit)
      g.save();
      g.strokeStyle = GRID; g.lineWidth = 1;
      g.setLineDash([3, 5]);
      g.beginPath(); g.ellipse(ox, oy, rOrb, rOrb * 0.42, 0, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
      g.strokeStyle = MUTED;
      g.beginPath(); g.moveTo(ox - 5, oy); g.lineTo(ox + 5, oy); g.moveTo(ox, oy - 5); g.lineTo(ox, oy + 5); g.stroke();
      const rStarOrb = rOrb * 0.085;
      const px = ox + rOrb * Math.cos(ang), py = oy + rOrb * 0.42 * Math.sin(ang);
      const sx = ox - rStarOrb * Math.cos(ang), sy = oy - rStarOrb * 0.42 * Math.sin(ang);
      g.strokeStyle = 'rgba(255,214,170,0.35)';
      g.beginPath(); g.ellipse(ox, oy, rStarOrb, rStarOrb * 0.42, 0, 0, Math.PI * 2); g.stroke();
      const drawPlanet = () => {
        const pr = Math.max(3.5, rOrb * 0.05);
        const grd = g.createRadialGradient(px - pr * 0.4, py - pr * 0.4, 0, px, py, pr);
        grd.addColorStop(0, '#9fd3ff'); grd.addColorStop(1, '#2c5c8a');
        g.fillStyle = grd;
        g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
      };
      if (Math.sin(ang) < 0) drawPlanet();
      const sr = Math.max(9, rOrb * 0.16);
      const halo = g.createRadialGradient(sx, sy, 0, sx, sy, sr * 2.6);
      halo.addColorStop(0, 'rgba(255,226,180,0.45)'); halo.addColorStop(1, 'rgba(255,226,180,0)');
      g.fillStyle = halo; g.beginPath(); g.arc(sx, sy, sr * 2.6, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffd9a6'; g.beginPath(); g.arc(sx, sy, sr, 0, Math.PI * 2); g.fill();
      if (Math.sin(ang) >= 0) drawPlanet();
      // star velocity along the line of sight
      const vCol = vStar < 0 ? COLD : HOT;
      const len = 26 * Math.abs(Math.cos(ang));
      if (len > 2) {
        g.strokeStyle = vCol; g.fillStyle = vCol; g.lineWidth = 2;
        const dir = vStar > 0 ? -1 : 1;   // receding = away from the observer (up)
        const y0 = sy + dir * (sr + 4), y1 = y0 + dir * len;
        g.beginPath(); g.moveTo(sx, y0); g.lineTo(sx, y1); g.stroke();
        g.beginPath(); g.moveTo(sx, y1 + dir * 6); g.lineTo(sx - 4, y1); g.lineTo(sx + 4, y1); g.closePath(); g.fill();
      }
      // observer: line of sight to the VLT; it lights up while an exposure is taken
      const obsY = oy + rOrb * 0.42 + (small ? 26 : 44);
      g.strokeStyle = flash > 0 ? `rgba(255,214,170,${0.25 + 0.6 * flash})` : FAINT;
      g.lineWidth = flash > 0 ? 1.5 : 1;
      g.setLineDash([2, 4]);
      g.beginPath(); g.moveTo(sx, sy + sr); g.lineTo(ox, obsY - 16); g.stroke(); g.setLineDash([]);
      drawTelescope(g, ox, obsY, flash);
      g.fillStyle = MUTED; g.font = `500 10.5px ${FONT}`; g.textAlign = 'center';
      g.fillText('ESO VLT · ESPRESSO', ox, obsY + 30);
      g.fillStyle = FAINT; g.font = `500 9.5px ${FONT}`;
      g.fillText('orbit seen almost edge-on · wobble exaggerated', ox, oy - rOrb * 0.42 - 14);
      g.restore();

      // ── (b) spectrum recorded by the spectrograph ──────────────────────────
      const shiftPx = (vStar / Math.max(K, 1e-9)) * Math.min(14, specW * 0.018);
      g.save();
      const spec = g.createLinearGradient(specX, 0, specX + specW, 0);
      ['#5a3fa8', '#2f6fd0', '#2fb0b8', '#5fc46a', '#e3d34a', '#f09a3a', '#d8483a'].forEach((col, k, arr) => spec.addColorStop(k / (arr.length - 1), col));
      g.globalAlpha = 0.5;
      g.fillStyle = spec;
      g.fillRect(specX, specY, specW, specH);
      g.globalAlpha = 1;
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1;
      for (const l of LINES) { const X = specX + l * specW; g.beginPath(); g.moveTo(X, specY - 5); g.lineTo(X, specY); g.stroke(); }
      g.fillStyle = 'rgba(5,7,14,0.88)';
      for (const l of LINES) g.fillRect(specX + l * specW + shiftPx - 1.6, specY + 1, 3.2, specH - 2);
      g.fillStyle = vStar < 0 ? COLD : HOT;
      g.globalAlpha = Math.min(1, Math.abs(vStar) / Math.max(K, 1e-9));
      g.font = `600 11px ${FONT}`; g.textAlign = 'left';
      g.fillText(vStar < 0 ? '← blueshift: star approaching' : 'redshift: star receding →', specX, specY - 9);
      g.globalAlpha = 1;
      g.fillStyle = MUTED; g.font = `500 10.5px ${FONT}`;
      g.fillText(small ? 'ESPRESSO spectrum (shifts ×10⁸)' : 'ESPRESSO spectrum of the star (line shifts exaggerated ~10⁸×)', specX, specY - 27);
      g.fillStyle = FAINT; g.font = `500 9.5px ${FONT}`;
      g.fillText(`real Δλ/λ = v/c ≈ ${(K / 2.998e8).toExponential(1)} — measured from thousands of lines at once`, specX, specY + specH + 15);
      g.restore();

      // ── (c) the campaign: phase-folded measurements and the live fit ───────
      const vMax = Math.max(K + 2.6 * d.sigmaRV, K * 1.5, 0.2);
      const X = (ph: number) => px0 + ph * (px1 - px0);
      const Y = (v: number) => plotT + (plotB - plotT) / 2 - (v / vMax) * ((plotB - plotT) / 2);
      const cosP = (ph: number) => Math.cos(2 * Math.PI * ph);
      g.save();
      g.strokeStyle = GRID; g.lineWidth = 1;
      for (const v of [-vMax, -vMax / 2, 0, vMax / 2, vMax]) { g.beginPath(); g.moveTo(px0, Y(v)); g.lineTo(px1, Y(v)); g.stroke(); }
      g.fillStyle = MUTED; g.font = `500 10px ${MONO}`; g.textAlign = 'right';
      for (const v of [-vMax, 0, vMax]) g.fillText(`${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`, px0 - 6, Y(v) + 3);
      g.save(); g.translate(12, (plotT + plotB) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillStyle = MUTED; g.font = `500 10.5px ${FONT}`;
      g.fillText('radial velocity [m/s]', 0, 0); g.restore();
      // phase axis; the transit (phase 0.25 here) fixes where the curve crosses zero
      g.fillStyle = MUTED; g.font = `500 10px ${MONO}`;
      for (const ph of [0, 0.5, 1]) { g.textAlign = ph === 0 ? 'left' : ph === 1 ? 'right' : 'center'; g.fillText(ph.toFixed(1), X(ph), plotB + 16); }
      g.strokeStyle = 'rgba(246,236,222,0.35)'; g.setLineDash([2, 3]);
      g.beginPath(); g.moveTo(X(0.25), plotT + 18); g.lineTo(X(0.25), plotB); g.stroke(); g.setLineDash([]);
      g.textAlign = 'center'; g.fillStyle = MUTED; g.font = `500 10px ${FONT}`;
      g.fillText('transit', X(0.25), plotT + 12);
      g.fillText('orbital phase (period and transit time known from PLATO)', (px0 + px1) / 2, plotB + 32);

      const vs: number[] = [], cs: number[] = [];
      for (let i = 0; i < nNow; i++) { cs.push(cosP(eps[i].phase)); vs.push(K * cs[i] + d.sigmaRV * eps[i].z); }
      const fit = nNow >= 2 ? fitK(cs, vs, nNow, d.sigmaRV) : null;
      g.globalAlpha = fade;
      // true signal (known only in the simulation)
      g.strokeStyle = 'rgba(233,237,244,0.55)'; g.lineWidth = 1.2; g.setLineDash([5, 4]);
      g.beginPath();
      for (let k = 0; k <= 160; k++) { const u = k / 160; k ? g.lineTo(X(u), Y(K * cosP(u))) : g.moveTo(X(u), Y(K * cosP(u))); }
      g.stroke(); g.setLineDash([]);
      // measurements: older ones quiet, the newest one highlighted with its error bar
      const many = nNow > 60;
      for (let i = 0; i < nNow; i++) {
        const xx = X(eps[i].phase), yy = Y(Math.max(-vMax * 1.05, Math.min(vMax * 1.05, vs[i])));
        const age = tc - eps[i].t;
        const fresh = Math.max(0, 1 - age / 0.9);
        g.strokeStyle = `rgba(233,237,244,${0.12 + 0.6 * fresh})`; g.lineWidth = 1;
        if (!many || fresh > 0) { g.beginPath(); g.moveTo(xx, Y(vs[i] - d.sigmaRV)); g.lineTo(xx, Y(vs[i] + d.sigmaRV)); g.stroke(); }
        g.fillStyle = `rgba(233,237,244,${0.4 + 0.6 * fresh})`;
        g.beginPath(); g.arc(xx, yy, many ? 2 : 2.6, 0, Math.PI * 2); g.fill();
        if (fresh > 0) {
          g.strokeStyle = `rgba(255,214,170,${fresh})`; g.lineWidth = 1.5;
          g.beginPath(); g.arc(xx, yy, 4 + 8 * (1 - fresh), 0, Math.PI * 2); g.stroke();
        }
      }
      // phase-binned means (±σ_RV/√n): the sinusoid emerges from the noise as points accumulate
      const NB = 10;
      const bs = Array.from({ length: NB }, () => ({ n: 0, s: 0 }));
      for (let i = 0; i < nNow; i++) { const b = bs[Math.min(NB - 1, Math.floor(eps[i].phase * NB))]; b.n++; b.s += vs[i]; }
      bs.forEach((b, k) => {
        if (b.n < 2) return;
        const m = b.s / b.n, e = d.sigmaRV / Math.sqrt(b.n);
        const xx = X((k + 0.5) / NB);
        g.strokeStyle = INK; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(xx, Y(Math.max(-vMax, m - e))); g.lineTo(xx, Y(Math.min(vMax, m + e))); g.stroke();
        g.fillStyle = '#070A12';
        g.fillRect(xx - 5, Y(m) - 5, 10, 10);
        g.fillStyle = INK;
        g.fillRect(xx - 3.5, Y(m) - 3.5, 7, 7);
      });
      // fitted curve with its ±σ_K̂ band
      if (fit) {
        g.fillStyle = 'rgba(255,154,92,0.16)';
        g.beginPath();
        for (let k = 0; k <= 160; k++) { const u = k / 160; g.lineTo(X(u), Y((fit.K + fit.sK) * cosP(u))); }
        for (let k = 160; k >= 0; k--) { const u = k / 160; g.lineTo(X(u), Y((fit.K - fit.sK) * cosP(u))); }
        g.closePath(); g.fill();
        g.strokeStyle = FIT; g.lineWidth = 2.2;
        g.beginPath();
        for (let k = 0; k <= 160; k++) { const u = k / 160; k ? g.lineTo(X(u), Y(fit.K * cosP(u))) : g.moveTo(X(u), Y(fit.K * cosP(u))); }
        g.stroke();
      }
      g.globalAlpha = 1;
      // legend inside the plot
      g.font = `500 10px ${FONT}`; g.textAlign = 'left';
      const lx = px0, ly = plotT - 12;
      g.strokeStyle = 'rgba(233,237,244,0.55)'; g.setLineDash([5, 4]); g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(lx, ly); g.lineTo(lx + 18, ly); g.stroke(); g.setLineDash([]);
      g.fillStyle = MUTED; g.fillText('true signal', lx + 24, ly + 3);
      g.fillStyle = INK; g.fillRect(lx + 92, ly - 3.5, 7, 7);
      g.fillStyle = MUTED; g.fillText('binned mean', lx + 104, ly + 3);
      g.strokeStyle = FIT; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(lx + 178, ly); g.lineTo(lx + 196, ly); g.stroke();
      g.fillText(small ? 'fit ±1σ' : 'fit ±1σ', lx + 202, ly + 3);

      // signal vs. noise of a single measurement, on the velocity scale of the plot
      if (!small) {
        const bx = px1 + 22, y0v = Y(0);
        g.lineWidth = 3; g.strokeStyle = HOT;
        g.beginPath(); g.moveTo(bx, y0v); g.lineTo(bx, Y(K)); g.stroke();
        g.strokeStyle = INK2;
        g.beginPath(); g.moveTo(bx + 34, y0v); g.lineTo(bx + 34, Y(d.sigmaRV)); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(bx - 8, y0v); g.lineTo(bx + 42, y0v); g.stroke();
        g.textAlign = 'center'; g.font = `600 10px ${FONT}`;
        g.fillStyle = HOT; g.fillText('K', bx, Math.min(Y(K), y0v - 4) - 8);
        g.fillStyle = INK2; g.fillText('σ_RV', bx + 34, Math.min(Y(d.sigmaRV), y0v - 4) - 8);
        g.fillStyle = MUTED; g.font = `500 9.5px ${FONT}`;
        g.fillText('signal', bx, y0v + 14);
        g.fillText('noise', bx + 34, y0v + 14);
        g.fillText('per point', bx + 34, y0v + 26);
      }
      g.restore();

      // ── (d) the result: semi-amplitude and planet mass ────────────────────
      const ry = h - resH;
      g.save();
      g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, ry - 8.5); g.lineTo(w, ry - 8.5); g.stroke();
      const head = (t: string, x: number, y: number) => { g.fillStyle = MUTED; g.font = `600 9.5px ${MONO}`; g.textAlign = 'left'; g.fillText(t, x, y); };
      const big = (t: string, x: number, y: number, col = INK) => { g.fillStyle = col; g.font = `600 ${small ? 16 : 18}px ${FONT}`; g.textAlign = 'left'; g.fillText(t, x, y); };
      const c1 = 0, c2 = small ? w * 0.42 : w * 0.2, c3 = small ? 0 : w * 0.45;
      head('RV MEASUREMENTS', c1, ry + 10);
      big(`${nNow} / ${d.nRV}`, c1, ry + 34);
      head('FITTED K', c2, ry + 10);
      big(fit ? `${fit.K.toFixed(2)} ± ${fit.sK.toFixed(2)} m/s` : '—', c2, ry + 34, fit ? FIT : MUTED);
      // mass gauge: true mass and the estimate with its ±1σ interval
      const gy = small ? ry + 74 : ry + 40;
      const gx0 = c3 + (small ? 0 : 0), gx1 = w - 6;
      const mMax = 2.5 * d.Mp;
      const GX = (m: number) => gx0 + (gx1 - gx0) * Math.max(0, Math.min(1, m / mMax));
      head('PLANET MASS', gx0, small ? ry + 52 : ry + 10);
      const mHat = fit ? d.Mp * fit.K / K : NaN, sM = fit ? d.Mp * fit.sK / K : NaN;
      if (fit) {
        g.fillStyle = INK; g.font = `600 ${small ? 12 : 13}px ${FONT}`; g.textAlign = 'right';
        g.fillText(`M = ${mHat.toFixed(1)} ± ${sM.toFixed(1)} M⊕  (σ_M/M = ${Math.round(100 * sM / d.Mp)} %)`, gx1, small ? ry + 52 : ry + 10);
      }
      g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(gx0, gy + 0.5); g.lineTo(gx1, gy + 0.5); g.stroke();
      g.fillStyle = MUTED; g.font = `500 9.5px ${MONO}`; g.textAlign = 'center';
      for (const m of [0, d.Mp, 2 * d.Mp]) {
        g.beginPath(); g.moveTo(GX(m), gy - 3); g.lineTo(GX(m), gy + 3); g.stroke();
        g.fillText(m === d.Mp ? `${m.toFixed(1)} true` : m.toFixed(1), GX(m), gy + 15);
      }
      if (fit) {
        const a = GX(mHat - sM), b = GX(mHat + sM);
        g.globalAlpha = fade;
        g.strokeStyle = FIT; g.lineWidth = 6; g.globalAlpha = 0.35 * fade;
        g.beginPath(); g.moveTo(a, gy); g.lineTo(b, gy); g.stroke();
        g.globalAlpha = fade;
        g.fillStyle = FIT; g.beginPath(); g.arc(GX(mHat), gy, 4.5, 0, Math.PI * 2); g.fill();
        g.fillStyle = MUTED; g.font = `500 9.5px ${FONT}`; g.textAlign = 'left';
        if (mHat - sM < 0) g.fillText('◂', gx0 - 2, gy + 3.5);
        if (mHat + sM > mMax) { g.textAlign = 'right'; g.fillText('▸', gx1 + 4, gy + 3.5); }
      }
      g.globalAlpha = 1;
      g.strokeStyle = INK; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(GX(d.Mp), gy - 7); g.lineTo(GX(d.Mp), gy + 7); g.stroke();
      // after the run: the expected precision of the full campaign
      if (tc > CAMPAIGN && !small) {
        g.globalAlpha = Math.min(1, (tc - CAMPAIGN) / 0.5) * fade;
        g.fillStyle = INK2; g.font = `500 10.5px ${FONT}`; g.textAlign = 'right';
        g.fillText(`expected for ${d.nRV} epochs: σ_K = ${sKfull.toFixed(2)} m/s → σ_M/M = ${Math.round(100 * sKfull / K)} %`, px1, plotT - 9);
      }
      g.restore();
    }

    function loop(now: number) {
      raf = 0;
      if (!visible) { last = -1; return; }
      const dt = last < 0 ? 0 : Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!reducedMotion) clock += dt;
      draw();
      if (!reducedMotion) raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    const redraw = () => draw();
    window.addEventListener('rv-demo-change', redraw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); window.removeEventListener('rv-demo-change', redraw); };
  }, [reducedMotion]);

  useEffect(() => { window.dispatchEvent(new Event('rv-demo-change')); }, [demo]);

  return <canvas ref={ref} className="rv-canvas" role="img"
    aria-label="Animation: a planet and its star orbit their common centre of mass; each radial-velocity measurement is added to a phase-folded curve, the semi-amplitude K is fitted from the measurements so far, and the implied planet mass and its uncertainty converge as measurements accumulate." />;
}

function drawTelescope(g: CanvasRenderingContext2D, x: number, y: number, flash: number) {
  g.save();
  g.translate(x, y);
  if (flash > 0) {
    const glow = g.createRadialGradient(0, 4, 0, 0, 4, 30);
    glow.addColorStop(0, `rgba(255,214,170,${0.45 * flash})`); glow.addColorStop(1, 'rgba(255,214,170,0)');
    g.fillStyle = glow; g.beginPath(); g.arc(0, 4, 30, 0, Math.PI * 2); g.fill();
  }
  // dome
  g.fillStyle = 'rgba(233,237,244,0.16)';
  g.strokeStyle = 'rgba(233,237,244,0.55)';
  g.lineWidth = 1.2;
  g.beginPath(); g.arc(0, 8, 15, Math.PI, 0); g.lineTo(15, 16); g.lineTo(-15, 16); g.closePath(); g.fill(); g.stroke();
  // slit and telescope tube pointing up
  g.fillStyle = 'rgba(5,7,14,0.9)';
  g.fillRect(-3, -7, 6, 15);
  g.strokeStyle = 'rgba(246,236,222,0.8)';
  g.beginPath(); g.moveTo(-2, 6); g.lineTo(-5, -10); g.moveTo(2, 6); g.lineTo(5, -10); g.stroke();
  g.restore();
}
