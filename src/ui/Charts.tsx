// Section figures (SVG).  Two are data-driven (inflation curves from the model
// tables, radius distributions / evidence curves from the modelled
// population); the outgoing-radiation figure is an explicitly labelled schematic.

import { useMemo, useState } from 'react';
import { scaleLinear, scaleLog } from 'd3-scale';
import type { HziedData, Planet } from '../model/types';
import { inflationFactor } from '../model/inflation';
import { fitAt, type StepFit } from '../model/evidence';
import { COLORS } from '../plot/PlotView';

const W = 560;

function useHoverX() {
  const [hx, setHx] = useState<number | null>(null);
  const handlers = {
    onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      setHx(((e.clientX - r.left) / r.width) * W);
    },
    onPointerLeave: () => setHx(null),
  };
  return [hx, handlers] as const;
}

const path = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');

// ── 1. runaway greenhouse: outgoing radiation saturates (schematic) ────────────
export function OlrSchematic() {
  const H = 300, m = { l: 50, r: 16, t: 18, b: 40 };
  const x = scaleLog().domain([200, 2200]).range([m.l, W - m.r]);
  const y = scaleLinear().domain([0, 620]).range([H - m.b, m.t]);
  // schematic OLR(T_surface) of a water-rich atmosphere (shape after Goldblatt et al. 2013)
  const knots: [number, number][] = [[200, 115], [240, 185], [270, 228], [300, 258], [330, 274], [380, 281], [600, 282], [1000, 282], [1350, 286], [1550, 305], [1750, 375], [2000, 500], [2200, 600]];
  const pts = knots.map(([T, o]) => [x(T), y(o)] as [number, number]);
  const smoothPath = (() => {
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  })();
  const earth = 238, hot = 340;
  return (
    <figure className="figure card">
      <h4>Why there is a threshold</h4>
      <p className="card-sub">Thermal emission of a water-rich atmosphere vs. surface temperature — schematic</p>
      <div className="chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Schematic: outgoing longwave radiation rises with surface temperature, then saturates near 280 W per square metre between about 350 and 1500 K, then rises again.">
          <g className="grid">
            {[100, 200, 300, 400, 500, 600].map((v) => <line key={v} x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} />)}
          </g>
          <rect x={x(360)} y={m.t} width={x(1500) - x(360)} height={H - m.b - m.t} fill="rgba(232,106,48,0.06)" />
          <text className="lbl" x={(x(360) + x(1500)) / 2} y={m.t + 14} textAnchor="middle">no equilibrium for absorbed flux &gt; limit</text>
          <line x1={m.l} x2={W - m.r} y1={y(282)} y2={y(282)} stroke="rgba(246,236,222,0.55)" strokeDasharray="5 5" />
          <text className="lbl-strong" x={m.l + 6} y={y(282) - 8}>limit ≈ 280 W m⁻²</text>
          {/* absorbed fluxes */}
          <line x1={m.l} x2={x(288)} y1={y(earth)} y2={y(earth)} stroke={COLORS.cold} strokeWidth="1.5" />
          <circle cx={x(288)} cy={y(earth)} r="5" fill={COLORS.cold} stroke="#0b1020" strokeWidth="2" />
          <text className="lbl" x={x(288) + 9} y={y(earth) + 16}>absorbed 238 W m⁻² → stable ocean climate</text>
          <line x1={m.l} x2={x(1640)} y1={y(hot)} y2={y(hot)} stroke={COLORS.hot} strokeWidth="1.5" />
          <circle cx={x(1640)} cy={y(hot)} r="5" fill={COLORS.hot} stroke="#0b1020" strokeWidth="2" />
          <text className="lbl" x={x(330)} y={y(hot) - 9}>absorbed 340 W m⁻² → runaway to a molten surface</text>
          <path d={smoothPath} fill="none" stroke={COLORS.ink} strokeWidth="2" strokeLinecap="round" />
          <g className="axis">
            <line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} />
            {[200, 300, 500, 1000, 2000].map((v) => <text key={v} x={x(v)} y={H - m.b + 16} textAnchor="middle">{v}</text>)}
            {[0, 200, 400, 600].map((v) => <text key={v} x={m.l - 8} y={y(v) + 3} textAnchor="end">{v}</text>)}
          </g>
          <text className="lbl" x={(m.l + W - m.r) / 2} y={H - 6} textAnchor="middle">surface temperature [K]</text>
          <text className="lbl" transform={`translate(13 ${(H - m.b + m.t) / 2}) rotate(-90)`} textAnchor="middle">outgoing radiation [W m⁻²]</text>
        </svg>
      </div>
      <figcaption>Schematic after Goldblatt et al. (2013) and Kopparapu et al. (2013); not computed on this page. Above the limit the planet heats until the surface melts and radiates at shorter wavelengths.</figcaption>
    </figure>
  );
}

