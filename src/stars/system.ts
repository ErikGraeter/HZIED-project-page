// Illustrative planetary system around one catalogue star, for the stellar view.
//
// The star is real (tPIC T_eff, R, M; L = R² (T_eff / 5778 K)⁴ as in the pipeline).
// The three planets are not: they are placed at chosen absorbed fluxes, one on each
// side of the runaway threshold and one hot planet with a steam envelope, so that
// the view shows the three kinds of planets the HZIED distinguishes.
//
//   orbit         S_abs = S⊕,abs · L / a²   (S⊕,abs = 238 W m⁻², Bioverse CONST['S_Earth'], albedo 0.3)
//   period        P = √(a³ / M★)  (yr, a in AU, M★ in M☉)
//   rocky radius  PALEOS dry branch at the chosen mass (the model's rocky baseline)
//   transit radius  R_orig × inflationFactor(M, wrr) for the steam planet, as in the pipeline

import { inflationFactor, interp } from '../model/inflation';
import type { ModelTables, Planet } from '../model/types';
import type { StarRecord } from './catalog';

export const S_EARTH_ABS = 238;
export const AU_PC = 1 / 206264.806;
/** Scene units of the system view per orbit of the cold planet. */
export const COLD_ORBIT = 10;

export type SysKind = 'steam' | 'hot' | 'cold';

export interface SysPlanet {
  kind: SysKind;
  label: string;
  S_abs: number;
  /** Semi-major axis (AU). */
  a: number;
  /** Orbital period (days). */
  P: number;
  M: number;
  R_orig: number;
  /** Model transit radius (R⊕). */
  R: number;
  /** Planet record for the shared planet look (planetLook / materials). */
  look: Planet;
}

export interface StellarSystem {
  index: number;
  pic: string;
  spt: string;
  teff: number;
  lum: number;
  mass: number;
  radius: number;
  d: number;
  S_thresh: number;
  wrr: number;
  /** Semi-major axis (AU) at which S_abs = S_thresh. */
  aThresh: number;
  /** One scene unit of the system view, in AU. */
  unitAU: number;
  planets: SysPlanet[];
}

const SPEC: { kind: SysKind; label: string; S_abs: number; M: number }[] = [
  { kind: 'steam', label: 'Hot · steam envelope', S_abs: 900, M: 0.6 },
  { kind: 'hot', label: 'Hot · bare rock', S_abs: 480, M: 1.4 },
  { kind: 'cold', label: 'Temperate · oceans', S_abs: 170, M: 1.0 },
];

export function buildSystem(s: StarRecord, tables: ModelTables, S_thresh: number, wrr: number): StellarSystem {
  const lum = Math.max(s.lum, 1e-5);
  const aOf = (S: number) => Math.sqrt((S_EARTH_ABS * lum) / S);
  const planets = SPEC.map((p, k): SysPlanet => {
    const a = aOf(p.S_abs);
    const R_orig = interp(p.M, tables.dry.mass, tables.dry.radius, true);
    const steam = p.kind === 'steam';
    const R = steam ? R_orig * inflationFactor(p.M, wrr, tables) : R_orig;
    const look = {
      i: k, id: 900001 + k * 7 + (s.index % 997) * 31, M: p.M, R_orig, R, R_obs: R, S_abs: p.S_abs,
      runaway: p.S_abs > S_thresh, steam, P: 0, a, T_eff_st: s.teff, M_st: s.mass, d: s.d, SpT: s.spt,
      src: 'stellar-view', sR: 0, order: 0,
    } satisfies Planet;
    return { ...p, a, P: 365.25 * Math.sqrt(a ** 3 / Math.max(s.mass, 0.05)), R_orig, R, look };
  });
  const aCold = planets[planets.length - 1].a;
  return {
    index: s.index, pic: s.pic, spt: s.spt, teff: s.teff, lum, mass: s.mass, radius: s.radius, d: s.d,
    S_thresh, wrr, aThresh: aOf(S_thresh), unitAU: aCold / COLD_ORBIT, planets,
  };
}
