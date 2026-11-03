// Selection and summary statistics of the stars currently shown on the map.

import { BIT, CLASSES, SAMPLES, type SampleKey, type SpClass, type StarCatalog } from './catalog';

export interface Selection { samples: Record<SampleKey, boolean>; classes: Record<SpClass, boolean> }

export function sampleBits(samples: Record<SampleKey, boolean>): number {
  return SAMPLES.reduce((b, k) => (samples[k] ? b | BIT[k] : b), 0);
}

export function isVisible(c: StarCatalog, i: number, sel: Selection): boolean {
  return (c.sample[i] & sampleBits(sel.samples)) !== 0 && sel.classes[CLASSES[c.cls[i]]];
}

/**
 * The sample(s) whose colour a star is drawn in.  P2 ⊂ P1: a P2 star is drawn
 * as P2 when P2 is chosen, otherwise as P1, so P1 and P2 never count twice.
 */
export function shownAs(s: number, samples: Record<SampleKey, boolean>): SampleKey[] {
  const keys: SampleKey[] = [];
  if (s & BIT.P4 && samples.P4) keys.push('P4');
  if (s & BIT.P5 && samples.P5) keys.push('P5');
  if (s & BIT.P2 && samples.P2) keys.push('P2');
  else if (s & BIT.P1 && samples.P1) keys.push('P1');
  return keys;
}

export interface Hist { edges: number[]; counts: Record<SampleKey, number[]> }

export interface Stats {
  n: number;
  /** Members of each chosen sample (P1 includes its P2 stars). */
  bySample: Record<SampleKey, number>;
  /** Stars per main class in the chosen sample(s), before the class filter. */
  classCounts: Record<SpClass, number>;
  d: { median: number; q05: number; q95: number; min: number; max: number } | null;
  teffMedian: number | null;
  massMedian: number | null;
  hist: { d: Hist; teff: Hist; mass: Hist };
}

const range = (lo: number, hi: number, w: number) => Array.from({ length: Math.round((hi - lo) / w) + 1 }, (_, k) => lo + k * w);

/** Distance bins: the first [max, width] that covers the farthest chosen sample. */
const D_BINS: [number, number][] = [[150, 6.25], [300, 12.5], [500, 20], [1250, 50]];

/** Histogram bins, matched to the extent of the chosen sample(s). */
function edgesFor(c: StarCatalog, samples: Record<SampleKey, boolean>) {
  const on = SAMPLES.filter((k) => samples[k]);
  const dMax = Math.max(...on.map((k) => c.meta.samples[k]?.d_max ?? 1250));
  const [hi, w] = D_BINS.find(([h]) => h >= dMax) ?? D_BINS[D_BINS.length - 1];
  const m = samples.P4, fgk = on.some((k) => k !== 'P4');
  return {
    d: range(0, hi, w),
    teff: !fgk ? range(2900, 4000, 50) : m ? range(2900, 6600, 100) : range(3800, 6600, 100),
    mass: !fgk ? range(0.15, 0.7, 0.025) : m ? range(0.15, 1.5, 0.05) : range(0.55, 1.5, 0.05),
  };
}

function emptyHist(edges: number[]): Hist {
  const z = () => new Array(edges.length - 1).fill(0);
  return { edges, counts: { P1: z(), P2: z(), P4: z(), P5: z() } };
}

function addTo(h: Hist, v: number, key: SampleKey) {
  const e = h.edges, w = e[1] - e[0];
  const k = Math.min(Math.floor((v - e[0]) / w), e.length - 2);   // last bin is closed
  if (k >= 0 && v <= e[e.length - 1]) h.counts[key][k]++;
}

function quantile(sorted: Float32Array, q: number): number {
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function computeStats(c: StarCatalog, sel: Selection): Stats {
  const bits = sampleBits(sel.samples);
  const classCounts = Object.fromEntries(CLASSES.map((k) => [k, 0])) as Stats['classCounts'];
  const bySample = { P1: 0, P2: 0, P4: 0, P5: 0 };
  const E = edgesFor(c, sel.samples);
  const hist = { d: emptyHist(E.d), teff: emptyHist(E.teff), mass: emptyHist(E.mass) };
  const ds = new Float32Array(c.n), ts = new Float32Array(c.n), ms = new Float32Array(c.n);
  let n = 0;
  for (let i = 0; i < c.n; i++) {
    const s = c.sample[i];
    if ((s & bits) === 0) continue;
    const cl = CLASSES[c.cls[i]];
    classCounts[cl]++;
    if (!sel.classes[cl]) continue;
    for (const k of SAMPLES) if (s & BIT[k] & bits) bySample[k]++;
    // a star in P4 and P5 counts once in n and once per sample in the histograms
    for (const k of shownAs(s, sel.samples)) {
      addTo(hist.d, c.d[i], k); addTo(hist.teff, c.teff[i], k); addTo(hist.mass, c.mass[i], k);
    }
    ds[n] = c.d[i]; ts[n] = c.teff[i]; ms[n] = c.mass[i]; n++;
  }
  const sd = ds.subarray(0, n).sort(), st = ts.subarray(0, n).sort(), sm = ms.subarray(0, n).sort();
  return {
    n, bySample, classCounts, hist,
    d: n ? { median: quantile(sd, 0.5), q05: quantile(sd, 0.05), q95: quantile(sd, 0.95), min: sd[0], max: sd[n - 1] } : null,
    teffMedian: n ? quantile(st, 0.5) : null,
    massMedian: n ? quantile(sm, 0.5) : null,
  };
}
