// Shared data types.  Column names follow the Bioverse/HZIED pipeline
// (R_orig, S_abs, T_eff_st, ...) so that the website reads like the code it
// visualises.

export interface Table1D {
  mass: number[];
  radius: number[];
}

export interface ModelTables {
  /** PALEOS dry rocky branch (same interior as the steam table). */
  dry: Table1D;
  /** AGNI+PALEOS steam table, keyed by wrr (e.g. "0.005"). */
  steam: Record<string, Table1D>;
  /** Dorn & Lichtenberg (2021) fractional radius change, keyed by wrr. */
  dl21: Record<string, number[]>;
  /** Mass nodes (M⊕) of the DL21 rows. */
  dl21_mass: number[];
}

/** Columnar planet table as exported by scripts/export_hzied_data.py. */
export interface PlanetColumns {
  id: number[];
  M: number[];
  R_orig: number[];
  S_abs: number[];
  R_st: number[];
  /** Uniform draw that decides steam envelopes: has_magmaocean = runaway && u < f_rgh. */
  u: number[];
  P: number[];
  a: number[];
  T_eff_st: number[];
  M_st: number[];
  d: number[];
  SpT: string[];
  /** Pipeline sample of origin (combined samples only), e.g. 'P5' / 'P4'. */
  src?: string[];
  /** Per-planet fractional radius precision (combined samples only). */
  sR?: number[];
}

export interface SampleSummary {
  n_observable: number;
  n_hot: number;
  n_cold: number;
  n_inflated: number;
  mean_R_hot: number | null;
  mean_R_cold: number | null;
  mean_R_orig_hot: number | null;
  mean_R_orig_cold: number | null;
}

export interface Cuts {
  M_min: number; M_max: number; R_min: number; S_min: number; S_max: number;
  depth_min_ppm: number; transiting: boolean;
}

export interface SampleMeta {
  key: string;
  label: string;
  short: string;
  description: string;
  sigma_R: number;
  mission_duration_yr: number | null;
  raw_parquet: string;
  n_raw: number;
  n_superset: number;
  /** Observable cuts of this sample (pipeline _observable_cuts arguments). */
  cuts?: Cuts;
  /** Pipeline samples combined into this one. */
  parts?: string[];
  summary_default: SampleSummary;
}

export interface SampleData {
  meta: SampleMeta;
  planets: PlanetColumns;
}

export interface Provenance {
  generator: string;
  repo_commit: string | null;
  repo_uncommitted_changes: boolean;
  export_date: string;
  inflation_model: string;
  observable_cuts: {
    M_min: number; M_max: number; R_min: number; S_min: number; S_max: number;
    depth_min_ppm: number; transiting: boolean;
  };
  defaults: { S_thresh: number; wrr: number; f_rgh: number; seed: number; use_dl21: boolean };
  wrr_grid: number[];
}

import type { RvBlock } from './rv';

export interface HziedData {
  schema: number;
  provenance: Provenance;
  tables: ModelTables;
  samples: SampleData[];
  /** P5 realizations for the RV follow-up / normalized-density section. */
  rv?: RvBlock;
  /** True when the bundled pipeline export was unavailable and synthetic data is used. */
  synthetic?: boolean;
}

/** User-adjustable scientific parameters. */
export interface ModelParams {
  sample: string;
  S_thresh: number;
  wrr: number;
  f_rgh: number;
  /** Number of observed planets (first N in survey arrival order). */
  N: number;
  /** Add PLATO-like Gaussian radius noise (sigma_R of the sample). */
  noise: boolean;
  /** Visual exaggeration of the steam-envelope thickness in the 3D view only. */
  envelopeScale: number;
}

/** One planet after the inflation model and observable cuts were applied. */
export interface Planet {
  /** Index into the sample's columns. */
  i: number;
  id: number;
  M: number;
  R_orig: number;
  /** Model transit radius (R⊕) after steam inflation. */
  R: number;
  /** Plotted radius: R, or R with radius noise if enabled. */
  R_obs: number;
  S_abs: number;
  runaway: boolean;
  steam: boolean;
  P: number;
  a: number;
  T_eff_st: number;
  M_st: number;
  d: number;
  SpT: string;
  /** Pipeline sample of origin ('P5', 'P4', or the sample key). */
  src: string;
  /** Fractional radius precision used for the optional noise. */
  sR: number;
  /** Position in the (deterministic) survey arrival order. */
  order: number;
}
