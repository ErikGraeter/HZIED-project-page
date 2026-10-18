// Canvas renderer for the radius – absorbed-flux diagram.
//
// x: absorbed stellar flux S_abs (W m⁻²), logarithmic and REVERSED
//    (left = strongly irradiated / hot, right = weakly irradiated / cold)
// y: planet radius (R⊕)
//
// The static layer (grid, ticks, axis titles) is cached; points, threshold,
// binned means and model fits are drawn every frame from the SceneState.

import { scaleLinear, scaleLog } from 'd3-scale';
import type { Planet } from '../model/types';
import { fitAt, type Bin, type Comparison, type StepDraw, type StepFit } from '../model/evidence';
import type { SceneState, Storyboard } from '../timeline/storyboard';
import { clamp01, smooth } from '../timeline/storyboard';

export const COLORS = {
  hot: '#E86A30',
  cold: '#2F9AD0',
  hotGlow: '255,150,90',
  coldGlow: '110,190,240',
  h0: '#9AA3B2',
  draw: '#E5484D',
  best: '#FF6B5E',
  ink: '#E9EDF4',
  ink2: 'rgba(233,237,244,0.74)',
  muted: 'rgba(233,237,244,0.50)',
  faint: 'rgba(233,237,244,0.32)',
  grid: 'rgba(255,255,255,0.065)',
  surface: '#070A12',
};

const S_EARTH_ABS = 1361 * (1 - 0.3) / 4;   // 238.2 W m⁻², Bioverse convention (A_B = 0.3)
const FONT = '"Inter Variable", Inter, system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

export interface PlotData {
  planets: Planet[];
  S_thresh: number;
  /** Free-threshold fits on a grid of survey sizes. */
  seq: StepFit[];
  /** Fixed-threshold comparison (the descriptive step of the reveal). */
  final: Comparison;
  bins: Bin[];
}

export interface PlotFrame {
  scene: SceneState;
  sb: Storyboard | null;     // null in explore mode (everything final)
  hover: number;
  selected: number;
}

export class PlotView {
  private ctx: CanvasRenderingContext2D;
  private stat: HTMLCanvasElement = document.createElement('canvas');
  private w = 1;
  private h = 1;
  private dpr = 1;
  private m = { l: 58, r: 20, t: 58, b: 56 };
  private x = scaleLog().domain([2500, 8]).range([0, 1]);
  private y = scaleLinear().domain([0.7, 2]).range([1, 0]);
  private data: PlotData | null = null;
  private px = new Float32Array(0);
  private py = new Float32Array(0);
  private pa = new Float32Array(0);
  private sprites = new Map<string, HTMLCanvasElement>();
  private dotR = 2.5;
  private ringW = 1.1;
  /** Canvas offset inside the hero (CSS px). */
  offset = { x: 0, y: 0 };

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(w: number, h: number, dpr: number): void {
    this.w = Math.max(10, w);
    this.h = Math.max(10, h);
    this.dpr = Math.min(dpr, 2);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.m = this.w < 520 ? { l: 46, r: 12, t: 50, b: 62 } : { l: 58, r: 22, t: 58, b: 66 };
    this.updateScales();
  }

  setData(d: PlotData): void {
    this.data = d;
    const n = d.planets.length;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pa = new Float32Array(n);
    this.dotR = Math.max(1.9, Math.min(4.6, 3.3 * Math.sqrt(380 / Math.max(n, 1))));
    this.ringW = n > 900 ? 0.45 : n > 300 ? 0.8 : 1.2;
    this.sprites.clear();
    this.updateScales();
  }

  private updateScales(): void {
    const d = this.data;
    let sMin = 10, rMin = 0.75, rMax = 2.0;
    if (d && d.planets.length) {
      sMin = Math.min(...d.planets.map((p) => p.S_abs));
      rMin = Math.min(...d.planets.map((p) => Math.min(p.R_orig, p.R_obs)));
      rMax = Math.max(...d.planets.map((p) => Math.max(p.R, p.R_obs)));
    }
    const lo = Math.max(3, Math.pow(10, Math.floor(Math.log10(sMin / 1.25) * 4) / 4));
    this.x = scaleLog().domain([2600, lo]).range([this.m.l, this.w - this.m.r]);
    const pad = (rMax - rMin) * 0.06;
    this.y = scaleLinear().domain([Math.floor((rMin - pad) * 20) / 20, Math.ceil((rMax + pad) * 20) / 20])
      .range([this.h - this.m.b, this.m.t]);
    this.drawStatic();
  }

