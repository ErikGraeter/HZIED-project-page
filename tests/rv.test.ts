// RV / normalized-density port validated against the pipeline's own functions.
import { describe, expect, it } from 'vitest';
import data from '../src/data/hzied_data.json';
import validation from '../src/data/hzied_validation.json';
import { projectOntoCurve, rhoNorm, sigmaMFrac, welchGreater, zFromP, tSurvival, significanceAt, type RvBlock } from '../src/model/rv';

const rv = (data as unknown as { rv: RvBlock }).rv;
const V = (validation as unknown as { samples: { rv: {
  seed: number; composition: string; M_ref: number[]; R_ref: number[]; rho_ref: number[]; sigma_M_frac_pess: number[];
  zM: number[]; zR: number[]; rho_norm_obs: number[]; keep: boolean[]; t: number; p: number;
} } }).samples.rv;
const primary = rv.planets.seed.map((s, i) => [s, i]).filter(([s]) => s === rv.primary_seed).map(([, i]) => i);

describe('normalized density (mr_reference port)', () => {
  it('projection matches project_onto_curve for the primary P5 sample', () => {
    expect(primary.length).toBe(V.M_ref.length);
    primary.forEach((i, k) => {
      const c = rv.curves[V.composition];
      const { M_ref, R_ref } = projectOntoCurve(rv.planets.M[i], rv.planets.R[i], c.M, c.R);
      expect(Math.abs(M_ref / V.M_ref[k] - 1)).toBeLessThan(1e-4);
      expect(Math.abs(R_ref / V.R_ref[k] - 1)).toBeLessThan(1e-4);
    });
  });
  it('pessimistic σ_M/M matches _rv_sigma_M_frac (σ_RV = 1 m/s, N_RV = 100, e = 0)', () => {
    primary.forEach((i, k) => {
      const s = sigmaMFrac(rv, i, 'pessimistic', { optFrac: 0.1, sigmaRV: 1, nRV: 100, e: 0, comp: rv.reference_default });
      expect(Math.abs(s / V.sigma_M_frac_pess[k] - 1)).toBeLessThan(2e-5);
    });
  });
  it('ρ_norm of measured (M, R) and the Welch test match the Python reference', () => {
    const cold: number[] = [], hot: number[] = [];
    primary.forEach((i, k) => {
      const Mo = Math.max(rv.M_min, rv.planets.M[i] * (1 + 0.1 * V.zM[k]));
      const Ro = rv.planets.R[i] * (1 + rv.sigma_R * V.zR[k]);
      const r = rhoNorm(Mo, Ro, rv, V.composition);
      expect(Math.abs(r / V.rho_norm_obs[k] - 1)).toBeLessThan(5e-5);
      if (V.keep[k]) (rv.planets.S_abs[i] > rv.S_thresh ? hot : cold).push(r);
    });
    const w = welchGreater(cold, hot)!;
    expect(w.t).toBeCloseTo(V.t, 3);
    expect(Math.abs(w.p / V.p - 1)).toBeLessThan(2e-3);
  });
});

describe('reference relation', () => {
  it('bare rocky planets have rho_norm = 1 for the default (generator) composition', () => {
    expect(rv.reference_default).toBe('mgsio3');
    const vals = rv.planets.M.map((M, i) => rhoNorm(M, rv.planets.R_orig[i], rv));
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    expect(Math.abs(mean - 1)).toBeLessThan(0.01);
    for (const v of vals) expect(Math.abs(v - 1)).toBeLessThan(0.03);
  });
});

describe('statistics helpers', () => {
  it('Gaussian significance from p-values', () => {
    expect(zFromP(0.0227501)).toBeCloseTo(2, 3);
    expect(zFromP(0.0013499)).toBeCloseTo(3, 3);
    expect(zFromP(2.866516e-7)).toBeCloseTo(5, 2);
    expect(zFromP(0.5)).toBeCloseTo(0, 6);
  });
  it('Student t survival function', () => {
    expect(tSurvival(0, 10)).toBeCloseTo(0.5, 8);
    expect(tSurvival(2.228, 10)).toBeCloseTo(0.025, 3);      // t_0.975, ν = 10
    expect(tSurvival(-1.812, 10)).toBeCloseTo(0.95, 3);
  });
  it('optimistic follow-up is at least as significant as pessimistic (median)', () => {
    const p = { optFrac: 0.1, sigmaRV: 1, nRV: 100, e: 0, comp: rv.reference_default };
    const o = significanceAt(rv, 200, 'optimistic', p, 40);
    const s = significanceAt(rv, 200, 'pessimistic', p, 40);
    expect(o.valid).toBeGreaterThan(30);
    expect(o.q50).toBeGreaterThan(s.q50);
  });
});
