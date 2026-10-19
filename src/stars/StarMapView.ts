// three.js star map of the PLATO P4/P5 samples around the Sun.
//
// Scene units are parsecs.  The scene axes are the heliocentric Galactic
// axes with the Galactic plane horizontal:
//   scene x = X (→ Galactic centre), scene y = Z (→ NGP), scene z = −Y
// (a proper rotation, so handedness and all distances are preserved).
//
// All stars are one THREE.Points draw call.  Sample/class filtering and the
// colour mode are shader uniforms, so changing them costs nothing; each of the
// 8 sample × class groups fades in and out smoothly.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BIT, CLASSES, type SpClass, type StarCatalog } from './catalog';
import { sampleBits, type Selection } from './stats';
import { mulberry32 } from '../model/rng';

export type ColorMode = 'sample' | 'class';

export const SAMPLE_COLORS = { P4: '#ff8a5b', P5: '#86b9ff' } as const;
/** Main-class colours, roughly the blackbody hue of each class. */
export const CLASS_COLORS: Record<SpClass, string> = { M: '#ff6a4a', K: '#ffae63', G: '#ffe6a6', F: '#dfe7ff' };

const FOV = 38;
const RINGS = [50, 100, 250, 500, 1000];
const LABEL_L = 232;                  // Galactic longitude at which the ring labels sit (deg)
const PC_TO_LY = 3.26156;             // light years per parsec
const R_SUN = 8150;                   // Sun–Galactic centre distance (pc; Reid et al. 2019), context layer only
const Z_SUN = 20.8;                   // height of the Sun above the Galactic midplane (pc; Bennett & Bovy 2019)

const rgb = (hex: string) => new THREE.Vector3(
  parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
const toScene = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);
const fromLB = (lDeg: number, bDeg: number, r: number) => {
  const l = lDeg * Math.PI / 180, b = bDeg * Math.PI / 180;
  return toScene(r * Math.cos(b) * Math.cos(l), r * Math.cos(b) * Math.sin(l), r * Math.sin(b));
};
const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

const STAR_VERT = /* glsl */ `
  attribute float aGroup;
  attribute float aSize;
  uniform float uVis[8];
  uniform vec3 uColS[2];
  uniform vec3 uColC[4];
  uniform float uMode;
  uniform float uScale;
  uniform float uSize;
  uniform float uMinPx;
  uniform float uMaxPx;
  varying vec3 vCol;
  varying float vA;
  void main() {
    int g = int(aGroup + 0.5);
    float vis = uVis[g];
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    if (vis < 0.003 || mv.z > -0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; return; }
    gl_Position = projectionMatrix * mv;
    float px = uSize * aSize * uScale / -mv.z;
    gl_PointSize = clamp(px, uMinPx, uMaxPx);
    // stars that would be smaller than the minimum keep their size but dim,
    // so a distant crowd does not turn into a solid sheet
    vA = vis * clamp(px / uMinPx, 0.32, 1.0);
    int s = g / 4;
    vCol = mix(uColS[s], uColC[g - s * 4], uMode);
  }`;

const STAR_FRAG = /* glsl */ `
  uniform float uAlpha;
  varying vec3 vCol;
  varying float vA;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 > 1.0) discard;
    float a = (exp(-r2 * 9.0) + 0.22 * exp(-r2 * 2.6)) * vA * uAlpha;
    gl_FragColor = vec4(mix(vCol, vec3(1.0), 0.25 * exp(-r2 * 30.0)), a);
  }`;

const SPRITE_VERT = /* glsl */ `
  uniform float uPx;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uPx;
  }`;

const SUN_FRAG = /* glsl */ `
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 > 1.0) discard;
    float a = exp(-r2 * 26.0) + 0.35 * exp(-r2 * 5.0) + 0.08 * (1.0 - r2);
    gl_FragColor = vec4(mix(vec3(1.0, 0.86, 0.62), vec3(1.0), exp(-r2 * 40.0)), a);
  }`;

