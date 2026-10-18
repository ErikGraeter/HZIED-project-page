// Deterministic visual appearance of a planet, derived from its data.
//
// Physical inputs: host-star effective temperature (light colour), absorbed
// flux relative to the threshold (ice caps on the cold side), whether the
// model gives the planet a steam envelope.  Everything else (terrain seed,
// palette, ocean fraction, cloudiness, spin) is a visual choice keyed on the
// planet id so the same planet always looks the same.

import type { Planet } from '../model/types';
import { hash01 } from '../model/rng';
import { magmaStrength } from '../model/magma';
export { magmaStrength };

export type RGB = [number, number, number];

export interface PlanetLook {
  seed: RGB;
  land: [RGB, RGB, RGB];
  deep: RGB;
  shallow: RGB;
  ocean0: number;
  /** Magma-ocean prominence for steam planets (0 = none, 1 = vivid). */
  magma: number;
  ice: number;
  cloud0: number;
  tilt: number;
  spin: number;
  phase: number;
  light: RGB;
  lightCss: string;
}

const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const toLinear = (c: RGB): RGB => c.map((v) => Math.pow(v, 2.2)) as RGB;

// Geological palettes (lowland, upland, highland) — no vegetation is implied.
const LAND = {
  basalt: ['#5a4636', '#8d7559', '#cbbfa9'],
  granite: ['#4b4741', '#7f776b', '#d6d0c4'],
  ironoxide: ['#6a3a27', '#9c5a39', '#d4ad86'],
  sandstone: ['#6f5639', '#ad8b5a', '#e2d3b3'],
  olivine: ['#4a5136', '#7f7a56', '#d2cbb7'],
} as const;
const OCEANS: [string, string][] = [
  ['#0a2442', '#1f6e93'],
  ['#0a2b37', '#1b7676'],
  ['#0b1d3a', '#2a5f9c'],
];

/** Approximate blackbody colour (sRGB) — Tanner Helland's fit, then softened. */
export function starColor(T: number): RGB {
  const t = Math.min(Math.max(T, 1000), 40000) / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = [r, g, b].map((v) => Math.min(Math.max(v, 0), 255) / 255) as RGB;
  // soften toward white so that M-dwarf light stays readable on screen
  return c.map((v) => 0.55 * v + 0.45) as RGB;
}

export function planetLook(p: Planet, S_thresh: number): PlanetLook {
  const h = (k: number) => hash01(p.id, 101 + k);
  const hot = p.S_abs > S_thresh;
  const pal = hot
    ? (['ironoxide', 'sandstone', 'basalt', 'granite'] as const)[Math.floor(h(1) * 4)]
    : (['olivine', 'granite', 'basalt', 'sandstone'] as const)[Math.floor(h(1) * 4)];
  const oc = OCEANS[Math.floor(h(2) * OCEANS.length)];
  // water inventory (visual): dry runaway planets start with little surface water
  let ocean0 = 0.42 + 0.26 * h(3);
  if (hot && !p.steam) ocean0 = 0.08 + 0.1 * h(3);
  const ice = hot ? 0 : Math.min(0.75, Math.max(0.08, 0.1 + 0.42 * Math.log10(S_thresh / p.S_abs) + 0.12 * h(4)));
  const light = starColor(p.T_eff_st);
  return {
    seed: [h(5) * 40 - 20, h(6) * 40 - 20, h(7) * 40 - 20],
    land: LAND[pal].map((c) => toLinear(hex(c))) as [RGB, RGB, RGB],
    deep: toLinear(hex(oc[0])),
    shallow: toLinear(hex(oc[1])),
    ocean0,
    magma: magmaStrength(p, S_thresh),
    ice,
    cloud0: 0.32 + 0.22 * h(8),
    tilt: (8 + 22 * h(9)) * (Math.PI / 180),
    spin: 0.07 + 0.05 * h(10),
    phase: h(11) * Math.PI * 2,
    light,
    lightCss: `rgb(${light.map((v) => Math.round(v * 255)).join(',')})`,
  };
}
