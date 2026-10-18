// The cinematic storyboard: one timeline drives the 3D planets, the plot and
// all overlays.  `buildStoryboard` turns a modelled population into timed
// shots; `sceneAt(t)` is a pure function of time, so the sequence can be
// scrubbed, replayed and looped without any hidden state.

import type { Planet } from '../model/types';
import type { Featured } from '../model/featured';
import { magmaStrength } from '../model/magma';
import type { Comparison } from '../model/evidence';

export type ShotKind = 'hot-steam' | 'hot-dry' | 'cold' | 'pair' | 'lineup';

export interface Shot {
  kind: ShotKind;
  planets: number[];               // [p] or [hot, cold] for the pair view
  start: number;                   // begins to emerge
  shown: number;                   // fully emerged
  exitStart: number;
  end: number;
  exitMode: 'fly' | 'recede' | 'none';
  evap: [number, number];
  heat: [number, number];
  inflate: [number, number];
  ghost: number;                   // ghost marker appears in the plot
}

export interface Phase { key: PhaseKey; label: string; start: number; end: number }
export type PhaseKey = 'hot' | 'threshold' | 'cold' | 'reveal' | 'inference' | 'hold' | 'outro';

export interface Storyboard {
  duration: number;
  phases: Phase[];
  shots: Shot[];
  appear: Float32Array;
  riseStart: Float32Array;
  riseEnd: Float32Array;
  fadeOut: Float32Array;
  featuredShot: Int16Array;
  threshold: [number, number];
  bins: [number, number];
  step: [number, number];
  infer: [number, number];
  grow: [number, number];
  /** Best-fit selection after the survey replay. */
  select: [number, number];
  outro: [number, number];
  n0: number;
}

export const EMERGE = 1.15;
export const FLY = 1.05;