  /** Canvas-relative position of a point. */
  toPx(S: number, R: number) { return { x: this.x(S), y: this.y(R) }; }

  /** Final plot position of planet i in hero coordinates. */
  pointOf(i: number) {
    const p = this.data?.planets[i];
    if (!p) return null;
    return { x: this.offset.x + this.x(p.S_abs), y: this.offset.y + this.y(p.R_obs) };
  }

  private drawStatic(): void {
    const c = this.stat;
    c.width = Math.round(this.w * this.dpr);
    c.height = Math.round(this.h * this.dpr);
    const g = c.getContext('2d')!;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    const [x0, x1] = this.x.range();
    const [y0, y1] = this.y.range();
    const small = this.w < 520;

    // grid
    g.strokeStyle = COLORS.grid;
    g.lineWidth = 1;
    const xt = (small ? [1000, 300, 100, 30, 10] : [2000, 1000, 500, 200, 100, 50, 20, 10, 5]).filter((v) => v <= this.x.domain()[0] && v >= this.x.domain()[1]);
    const yt = this.y.ticks(small ? 5 : 7);
    g.beginPath();
    for (const v of xt) { const X = Math.round(this.x(v)) + 0.5; g.moveTo(X, y1); g.lineTo(X, y0); }
    for (const v of yt) { const Y = Math.round(this.y(v)) + 0.5; g.moveTo(x0, Y); g.lineTo(x1, Y); }
    g.stroke();
    // axes
    g.strokeStyle = 'rgba(255,255,255,0.20)';
    g.beginPath();
    g.moveTo(x0, Math.round(y0) + 0.5); g.lineTo(x1, Math.round(y0) + 0.5);
    g.moveTo(Math.round(x0) + 0.5, y0); g.lineTo(Math.round(x0) + 0.5, y1);
    g.stroke();

    g.font = `500 ${small ? 10 : 11}px ${MONO}`;
    g.fillStyle = COLORS.muted;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    for (const v of xt) g.fillText(String(v), this.x(v), y0 + 7);
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    for (const v of yt) g.fillText(v.toFixed(1), x0 - 8, this.y(v));

    // Earth / Venus instellation markers (A_B = 0.3 convention)
    const marks: [number, string][] = [[S_EARTH_ABS, 'Earth'], [1.911 * S_EARTH_ABS, 'Venus']];
    g.font = `500 ${small ? 9 : 10}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    for (const [s, label] of marks) {
      const X = this.x(s);
      g.fillStyle = COLORS.faint;
      g.beginPath(); g.moveTo(X, y0 + 21); g.lineTo(X - 3, y0 + 26); g.lineTo(X + 3, y0 + 26); g.closePath(); g.fill();
      g.fillText(label, X, y0 + 27);
    }

    // axis titles
    g.fillStyle = COLORS.ink2;
    g.font = `500 ${small ? 11 : 12}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    if (small) {
      g.fillText('← hotter    S_abs [W m⁻²]    colder →', (x0 + x1) / 2, this.h - 4);
    } else {
      g.fillText('Absorbed stellar flux  S_abs  [W m⁻²]', (x0 + x1) / 2, this.h - 4);
      g.font = `500 10.5px ${FONT}`;
      g.fillStyle = COLORS.muted;
      g.textAlign = 'left';
      g.fillText('← hotter', x0, this.h - 4);
      g.textAlign = 'right';
      g.fillText('colder →', x1, this.h - 4);
    }
    g.save();
    g.translate(small ? 12 : 15, (y0 + y1) / 2);
    g.rotate(-Math.PI / 2);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = COLORS.ink2;
    g.font = `500 ${small ? 11 : 12}px ${FONT}`;
    g.fillText('Planet radius  [R⊕]', 0, 0);
    g.restore();
  }

