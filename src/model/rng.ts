// Deterministic random numbers.  Every random choice on the website derives
// from these functions with a fixed seed, so every animation loop and every
// parameter setting is reproducible.

/** mulberry32 PRNG — small, fast, good enough for visual sampling. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stateless hash of (key, seed) → uniform [0, 1).  Stable per planet id. */
export function hash01(key: number, seed = 0): number {
  let h = (key * 0x9e3779b1) ^ (seed * 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Standard normal draw from two hashed uniforms (Box–Muller). */
export function hashNormal(key: number, seed = 0): number {
  const u1 = Math.max(hash01(key, seed), 1e-12);
  const u2 = hash01(key, seed + 7919);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
