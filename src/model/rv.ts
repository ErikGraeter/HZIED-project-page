// RV follow-up and the normalized-density HZIED test.
//
// Ports of the pipeline pieces used here (validated in tests/rv.test.ts):
//   src/mr_reference.py   project_onto_curve      orthogonal projection onto a
//                                                  Zeng+2016 rocky M–R relation
//                                                  (Euclidean metric in M⊕, R⊕).
//                         Default: pure MgSiO₃, the generator's rocky baseline,
//                         so bare rocky planets have ρ_norm ≈ 1.
//   src/pipeline.py       _rv_sigma_M_frac        σ_M/M ≈ σ_K/K, σ_K = √(2/N_RV) σ_RV
//                         _apply_mass_noise       M_obs = M (1 + σ_M/M z), clipped at
//                                                  M_min, planets with M_obs > M_max dropped
//   bioverse/custom.py    magma_ocean_ttest       one-sided Welch t-test, cold > hot
//
// Difference from the pipeline's density branch (by design, as requested):
// the reference point is projected from the *measured* (M_obs, R_obs) in every
// Monte Carlo draw, so ρ_norm = ρ_obs / ρ_ref(M_obs, R_obs) carries the full
// covariance between the measured density and its reference.  The pipeline
// instead draws ρ_obs ~ N(ρ_true, σ_ρ) and divides by ρ_ref(M_true, R_true).

import { mulberry32 } from './rng';

export interface RvPlanets {
  M: number[]; R: number[]; R_orig: number[]; S_abs: number[]; P: number[];
  M_st: number[]; T_eff_st: number[]; steam: boolean[]; seed: number[];
}

export interface RvBlock {
  sample: string;
  mission_duration_yr: number;
  M_min: number; M_max: number; depth_min_ppm: number;
  sigma_R: number;
  seeds: number[];
  primary_seed: number;
  S_thresh: number;
  rho_earth: number;
  k_prefactor_mps: number;
  defaults: { optimistic_sigma_M_frac: number; sigma_RV_mps: number; N_RV: number; e: number };
  /** Reference M–R relations from mr_reference.get_reference_curve, keyed by composition. */
  curves: Record<string, { M: number[]; R: number[]; label: string }>;
  /** Composition matching the generator's rocky baseline (Zeng+2016 MgSiO₃). */
  reference_default: string;
  planets: RvPlanets;
}

export type Scenario = 'optimistic' | 'pessimistic';

export interface RvParams {
  optFrac: number;     // optimistic σ_M/M
  sigmaRV: number;     // m/s
  nRV: number;         // observations per planet
  e: number;           // eccentricity used in K
  comp: string;        // reference composition for ρ_norm
}

// ── orthogonal projection (mr_reference.project_onto_curve) ──────────────────

/** Projection of (M, R) onto the curve: argmin of the squared distance with
 * parabolic sub-grid refinement, found by a local descent from the node
 * nearest in mass (the distance is unimodal near the curve). */
export function projectOntoCurve(M: number, R: number, cM: number[], cR: number[]): { M_ref: number; R_ref: number } {
  const n = cM.length;
  const d2 = (i: number) => { const a = M - cM[i], b = R - cR[i]; return a * a + b * b; };
  // start at the node nearest in mass (log grid → binary search)
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cM[mid] <= M) lo = mid; else hi = mid; }
  let i = d2(lo) <= d2(hi) ? lo : hi;
  let di = d2(i);
  for (;;) {
    if (i > 0 && d2(i - 1) < di) { i -= 1; di = d2(i); continue; }
    if (i < n - 1 && d2(i + 1) < di) { i += 1; di = d2(i); continue; }
    break;
  }
  if (i > 0 && i < n - 1) {
    const y0 = d2(i - 1), y1 = di, y2 = d2(i + 1);
    const denom = y0 - 2 * y1 + y2;
    if (denom !== 0) {
      const delta = Math.max(-1, Math.min(1, (0.5 * (y0 - y2)) / denom));
      if (delta >= 0) return { M_ref: (1 - delta) * cM[i] + delta * cM[i + 1], R_ref: (1 - delta) * cR[i] + delta * cR[i + 1] };
      return { M_ref: (1 + delta) * cM[i] - delta * cM[i - 1], R_ref: (1 + delta) * cR[i] - delta * cR[i - 1] };
    }
  }
  return { M_ref: cM[i], R_ref: cR[i] };
}

export function rhoNorm(M: number, R: number, rv: RvBlock, comp = rv.reference_default): number {
  const c = rv.curves[comp] ?? rv.curves[rv.reference_default];
  const { M_ref, R_ref } = projectOntoCurve(M, R, c.M, c.R);
  return (M / (R * R * R)) / (M_ref / (R_ref * R_ref * R_ref));
}