// ── 2. inflation curves from the model tables ─────────────────────────────────
const RAMP = ['#6b3a1f', '#8e4a22', '#b65d27', '#e0782f', '#ff9a52', '#ffc394'];

export function InflationCurves({ data, fiducial }: { data: HziedData; fiducial: number }) {
  const H = 300, m = { l: 46, r: 92, t: 16, b: 40 };
  const ws = [1e-4, 1e-3, 5e-3, 1e-2, 2e-2, 5e-2].filter((w) => data.tables.steam[String(w)]);
  const masses = useMemo(() => Array.from({ length: 90 }, (_, k) => 0.5 * Math.pow(10, k / 89)), []);
  const curves = useMemo(() => ws.map((w) => masses.map((M) => 100 * (inflationFactor(M, w, data.tables) - 1))), [data, masses]); // eslint-disable-line react-hooks/exhaustive-deps
  const yMax = Math.ceil(Math.max(...curves.flat()) / 5) * 5;
  const x = scaleLog().domain([0.5, 5]).range([m.l, W - m.r]);
  const y = scaleLinear().domain([0, yMax]).range([H - m.b, m.t]);
  const [hx, hv] = useHoverX();
  const hM = hx !== null && hx >= m.l && hx <= W - m.r ? x.invert(hx) : null;
  const lbl = (w: number) => `${(w * 100).toFixed(w < 0.001 ? 2 : w < 0.01 ? 1 : 0)} %`;
  return (
    <figure className="figure card">
      <h4>Radius inflation in the model</h4>
      <p className="card-sub">R<sub>transit</sub> / R<sub>rock</sub> − 1 for a steam envelope, by water-to-rock ratio (AGNI+PALEOS, with DL21)</p>
      <div className="chart-legend">
        {ws.map((w, k) => <span key={w}><i className="lg-line" style={{ borderColor: RAMP[k] }} />{lbl(w)}{w === fiducial ? ' (fiducial)' : ''}</span>)}
      </div>
      <div className="chart">
        <svg viewBox={`0 0 ${W} ${H}`} {...hv} role="img" aria-label="Radius inflation in percent versus planet mass for several water-to-rock ratios; inflation falls with mass.">
          <g className="grid">{y.ticks(5).map((v) => <line key={v} x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} />)}</g>
          {curves.map((c, k) => (
            <path key={k} d={path(c.map((v, i) => [x(masses[i]), y(v)]))} fill="none" stroke={RAMP[k]}
              strokeWidth={ws[k] === fiducial ? 2.6 : 1.6} strokeLinecap="round" />
          ))}
          {/* direct labels at the right end */}
          {(() => {
            const placed: number[] = [];
            const order = ws.map((_, k) => k).sort((a, b) => (ws[a] === fiducial ? -1 : ws[b] === fiducial ? 1 : b - a));
            return order.map((k) => {
              const yy = y(curves[k][curves[k].length - 1]);
              if (placed.some((p) => Math.abs(p - yy) < 12)) return null;
              placed.push(yy);
              return <text key={k} className={ws[k] === fiducial ? 'lbl-strong' : 'lbl'} x={W - m.r + 6} y={yy + 4}>{lbl(ws[k])}</text>;
            });
          })()}
          {hM !== null && (
            <g>
              <line x1={x(hM)} x2={x(hM)} y1={m.t} y2={H - m.b} stroke="rgba(255,255,255,0.3)" />
              {ws.map((w, k) => {
                const v = 100 * (inflationFactor(hM, w, data.tables) - 1);
                return <circle key={k} cx={x(hM)} cy={y(v)} r="3.5" fill={RAMP[k]} stroke="#0b1020" strokeWidth="2" />;
              })}
              <g transform={`translate(${Math.min(x(hM) + 10, W - m.r - 150)} ${m.t + 4})`}>
                <rect width="138" height={22 + 15 * ws.length} rx="8" fill="rgba(8,11,22,0.95)" stroke="rgba(255,255,255,0.14)" />
                <text className="lbl-strong" x="10" y="16">M = {hM.toFixed(2)} M⊕</text>
                {ws.map((w, k) => (
                  <g key={w} transform={`translate(10 ${32 + 15 * k})`}>
                    <rect y="-7" width="8" height="8" rx="2" fill={RAMP[k]} />
                    <text className="lbl" x="14">{lbl(w)}</text>
                    <text className="lbl" x="124" textAnchor="end" style={{ fontFamily: 'var(--mono)' }}>
                      +{(100 * (inflationFactor(hM, w, data.tables) - 1)).toFixed(1)} %
                    </text>
                  </g>
                ))}
              </g>
            </g>
          )}
          <g className="axis">
            <line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} />
            {[0.5, 1, 2, 3, 5].map((v) => <text key={v} x={x(v)} y={H - m.b + 16} textAnchor="middle">{v}</text>)}
            {y.ticks(5).map((v) => <text key={v} x={m.l - 8} y={y(v) + 3} textAnchor="end">{v}</text>)}
          </g>
          <text className="lbl" x={(m.l + W - m.r) / 2} y={H - 6} textAnchor="middle">planet mass [M⊕]</text>
          <text className="lbl" transform={`translate(12 ${(H - m.b + m.t) / 2}) rotate(-90)`} textAnchor="middle">radius inflation [%]</text>
        </svg>
      </div>
      <figcaption>Computed in the browser from the exported model tables (steam/dry radius ratio × Dorn & Lichtenberg 2021 correction), exactly as in <code>magma_ocean_agni_updated</code>. Water dissolving into the magma ocean offsets part of the steam inflation, which is why the low-water curves cross.</figcaption>
    </figure>
  );
}

