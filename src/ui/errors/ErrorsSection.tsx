// Section: one PLATO population, observed many times with the measurement
// uncertainties of the thesis (no errors / mission goal / optimistic /
// pessimistic), with an optional Welch t-test at the runaway threshold.

import { useEffect, useMemo, useRef, useState } from 'react';
import { scaleLinear, scaleLog } from 'd3-scale';
import {
  ensemble, fractions, median, observe, presetOf, range90, tTest, PRESETS, R_LABEL, S_LABEL, M_LABEL,
  type ErrorModels, type ErrorsData, type Ensemble, type MModel, type PresetKey, type Realization, type RModel, type SModel, type Space, type TTest,
} from '../../model/errors';

const HOT = '#E86A30', COLD = '#2F9AD0', THRESH = '#EF5350';
const REPS = 300;
const S_MIN = 10, S_MAX = 2000;

const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
export function fmtP(p: number): string {
  if (!Number.isFinite(p)) return '—';
  if (p >= 0.01) return p.toFixed(p >= 0.1 ? 2 : 3);
  const e = Math.floor(Math.log10(p));
  const m = p / 10 ** e;
  return `${m.toFixed(1)}×10${String(e).split('').map((c) => SUP[c]).join('')}`;
}
const pctRange = (v: number[]) => {
  const [a, b] = range90(v);
  if (!Number.isFinite(a)) return '—';
  if (b - a < 0.0005) return `${+(100 * a).toFixed(1)} %`;
  return `${+(100 * a).toFixed(a < 0.1 ? 1 : 0)}–${+(100 * b).toFixed(b < 0.1 ? 1 : 0)} %`;
};

