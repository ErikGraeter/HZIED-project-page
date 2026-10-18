// three.js scene controller.  Renders up to four planet "rigs" (a single
// planet, a planet flying into the plot while the next one emerges, or the
// hot/cold pair) from a SceneState.  Positions are given in hero pixel space so
// that a planet can fly exactly onto its data point in the plot.

import * as THREE from 'three';
import { makeAtmosphereMaterial, makeCloudMaterial, makeSurfaceMaterial } from './materials';
import { planetLook, type PlanetLook, type RGB } from './planetLook';
import type { Planet } from '../model/types';
import type { RigState } from '../timeline/storyboard';

const FOV = 30;
const CAM_Z = 12;
const LIGHT_DIR = new THREE.Vector3(-0.78, 0.40, 0.55).normalize();

export interface Layout {
  width: number;
  height: number;
  /** Planet panel rectangle (hero pixels). */
  panel: { x: number; y: number; w: number; h: number };
  /** Plot point of a planet, in hero pixels. */
  pointOf: (planet: number) => { x: number; y: number } | null;
}

export interface RingInfo { cx: number; cy: number; rc: number; rt: number; rtFull: number; planet: number; inflate: number }
export interface PairInfo { cx: number; cy: number; r: number; planet: number; slot: number; opacity: number }
export interface RenderInfo { ring: RingInfo | null; pair: PairInfo[] }

interface Rig {
  group: THREE.Group;
  spin: THREE.Group;
  surface: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  clouds: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  atmo: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  look: PlanetLook | null;
  lookKey: string;
  used: boolean;
}

const lin = (c: RGB): RGB => c.map((v) => Math.pow(v, 2.2)) as RGB;
const smooth01 = (x: number, a: number, b: number) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };


/** Rest position and radius scale of the single-planet view inside the panel. */
export function restAnchor(panel: Layout['panel']) {
  const narrow = panel.w < 620;
  const baseR = Math.min(panel.w * (narrow ? 0.33 : 0.27), panel.h * (narrow ? 0.33 : 0.29));
  const cx = narrow ? panel.x + panel.w * 0.5 : panel.x + Math.min(panel.w * 0.54, panel.w - baseR * 1.2 - 190);
  const cy = panel.y + panel.h * (narrow ? 0.44 : 0.4);
  return { cx, cy, baseR, narrow };
}

