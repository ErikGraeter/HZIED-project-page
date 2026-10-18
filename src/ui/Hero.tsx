// The hero: synchronised 3D planet + radius–flux plot + Bayesian comparison,
// all driven by one clock and one pure scene function (storyboard.sceneAt).

import { useEffect, useRef, useState } from 'react';
import type { HziedData, ModelParams } from '../model/types';
import type { ModelState } from '../model/compute';
import { PlanetView, type Layout, type PairInfo, type RingInfo } from '../three/PlanetView';
import { PlotView, COLORS } from '../plot/PlotView';
import { Clock } from '../timeline/clock';
import { clamp01, easeInOut, easeOut, sceneAt, smooth, type PhaseKey, type RigState, type SceneState } from '../timeline/storyboard';
import { fitAt, LNK_LEVELS, verdict } from '../model/evidence';
import type { ModelState as MS } from '../model/compute';
import { fmt, hostLabel, pct, planetName, signed, stageText, S_EARTH_ABS } from './format';
import { SciencePanel } from './SciencePanel';
import { magmaStrength, starColor } from '../three/planetLook';

type Mode = 'cinematic' | 'explore';

interface Props {
  data: HziedData;
  model: ModelState;
  params: ModelParams;
  setParams: (p: ModelParams) => void;
  reducedMotion: boolean;
}

const TONE: Record<string, string> = {
  h0: COLORS.h0, none: COLORS.h0, weak: '#d9b98a', moderate: '#f0b070', strong: '#ff9a5c', decisive: '#ffd1a8',
};

/** Largest drawn extent among featured planets (sets the common 3D scale). */
function sizeRefOf(m: MS): number {
  const f = m.featured;
  const ids = [...f.hot.map((h) => h.planet), ...f.cold, ...f.lineup, ...(f.pair ? [f.pair.hot, f.pair.cold] : [])];
  const ext = ids.map((i) => m.planets[i]).filter(Boolean)
    .map((p) => p.R_orig * (1 + (p.R / p.R_orig - 1) * m.params.envelopeScale));
  return ext.length ? Math.max(...ext) : 1.6;
}