export function buildStoryboard(planets: Planet[], S_thresh: number, featured: Featured): Storyboard {
  const n = planets.length;
  const shots: Shot[] = [];
  const featuredShot = new Int16Array(n).fill(-1);
  const appear = new Float32Array(n).fill(1e9);
  const riseStart = new Float32Array(n);
  const riseEnd = new Float32Array(n);

  const addSingle = (kind: ShotKind, p: number, start: number, D: number): Shot => {
    // strong magma oceans get their own beat: the surface melts in the open
    // before the steam envelope closes over it
    const magma = kind === 'hot-steam' && magmaStrength(planets[p], S_thresh) > 0.6;
    if (magma) D += 1.0;
    const shown = start + EMERGE;
    const end = start + D;
    const exitStart = end - FLY;
    const U = exitStart - shown;
    const w = (a: number, b: number): [number, number] => [shown + a * U, shown + b * U];
    const s: Shot = {
      kind, planets: [p], start, shown, exitStart, end, exitMode: 'fly',
      evap: kind === 'cold' ? [1e9, 1e9] : kind === 'hot-dry' ? w(0.05, 0.5) : magma ? w(0.03, 0.34) : w(0.04, 0.5),
      heat: kind === 'cold' ? [1e9, 1e9] : kind === 'hot-dry' ? w(0.3, 0.85) : magma ? w(0.12, 0.42) : w(0.3, 0.85),
      inflate: kind === 'hot-steam' ? (magma ? w(0.55, 0.97) : w(0.36, 0.95)) : [1e9, 1e9],
      ghost: kind === 'cold' ? shown + 0.15 * U : shown + 0.05 * U,
    };
    shots.push(s);
    featuredShot[p] = shots.length - 1;
    appear[p] = end;
    riseStart[p] = end;
    riseEnd[p] = end;
    return s;
  };

  // ── hot side ───────────────────────────────────────────────────────────────
  let t = 0;
  const hotShots: Shot[] = [];
  featured.hot.forEach((h, k) => {
    const D = k === 0 ? 7.0 : 5.0;
    const start = k === 0 ? -EMERGE : t;
    const s = addSingle(h.kind, h.planet, start, k === 0 ? D + EMERGE : D);
    hotShots.push(s);
    t = s.exitStart + 0.3;
  });
  const hotEnd = hotShots.length ? hotShots[hotShots.length - 1].end : 0.5;

  // ── threshold ──────────────────────────────────────────────────────────────
  const threshold: [number, number] = [hotEnd - 0.2, hotEnd + 1.6];
  // ── cold side ──────────────────────────────────────────────────────────────
  t = hotEnd + 0.9;
  const coldShots: Shot[] = featured.cold.map((p) => {
    const s = addSingle('cold', p, t, 4.0);
    t = s.exitStart + 0.3;
    return s;
  });
  // line-up of cold planets across the radius distribution, drawn to scale;
  // they fly into their points together with a small stagger
  const LINEUP_STAGGER = 0.14;
  if (featured.lineup.length) {
    const start = t;
    const D = 5.6 + LINEUP_STAGGER * (featured.lineup.length - 1);
    const s: Shot = {
      kind: 'lineup', planets: featured.lineup, start, shown: start + EMERGE,
      exitStart: start + D - FLY - LINEUP_STAGGER * (featured.lineup.length - 1), end: start + D, exitMode: 'fly',
      evap: [1e9, 1e9], heat: [1e9, 1e9], inflate: [1e9, 1e9], ghost: 1e9,
    };
    shots.push(s);
    featured.lineup.forEach((p, j) => {
      featuredShot[p] = shots.length - 1;
      appear[p] = s.exitStart + FLY + LINEUP_STAGGER * j;
      riseStart[p] = riseEnd[p] = appear[p];
    });
    coldShots.push(s);
  }
  const coldEnd = coldShots.length ? coldShots[coldShots.length - 1].end : threshold[1] + 0.5;

  // ── background points stream in during the featured shots ──────────────────
  const bgWindow = (side: 'hot' | 'cold'): [number, number] => {
    if (side === 'hot') {
      const a = hotShots.length > 1 ? hotShots[1].start + 0.3 : (hotShots[0]?.exitStart ?? 0) + 0.2;
      return [a, Math.max(a + 1, hotEnd - 0.4)];
    }
    const a = coldShots.length ? coldShots[0].start + 0.5 : threshold[1];
    return [a, Math.max(a + 1, coldEnd - 0.5)];
  };
  for (const side of ['hot', 'cold'] as const) {
    const members = planets.map((p, i) => ({ p, i }))
      .filter(({ p, i }) => featuredShot[i] < 0 && (side === 'hot' ? p.S_abs > S_thresh : p.S_abs <= S_thresh));
    const [a, b] = bgWindow(side);
    const m = members.length;
    members.forEach(({ p, i }, k) => {
      // planets are already in survey-arrival order; ease the stream in and out
      const u = m > 1 ? k / (m - 1) : 0;
      const eased = 0.5 - 0.5 * Math.cos(Math.PI * u) * 0.9;
      appear[i] = a + (b - a) * (0.06 + 0.94 * eased);
      riseStart[i] = appear[i] + 0.12;
      riseEnd[i] = p.steam ? appear[i] + 1.05 : appear[i] + 0.12;
    });
  }

  // ── reveal of the discontinuity ────────────────────────────────────────────
  const r0 = coldEnd + 0.1;
  const bins: [number, number] = [r0 + 0.2, r0 + 2.6];
  const step: [number, number] = [r0 + 2.5, r0 + 4.0];
  const revealEnd = r0 + 5.0;
  // ── inference ──────────────────────────────────────────────────────────────
  const infer: [number, number] = [revealEnd, revealEnd + 10.0];
  const grow: [number, number] = [revealEnd + 1.0, revealEnd + 7.0];
  const select: [number, number] = [grow[1] + 0.5, grow[1] + 2.0];
  const holdEnd = infer[1] + 2.4;
  const outro: [number, number] = [holdEnd, holdEnd + 3.6];
  const duration = outro[1];

  // pair view during reveal + inference
  if (featured.pair) {
    const s: Shot = {
      kind: 'pair', planets: [featured.pair.hot, featured.pair.cold],
      start: coldEnd - 0.35, shown: coldEnd - 0.35 + EMERGE, exitStart: outro[0] + 0.2, end: outro[0] + 1.7,
      exitMode: 'recede', evap: [-1e9, -1e9], heat: [-1e9, -1e9], inflate: [-1e9, -1e9], ghost: 1e9,
    };
    shots.push(s);
  }
  // reprise of the first shot: emerges at the end so the loop closes seamlessly
  if (hotShots.length) {
    const f = hotShots[0];
    shots.push({ ...f, start: outro[0] + 1.2, shown: duration, exitStart: 1e9, end: 1e9, exitMode: 'none', ghost: 1e9,
      evap: [1e9, 1e9], heat: [1e9, 1e9], inflate: [1e9, 1e9] });
  }

  // outro: points fade in a sweep from cold (right) to hot (left)
  const fadeOut = new Float32Array(n);
  const order = planets.map((p, i) => ({ s: p.S_abs, i })).sort((a, b) => a.s - b.s);
  order.forEach(({ i }, k) => { fadeOut[i] = outro[0] + 0.1 + 1.9 * (k / Math.max(1, n - 1)); });

  const phases: Phase[] = [
    { key: 'hot', label: 'Hot side', start: 0, end: threshold[0] },
    { key: 'threshold', label: 'Threshold', start: threshold[0], end: hotEnd + 0.9 },
    { key: 'cold', label: 'Cold side', start: hotEnd + 0.9, end: r0 },
    { key: 'reveal', label: 'Discontinuity', start: r0, end: revealEnd },
    { key: 'inference', label: 'Inference', start: infer[0], end: infer[1] },
    { key: 'hold', label: 'Signal', start: infer[1], end: holdEnd },
    { key: 'outro', label: 'Loop', start: outro[0], end: outro[1] },
  ];

  return {
    duration, phases, shots, appear, riseStart, riseEnd, fadeOut, featuredShot,
    threshold, bins, step, infer, grow, select, outro, n0: Math.min(8, n),
  };
}

