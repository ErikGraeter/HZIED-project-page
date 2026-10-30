// Close-up of one catalogue star with three illustrative planets (stellar view).
//
// The system has its own scene in system units (one unit = StellarSystem.unitAU),
// drawn after the star map with a camera that is the map camera re-expressed
// around the star: same orientation, position (map camera − star) / unit.  So
// the planets sit exactly at the star's catalogue position, and every other star
// stays at its real position in the background.
//
// Orbits are to scale with each other (from the star's luminosity); the star and
// the planets are enlarged so that they can be seen, and the steam envelope is
// drawn thicker as on the home page.  Planet surfaces, clouds and atmospheres
// reuse the home-page planet shaders.

import * as THREE from 'three';
import { makeAtmosphereMaterial, makeCloudMaterial, makeSurfaceMaterial } from '../three/materials';
import { planetLook, starColor, type PlanetLook, type RGB } from '../three/planetLook';
import { SIMPLEX, SPHERE_VERT, TONEMAP } from '../three/glsl';
import { AU_PC, type StellarSystem, type SysKind } from './system';

/** Planet display radius per R⊕ (system units). */
const K_PLANET = 0.32;
/** Displayed thickening of the steam envelope (the home page uses ×3; here the planets are small on screen). */
export const ENVELOPE_SCALE = 7;
/** Displayed period of the innermost planet (s); the others follow Kepler's third law. */
const P_INNER_S = 12;
const R_SUN_AU = 0.00465047;

export const KIND_COLORS: Record<SysKind, string> = { steam: '#ffa06a', hot: '#e86a30', cold: '#79c8f2' };

const lin = (c: RGB): RGB => c.map((v) => Math.pow(v, 2.2)) as RGB;
const smooth = (x: number, a: number, b: number) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };

const STAR_FRAG = /* glsl */ `
precision highp float;
${SIMPLEX}
${TONEMAP}
uniform vec3 uColor;
uniform float uTime;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
void main(){
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  float mu = max(dot(N, V), 0.0);
  float limb = 0.2 + 0.8 * pow(mu, 0.6);
  vec3 q = vObj * 9.0 + vec3(uTime * 0.04, 0.0, uTime * 0.03);
  float gran = 0.84 + 0.16 * snoise(q * 2.4) + 0.08 * snoise(vObj * 3.0 - vec3(uTime * 0.015));
  gl_FragColor = vec4(toneMap(uColor * limb * gran * 0.95), 1.0);
}`;

const GLOW_VERT = /* glsl */ `
varying vec2 vP;
void main(){ vP = position.xy * 2.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uExt, uOpacity;
varying vec2 vP;
void main(){
  float x = length(vP) * uExt;            // distance from the centre in stellar radii
  if (x > uExt) discard;
  float y = max(x - 1.0, 0.0);
  float a = 0.45 * exp(-y * 2.6) + 0.14 * exp(-y * 0.5);
  a *= 1.0 - smoothstep(uExt * 0.55, uExt, x);
  gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.25 * exp(-y * 3.0)), a * uOpacity);
}`;

const CORE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
void main(){
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.35 * exp(-r2 * 30.0)), (exp(-r2 * 9.0) + 0.22 * exp(-r2 * 2.6)) * uOpacity);
}`;

const ZONE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uR0, uR1, uOpacity;
varying vec3 vPos;
void main(){
  float r = length(vPos.xy);
  float a = (0.03 + 0.07 * smoothstep(uR0 + 0.45 * (uR1 - uR0), uR1, r)) * smoothstep(uR0, uR0 * 1.6, r);
  gl_FragColor = vec4(uColor, a * uOpacity);
}`;

interface Rig {
  kind: SysKind;
  group: THREE.Group;
  spin: THREE.Group;
  surface: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  clouds: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  atmo: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  orbit: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  look: PlanetLook;
  r: number;           // orbit radius (system units)
  period: number;      // displayed period (s)
  phase0: number;
}

