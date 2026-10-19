// Selection and summary statistics of the stars currently shown on the map.

import { BIT, CLASSES, type SampleKey, type SpClass, type StarCatalog } from './catalog';

export type SampleSel = 'P4' | 'P5' | 'both';

export interface Selection { sample: SampleSel; classes: Record<SpClass, boolean> }

export function sampleBits(sel: SampleSel): number {
  return sel === 'both' ? BIT.P4 | BIT.P5 : BIT[sel];
}

export function isVisible(c: StarCatalog, i: number, sel: Selection): boolean {
  return (c.sample[i] & sampleBits(sel.sample)) !== 0 && sel.classes[CLASSES[c.cls[i]]];
}

export interface Hist { edges: number[]; counts: Record<SampleKey, number[]> }

export interface Stats {
  n: number;
  bySample: Record<SampleKey, number>;
  /** Stars per main class in the chosen sample(s), before the class filter. */
  classCounts: Record<SpClass, Record<SampleKey, number>>;
  d: { median: number; q05: number; q95: number; min: number; max: number } | null;
  teffMedian: number | null;
  massMedian: number | null;
  hist: { d: Hist; teff: Hist; mass: Hist };
}

const range = (lo: number, hi: number, w: number) => Array.from({ length: Math.round((hi - lo) / w) + 1 }, (_, k) => lo + k * w);

/** Histogram bins, matched to the extent of the chosen sample(s). */
const EDGES: Record<SampleSel, { d: number[]; teff: number[]; mass: number[] }> = {
  P4:   { d: range(0, 300, 12.5), teff: range(2900, 4000, 50),  mass: range(0.15, 0.7, 0.025) },
  P5:   { d: range(0, 1250, 50),  teff: range(3800, 6600, 100), mass: range(0.55, 1.5, 0.05) },
  both: { d: range(0, 1250, 50),  teff: range(2900, 6600, 100), mass: range(0.15, 1.5, 0.05) },
};

function emptyHist(edges: number[]): Hist {
  return { edges, counts: { P4: new Array(edges.length - 1).fill(0), P5: new Array(edges.length - 1).fill(0) } };
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
  const bits = sampleBits(sel.sample);
  const classCounts = Object.fromEntries(CLASSES.map((k) => [k, { P4: 0, P5: 0 }])) as Stats['classCounts'];
  const bySample = { P4: 0, P5: 0 };
  const E = EDGES[sel.sample];
  const hist = { d: emptyHist(E.d), teff: emptyHist(E.teff), mass: emptyHist(E.mass) };
  const ds = new Float32Array(c.n), ts = new Float32Array(c.n), ms = new Float32Array(c.n);
  let n = 0;
  for (let i = 0; i < c.n; i++) {
    const s = c.sample[i];
    if ((s & bits) === 0) continue;
    // a star in both samples counts once in n and once per sample in the histograms
    const keys: SampleKey[] = [];
    if (s & BIT.P4 & bits) keys.push('P4');
    if (s & BIT.P5 & bits) keys.push('P5');
    const cl = CLASSES[c.cls[i]];
    for (const k of keys) classCounts[cl][k]++;
    if (!sel.classes[cl]) continue;
    for (const k of keys) {
      bySample[k]++;
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
