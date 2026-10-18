// TypeScript port of the HZIED pipeline's radius-inflation step and
// observable cuts:
//
//   bioverse/custom.py::magma_ocean_agni_updated  (use_dl21=True, Zeng+2016 baseline)
//   src/pipeline.py::_observable_cuts
//
//   R = R_orig × R_steam(M; wrr) / R_dry(M) × (1 + ΔR_DL21(M; wrr))
//
// for planets with S_abs > S_thresh and u < f_rgh and 0.5 ≤ M ≤ 20 M⊕.
// Interpolation reproduces scipy's interp1d(kind='linear'): the steam and dry
// tables extrapolate linearly, the DL21 correction is zero outside its mass
// nodes.  tests/inflation.test.ts checks the port against the pipeline output.

import type { ModelParams, ModelTables, Planet, SampleData } from './types';
import { hash01, hashNormal } from './rng';

export const ORDER_SEED = 8;           // survey arrival order (PAPER_FIDUCIAL seed)
export const NOISE_SEED = 1008;        // radius noise draws
const R_SUN_IN_R_EARTH = 109.2;        // as in pipeline._reapply_inflation

/** Linear interpolation on a sorted grid. */
export function interp(x: number, xs: number[], ys: number[], extrapolate: boolean): number {
  const n = xs.length;
  if (x <= xs[0] || x >= xs[n - 1]) {
    if (!extrapolate && (x < xs[0] || x > xs[n - 1])) return 0;
    const j = x <= xs[0] ? 0 : n - 2;
    return ys[j] + ((ys[j + 1] - ys[j]) * (x - xs[j])) / (xs[j + 1] - xs[j]);
  }
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  return ys[lo] + ((ys[hi] - ys[lo]) * (x - xs[lo])) / (xs[hi] - xs[lo]);
}

export function wrrKey(wrr: number): string {
  // keys are written with Python's '{:g}' format, e.g. 0.0001 → "0.0001", 0.005 → "0.005"
  return String(Number(wrr.toPrecision(6)));
}

/** Multiplicative inflation factor R/R_orig for a steam-envelope planet of mass M. */
export function inflationFactor(M: number, wrr: number, tables: ModelTables, useDl21 = true): number {
  const steam = tables.steam[wrrKey(wrr)];
  if (!steam) throw new Error(`wrr=${wrr} is not in the steam table`);
  const mMax = steam.mass[steam.mass.length - 1];
  if (M < 0.5 || M > mMax) return 1;
  const ratio = interp(M, steam.mass, steam.radius, true) / interp(M, tables.dry.mass, tables.dry.radius, true);
  const dl = useDl21 ? interp(M, tables.dl21_mass, tables.dl21[wrrKey(wrr)], false) : 0;
  return ratio * (1 + dl);
}

export interface ModelResult {
  /** Planets passing the observable cuts, in survey arrival order. */
  observable: Planet[];
  /** Total number passing the cuts before the N cap. */
  nObservable: number;
}

/**
 * Apply the inflation model and observable cuts to a sample, then order the
 * survivors by a deterministic survey-arrival permutation and keep the first N.
 */
export function applyModel(sample: SampleData, tables: ModelTables, params: ModelParams,
                           cuts = { M_min: 0.5, M_max: 5, R_min: 0.75, S_min: 10, S_max: 2000, depth_min: 80e-6 }): ModelResult {
  const c = sample.planets;
  const out: Planet[] = [];
  for (let i = 0; i < c.id.length; i++) {
    const M = c.M[i];
    const S = c.S_abs[i];
    const runaway = S > params.S_thresh;
    const steam = runaway && c.u[i] < params.f_rgh;
    const R = steam ? c.R_orig[i] * inflationFactor(M, params.wrr, tables) : c.R_orig[i];
    const depth = (R / (c.R_st[i] * R_SUN_IN_R_EARTH)) ** 2;
    const pass = M >= cuts.M_min && M <= cuts.M_max && R > cuts.R_min
      && S >= cuts.S_min && S <= cuts.S_max && depth >= cuts.depth_min;
    if (!pass) continue;
    const z = params.noise ? hashNormal(c.id[i], NOISE_SEED) : 0;
    const sR = c.sR?.[i] ?? sample.meta.sigma_R;
    out.push({
      i, id: c.id[i], M, R_orig: c.R_orig[i], R, R_obs: R * (1 + sR * z), sR, src: c.src?.[i] ?? sample.meta.key,
      S_abs: S, runaway, steam: steam && R > c.R_orig[i], P: c.P[i], a: c.a[i],
      T_eff_st: c.T_eff_st[i], M_st: c.M_st[i], d: c.d[i], SpT: c.SpT[i], order: 0,
    });
  }
  // Survey arrival order: a fixed pseudo-random permutation keyed on the planet
  // id, so that the order (and the first-N subsample) is stable when the model
  // parameters change.
  out.sort((p, q) => hash01(p.id, ORDER_SEED) - hash01(q.id, ORDER_SEED));
  const nObservable = out.length;
  const N = Math.max(2, Math.min(params.N, nObservable));
  const observable = out.slice(0, N);
  observable.forEach((p, k) => { p.order = k; });
  return { observable, nObservable };
}
