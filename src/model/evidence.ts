// Illustrative Bayesian model comparison computed in the browser.
//
// A deliberately simple, fully specified toy model — NOT the thesis inference
// (which fits the Schlecker+2024 step model to binned moving averages with
// dynesty).  Per planet i with radius R_i and absorbed flux S_i:
//
//   H0  (no discontinuity):  R_i ~ Normal(μ, σ²)
//   H1  (HZIED step):        R_i ~ Normal(μ_hot, σ²)  if S_i > S_thresh
//                            R_i ~ Normal(μ_cold, σ²) otherwise
//
//   priors:  μ, μ_hot, μ_cold ~ Uniform(0.5, 3.0) R⊕  (independent)
//            σ ~ log-uniform(0.02, 2.0) R⊕            (shared intrinsic scatter)
//            S_thresh ~ Uniform(10, 1000) W m⁻²        (as the pipeline's H1 bounds)
//
// The means are integrated analytically (Gaussian likelihood × uniform prior →
// normal CDFs), σ numerically on a log grid, and S_thresh exactly: the
// likelihood only changes when the threshold crosses a planet, so the S_thresh
// integral is a sum over the intervals between sorted fluxes.  ln ΔZ =
// ln Z_H1 − ln Z_H0 (stored in the `lnK` fields) is therefore exact for this
// model and the planets shown.
// Posterior draws of (S_thresh, μ_hot, μ_cold) are sampled from the same
// posterior with a fixed set of random numbers, so they evolve smoothly as the
// sample grows.

export const PRIOR_MU: [number, number] = [0.5, 3.0];
export const PRIOR_SIGMA: [number, number] = [0.02, 2.0];
export const PRIOR_STHRESH: [number, number] = [10, 1000];
export const N_DRAWS = 50;
const DRAW_SEED = 7;

/** Evidence scale used throughout the project (src/constants.py LNK_*). */
export const LNK_LEVELS = { weak: 1, moderate: 2.5, strong: 5, decisive: 10 };

// Complementary error function, Numerical Recipes erfcc (|rel. err| < 1.2e-7).
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418
    + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587
    + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
const Phi = (x: number) => 0.5 * erfc(-x / Math.SQRT2);

/** Sufficient statistics of one group. */
export interface Stats { n: number; sum: number; sumsq: number }
export const emptyStats = (): Stats => ({ n: 0, sum: 0, sumsq: 0 });
export function addTo(s: Stats, x: number): void { s.n += 1; s.sum += x; s.sumsq += x * x; }
const mean = (s: Stats) => s.sum / s.n;
const ssq = (s: Stats) => Math.max(s.sumsq - (s.sum * s.sum) / s.n, 0);

/** ln ∫ Π_i N(x_i | μ, σ²) U(μ | a, b) dμ for one group at fixed σ. */
function lnZGroup(s: Stats, sigma: number): number {
  if (s.n === 0) return 0;
  const [a, b] = PRIOR_MU;
  const n = s.n;
  const xb = mean(s);
  const v = sigma * sigma;
  const sq = Math.sqrt(n) / sigma;
  const mass = Math.max(Phi((b - xb) * sq) - Phi((a - xb) * sq), 1e-300);
  return -0.5 * n * Math.log(2 * Math.PI * v) - ssq(s) / (2 * v)
    + 0.5 * Math.log((2 * Math.PI * v) / n) + Math.log(mass) - Math.log(b - a);
}

function logSumExp(xs: number[]): number {
  let m = -Infinity;
  for (const x of xs) if (x > m) m = x;
  if (!Number.isFinite(m)) return m;
  let s = 0;
  for (const x of xs) s += Math.exp(x - m);
  return m + Math.log(s);
}

export interface Comparison {
  lnK: number;
  lnZ0: number;
  lnZ1: number;
  /** Posterior mean and standard deviation of the group means. */
  mu0: number; sd0: number;
  muHot: number; sdHot: number;
  muCold: number; sdCold: number;
  /** Posterior mean of the intrinsic scatter under H1. */
  sigma1: number;
  nHot: number; nCold: number;
}