export class PlanetView {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  private rigs: Rig[] = [];
  private geo = {
    surface: new THREE.SphereGeometry(1, 192, 128),
    clouds: new THREE.SphereGeometry(1, 128, 96),
    atmo: new THREE.SphereGeometry(1, 96, 64),
  };
  private width = 1;
  private height = 1;
  /** User rotation (drag), applied to every planet. */
  userYaw = 0;
  userPitch = 0;
  envelopeScale = 3;
  /**
   * Largest displayed extent (R⊕, rocky radius × drawn envelope) among the
   * featured planets; it maps to 1.25 × the panel's base radius so that all
   * planets are drawn to the same scale (true relative sizes).
   */
  sizeRef = 1.6;
  /** Upper bound on the device pixel ratio (lowered by the adaptive-quality guard). */
  maxDpr = 1.75;
  private lastDpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.camera.position.set(0, 0, CAM_Z);
    this.camera.lookAt(0, 0, 0);
  }

  resize(w: number, h: number, dpr: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.lastDpr = dpr;
    this.renderer.setPixelRatio(Math.min(dpr, this.maxDpr));
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  /** Reduce render resolution one step (called when frames are slow). */
  degrade(): boolean {
    if (this.maxDpr <= 1) return false;
    this.maxDpr = Math.max(1, this.maxDpr - 0.5);
    this.resize(this.width, this.height, this.lastDpr);
    return true;
  }

  private worldPerPixel(): number {
    return (2 * CAM_Z * Math.tan((FOV * Math.PI) / 360)) / this.height;
  }

  private getRig(i: number): Rig {
    while (this.rigs.length <= i) {
      const group = new THREE.Group();
      const spin = new THREE.Group();
      const surface = new THREE.Mesh(this.geo.surface, makeSurfaceMaterial());
      const clouds = new THREE.Mesh(this.geo.clouds, makeCloudMaterial());
      const atmo = new THREE.Mesh(this.geo.atmo, makeAtmosphereMaterial());
      spin.add(surface, clouds);
      group.add(spin, atmo);
      this.scene.add(group);
      this.rigs.push({ group, spin, surface, clouds, atmo, look: null, lookKey: '', used: false });
    }
    return this.rigs[i];
  }

  /**
   * Render a frame.  `rotClock` is the rotation clock (seconds) — it only
   * advances while the animation plays, so rotation pauses with the timeline.
   */
  render(rigStates: RigState[], planets: Planet[], S_thresh: number, layout: Layout, rotClock: number): RenderInfo {
    const wpp = this.worldPerPixel();
    const { panel } = layout;
    const anchor = restAnchor(panel);
    const baseR = anchor.baseR;
    let ring: RingInfo | null = null;
    const pair: PairInfo[] = [];

    // farthest (smallest on screen) first
    const order = rigStates.map((s, i) => ({ s, i }));
    this.rigs.forEach((r) => { r.used = false; r.group.visible = false; });

    // line-up (slots ≥ 10): one common scale, centred row across the panel
    const lineupRigs = rigStates.filter((r) => r.slot >= 10).sort((a, b) => a.slot - b.slot);
    const lineupX = new Map<number, number>();
    let lineupK = 0;
    if (lineupRigs.length) {
      const Rs = lineupRigs.map((r) => planets[r.planet]?.R_orig ?? 1);
      const g = panel.w * 0.05;
      const sum2R = Rs.reduce((a, b) => a + 2 * b, 0);
      lineupK = Math.min((panel.w * 0.9 - g * (Rs.length - 1)) / sum2R, (panel.h * 0.27) / Math.max(...Rs));
      let x = panel.x + (panel.w - (lineupK * sum2R + g * (Rs.length - 1))) / 2;
      lineupRigs.forEach((r, j) => { lineupX.set(r.slot, x + lineupK * Rs[j]); x += 2 * lineupK * Rs[j] + g; });
    }
    const coreScale = (1.25 * baseR) / this.sizeRef;   // px per R⊕ in the single view
    const pairScale = Math.min(panel.w * 0.19, panel.h * 0.25) / this.sizeRef;

    const placed = order.map(({ s }, slotIdx) => {
      const p = planets[s.planet];
      if (!p) return null;
      const rig = this.getRig(slotIdx);
      rig.used = true;
      const key = `${p.id}:${S_thresh}`;
      if (rig.lookKey !== key) { rig.look = planetLook(p, S_thresh); rig.lookKey = key; }
      const look = rig.look!;

      // rest position
      let cx = anchor.cx;
      let cy = anchor.cy;
      const extent = 1 + (p.R / p.R_orig - 1) * this.envelopeScale;
      // true relative size; a selected planet larger than every featured one is capped
      let rPx = Math.min(coreScale * p.R_orig, (1.4 * baseR) / extent);
      if (s.slot >= 10) {
        cx = lineupX.get(s.slot) ?? cx;
        cy = panel.y + panel.h * 0.42;
        rPx = lineupK * p.R_orig;
      } else if (s.slot >= 0) {
        cx = panel.x + panel.w * (s.slot === 0 ? 0.29 : 0.71);
        cy = panel.y + panel.h * (s.slot === 0 ? 0.40 : 0.44);
        rPx = Math.min(pairScale * p.R_orig, (panel.h * 0.3) / extent);
      }
      // emerge from depth
      const em = s.emerge;
      rPx *= 0.22 + 0.78 * em;
      let opacity = Math.min(1, em * 1.4);
      // recede
      if (s.recede > 0) {
        rPx *= 1 - 0.55 * s.recede;
        cy -= s.recede * 30;
        opacity *= 1 - s.recede;
      }
      // fly into the plot point
      if (s.fly > 0) {
        const target = layout.pointOf(s.planet);
        if (target) {
          const f = s.fly;
          const arc = Math.sin(Math.PI * f) * Math.min(120, Math.abs(target.x - cx) * 0.18);
          cx = cx + (target.x - cx) * f;
          cy = cy + (target.y - cy) * f - arc;
          const rEnd = 4.5;
          rPx = Math.exp(Math.log(rPx) + (Math.log(rEnd) - Math.log(rPx)) * Math.pow(f, 0.8));
          opacity *= 1 - Math.pow(Math.max(0, (f - 0.8) / 0.2), 1.5);
        }
      }
      return { s, p, rig, look, cx, cy, rPx, opacity };
    });

    placed.forEach((q, rank) => {
      if (!q) return;
      const { s, p, rig, look, cx, cy, rPx, opacity } = q;
      if (opacity <= 0.002 || rPx < 0.5) return;
      rig.group.visible = true;
      const rc = rPx * wpp;
      const fullInfl = p.R / p.R_orig - 1;
      const inflScale = 1 + fullInfl * this.envelopeScale;
      const rtFull = rc * inflScale;
      const rt = rc + (rtFull - rc) * s.inflate;
      const wx = (cx - this.width / 2) * wpp;
      const wy = -(cy - this.height / 2) * wpp;
      rig.group.position.set(wx, wy, 0);

      // rotation: axial tilt + spin (rotation clock) + user drag
      rig.spin.scale.setScalar(rc);
      rig.spin.rotation.set(this.userPitch, 0, look.tilt, 'ZXY');
      const spinAngle = look.phase + rotClock * look.spin + this.userYaw;
      rig.surface.rotation.set(0, spinAngle, 0);
      rig.clouds.rotation.set(0, spinAngle, 0);
      rig.clouds.scale.setScalar(1.012);
      rig.surface.updateWorldMatrix(true, false);
      const qInv = rig.surface.getWorldQuaternion(new THREE.Quaternion()).invert();
      const lightObj = LIGHT_DIR.clone().applyQuaternion(qInv);

      const steamPlanet = p.steam;
      const hot = p.S_abs > S_thresh;
      const evap = s.evaporate;
      const heat = s.heat;
      const light = lin(look.light);

      // surface
      const su = rig.surface.material.uniforms;
      su.uSeed.value.set(...look.seed);
      su.uOcean0.value = look.ocean0;
      su.uOcean.value = look.ocean0 * (1 - evap);
      su.uLand0.value.setRGB(...look.land[0]);
      su.uLand1.value.setRGB(...look.land[1]);
      su.uLand2.value.setRGB(...look.land[2]);
      su.uDeep.value.setRGB(...look.deep);
      su.uShallow.value.setRGB(...look.shallow);
      su.uIce.value = look.ice * (1 - evap);
      su.uHeat.value = heat * (steamPlanet ? 0.9 : 0.55);
      su.uMagma.value = steamPlanet ? heat * (0.4 + 0.6 * look.magma) : hot ? heat * 0.14 : 0;
      su.uMelt.value = steamPlanet ? heat * look.magma : 0;
      su.uTime.value = rotClock;
      su.uLightDir.value.copy(LIGHT_DIR);
      su.uLightObj.value.copy(lightObj);
      su.uLightColor.value.setRGB(...light);
      const hazeCold: RGB = [0.30, 0.52, 1.0];
      const hazeHot: RGB = [1.0, 0.82, 0.66];
      const hz = Math.max(evap, heat * 0.5);
      su.uHazeColor.value.setRGB(...(hazeCold.map((v, k) => v + (hazeHot[k] - v) * hz) as RGB));
      su.uHaze.value = 0.32 + 0.3 * hz;
      su.uOpacity.value = opacity;

      // clouds
      const cu = rig.clouds.material.uniforms;
      cu.uSeed.value.set(...look.seed);
      const cover = steamPlanet ? Math.max(0.03, look.cloud0 + (0.72 - look.cloud0) * evap - 0.7 * heat * look.magma)
        : hot ? look.cloud0 * (1 - 0.85 * heat) : look.cloud0;
      cu.uCover.value = cover;
      cu.uCloudTime.value = rotClock * 0.012;
      cu.uSteam.value = Math.max(s.inflate, evap * 0.5);
      cu.uLightDir.value.copy(LIGHT_DIR);
      cu.uLightColor.value.setRGB(...light);
      cu.uOpacity.value = opacity * (1 - 0.6 * s.inflate);

      // atmosphere: thin Rayleigh layer + steam envelope
      const au = rig.atmo.material.uniforms;
      const Hthin = rc * 0.028;
      const Hs = rc * 0.012 + (rtFull - rc) * 0.12;
      const steamDensity = steamPlanet ? Math.min(1.35, 0.22 * evap * (1 - 0.75 * heat * look.magma) + 1.13 * s.inflate) : hot ? 0.08 * evap : 0;
      const rOut = Math.max(rc + 7 * Hthin, rt + (steamPlanet ? 11 : 7) * Hs);
      rig.atmo.scale.setScalar(rOut);
      au.uCenter.value.set(wx, wy, 0);
      au.uRc.value = rc;
      au.uRt.value = Math.max(rt, rc * 1.002);
      au.uRout.value = rOut;
      au.uHs.value = Hs;
      au.uHthin.value = Hthin;
      au.uThin.value = (hot ? 0.85 - 0.45 * heat : 1.0) / rc;
      au.uSteam.value = steamDensity;
      // interior haze density: same radial optical depth (≈2.4) for every planet, so a
      // thin envelope on a massive planet hides the surface as well as a thick one
      const kS1 = 1 / Math.sqrt(2 * Math.PI * Math.max(rtFull, rc * 1.001) * Hs);
      au.uDmax.value = Math.min(80, Math.max(1.5, 2.6 / (kS1 * Math.max(rtFull - rc, rc * 0.004))));
      // soft outer halo of the extended steam atmosphere (grows with the envelope)
      au.uHalo.value = steamPlanet ? 0.07 * s.inflate : 0;
      au.uGlow.value = steamPlanet ? look.magma * heat : 0;
      au.uLayer.value = steamPlanet ? smooth01(s.inflate, 0.35, 1.0) : 0;
      au.uOpacity.value = opacity;
      au.uTime.value = rotClock;
      au.uLightDir.value.copy(LIGHT_DIR);
      au.uLightColor.value.setRGB(...light);
      au.uSeed.value.set(...look.seed);
      const m4 = new THREE.Matrix4().makeRotationY(-(spinAngle * 0.92));
      au.uSpin.value.setFromMatrix4(m4);
      au.uBetaR.value.set(0.9, 2.1, 5.0);
      if (hot && !steamPlanet) au.uBetaR.value.set(2.2, 2.0, 1.9);

      // draw order: smaller (farther) rigs first
      const base = Math.round(rPx) * 10 + rank;
      rig.surface.renderOrder = base * 3;
      rig.clouds.renderOrder = base * 3 + 1;
      rig.atmo.renderOrder = base * 3 + 2;

      if (s.slot >= 0) pair.push({ cx, cy, r: rtFull / wpp, planet: s.planet, slot: s.slot, opacity: opacity * (1 - s.fly) });
      if (s.focus && s.slot < 0 && s.fly < 0.05 && s.emerge > 0.98) {
        const k = 1 / wpp;
        ring = { cx, cy, rc: rc * k, rt: rt * k, rtFull: rtFull * k, planet: s.planet, inflate: s.inflate };
      }
    });

    this.renderer.render(this.scene, this.camera);
    return { ring, pair };
  }

  dispose(): void {
    this.rigs.forEach((r) => {
      r.surface.material.dispose(); r.clouds.material.dispose(); r.atmo.material.dispose();
    });
    Object.values(this.geo).forEach((g) => g.dispose());
    this.renderer.dispose();
  }
}
