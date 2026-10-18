import type { Planet } from '../model/types';

export const fmt = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
export const signed = (x: number, d = 1) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d);
export const pct = (p: Planet) => 100 * (p.R / p.R_orig - 1);
export const S_EARTH_ABS = 1361 * 0.7 / 4;

export function hostLabel(p: Planet): string {
  const spt = p.SpT && p.SpT !== '?' && p.SpT !== 'None' ? `${p.SpT} dwarf` : 'host star';
  return `${spt} · ${Math.round(p.T_eff_st)} K`;
}

const PREFIX: Record<string, string> = { generic: 'SIM', artificial: 'SIM', P5: 'P5', P4: 'P4', synthetic: 'DEMO' };

/** Display name: sample of origin + index in its raw Bioverse population. */
export function planetName(p: Planet): string {
  return `${PREFIX[p.src] ?? p.src.toUpperCase()}-${p.id % 10_000_000}`;
}

export type StageInfo = { text: string; color: string };

export function stageText(p: Planet, hot: boolean, evap: number, heat: number, inflate: number, magma = 0): StageInfo {
  if (!hot) return { text: 'Below the threshold — water stays condensed', color: 'var(--cold)' };
  if (p.steam) {
    if (inflate > 0.6) return { text: magma > 0.6 ? 'Magma ocean beneath an inflated steam envelope' : 'Runaway greenhouse — inflated steam envelope', color: 'var(--hot)' };
    if (magma > 0.6 && heat > 0.3 && inflate < 0.5) return { text: 'Surface melting — a magma ocean forms', color: 'var(--hot-soft)' };
    if (inflate > 0.04) return { text: 'Steam atmosphere expanding', color: 'var(--hot-soft)' };
    if (evap > 0.04) return { text: 'Oceans evaporating — opacity rising', color: 'var(--warm-white)' };
    return { text: 'Temperate start — liquid surface water', color: 'var(--cold-soft)' };
  }
  if (heat > 0.5) return { text: 'No steam envelope — the planet stays compact', color: 'var(--h0)' };
  if (evap > 0.04) return { text: 'Little water to lose — no envelope forms', color: 'var(--warm-white)' };
  return { text: 'Temperate start — little surface water', color: 'var(--cold-soft)' };
}