const RING_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    float r = length(gl_PointCoord * 2.0 - 1.0);
    float a = smoothstep(0.62, 0.70, r) * (1.0 - smoothstep(0.80, 0.88, r));
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a * uOpacity);
  }`;

interface Tween { t0: number; dur: number; fromT: THREE.Vector3; toT: THREE.Vector3; fromD: number; toD: number }
interface Intro { t0: number; dur: number; target: THREE.Vector3; dist: number; az: [number, number]; pol: [number, number]; d0: number }

export interface ViewOptions {
  reducedMotion: boolean;
  onHover: (i: number, x: number, y: number) => void;
  onSelect: (i: number) => void;
}

export class StarMapView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 200000);
  private sky = new THREE.Scene();
  private skyCamera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 10);
  private controls: OrbitControls;
  private mat: THREE.ShaderMaterial;
  private stars: THREE.Points;
  private grid = new THREE.Group();
  private sun!: THREE.Points;
  private hoverMark: THREE.Points;
  private selMark: THREE.Points;
  private labels: { el: HTMLElement; pos: THREE.Vector3; grid: boolean }[] = [];
  private pos: Float32Array;           // scene coordinates of every star
  private group: Uint8Array;
  private vis = new Float32Array(8);
  private visTarget = new Float32Array(8);
  private raf = 0;
  private last = 0;
  private tween: Tween | null = null;
  private intro: Intro | null = null;
  private width = 1;
  private height = 1;
  private pointer: { x: number; y: number; dirty: boolean; inside: boolean } = { x: 0, y: 0, dirty: false, inside: false };
  private down: { x: number; y: number } | null = null;
  private hovered = -1;
  private selected = -1;
  private sel: Selection | null = null;
  private ro: ResizeObserver;
  private disposers: (() => void)[] = [];

  constructor(private canvas: HTMLCanvasElement, private labelLayer: HTMLElement, private cat: StarCatalog, private opts: ViewOptions) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = false;

    // ── stars ──
    const n = cat.n;
    this.pos = new Float32Array(3 * n);
    this.group = new Uint8Array(n);
    const size = new Float32Array(n);
    const grp = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = cat.xyz[3 * i], y = cat.xyz[3 * i + 1], z = cat.xyz[3 * i + 2];
      this.pos[3 * i] = x; this.pos[3 * i + 1] = z; this.pos[3 * i + 2] = -y;
      const g = (cat.sample[i] & BIT.P4 ? 0 : 4) + cat.cls[i];
      this.group[i] = g; grp[i] = g;
      // marker size grows weakly with luminosity (L = R² T⁴); visual only
      const L = cat.radius[i] ** 2 * (cat.teff[i] / 5778) ** 4;
      size[i] = Math.min(1.7, Math.max(0.6, Math.pow(L, 0.16)));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aGroup', new THREE.BufferAttribute(grp, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.computeBoundingSphere();
    this.mat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uVis: { value: Array.from(this.vis) },
        uColS: { value: [rgb(SAMPLE_COLORS.P4), rgb(SAMPLE_COLORS.P5)] },
        uColC: { value: CLASSES.map((k) => rgb(CLASS_COLORS[k])) },
        uMode: { value: 0 },
        uScale: { value: 1 },
        uSize: { value: 2.2 },
        uMinPx: { value: 1.6 },
        uMaxPx: { value: 9 },
        uAlpha: { value: 0.9 },
      },
    });
    this.stars = new THREE.Points(geo, this.mat);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    // ── Sun and markers ──
    const one = () => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)); return g; };
    const sun = new THREE.Points(one(), new THREE.ShaderMaterial({
      vertexShader: SPRITE_VERT, fragmentShader: SUN_FRAG, uniforms: { uPx: { value: 30 } },
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    }));
    sun.renderOrder = 2;
    this.scene.add(sun);
    this.sun = sun;
    const mark = (color: string, px: number, opacity: number) => {
      const p = new THREE.Points(one(), new THREE.ShaderMaterial({
        vertexShader: SPRITE_VERT, fragmentShader: RING_FRAG,
        uniforms: { uPx: { value: px }, uColor: { value: rgb(color) }, uOpacity: { value: opacity } },
        transparent: true, depthWrite: false, depthTest: false,
      }));
      p.visible = false; p.renderOrder = 3; p.frustumCulled = false;
      this.scene.add(p);
      return p;
    };
    this.hoverMark = mark('#ffffff', 20, 0.55);
    this.selMark = mark('#ffffff', 26, 0.95);

    this.buildGrid();
    this.buildSky();
    this.buildGalaxy();

    // ── camera and controls ──
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, {
      enableDamping: true, dampingFactor: 0.08, rotateSpeed: 0.55, zoomSpeed: 0.9, panSpeed: 0.7,
      minDistance: 4, maxDistance: 60000, screenSpacePanning: true, zoomToCursor: true,
    });
    const stopAuto = () => { this.intro = null; this.tween = null; };
    this.controls.addEventListener('start', stopAuto);
    this.disposers.push(() => this.controls.removeEventListener('start', stopAuto));

    // ── pointer: hover and click-to-select ──
    const local = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const onMove = (e: PointerEvent) => {
      const p = local(e);
      Object.assign(this.pointer, p, { dirty: true, inside: true });
    };
    const onLeave = () => { this.pointer.inside = false; this.setHover(-1); };
    const onDown = (e: PointerEvent) => { this.down = local(e); };
    const onUp = (e: PointerEvent) => {
      const p = local(e);
      if (this.down && Math.hypot(p.x - this.down.x, p.y - this.down.y) < 5) {
        const i = this.pick(p.x, p.y, e.pointerType === 'touch' ? 18 : 10);
        this.select(i);
        this.opts.onSelect(i);
      }
      this.down = null;
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    this.disposers.push(() => {
      canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp);
    });

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
    this.resize();
  }

  // ── reference geometry ────────────────────────────────────────────────────
  private addLabel(text: string, pos: THREE.Vector3, cls: string, grid = true) {
    const el = document.createElement('span');
    el.className = `map-label ${cls}`;
    el.textContent = text;
    this.labelLayer.appendChild(el);
    this.labels.push({ el, pos, grid });
  }

  private buildGrid() {
    const line = (pts: THREE.Vector3[], color: number, opacity: number, loop = false, dashed = false) => {
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const m = dashed
        ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 14, gapSize: 10, depthWrite: false })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
      const o = loop ? new THREE.LineLoop(g, m) : new THREE.Line(g, m);
      if (dashed) o.computeLineDistances();
      this.grid.add(o);
    };
    for (const r of RINGS) {
      const pts = Array.from({ length: 256 }, (_, k) => fromLB((k / 256) * 360, 0, r));
      line(pts, 0x9fb4d8, r === 1000 ? 0.16 : 0.13, true);
      this.addLabel(`${r} pc · ${(r * PC_TO_LY).toFixed(1)} ly`, fromLB(LABEL_L, 0, r), 'ring');
    }
    for (let l = 0; l < 360; l += 30) {
      line([fromLB(l, 0, l === 0 ? 0 : 50), fromLB(l, 0, 1000)], 0x9fb4d8, l === 0 ? 0.22 : 0.05);
    }
    this.addLabel('Galactic centre  l = 0°', fromLB(0, 0, 1060), 'axis');
    this.addLabel('l = 90°', fromLB(90, 0, 1060), 'axis');
    this.addLabel('l = 180°', fromLB(180, 0, 1060), 'axis');
    this.addLabel('l = 270°', fromLB(270, 0, 1060), 'axis');
    // short pole marker through the Sun
    line([fromLB(0, -90, 80), fromLB(0, 90, 80)], 0x9fb4d8, 0.18);
    this.addLabel('NGP', fromLB(0, 90, 86), 'axis');
    // direction of the sample centroid (LOPS2 field)
    const c = this.cat.meta.sample_centroid;
    line([new THREE.Vector3(), fromLB(c.l, c.b, 1300)], 0xe9edf4, 0.22, false, true);
    this.addLabel(`LOPS2 field direction  l = ${c.l.toFixed(1)}°, b = ${c.b.toFixed(1)}°`, fromLB(c.l, c.b, 1330), 'field');
    this.addLabel('Sun', new THREE.Vector3(), 'sun', false);
    this.scene.add(this.grid);
  }

  private buildSky() {
    // Background at infinity: rotates with the view, never moves with it.
    // Not data — only the catalogue stars sit at real positions.  The faint stars
    // and the glow follow the Galactic plane (b = 0) and brighten towards the
    // Galactic centre, so the Milky Way band appears where it is on the real sky.
    const rnd = mulberry32(2026);
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rnd(), 1e-9))) * Math.cos(2 * Math.PI * rnd());
    const n = 4200, p = new Float32Array(3 * n), s = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let l: number, b: number;
      if (rnd() < 0.42) {                      // isotropic field stars
        l = 2 * Math.PI * rnd(); b = Math.asin(2 * rnd() - 1);
      } else {                                 // disk: thin in b, concentrated towards l = 0
        l = rnd() < 0.55 ? gauss() * 0.75 : 2 * Math.PI * rnd();
        b = gauss() * (0.07 + 0.06 * rnd());
      }
      const v = fromLB(l * 180 / Math.PI, b * 180 / Math.PI, 1);
      p[3 * i] = v.x; p[3 * i + 1] = v.y; p[3 * i + 2] = v.z;
      s[i] = rnd() < 0.04 ? 0.55 + 0.4 * rnd() : 0.1 + 0.26 * rnd();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aB', new THREE.BufferAttribute(s, 1));
    this.sky.add(new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: `attribute float aB; varying float vB; uniform float uDpr;
        void main() { vB = aB; gl_Position = projectionMatrix * modelViewMatrix * vec4(position * 5.0, 1.0); gl_PointSize = (1.0 + 1.6 * aB) * uDpr; }`,
      fragmentShader: `varying float vB; void main() { float r2 = dot(gl_PointCoord * 2.0 - 1.0, gl_PointCoord * 2.0 - 1.0); if (r2 > 1.0) discard;
        gl_FragColor = vec4(vec3(0.86, 0.9, 1.0), vB * 0.55 * exp(-r2 * 3.0)); }`,
      uniforms: { uDpr: { value: 1 } }, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    })));
    // diffuse band with a dark dust lane along the plane in the inner Galaxy
    this.sky.add(new THREE.Mesh(new THREE.SphereGeometry(6, 96, 48), new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          vec3 d = normalize(vDir);
          // scene (x, y, z) = (X, Z, -Y)
          float l = atan(-d.z, d.x);            // −π..π, 0 = Galactic centre
          float b = asin(clamp(d.y, -1.0, 1.0));
          float n = 0.6 * noise(vec2(l * 9.0, b * 26.0)) + 0.4 * noise(vec2(l * 23.0, b * 61.0));
          float width = 0.10 + 0.05 * exp(-l * l / 0.5);
          float band = exp(-b * b / (width * width)) * (0.35 + 0.65 * exp(-l * l / 1.1));
          float bulge = exp(-(l * l + b * b * 2.2) / 0.06);
          float lane = 1.0 - 0.6 * exp(-b * b / 0.0012) * exp(-l * l / 1.6);
          float a = (band * (0.55 + 0.7 * n) + 0.8 * bulge) * lane;
          vec3 col = mix(vec3(0.62, 0.70, 0.95), vec3(1.0, 0.86, 0.66), clamp(bulge * 1.5 + exp(-l * l / 0.4) * 0.3, 0.0, 1.0));
          gl_FragColor = vec4(col, a * 0.1);
        }`,
    })));
  }

  // ── Milky Way context layer ───────────────────────────────────────────────
  // Schematic but placed where it is: Galactic frame, Sun at R☉ = 8.15 kpc from the
  // centre and Z☉ = 20.8 pc above the midplane.  Four trailing logarithmic arms with
  // pitch 12.8° (Vallée 2008), anchored at the Sun's azimuth so that Sagittarius–Carina
  // (≈ 7.0 kpc) and Perseus (≈ 10.0 kpc) bracket the Solar circle, plus the Local arm
  // just outside the Sun (cf. Reid et al. 2019); a bar at 27° with its near end at l > 0.
  // Drawn as haze: stacked noise layers through the disk thickness and soft clumps
  // along the arms.  Orientation only — not data.
  private galaxy = new THREE.Group();
  private galU = { uOpacity: { value: 0 }, uFade: { value: 1 } };
  private galaxyOn = true;
  private galFade = 1;

  private buildGalaxy() {
    const U = this.galU;
    const DENSITY = /* glsl */ `
      const float PI = 3.14159265;
      const float TANP = 0.2272;              // tan 12.8°
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p) { return 0.55 * noise(p) + 0.3 * noise(p * 2.13 + 7.1) + 0.15 * noise(p * 4.7 + 1.3); }
      // in-plane structure at galactocentric (x, y) in kpc; Sun at (−8.15, 0)
      float arms(vec2 q, float R, float phi) {
        float ph = 4.0 * (phi - PI - log(max(R, 0.3) / 10.0) / TANP);
        float a = pow(0.5 + 0.5 * cos(ph), 4.0) * smoothstep(2.4, 4.0, R);
        float d = mod(phi, 2.0 * PI) - PI;   // Local arm, a short segment near the Sun
        float rl = 8.6 * exp(d * 0.2);
        a += 0.75 * exp(-pow((R - rl) / 0.3, 2.0)) * exp(-d * d / 0.12);
        return a;
      }
      float barBulge(vec2 q) {
        float ca = cos(0.47), sa = sin(0.47);
        vec2 b = vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y);
        return 0.55 * exp(-pow(b.x / 3.4, 2.0) - pow(b.y / 0.95, 2.0)) + exp(-dot(q, q) / 1.2);
      }`;
    // stacked haze layers through the disk (heights in kpc relative to the midplane)
    const layers = [-0.48, -0.36, -0.24, -0.12, 0, 0.12, 0.24, 0.36, 0.48];
    const geo = new THREE.PlaneGeometry(40000, 40000, 1, 1);
    layers.forEach((z, k) => {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { ...U, uZ: { value: z }, uSeed: { value: k * 3.7 } },
        vertexShader: 'varying vec2 vXY; void main() { vXY = position.xy / 1000.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: DENSITY + /* glsl */ `
          uniform float uOpacity, uFade, uZ, uSeed;
          varying vec2 vXY;
          void main() {
            float R = length(vXY);
            if (R > 17.0) discard;
            float phi = atan(vXY.y, vXY.x);
            // vertical profiles: arms are thin, the old disk and the bulge thicker
            float wArm = exp(-uZ * uZ / 0.022), wDisk = exp(-abs(uZ) / 0.3), wBul = exp(-uZ * uZ / 0.35);
            float mist = fbm(vXY * 1.6 + uSeed) * fbm(vXY * 4.3 - uSeed);
            float disk = exp(-R / 3.0) * (1.0 - smoothstep(12.5, 17.0, R));
            float a = disk * (0.22 * wDisk + 2.6 * wArm * arms(vXY, R, phi) * (0.3 + 1.4 * mist)) + 0.4 * wBul * barBulge(vXY);
            vec3 col = mix(vec3(0.50, 0.62, 0.95), vec3(1.0, 0.80, 0.55), clamp(barBulge(vXY) + exp(-R / 2.2) * 0.5, 0.0, 1.0));
            gl_FragColor = vec4(col, a * uOpacity * uFade * 0.16);
          }`,
      });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;               // local (x, y) → Galactic (X, Y)
      m.position.set(R_SUN, -Z_SUN + 1000 * z, 0);
      m.renderOrder = -2;
      m.frustumCulled = false;
      this.galaxy.add(m);
    });

    // soft clumps along the arms (star-forming regions, seen as nebulous knots)
    const rnd = mulberry32(1987);
    const armDensity = (x: number, y: number) => {
      const R = Math.hypot(x, y), phi = Math.atan2(y, x);
      const ph = 4 * (phi - Math.PI - Math.log(Math.max(R, 0.3) / 10) / 0.2272);
      let a = Math.pow(0.5 + 0.5 * Math.cos(ph), 6) * (R > 3 ? 1 : 0);
      const d = (((phi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
      a += 0.8 * Math.exp(-(((R - 8.6 * Math.exp(d * 0.2)) / 0.3) ** 2)) * Math.exp(-d * d / 0.12);
      return a * Math.exp(-R / 4.5) * (R < 15 ? 1 : 0);
    };
    // ~4500 clumps of 0.2–0.6 kpc: nebulous texture without a dotted look
    const N = 4500, pos = new Float32Array(3 * N), size = new Float32Array(N), tint = new Float32Array(N);
    let n = 0, guard = 0;
    const peak = armDensity(-3.2, 0.01) + 0.5;
    while (n < N && guard++ < 2e6) {
      const x = (rnd() * 2 - 1) * 15, y = (rnd() * 2 - 1) * 15;
      if (rnd() * peak > armDensity(x, y)) continue;
      const g = Math.sqrt(-2 * Math.log(Math.max(rnd(), 1e-9))) * Math.cos(2 * Math.PI * rnd());
      const v = toScene(R_SUN + 1000 * x, 1000 * y, -Z_SUN + 90 * g);
      pos[3 * n] = v.x; pos[3 * n + 1] = v.y; pos[3 * n + 2] = v.z;
      size[n] = 180 + 420 * rnd() * rnd();
      tint[n] = rnd();
      n++;
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, 3 * n), 3));
    cg.setAttribute('aSize', new THREE.BufferAttribute(size.subarray(0, n), 1));
    cg.setAttribute('aTint', new THREE.BufferAttribute(tint.subarray(0, n), 1));
    const clumps = new THREE.Points(cg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      uniforms: { ...U, uScale: this.mat.uniforms.uScale, uMaxPx: { value: 110 } },
      vertexShader: /* glsl */ `
        attribute float aSize; attribute float aTint;
        uniform float uScale, uMaxPx;
        varying float vA; varying float vT;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float px = aSize * uScale / max(-mv.z, 1.0);
          gl_PointSize = min(px, uMaxPx);
          // keep the light of clamped clumps constant; hide clumps close to the camera
          vA = min(1.0, uMaxPx / max(px, 1.0)) * smoothstep(1500.0, 4500.0, -mv.z);
          vT = aTint;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity, uFade;
        varying float vA; varying float vT;
        void main() {
          float r2 = dot(gl_PointCoord * 2.0 - 1.0, gl_PointCoord * 2.0 - 1.0);
          if (r2 > 1.0) discard;
          vec3 col = mix(vec3(0.55, 0.68, 1.0), vec3(0.95, 0.75, 0.85), step(0.85, vT));
          gl_FragColor = vec4(col, exp(-r2 * 4.5) * (1.0 - r2) * vA * uOpacity * uFade * 0.075);
        }`,
    }));
    clumps.frustumCulled = false;
    clumps.renderOrder = -1;
    this.galaxy.add(clumps);
    this.scene.add(this.galaxy);

    const armAt = (k: number, phi: number) => {   // point on arm k at galactocentric azimuth phi
      const R = (10.0 / Math.pow(1.4289, k)) * Math.exp((phi - Math.PI) * 0.2272);
      return toScene(R_SUN + 1000 * R * Math.cos(phi), 1000 * R * Math.sin(phi), -Z_SUN);
    };
    this.addLabel(`Galactic centre · ${(R_SUN / 1000).toFixed(2)} kpc`, toScene(R_SUN, 0, -Z_SUN), 'gal', false);
    this.addLabel('Perseus arm', armAt(0, Math.PI + 0.55), 'gal', false);
    this.addLabel('Sagittarius–Carina arm', armAt(1, Math.PI - 0.5), 'gal', false);
    this.addLabel('Scutum–Centaurus arm', armAt(2, Math.PI - 0.9), 'gal', false);
    const pl = Math.PI - 0.24, rl = 8600 * Math.exp(-0.24 * 0.2);
    this.addLabel('Local arm', toScene(R_SUN + rl * Math.cos(pl), rl * Math.sin(pl), -Z_SUN), 'gal', false);
  }

  setGalaxy(on: boolean) { this.galaxyOn = on; if (this.opts.reducedMotion) this.galFade = on ? 1 : 0; }

  // ── public API ────────────────────────────────────────────────────────────
  start() {
    const loop = (now: number) => { this.raf = requestAnimationFrame(loop); this.frame(now); };
    this.raf = requestAnimationFrame(loop);
  }

  setSelection(sel: Selection, opts: { frame: boolean; intro?: boolean }) {
    const bits = sampleBits(sel.sample);
    for (let g = 0; g < 8; g++) {
      const sOk = (g < 4 ? BIT.P4 : BIT.P5) & bits;
      this.visTarget[g] = sOk && sel.classes[CLASSES[g % 4]] ? 1 : 0;
    }
    if (this.sel === null) this.vis.set(this.visTarget.map((v) => (opts.intro ? 0 : v)));
    this.sel = sel;
    if (this.selected >= 0 && !this.visTarget[this.group[this.selected]]) { this.select(-1); this.opts.onSelect(-1); }
    if (opts.intro) this.startIntro();
    else if (opts.frame) this.frameVisible(this.opts.reducedMotion ? 0 : 1.6);
  }

  setColorMode(m: ColorMode) { this.mat.uniforms.uMode.value = m === 'class' ? 1 : 0; }
  setGrid(on: boolean) { this.grid.visible = on; }

  select(i: number) {
    this.selected = i;
    this.selMark.visible = i >= 0;
    if (i >= 0) this.placeMark(this.selMark, i);
  }

  /** Centre the view on a star (keeps the viewing direction). */
  focus(i: number) {
    const t = new THREE.Vector3(this.pos[3 * i], this.pos[3 * i + 1], this.pos[3 * i + 2]);
    const d = Math.min(this.camera.position.distanceTo(this.controls.target), Math.max(25, t.length() * 0.35));
    this.startTween(t, d, this.opts.reducedMotion ? 0 : 1.4);
  }

  resetView() { this.frameVisible(this.opts.reducedMotion ? 0 : 1.4, true); }

  /** Fly out to a view from above the Galactic plane that shows the schematic disk, Sun and samples. */
  galaxyView() {
    this.galaxyOn = true;
    const target = new THREE.Vector3(R_SUN * 0.45, 0, 0);
    const sph0 = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    // looking down from the north, Galactic centre "up" on screen (Sun at the bottom)
    const end = new THREE.Spherical(1, 0.42, -Math.PI / 2);
    let dAz = end.theta - sph0.theta;
    dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));
    const dist = 27000;
    if (this.opts.reducedMotion) {
      this.intro = null;
      this.controls.target.copy(target);
      this.camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(dist, end.phi, end.theta)));
      return;
    }
    this.tween = null;
    this.introFrom = this.controls.target.clone();
    this.intro = { t0: performance.now(), dur: 3200, target, dist, az: [sph0.theta, sph0.theta + dAz], pol: [sph0.phi, end.phi], d0: sph0.radius };
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.disposers.forEach((f) => f());
    this.controls.dispose();
    this.labels.forEach((l) => l.el.remove());
    const free = (o: THREE.Object3D) => o.traverse((c) => {
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x?.dispose());
    });
    free(this.scene); free(this.sky);
    this.renderer.dispose();
  }

  // ── framing ───────────────────────────────────────────────────────────────
  /** Bounding sphere (centre, radius) of the visible stars and the Sun. */
  private visibleBounds(): { c: THREE.Vector3; r: number } {
    const step = Math.max(1, Math.floor(this.cat.n / 40000));
    const c = new THREE.Vector3();
    let m = 0;
    for (let i = 0; i < this.cat.n; i += step) {
      if (!this.visTarget[this.group[i]]) continue;
      c.x += this.pos[3 * i]; c.y += this.pos[3 * i + 1]; c.z += this.pos[3 * i + 2]; m++;
    }
    if (!m) return { c: new THREE.Vector3(), r: 300 };
    c.divideScalar(m).multiplyScalar(0.8);           // pull towards the Sun so it stays in view
    const r2: number[] = [];
    for (let i = 0; i < this.cat.n; i += step) {
      if (!this.visTarget[this.group[i]]) continue;
      const dx = this.pos[3 * i] - c.x, dy = this.pos[3 * i + 1] - c.y, dz = this.pos[3 * i + 2] - c.z;
      r2.push(dx * dx + dy * dy + dz * dz);
    }
    r2.sort((a, b) => a - b);
    const r = Math.max(Math.sqrt(r2[Math.floor(0.96 * (r2.length - 1))]), c.length() * 1.05, 20);
    return { c, r };
  }

  /** Width (px) on each side covered by the overlay panels; framing avoids it. */
  sideInset = 0;

  private fitDistance(r: number) {
    const vf = (FOV * Math.PI) / 180;
    const freeAspect = Math.max(0.5, (this.width - 2 * this.sideInset) / this.height);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * freeAspect);
    // portrait screens: the horizontal extent limits, leave a margin for the cone's tip and rim
    return (r / Math.sin(Math.min(vf, hf) / 2)) * (freeAspect < 1 ? 1.5 : 0.98);
  }

  private frameVisible(dur: number, resetDirection = false) {
    const { c, r } = this.visibleBounds();
    if (resetDirection) {
      this.intro = null;
      const dist = this.fitDistance(r);
      const dir = this.preferredDirection();
      if (dur <= 0) { this.controls.target.copy(c); this.camera.position.copy(c).addScaledVector(dir, dist); return; }
      // move along the current orbit to the preferred direction
      const sph0 = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
      const sph1 = new THREE.Spherical().setFromVector3(dir);
      let dAz = sph1.theta - sph0.theta;
      dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));
      this.intro = { t0: performance.now(), dur: dur * 1000, target: c, dist, az: [sph0.theta, sph0.theta + dAz], pol: [sph0.phi, sph1.phi], d0: sph0.radius };
      this.introFrom = this.controls.target.clone();
      return;
    }
    this.startTween(c, this.fitDistance(r), dur);
  }

  private introFrom: THREE.Vector3 | null = null;

  /** Side view of the field: perpendicular to its axis, a little above the Galactic plane. */
  private preferredDirection(): THREE.Vector3 {
    const c = this.cat.meta.sample_centroid;
    const axis = fromLB(c.l, c.b, 1).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(axis, up).normalize();
    return side.multiplyScalar(-1).addScaledVector(up, 0.5).addScaledVector(axis, -0.3).normalize();
  }

  private startTween(toT: THREE.Vector3, toD: number, dur: number) {
    this.intro = null;
    const fromD = this.camera.position.distanceTo(this.controls.target);
    if (dur <= 0) {
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      this.controls.target.copy(toT);
      this.camera.position.copy(toT).addScaledVector(dir, toD);
      this.tween = null;
      return;
    }
    this.tween = { t0: performance.now(), dur: dur * 1000, fromT: this.controls.target.clone(), toT, fromD, toD };
  }

  private startIntro() {
    const { c, r } = this.visibleBounds();
    const dist = this.fitDistance(r);
    const end = new THREE.Spherical().setFromVector3(this.preferredDirection());
    if (this.opts.reducedMotion) {
      this.controls.target.copy(c);
      this.camera.position.copy(c).add(new THREE.Vector3().setFromSpherical(end).multiplyScalar(dist));
      this.vis.set(this.visTarget);
      return;
    }
    // start high above the Galactic plane, far out, and swing down to the side view
    this.intro = { t0: performance.now(), dur: 11000, target: c, dist, az: [end.theta - 2.1, end.theta], pol: [0.32, end.phi], d0: dist * 2.6 };
    this.introFrom = new THREE.Vector3();
    this.controls.target.set(0, 0, 0);
    this.applyIntro(0);
  }

  private applyIntro(u: number) {
    const it = this.intro!;
    const e = easeInOut(u);
    const target = this.introFrom!.clone().lerp(it.target, e);
    const sph = new THREE.Spherical(it.d0 + (it.dist - it.d0) * e, it.pol[0] + (it.pol[1] - it.pol[0]) * e, it.az[0] + (it.az[1] - it.az[0]) * e);
    this.controls.target.copy(target);
    this.camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(sph));
    this.camera.lookAt(target);
  }

  // ── picking ───────────────────────────────────────────────────────────────
  /** Nearest visible star to a canvas pixel, within `radius` px (−1 if none). */
  private pick(px: number, py: number, radius: number): number {
    this.camera.updateMatrixWorld();
    const m = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).elements;
    const W = this.width, H = this.height, P = this.pos, G = this.group, V = this.visTarget;
    let best = -1, bestD = radius * radius, bestW = Infinity;
    for (let i = 0, n = this.cat.n; i < n; i++) {
      if (!V[G[i]]) continue;
      const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (w <= 0.01) continue;
      const sx = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) * 0.5 * W;
      const dx = sx - px;
      if (dx > radius || dx < -radius) continue;
      const sy = (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) * 0.5 * H;
      const d2 = dx * dx + (sy - py) * (sy - py);
      // prefer the nearer star when two are equally close on screen
      if (d2 < bestD - 0.5 || (Math.abs(d2 - bestD) <= 0.5 && w < bestW)) { best = i; bestD = d2; bestW = w; }
    }
    return best;
  }

  private setHover(i: number) {
    if (i === this.hovered) return;
    this.hovered = i;
    this.hoverMark.visible = i >= 0 && i !== this.selected;
    if (i >= 0) this.placeMark(this.hoverMark, i);
    this.canvas.style.cursor = i >= 0 ? 'pointer' : '';
    this.opts.onHover(i, this.pointer.x, this.pointer.y);
  }

  private placeMark(p: THREE.Points, i: number) {
    const a = p.geometry.getAttribute('position') as THREE.BufferAttribute;
    a.setXYZ(0, this.pos[3 * i], this.pos[3 * i + 1], this.pos[3 * i + 2]);
    a.needsUpdate = true;
  }

  // ── frame loop ────────────────────────────────────────────────────────────
  private resize() {
    const el = this.canvas.parentElement ?? this.canvas;
    this.width = Math.max(1, el.clientWidth);
    this.sideInset = this.width > 860 ? Math.min(360, this.width * 0.24) : 0;
    this.height = Math.max(1, el.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.skyCamera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.skyCamera.updateProjectionMatrix();
    // pixels per unit size at unit distance, in drawing-buffer pixels
    this.mat.uniforms.uScale.value = (this.height * dpr) / (2 * Math.tan((FOV * Math.PI) / 360));
    this.mat.uniforms.uMinPx.value = 1.5 * dpr;
    this.mat.uniforms.uMaxPx.value = 9 * dpr;
    const sunMat = this.sun.material as THREE.ShaderMaterial;
    sunMat.uniforms.uPx.value = 30 * dpr;
    (this.hoverMark.material as THREE.ShaderMaterial).uniforms.uPx.value = 20 * dpr;
    (this.selMark.material as THREE.ShaderMaterial).uniforms.uPx.value = 26 * dpr;
    ((this.sky.children[0] as THREE.Points).material as THREE.ShaderMaterial).uniforms.uDpr.value = dpr;
  }

  private frame(now: number) {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;

    if (this.intro) {
      const u = Math.min(1, (now - this.intro.t0) / this.intro.dur);
      this.applyIntro(u);
      if (u >= 1) this.intro = null;
    } else if (this.tween) {
      const tw = this.tween;
      const u = Math.min(1, (now - tw.t0) / tw.dur), e = easeInOut(u);
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      this.controls.target.lerpVectors(tw.fromT, tw.toT, e);
      // interpolate the distance logarithmically (feels uniform across scales)
      const d = Math.exp(Math.log(tw.fromD) + (Math.log(tw.toD) - Math.log(tw.fromD)) * e);
      this.camera.position.copy(this.controls.target).addScaledVector(dir, d);
      if (u >= 1) this.tween = null;
    }
    if (!this.intro) this.controls.update();

    // group fades
    const k = this.opts.reducedMotion ? 1 : 1 - Math.exp(-dt * (this.intro ? 1.6 : 7));
    for (let g = 0; g < 8; g++) this.vis[g] += (this.visTarget[g] - this.vis[g]) * k;
    const u = this.mat.uniforms.uVis.value as number[];
    for (let g = 0; g < 8; g++) u[g] = this.vis[g];

    // hover picking (not while dragging)
    if (this.pointer.dirty && this.pointer.inside && !this.down) {
      this.pointer.dirty = false;
      this.setHover(this.pick(this.pointer.x, this.pointer.y, 9));
    }

    // the schematic disk stays a faint hint at sample scale and fills in when zoomed out
    const camR = this.camera.position.length();
    this.galU.uOpacity.value = 0.45 + 0.55 * THREE.MathUtils.smoothstep(camR, 2500, 20000);
    this.galFade += ((this.galaxyOn ? 1 : 0) - this.galFade) * (this.opts.reducedMotion ? 1 : 1 - Math.exp(-dt * 4));
    this.galU.uFade.value = this.galFade;
    this.galaxy.visible = this.galFade > 0.003;

    this.renderer.clear();
    this.skyCamera.quaternion.copy(this.camera.quaternion);
    this.renderer.render(this.sky, this.skyCamera);
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
  }

  private placeLabels() {
    const v = new THREE.Vector3();
    const dist = this.camera.position.distanceTo(this.controls.target);
    for (const l of this.labels) {
      if (l.grid && !this.grid.visible) { l.el.style.opacity = '0'; continue; }
      v.copy(l.pos).project(this.camera);
      const behind = v.z > 1;
      const x = (v.x + 1) * 0.5 * this.width, y = (1 - v.y) * 0.5 * this.height;
      const off = behind || x < -40 || x > this.width + 40 || y < -20 || y > this.height + 20;
      // ring labels far larger than the current view are clutter
      const r = l.pos.length();
      const gal = l.el.classList.contains('gal');
      if (gal && (!this.galaxyOn || this.camera.position.length() < 9000)) { l.el.style.opacity = '0'; continue; }
      const tooBig = l.el.classList.contains('ring') && r > dist * 2.2;
      const tooSmall = l.el.classList.contains('ring') && r < dist * 0.04;
      l.el.style.opacity = off || tooBig || tooSmall ? '0' : '';
      l.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }
}
