// Everything derived from (data, params): the modelled population, the toy
// evidence, the binned means, the featured planets and the storyboard.

import type { HziedData, ModelParams, Planet, SampleData } from './types';
import { applyModel } from './inflation';
import { binnedMeans, compareSample, fitStep, sequentialFits, type Bin, type Comparison, type StepFit } from './evidence';
import { pickFeatured, type Featured } from './featured';
import { buildStoryboard, type Storyboard } from '../timeline/storyboard';

export interface ModelState {
  params: ModelParams;
  sample: SampleData;
  planets: Planet[];
  nObservable: number;
  /** Fixed-threshold comparison (descriptive step at the injected S_thresh). */
  final: Comparison;
  /** Free-threshold step-model fit for all planets shown. */
  fit: StepFit;
  /** The same fit on a log grid of survey sizes (arrival order). */
  seq: StepFit[];
  bins: Bin[];
  featured: Featured;
  storyboard: Storyboard;
}

export function defaultParams(data: HziedData): ModelParams {
  const d = data.provenance.defaults;
  return {
    sample: data.samples[0].meta.key,
    S_thresh: d.S_thresh, wrr: d.wrr, f_rgh: d.f_rgh,
    N: 100000, noise: false, envelopeScale: 3,
  };
}

export function computeModel(data: HziedData, params: ModelParams): ModelState {
  const sample = data.samples.find((s) => s.meta.key === params.sample) ?? data.samples[0];
  const c = sample.meta.cuts ?? data.provenance.observable_cuts;
  const { observable, nObservable } = applyModel(sample, data.tables, params, {
    M_min: c.M_min, M_max: c.M_max, R_min: c.R_min, S_min: c.S_min, S_max: c.S_max,
    depth_min: c.depth_min_ppm * 1e-6,
  });
  const final = compareSample(observable, params.S_thresh);
  const fit = fitStep(observable);
  const seq = sequentialFits(observable);
  const perBin = Math.max(5, Math.min(140, Math.round(observable.length / 13)));
  const bins = binnedMeans(observable, params.S_thresh, perBin);
  const featured = pickFeatured(observable, params.S_thresh);
  const storyboard = buildStoryboard(observable, params.S_thresh, featured);
  return { params, sample, planets: observable, nObservable, final, fit, seq, bins, featured, storyboard };
}