/** Evidence ratio and posterior summaries for given hot/cold statistics. */
export function compare(hot: Stats, cold: Stats, gridPoints = 160): Comparison {
  const all: Stats = { n: hot.n + cold.n, sum: hot.sum + cold.sum, sumsq: hot.sumsq + cold.sumsq };
  const n = Math.max(all.n, 1);
  const lnLo = Math.log(PRIOR_SIGMA[0]);
  const lnHi = Math.log(PRIOR_SIGMA[1]);
  // integrate over the region where the σ posterior has its mass
  const s0 = Math.max(Math.sqrt(ssq(all) / n), PRIOR_SIGMA[0]);
  const ssW = (hot.n ? ssq(hot) : 0) + (cold.n ? ssq(cold) : 0);
  const s1 = Math.max(Math.sqrt(ssW / n), PRIOR_SIGMA[0]);
  const w = Math.max(0.25, 9 / Math.sqrt(2 * n));
  const from = Math.max(lnLo, Math.log(Math.min(s0, s1)) - w);
  const to = Math.min(lnHi, Math.log(Math.max(s0, s1)) + w);
  const dl = (to - from) / (gridPoints - 1);
  const lnPrior = -Math.log(lnHi - lnLo);

  const l0: number[] = [];
  const l1: number[] = [];
  const sig: number[] = [];
  for (let k = 0; k < gridPoints; k++) {
    const ls = from + k * dl;
    const sg = Math.exp(ls);
    const wTrap = Math.log(k === 0 || k === gridPoints - 1 ? dl / 2 : dl);
    sig.push(sg);
    l0.push(lnZGroup(all, sg) + lnPrior + wTrap);
    l1.push(lnZGroup(hot, sg) + lnZGroup(cold, sg) + lnPrior + wTrap);
  }
  const lnZ0 = logSumExp(l0);
  const lnZ1 = logSumExp(l1);
  let es2_0 = 0, es2_1 = 0, es_1 = 0;
  for (let k = 0; k < gridPoints; k++) {
    const w0 = Math.exp(l0[k] - lnZ0);
    const w1 = Math.exp(l1[k] - lnZ1);
    es2_0 += w0 * sig[k] * sig[k];
    es2_1 += w1 * sig[k] * sig[k];
    es_1 += w1 * sig[k];
  }
  return {
    lnK: lnZ1 - lnZ0, lnZ0, lnZ1,
    mu0: all.n ? mean(all) : NaN, sd0: Math.sqrt(es2_0 / n),
    muHot: hot.n ? mean(hot) : NaN, sdHot: hot.n ? Math.sqrt(es2_1 / hot.n) : NaN,
    muCold: cold.n ? mean(cold) : NaN, sdCold: cold.n ? Math.sqrt(es2_1 / cold.n) : NaN,
    sigma1: es_1, nHot: hot.n, nCold: cold.n,
  };
}

export interface PlanetLike { R_obs: number; S_abs: number }

/** Comparison for a set of planets at a fixed threshold. */
export function compareSample(planets: PlanetLike[], S_thresh: number): Comparison {
  const hot = emptyStats();
  const cold = emptyStats();
  for (const p of planets) addTo(p.S_abs > S_thresh ? hot : cold, p.R_obs);
  return compare(hot, cold);
}

/**
 * Sequential evidence: ln ΔZ and posterior summaries after each of the first
 * n planets (n = 1 … N) in the given (survey arrival) order.
 */
export function sequentialEvidence(planets: PlanetLike[], S_thresh: number): Comparison[] {
  const hot = emptyStats();
  const cold = emptyStats();
  const out: Comparison[] = [];
  for (const p of planets) {
    addTo(p.S_abs > S_thresh ? hot : cold, p.R_obs);
    out.push(compare({ ...hot }, { ...cold }, 120));
  }
  return out;
}

// ── step model with a free threshold ─────────────────────────────────────────

export interface StepDraw { S: number; muHot: number; muCold: number }

export interface StepFit {
  n: number;
  lnK: number;
  lnZ0: number;
  lnZ1: number;
  mu0: number;
  /** Best fit: posterior-median threshold with the side means of that split. */
  best: StepDraw & { sigma: number; nHot: number; nCold: number };
  /** 16th / 50th / 84th percentiles of the S_thresh posterior. */
  sQ: [number, number, number];
  draws: StepDraw[];
}

const DRAW_U = (() => {
  // common random numbers: (interval, position, sigma, z_hot, z_cold) per draw
  let a = DRAW_SEED >>> 0;
  const r = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const g = () => Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r());
  return Array.from({ length: N_DRAWS }, () => [r(), r(), r(), g(), g()]);
})();

