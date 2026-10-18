// Section: RV follow-up → normalized density → how many P5 planets are needed.
// Story: ground-based telescope → stellar wobble → RV measurement → planetary
// mass → normalized density → HZIED detection significance.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { HziedData } from '../../model/types';
import {
  crossing, observe, permutation, rhoNorm, rhoSpread, welchGreater, semiAmplitude, sigmaK, sigmaMFrac, significanceAt, sizeGrid, testObserved,
  type CurvePoint, type RvBlock, type RvParams, type Scenario,
} from '../../model/rv';
import { hashNormal } from '../../model/rng';
import { RvOrbitFigure } from './RvOrbitFigure';
import { DensityFigure } from './DensityFigure';
import { SignificanceFigure, SCEN_COLORS } from './SignificanceFigure';

const REPS = 150;
const STEPS = ['Mass–radius', 'Projection', 'ρ_norm', 'Flux space', 'Measured'];
const STORY = ['Ground-based telescope', 'Stellar wobble', 'RV measurement', 'Planetary mass', 'Normalized density', 'HZIED significance'];

export function RvSection({ data, reducedMotion }: { data: HziedData; reducedMotion: boolean }) {
  const rv = data.rv;
  if (!rv) return null;
  return <RvSectionInner rv={rv} reducedMotion={reducedMotion} />;
}

