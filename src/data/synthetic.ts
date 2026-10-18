// Deterministic synthetic demonstration data.
//
// Used ONLY when src/data/hzied_data.json (the pipeline export) is missing, so
// that the website still runs on a fresh checkout.  The numbers are not
// Bioverse output: a simple power-law M–R relation and an analytic inflation
// factor stand in for the AGNI+PALEOS tables.  The page shows a banner when
// this fallback is active.

import type { HziedData, Table1D } from '../model/types';
import { mulberry32 } from '../model/rng';

const WRR = [1e-4, 1e-3, 5e-3, 1e-2, 2e-2, 3e-2, 4e-2, 5e-2];

export function syntheticData(): HziedData {
  const rnd = mulberry32(8);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rnd(), 1e-12))) * Math.cos(2 * Math.PI * rnd());
  const mass = Array.from({ length: 399 }, (_, k) => +(0.1 + 0.05 * k).toFixed(2));
  const dry: Table1D = { mass, radius: mass.map((m) => Math.pow(m, 0.27)) };
  const steam: Record<string, Table1D> = {};
  const dl21: Record<string, number[]> = {};
  for (const w of WRR) {
    const a = 0.105 + 1.9 * w;
    steam[String(w)] = { mass, radius: mass.map((m) => Math.pow(m, 0.27) * (1 + a * Math.pow(m, -0.45))) };
    dl21[String(w)] = [0, 0, 0, 0];
  }
  const n = 1200;
  const cols = {
    id: [] as number[], M: [] as number[], R_orig: [] as number[], S_abs: [] as number[], R_st: [] as number[],
    u: [] as number[], P: [] as number[], a: [] as number[], T_eff_st: [] as number[], M_st: [] as number[],
    d: [] as number[], SpT: [] as string[],
  };
  const cuts = { M_min: 0.5, M_max: 5, R_min: 0.75, S_min: 10, S_max: 2000, depth_min_ppm: 80, transiting: true };
  for (let i = 0; i < n; i++) {
    const M = 0.5 * Math.pow(10, rnd());
    const S = 15 * Math.pow(10, 2.1 * Math.pow(rnd(), 0.75));
    const T = 3000 + 3000 * rnd();
    cols.id.push(i);
    cols.M.push(M);
    cols.R_orig.push(Math.pow(M, 0.27) * (1 + 0.035 * gauss()));
    cols.S_abs.push(S);
    cols.R_st.push(0.4 + 0.6 * (T - 3000) / 3000);
    cols.u.push(rnd());
    cols.P.push(5 + 300 * rnd());
    cols.a.push(0.03 + 0.8 * rnd());
    cols.T_eff_st.push(T);
    cols.M_st.push(0.3 + 0.7 * (T - 3000) / 3000);
    cols.d.push(10 + 110 * rnd());
    cols.SpT.push(T < 3850 ? 'M' : T < 5200 ? 'K' : 'G');
  }
  return {
    schema: 1,
    synthetic: true,
    provenance: {
      generator: 'synthetic fallback (src/data/synthetic.ts) — NOT Bioverse output',
      repo_commit: null, repo_uncommitted_changes: false, export_date: '—',
      inflation_model: 'analytic stand-in: R_steam/R_dry = 1 + (0.105 + 1.9 wrr) M^-0.45',
      observable_cuts: { M_min: 0.5, M_max: 5, R_min: 0.75, S_min: 10, S_max: 2000, depth_min_ppm: 80, transiting: true },
      defaults: { S_thresh: 280, wrr: 0.005, f_rgh: 0.8, seed: 8, use_dl21: true },
      wrr_grid: WRR,
    },
    tables: { dry, steam, dl21, dl21_mass: [0.3, 0.8, 2.4, 6.7] },
    samples: [{
      meta: {
        key: 'synthetic', label: 'Synthetic demonstration sample', short: 'Synthetic',
        description: 'Deterministic stand-in data (seed 8), used because no pipeline export was found.',
        sigma_R: 0.02, mission_duration_yr: null, raw_parquet: '—', n_raw: n, n_superset: n, cuts,
        summary_default: { n_observable: n, n_hot: 0, n_cold: 0, n_inflated: 0, mean_R_hot: null, mean_R_cold: null, mean_R_orig_hot: null, mean_R_orig_cold: null },
      },
      planets: cols,
    }],
  };
}