export function ErrorsSection({ data, reducedMotion }: { data: ErrorsData; reducedMotion: boolean }) {
  const cfg = data.config;
  const [models, setModels] = useState<ErrorModels>(PRESETS.optimistic.models);
  const [space, setSpace] = useState<Space>('R');
  const [showTest, setShowTest] = useState(true);
  const [k, setK] = useState(0);
  const [playing, setPlaying] = useState(false);
  const preset = presetOf(models);

  const f = useMemo(() => fractions(data, models), [data, models]);
  const real = useMemo(() => observe(data, f, space, k), [data, f, space, k]);
  const test = useMemo(() => tTest(real, cfg.S_thresh, space), [real, cfg.S_thresh, space]);
  const ens = useMemo(() => ensemble(data, f, space, REPS), [data, f, space]);

  // y range: stable while stepping through realizations
  const yDomain = useMemo<[number, number]>(() => {
    const ys: number[] = [];
    for (let j = 0; j < 30; j++) observe(data, f, space, j).planets.forEach((q) => ys.push(q.y));
    ys.sort((a, b) => a - b);
    const lo = ys[Math.floor(0.01 * (ys.length - 1))], hi = ys[Math.ceil(0.99 * (ys.length - 1))];   // outliers sit on the axis edge
    const pad = 0.06 * (hi - lo || 1);
    return [Math.max(0, lo - pad), hi + pad];
  }, [data, f, space]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setK((v) => v + 1), 1100);
    return () => window.clearInterval(id);
  }, [playing]);

  const setModel = (patch: Partial<ErrorModels>) => setModels((m) => ({ ...m, ...patch }));
  const sampleLabel = cfg.samples.join('+');
  const totalN = data.planets.R.length;

  // medians of the relative uncertainties for each preset (scenario table)
  const table = useMemo(() => (Object.keys(PRESETS) as PresetKey[]).map((key) => {
    const ff = fractions(data, PRESETS[key].models);
    return { key, label: PRESETS[key].label, R: pctRange(ff.sR), S: pctRange(ff.sS), M: pctRange(ff.sM), mR: median(ff.sR) };
  }), [data]);

  const sigmaLine = [
    `σ_R/R = ${pctRange(f.sR)}`,
    `σ_S/S = ${pctRange(f.sS)}`,
    ...(space === 'rho' ? [`σ_M/M = ${pctRange(f.sM)}`] : []),
  ].join(', ');

  return (
    <section className="section err-section" aria-labelledby="errors">
      <div className="section-head">
        <div className="section-num">05 · Measurement errors</div>
        <div>
          <h2 id="errors">One population, many measurements</h2>
          <p className="lede">The planets below are one simulated PLATO yield in true values. Each draw adds the measurement uncertainties of a scenario once. Drawing again shows how much the HZIED step, and the t-test that looks for it, depends on the noise alone.</p>
        </div>
      </div>

      <div className="err-controls" role="group" aria-label="Measurement-error scenario">
        <div className="err-ctl">
          <span className="ctl-k">Scenario</span>
          <div className="seg" role="group" aria-label="Scenario">
            {(Object.keys(PRESETS) as PresetKey[]).map((key) => (
              <button key={key} aria-pressed={preset === key} onClick={() => setModels(PRESETS[key].models)}>{PRESETS[key].label}</button>
            ))}
            {preset === null && <button aria-pressed="true" disabled>Custom</button>}
          </div>
        </div>
        <div className="err-ctl">
          <span className="ctl-k">Observable</span>
          <div className="seg" role="group" aria-label="Observable">
            <button aria-pressed={space === 'R'} onClick={() => setSpace('R')}>Radius R</button>
            <button aria-pressed={space === 'rho'} onClick={() => setSpace('rho')}>Density ρ</button>
          </div>
        </div>
        <div className="err-ctl">
          <span className="ctl-k">Welch t-test</span>
          <div className="seg" role="group" aria-label="Welch t-test">
            <button aria-pressed={showTest} onClick={() => setShowTest(true)}>On</button>
            <button aria-pressed={!showTest} onClick={() => setShowTest(false)}>Off</button>
          </div>
        </div>
        <div className="err-ctl">
          <span className="ctl-k">Noise realization</span>
          <div className="err-draw">
            <button className="btn icon" onClick={() => setK((v) => Math.max(0, v - 1))} disabled={k === 0} aria-label="Previous draw">‹</button>
            <span className="err-k">draw {k + 1}</span>
            <button className="btn icon" onClick={() => setK((v) => v + 1)} aria-label="Next draw">›</button>
            <button className="btn primary" onClick={() => { setPlaying(false); setK((v) => v + 1); }}>Draw again</button>
            <button className="btn" onClick={() => setPlaying((v) => !v)} aria-pressed={playing}>{playing ? 'Pause' : 'Play'}</button>
          </div>
        </div>
      </div>

      <div className="err-models">
        <ModelSelect label="Radius σ_R" value={models.R} options={R_LABEL} onChange={(v) => setModel({ R: v as RModel })} />
        <ModelSelect label="Instellation σ_S" value={models.S} options={S_LABEL} onChange={(v) => setModel({ S: v as SModel })} />
        <ModelSelect label="Mass σ_M" value={models.M} options={M_LABEL} onChange={(v) => setModel({ M: v as MModel })}
          hint={space === 'R' ? 'enters only in density space' : undefined} />
        <p className="err-note">{preset ? PRESETS[preset].note : 'Custom combination of the uncertainty models.'}</p>
      </div>

      <figure className="figure card err-card">
        <h4>{sampleLabel}, {cfg.mission_duration_yr} yr <span className="err-meta">(N = {real.planets.length}{real.nDropped ? `, ${real.nDropped} dropped by M_obs > ${cfg.M_max} M⊕` : ''}; {sigmaLine})</span>
          {showTest && test && <span className="err-stat">t = {test.t.toFixed(1)}, p = {fmtP(test.p)}</span>}
        </h4>
        <div className="chart-legend">
          {showTest && test ? (
            <>
              <span><i className="lg-line" style={{ borderColor: HOT }} />⟨{space === 'R' ? 'R' : 'ρ'}⟩<sub>hot</sub> = {test.hot.mu.toFixed(3)} ± {test.hot.se.toFixed(3)} {space === 'R' ? 'R⊕' : 'g cm⁻³'} (N = {test.hot.n})</span>
              <span><i className="lg-line" style={{ borderColor: COLD }} />⟨{space === 'R' ? 'R' : 'ρ'}⟩<sub>cold</sub> = {test.cold.mu.toFixed(3)} ± {test.cold.se.toFixed(3)} {space === 'R' ? 'R⊕' : 'g cm⁻³'} (N = {test.cold.n})</span>
            </>
          ) : showTest ? <span>t-test needs at least 3 planets per side</span> : null}
          <span><i className="lg-line" style={{ borderColor: THRESH, borderTopStyle: 'dashed' }} />S<sub>thresh</sub> = {cfg.S_thresh} W m⁻²</span>
          <span><i className="lg-dot" style={{ background: HOT }} />truly hot (steam)</span>
          <span><i className="lg-dot" style={{ background: COLD }} />truly cold</span>
        </div>
        <Scatter real={real} test={showTest ? test : null} space={space} yDomain={yDomain} S_thresh={cfg.S_thresh} animate={!reducedMotion} />
        <figcaption>
          Point colours mark the true side of the threshold; the split for the t-test uses the measured instellation, so with σ_S &gt; 0 some planets cross over.
          {space === 'rho' ? ' Density from measured mass and radius, ρ = ρ⊕ M_obs / R_obs³; planets whose measured mass exceeds the mass window are dropped, as in the pipeline.' : ''}
          {' '}One-sided Welch t-test ({space === 'R' ? 'hot > cold' : 'cold > hot'}), as <code>magma_ocean_ttest</code>; bands are ±1 standard error of the mean.
        </figcaption>
      </figure>

      <div className="cols err-cols">
        <EnsembleFigure ens={ens} current={test} reps={REPS} label={preset ? PRESETS[preset].label : 'Custom'} />
        <div>
          <div className="table-scroll">
            <table className="prov err-table">
              <thead><tr><th>Scenario</th><th>σ_R/R</th><th>σ_S/S</th><th>σ_M/M</th></tr></thead>
              <tbody>
                {table.map((r) => (
                  <tr key={r.key} className={preset === r.key ? 'on' : undefined} onClick={() => setModels(PRESETS[r.key].models)}>
                    <td>{r.label}</td><td>{r.R}</td><td>{r.S}</td><td>{r.M}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="err-foot">
            5th–95th percentile over the {totalN} planets. Per-planet values come from the pipeline (<code>measurement_uncertainties.py</code>, <code>pipeline._rv_sigma_M_frac</code>) for a {cfg.mission_duration_yr}-yr LOPS2 pointing.
          </p>
          <div className="prose err-prose">
            <p><strong>Population.</strong> {sampleLabel} around real PIC stars, {cfg.mission_duration_yr}-yr mission, population seed {cfg.population_seed}, {cfg.M_min}–{cfg.M_max} M⊕, transit depth ≥ {cfg.depth_min_ppm} ppm, non-grazing transits, AGNI steam inflation with w<sub>rr</sub> = {cfg.wrr} and f<sub>rgh</sub> = {cfg.f_rgh}. {Object.entries(data.counts).map(([s, c]) => `${s}: ${c.n}`).join(' · ')} planets.</p>
            <p><strong>Noise.</strong> R, S and M get independent Gaussian errors; the covariance through R★ is not modelled. Draw n is reproducible: the same draw number always gives the same measurement.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ModelSelect<T extends string>({ label, value, options, onChange, hint }: { label: string; value: T; options: Record<T, string>; onChange: (v: string) => void; hint?: string }) {
  return (
    <label className="err-field">
      <span>{label}{hint && <small> · {hint}</small>}</span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {(Object.entries(options) as [T, string][]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </label>
  );
}

function useNarrow(ref: React.RefObject<HTMLDivElement | null>, w = 560) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const ro = new ResizeObserver((e) => setNarrow(e[0].contentRect.width < w));
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref, w]);
  return narrow;
}

function Scatter({ real, test, space, yDomain, S_thresh, animate }: { real: Realization; test: TTest | null; space: Space; yDomain: [number, number]; S_thresh: number; animate: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(box);
  const W = narrow ? 420 : 900, H = narrow ? 360 : 440;
  const m = { l: 54, r: 14, t: 12, b: 44 };
  const x = scaleLog().domain([S_MAX, S_MIN]).range([m.l, W - m.r]).clamp(true);
  const y = scaleLinear().domain(yDomain).range([H - m.b, m.t]).clamp(true).nice();
  const xt = narrow ? [1000, 100, 10] : [2000, 1000, 500, 200, 100, 50, 20, 10];
  const tr = animate ? 'transform 0.75s cubic-bezier(.3,.7,.2,1)' : undefined;
  const xT = x(S_thresh);
  const band = (s: { mu: number; se: number }, x0: number, x1: number, c: string) => (
    <g>
      <rect x={x0} width={x1 - x0} y={y(s.mu + s.se)} height={Math.max(1, y(s.mu - s.se) - y(s.mu + s.se))} fill={c} opacity={0.22} />
      <line x1={x0} x2={x1} y1={y(s.mu)} y2={y(s.mu)} stroke={c} strokeWidth={2.2} />
    </g>
  );
  return (
    <div className="chart" ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${space === 'R' ? 'Transit radius' : 'Bulk density'} versus net instellation for one noise realization`}>
        <g className="grid">{y.ticks(6).map((t) => <line key={t} x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} />)}</g>
        {test && band(test.hot, m.l, xT, HOT)}
        {test && band(test.cold, xT, W - m.r, COLD)}
        <line x1={xT} x2={xT} y1={m.t} y2={H - m.b} stroke={THRESH} strokeWidth={1.4} strokeDasharray="6 4" />
        <g>
          {real.planets.map((q) => {
            const px = x(q.S), py = y(q.y);
            const c = q.trueHot ? HOT : COLD;
            const ex0 = x(Math.min(S_MAX, q.S + q.eS)) - px, ex1 = x(Math.max(S_MIN, q.S - q.eS)) - px;
            const ey0 = y(q.y + q.eY) - py, ey1 = y(Math.max(yDomain[0], q.y - q.eY)) - py;
            return (
              <g key={q.i} style={{ transform: `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`, transition: tr }}>
                {q.eS > 0 && <line x1={ex0} x2={ex1} y1={0} y2={0} stroke="rgba(233,237,244,0.28)" strokeWidth={0.8} />}
                {q.eY > 0 && <line x1={0} x2={0} y1={ey0} y2={ey1} stroke="rgba(233,237,244,0.28)" strokeWidth={0.8} />}
                {q.trueHot && !q.steam
                  ? <circle r={3.2} fill="none" stroke={c} strokeWidth={1.3} />
                  : <circle r={3.2} fill={c} fillOpacity={0.9} stroke="#05070b" strokeWidth={0.6} />}
              </g>
            );
          })}
        </g>
        <g className="axis">
          <line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} />
          <line x1={m.l} x2={m.l} y1={m.t} y2={H - m.b} />
          {xt.map((t) => <text key={t} x={x(t)} y={H - m.b + 16} textAnchor="middle">{t}</text>)}
          {y.ticks(6).map((t) => <text key={t} x={m.l - 8} y={y(t) + 3} textAnchor="end">{space === 'R' ? t.toFixed(1) : t}</text>)}
        </g>
        <text className="lbl" x={(m.l + W - m.r) / 2} y={H - 6} textAnchor="middle">Net instellation S (W m⁻²)</text>
        <text className="lbl" transform={`translate(13 ${(H - m.b + m.t) / 2}) rotate(-90)`} textAnchor="middle">{space === 'R' ? 'Transit radius R (R⊕)' : 'Bulk density ρ (g cm⁻³)'}</text>
      </svg>
    </div>
  );
}

function EnsembleFigure({ ens, current, reps, label }: { ens: Ensemble; current: TTest | null; reps: number; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(box, 420);
  const W = narrow ? 400 : 560, H = 280;
  const m = { l: 40, r: 14, t: 14, b: 42 };
  const lo = Math.min(-1, Math.floor(Math.min(...ens.sigma, 0))), hi = Math.max(5, Math.ceil(Math.max(...ens.sigma, 0) + 0.5));
  const x = scaleLinear().domain([lo, hi]).range([m.l, W - m.r]);
  const nb = Math.min(48, Math.max(16, Math.round((hi - lo) * 5)));
  const bw = (hi - lo) / nb;
  const counts = new Array<number>(nb).fill(0);
  ens.sigma.forEach((s) => { counts[Math.min(nb - 1, Math.max(0, Math.floor((s - lo) / bw)))]++; });
  const y = scaleLinear().domain([0, Math.max(...counts, 1)]).range([H - m.b, m.t]).nice();
  return (
    <figure className="figure card">
      <h4>Significance over {reps} noise draws</h4>
      <p className="card-sub">{label}: Welch t-test of each draw converted to a one-sided Gaussian σ. Median t = {ens.median.t.toFixed(1)}, p = {fmtP(ens.median.p)}; p &lt; 0.05 in {Math.round(100 * ens.fp05)} %, ≥ 3σ in {Math.round(100 * ens.f3)} % of the draws.</p>
      <div className="chart" ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Histogram of the detection significance over repeated noise draws">
          <g className="grid">{y.ticks(4).map((t) => <line key={t} x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} />)}</g>
          {counts.map((c, b) => c > 0 && (
            <rect key={b} x={x(lo + b * bw) + 0.5} width={Math.max(1, x(lo + (b + 1) * bw) - x(lo + b * bw) - 1)} y={y(c)} height={y(0) - y(c)} fill="rgba(246,236,222,0.55)" />
          ))}
          {[2, 3].map((s) => s <= hi && (
            <g key={s}>
              <line x1={x(s)} x2={x(s)} y1={m.t} y2={H - m.b} stroke={s === 3 ? 'rgba(255,190,140,0.8)' : 'rgba(255,190,140,0.45)'} strokeDasharray="5 4" />
              <text className="lbl" x={x(s) + 4} y={m.t + 11} style={{ fontSize: 10.5 }}>{s}σ</text>
            </g>
          ))}
          {current && (
            <g>
              <line x1={x(current.sigma)} x2={x(current.sigma)} y1={m.t + 34} y2={H - m.b} stroke={HOT} strokeWidth={2} />
              <text className="lbl-strong" x={x(current.sigma)} y={m.t + 29} textAnchor={x(current.sigma) > W - 90 ? 'end' : 'middle'} style={{ fontSize: 11 }}>this draw: {current.sigma.toFixed(1)}σ</text>
            </g>
          )}
          <g className="axis">
            <line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} />
            {x.ticks(8).map((t) => <text key={t} x={x(t)} y={H - m.b + 16} textAnchor="middle">{t}</text>)}
            {y.ticks(4).map((t) => <text key={t} x={m.l - 6} y={y(t) + 3} textAnchor="end">{t}</text>)}
          </g>
          <text className="lbl" x={(m.l + W - m.r) / 2} y={H - 6} textAnchor="middle">detection significance [σ]</text>
        </svg>
      </div>
    </figure>
  );
}