  private sprite(kind: 'hot' | 'hotdry' | 'cold' | 'glowhot' | 'glowcold', r: number): HTMLCanvasElement {
    const key = `${kind}:${r.toFixed(2)}:${this.dpr}`;
    let s = this.sprites.get(key);
    if (s) return s;
    s = document.createElement('canvas');
    const glow = kind.startsWith('glow');
    const R = glow ? r * 6 : r + 2;
    const size = Math.ceil(R * 2 * this.dpr) + 2;
    s.width = s.height = size;
    const g = s.getContext('2d')!;
    g.scale(this.dpr, this.dpr);
    const c = size / this.dpr / 2;
    if (glow) {
      const rgb = kind === 'glowhot' ? COLORS.hotGlow : COLORS.coldGlow;
      const grd = g.createRadialGradient(c, c, 0, c, c, R);
      grd.addColorStop(0, `rgba(${rgb},0.9)`);
      grd.addColorStop(0.18, `rgba(${rgb},0.35)`);
      grd.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = grd;
      g.fillRect(0, 0, size, size);
    } else {
      // surface ring keeps overlapping dots legible (thinner in dense samples)
      g.fillStyle = COLORS.surface;
      g.beginPath(); g.arc(c, c, r + this.ringW, 0, Math.PI * 2); g.fill();
      if (kind === 'hotdry') {
        g.fillStyle = 'rgba(232,106,48,0.22)';
        g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fill();
        g.strokeStyle = COLORS.hot;
        g.lineWidth = Math.max(1, r * 0.45);
        g.beginPath(); g.arc(c, c, r - g.lineWidth / 2, 0, Math.PI * 2); g.stroke();
      } else {
        g.fillStyle = kind === 'hot' ? COLORS.hot : COLORS.cold;
        g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fill();
      }
    }
    this.sprites.set(key, s);
    return s;
  }

  private blit(s: HTMLCanvasElement, x: number, y: number, alpha: number): void {
    if (alpha <= 0.003) return;
    const sz = s.width / this.dpr;
    this.ctx.globalAlpha = Math.min(1, alpha);
    this.ctx.drawImage(s, x - sz / 2, y - sz / 2, sz, sz);
  }

  draw(f: PlotFrame): void {
    const d = this.data;
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, this.w, this.h);
    if (!d) return;
    const sc = f.scene;
    const t = sc.t;
    const sb = f.sb;
    const [x0, x1] = this.x.range();
    const [y0, y1] = this.y.range();
    const xThr = this.x(d.S_thresh);
    const thrIn = xThr > x0 && xThr < x1;

    // side washes
    if (sc.threshold > 0 && thrIn) {
      const a = sc.threshold;
      g.fillStyle = `rgba(232,106,48,${0.045 * a})`;
      g.fillRect(x0, y1, xThr - x0, y0 - y1);
      g.fillStyle = `rgba(47,154,208,${0.045 * a})`;
      g.fillRect(xThr, y1, x1 - xThr, y0 - y1);
    }
    g.drawImage(this.stat, 0, 0, this.w, this.h);

    // ── model fits (behind the points) ─────────────────────────────────────
    const n = d.planets.length;
    const seqN = Math.max(1, Math.min(n, sc.seqN));
    const fit = d.seq.length ? fitAt(d.seq, seqN) : null;
    if (sc.models > 0 && fit) this.drawPosterior(fit, sc.models, sc.select);