function RvSectionInner({ rv, reducedMotion }: { rv: RvBlock; reducedMotion: boolean }) {
  const d0 = rv.defaults;
  const defaults: RvParams = { optFrac: d0.optimistic_sigma_M_frac, sigmaRV: d0.sigma_RV_mps, nRV: d0.N_RV, e: d0.e, comp: rv.reference_default };
  const [params, setParams] = useState<RvParams>(defaults);
  const [scenario, setScenario] = useState<Scenario>('optimistic');
  const n = rv.planets.M.length;
  const primary = useMemo(() => rv.planets.seed.map((s, i) => [s, i]).filter(([s]) => s === rv.primary_seed).map(([, i]) => i), [rv]);
  const [nShow, setNShow] = useState(primary.length);
  const [step, setStep] = useState(reducedMotion ? 4 : 0);
  const [curves, setCurves] = useState<{ opt: CurvePoint[]; pess: CurvePoint[]; nul: CurvePoint[]; progress: number }>({ opt: [], pess: [], nul: [], progress: 0 });

  // realization sizes (for the forecast boundary)
  const maxRealization = useMemo(() => {
    const c = new Map<number, number>();
    rv.planets.seed.forEach((s) => c.set(s, (c.get(s) ?? 0) + 1));
    return Math.max(...c.values());
  }, [rv]);

  // display order: the predicted P5 sample first, then the other realizations
  const displayOrder = useMemo(() => {
    const prim = permutation(primary.length, 11).map((k) => primary[k]);
    const others = rv.planets.seed.map((_, i) => i).filter((i) => rv.planets.seed[i] !== rv.primary_seed);
    return [...prim, ...permutation(others.length, 12).map((k) => others[k])];
  }, [rv, primary]);
  const shown = useMemo(() => displayOrder.slice(0, nShow), [displayOrder, nShow]);

  // One fixed measurement per planet, stable as N grows.  Among 31 candidate
  // noise draws we show the representative one: the draw whose significance
  // for the full predicted sample is the median.
  const observeWith = (idx: number[], k: number, sc: Scenario) => {
    const zs: number[] = [];
    idx.forEach((i) => { zs.push(hashNormal(i, 901 + 2 * k), hashNormal(i, 902 + 2 * k)); });
    let c = 0;
    return observe(rv, idx, sc, params, () => zs[c++]);
  };
  const drawK = useMemo(() => {
    const s = Array.from({ length: 31 }, (_, k) => ({ k, sig: testObserved(observeWith(primary, k, scenario))?.sigma ?? -9 }))
      .sort((a, b) => a.sig - b.sig);
    return s[15].k;
  }, [rv, primary, scenario, params]); // eslint-disable-line react-hooks/exhaustive-deps
  const view = useMemo(() => {
    const o = observeWith(shown, drawK, scenario);
    const obs = new Map<number, number>();
    o.idx.forEach((i, j) => obs.set(i, o.rho[j]));
    return { obs, welch: testObserved(o) };
  }, [rv, shown, scenario, params, drawK]); // eslint-disable-line react-hooks/exhaustive-deps
  // noise-free reference: true densities of the predicted sample
  const noiseFree = useMemo(() => {
    const cold: number[] = [], hot: number[] = [];
    primary.forEach((i) => (rv.planets.S_abs[i] > rv.S_thresh ? hot : cold).push(rhoNorm(rv.planets.M[i], rv.planets.R[i], rv, params.comp)));
    return welchGreater(cold, hot);
  }, [rv, primary, params.comp]);
  const spread = useMemo(() => rhoSpread(rv, scenario, params, 120), [rv, scenario, params]);

  // σ_M/M statistics for both scenarios over the predicted sample
  const sigmaStats = useMemo(() => {
    const med = (sc: Scenario) => {
      const v = primary.map((i) => sigmaMFrac(rv, i, sc, params)).sort((a, b) => a - b);
      return v[Math.floor(v.length / 2)];
    };
    return { optimistic: med('optimistic'), pessimistic: med('pessimistic') };
  }, [rv, primary, params]);

  // Monte Carlo significance curves, computed in small chunks after a change
  const job = useRef(0);
  useEffect(() => {
    const id = ++job.current;
    const grid = sizeGrid(n);
    if (!grid.includes(primary.length)) { grid.push(primary.length); grid.sort((a, b) => a - b); }
    const acc = { opt: [] as CurvePoint[], pess: [] as CurvePoint[], nul: [] as CurvePoint[] };
    const tasks: [keyof typeof acc, number][] = [];
    for (const g of grid) { tasks.push(['opt', g], ['pess', g]); }
    for (const g of grid.filter((_, k) => k % 2 === 0)) tasks.push(['nul', g]);
    let k = 0;
    const run = () => {
      if (id !== job.current) return;
      const t0 = performance.now();
      while (k < tasks.length && performance.now() - t0 < 24) {
        const [which, g] = tasks[k++];
        const sc: Scenario = which === 'pess' ? 'pessimistic' : 'optimistic';
        acc[which].push(significanceAt(rv, g, sc, params, which === 'nul' ? 100 : REPS, which === 'nul'));
      }
      setCurves({ opt: [...acc.opt], pess: [...acc.pess], nul: [...acc.nul], progress: k / tasks.length });
      if (k < tasks.length) setTimeout(run, 0);
    };
    const t = setTimeout(run, 120);
    return () => clearTimeout(t);
  }, [rv, params, n, primary.length]);

  const n3 = { optimistic: crossing(curves.opt, 3), pessimistic: crossing(curves.pess, 3) };
  const n2 = { optimistic: crossing(curves.opt, 2), pessimistic: crossing(curves.pess, 2) };
  const atPrimary = (c: CurvePoint[]) => c.find((q) => q.n === primary.length);

  // autoplay of the transformation when the figure first scrolls into view
  const figRef = useRef<HTMLDivElement>(null);
  const played = useRef(false);
  const timers = useRef<number[]>([]);
  const playSteps = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setStep(0);
    [1, 2, 3, 4].forEach((s, k) => timers.current.push(window.setTimeout(() => setStep(s), 1700 + 2300 * k)));
  };
  useEffect(() => {
    if (reducedMotion) return;
    const el = figRef.current!;
    const io = new IntersectionObserver((e) => {
      if (e[0].isIntersecting && !played.current) { played.current = true; playSteps(); }
    }, { threshold: 0.45 });
    io.observe(el);
    return () => { io.disconnect(); timers.current.forEach(clearTimeout); };
  }, [reducedMotion]);

  // example planet for the RV animation: the median-K planet of the P5 sample
  const demoBase = useMemo(() => {
    const ks = primary.map((i) => ({ i, K: semiAmplitude(rv.planets.M[i], rv.planets.P[i], rv.planets.M_st[i], 0, rv.k_prefactor_mps) }))
      .sort((a, b) => a.K - b.K);
    const i = ks[Math.floor(ks.length / 2)].i;
    return { Mp: +rv.planets.M[i].toFixed(2), P: +rv.planets.P[i].toFixed(1), Mst: +rv.planets.M_st[i].toFixed(2) };
  }, [rv, primary]);
  const [demoPl, setDemoPl] = useState(demoBase);
  const demo = { ...demoPl, sigmaRV: params.sigmaRV, nRV: params.nRV, e: params.e, pref: rv.k_prefactor_mps };
  const K = semiAmplitude(demo.Mp, demo.P, demo.Mst, demo.e, demo.pref);
  const sK = sigmaK(params.sigmaRV, params.nRV);

  const set = (patch: Partial<RvParams>) => setParams((p) => ({ ...p, ...patch }));
  const pct = (x: number) => `${(100 * x).toFixed(x < 0.1 ? 1 : 0)} %`;
  const o79 = atPrimary(curves.opt), p79 = atPrimary(curves.pess);

  return (
    <section className="section rv-section" aria-labelledby="rv">
      <div className="section-head">
        <div className="section-num">04 — RV FOLLOW-UP</div>
        <div>
          <h2 id="rv">Weighing PLATO's planets</h2>
          <p className="lede">PLATO measures how large a planet is. Its bulk density — and with it the HZIED in density space — also needs its mass, which only ground-based radial-velocity follow-up can provide.</p>
        </div>
      </div>
      <ol className="story-rail" aria-label="Story of this section">
        {STORY.map((s, k) => <li key={s}><span>{k + 1}</span>{s}</li>)}
      </ol>

      {/* ── Part 1: the RV measurement ─────────────────────────────────── */}
      <div className="rv-grid">
        <div className="card rv-anim-card">
          <h4>A planet tugs on its star — ESPRESSO sees the star move</h4>
          <p className="card-sub">Example: a typical P5 planet (median RV signal of the predicted sample) observed with ESPRESSO at ESO's VLT</p>
          <RvOrbitFigure demo={demo} reducedMotion={reducedMotion} />
        </div>
        <div className="rv-side">
          <div className="prose">
            <p><strong>Radius from PLATO.</strong> A transit dims the star by ΔF/F ≈ (R_p/R⋆)², so photometry gives the radius — for P5 stars to about {Math.round(rv.sigma_R * 100)} %.</p>
            <p><strong>Mass from RV.</strong> Planet and star orbit their common centre of mass. The star's line-of-sight velocity shifts its spectral lines (Doppler effect). A stabilized spectrograph such as <strong>ESPRESSO</strong> on the VLT measures that velocity from thousands of lines at once. For a transiting planet (sin i ≈ 1) the semi-amplitude gives the mass:</p>
            <p className="formula">K = 0.0895 m s⁻¹ · (M_p/M⊕) · (P/1 yr)<sup>−1/3</sup> · (M⋆/M☉)<sup>−2/3</sup> / √(1−e²)</p>
            <p className="formula">σ_M/M ≈ σ_K/K, &nbsp; σ_K ≈ √(2/N_RV) · σ_RV</p>
          </div>
          <div className="rv-readout">
            <div className="stat"><div className="k">semi-amplitude K</div><div className="v">{K.toFixed(2)}<small>m/s</small></div></div>
            <div className="stat"><div className="k">σ_K</div><div className="v">{sK.toFixed(2)}<small>m/s</small></div></div>
            <div className="stat"><div className="k">mass precision σ_M/M</div><div className="v">{pct(sK / K)}</div></div>
          </div>
          <div className="rv-sliders">
            <Slider label="Planet mass" unit="M⊕" min={0.5} max={10} step={0.1} value={demoPl.Mp} onChange={(v) => setDemoPl({ ...demoPl, Mp: v })} />
            <Slider label="Orbital period" unit="d" min={3} max={500} step={1} value={demoPl.P} onChange={(v) => setDemoPl({ ...demoPl, P: v })} />
            <Slider label="Stellar mass" unit="M☉" min={0.4} max={1.5} step={0.01} value={demoPl.Mst} onChange={(v) => setDemoPl({ ...demoPl, Mst: v })} />
            <Slider label="RV precision σ_RV" unit="m/s" min={0.1} max={3} step={0.1} value={params.sigmaRV} onChange={(v) => set({ sigmaRV: v })} />
            <Slider label="RV epochs N_RV" unit="" min={10} max={500} step={10} value={params.nRV} onChange={(v) => set({ nRV: v })} />
          </div>
        </div>
      </div>

      {/* ── Parts 2–4: normalized density and the required sample size ── */}
      <div className="rv-head2">
        <h3>From masses to the HZIED: how many P5 planets are needed?</h3>
        <p>Each planet's measured density is divided by the density of a rock-only planet at the closest point of a rocky mass–radius relation. By default this is the pure-rock (MgSiO₃) relation of Zeng et al. (2016) on which the simulated planets are built, so a bare rocky planet has ρ_norm ≈ 1. The <em>normalized density</em> removes the self-compression trend; a steam envelope pushes it below 1. With measured masses and radii, the projection itself is uncertain, so the uncertainties below come from Monte Carlo draws that re-project every measured planet.</p>
      </div>

      <div className="rv-controls card" role="group" aria-label="RV follow-up scenario">
        <div className="seg" role="group" aria-label="Scenario shown in the density plot">
          <button aria-pressed={scenario === 'optimistic'} onClick={() => setScenario('optimistic')}><i className="lg-dot" style={{ background: SCEN_COLORS.optimistic }} /> Optimistic · σ_M/M = {pct(params.optFrac)}</button>
          <button aria-pressed={scenario === 'pessimistic'} onClick={() => setScenario('pessimistic')}><i className="lg-dot" style={{ background: SCEN_COLORS.pessimistic }} /> Pessimistic · RV-based</button>
        </div>
        <div className="rv-sliders compact">
          <Slider label="Opt. σ_M/M" unit="%" min={2} max={40} step={1} value={Math.round(params.optFrac * 100)} onChange={(v) => set({ optFrac: v / 100 })} />
          <Slider label="σ_RV" unit="m/s" min={0.1} max={3} step={0.1} value={params.sigmaRV} onChange={(v) => set({ sigmaRV: v })} />
          <Slider label="N_RV" unit="" min={10} max={500} step={10} value={params.nRV} onChange={(v) => set({ nRV: v })} />
          <Slider label="eccentricity e" unit="" min={0} max={0.6} step={0.05} value={params.e} onChange={(v) => set({ e: v })} />
          <Slider label="Observed planets N" unit="" min={10} max={n} step={1} value={nShow} onChange={(v) => setNShow(Math.round(v))} strong />
        </div>
        <label className="field ref-field">
          <span>Rocky reference</span>
          <select className="select" value={params.comp} onChange={(e) => set({ comp: e.target.value })} aria-label="Rocky reference relation">
            {Object.entries(rv.curves).map(([k, c]) => <option key={k} value={k}>{c.label}{k === rv.reference_default ? ' — simulated planets' : ''}</option>)}
          </select>
        </label>
        <button className="btn" onClick={() => { setParams(defaults); setNShow(primary.length); }}>Reset</button>
      </div>

      <div className="cols rv-cols">
        <div ref={figRef}>
          <div className="card">
            <div className="step-row">
              {STEPS.map((s, k) => (
                <button key={s} className={`step-chip${k === step ? ' on' : ''}${k < step ? ' done' : ''}`} onClick={() => { timers.current.forEach(clearTimeout); setStep(k); }}>
                  <span>{k + 1}</span>{s}
                </button>
              ))}
              <button className="btn" onClick={playSteps} aria-label="Replay the transformation">↻</button>
            </div>
            <DensityFigure rv={rv} comp={params.comp} primary={primary} shown={shown} obs={view.obs} sd={spread.sd} sigmaM={spread.sigmaM}
              welch={step >= 4 ? view.welch : null} step={step} reducedMotion={reducedMotion} />
            <div className="chart-legend" style={{ marginTop: 8 }}>
              <span><i className="lg-dot" style={{ background: '#E86A30' }} />hot · steam</span>
              <span><i className="lg-ring" />hot · no steam</span>
              <span><i className="lg-dot" style={{ background: '#2F9AD0' }} />cold</span>
              <span><i className="lg-ring" style={{ borderColor: '#9AA3B2', background: 'transparent' }} />forecast planets (other P5 realizations)</span>
            </div>
            <p className="card-sub" style={{ marginTop: 6 }}>
              {step < 4 ? `The predicted P5 sample (seed ${rv.primary_seed}, ${primary.length} planets) in true values.`
                : `${scenario === 'optimistic' ? 'Optimistic' : 'Pessimistic'} follow-up, N = ${nShow}${nShow > primary.length ? ' (incl. forecast planets)' : ''}: one representative simulated measurement (median of 31 noise draws), error bars = Monte Carlo spread of ρ_norm.`}
            </p>
          </div>
        </div>
        <SignificanceFigure opt={curves.opt} pess={curves.pess} nul={curves.nul} nShow={nShow} setN={setNShow}
          primaryN={primary.length} maxRealization={maxRealization} poolN={n} n3={n3} progress={curves.progress} />
      </div>

      <div className="rv-results">
        <div className="card">
          <h4>Mass precision of the P5 planets</h4>
          <div className="stat-row">
            <div className="stat"><div className="k">optimistic</div><div className="v">{pct(sigmaStats.optimistic)}</div></div>
            <div className="stat"><div className="k">pessimistic (median)</div><div className="v">{pct(sigmaStats.pessimistic)}</div></div>
            <div className="stat"><div className="k">ρ_norm spread ({scenario})</div><div className="v">±{median(primary.map((i) => spread.sd[i])).toFixed(2)}</div></div>
          </div>
        </div>
        <div className="card">
          <h4>At N = {primary.length} (size of the predicted P5 sample)</h4>
          <div className="stat-row">
            <div className="stat"><div className="k">optimistic</div><div className="v">{o79 ? `${o79.q50.toFixed(1)}σ` : '…'}</div></div>
            <div className="stat"><div className="k">pessimistic</div><div className="v">{p79 ? `${p79.q50.toFixed(1)}σ` : '…'}</div></div>
            <div className="stat"><div className="k">without noise</div><div className="v">{noiseFree ? `${noiseFree.sigma.toFixed(1)}σ` : '—'}</div></div>
          </div>
        </div>
        <div className="card">
          <h4>Planets needed for a 3σ detection (median)</h4>
          <div className="stat-row">
            <div className="stat"><div className="k">optimistic</div><div className="v">{fmtN(n3.optimistic, n)}</div></div>
            <div className="stat"><div className="k">pessimistic</div><div className="v">{fmtN(n3.pessimistic, n)}</div></div>
            <div className="stat"><div className="k">2σ: opt / pess</div><div className="v" style={{ fontSize: 18 }}>{fmtN(n2.optimistic, n)} / {fmtN(n2.pessimistic, n)}</div></div>
          </div>
        </div>
      </div>
      <div className="prose rv-conclusion">
        <p>{conclusion(curves.progress, n3, n2, primary.length, maxRealization, sigmaStats, o79, p79)}{noiseFree ? ` Without measurement errors the same ${primary.length} planets would show the step at ${noiseFree.sigma.toFixed(1)}σ — it is the mass precision, not the size of the signal, that limits the test.` : ''}</p>
        <p className="card-sub">Simulation: {REPS} realizations per point; each draws N planets from {rv.seeds.length} independent Bioverse realizations of the P5 sample ({n} planets in total; 5-yr mission, 0.5–5 M⊕, depth ≥ 60 ppm, σ_R/R = {Math.round(rv.sigma_R * 100)} %), measures M and R with Gaussian errors, drops planets whose measured mass exceeds 5 M⊕, projects every measured planet onto the chosen rocky relation ({rv.curves[params.comp]?.label}) and applies the one-sided Welch test of the pipeline (magma_ocean_ttest). The planet counts depend on the injected fiducial signal (wrr = 0.5 %, f_rgh = 0.8) and on the steam-table model.</p>
      </div>
    </section>
  );
}

