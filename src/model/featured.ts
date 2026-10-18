// Choose the planets that get the full 3D treatment in the cinematic sequence.
// Deterministic: depends only on the modelled population.

import type { Planet } from './types';

export interface Featured {
  hot: { planet: number; kind: 'hot-steam' | 'hot-dry' }[];
  /** Single cold-side shots: a small and a large planet. */
  cold: number[];
  /** Cold-side line-up spanning the radius distribution, sorted by rocky radius. */
  lineup: number[];
  pair: { hot: number; cold: number } | null;
}

const quantilePick = (idx: number[], key: (i: number) => number, q: number, used: Set<number>): number | null => {
  const free = idx.filter((i) => !used.has(i)).sort((a, b) => key(a) - key(b));
  if (!free.length) return null;
  return free[Math.min(free.length - 1, Math.max(0, Math.round(q * (free.length - 1))))];
};

export function pickFeatured(planets: Planet[], S_thresh: number): Featured {
  const idx = planets.map((_, i) => i);
  const infl = (i: number) => planets[i].R / planets[i].R_orig - 1;
  const rad = (i: number) => planets[i].R_orig;
  const steam = idx.filter((i) => planets[i].S_abs > S_thresh && planets[i].steam);
  const dry = idx.filter((i) => planets[i].S_abs > S_thresh && !planets[i].steam);
  const cold = idx.filter((i) => planets[i].S_abs <= S_thresh);
  const used = new Set<number>();
  const hot: Featured['hot'] = [];
  const take = (i: number | null, kind: 'hot-steam' | 'hot-dry') => { if (i !== null) { hot.push({ planet: i, kind }); used.add(i); } };

  // 1: the most dramatic envelope, preferably around a K/G star (warmer light)
  const sunlit = steam.filter((i) => planets[i].T_eff_st > 3900);
  take(quantilePick(sunlit.length ? sunlit : steam, infl, 1.0, used), 'hot-steam');
  // 2: a strongly irradiated steam planet — its magma ocean is drawn vividly
  take(quantilePick(steam, (i) => planets[i].S_abs, 0.97, used), 'hot-steam');
  // 3: a hot planet without a steam envelope (water-poor / f_rgh draw)
  take(quantilePick(dry, rad, 0.5, used), 'hot-dry');
  // 4: another inflated planet, small core
  take(quantilePick(steam, rad, 0.25, used), 'hot-steam');
  // fall back to dry planets when no envelopes exist (e.g. f_rgh = 0)
  while (hot.length < 3) {
    const extra = quantilePick(dry, rad, hot.length / 3, used);
    if (extra === null) break;
    take(extra, 'hot-dry');
  }

  // cold side: one small and one large planet, then a line-up across the distribution
  const coldSingles: number[] = [];
  for (const q of [0.06, 0.94]) {
    const c = quantilePick(cold, rad, q, used);
    if (c !== null) { coldSingles.push(c); used.add(c); }
  }
  const lineup: number[] = [];
  for (const q of [0.0, 0.25, 0.5, 0.75, 1.0]) {
    const c = quantilePick(cold, rad, q, used);
    if (c !== null) { lineup.push(c); used.add(c); }
  }
  lineup.sort((a, b) => rad(a) - rad(b));

  const pairHot = hot.find((h) => h.kind === 'hot-steam')?.planet ?? hot[0]?.planet;
  const pairCold = lineup.length ? lineup[Math.floor(lineup.length / 2)] : coldSingles[0];
  return {
    hot,
    cold: coldSingles,
    lineup: lineup.length >= 3 ? lineup : [],
    pair: pairHot !== undefined && pairCold !== undefined ? { hot: pairHot, cold: pairCold } : null,
  };
}