/** Posterior of the free-threshold step model for a set of planets. */
export function fitStep(planets: PlanetLike[], gridPoints = 56): StepFit {
  const n = planets.length;
  const order = planets.map((_, i) => i).sort((a, b) => planets[b].S_abs - planets[a].S_abs);
  const S = order.map((i) => planets[i].S_abs);
  const R = order.map((i) => planets[i].R_obs);
  // prefix sums in descending-S order: hot side = first k planets
  const cs = new Float64Array(n + 1), cq = new Float64Array(n + 1);
  for (let k = 0; k < n; k++) { cs[k + 1] = cs[k] + R[k]; cq[k + 1] = cq[k] + R[k] * R[k]; }
  const all: Stats = { n, sum: cs[n], sumsq: cq[n] };
  const [sLo, sHi] = PRIOR_STHRESH;
  const span = sHi - sLo;
  // interval k: S_thresh in [S_k, S_{k-1}) gives exactly k hot planets
  const iv: { k: number; lo: number; hi: number }[] = [];
  for (let k = 0; k <= n; k++) {
    const hiS = k === 0 ? Infinity : S[k - 1];
    const loS = k === n ? -Infinity : S[k];
    const lo = Math.max(sLo, loS), hi = Math.min(sHi, hiS);
    if (hi > lo) iv.push({ k, lo, hi });
  }
  const statsOf = (k: number): [Stats, Stats] => [
    { n: k, sum: cs[k], sumsq: cq[k] },
    { n: n - k, sum: cs[n] - cs[k], sumsq: cq[n] - cq[k] },
  ];
  // σ grid covering the posterior mass of every interval
  let minSSW = Infinity;
  for (const { k } of iv) {
    const [h, c] = statsOf(k);
    minSSW = Math.min(minSSW, (h.n ? ssq(h) : 0) + (c.n ? ssq(c) : 0));
  }
  const nn = Math.max(n, 1);
  const s0 = Math.max(Math.sqrt(ssq(all) / nn), PRIOR_SIGMA[0]);
  const s1 = Math.max(Math.sqrt((Number.isFinite(minSSW) ? minSSW : ssq(all)) / nn), PRIOR_SIGMA[0]);
  const lnLoP = Math.log(PRIOR_SIGMA[0]), lnHiP = Math.log(PRIOR_SIGMA[1]);
  const w = Math.max(0.25, 9 / Math.sqrt(2 * nn));
  const from = Math.max(lnLoP, Math.log(s1) - w);
  const to = Math.min(lnHiP, Math.log(s0) + w);
  const dl = (to - from) / (gridPoints - 1);
  const sig: number[] = [];
  const lw: number[] = [];
  for (let j = 0; j < gridPoints; j++) {
    sig.push(Math.exp(from + j * dl));
    lw.push(Math.log(j === 0 || j === gridPoints - 1 ? dl / 2 : dl) - Math.log(lnHiP - lnLoP));
  }
  const lnZs = (h: Stats, c: Stats) => {
    const v = sig.map((sg, j) => lnZGroup(h, sg) + lnZGroup(c, sg) + lw[j]);
    return v;
  };
  // H0
  const l0 = sig.map((sg, j) => lnZGroup(all, sg) + lw[j]);
  const lnZ0 = logSumExp(l0);
  // H1: per-interval marginal likelihood
  const lnZk = iv.map(({ k }) => { const [h, c] = statsOf(k); return logSumExp(lnZs(h, c)); });
  const lnW = iv.map(({ lo, hi }, m) => lnZk[m] + Math.log((hi - lo) / span));
  const lnZ1 = logSumExp(lnW);
  const post = lnW.map((v) => Math.exp(v - lnZ1));
  const sigmaPost = (k: number) => {
    const [h, c] = statsOf(k);
    const v = lnZs(h, c);
    const z = logSumExp(v);
    return v.map((x) => Math.exp(x - z));
  };
  const meanOr = (st: Stats, other: Stats) => (st.n ? mean(st) : other.n ? mean(other) : NaN);
  // S_thresh quantiles (piecewise uniform within intervals)
  const asc = iv.map((v, m) => ({ ...v, p: post[m] })).sort((a, b) => a.lo - b.lo);
  const quant = (q: number) => {
    let acc = 0;
    for (const v of asc) {
      if (acc + v.p >= q) return v.lo + ((q - acc) / Math.max(v.p, 1e-300)) * (v.hi - v.lo);
      acc += v.p;
    }
    return asc.length ? asc[asc.length - 1].hi : NaN;
  };
  // best fit: posterior-median threshold; side means and scatter of that split
  const sMed = quant(0.5);
  const mMed = Math.max(0, iv.findIndex((v) => sMed >= v.lo && sMed <= v.hi));
  const bk = iv[mMed]?.k ?? 0;
  const [bh, bc] = statsOf(bk);
  const bsp = sigmaPost(bk);
  let bsig = sig[0], bmax = -1;
  bsp.forEach((p, j) => { if (p > bmax) { bmax = p; bsig = sig[j]; } });
  const best = { S: sMed, muHot: meanOr(bh, bc), muCold: meanOr(bc, bh), sigma: bsig, nHot: bh.n, nCold: bc.n };
  // posterior draws (inverse-CDF sampling with the fixed random numbers)
  const cdf: number[] = [];
  post.reduce((a, p, m) => { cdf[m] = a + p; return cdf[m]; }, 0);
  const sigCache = new Map<number, number[]>();
  const draws: StepDraw[] = DRAW_U.map(([u1, u2, u3, z1, z2]) => {
    let m = cdf.findIndex((c) => c >= u1);
    if (m < 0) m = iv.length - 1;
    const { k, lo, hi } = iv[m];
    const Sd = lo + u2 * (hi - lo);
    if (!sigCache.has(k)) sigCache.set(k, sigmaPost(k));
    const sp = sigCache.get(k)!;
    let acc = 0, j = 0;
    for (; j < sp.length - 1; j++) { acc += sp[j]; if (acc >= u3) break; }
    const sg = sig[j];
    const [h, c] = statsOf(k);
    const mh = h.n ? mean(h) + z1 * sg / Math.sqrt(h.n) : NaN;
    const mc = c.n ? mean(c) + z2 * sg / Math.sqrt(c.n) : NaN;
    // an empty side is unconstrained by data; draw it level with the other side
    return { S: Sd, muHot: Number.isFinite(mh) ? mh : mc, muCold: Number.isFinite(mc) ? mc : mh };
  });
  return {
    n, lnK: lnZ1 - lnZ0, lnZ0, lnZ1, mu0: n ? mean(all) : NaN, best,
    sQ: [quant(0.16), sMed, quant(0.84)], draws,
  };
}