// ── RV semi-amplitude and mass precision (pipeline._rv_sigma_M_frac) ─────────

export function semiAmplitude(Mp: number, P_days: number, M_st: number, e: number, pref = 0.0895): number {
  const ee = Math.min(0.95, Math.max(0, e));
  return pref * Mp * Math.pow(P_days / 365.25, -1 / 3) * Math.pow(M_st, -2 / 3) / Math.sqrt(1 - ee * ee);
}

export const sigmaK = (sigmaRV: number, nRV: number) => Math.sqrt(2 / nRV) * sigmaRV;

export function sigmaMFrac(rv: RvBlock, i: number, sc: Scenario, p: RvParams): number {
  if (sc === 'optimistic') return p.optFrac;
  const K = semiAmplitude(rv.planets.M[i], rv.planets.P[i], rv.planets.M_st[i], p.e, rv.k_prefactor_mps);
  return sigmaK(p.sigmaRV, p.nRV) / K;
}

// ── statistics ────────────────────────────────────────────────────────────────

function lgamma(x: number): number {
  // Lanczos approximation
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 300, EPS = 3e-16, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta function I_x(a, b). */
export function betainc(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Upper tail of Student's t: P(T > t) for dof ν. */
export function tSurvival(t: number, nu: number): number {
  const x = nu / (nu + t * t);
  const half = 0.5 * betainc(x, nu / 2, 0.5);
  return t >= 0 ? half : 1 - half;
}

/** Inverse standard-normal survival: z with P(Z > z) = p (Acklam's algorithm). */
export function zFromP(p: number): number {
  if (!(p > 0)) return 8.5;
  if (p >= 1) return -8.5;
  const q = 1 - p;   // z = Φ⁻¹(q)
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  // work with the smaller tail for accuracy
  const tail = Math.min(p, q);
  let z: number;
  if (tail < pl) {
    const r = Math.sqrt(-2 * Math.log(tail));
    z = (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1);
    // z is now Φ⁻¹(tail) (negative)
    return p < q ? -z : z;
  }
  const r = q - 0.5, s = r * r;
  z = ((((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r) / (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1);
  return z;
}

export interface Welch { t: number; dof: number; p: number; sigma: number; muCold: number; muHot: number; nCold: number; nHot: number }

/** One-sided Welch t-test, alternative: mean(cold) > mean(hot). */
export function welchGreater(cold: number[], hot: number[]): Welch | null {
  const n1 = cold.length, n2 = hot.length;
  if (n1 < 3 || n2 < 3) return null;   // magma_ocean_ttest: min_planets_per_side = 3
  const m1 = cold.reduce((a, b) => a + b, 0) / n1;
  const m2 = hot.reduce((a, b) => a + b, 0) / n2;
  const v1 = cold.reduce((a, b) => a + (b - m1) ** 2, 0) / (n1 - 1);
  const v2 = hot.reduce((a, b) => a + (b - m2) ** 2, 0) / (n2 - 1);
  const s1 = v1 / n1, s2 = v2 / n2;
  const se = Math.sqrt(s1 + s2);
  const t = (m1 - m2) / se;
  const dof = (s1 + s2) ** 2 / ((s1 * s1) / (n1 - 1) + (s2 * s2) / (n2 - 1));
  const p = tSurvival(t, dof);
  return { t, dof, p, sigma: zFromP(p), muCold: m1, muHot: m2, nCold: n1, nHot: n2 };
}

// ── one simulated observation of a set of planets ───────────────────────────

export interface Observed { idx: number[]; rho: number[]; hot: boolean[] }

/**
 * Observe planets `idx`: M_obs = M(1 + σ_M/M z_M) clipped at M_min and dropped
 * if > M_max; R_obs = R(1 + σ_R/R z_R); ρ_norm from the projection of the
 * measured point.  `normal()` supplies the Gaussian draws.
 */
export function observe(rv: RvBlock, idx: number[], sc: Scenario, p: RvParams, normal: () => number, nullTest = false): Observed {
  const out: Observed = { idx: [], rho: [], hot: [] };
  const { M, S_abs } = rv.planets;
  // null test: no steam inflation anywhere (rocky radii only)
  const R = nullTest ? rv.planets.R_orig : rv.planets.R;
  for (const i of idx) {
    const zM = normal(), zR = normal();
    const sm = sigmaMFrac(rv, i, sc, p);
    const Mo = Math.max(rv.M_min, M[i] * (1 + sm * zM));
    if (Mo > rv.M_max) continue;
    const Ro = R[i] * (1 + rv.sigma_R * zR);
    if (!(Ro > 0.1)) continue;
    out.idx.push(i);
    out.rho.push(rhoNorm(Mo, Ro, rv, p.comp));
    out.hot.push(S_abs[i] > rv.S_thresh);
  }
  return out;
}

export function testObserved(o: Observed): Welch | null {
  const cold: number[] = [], hot: number[] = [];
  o.rho.forEach((r, k) => (o.hot[k] ? hot : cold).push(r));
  return welchGreater(cold, hot);
}

export function gaussian(seed: number): () => number {
  const r = mulberry32(seed);
  let spare: number | null = null;
  return () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0, v = 0, s = 0;
    do { u = 2 * r() - 1; v = 2 * r() - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const f = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * f;
    return u * f;
  };
}

/** Seeded permutation of 0..n-1 (survey arrival order of one realization). */
export function permutation(n: number, seed: number): number[] {
  const r = mulberry32(seed);
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Per-planet spread of ρ_norm under a scenario (Monte Carlo, repeated projections). */
export function rhoSpread(rv: RvBlock, sc: Scenario, p: RvParams, draws = 160, seed = 77): { mean: number[]; sd: number[]; sigmaM: number[] } {
  const n = rv.planets.M.length;
  const mean: number[] = new Array(n).fill(NaN);
  const sd: number[] = new Array(n).fill(NaN);
  const sigmaM: number[] = new Array(n);
  const normal = gaussian(seed);
  for (let i = 0; i < n; i++) {
    sigmaM[i] = sigmaMFrac(rv, i, sc, p);
    let s = 0, s2 = 0, k = 0;
    for (let d = 0; d < draws; d++) {
      const Mo = Math.max(rv.M_min, rv.planets.M[i] * (1 + sigmaM[i] * normal()));
      const Ro = rv.planets.R[i] * (1 + rv.sigma_R * normal());
      if (Ro <= 0.1) continue;
      const v = rhoNorm(Mo, Ro, rv, p.comp);
      s += v; s2 += v * v; k++;
    }
    mean[i] = s / k;
    sd[i] = Math.sqrt(Math.max(0, s2 / k - mean[i] * mean[i]));
  }
  return { mean, sd, sigmaM };
}

export interface CurvePoint { n: number; q16: number; q50: number; q84: number; pDetect3: number; valid: number }

/** Sample sizes for the significance curves (log-spaced, ends at the pool size). */
export function sizeGrid(nMax: number, points = 22, n0 = 12): number[] {
  const s = new Set<number>();
  for (let j = 0; j < points; j++) s.add(Math.round(n0 * Math.pow(nMax / n0, j / (points - 1))));
  return [...s].sort((a, b) => a - b);
}

/**
 * Significance at one sample size: `reps` realizations, each a random survey
 * (first n of a seeded permutation of the pooled realizations) observed with
 * fresh noise.  Common random numbers across scenarios (same seeds).
 */
export function significanceAt(rv: RvBlock, n: number, sc: Scenario, p: RvParams, reps: number, nullTest = false): CurvePoint {
  const pool = rv.planets.M.length;
  const sig: number[] = [];
  let det = 0;
  for (let r = 0; r < reps; r++) {
    const perm = permutation(pool, 1000 + r);
    const o = observe(rv, perm.slice(0, n), sc, p, gaussian(50000 + r * 7919 + n), nullTest);
    const w = testObserved(o);
    if (!w) continue;
    sig.push(w.sigma);
    if (w.sigma >= 3) det++;
  }
  sig.sort((a, b) => a - b);
  const q = (f: number) => (sig.length ? sig[Math.min(sig.length - 1, Math.max(0, Math.round(f * (sig.length - 1))))] : NaN);
  return { n, q16: q(0.16), q50: q(0.5), q84: q(0.84), pDetect3: sig.length ? det / sig.length : NaN, valid: sig.length };
}

/** Smallest sample size where the median curve reaches `level` σ (log-interpolated), or null. */
export function crossing(curve: CurvePoint[], level: number): number | null {
  for (let k = 1; k < curve.length; k++) {
    const a = curve[k - 1], b = curve[k];
    if (Number.isFinite(a.q50) && Number.isFinite(b.q50) && a.q50 < level && b.q50 >= level) {
      const f = (level - a.q50) / (b.q50 - a.q50);
      return Math.round(Math.exp(Math.log(a.n) + f * (Math.log(b.n) - Math.log(a.n))));
    }
  }
  if (curve.length && curve[0].q50 >= level) return curve[0].n;
  return null;
}
