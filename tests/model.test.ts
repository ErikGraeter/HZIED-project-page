// Validates the browser model against the HZIED pipeline export.
import { describe, expect, it } from 'vitest';
import data from '../src/data/hzied_data.json';
import validation from '../src/data/hzied_validation.json';
import { applyModel, inflationFactor } from '../src/model/inflation';
import { compare, emptyStats, addTo, compareSample, fitStep, sequentialFits, PRIOR_STHRESH, N_DRAWS } from '../src/model/evidence';
import { computeModel, defaultParams } from '../src/model/compute';
import { pickFeatured } from '../src/model/featured';
import { buildStoryboard, sceneAt } from '../src/timeline/storyboard';
import type { HziedData, ModelParams, SampleData } from '../src/model/types';

const D = data as unknown as HziedData;
const V = validation as unknown as {
  defaults: { S_thresh: number; wrr: number; f_rgh: number };
  samples: Record<string, { id: number[]; R_pipeline: number[]; pass_cuts: boolean[] }>;
};
const params = (sample: string): ModelParams => ({
  sample, S_thresh: 280, wrr: 0.005, f_rgh: 0.8, N: 100000, noise: false, envelopeScale: 1,
});
const cutsOf = (s: SampleData) => {
  const c = s.meta.cuts!;
  return { M_min: c.M_min, M_max: c.M_max, R_min: c.R_min, S_min: c.S_min, S_max: c.S_max, depth_min: c.depth_min_ppm * 1e-6 };
};
const run = (s: SampleData, p: Partial<ModelParams> = {}) => applyModel(s, D.tables, { ...params(s.meta.key), ...p }, cutsOf(s));

describe('inflation port reproduces magma_ocean_agni_updated + _observable_cuts', () => {
  for (const s of D.samples) {
    it(`sample ${s.meta.key}`, () => {
      const v = V.samples[s.meta.key];
      const res = run(s);
      const passIds = new Set(v.id.filter((_, k) => v.pass_cuts[k]));
      expect(res.nObservable).toBe(passIds.size);
      expect(res.nObservable).toBe(s.meta.summary_default.n_observable);
      const ref = new Map(v.id.map((id, k) => [id, v.R_pipeline[k]]));
      let maxRel = 0;
      for (const p of res.observable) {
        expect(passIds.has(p.id)).toBe(true);
        maxRel = Math.max(maxRel, Math.abs(p.R / ref.get(p.id)! - 1));
      }
      expect(maxRel).toBeLessThan(2e-5);
      const hot = res.observable.filter((p) => p.S_abs > 280);
      expect(hot.length).toBe(s.meta.summary_default.n_hot);
      expect(hot.filter((p) => p.steam).length).toBe(s.meta.summary_default.n_inflated);
    });
  }
  it('steam inflation grows with wrr; DL21 water incorporation reduces it', () => {
    // without DL21 the steam/dry ratio increases monotonically with water content
    const raw = D.provenance.wrr_grid.map((w) => inflationFactor(1.0, w, D.tables, false));
    for (let k = 1; k < raw.length; k++) expect(raw[k]).toBeGreaterThan(raw[k - 1]);
    // with DL21, water dissolved in the magma ocean shrinks the radius (wrr ≥ 1e-3)
    for (const w of D.provenance.wrr_grid.filter((w) => w >= 1e-3)) {
      expect(inflationFactor(1.0, w, D.tables)).toBeLessThan(inflationFactor(1.0, w, D.tables, false));
    }
  });
});