// ── 3. radius distributions: cold, hot (rocky), hot (transit) ─────────────────
function kde(xs: number[], grid: number[], bw: number): number[] {
  const n = xs.length || 1;
  const c = 1 / (n * bw * Math.sqrt(2 * Math.PI));
  return grid.map((g) => xs.reduce((s, x) => s + Math.exp(-0.5 * ((g - x) / bw) ** 2), 0) * c);
}

export function RadiusDistributions({ planets, S_thresh }: { planets: Planet[]; S_thresh: number }) {
  const H = 290, m = { l: 40, r: 16, t: 18, b: 40 };
  const hot = planets.filter((p) => p.S_abs > S_thresh);
  const cold = planets.filter((p) => p.S_abs <= S_thresh);
  const all = planets.map((p) => p.R_obs);
  const lo = Math.min(...all, ...hot.map((p) => p.R_orig)) - 0.1;
  const hi = Math.max(...all) + 0.1;
  const grid = useMemo(() => Array.from({ length: 160 }, (_, k) => lo + ((hi - lo) * k) / 159), [lo, hi]);
  const sd = (v: number[]) => { const mu = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / v.length); };
  const bw = (v: number[]) => Math.max(0.025, 1.06 * sd(v) * Math.pow(Math.max(v.length, 2), -0.2));
  const series = useMemo(() => [
    { key: 'cold', label: 'cold side', color: COLORS.cold, dash: '', fill: true, vals: cold.map((p) => p.R_obs) },
    { key: 'hotrock', label: 'hot side — rocky radius', color: COLORS.hot, dash: '5 4', fill: false, vals: hot.map((p) => p.R_orig * (p.R_obs / p.R)) },
    { key: 'hot', label: 'hot side — transit radius', color: COLORS.hot, dash: '', fill: true, vals: hot.map((p) => p.R_obs) },
  ].filter((s) => s.vals.length > 1).map((s) => ({ ...s, dens: kde(s.vals, grid, bw(s.vals)), mean: s.vals.reduce((a, b) => a + b, 0) / s.vals.length })),
  [planets, S_thresh, grid]); // eslint-disable-line react-hooks/exhaustive-deps
  const yMax = Math.max(0.1, ...series.flatMap((s) => s.dens)) * 1.12;
  const x = scaleLinear().domain([lo, hi]).range([m.l, W - m.r]);
  const y = scaleLinear().domain([0, yMax]).range([H - m.b, m.t]);
  const [hx, hv] = useHoverX();
  const hk = hx !== null && hx >= m.l && hx <= W - m.r ? Math.round(((hx - m.l) / (W - m.l - m.r)) * (grid.length - 1)) : null;
  return (
    <figure className="figure card">
      <h4>Same planets, shifted distribution</h4>
      <p className="card-sub">Radius distributions of the population shown in the hero (kernel density, {planets.length} planets)</p>
      <div className="chart-legend">
        {series.map((s) => <span key={s.key}><i className="lg-line" style={{ borderColor: s.color, borderTopStyle: s.dash ? 'dashed' : 'solid' }} />{s.label}</span>)}
      </div>
      <div className="chart">
        <svg viewBox={`0 0 ${W} ${H}`} {...hv} role="img" aria-label="Radius distributions: the hot-side transit radii are shifted to larger values than the hot-side rocky radii and the cold side.">
          <g className="grid">{x.ticks(6).map((v) => <line key={v} x1={x(v)} x2={x(v)} y1={m.t} y2={H - m.b} />)}</g>
          {series.map((s) => (
            <g key={s.key}>
              {s.fill && <path d={path([[x(lo), y(0)], ...s.dens.map((d, i) => [x(grid[i]), y(d)] as [number, number]), [x(hi), y(0)]]) + 'Z'} fill={s.color} opacity={0.1} />}
              <path d={path(s.dens.map((d, i) => [x(grid[i]), y(d)]))} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} />
              <line x1={x(s.mean)} x2={x(s.mean)} y1={m.t} y2={m.t + 10} stroke={s.color} strokeWidth="2" strokeDasharray={s.dash ? '2 2' : ''} />
            </g>
          ))}
          {hk !== null && hk >= 0 && hk < grid.length && (
            <g>
              <line x1={x(grid[hk])} x2={x(grid[hk])} y1={m.t} y2={H - m.b} stroke="rgba(255,255,255,0.3)" />
              <g transform={`translate(${Math.min(x(grid[hk]) + 10, W - m.r - 190)} ${m.t + 18})`}>
                <rect width="182" height={22 + 15 * series.length} rx="8" fill="rgba(8,11,22,0.95)" stroke="rgba(255,255,255,0.14)" />
                <text className="lbl-strong" x="10" y="16">R = {grid[hk].toFixed(2)} R⊕</text>
                {series.map((s, k) => (
                  <g key={s.key} transform={`translate(10 ${32 + 15 * k})`}>
                    <rect y="-7" width="8" height="8" rx="2" fill={s.color} opacity={s.dash ? 0.5 : 1} />
                    <text className="lbl" x="14">{s.key === 'cold' ? 'cold' : s.key === 'hot' ? 'hot, transit' : 'hot, rocky'}</text>
                    <text className="lbl" x="170" textAnchor="end" style={{ fontFamily: 'var(--mono)' }}>{s.dens[hk].toFixed(2)}</text>
                  </g>
                ))}
              </g>
            </g>
          )}
          <g className="axis">
            <line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} />
            {x.ticks(6).map((v) => <text key={v} x={x(v)} y={H - m.b + 16} textAnchor="middle">{v.toFixed(1)}</text>)}
          </g>
          <text className="lbl" x={(m.l + W - m.r) / 2} y={H - 6} textAnchor="middle">planet radius [R⊕] — ticks at the top mark the means</text>
          <text className="lbl" transform={`translate(14 ${(H - m.b + m.t) / 2}) rotate(-90)`} textAnchor="middle">density</text>
        </svg>
      </div>
    </figure>
  );
}