    // ── points ───────────────────────────────────────────────────────────────
    const r = this.dotR;
    const sHot = this.sprite('hot', r);
    const sDry = this.sprite('hotdry', r);
    const sCold = this.sprite('cold', r);
    const gHot = this.sprite('glowhot', r);
    const gCold = this.sprite('glowcold', r);
    const pulses: [HTMLCanvasElement, number, number, number][] = [];
    g.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      const p = d.planets[i];
      let alpha = 1;
      let R = p.R_obs;
      let pulse = 0;
      if (sb) {
        const ta = sb.appear[i];
        alpha = smooth(ta, ta + 0.35, t);
        if (alpha <= 0) { this.pa[i] = 0; continue; }
        const R0 = p.R_orig * (p.R_obs / p.R);
        const u = clamp01((t - sb.riseStart[i]) / Math.max(1e-3, sb.riseEnd[i] - sb.riseStart[i]));
        const e = 1 - Math.pow(1 - u, 3);
        R = R0 + (p.R_obs - R0) * e;
        if (p.steam && t < sb.riseEnd[i] + 0.9 && sb.riseEnd[i] > sb.riseStart[i]) {
          // inflation stem: rocky radius → transit radius
          const st = (1 - smooth(sb.riseEnd[i], sb.riseEnd[i] + 0.9, t)) * alpha;
          const X = this.x(p.S_abs);
          g.strokeStyle = `rgba(${COLORS.hotGlow},${0.55 * st})`;
          g.beginPath(); g.moveTo(X, this.y(R0)); g.lineTo(X, this.y(R)); g.stroke();
        }
        pulse = 1 - clamp01((t - ta) / 0.9);
        alpha *= 1 - smooth(sb.fadeOut[i], sb.fadeOut[i] + 0.55, t);
      }
      if (i >= seqN) alpha *= 1 - 0.84 * sc.dimOthers;
      const X = this.x(p.S_abs);
      const Y = this.y(R);
      this.px[i] = X; this.py[i] = Y; this.pa[i] = alpha;
      const hot = p.S_abs > d.S_thresh;
      this.blit(hot ? (p.steam ? sHot : sDry) : sCold, X, Y, alpha);
      if (pulse > 0 && alpha > 0.05) pulses.push([hot ? gHot : gCold, X, Y, pulse * alpha]);
    }
    g.globalCompositeOperation = 'lighter';
    for (const [s, X, Y, a] of pulses) this.blit(s, X, Y, a * 0.85);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;

    if (sc.models > 0 && fit) this.drawPosteriorTop(fit, sc.models, sc.select);

    // ── threshold ──────────────────────────────────────────────────────────
    if (sc.threshold > 0 && thrIn) this.drawThreshold(xThr, sc.threshold, sc.thresholdAlpha, d.S_thresh);

    // ── binned means and the step ──────────────────────────────────────────
    if (sc.bins > 0) this.drawBins(d.bins, sc.bins, 1 - 0.75 * sc.models);
    if (sc.step > 0 && thrIn) this.drawStep(d.final, sc.step, xThr);

    // ── featured planet in progress: ghost marker tracking its radius ──────
    if (sc.ghost && sc.ghost.alpha > 0) {
      const p = d.planets[sc.ghost.planet];
      const R0 = p.R_orig * (p.R_obs / p.R);
      const R = R0 + (p.R_obs - R0) * sc.ghost.inflate;
      this.drawGhost(p, R, R0, sc.ghost.alpha, t, d.S_thresh);
    }

    // ── hover / selection ─────────────────────────────────────────────────
    for (const [idx, strong] of [[f.selected, true], [f.hover, false]] as [number, boolean][]) {
      if (idx < 0 || idx >= n || this.pa[idx] < 0.05) continue;
      const p = d.planets[idx];
      const X = this.px[idx], Y = this.py[idx];
      if (p.steam) {
        const Y0 = this.y(p.R_orig * (p.R_obs / p.R));
        g.setLineDash([2, 3]);
        g.strokeStyle = COLORS.ink2;
        g.beginPath(); g.moveTo(X, Y0); g.lineTo(X, Y); g.stroke();
        g.setLineDash([]);
        g.strokeStyle = COLORS.ink2;
        g.beginPath(); g.arc(X, Y0, 3.2, 0, Math.PI * 2); g.stroke();
      }
      g.strokeStyle = strong ? COLORS.ink : COLORS.ink2;
      g.lineWidth = strong ? 2 : 1.5;
      g.beginPath(); g.arc(X, Y, r + 5, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 1;
    }
  }

  private drawThreshold(X: number, prog: number, alpha: number, S: number): void {
    const g = this.ctx;
    const [y0, y1] = this.y.range();
    const yEnd = y1 + (y0 - y1) * prog;
    g.save();
    g.globalAlpha = alpha;
    // soft glow
    const grd = g.createLinearGradient(X - 14, 0, X + 14, 0);
    grd.addColorStop(0, 'rgba(255,220,180,0)');
    grd.addColorStop(0.5, `rgba(255,220,180,${0.10 * prog})`);
    grd.addColorStop(1, 'rgba(255,220,180,0)');
    g.fillStyle = grd;
    g.fillRect(X - 14, y1, 28, yEnd - y1);
    g.strokeStyle = 'rgba(246,236,222,0.92)';
    g.lineWidth = 1.5;
    g.setLineDash([6, 5]);
    g.beginPath(); g.moveTo(X, y1 - 6); g.lineTo(X, yEnd); g.stroke();
    g.setLineDash([]);
    // label
    const la = smooth(0.45, 1, prog);
    if (la > 0) {
      g.globalAlpha = alpha * la;
      const small = this.w < 520;
      g.textAlign = 'center';
      g.textBaseline = 'bottom';
      g.fillStyle = COLORS.ink;
      g.font = `600 ${small ? 11 : 12.5}px ${FONT}`;
      g.fillText('Runaway greenhouse threshold', X, y1 - 24);
      g.fillStyle = COLORS.muted;
      g.font = `500 ${small ? 9.5 : 10.5}px ${FONT}`;
      g.fillText(`HZ inner edge · S_thresh = ${Math.round(S)} W m⁻²`, X, y1 - 10);
    }
    g.restore();
  }

  private drawBins(bins: Bin[], prog: number, fade: number): void {
    const g = this.ctx;
    const nb = bins.length;
    const shown = prog * nb;
    g.save();
    const base = fade;
    for (const hot of [true, false]) {
      const side = bins.map((b, k) => ({ b, k })).filter(({ b }) => b.hot === hot);
      const col = hot ? COLORS.hot : COLORS.cold;
      // connecting line
      g.strokeStyle = col;
      g.lineWidth = 2;
      g.lineJoin = 'round';
      g.beginPath();
      let started = false;
      for (const { b, k } of side) {
        const a = clamp01(shown - k);
        if (a <= 0) break;
        const X = this.x(b.sMid), Y = this.y(b.mean);
        if (!started) { g.moveTo(X, Y); started = true; } else g.lineTo(X, Y);
      }
      g.globalAlpha = 0.85 * base;
      g.stroke();
      for (const { b, k } of side) {
        const a = clamp01(shown - k);
        if (a <= 0) continue;
        const X = this.x(b.sMid), Y = this.y(b.mean);
        g.globalAlpha = a * base;
        g.strokeStyle = col;
        g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(X, this.y(b.mean - b.se)); g.lineTo(X, this.y(b.mean + b.se)); g.stroke();
        g.fillStyle = COLORS.surface;
        g.beginPath(); g.arc(X, Y, 6.2, 0, Math.PI * 2); g.fill();
        g.fillStyle = col;
        g.beginPath(); g.arc(X, Y, 4.4, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.85)';
        g.lineWidth = 1;
        g.beginPath(); g.arc(X, Y, 4.4, 0, Math.PI * 2); g.stroke();
      }
    }
    g.restore();
  }

  private drawStep(c: Comparison, prog: number, xThr: number): void {
    if (!Number.isFinite(c.muHot) || !Number.isFinite(c.muCold)) return;
    const g = this.ctx;
    const [x0, x1] = this.x.range();
    const yH = this.y(c.muHot);
    const yC = this.y(c.muCold);
    g.save();
    g.globalAlpha = prog;
    g.setLineDash([3, 4]);
    g.lineWidth = 1.2;
    g.strokeStyle = `rgba(${COLORS.hotGlow},0.9)`;
    g.beginPath(); g.moveTo(x0, yH); g.lineTo(xThr, yH); g.stroke();
    g.strokeStyle = `rgba(${COLORS.coldGlow},0.9)`;
    g.beginPath(); g.moveTo(xThr, yC); g.lineTo(x1, yC); g.stroke();
    g.setLineDash([]);
    // bracket
    const bx = xThr + 12;
    g.strokeStyle = COLORS.ink;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(bx - 4, yH); g.lineTo(bx, yH); g.lineTo(bx, yC); g.lineTo(bx - 4, yC);
    g.stroke();
    const dR = c.muHot - c.muCold;
    g.fillStyle = COLORS.ink;
    g.font = `600 ${this.w < 520 ? 11 : 12.5}px ${FONT}`;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    const ym = (yH + yC) / 2;
    g.fillText(`ΔR̄ = ${dR >= 0 ? '+' : '−'}${Math.abs(dR).toFixed(3)} R⊕`, bx + 8, ym - 8);
    g.fillStyle = COLORS.muted;
    g.font = `500 ${this.w < 520 ? 9.5 : 10.5}px ${FONT}`;
    g.fillText(`hot ${c.muHot.toFixed(3)} · cold ${c.muCold.toFixed(3)}`, bx + 8, ym + 8);
    g.restore();
  }

  /** Step function of one H1 draw as a polyline across the plot. */
  private stepPath(dr: StepDraw): [number, number][] {
    const [x0, x1] = this.x.range();
    const xs = Math.min(x1, Math.max(x0, this.x(dr.S)));
    return [[x0, this.y(dr.muHot)], [xs, this.y(dr.muHot)], [xs, this.y(dr.muCold)], [x1, this.y(dr.muCold)]];
  }

  /** H0 line and the 50 red H1 posterior draws (behind the points). */
  private drawPosterior(f: StepFit, a: number, select: number): void {
    const g = this.ctx;
    const [x0, x1] = this.x.range();
    g.save();
    g.globalAlpha = a;
    // H0: a single mean, no step
    if (Number.isFinite(f.mu0)) {
      g.strokeStyle = COLORS.h0;
      g.lineWidth = 1.6;
      g.setLineDash([7, 6]);
      g.beginPath(); g.moveTo(x0, this.y(f.mu0)); g.lineTo(x1, this.y(f.mu0)); g.stroke();
      g.setLineDash([]);
    }
    // H1 posterior draws: step model with a free threshold (as in the thesis Fig. 5)
    g.strokeStyle = COLORS.draw;
    g.lineWidth = 1.1;
    g.lineJoin = 'round';
    g.globalAlpha = a * (0.34 - 0.2 * select);
    for (const dr of f.draws) {
      if (!Number.isFinite(dr.muHot) || !Number.isFinite(dr.muCold)) continue;
      const pts = this.stepPath(dr);
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
    g.restore();
  }

  /** Threshold rug, best fit and labels (above the points). */
  private drawPosteriorTop(f: StepFit, a: number, select: number): void {
    const g = this.ctx;
    const [x0, x1] = this.x.range();
    const [, y1] = this.y.range();
    const small = this.w < 520;
    g.save();
    // rug of the drawn thresholds along the top edge: where the data put the step
    g.globalAlpha = a * 0.7;
    g.strokeStyle = COLORS.draw;
    g.lineWidth = 1;
    g.beginPath();
    for (const dr of f.draws) {
      const X = this.x(dr.S);
      if (X < x0 || X > x1) continue;
      g.moveTo(Math.round(X) + 0.5, y1); g.lineTo(Math.round(X) + 0.5, y1 + 9);
    }
    g.stroke();

    // best fit, drawn on as it is selected
    const b = f.best;
    if (select > 0 && Number.isFinite(b.muHot) && Number.isFinite(b.muCold) && Number.isFinite(b.S)) {
      const pts = this.stepPath(b);
      const segs = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
      const total = segs.reduce((u, v) => u + v, 0);
      let left = total * Math.min(1, select * 1.25);
      const path: [number, number][] = [pts[0]];
      for (let i = 0; i < segs.length && left > 0; i++) {
        const u = Math.min(1, left / Math.max(segs[i], 1e-6));
        path.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u]);
        left -= segs[i];
      }
      const stroke = (w: number, style: string, alpha: number) => {
        g.globalAlpha = a * alpha;
        g.strokeStyle = style;
        g.lineWidth = w;
        g.lineCap = 'round';
        g.lineJoin = 'round';
        g.beginPath();
        path.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.stroke();
      };
      stroke(9, COLORS.draw, 0.16);
      stroke(2.8, COLORS.best, 1);
      stroke(1, 'rgba(255,235,225,0.9)', 0.55);
      // corner marker at the inferred threshold
      const xs = Math.min(x1, Math.max(x0, this.x(b.S)));
      if (select > 0.75) {
        g.globalAlpha = a * smooth(0.75, 1, select);
        g.fillStyle = COLORS.surface;
        g.beginPath(); g.arc(xs, this.y(b.muHot), 6, 0, Math.PI * 2); g.fill();
        g.fillStyle = COLORS.best;
        g.beginPath(); g.arc(xs, this.y(b.muHot), 4, 0, Math.PI * 2); g.fill();
      }
    }

    // direct label for the best fit, with a line key (text stays in ink colours);
    // the H0 line and the posterior draws are identified by the legend only
    g.font = `600 ${small ? 10 : 11}px ${FONT}`;
    g.textBaseline = 'middle';
    const pill = (text: string, x: number, y: number, align: 'left' | 'right', key: string | null, keyW: number, alpha: number) => {
      if (alpha <= 0.01) return;
      g.globalAlpha = a * alpha;
      const tw = g.measureText(text).width;
      const w = tw + 14 + (key ? 20 : 0);
      const xl = align === 'left' ? x : x - w;
      g.fillStyle = 'rgba(7,10,18,0.88)';
      g.fillRect(xl, y - 10, w, 20);
      if (key) {
        g.strokeStyle = key;
        g.lineWidth = keyW;
        g.beginPath(); g.moveTo(xl + 8, y); g.lineTo(xl + 22, y); g.stroke();
      }
      g.fillStyle = COLORS.ink;
      g.textAlign = 'left';
      g.fillText(text, xl + 7 + (key ? 20 : 0), y + 0.5);
    };
    if (select > 0.3 && Number.isFinite(b.S)) {
      const dR = b.muHot - b.muCold;
      const txt = `Best fit · S_thresh ≈ ${Math.round(b.S)} W m⁻² · ΔR̄ = ${dR >= 0 ? '+' : '−'}${Math.abs(dR).toFixed(3)} R⊕`;
      const xs = Math.min(x1, Math.max(x0, this.x(b.S)));
      const right = xs > (x0 + x1) / 2;
      pill(txt, right ? xs - 10 : xs + 10, this.y(Math.max(b.muHot, b.muCold)) - 26, right ? 'right' : 'left', COLORS.best, 2.8, smooth(0.3, 0.8, select));
    }
    g.restore();
  }

  private drawGhost(p: Planet, R: number, R0: number, alpha: number, t: number, S_thresh: number): void {
    const g = this.ctx;
    const X = this.x(p.S_abs);
    const Y = this.y(R);
    const [x0] = this.x.range();
    const [y0] = this.y.range();
    const hot = p.S_abs > S_thresh;
    const rgb = hot ? COLORS.hotGlow : COLORS.coldGlow;
    g.save();
    g.globalAlpha = alpha;
    g.setLineDash([2, 4]);
    g.strokeStyle = `rgba(${rgb},0.55)`;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(x0, Y); g.lineTo(X, Y); g.moveTo(X, Y); g.lineTo(X, y0); g.stroke();
    g.setLineDash([]);
    if (R > R0 + 1e-4) {
      g.strokeStyle = `rgba(${rgb},0.9)`;
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(X, this.y(R0)); g.lineTo(X, Y); g.stroke();
      g.strokeStyle = COLORS.ink2;
      g.lineWidth = 1;
      g.beginPath(); g.arc(X, this.y(R0), 3, 0, Math.PI * 2); g.stroke();
    }
    const pr = 7 + 3 * Math.sin(t * 5);
    g.strokeStyle = `rgba(${rgb},0.95)`;
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(X, Y, pr, 0, Math.PI * 2); g.stroke();
    g.fillStyle = `rgba(${rgb},0.35)`;
    g.beginPath(); g.arc(X, Y, 3.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = COLORS.ink;
    g.font = `600 11.5px ${MONO}`;
    g.textAlign = X > (this.w * 0.6) ? 'right' : 'left';
    g.textBaseline = 'middle';
    const dx = X > this.w * 0.6 ? -14 : 14;
    g.fillText(`R = ${R.toFixed(3)} R⊕`, X + dx, Y - 1);
    g.restore();
  }

  /** Nearest visible point within `radius` px, or -1. */
  hitTest(x: number, y: number, radius = 11): number {
    let best = -1;
    let bd = radius * radius;
    for (let i = 0; i < this.pa.length; i++) {
      if (this.pa[i] < 0.3) continue;
      const dx = this.px[i] - x, dy = this.py[i] - y;
      const dd = dx * dx + dy * dy;
      if (dd < bd) { bd = dd; best = i; }
    }
    return best;
  }

  /** Canvas-relative position of planet i as last drawn. */
  drawnPos(i: number) { return { x: this.px[i], y: this.py[i] }; }
}
