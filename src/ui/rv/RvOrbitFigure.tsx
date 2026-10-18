// Part 1 — how a radial-velocity measurement works.
// One animated canvas, three coordinated panels driven by the same orbital
// phase: (a) planet and star orbiting the barycentre, (b) the stellar spectrum
// recorded by ESPRESSO with Doppler-shifted absorption lines, (c) the RV curve
// with simulated measurements.  Physical numbers (K, σ_K, σ_M/M) are exact for
// the chosen planet; the drawn wobble and line shifts are exaggerated.

import { useEffect, useRef } from 'react';
import { semiAmplitude, sigmaK } from '../../model/rv';
import { mulberry32 } from '../../model/rng';

export interface OrbitDemo { Mp: number; P: number; Mst: number; sigmaRV: number; nRV: number; e: number; pref: number }

const HOT = '#E86A30', COLD = '#2F9AD0';
const INK = '#E9EDF4', MUTED = 'rgba(233,237,244,0.55)', FAINT = 'rgba(233,237,244,0.28)', GRID = 'rgba(255,255,255,0.07)';
const FONT = '"Inter Variable", Inter, system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';
// rest wavelengths of the drawn absorption lines (arbitrary units across the strip)
const LINES = [0.06, 0.11, 0.19, 0.23, 0.31, 0.38, 0.44, 0.52, 0.57, 0.63, 0.71, 0.78, 0.83, 0.9, 0.95];