// ── 4. evidence vs sample size for the three samples (toy model) ──────────────
export const SAMPLE_COLORS = ['#199e70', '#9085e9'];

export function EvidenceVsN({ curves }: { curves: { label: string; seq: StepFit[] }[] }) {
  const H = 300, m = { l: 44, r: 108, t: 16, b: 40 };
  const nMax = Math.max(...curves.map((c) => c.seq[c.seq.length - 1]?.n ?? 0), 10);
  const ks = curves.flatMap((c) => c.seq.map((s) => s.lnK));
  const x = scaleLog().domain([5, nMax]).range([m.l, W - m.r]);
  const y = scaleLinear().domain([Math.min(-5, ...ks), Math.max(12, ...ks)]).nice().range([H - m.b, m.t]);
  const [hx, hv] = useHoverX();
  const hN = hx !== null && hx >= m.l && hx <= W - m.r ? Math.round(x.invert(hx)) : null;
  return (
    <figure className="figure card">
      <h4>How fast does the evidence grow?</h4>
      <p className="card-sub">Toy ln K (step model with free threshold vs. no step) as the survey grows, fiducial injection S_thresh = 280 W m⁻², wrr = 0.5 %, f_rgh = 0.8</p>
      <div className="chart-legend">
        {curves.map((c, k) => {
          const v = c.seq[c.seq.length - 1]?.lnK ?? 0;
          return <span key={c.label}><i className="lg-line" style={{ borderColor: SAMPLE_COLORS[k] }} />{c.label} · ln K {v >= 0 ? '+' : '−'}{Math.abs(v).toFixed(1)}</span>;
        })}
        <span><i className="lg-line" style={{ borderColor: 'rgba(255,190,140,0.6)', borderTopStyle: 'dashed' }} />strong evidence (ln K = 5)</span>
      </div>
      <div className="chart">
        <svg viewBox={`0 0 ${W} ${H}`} {...hv} role="img" aria-label="Toy-model log Bayes factor versus number of planets for the three samples.">
          <g className="grid">{y.ticks(6).map((v) => <line key={v} x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} />)}</g>
          <line x1={m.l} x2={W - m.r} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.3)" />
          <line x1={m.l} x2={W - m.r} y1={y(5)} y2={y(5)} stroke="rgba(255,190,140,0.6)" strokeDasharray="5 5" />
          {curves.map((c, k) => {
            const pts = c.seq.map((s) => [s.n, s.lnK] as [number, number]).filter(([n]) => n >= 5);
            if (!pts.length) return null;
            const last = pts[pts.length - 1];
            return (
              <g key={c.label}>
                <path d={path(pts.map(([n, v]) => [x(n), y(v)]))} fill="none" stroke={SAMPLE_COLORS[k]} strokeWidth="2" strokeLinejoin="round" />
                <circle cx={x(last[0])} cy={y(last[1])} r="4" fill={SAMPLE_COLORS[k]} stroke="#0b1020" strokeWidth="2" />
                {last[0] === nMax && <text className="lbl" x={x(last[0]) + 8} y={y(last[1]) + 4}>{c.label.split(' (')[0]} {last[1] >= 0 ? '+' : '−'}{Math.abs(last[1]).toFixed(1)}</text>}
              </g>
            );
          })}
          {hN !== null && (
            <g>
              <line x1={x(hN)} x2={x(hN)} y1={m.t} y2={H - m.b} stroke="rgba(255,255,255,0.3)" />
              <g transform={`translate(${Math.min(x(hN) + 10, W - m.r - 150)} ${m.t + 4})`}>
                <rect width="150" height={22 + 15 * curves.length} rx="8" fill="rgba(8,11,22,0.95)" stroke="rgba(255,255,255,0.14)" />
                <text className="lbl-strong" x="10" y="16">N = {hN}</text>
                {curves.map((c, k) => (
                  <g key={c.label} transform={`translate(10 ${32 + 15 * k})`}>
                    <rect y="-7" width="8" height="8" rx="2" fill={SAMPLE_COLORS[k]} />
                    <text className="lbl" x="14">{c.label.split(' (')[0]}</text>
                    <text className="lbl" x="138" textAnchor="end" style={{ fontFamily: 'var(--mono)' }}>
                      {c.seq.length && hN <= c.seq[c.seq.length - 1].n ? (fitAt(c.seq, hN).lnK >= 0 ? '+' : '−') + Math.abs(fitAt(c.seq, hN).lnK).toFixed(1) : '—'}
                    </text>
                  </g>
                ))}
              </g>
            </g>
          )}
          <g className="axis">
            <line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} />
            {[5, 10, 20, 50, 100, 200, 500, 1000, 2000].filter((v) => v <= nMax).map((v) => <text key={v} x={x(v)} y={H - m.b + 16} textAnchor="middle">{v}</text>)}
            {y.ticks(6).map((v) => <text key={v} x={m.l - 8} y={y(v) + 3} textAnchor="end">{v}</text>)}
          </g>
          <text className="lbl" x={(m.l + W - m.r) / 2} y={H - 6} textAnchor="middle">number of observed planets N</text>
          <text className="lbl" transform={`translate(12 ${(H - m.b + m.t) / 2}) rotate(-90)`} textAnchor="middle">ln K (toy)</text>
        </svg>
      </div>
      <figcaption>Illustrative per-planet comparison (H1: a step in mean radius at a free threshold, S_thresh ~ U(10, 1000) W m⁻²; H0: one mean). The thesis analysis fits the Schlecker et al. (2024) step model with nested sampling; its evidence values differ.</figcaption>
    </figure>
  );
}
