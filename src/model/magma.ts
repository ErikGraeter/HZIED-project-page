// Visual prominence of the magma ocean on steam-envelope planets.

import type { Planet } from './types';
import { hash01 } from './rng';

/**
 * How prominent the magma ocean is drawn.  Only steam-envelope planets (the
 * pipeline's has_magmaocean planets) get one; it grows with absorbed flux, so
 * strongly irradiated planets show vivid lava seas and mildly irradiated ones
 * only a faint glow.  A visual choice, not a model output.
 */
export function magmaStrength(p: Planet, S_thresh: number): number {
  if (!(p.S_abs > S_thresh && p.steam)) return 0;
  const x = Math.min(1, Math.max(0, (Math.log(p.S_abs) - Math.log(S_thresh * 1.2)) / Math.log(1500 / (S_thresh * 1.2))));
  const s = x * x * (3 - 2 * x);
  return Math.min(1, Math.max(0.2, 0.25 + 0.75 * s + 0.2 * (hash01(p.id, 211) - 0.5)));
}