export function RvOrbitFigure({ demo, reducedMotion }: { demo: OrbitDemo; reducedMotion: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const demoRef = useRef(demo);
  demoRef.current = demo;

  useEffect(() => {
    const c = ref.current!;
    const g = c.getContext('2d')!;
    let raf = 0, visible = false, w = 0, h = 0, dpr = 1;
    let phase0 = 0, last = -1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = c.clientWidth; h = c.clientHeight;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    };
    const ro = new ResizeObserver(() => { resize(); draw(); });
    ro.observe(c);
    const io = new IntersectionObserver((e) => { visible = e[0].isIntersecting; if (visible && !raf) loop(performance.now()); }, { threshold: 0.05 });
    io.observe(c);
    resize();

    // epochs of the simulated RV measurements (fixed per configuration)
    let epochKey = '';
    let epochs: { t: number; z: number }[] = [];

    function draw() {
      const d = demoRef.current;
      if (!w || !h) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const K = semiAmplitude(d.Mp, d.P, d.Mst, d.e, d.pref);
      const sK = sigmaK(d.sigmaRV, d.nRV);
      const phase = phase0 % 1;
      const ang = 2 * Math.PI * phase;
      const small = w < 640;

      // layout
      const orbitW = small ? w : Math.min(w * 0.42, h * 1.05);
      const ox = small ? w / 2 : orbitW / 2 + 6;
      const oy = small ? h * 0.27 : h * 0.47;
      const rOrb = Math.min(orbitW * 0.36, (small ? h * 0.2 : h * 0.33));
      const rx = small ? 0 : orbitW + 22;
      const rw = small ? w : w - rx - 4;
      const specY = small ? h * 0.56 : h * 0.1, specH = small ? h * 0.1 : h * 0.17;
      const curveY = small ? h * 0.72 : h * 0.44, curveH = small ? h * 0.24 : h * 0.44;

      // ── (a) orbit: star and planet about the barycentre ─────────────────────
      // radial velocity of the star toward the observer (observer below the panel)
      const vStar = K * Math.cos(ang);              // m/s; > 0 receding (zero at transit)
      g.save();
      g.strokeStyle = GRID; g.lineWidth = 1;
      g.setLineDash([3, 5]);
      g.beginPath(); g.ellipse(ox, oy, rOrb, rOrb * 0.42, 0, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
      // barycentre
      g.strokeStyle = MUTED;
      g.beginPath(); g.moveTo(ox - 5, oy); g.lineTo(ox + 5, oy); g.moveTo(ox, oy - 5); g.lineTo(ox, oy + 5); g.stroke();
      // star wobble (exaggerated) opposite to the planet
      const rStarOrb = rOrb * 0.085;
      const px = ox + rOrb * Math.cos(ang), py = oy + rOrb * 0.42 * Math.sin(ang);
      const sx = ox - rStarOrb * Math.cos(ang), sy = oy - rStarOrb * 0.42 * Math.sin(ang);
      g.strokeStyle = 'rgba(255,214,170,0.35)';
      g.beginPath(); g.ellipse(ox, oy, rStarOrb, rStarOrb * 0.42, 0, 0, Math.PI * 2); g.stroke();
      // planet behind the star when sin(ang) < 0 (far side)
      const drawPlanet = () => {
        const pr = Math.max(3.5, rOrb * 0.05);
        const grd = g.createRadialGradient(px - pr * 0.4, py - pr * 0.4, 0, px, py, pr);
        grd.addColorStop(0, '#9fd3ff'); grd.addColorStop(1, '#2c5c8a');
        g.fillStyle = grd;
        g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
      };
      if (Math.sin(ang) < 0) drawPlanet();
      const sr = Math.max(10, rOrb * 0.17);
      const halo = g.createRadialGradient(sx, sy, 0, sx, sy, sr * 3.2);
      halo.addColorStop(0, 'rgba(255,226,180,0.55)'); halo.addColorStop(1, 'rgba(255,226,180,0)');
      g.fillStyle = halo; g.beginPath(); g.arc(sx, sy, sr * 3.2, 0, Math.PI * 2); g.fill();
      const core = g.createRadialGradient(sx - sr * 0.3, sy - sr * 0.3, 0, sx, sy, sr);
      core.addColorStop(0, '#fff6e6'); core.addColorStop(1, '#ffc27a');
      g.fillStyle = core; g.beginPath(); g.arc(sx, sy, sr, 0, Math.PI * 2); g.fill();
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
      // observer: line of sight to the VLT
      const obsY = oy + rOrb * 0.42 + (small ? 34 : 60);
      g.strokeStyle = FAINT; g.setLineDash([2, 4]);
      g.beginPath(); g.moveTo(sx, sy + sr); g.lineTo(ox, obsY - 16); g.stroke(); g.setLineDash([]);
      drawTelescope(g, ox, obsY);
      g.fillStyle = MUTED; g.font = `500 10.5px ${FONT}`; g.textAlign = 'center';
      g.fillText('ESO VLT · ESPRESSO', ox, obsY + 30);
      g.fillStyle = FAINT; g.font = `500 9.5px ${FONT}`;
      g.fillText('orbit seen almost edge-on · wobble exaggerated', ox, oy - rOrb * 0.42 - 16);
      g.restore();

      // ── (b) spectrum recorded by the spectrograph ──────────────────────────
      const sx0 = rx + 8, sw = rw - 16;
      const shiftPx = (vStar / Math.max(K, 1e-9)) * Math.min(9, sw * 0.012);
      g.save();
      const spec = g.createLinearGradient(sx0, 0, sx0 + sw, 0);
      ['#5a3fa8', '#2f6fd0', '#2fb0b8', '#5fc46a', '#e3d34a', '#f09a3a', '#d8483a'].forEach((col, k, arr) => spec.addColorStop(k / (arr.length - 1), col));
      g.globalAlpha = 0.55;
      g.fillStyle = spec;
      g.beginPath(); g.roundRect(sx0, specY, sw, specH, 6); g.fill();
      g.globalAlpha = 1;
      // rest-frame ticks
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1;
      for (const l of LINES) { const X = sx0 + l * sw; g.beginPath(); g.moveTo(X, specY - 5); g.lineTo(X, specY); g.stroke(); }
      // absorption lines, Doppler-shifted
      g.fillStyle = 'rgba(5,7,14,0.88)';
      for (const l of LINES) {
        const X = sx0 + l * sw + shiftPx;
        g.fillRect(X - 1.6, specY + 1, 3.2, specH - 2);
      }
      g.fillStyle = vStar < 0 ? COLD : HOT;
      g.globalAlpha = Math.min(1, Math.abs(vStar) / Math.max(K, 1e-9));
      g.font = `600 11px ${FONT}`; g.textAlign = 'left';
      g.fillText(vStar < 0 ? '← blueshift: star approaching' : 'redshift: star receding →', sx0, specY - 9);
      g.globalAlpha = 1;
      g.fillStyle = MUTED; g.textAlign = 'left'; g.font = `500 10.5px ${FONT}`;
      g.fillText(small ? 'ESPRESSO spectrum (shifts ×10⁸)' : 'ESPRESSO spectrum of the star (line shifts exaggerated ~10⁸×)', sx0, specY - 27);
      g.fillStyle = FAINT; g.font = `500 9.5px ${FONT}`;
      g.fillText(small ? `real Δλ/λ ≈ ${(K / 2.998e8).toExponential(1)}` : `real Δλ/λ = v/c ≈ ${(K / 2.998e8).toExponential(1)} — measured from thousands of lines at once`, sx0, specY + specH + 15);
      g.restore();

      // ── (c) RV curve with measurements ──────────────────────────────────────
      const cx0 = rx + 46, cw = rw - 60, cy0 = curveY + 10, ch = curveH - 34;
      const vMax = Math.max(K + 2.2 * d.sigmaRV, K * 1.4, 0.2);
      const X = (ph: number) => cx0 + ph * cw;               // two orbital periods
      const Y = (v: number) => cy0 + ch / 2 - (v / vMax) * (ch / 2);
      g.save();
      g.strokeStyle = GRID; g.lineWidth = 1;
      for (const v of [-vMax, -vMax / 2, 0, vMax / 2, vMax]) { g.beginPath(); g.moveTo(cx0, Y(v)); g.lineTo(cx0 + cw, Y(v)); g.stroke(); }
      g.fillStyle = MUTED; g.font = `500 10px ${MONO}`; g.textAlign = 'right';
      for (const v of [-vMax, 0, vMax]) g.fillText(`${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`, cx0 - 6, Y(v) + 3);
      g.save(); g.translate(rx + 10, cy0 + ch / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillStyle = MUTED; g.font = `500 10.5px ${FONT}`;
      g.fillText('radial velocity [m/s]', 0, 0); g.restore();
      g.textAlign = 'center'; g.fillText('time → (two orbits)', cx0 + cw / 2, cy0 + ch + 18);
      // ±σ_K envelope of the fitted curve
      g.fillStyle = 'rgba(232,106,48,0.10)';
      g.beginPath();
      for (let k = 0; k <= 160; k++) { const u = k / 160; g.lineTo(X(u), Y((K + sK) * Math.cos(4 * Math.PI * u))); }
      for (let k = 160; k >= 0; k--) { const u = k / 160; g.lineTo(X(u), Y(Math.max(0, K - sK) * Math.cos(4 * Math.PI * u))); }
      g.closePath(); g.fill();
      // true curve
      g.strokeStyle = HOT; g.lineWidth = 2;
      g.beginPath();
      for (let k = 0; k <= 200; k++) { const u = k / 200; const yy = Y(K * Math.cos(4 * Math.PI * u)); k ? g.lineTo(X(u), yy) : g.moveTo(X(u), yy); }
      g.stroke();
      // measurements (shown: up to 40 of the N_RV epochs)
      const key = `${d.nRV}:${d.sigmaRV}`;
      if (key !== epochKey) {
        epochKey = key;
        const r = mulberry32(31);
        const n = Math.min(40, d.nRV);
        epochs = Array.from({ length: n }, () => ({ t: r(), z: Math.sqrt(-2 * Math.log(Math.max(r(), 1e-9))) * Math.cos(2 * Math.PI * r()) }))
          .sort((a, b) => a.t - b.t);
      }
      const now = (phase0 % 2) / 2;       // cursor over the two plotted periods
      for (const ep of epochs) {
        if (ep.t > now) continue;
        const v = K * Math.cos(4 * Math.PI * ep.t) + d.sigmaRV * ep.z;
        const xx = X(ep.t), yy = Y(Math.max(-vMax * 1.1, Math.min(vMax * 1.1, v)));
        g.strokeStyle = 'rgba(233,237,244,0.45)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(xx, Y(v - d.sigmaRV)); g.lineTo(xx, Y(v + d.sigmaRV)); g.stroke();
        g.fillStyle = '#070A12'; g.beginPath(); g.arc(xx, yy, 3.8, 0, Math.PI * 2); g.fill();
        g.fillStyle = INK; g.beginPath(); g.arc(xx, yy, 2.6, 0, Math.PI * 2); g.fill();
      }
      // cursor
      g.strokeStyle = 'rgba(246,236,222,0.5)'; g.setLineDash([2, 4]);
      g.beginPath(); g.moveTo(X(now), cy0); g.lineTo(X(now), cy0 + ch); g.stroke(); g.setLineDash([]);
      g.fillStyle = vStar < 0 ? COLD : HOT;
      g.beginPath(); g.arc(X(now), Y(K * Math.cos(4 * Math.PI * now)), 4.5, 0, Math.PI * 2); g.fill();
      // K annotation
      const xa = X(0.5);
      g.strokeStyle = INK; g.fillStyle = INK; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(xa, Y(0)); g.lineTo(xa, Y(K)); g.stroke();
      g.beginPath(); g.moveTo(xa - 4, Y(K) + 5); g.lineTo(xa, Y(K)); g.lineTo(xa + 4, Y(K) + 5); g.stroke();
      g.font = `600 11.5px ${FONT}`; g.textAlign = 'left';
      g.fillText(`K = ${K.toFixed(2)} m/s`, xa + 7, Y(K / 2) + 4);
      g.fillStyle = MUTED; g.font = `500 10px ${FONT}`;
      g.fillText(`each point ±${d.sigmaRV.toFixed(1)} m/s · showing ${epochs.length} of ${d.nRV}`, cx0 + 4, cy0 + 12);
      g.restore();
    }

    function loop(now: number) {
      raf = 0;
      if (!visible) return;
      const dt = last < 0 ? 0 : Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!reducedMotion) phase0 += dt * 0.11;
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
    aria-label="Animation: a planet and its star orbit their common centre of mass; the star's line-of-sight motion Doppler-shifts its spectrum, producing a sinusoidal radial-velocity curve with semi-amplitude K." />;
}

function drawTelescope(g: CanvasRenderingContext2D, x: number, y: number) {
  g.save();
  g.translate(x, y);
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