function Slider({ label, unit, min, max, step, value, onChange, strong }: { label: string; unit: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; strong?: boolean }) {
  return (
    <div className={`field${strong ? ' strong' : ''}`}>
      <label>{label} <b>{Number.isInteger(step) ? Math.round(value) : value.toFixed(step < 0.1 ? 2 : 1)}{unit ? ` ${unit}` : ''}</b></label>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

const median = (v: number[]) => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const fmtN = (x: number | null, pool: number) => (x === null ? `> ${pool}` : `≈ ${x}`);

function conclusion(progress: number, n3: Record<Scenario, number | null>, n2: Record<Scenario, number | null>, nPrim: number, nReal: number,
  sig: Record<Scenario, number>, o79?: CurvePoint, p79?: CurvePoint): string {
  if (progress < 1) return 'Simulating the detection significance …';
  const o = n3.optimistic, p = n3.pessimistic;
  const parts: string[] = [];
  parts.push(`With ${Math.round(sig.optimistic * 100)} % mass precision, the HZIED reaches a median 3σ in normalized density at about ${o ?? 'more than the pooled'} P5 planets` +
    (o79 ? ` (${o79.q50.toFixed(1)}σ at N = ${nPrim}, the size of the predicted sample; ${Math.round(100 * o79.pDetect3)} % chance of ≥ 3σ)` : '') + '.');
  parts.push(`With the RV-based pessimistic budget (median σ_M/M ≈ ${Math.round(sig.pessimistic * 100)} %), ` +
    (p ? `about ${p} planets are needed — ${p > nReal ? `far more than one P5 sample provides (≤ ${nReal})` : 'within one P5 sample'}` : 'a 3σ detection is not reached within the simulated pool') +
    (p79 ? `; at N = ${nPrim} the median is ${p79.q50.toFixed(1)}σ` : '') + '.');
  if (n2.pessimistic) parts.push(`Even 2σ needs ≈ ${n2.pessimistic} planets in that case.`);
  return parts.join(' ');
}