export function Hero({ data, model, params, setParams, reducedMotion }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const plotWrapRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const plotRef = useRef<HTMLCanvasElement>(null);
  const ringRef = useRef<SVGGElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const evRef = useRef<HTMLDivElement>(null);
  const evValRef = useRef<HTMLDivElement>(null);
  const evVerdictRef = useRef<HTMLSpanElement>(null);
  const evPipRef = useRef<HTMLSpanElement>(null);
  const evNRef = useRef<HTMLDivElement>(null);
  const sparkRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const cardStageRef = useRef<HTMLSpanElement>(null);
  const cardDotRef = useRef<HTMLSpanElement>(null);
  const leakRef = useRef<HTMLDivElement>(null);
  const pairRef = useRef<SVGGElement>(null);
  const lineupRef = useRef<SVGGElement>(null);
  const tallyRef = useRef<HTMLDivElement>(null);
  const tNRef = useRef<HTMLSpanElement>(null);
  const tHRef = useRef<HTMLSpanElement>(null);
  const tSRef = useRef<HTMLSpanElement>(null);
  const tCRef = useRef<HTMLSpanElement>(null);
  const views = useRef<{ pv: PlanetView; plot: PlotView } | null>(null);

  const [mode, setModeState] = useState<Mode>('cinematic');
  const [playing, setPlaying] = useState(!reducedMotion);
  const [speed, setSpeed] = useState(1);
  const [focus, setFocus] = useState(-1);
  const [narr, setNarr] = useState({ key: '', kicker: '', text: '' });
  const [phase, setPhase] = useState<PhaseKey>('hot');
  const [scienceOpen, setScienceOpen] = useState(false);
  const [tip, setTip] = useState(-1);
  const [glError, setGlError] = useState(false);

  const S = useRef({
    clock: new Clock(),
    mode: 'cinematic' as Mode,
    model,
    selectedId: -1,
    selected: -1,
    selectedAt: -10,
    prev: -1,
    prevAt: -10,
    replayAt: -1,
    hover: -1,
    focus: -1,
    narrKey: '',
    phase: 'hot' as PhaseKey,
    seqDrawn: -1,
    visible: true,
    drag: null as null | { x: number; y: number; vx: number },
    yawVel: 0,
    stageW: 1, stageH: 1,
    panel: { x: 0, y: 0, w: 1, h: 1 },
    reduced: reducedMotion,
    stageKey: '',
    leakT: 0,
    tally: '',
  });

  // ── initial clock state ────────────────────────────────────────────────────
  useEffect(() => {
    const st = S.current;
    st.clock.duration = model.storyboard.duration;
    if (reducedMotion) {
      st.clock.playing = false;
      st.clock.seek(model.storyboard.infer[1] + 0.5);
    }
    // deep links / reproducible stills: ?t=<seconds>&paused=1&speed=<x>&mode=explore
    const q = new URLSearchParams(window.location.search);
    const t = parseFloat(q.get('t') ?? '');
    if (Number.isFinite(t)) st.clock.seek(t);
    if (q.get('paused') === '1') { st.clock.playing = false; setPlaying(false); }
    const sp = parseFloat(q.get('speed') ?? '');
    if (Number.isFinite(sp) && sp > 0) { st.clock.speed = sp; setSpeed(sp); }
    if (q.get('mode') === 'explore') setTimeout(() => setMode('explore'), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── model changes ──────────────────────────────────────────────────────────
  useEffect(() => {
    const st = S.current;
    st.model = model;
    st.clock.duration = model.storyboard.duration;
    st.seqDrawn = -1;
    if (st.selectedId >= 0) st.selected = model.planets.findIndex((p) => p.id === st.selectedId);
    if (st.mode === 'explore' && st.selected < 0 && model.planets.length) {
      st.selected = model.featured.pair?.hot ?? model.featured.hot[0]?.planet ?? 0;
      st.selectedId = model.planets[st.selected].id;
      st.selectedAt = performance.now() / 1000;
    }
    if (views.current) {
      views.current.plot.setData({ planets: model.planets, S_thresh: model.params.S_thresh, seq: model.seq, final: model.final, bins: model.bins });
      views.current.pv.envelopeScale = model.params.envelopeScale;
      views.current.pv.sizeRef = sizeRefOf(model);
    }
    st.focus = -2;
  }, [model]);

  const setMode = (m: Mode) => {
    const st = S.current;
    st.mode = m;
    setModeState(m);
    if (m === 'explore') {
      if (st.selected < 0) {
        const f = st.focus >= 0 ? st.focus : st.model.featured.pair?.hot ?? 0;
        select(f, false);
      }
    } else {
      st.replayAt = -1;
      st.clock.playing = !st.reduced || playing;
    }
  };

  const select = (i: number, animateFromPrev = true) => {
    const st = S.current;
    const now = performance.now() / 1000;
    if (i === st.selected) return;
    if (animateFromPrev && st.selected >= 0 && st.mode === 'explore') { st.prev = st.selected; st.prevAt = now; }
    st.selected = i;
    st.selectedId = i >= 0 ? st.model.planets[i]?.id ?? -1 : -1;
    st.selectedAt = now;
    st.replayAt = -1;
  };

  // ── main loop ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const st = S.current;
    let pv: PlanetView;
    try {
      pv = new PlanetView(glRef.current!);
    } catch {
      setGlError(true);
      return;
    }
    const plot = new PlotView(plotRef.current!);
    views.current = { pv, plot };
    plot.setData({ planets: st.model.planets, S_thresh: st.model.params.S_thresh, seq: st.model.seq, final: st.model.final, bins: st.model.bins });
    pv.envelopeScale = st.model.params.envelopeScale;
    pv.sizeRef = sizeRefOf(st.model);

    const measure = () => {
      const stage = stageRef.current!, panel = panelRef.current!, wrap = plotWrapRef.current!;
      const sr = stage.getBoundingClientRect();
      const pr = panel.getBoundingClientRect();
      const wr = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      st.stageW = sr.width; st.stageH = sr.height;
      st.panel = { x: pr.left - sr.left, y: pr.top - sr.top, w: pr.width, h: pr.height };
      pv.resize(sr.width, sr.height, dpr);
      plot.resize(wr.width, wr.height, dpr);
      plot.offset = { x: wr.left - sr.left, y: wr.top - sr.top };
      st.seqDrawn = -1;
    };
    const ro = new ResizeObserver(measure);
    [stageRef.current!, panelRef.current!, plotWrapRef.current!].forEach((el) => ro.observe(el));
    measure();
    const io = new IntersectionObserver((e) => { st.visible = e[0].isIntersecting; }, { threshold: 0.02 });
    io.observe(stageRef.current!);
    if (document.fonts?.ready) document.fonts.ready.then(() => measure());

    const finalStage = (i: number) => {
      const p = st.model.planets[i];
      const hot = p && p.S_abs > st.model.params.S_thresh;
      return { evaporate: hot ? 1 : 0, heat: hot ? 1 : 0, inflate: hot && p.steam ? 1 : 0 };
    };
    const exploreScene = (now: number): SceneState => {
      const rigs: RigState[] = [];
      const m = st.model;
      let ghost: SceneState['ghost'] = null;
      if (st.prev >= 0 && now - st.prevAt < 1.1 && st.prev < m.planets.length) {
        rigs.push({ key: `prev${st.prev}`, planet: st.prev, fly: easeInOut(clamp01((now - st.prevAt) / 1.05)), slot: -1,
          emerge: 1, recede: 0, ...finalStage(st.prev), focus: false });
      }
      if (st.selected >= 0 && st.selected < m.planets.length) {
        let stage = finalStage(st.selected);
        if (st.replayAt >= 0) {
          const d = now - st.replayAt;
          const p = m.planets[st.selected];
          const hot = p.S_abs > m.params.S_thresh;
          stage = {
            evaporate: hot ? smooth(0.5, 2.2, d) : 0,
            heat: hot ? smooth(1.4, 3.4, d) : 0,
            inflate: hot && p.steam ? smooth(1.7, 3.9, d) : 0,
          };
          ghost = { planet: st.selected, alpha: 1 - smooth(4.6, 5.2, d), inflate: stage.inflate };
          if (d > 5.2) st.replayAt = -1;
        }
        rigs.push({ key: `sel${st.selected}`, planet: st.selected, fly: 0, slot: -1,
          emerge: easeOut(clamp01((now - st.selectedAt) / 1.1)), recede: 0, ...stage, focus: true });
      }
      return {
        t: now, phase: 'hold', rigs, focusPlanet: st.selected, focusShot: null, ghost,
        threshold: 1, thresholdAlpha: 1, bins: 0, step: 0, models: 1, seqN: m.planets.length,
        dimOthers: 0, evidence: 1, overlays: 1, select: 1,
      };
    };

    let raf = 0;
    let ema = 1 / 60, lastMs = -1, slow = 0;
    const loop = (nowMs: number) => {
      raf = requestAnimationFrame(loop);
      // adaptive quality: sustained frame times above ~28 ms lower the WebGL resolution
      if (lastMs > 0 && st.visible) {
        ema = 0.95 * ema + 0.05 * Math.min(0.2, (nowMs - lastMs) / 1000);
        slow = ema > 0.028 ? slow + 1 : 0;
        if (slow > 90) { slow = 0; ema = 1 / 60; pv.degrade(); }
      }
      lastMs = nowMs;
      const m = st.model;
      const explore = st.mode === 'explore';
      if (!st.visible) { st.clock.hold(nowMs); return; }
      const wasPlaying = st.clock.playing;
      if (explore) st.clock.playing = false;
      st.clock.tick(nowMs, explore || wasPlaying);
      st.clock.playing = wasPlaying;
      // drag inertia
      if (!st.drag && Math.abs(st.yawVel) > 1e-4) { pv.userYaw += st.yawVel; st.yawVel *= 0.94; }

      const now = nowMs / 1000;
      const scene = explore ? exploreScene(now) : sceneAt(m.storyboard, m.planets.length, st.clock.t);
      const layout: Layout = { width: st.stageW, height: st.stageH, panel: st.panel, pointOf: (i) => plot.pointOf(i) };
      const info = pv.render(scene.rigs, m.planets, m.params.S_thresh, layout, st.clock.rot);
      plot.draw({ scene, sb: explore ? null : m.storyboard, hover: st.hover, selected: explore ? st.selected : -1 });

      updateRing(info.ring, scene);
      updatePair(info.pair, scene);
      updateTally(scene, explore);
      updateEvidence(scene);
      updateTimeline();
      updateCard(scene);
      updateNarration(scene, explore);
    };

    const updateRing = (ring: RingInfo | null, scene: SceneState) => {
      const g = ringRef.current;
      if (!g) return;
      const m = st.model;
      if (!ring || scene.overlays < 0.05) { g.style.opacity = '0'; return; }
      const p = m.planets[ring.planet];
      const hot = p.S_abs > m.params.S_thresh;
      const show = hot && p.steam ? smooth(0.05, 0.5, ring.inflate) : 0.85;
      g.style.opacity = String(show * scene.overlays);
      const [cRock, cTr, lRock, lTr, tRock, tRockV, tTr, tTrV] = Array.from(g.children) as SVGElement[];
      const a1 = -0.62, a2 = 0.5;
      const set = (el: SVGElement, attrs: Record<string, number | string>) => { for (const k in attrs) el.setAttribute(k, String(attrs[k])); };
      set(cRock, { cx: ring.cx, cy: ring.cy, r: ring.rc });
      const inflated = hot && p.steam;
      set(cTr, { cx: ring.cx, cy: ring.cy, r: ring.rt, opacity: inflated ? 1 : 0 });
      const narrow = st.panel.w < 620;
      if (!narrow) {
        const lx = ring.cx + ring.rtFull + 26;
        const yTr = ring.cy + ring.rt * Math.sin(a1);
        const xTr = ring.cx + ring.rt * Math.cos(a1);
        const yRk = ring.cy + ring.rc * Math.sin(a2);
        const xRk = ring.cx + ring.rc * Math.cos(a2);
        set(lTr, { x1: xTr, y1: yTr, x2: lx, y2: yTr - 18, opacity: inflated ? 1 : 0 });
        set(lRock, { x1: xRk, y1: yRk, x2: lx, y2: yRk + 26, opacity: 1 });
        set(tTr, { x: lx + 4, y: yTr - 30, 'text-anchor': 'start', opacity: inflated ? 1 : 0 });
        set(tTrV, { x: lx + 4, y: yTr - 15, 'text-anchor': 'start', opacity: inflated ? 1 : 0 });
        set(tRock, { x: lx + 4, y: yRk + 22, 'text-anchor': 'start' });
        set(tRockV, { x: lx + 4, y: yRk + 37, 'text-anchor': 'start' });
      } else {
        // narrow panels: two captions above the planet, no leader lines
        const yTop = ring.cy - ring.rtFull - 14;
        set(lTr, { opacity: 0 });
        set(lRock, { opacity: 0 });
        set(tTr, { x: ring.cx - 8, y: yTop - 15, 'text-anchor': 'end', opacity: inflated ? 1 : 0 });
        set(tTrV, { x: ring.cx - 8, y: yTop, 'text-anchor': 'end', opacity: inflated ? 1 : 0 });
        set(tRock, { x: inflated ? ring.cx + 8 : ring.cx, y: yTop - 15, 'text-anchor': inflated ? 'start' : 'middle' });
        set(tRockV, { x: inflated ? ring.cx + 8 : ring.cx, y: yTop, 'text-anchor': inflated ? 'start' : 'middle' });
      }
      const R = p.R_orig + (p.R - p.R_orig) * ring.inflate;
      tTrV.textContent = `${R.toFixed(3)} R⊕  (+${(100 * (R / p.R_orig - 1)).toFixed(1)} %)`;
      tRock.textContent = inflated ? 'rocky surface' : 'radius (no envelope)';
      tRockV.textContent = `${p.R_orig.toFixed(3)} R⊕`;
      if (Math.abs(m.params.envelopeScale - 1) > 1e-3) tTr.textContent = `transit radius · envelope drawn ×${m.params.envelopeScale.toFixed(1)}`;
      else tTr.textContent = 'transit radius';
    };

    const updatePair = (pair: PairInfo[], scene: SceneState) => {
      const lg = lineupRef.current;
      if (lg) {
        const items = pair.filter((q) => q.slot >= 10).sort((a, b) => a.slot - b.slot);
        const texts = Array.from(lg.children) as SVGTextElement[];
        const title = texts[0];
        if (items.length) {
          const top = Math.min(...items.map((q) => q.cy - q.r));
          const op = Math.min(...items.map((q) => q.opacity)) * scene.overlays;
          title.setAttribute('x', String((items[0].cx + items[items.length - 1].cx) / 2));
          title.setAttribute('y', String(top - 22));
          title.setAttribute('opacity', String(op));
          title.textContent = 'cold side · radii to scale';
        } else title.setAttribute('opacity', '0');
        for (let j = 1; j < texts.length; j++) {
          const q = items[j - 1];
          const el = texts[j];
          if (!q) { el.setAttribute('opacity', '0'); continue; }
          const p = st.model.planets[q.planet];
          el.setAttribute('x', String(q.cx));
          el.setAttribute('y', String(q.cy + Math.max(...items.map((u) => u.r)) + 26));
          el.setAttribute('opacity', String(q.opacity * scene.overlays));
          el.textContent = p ? `${p.R_orig.toFixed(2)} R⊕` : '';
        }
      }
      const g = pairRef.current;
      if (!g) return;
      const m = st.model;
      const texts = Array.from(g.children) as SVGTextElement[];
      for (let k = 0; k < 2; k++) {
        const info = pair.find((q) => q.slot === k);
        const [a, b] = [texts[2 * k], texts[2 * k + 1]];
        if (!info) { a.setAttribute('opacity', '0'); b.setAttribute('opacity', '0'); continue; }
        const p = m.planets[info.planet];
        const op = String(info.opacity * scene.overlays);
        const y = info.cy + info.r + 30;
        a.setAttribute('x', String(info.cx)); a.setAttribute('y', String(y)); a.setAttribute('opacity', op);
        b.setAttribute('x', String(info.cx)); b.setAttribute('y', String(y + 16)); b.setAttribute('opacity', op);
        if (k === 0) {
          a.textContent = 'hot side · steam envelope';
          b.textContent = p ? `${p.R_orig.toFixed(2)} → ${p.R.toFixed(2)} R⊕  (+${pct(p).toFixed(1)} %)` : '';
        } else {
          a.textContent = 'cold side · water condensed';
          b.textContent = p ? `${p.R.toFixed(2)} R⊕  (compact)` : '';
        }
      }
    };

    const updateTally = (scene: SceneState, explore: boolean) => {
      const m = st.model;
      const sb = m.storyboard;
      let n = 0, hot = 0, steam = 0, cold = 0;
      for (let i = 0; i < m.planets.length; i++) {
        if (!explore && (sb.appear[i] > scene.t || scene.t > sb.fadeOut[i] + 0.3)) continue;
        if (!explore && scene.phase === 'inference' && i >= scene.seqN) continue;
        const p = m.planets[i];
        n++;
        if (p.S_abs > m.params.S_thresh) { hot++; if (p.steam) steam++; } else cold++;
      }
      const key = `${n}:${hot}:${steam}:${cold}`;
      if (key === st.tally) return;
      st.tally = key;
      tNRef.current!.textContent = n.toLocaleString('en-US');
      tHRef.current!.textContent = hot.toLocaleString('en-US');
      tSRef.current!.textContent = steam.toLocaleString('en-US');
      tCRef.current!.textContent = cold.toLocaleString('en-US');
    };

    const drawSpark = (seqN: number) => {
      const c = sparkRef.current;
      if (!c) return;
      const m = st.model;
      const w = c.clientWidth || 210, h = 46, dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      const g = c.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const n = m.seq.length;
      if (n < 2) return;
      const ks = m.seq.map((s) => s.lnK);
      const ns = m.seq.map((s) => s.n);
      const lo = Math.min(-4, ...ks), hi = Math.max(LNK_LEVELS.strong + 3, ...ks);
      const nMin = Math.max(1, ns[0]), nMax = ns[n - 1];
      const X = (i: number) => 2 + (w - 4) * Math.log(ns[i] / nMin) / Math.log(Math.max(nMax / nMin, 1.0001));
      const Y = (v: number) => h - 4 - (h - 8) * (v - lo) / (hi - lo);
      g.lineWidth = 1;
      g.strokeStyle = 'rgba(255,255,255,0.12)';
      g.beginPath(); g.moveTo(0, Math.round(Y(0)) + 0.5); g.lineTo(w, Math.round(Y(0)) + 0.5); g.stroke();
      g.setLineDash([3, 3]);
      g.strokeStyle = 'rgba(255,190,140,0.45)';
      g.beginPath(); g.moveTo(0, Math.round(Y(LNK_LEVELS.strong)) + 0.5); g.lineTo(w, Math.round(Y(LNK_LEVELS.strong)) + 0.5); g.stroke();
      g.setLineDash([]);
      g.fillStyle = 'rgba(233,237,244,0.45)';
      g.font = '9px "JetBrains Mono", monospace';
      g.textAlign = 'left';
      g.fillText('strong (5)', 3, Y(LNK_LEVELS.strong) - 3);
      // full curve faint, revealed part bright
      g.strokeStyle = 'rgba(233,237,244,0.18)';
      g.lineWidth = 1.5;
      g.beginPath();
      ks.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
      g.stroke();
      let upto = 1;
      while (upto < n && ns[upto] <= seqN) upto++;
      g.strokeStyle = COLORS.ink;
      g.lineWidth = 2;
      g.beginPath();
      for (let i = 0; i < upto; i++) (i ? g.lineTo(X(i), Y(ks[i])) : g.moveTo(X(i), Y(ks[i])));
      g.stroke();
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(X(upto - 1), Y(ks[upto - 1]), 3, 0, Math.PI * 2); g.fill();
    };

    const updateEvidence = (scene: SceneState) => {
      const el = evRef.current;
      if (!el) return;
      const m = st.model;
      el.style.opacity = String(scene.evidence);
      if (tallyRef.current) tallyRef.current.style.opacity = String(1 - scene.evidence);
      if (scene.evidence <= 0.001) return;
      const n = m.planets.length;
      const k = Math.max(1, Math.min(n, scene.seqN));
      if (k === st.seqDrawn) return;
      st.seqDrawn = k;
      const c = fitAt(m.seq, k);
      const v = verdict(c.lnK);
      evValRef.current!.textContent = `${signed(c.lnK, 1)}`;
      evVerdictRef.current!.textContent = v.label;
      evPipRef.current!.style.background = TONE[v.tone];
      const [q16, q50, q84] = c.sQ;
      evNRef.current!.textContent = `N = ${c.n} · S_thresh = ${Math.round(q50)} (+${Math.round(q84 - q50)}/−${Math.round(q50 - q16)}) W m⁻²`;
      drawSpark(k);
    };

    const updateTimeline = () => {
      const d = st.clock.duration;
      const f = st.mode === 'explore' ? 1 : st.clock.t / d;
      if (fillRef.current) fillRef.current.style.width = `${(f * 100).toFixed(3)}%`;
      if (knobRef.current) knobRef.current.style.left = `${(f * 100).toFixed(3)}%`;
    };

    const updateCard = (scene: SceneState) => {
      const m = st.model;
      const fp = scene.focusPlanet;
      if (fp !== st.focus) { st.focus = fp; setFocus(fp); }
      if (cardRef.current) {
        cardRef.current.style.opacity = String(fp >= 0 ? scene.overlays : 0);
        cardRef.current.style.pointerEvents = fp >= 0 && scene.overlays > 0.5 ? 'auto' : 'none';
      }
      const rig = scene.rigs.find((r) => r.focus);
      if (rig && fp >= 0 && cardStageRef.current) {
        const p = m.planets[fp];
        if (!p) return;
        const s = stageText(p, p.S_abs > m.params.S_thresh, rig.evaporate, rig.heat, rig.inflate, magmaStrength(p, m.params.S_thresh));
        if (s.text !== st.stageKey) {
          st.stageKey = s.text;
          cardStageRef.current.textContent = s.text;
          cardDotRef.current!.style.background = s.color;
        }
        // star light leak follows the host star colour
        if (leakRef.current && st.leakT !== p.T_eff_st) {
          st.leakT = p.T_eff_st;
          const c = starColor(p.T_eff_st).map((v) => Math.round(v * 255)).join(',');
          leakRef.current.style.setProperty('--star', `rgb(${c})`);
        }
      }
    };

    const updateNarration = (scene: SceneState, explore: boolean) => {
      const m = st.model;
      const S_t = Math.round(m.params.S_thresh);
      let key = '', kicker = '', text = '';
      if (explore) {
        key = 'explore'; kicker = 'Explore';
        text = 'Hover over a point for its properties, click to bring the planet into view, and drag the planet to rotate it. The science controls re-run the model.';
      } else {
        const shot = scene.focusShot;
        const ph = scene.phase;
        const first = shot && m.storyboard.shots.indexOf(shot) === 0;
        key = `${ph}:${shot ? m.storyboard.shots.indexOf(shot) : -1}`;
        switch (ph) {
          case 'hot':
            kicker = '01 · Hot side';
            if (shot?.kind === 'hot-dry') text = 'Not every hot planet inflates. Without a steam envelope (the fraction 1 − f_rgh of the hot side) a planet stays compact — real scatter, not a clean split.';
            else if (first || !shot) text = `A temperate rocky planet beyond the runaway limit (S_abs > ${S_t} W m⁻²): its oceans evaporate and the steam envelope lifts the transit radius above the rocky surface.`;
            else if (shot && magmaStrength(m.planets[shot.planets[0]], m.params.S_thresh) > 0.7) text = `Strongly irradiated (${Math.round(m.planets[shot.planets[0]].S_abs)} W m⁻²): beneath the steam the surface melts into a magma ocean, glowing through gaps in the clouds.`;
            else text = 'Each inflated planet lands at its transit radius. The short stems show how far the steam envelope lifted it above the rocky radius.';
            break;
          case 'threshold':
            kicker = '02 · Threshold';
            text = `Near ${S_t} W m⁻² of absorbed flux the thermal emission of a water-rich atmosphere saturates: the runaway greenhouse limit, the inner edge of the habitable zone.`;
            break;
          case 'cold': {
            kicker = '03 · Cold side';
            const lineupShot = m.storyboard.shots.find((x) => x.kind === 'lineup' && scene.t >= x.start && scene.t <= x.end);
            if (lineupShot) key += ':lineup';
            if (lineupShot) {
              const rs = lineupShot.planets.map((p) => m.planets[p].R_orig);
              text = `Cold planets come in many sizes — here ${Math.min(...rs).toFixed(2)} to ${Math.max(...rs).toFixed(2)} R⊕, drawn to scale. Their radii are set by mass and composition, not by steam.`;
            } else {
              text = 'Below the threshold water condenses into oceans and clouds. Small or large, these planets keep their compact rocky radii.';
            }
            break;
          }
          case 'reveal':
            kicker = '04 · Discontinuity';
            text = 'Binned mean radii (±1 s.e.) step up across the threshold: individually subtle, collectively a population-level discontinuity — the HZIED.';
            break;
          case 'inference':
            kicker = '05 · Bayesian inference';
            text = scene.select > 0.2
              ? `Best fit selected: the step lands at S_thresh ≈ ${Math.round(m.fit.best.S)} W m⁻² (injected: ${S_t}).`
              : `As the survey grows: ${m.fit.draws.length} posterior draws (red) of a step model whose threshold, hot and cold mean radii are all free (H1), against a single mean (H0, grey).`;
            key += scene.select > 0.2 ? ':sel' : '';
            break;
          default: {
            kicker = '06 · The signal';
            const v = verdict(m.fit.lnK);
            const [q16, , q84] = m.fit.sQ;
            text = `All ${m.planets.length} planets: ln K = ${signed(m.fit.lnK, 1)} (${v.label}); best fit S_thresh ≈ ${Math.round(m.fit.best.S)} W m⁻², 68 % interval ${Math.round(q16)}–${Math.round(q84)} W m⁻² (injected ${S_t}).`;
          }
        }
        if (ph !== st.phase) { st.phase = ph; setPhase(ph); }
      }
      if (key !== st.narrKey) { st.narrKey = key; setNarr({ key, kicker, text }); }
    };

    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      pv.dispose();
      views.current = null;
    };
  }, []);

  // ── playback controls ──────────────────────────────────────────────────────
  const togglePlay = () => {
    const st = S.current;
    if (st.mode === 'explore') { setMode('cinematic'); st.clock.playing = true; setPlaying(true); return; }
    st.clock.playing = !st.clock.playing;
    setPlaying(st.clock.playing);
  };
  const replay = () => {
    const st = S.current;
    if (st.mode === 'explore') setMode('cinematic');
    st.clock.seek(0);
    st.clock.playing = true;
    setPlaying(true);
  };
  const changeSpeed = (v: number) => { S.current.clock.speed = v; setSpeed(v); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
      const r = stageRef.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.key === 'r' || e.key === 'R') replay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // timeline scrubbing
  const scrub = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const f = clamp01((clientX - r.left) / r.width);
    const st = S.current;
    if (st.mode === 'explore') setMode('cinematic');
    st.clock.seek(f * st.clock.duration * 0.99999);
  };

  // plot interaction
  const onPlotMove = (e: React.PointerEvent) => {
    const v = views.current;
    if (!v) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const i = v.plot.hitTest(x, y, e.pointerType === 'touch' ? 18 : 11);
    S.current.hover = i;
    if (i !== tip) setTip(i);
    const t = tipRef.current;
    if (t && i >= 0) {
      const pos = v.plot.drawnPos(i);
      const wrap = plotWrapRef.current!.getBoundingClientRect();
      const flip = pos.x > wrap.width - 230;
      t.style.left = `${pos.x + (flip ? -238 : 0)}px`;
      t.style.top = `${pos.y}px`;
      t.style.opacity = '1';
    } else if (t) t.style.opacity = '0';
  };
  const onPlotLeave = () => { S.current.hover = -1; setTip(-1); if (tipRef.current) tipRef.current.style.opacity = '0'; };
  const onPlotClick = (e: React.PointerEvent) => {
    const v = views.current;
    if (!v) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const i = v.plot.hitTest(e.clientX - r.left, e.clientY - r.top, e.pointerType === 'touch' ? 18 : 11);
    if (i < 0) return;
    if (S.current.mode !== 'explore') setMode('explore');
    select(i);
  };

  // planet drag rotation
  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    S.current.drag = { x: e.clientX, y: e.clientY, vx: 0 };
  };
  const onMove = (e: React.PointerEvent) => {
    const st = S.current, d = st.drag, v = views.current;
    if (!d || !v) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.x = e.clientX; d.y = e.clientY;
    v.pv.userYaw += dx * 0.009;
    v.pv.userPitch = Math.max(-0.7, Math.min(0.7, v.pv.userPitch + dy * 0.006));
    st.yawVel = dx * 0.009;
  };
  const onUp = () => { S.current.drag = null; };

  const m = model;
  const fp = focus >= 0 ? m.planets[focus] : null;
  const fpHot = fp ? fp.S_abs > m.params.S_thresh : false;
  const tipP = tip >= 0 ? m.planets[tip] : null;
  const sb = m.storyboard;

  return (
    <section className="hero" id="top" aria-label="Animated explanation of the HZIED">
      <div className="star-leak" ref={leakRef} />
      <div className="hero-title">
        <div className="titles">
          <p className="eyebrow">Exoplanet demographics · PLATO · Bayesian inference</p>
          <h1>The Habitable Zone <em>Inner Edge</em> Discontinuity</h1>
          <p className="subtitle">When planetary atmospheres expand, a hidden boundary becomes observable.</p>
        </div>
      </div>
      {data.synthetic && (
        <div className="banner">Pipeline export not found — showing deterministic synthetic demonstration data (not Bioverse output). Run <code>npm run export-data</code>.</div>
      )}

      <div className="stage" ref={stageRef}>
        <canvas className="gl-canvas" ref={glRef} aria-hidden="true" />
        <svg className="ring-overlay" aria-hidden="true">
          <g ref={ringRef} style={{ opacity: 0, transition: 'opacity 0.3s' }}>
            <circle fill="none" stroke="rgba(246,236,222,0.75)" strokeWidth="1.2" strokeDasharray="3 4" />
            <circle fill="none" stroke={COLORS.hot} strokeWidth="1.4" />
            <line stroke="rgba(246,236,222,0.5)" strokeWidth="1" />
            <line stroke="rgba(255,160,106,0.7)" strokeWidth="1" />
            <text />
            <text className="val" />
            <text />
            <text className="val" />
          </g>
          <g ref={lineupRef} className="pair-captions">
            <text textAnchor="middle" className="pc-a" />
            {[0, 1, 2, 3, 4, 5, 6].map((j) => <text key={j} textAnchor="middle" className="val" />)}
          </g>
          <g ref={pairRef} className="pair-captions">
            <text textAnchor="middle" className="pc-a" />
            <text textAnchor="middle" className="val" />
            <text textAnchor="middle" className="pc-a" />
            <text textAnchor="middle" className="val" />
          </g>
        </svg>

        <div className="planet-panel" ref={panelRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          role="img" aria-label={fp ? `3D view of ${planetName(fp)}, ${fpHot ? 'hot side' : 'cold side'}` : '3D planet view'}>
          <div className="drag-hint" style={{ opacity: mode === 'explore' || !playing ? 1 : 0 }}>drag to rotate</div>
          {glError && <div className="banner" style={{ marginTop: 40 }}>WebGL is not available in this browser — the 3D planets cannot be shown.</div>}
        </div>

        <div className="planet-card" ref={cardRef} style={{ opacity: 0 }}>
          {fp && (
            <>
              <div className="pc-head">
                <span className="pc-name">{planetName(fp)}</span>
                <span className={`chip ${fpHot ? 'hot' : 'cold'}`}>{fpHot ? 'hot side' : 'cold side'}</span>
              </div>
              <div className="pc-stage"><span className="stage-dot" ref={cardDotRef} /><span ref={cardStageRef} /></div>
              <dl>
                <dt>Radius</dt><dd>{fp.steam ? `${fmt(fp.R_orig, 3)} → ${fmt(fp.R, 3)} R⊕ (+${pct(fp).toFixed(1)} %)` : `${fmt(fp.R_orig, 3)} R⊕ (rocky)`}</dd>
                <dt>Mass · flux</dt><dd>{fmt(fp.M, 2)} M⊕ · {Math.round(fp.S_abs)} W m⁻² ({(fp.S_abs / S_EARTH_ABS).toFixed(2)} S⊕)</dd>
                <dt>Orbit · host</dt><dd>{fmt(fp.P, 1)} d · {hostLabel(fp)}</dd>
              </dl>
              <div className="pc-actions">
                {mode === 'explore' ? (
                  <>
                    {fpHot && <button className="btn" onClick={() => { S.current.replayAt = performance.now() / 1000; }}>Replay transition</button>}
                    <button className="btn" onClick={() => { setMode('cinematic'); S.current.clock.playing = true; setPlaying(true); }}>Resume film</button>
                  </>
                ) : (
                  <button className="btn" onClick={() => { select(focus, false); setMode('explore'); }}>Explore this planet</button>
                )}
              </div>
            </>
          )}
        </div>
        <div className="plot-panel">
          <div className="plot-head">
            <div className="narration" aria-live="polite">
              <div className="kicker">{narr.kicker}</div>
              <p key={narr.key}>{narr.text}</p>
            </div>
            <div className="sample-tag">
              {m.sample.meta.short} · N = {m.planets.length}<br />
              wrr {(m.params.wrr * 100).toFixed(m.params.wrr < 0.001 ? 2 : 1)} % · f_rgh {m.params.f_rgh.toFixed(2)}
            </div>
          </div>
          <div className="plot-wrap" ref={plotWrapRef}>
            <canvas className="plot-canvas" ref={plotRef} onPointerMove={onPlotMove} onPointerLeave={onPlotLeave} onPointerUp={onPlotClick}
              role="img" aria-label={`Planet radius versus absorbed stellar flux for ${m.planets.length} simulated planets; flux axis reversed, hot planets on the left.`} />
            <div className="tooltip" ref={tipRef} role="tooltip">
              {tipP && (
                <>
                  <div className="tt-head"><span className="lg-dot" style={{ background: tipP.S_abs > m.params.S_thresh ? COLORS.hot : COLORS.cold }} />{planetName(tipP)}</div>
                  <dl>
                    <dt>Radius (plotted)</dt><dd>{fmt(tipP.R_obs, 3)} R⊕</dd>
                    <dt>Rocky radius</dt><dd>{fmt(tipP.R_orig, 3)} R⊕</dd>
                    <dt>Mass</dt><dd>{fmt(tipP.M, 2)} M⊕</dd>
                    <dt>S_abs</dt><dd>{Math.round(tipP.S_abs)} W m⁻²</dd>
                    <dt>Host</dt><dd>{Math.round(tipP.T_eff_st)} K</dd>
                  </dl>
                  <div className="tt-foot">
                    {tipP.S_abs > m.params.S_thresh ? (tipP.steam ? `steam envelope · +${pct(tipP).toFixed(1)} % radius` : 'hot side · no steam envelope') : 'cold side · water condensed'}
                    {' · click to view'}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="strip">
            <div className="tally" ref={tallyRef} aria-label="Planets currently shown">
              <div><span className="k">observed</span><span className="v" ref={tNRef}>0</span></div>
              <div><span className="k"><i className="lg-dot" style={{ background: COLORS.hot }} />hot</span><span className="v" ref={tHRef}>0</span></div>
              <div><span className="k">with steam</span><span className="v" ref={tSRef}>0</span></div>
              <div><span className="k"><i className="lg-dot" style={{ background: COLORS.cold }} />cold</span><span className="v" ref={tCRef}>0</span></div>
            </div>
            <div className="evidence" ref={evRef} style={{ opacity: 0 }}>
              <div className="ev-left">
                <div className="ev-title">
                  <span>Bayesian model comparison</span>
                  <span className="badge" title="Illustrative toy model computed live from the planets shown: H0 = one Gaussian mean radius; H1 = separate means on each side of S_thresh (uniform priors 0.5–3 R⊕, log-uniform scatter). Not the thesis dynesty inference.">toy model</span>
                </div>
                <div className="ev-row">
                  <div className="ev-value" ref={evValRef}>—</div>
                  <div>
                    <div className="ev-eq">ln K = ln ( Z<sub>H1</sub> / Z<sub>H0</sub> )</div>
                    <div className="ev-verdict"><span className="ev-pip" ref={evPipRef} /><span ref={evVerdictRef} /></div>
                    <div className="ev-n" ref={evNRef} />
                  </div>
                </div>
              </div>
              <div className="ev-right">
                <canvas ref={sparkRef} aria-hidden="true" />
                <div className="ev-foot"><span>ln K as the survey grows</span><span>log N →</span></div>
              </div>
            </div>
          </div>
          <div className="legend" aria-label="Legend">
            <span><i className="lg-dot" style={{ background: COLORS.hot }} />hot · steam</span>
            <span><i className="lg-ring" />hot · no steam</span>
            <span><i className="lg-dot" style={{ background: COLORS.cold }} />cold</span>
            <span><i className="lg-dash" />H0</span>
            <span><i className="lg-line" style={{ borderColor: COLORS.draw, borderTopWidth: 1 }} />H1 draws</span>
            <span><i className="lg-line" style={{ borderColor: COLORS.best, borderTopWidth: 3 }} />best fit</span>
          </div>
        </div>
      </div>

      <div className="controls">
        <button className="btn icon primary" onClick={togglePlay} aria-label={playing && mode === 'cinematic' ? 'Pause' : 'Play'}>
          {playing && mode === 'cinematic'
            ? <svg viewBox="0 0 16 16"><rect x="3" y="2" width="3.4" height="12" rx="1" fill="currentColor" /><rect x="9.6" y="2" width="3.4" height="12" rx="1" fill="currentColor" /></svg>
            : <svg viewBox="0 0 16 16"><path d="M4 2.5v11l9.5-5.5z" fill="currentColor" /></svg>}
        </button>
        <button className="btn icon" onClick={replay} aria-label="Replay from the start">
          <svg viewBox="0 0 16 16"><path d="M3 8a5 5 0 1 0 1.6-3.7M3 2.5v2.8h2.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div className="timeline">
          <div className="track" ref={trackRef} role="slider" aria-label="Timeline" aria-valuemin={0} aria-valuemax={100} tabIndex={0}
            onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); scrub(e.clientX); }}
            onPointerMove={(e) => { if (e.buttons) scrub(e.clientX); }}
            onKeyDown={(e) => {
              const st = S.current;
              if (e.key === 'ArrowRight') st.clock.seek(st.clock.t + 2);
              if (e.key === 'ArrowLeft') st.clock.seek(st.clock.t - 2);
            }}>
            <div className="rail" />
            {sb.phases.slice(1, -1).map((p) => <div key={p.key} className="tick" style={{ left: `${(100 * p.start) / sb.duration}%` }} />)}
            <div className="fill" ref={fillRef} />
            <div className="knob" ref={knobRef} />
          </div>
          <div className="phases">
            {sb.phases.filter((p) => p.key !== 'outro' && p.key !== 'threshold').map((p) => (
              <span key={p.key} className={p.key === phase && mode === 'cinematic' ? 'on' : ''} style={{ left: `${(50 * (p.start + p.end)) / sb.duration}%` }}>{p.label}</span>
            ))}
          </div>
        </div>
        <label className="speed">
          <span className="sr-only">Playback speed</span>
          <select value={speed} onChange={(e) => changeSpeed(Number(e.target.value))} aria-label="Playback speed">
            {[0.5, 0.75, 1, 1.5, 2].map((v) => <option key={v} value={v}>{v}×</option>)}
          </select>
        </label>
        <div className="seg" role="group" aria-label="Mode">
          <button aria-pressed={mode === 'cinematic'} onClick={() => setMode('cinematic')}>Cinematic</button>
          <button aria-pressed={mode === 'explore'} onClick={() => setMode('explore')}>Explore</button>
        </div>
        <button className="btn" onClick={() => setScienceOpen((o) => !o)} aria-expanded={scienceOpen} aria-controls="science-panel">
          Science controls
          <svg viewBox="0 0 16 16" style={{ transform: scienceOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s' }}><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      </div>
      <SciencePanel open={scienceOpen} data={data} model={model} params={params} setParams={setParams} />
    </section>
  );
}