/** Log-spaced sample sizes used for the sequential evidence (always ends at N). */
export function nGrid(N: number, n0 = 8, points = 48): number[] {
  if (N <= n0) return [Math.max(2, N)];
  const out = new Set<number>();
  for (let j = 0; j < points; j++) out.add(Math.round(n0 * Math.pow(N / n0, j / (points - 1))));
  out.add(N);
  return [...out].sort((a, b) => a - b);
}

/** Free-threshold fits for the first n planets (survey arrival order), n on nGrid(N). */
export function sequentialFits(planets: PlanetLike[]): StepFit[] {
  return nGrid(planets.length).map((n) => fitStep(planets.slice(0, n)));
}

/** Fit for the largest grid size not exceeding n. */
export function fitAt(seq: StepFit[], n: number): StepFit {
  let lo = 0, hi = seq.length - 1;
  if (n >= seq[hi].n) return seq[hi];
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (seq[mid].n <= n) lo = mid; else hi = mid; }
  return seq[lo];
}

export function verdict(lnK: number): { label: string; tone: 'h0' | 'none' | 'weak' | 'moderate' | 'strong' | 'decisive' } {
  if (lnK <= -LNK_LEVELS.weak) return { label: 'favours no discontinuity (H0)', tone: 'h0' };
  if (lnK < LNK_LEVELS.weak) return { label: 'inconclusive', tone: 'none' };
  if (lnK < LNK_LEVELS.moderate) return { label: 'weak evidence for H1', tone: 'weak' };
  if (lnK < LNK_LEVELS.strong) return { label: 'moderate evidence for H1', tone: 'moderate' };
  if (lnK < LNK_LEVELS.decisive) return { label: 'strong evidence for H1', tone: 'strong' };
  return { label: 'decisive evidence for H1', tone: 'decisive' };
}

/** Equal-count bins in absorbed flux, never straddling the threshold. */
export interface Bin { sLo: number; sHi: number; sMid: number; mean: number; se: number; n: number; hot: boolean }

export function binnedMeans(planets: PlanetLike[], S_thresh: number, targetPerBin: number): Bin[] {
  const bins: Bin[] = [];
  for (const hot of [true, false]) {
    const side = planets.filter((p) => (p.S_abs > S_thresh) === hot).sort((a, b) => b.S_abs - a.S_abs);
    if (side.length < 2) continue;
    const k = Math.max(1, Math.round(side.length / targetPerBin));
    for (let b = 0; b < k; b++) {
      const chunk = side.slice(Math.floor((b * side.length) / k), Math.floor(((b + 1) * side.length) / k));
      if (chunk.length < 2) continue;
      const m = chunk.reduce((s, p) => s + p.R_obs, 0) / chunk.length;
      const v = chunk.reduce((s, p) => s + (p.R_obs - m) ** 2, 0) / (chunk.length - 1);
      const sHi = chunk[0].S_abs;
      const sLo = chunk[chunk.length - 1].S_abs;
      bins.push({ sLo, sHi, sMid: Math.sqrt(sLo * sHi), mean: m, se: Math.sqrt(v / chunk.length), n: chunk.length, hot });
    }
  }
  return bins.sort((a, b) => b.sMid - a.sMid);
}
