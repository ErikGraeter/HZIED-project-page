// Measurement-error scenarios: one fixed PLATO population (true values from
// the pipeline export) observed many times with per-planet uncertainties.
//
// Noise model as in the pipeline (hzied_utils.add_measurement_noise,
// pipeline._apply_mass_noise):
//   R space:  R_obs = max(0.5, R + σ_R z_R),  S_obs = max(1, S + σ_S z_S)
//   ρ space:  M_obs = max(M_min, M + σ_M z_M), dropped if M_obs > M_max,
//             ρ_obs = ρ⊕ M_obs / R_obs³,  σ_ρ = ρ_obs √((σ_M/M)² + (3 σ_R/R)²)
// R, S and M noise are independent.  The sample is split at S_obs.

import { hashNormal } from './rng';
import { tSurvival, zFromP } from './rv';

export interface ErrorsData {
  schema: number;
  provenance: { generator: string; repo_commit: string | null; repo_uncommitted_changes: boolean | null; export_date: string };
  config: {
    samples: string[]; mission_duration_yr: number; population_seed: number; age_mode: string;
    S_thresh: number; wrr: number; f_rgh: number; inflation: string; use_dl21: boolean;
    M_min: number; M_max: number; depth_min_ppm: number; exclude_grazing: boolean;
    rv_models: Record<string, Record<string, number>>;
  };
  counts: Record<string, { n: number; cold: number; hot: number }>;
  planets: {
    sample: string[]; S_abs: number[]; R: number[]; R_orig: number[]; M: number[]; P: number[]; M_st: number[]; steam: number[];
    sR_sample: number[]; sR_opt: number[]; sR_nom: number[]; sR_cons: number[];
    sS_req: number[]; sS_pic: number[]; sM_rvopt: number[]; sM_rvpess: number[];
  };
}

export const RHO_EARTH = 5.513;   // g cm⁻³

export type RModel = 'none' | 'goal' | 'sample' | 'opt' | 'nom' | 'cons';
export type SModel = 'none' | 'flat' | 'req' | 'pic';
export type MModel = 'none' | 'const' | 'rvopt' | 'rvpess';
export interface ErrorModels { R: RModel; S: SModel; M: MModel }
export type PresetKey = 'none' | 'goal' | 'optimistic' | 'pessimistic';

export const PRESETS: Record<PresetKey, { label: string; models: ErrorModels; note: string }> = {
  none:        { label: 'No errors',    models: { R: 'none', S: 'none', M: 'none' },
                 note: 'True values: what the population looks like without measurement noise.' },
  goal:        { label: 'Mission goal', models: { R: 'goal', S: 'flat', M: 'const' },
                 note: 'PLATO mission goals for every planet: σ_R/R = 3 %, σ_M/M = 10 %, with σ_S/S = 5 %.' },
  optimistic:  { label: 'Optimistic',   models: { R: 'sample', S: 'flat', M: 'rvopt' },
                 note: 'Pipeline defaults: σ_R/R per sample, σ_S/S = 5 %, RV masses with σ_RV = 0.5 m/s and N_RV = 1000.' },
  pessimistic: { label: 'Pessimistic',  models: { R: 'cons', S: 'pic', M: 'rvpess' },
                 note: 'Per-planet radius model (end-of-life noise, G(k,b), σ_R★/R★ = 2 %), σ_S from the PIC stellar errors, RV masses with σ_RV = 1 m/s and N_RV = 100.' },
};

export const R_LABEL: Record<RModel, string> = {
  none: 'none', goal: 'mission goal · 3 %', sample: 'per sample · P1 1 %, P2 0.8 %, P4 4 %, P5 3 %',
  opt: 'per planet · optimistic (BOL, G = 1)', nom: 'per planet · nominal (BOL, G(k,b), PIC σ_R★)', cons: 'per planet · conservative (EOL, G(k,b))',
};
export const S_LABEL: Record<SModel, string> = {
  none: 'none', flat: 'flat · 5 %', req: 'requirements (2 % R★, 1.5 % T_eff, 10 % M★)', pic: 'PIC stellar errors, propagated',
};
export const M_LABEL: Record<MModel, string> = {
  none: 'none', const: 'mission goal · 10 %', rvopt: 'RV · σ_RV = 0.5 m/s, N_RV = 1000', rvpess: 'RV · σ_RV = 1 m/s, N_RV = 100',
};

export function presetOf(m: ErrorModels): PresetKey | null {
  for (const [k, p] of Object.entries(PRESETS) as [PresetKey, (typeof PRESETS)[PresetKey]][]) {
    if (p.models.R === m.R && p.models.S === m.S && p.models.M === m.M) return k;
  }
  return null;
}

/** Relative uncertainties of every planet for the chosen models. */
export function fractions(d: ErrorsData, m: ErrorModels): { sR: number[]; sS: number[]; sM: number[] } {
  const p = d.planets, n = p.R.length;
  const fill = (v: number) => new Array<number>(n).fill(v);
  const sR = m.R === 'none' ? fill(0) : m.R === 'goal' ? fill(0.03) : m.R === 'sample' ? p.sR_sample
    : m.R === 'opt' ? p.sR_opt : m.R === 'nom' ? p.sR_nom : p.sR_cons;
  const sS = m.S === 'none' ? fill(0) : m.S === 'flat' ? fill(0.05) : m.S === 'req' ? p.sS_req : p.sS_pic;
  const sM = m.M === 'none' ? fill(0) : m.M === 'const' ? fill(0.10) : m.M === 'rvopt' ? p.sM_rvopt : p.sM_rvpess;
  return { sR, sS, sM };
}