describe('toy evidence', () => {
  it('equal groups give ln K < 0 (Occam penalty) and a clear step gives ln K > 5', () => {
    const a = emptyStats(), b = emptyStats(), c = emptyStats(), d = emptyStats();
    for (let k = 0; k < 400; k++) {
      const z = Math.sin(k * 12.9898) * 0.2;
      addTo(a, 1.3 + z); addTo(b, 1.3 - z);
      addTo(c, 1.45 + z); addTo(d, 1.3 - z);
    }
    expect(compare(a, b).lnK).toBeLessThan(0);
    expect(compare(c, d).lnK).toBeGreaterThan(5);
  });
  it('the free-threshold evidence equals brute-force integration over S_thresh', () => {
    const s = D.samples.find((x) => x.meta.key === 'plato')!;
    const planets = run(s).observable.slice(0, 80);
    const f = fitStep(planets);
    // brute force: average the fixed-threshold evidence over a fine S_thresh grid
    const [lo, hi] = PRIOR_STHRESH;
    const M = 6000;
    const terms: number[] = [];
    for (let j = 0; j < M; j++) {
      const St = lo + ((j + 0.5) / M) * (hi - lo);
      terms.push(compareSample(planets, St).lnZ1 - Math.log(M));
    }
    const mx = Math.max(...terms);
    const lnZ1 = mx + Math.log(terms.reduce((a, t) => a + Math.exp(t - mx), 0));
    expect(f.lnZ1).toBeCloseTo(lnZ1, 1);
    expect(f.draws.length).toBe(N_DRAWS);
    for (const d of f.draws) { expect(d.S).toBeGreaterThanOrEqual(lo); expect(d.S).toBeLessThanOrEqual(hi); }
  });
  it('sequential fits end at the full-sample fit', () => {
    const s = D.samples[0];
    const res = run(s);
    const seq = sequentialFits(res.observable);
    expect(seq[seq.length - 1].n).toBe(res.observable.length);
    expect(seq[seq.length - 1].lnK).toBeCloseTo(fitStep(res.observable).lnK, 6);
  });
  it('artificial population: the step is recovered near the injected threshold', () => {
    const f = fitStep(run(D.samples[0]).observable);
    expect(f.lnK).toBeGreaterThan(5);
    expect(Math.abs(f.best.S - 280)).toBeLessThan(60);
    expect(f.sQ[0]).toBeLessThan(f.best.S);
    expect(f.sQ[2]).toBeGreaterThan(f.best.S);
    expect(f.best.muHot).toBeGreaterThan(f.best.muCold);
  });
  it('null injection (f_rgh = 0) does not favour a step for the artificial population', () => {
    const res = run(D.samples[0], { f_rgh: 0 });
    expect(fitStep(res.observable).lnK).toBeLessThan(0);
    expect(compareSample(res.observable, 280).lnK).toBeLessThan(0);
  });
  it('model state computes quickly enough for live controls', () => {
    const t0 = performance.now();
    computeModel(D, defaultParams(D));
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});

describe('storyboard', () => {
  it('loops seamlessly: state at t = duration matches t = 0', () => {
    const s = D.samples[0];
    const res = run(s);
    const f = pickFeatured(res.observable, 280);
    const sb = buildStoryboard(res.observable, 280, f);
    const a = sceneAt(sb, res.observable.length, 0);
    const b = sceneAt(sb, res.observable.length, sb.duration - 1e-4);
    const vis = (sc: ReturnType<typeof sceneAt>) => sc.rigs.filter((r) => r.emerge > 0.99 && r.fly === 0 && r.recede === 0);
    expect(vis(a).map((r) => r.planet)).toEqual(vis(b).map((r) => r.planet));
    expect(vis(a)[0].inflate).toBeCloseTo(0, 5);
    expect(vis(b)[0].inflate).toBeCloseTo(0, 5);
    expect(a.threshold).toBe(0);
    expect(b.threshold).toBeCloseTo(0, 5);
    // every point fades out before the loop restarts and none is visible at t = 0
    for (let i = 0; i < res.observable.length; i++) {
      expect(sb.fadeOut[i] + 0.6).toBeLessThan(sb.duration);
      expect(sb.appear[i]).toBeGreaterThan(0);
    }
  });
  it('featured planets are consistent with the model', () => {
    const s = D.samples[0];
    const res = run(s);
    const f = pickFeatured(res.observable, 280);
    // the cold line-up spans the radius distribution, sorted, and includes its extremes
    const coldR = res.observable.filter((p) => p.S_abs <= 280).map((p) => p.R_orig);
    const lr = f.lineup.map((i) => res.observable[i].R_orig);
    expect(f.lineup.length).toBe(5);
    expect([...lr].sort((a, b) => a - b)).toEqual(lr);
    expect(Math.max(...lr) / Math.min(...lr)).toBeGreaterThan(1.6);
    expect(Math.min(...lr)).toBeLessThanOrEqual(Math.min(...coldR) + 1e-9);
    for (const h of f.hot) {
      expect(res.observable[h.planet].S_abs).toBeGreaterThan(280);
      expect(res.observable[h.planet].steam).toBe(h.kind === 'hot-steam');
    }
    for (const c of [...f.cold, ...f.lineup]) expect(res.observable[c].S_abs).toBeLessThanOrEqual(280);
    // the 3D hot side shows only inflating planets whenever envelopes exist
    expect(f.hot.length).toBeGreaterThanOrEqual(3);
    expect(f.hot.every((h) => h.kind === 'hot-steam')).toBe(true);
  });
});