export class SystemView {
  private scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.01, 1e5);
  private sys: StellarSystem | null = null;
  private rigs: Rig[] = [];
  private star: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private glow: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private core: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private zone: THREE.Mesh<THREE.RingGeometry, THREE.ShaderMaterial> | null = null;
  private threshRing: THREE.LineLoop<THREE.BufferGeometry, THREE.LineDashedMaterial> | null = null;
  private starR = 1;
  private labels: { el: HTMLElement; pos: () => THREE.Vector3 }[] = [];
  private geo = {
    surface: new THREE.SphereGeometry(1, 128, 96),
    clouds: new THREE.SphereGeometry(1, 96, 64),
    atmo: new THREE.SphereGeometry(1, 72, 48),
  };
  /** Star position in the map scene (pc). */
  readonly center = new THREE.Vector3();

  constructor(private labelLayer: HTMLElement) {
    this.star = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.ShaderMaterial({
      vertexShader: SPHERE_VERT, fragmentShader: STAR_FRAG,
      uniforms: { uColor: { value: new THREE.Vector3(1, 1, 1) }, uTime: { value: 0 } },
    }));
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
      uniforms: { uColor: { value: new THREE.Vector3(1, 1, 1) }, uExt: { value: 10 }, uOpacity: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    this.core = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: 'uniform float uPx; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = uPx; }',
      fragmentShader: CORE_FRAG,
      uniforms: { uColor: { value: new THREE.Vector3(1, 1, 1) }, uPx: { value: 9 }, uOpacity: { value: 0 } },
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    }));
    this.core.frustumCulled = false;
    this.core.renderOrder = 10;
    this.glow.renderOrder = 5;
    this.scene.add(this.star, this.glow, this.core);
  }

  get system() { return this.sys; }

  setSystem(sys: StellarSystem | null, centre?: THREE.Vector3) {
    this.clear();
    this.sys = sys;
    if (!sys || !centre) return;
    this.center.copy(centre);
    const unit = sys.unitAU;
    // star: enlarged ×8, but never smaller than 0.75 units
    this.starR = Math.min(1.8, Math.max(0.75, (8 * sys.radius * R_SUN_AU) / unit));
    this.star.scale.setScalar(this.starR);
    this.glow.scale.setScalar(this.starR * 20);
    const c = starColor(sys.teff);
    this.star.material.uniforms.uColor.value.set(...lin(c));
    this.glow.material.uniforms.uColor.value.set(...c);
    this.core.material.uniforms.uColor.value.set(...c);
    this.addLabel('star', () => new THREE.Vector3(0, this.starR * 1.25, 0),
      `PIC ${sys.pic}`, `${sys.spt} · ${Math.round(sys.teff)} K · ${sys.lum < 0.1 ? sys.lum.toFixed(3) : sys.lum.toFixed(2)} L☉`);

    // runaway threshold: the inner edge of the habitable zone, with the hot zone inside it shaded
    const rT = sys.aThresh / unit;
    const zone = new THREE.Mesh(new THREE.RingGeometry(this.starR * 1.2, rT, 192, 1), new THREE.ShaderMaterial({
      vertexShader: 'varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: ZONE_FRAG,
      uniforms: { uColor: { value: new THREE.Color(KIND_COLORS.hot) }, uR0: { value: this.starR * 1.2 }, uR1: { value: rT }, uOpacity: { value: 1 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    }));
    zone.rotation.x = -Math.PI / 2;
    zone.renderOrder = 1;
    this.zone = zone;
    const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(circle(rT, 256)),
      new THREE.LineDashedMaterial({ color: 0xf6ecde, transparent: true, opacity: 0.5, dashSize: 0.22, gapSize: 0.16, depthWrite: false }));
    ring.computeLineDistances();
    this.threshRing = ring;
    this.scene.add(zone, ring);
    this.addLabel('thresh', () => new THREE.Vector3(-rT * Math.SQRT1_2, 0, rT * Math.SQRT1_2),
      'Runaway greenhouse threshold', `S_abs = ${sys.S_thresh} W m⁻² · ${fmtAU(sys.aThresh)}`);

    // planets
    const pIn = sys.planets[0].P;
    sys.planets.forEach((p, k) => {
      const group = new THREE.Group();
      const spin = new THREE.Group();
      const surface = new THREE.Mesh(this.geo.surface, makeSurfaceMaterial());
      const clouds = new THREE.Mesh(this.geo.clouds, makeCloudMaterial());
      const atmo = new THREE.Mesh(this.geo.atmo, makeAtmosphereMaterial());
      spin.add(surface, clouds);
      group.add(spin, atmo);
      const r = p.a / unit;
      const orbit = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(circle(r, 256)),
        new THREE.LineBasicMaterial({ color: KIND_COLORS[p.kind], transparent: true, opacity: 0.4, depthWrite: false }));
      this.scene.add(group, orbit);
      const rig: Rig = {
        kind: p.kind, group, spin, surface, clouds, atmo, orbit, look: planetLook(p.look, sys.S_thresh),
        r, period: P_INNER_S * (p.P / pIn), phase0: 0.6 + k * 2.2,
      };
      this.rigs.push(rig);
      const rt = K_PLANET * p.R_orig * (1 + (p.R / p.R_orig - 1) * ENVELOPE_SCALE);
      const radii = p.kind === 'steam' ? `R ${p.R.toFixed(2)} R⊕ (rock ${p.R_orig.toFixed(2)})` : `R ${p.R.toFixed(2)} R⊕`;
      this.addLabel(p.kind, () => group.position.clone().add(new THREE.Vector3(0, rt * 1.35 + 0.08, 0)),
        p.label, `${p.S_abs} W m⁻² · ${radii}`);
    });
  }

  private addLabel(kind: string, pos: () => THREE.Vector3, title: string, sub: string) {
    const el = document.createElement('span');
    el.className = `map-label sys sys-${kind}`;
    const b = document.createElement('b');
    b.textContent = title;
    const s = document.createElement('small');
    s.textContent = sub;
    el.append(b, s);
    el.style.opacity = '0';
    this.labelLayer.appendChild(el);
    this.labels.push({ el, pos });
    return el;
  }

  private clear() {
    this.rigs.forEach((r) => {
      this.scene.remove(r.group, r.orbit);
      r.surface.material.dispose(); r.clouds.material.dispose(); r.atmo.material.dispose();
      r.orbit.geometry.dispose(); r.orbit.material.dispose();
    });
    this.rigs = [];
    for (const o of [this.zone, this.threshRing]) {
      if (!o) continue;
      this.scene.remove(o);
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    this.zone = null;
    this.threshRing = null;
    this.labels.forEach((l) => l.el.remove());
    this.labels = [];
  }

  /**
   * Draw the system on top of the star map.  `mapCamera` is the star-map camera
   * (pc); `time` the animation clock (s).  Returns the camera distance in system units.
   */
  render(renderer: THREE.WebGLRenderer, mapCamera: THREE.PerspectiveCamera, time: number, width: number, height: number, dpr: number): number {
    const sys = this.sys;
    if (!sys) return Infinity;
    const unitPc = sys.unitAU * AU_PC;
    const cam = this.camera;
    cam.position.copy(mapCamera.position).sub(this.center).divideScalar(unitPc);
    cam.quaternion.copy(mapCamera.quaternion);
    const dist = cam.position.length();
    cam.fov = mapCamera.fov;
    cam.aspect = width / height;
    cam.near = Math.max(0.005, dist * 0.002);
    cam.far = dist * 4 + 200;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    // seen from afar the star is a point that takes over from the map's marker,
    // which the map hides within 0.01 pc of the camera
    const dPc = dist * unitPc;
    const core = this.core.material.uniforms;
    core.uOpacity.value = 1 - smooth(dPc, 0.009, 0.012);
    core.uPx.value = 9 * dpr;
    this.core.visible = core.uOpacity.value > 0.002;
    const near = 1 - smooth(Math.log10(dist), Math.log10(140), Math.log10(900));   // orbits, zone, labels

    this.star.material.uniforms.uTime.value = time;
    this.glow.quaternion.copy(cam.quaternion);
    this.rigs.forEach((r) => {
      const ang = r.phase0 + (2 * Math.PI * time) / r.period;
      r.group.position.set(r.r * Math.cos(ang), 0, -r.r * Math.sin(ang));
      r.orbit.material.opacity = 0.4 * near;
    });
    if (this.zone) this.zone.material.uniforms.uOpacity.value = near;
    if (this.threshRing) this.threshRing.material.opacity = 0.5 * near;
    this.updatePlanets(time);

    renderer.clearDepth();
    renderer.render(this.scene, cam);

    // labels
    const v = new THREE.Vector3();
    for (const l of this.labels) {
      v.copy(l.pos()).project(cam);
      const x = (v.x + 1) * 0.5 * width, y = (1 - v.y) * 0.5 * height;
      const off = v.z > 1 || x < -60 || x > width + 60 || y < -30 || y > height + 30;
      l.el.style.opacity = off || near < 0.02 ? '0' : near.toFixed(3);
      l.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
    return dist;
  }

  /** Planet uniforms, as in PlanetView with each planet in its final state (lit by the star). */
  private updatePlanets(time: number) {
    const sys = this.sys!;
    sys.planets.forEach((p, k) => {
      const rig = this.rigs[k];
      const look = rig.look;
      const steamPlanet = rig.kind === 'steam';
      const hot = rig.kind !== 'cold';
      const evap = hot ? 1 : 0, heat = hot ? 1 : 0, inflate = steamPlanet ? 1 : 0;
      const rc = K_PLANET * p.R_orig;
      const rtFull = rc * (1 + (p.R / p.R_orig - 1) * ENVELOPE_SCALE);
      const rt = rc + (rtFull - rc) * inflate;
      const pos = rig.group.position;
      const L = pos.clone().multiplyScalar(-1).normalize();
      const light = lin(look.light);

      rig.spin.scale.setScalar(rc);
      rig.spin.rotation.set(0, 0, look.tilt, 'ZXY');
      // axial rotation, ≈ one turn per 10–15 s
      const spinAngle = look.phase + time * look.spin * 5;
      rig.surface.rotation.set(0, spinAngle, 0);
      rig.clouds.rotation.set(0, spinAngle, 0);
      rig.clouds.scale.setScalar(1.012);
      rig.surface.updateWorldMatrix(true, false);
      const lightObj = L.clone().applyQuaternion(rig.surface.getWorldQuaternion(new THREE.Quaternion()).invert());

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
      su.uTime.value = time;
      su.uLightDir.value.copy(L);
      su.uLightObj.value.copy(lightObj);
      su.uLightColor.value.setRGB(...light);
      const hz = Math.max(evap, heat * 0.5);
      su.uHazeColor.value.setRGB(0.30 + 0.70 * hz, 0.52 + 0.30 * hz, 1.0 - 0.34 * hz);
      su.uHaze.value = 0.32 + 0.3 * hz;
      su.uOpacity.value = 1;

      const cu = rig.clouds.material.uniforms;
      cu.uSeed.value.set(...look.seed);
      cu.uCover.value = steamPlanet ? Math.max(0.03, 0.72 - 0.7 * heat * look.magma) : hot ? look.cloud0 * 0.15 : look.cloud0;
      cu.uCloudTime.value = time * 0.03;
      cu.uSteam.value = Math.max(inflate, evap * 0.5);
      cu.uLightDir.value.copy(L);
      cu.uLightColor.value.setRGB(...light);
      cu.uOpacity.value = 1 - 0.6 * inflate;

      const au = rig.atmo.material.uniforms;
      const Hthin = rc * 0.028;
      const Hs = rc * 0.012 + (rtFull - rc) * 0.12;
      const steamDensity = steamPlanet ? Math.min(1.35, 0.22 * evap * (1 - 0.75 * heat * look.magma) + 1.13 * inflate) : hot ? 0.08 * evap : 0;
      const rOut = Math.max(rc + 7 * Hthin, rt + (steamPlanet ? 11 : 7) * Hs);
      rig.atmo.scale.setScalar(rOut);
      au.uCenter.value.copy(pos);
      au.uRc.value = rc;
      au.uRt.value = Math.max(rt, rc * 1.002);
      au.uRout.value = rOut;
      au.uHs.value = Hs;
      au.uHthin.value = Hthin;
      au.uThin.value = (hot ? 0.85 - 0.45 * heat : 1.0) / rc;
      au.uSteam.value = steamDensity;
      const kS1 = 1 / Math.sqrt(2 * Math.PI * Math.max(rtFull, rc * 1.001) * Hs);
      au.uDmax.value = Math.min(80, Math.max(1.5, 2.6 / (kS1 * Math.max(rtFull - rc, rc * 0.004))));
      au.uHalo.value = steamPlanet ? 0.12 * inflate : 0;
      au.uGlow.value = steamPlanet ? look.magma * heat : 0;
      au.uLayer.value = steamPlanet ? smooth(inflate, 0.35, 1.0) : 0;
      au.uOpacity.value = 1;
      au.uTime.value = time;
      au.uLightDir.value.copy(L);
      au.uLightColor.value.setRGB(...light);
      au.uSeed.value.set(...look.seed);
      au.uSpin.value.setFromMatrix4(new THREE.Matrix4().makeRotationY(-(spinAngle * 0.92)));
      au.uBetaR.value.set(0.9, 2.1, 5.0);
      if (hot && !steamPlanet) au.uBetaR.value.set(2.2, 2.0, 1.9);
    });
  }

  dispose() {
    this.clear();
    Object.values(this.geo).forEach((g) => g.dispose());
    for (const o of [this.star, this.glow, this.core]) { o.geometry.dispose(); o.material.dispose(); }
  }
}

function circle(r: number, n: number) {
  return Array.from({ length: n }, (_, k) => new THREE.Vector3(r * Math.cos((2 * Math.PI * k) / n), 0, -r * Math.sin((2 * Math.PI * k) / n)));
}

export function fmtAU(a: number) {
  return `${a < 0.1 ? a.toFixed(3) : a.toFixed(2)} AU`;
}