export type Space = 'R' | 'rho';

export interface ObsPlanet {
  i: number;           // index into the export
  S: number; y: number;       // observed instellation and R or ρ
  eS: number; eY: number;     // 1σ error bars
  trueHot: boolean; steam: boolean;
}

export interface Realization { planets: ObsPlanet[]; nDropped: number }

const SEED_BASE = 4201;

/** Realization k of the population (k = 0, 1, 2, …), deterministic. */
export function observe(d: ErrorsData, f: ReturnType<typeof fractions>, space: Space, k: number): Realization {
  const p = d.planets, c = d.config;
  const out: ObsPlanet[] = [];
  let nDropped = 0;
  for (let i = 0; i < p.R.length; i++) {
    const zR = hashNormal(i, SEED_BASE + 3 * k), zS = hashNormal(i, SEED_BASE + 3 * k + 1), zM = hashNormal(i, SEED_BASE + 3 * k + 2);
    const R = p.R[i], S = p.S_abs[i], M = p.M[i];
    const sR = f.sR[i] * R, sS = f.sS[i] * S;
    const Ro = Math.max(0.5, R + sR * zR);
    const So = Math.max(1, S + sS * zS);
    const base = { i, S: So, eS: sS, trueHot: S > c.S_thresh, steam: p.steam[i] === 1 };
    if (space === 'R') { out.push({ ...base, y: Ro, eY: sR }); continue; }
    const Mo = Math.max(c.M_min, M + f.sM[i] * M * zM);
    if (Mo > c.M_max) { nDropped++; continue; }
    const rho = (RHO_EARTH * Mo) / Ro ** 3;
    out.push({ ...base, y: rho, eY: rho * Math.hypot(f.sM[i], 3 * f.sR[i]) });
  }
  return { planets: out, nDropped };
}

export interface Side { mu: number; se: number; n: number }
export interface TTest { hot: Side; cold: Side; t: number; dof: number; p: number; sigma: number }

function side(v: number[]): Side {
  const n = v.length;
  const mu = v.reduce((a, b) => a + b, 0) / Math.max(n, 1);
  const s2 = n > 1 ? v.reduce((a, b) => a + (b - mu) ** 2, 0) / (n - 1) : NaN;
  return { mu, se: Math.sqrt(s2 / n), n };
}

/**
 * One-sided Welch t-test at S_thresh (bioverse.custom.magma_ocean_ttest).
 * t > 0 points in the expected direction: hot > cold in R, cold > hot in ρ.
 */
export function tTest(r: Realization, S_thresh: number, space: Space): TTest | null {
  const hotV: number[] = [], coldV: number[] = [];
  for (const q of r.planets) (q.S > S_thresh ? hotV : coldV).push(q.y);
  const hot = side(hotV), cold = side(coldV);
  if (hot.n < 3 || cold.n < 3) return null;   // min_planets_per_side = 3
  const a = hot.se ** 2, b = cold.se ** 2;
  const diff = space === 'R' ? hot.mu - cold.mu : cold.mu - hot.mu;
  const t = diff / Math.sqrt(a + b);
  const dof = (a + b) ** 2 / ((a * a) / (hot.n - 1) + (b * b) / (cold.n - 1));
  const p = tSurvival(t, dof);
  return { hot, cold, t, dof, p, sigma: zFromP(p) };
}

export interface Ensemble { sigma: number[]; p: number[]; median: { t: number; p: number; sigma: number }; f2: number; f3: number; fp05: number; valid: number }

const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2])) : NaN; };

/** t-test over realizations 0 … reps−1. */
export function ensemble(d: ErrorsData, f: ReturnType<typeof fractions>, space: Space, reps: number): Ensemble {
  const sig: number[] = [], ps: number[] = [], ts: number[] = [];
  for (let k = 0; k < reps; k++) {
    const r = tTest(observe(d, f, space, k), d.config.S_thresh, space);
    if (!r) continue;
    sig.push(r.sigma); ps.push(r.p); ts.push(r.t);
  }
  const n = Math.max(sig.length, 1);
  return {
    sigma: sig, p: ps, valid: sig.length,
    median: { t: med(ts), p: med(ps), sigma: med(sig) },
    f2: sig.filter((s) => s >= 2).length / n,
    f3: sig.filter((s) => s >= 3).length / n,
    fp05: ps.filter((p) => p < 0.05).length / n,
  };
}

/** 5th–95th percentile of an array (for compact labels). */
export function range90(v: number[]): [number, number] {
  const s = v.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return [NaN, NaN];
  const q = (x: number) => s[Math.min(s.length - 1, Math.max(0, Math.round(x * (s.length - 1))))];
  return [q(0.05), q(0.95)];
}
export const median = med;