// ── scene evaluation ─────────────────────────────────────────────────────────

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (a: number, b: number, x: number) => {
  const u = clamp01((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};
export const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
export const easeOut = (u: number) => 1 - Math.pow(1 - u, 3);

export interface RigState {
  key: string;
  planet: number;
  /** 0 = rest position in the planet panel; 1 = at its plot point. */
  fly: number;
  /** View slot: -1 single, 0/1 pair (hot, cold), 10 + j line-up position j. */
  slot: number;
  emerge: number;   // 0..1
  recede: number;   // 0..1
  evaporate: number;
  heat: number;
  inflate: number;
  focus: boolean;
}

export interface SceneState {
  t: number;
  phase: PhaseKey;
  rigs: RigState[];
  focusPlanet: number;
  focusShot: Shot | null;
  ghost: { planet: number; alpha: number; inflate: number } | null;
  threshold: number;     // line draw progress
  thresholdAlpha: number;
  bins: number;
  step: number;
  models: number;
  /** Best-fit selection: 0 = only posterior draws, 1 = best fit highlighted. */
  select: number;
  seqN: number;          // planets included in the evidence (arrival order)
  dimOthers: number;     // 0..1 dimming of planets beyond seqN
  evidence: number;      // evidence panel opacity
  overlays: number;      // global overlay opacity (fades in the outro)
}

export function stageOf(s: Shot, t: number) {
  return {
    evaporate: smooth(s.evap[0], s.evap[1], t),
    heat: smooth(s.heat[0], s.heat[1], t),
    inflate: smooth(s.inflate[0], s.inflate[1], t),
  };
}

export function seqNAt(sb: Storyboard, nTotal: number, t: number): number {
  if (t < sb.grow[0]) return t >= sb.infer[0] ? sb.n0 : nTotal;
  if (t >= sb.grow[1]) return nTotal;
  const u = clamp01((t - sb.grow[0]) / (sb.grow[1] - sb.grow[0]));
  const v = 0.5 - 0.5 * Math.cos(Math.PI * u);
  return Math.round(sb.n0 * Math.pow(nTotal / sb.n0, v));
}

export function sceneAt(sb: Storyboard, nTotal: number, t: number): SceneState {
  const rigs: RigState[] = [];
  let focusShot: Shot | null = null;
  let ghost: SceneState['ghost'] = null;
  sb.shots.forEach((s, k) => {
    if (t < s.start || t > s.end) return;
    const emerge = easeOut(clamp01((t - s.start) / (s.shown - s.start)));
    const ex = clamp01((t - s.exitStart) / (s.end - s.exitStart));
    const st = s.kind === 'pair' ? { evaporate: 1, heat: 1, inflate: 1 } : stageOf(s, t);
    if (s.kind === 'lineup') {
      s.planets.forEach((p, j) => {
        const stg = 0.14 * j;
        const em = easeOut(clamp01((t - s.start - stg * 0.6) / (s.shown - s.start)));
        const fl = clamp01((t - s.exitStart - stg) / FLY);
        rigs.push({ key: `${k}:${j}`, planet: p, fly: easeInOut(fl), slot: 10 + j, emerge: em, recede: 0,
          evaporate: 0, heat: 0, inflate: 0, focus: false });
      });
      return;
    }
    if (s.kind === 'pair') {
      s.planets.forEach((p, slot) => rigs.push({
        key: `${k}:${slot}`, planet: p, fly: 0, slot, emerge, recede: easeInOut(ex),
        evaporate: slot === 0 ? 1 : 0, heat: slot === 0 ? 1 : 0, inflate: slot === 0 ? 1 : 0, focus: false,
      }));
    } else {
      rigs.push({
        key: `${k}`, planet: s.planets[0], fly: s.exitMode === 'fly' ? easeInOut(ex) : 0, slot: -1,
        emerge, recede: s.exitMode === 'recede' ? ex : 0, ...st, focus: ex < 0.5,
      });
      if (ex < 0.5 && (!focusShot || s.start > focusShot.start)) focusShot = s;
      if (t >= s.ghost && t < s.end) {
        ghost = { planet: s.planets[0], alpha: smooth(s.ghost, s.ghost + 0.4, t) * (1 - smooth(s.end - 0.15, s.end, t)), inflate: st.inflate };
      }
    }
  });
  const phase = sb.phases.find((p) => t >= p.start && t < p.end)?.key ?? 'outro';
  const fadeAll = 1 - smooth(sb.outro[0], sb.outro[0] + 1.3, t);
  return {
    t, phase, rigs,
    focusPlanet: focusShot ? (focusShot as Shot).planets[0] : -1,
    focusShot,
    ghost,
    threshold: smooth(sb.threshold[0], sb.threshold[0] + 1.3, t) * fadeAll,
    thresholdAlpha: fadeAll,
    bins: clamp01((t - sb.bins[0]) / (sb.bins[1] - sb.bins[0])) * fadeAll,
    step: smooth(sb.step[0], sb.step[1], t) * fadeAll * (1 - smooth(sb.infer[0], sb.infer[0] + 0.8, t)),
    models: smooth(sb.infer[0], sb.infer[0] + 0.9, t) * fadeAll,
    select: smooth(sb.select[0], sb.select[1], t),
    seqN: seqNAt(sb, nTotal, t),
    dimOthers: smooth(sb.infer[0], sb.infer[0] + 0.7, t) * (1 - smooth(sb.grow[1], sb.grow[1] + 0.6, t)),
    evidence: smooth(sb.infer[0] + 0.2, sb.infer[0] + 1.0, t) * fadeAll,
    overlays: fadeAll,
  };
}

export type { Comparison };
