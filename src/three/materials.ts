// Planet shaders.
//
// A planet is three nested layers:
//   surface     procedural rocky terrain, oceans that can evaporate, ice caps,
//               magma glow once the surface heats (rotates with the planet)
//   clouds      thin water-cloud shell just above the surface
//   atmosphere  ray-marched shell: thin Rayleigh atmosphere + steam envelope.
//
// The steam envelope is an exponential atmosphere normalised so that the
// tangential (limb) optical depth equals 1 at the model transit radius uRt —
// the transit radius *is* the level where a grazing ray becomes opaque.  The
// rocky radius uRc and the transit radius uRt are independent uniforms, so the
// envelope can grow while the rocky interior keeps its size.

import * as THREE from 'three';
import { SIMPLEX, TONEMAP, SPHERE_VERT } from './glsl';

const SURFACE_FRAG = /* glsl */ `
precision highp float;
${SIMPLEX}
${TONEMAP}
uniform vec3 uSeed;
uniform float uOcean;      // current ocean fraction
uniform float uOcean0;     // initial ocean fraction (exposed sea floor in between)
uniform vec3 uLand0, uLand1, uLand2, uDeep, uShallow;
uniform float uIce, uHeat, uMagma, uMelt, uTime;
uniform vec3 uLightDir, uLightObj, uLightColor, uHazeColor;
uniform float uHaze, uOpacity;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;

float seaLevel(float f){ return mix(-0.62, 0.40, f); }

// large-scale elevation: domain-warped fBm (continents and basins)
float baseElev(vec3 q){
  vec3 warp = vec3(snoise(q * 0.8 + 3.1), snoise(q * 0.8 + 7.7), snoise(q * 0.8 + 1.3));
  return fbm(q + 0.42 * warp, 4);
}

void main(){
  vec3 q = vObj * 1.3 + uSeed;
  float base = baseElev(q);
  float ridge = 1.0 - abs(snoise(q * 2.7 + 11.0));
  float detail = 0.034 * snoise(q * 16.2 + 5.0) + 0.016 * snoise(q * 33.0 + 9.0);
  float elev = base + detail + 0.16 * ridge * ridge * smoothstep(-0.05, 0.35, base);
  float grain = snoise(q * 6.5 + 4.0);

  // relief: elevation difference toward the star (object space), no derivatives
  vec3 lo = normalize(uLightObj);
  vec3 tl = lo - dot(lo, vObj) * vObj;
  float tlen = length(tl);
  tl = tlen > 1e-4 ? tl / tlen : vec3(0.0);
  float base2 = baseElev(q + tl * 0.028);
  float relief = clamp((base2 - base) * 9.0, -0.6, 0.6);

  float sl  = seaLevel(uOcean);
  float sl0 = seaLevel(uOcean0);
  float aa = fwidth(elev) * 1.2 + 0.0015;
  float ocean = 1.0 - smoothstep(sl - aa, sl + aa, elev);
  float depth = sl - elev;

  // land: lowland → upland → highland
  vec3 land = mix(uLand0, uLand1, smoothstep(sl0 - 0.05, sl0 + 0.32, elev));
  land = mix(land, uLand2, smoothstep(0.30, 0.62, elev));
  land *= 0.93 + 0.10 * grain;
  // exposed sea floor (evaporites) where oceans have retreated
  float seabed = (1.0 - ocean) * (1.0 - smoothstep(sl0 - aa - 0.02, sl0 + 0.02, elev));
  land = mix(land, vec3(0.60, 0.56, 0.50) * (0.92 + 0.1 * grain), seabed * 0.7 * (1.0 - uHeat));

  // ice caps and snowy peaks
  float lat = abs(vObj.y) + 0.07 * snoise(q * 3.5);
  float ice = smoothstep(1.0 - uIce * 0.55, 1.03 - uIce * 0.55, lat);
  ice = max(ice, uIce * smoothstep(0.42, 0.55, elev) * 0.8);
  ice *= (1.0 - uHeat);

  vec3 water = mix(uShallow, uDeep, smoothstep(0.0, 0.22, depth));
  vec3 albedo = mix(land, water, ocean);
  albedo = mix(albedo, vec3(0.86, 0.9, 0.95), ice);

  // heating: baked basaltic crust
  vec3 basalt = vec3(0.075, 0.062, 0.058) + 0.04 * vec3(0.5, 0.25, 0.1) * (grain + 1.0);
  albedo = mix(albedo, basalt, uHeat * 0.9);

  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  vec3 L = normalize(uLightDir);
  float ndl = dot(N, L);
  float terminator = smoothstep(-0.06, 0.2, ndl);
  float landMask = (1.0 - ocean) * (1.0 - ice * 0.7);
  float diff = max(ndl, 0.0) * terminator * (1.0 + relief * landMask);
  vec3 col = albedo * uLightColor * diff * 1.5;
  col += albedo * 0.012;

  // ocean glint
  vec3 H = normalize(L + V);
  float ndh = max(dot(N, H), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  col += ocean * uLightColor * terminator * (pow(ndh, 160.0) * 2.2 + pow(ndh, 26.0) * 0.10) * (0.55 + fres);

  // magma: glowing fissures on the land (mostly visible on the night side)
  float crack = pow(1.0 - abs(snoise(q * 4.6 + 2.0)), 11.0);
  float flicker = 0.85 + 0.15 * snoise(q * 2.0 + vec3(0.0, uTime * 0.25, 0.0));
  // lava colours are linear-light values (≈ sRGB #FF6A1A … #FF9A3C after display gamma)
  col += vec3(1.0, 0.13, 0.015) * crack * 2.6 * flicker * uMagma * (0.25 + 0.75 * (1.0 - terminator));

  // magma ocean: the emptied ocean basins fill with lava as the surface melts
  // (uMelt = molten extent).  Lava is self-luminous, so it shows by day as well.
  if (uMelt > 0.001) {
    float meltLevel = sl0 - 0.08 + uMelt * 0.22;
    float aaM = fwidth(elev) * 1.2 + 0.002;
    float lava = 1.0 - smoothstep(meltLevel - aaM, meltLevel + aaM, elev);
    // drifting crust plates (cooler, dark) with bright seams between them
    vec3 qf = q * 3.0 + vec3(uTime * 0.035, 0.0, uTime * 0.02);
    float flow = fbm(qf + 0.7 * vec3(snoise(q * 1.6 + vec3(uTime * 0.02))), 3);
    float crust = smoothstep(-0.04, 0.16, flow);
    float seam = 1.0 - smoothstep(0.0, 0.05, abs(flow - 0.08));
    float deep = clamp((meltLevel - elev) / 0.22, 0.0, 1.0);
    vec3 hot = mix(vec3(1.0, 0.09, 0.008), vec3(1.0, 0.22, 0.03), deep * (1.0 - crust));
    vec3 lavaCol = mix(hot * 2.6, vec3(0.03, 0.012, 0.008) + hot * 0.1, crust * 0.9)
                 + vec3(1.0, 0.15, 0.02) * seam * crust * 2.4;
    float shore = 1.0 - smoothstep(0.0, 0.035, abs(elev - meltLevel));
    col = mix(col, lavaCol * flicker, lava * clamp(uMelt * 1.6, 0.0, 1.0));
    col += vec3(1.0, 0.13, 0.015) * shore * 1.2 * uMelt;
  }

  // aerial perspective toward the limb
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.6);
  col = mix(col, uHazeColor * uLightColor * clamp(ndl + 0.3, 0.0, 1.0), rim * uHaze);

  gl_FragColor = vec4(toneMap(col), uOpacity);
}
`;

const CLOUD_FRAG = /* glsl */ `
precision highp float;
${SIMPLEX}
${TONEMAP}
uniform vec3 uSeed;
uniform float uCover, uCloudTime, uSteam, uOpacity;
uniform vec3 uLightDir, uLightColor, uSteamTint;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
void main(){
  vec3 p = vObj;
  float ang = uCloudTime * (0.55 + 0.45 * p.y * p.y);
  float ca = cos(ang), sa = sin(ang);
  p = vec3(ca * p.x - sa * p.z, p.y, sa * p.x + ca * p.z);
  vec3 q = vec3(p.x, p.y * 1.35, p.z) * 1.9 + uSeed * 1.37;
  vec2 w = vec2(snoise(q * 1.1 + 5.0), snoise(q * 1.1 + 9.0));
  float n = fbm(q + 0.55 * vec3(w.x, w.y, w.x), 5);
  float th = mix(0.55, -0.75, uCover);
  float dens = smoothstep(th, th + 0.32, n);
  dens *= 0.75 + 0.25 * smoothstep(-0.2, 0.6, snoise(q * 4.0));

  vec3 N = normalize(vNormalW);
  vec3 L = normalize(uLightDir);
  vec3 V = normalize(cameraPosition - vPosW);
  float ndl = dot(N, L);
  float lit = smoothstep(-0.12, 0.35, ndl) * (0.35 + 0.65 * max(ndl, 0.0));
  float fwd = pow(max(dot(-V, L), 0.0), 6.0) * 0.5 * (1.0 - max(dot(N, V), 0.0));
  vec3 base = mix(vec3(0.86), uSteamTint * 0.9, uSteam);
  vec3 col = base * uLightColor * (lit * 1.2 + fwd) + base * 0.01;
  float a = dens * uOpacity;
  gl_FragColor = vec4(toneMap(col) * a, a);
}
`;

const ATMO_FRAG = /* glsl */ `
precision highp float;
${SIMPLEX}
${TONEMAP}
#define STEPS 24
uniform vec3 uCenter;
uniform float uRc, uRt, uRout, uHs, uHthin, uDmax, uLayer, uHalo, uGlow;
uniform float uThin, uSteam, uOpacity, uTime;
uniform vec3 uBetaR, uSteamAlbedo, uLightDir, uLightColor, uSeed;
uniform mat3 uSpin;
varying vec3 vPosW;

vec2 raySphere(vec3 ro, vec3 rd, float r){
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return vec2(1e9, -1e9);
  float s = sqrt(d);
  return vec2(-b - s, -b + s);
}
// Chapman-style grazing-path factor for an exponential atmosphere
float chap(float x, float mu){
  float c0 = sqrt(1.5707963 * x);
  if (mu >= 0.0) return 1.0 / (mu + 1.0 / c0);
  float s = sqrt(max(1.0 - mu * mu, 0.0));
  return 2.0 * c0 * exp(min(x * (1.0 - s), 30.0)) - 1.0 / (-mu + 1.0 / c0);
}
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main(){
  vec3 ro = cameraPosition - uCenter;
  vec3 rd = normalize(vPosW - cameraPosition);
  vec2 tOut = raySphere(ro, rd, uRout);
  if (tOut.y < 0.0) discard;
  float t0 = max(tOut.x, 0.0);
  float t1 = tOut.y;
  vec2 tCore = raySphere(ro, rd, uRc);
  if (tCore.x > 0.0 && tCore.x < 1e8) t1 = min(t1, tCore.x);

  // upper cloud deck: zonal bands + swirls, evaluated where the ray meets the transit level
  vec2 tDeck = raySphere(ro, rd, uRt);
  float tD = tDeck.x < 1e8 ? max(tDeck.x, t0) : -dot(ro, rd);
  vec3 nD = uSpin * normalize(ro + rd * tD);
  vec3 qb = vec3(nD.x * 2.0, nD.y * 3.8, nD.z * 2.0) + uSeed;
  float band = fbm(qb + vec3(0.0, 0.0, uTime * 0.02), 3);
  float swirl = snoise(nD * 3.2 + uSeed * 0.7 + vec3(uTime * 0.015));
  float deck = 0.65 * band + 0.35 * swirl;
  float rtEff = uRt + uHs * 0.7 * deck;

  // a deeper, broken cloud layer seen through the haze
  float rMid = uRc + 0.48 * (uRt - uRc);
  vec2 tMid = raySphere(ro, rd, rMid);
  float tM = tMid.x < 1e8 ? max(tMid.x, t0) : -dot(ro, rd);
  vec3 nM = uSpin * normalize(ro + rd * tM);
  float cloudsMid = smoothstep(-0.05, 0.45, fbm(nM * 2.4 + uSeed * 1.9 + vec3(uTime * 0.012, 0.0, 0.0), 2));
  float wMid = 0.15 * (uRt - uRc) + 0.3 * uHs;

  // steam extinction normalised so that the limb optical depth is 1 at the transit
  // radius; below the deck the density saturates (uDmax), so the envelope is a
  // translucent haze through which the rocky interior can still be glimpsed
  float kS = uSteam / sqrt(6.2831853 * rtEff * uHs);
  vec3 kR = uBetaR * uThin;

  vec3 L = normalize(uLightDir);
  float mu = dot(rd, L);
  float phaseR = 0.0597 * (1.0 + mu * mu);
  float g = 0.6;
  float phaseM = 0.0796 * (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5);
  float phaseS = 0.55 * phaseM + 0.45 * 0.0796;

  float dt = (t1 - t0) / float(STEPS);
  float jit = ign(gl_FragCoord.xy);
  vec3 tau = vec3(0.0);
  vec3 sum = vec3(0.0);
  // brighter, whiter cloud tops; warmer, darker steam in the troughs between bands
  vec3 alb = uSteamAlbedo * mix(vec3(0.80, 0.70, 0.58), vec3(1.0), smoothstep(-0.45, 0.5, deck));
  // over a magma ocean the troughs between cloud bands thin out into windows
  float window = uGlow * smoothstep(-0.12, 0.3, -deck);
  float dCap = uDmax * (1.0 - 0.9 * window);
  vec3 glowSum = vec3(0.0);
  float dGlow = max(0.3 * (uRt - uRc), 1e-4);
  for (int i = 0; i < STEPS; i++) {
    float t = t0 + (float(i) + jit) * dt;
    vec3 x = ro + rd * t;
    float r = length(x);
    vec3 n = x / r;
    float dThin = exp(-(r - uRc) / uHthin);
    float dS = min(exp(-(r - rtEff) / uHs), dCap) + uHalo * exp(-max(r - rtEff, 0.0) / (3.2 * uHs));
    float dL = uLayer * cloudsMid * exp(-pow((r - rMid) / wMid, 2.0)) * 6.0;
    vec3 ext = kR * dThin + vec3(kS * (dS + dL));
    // light: planet shadow + optical depth toward the star
    float muL = dot(n, L);
    float bL = dot(x, L);
    float shadow = 1.0;
    if (bL < 0.0) {
      float dc = sqrt(max(r * r - bL * bL, 0.0));
      shadow = smoothstep(uRc * 0.985, uRc * 1.02, dc);
    }
    float tauSL;
    if (r > rtEff) {
      tauSL = dS * uHs * chap(r / uHs, muL);
    } else {
      vec2 te = raySphere(x, L, rtEff);
      tauSL = uDmax * max(te.y, 0.0) + uHs * 1.5;
    }
    tauSL += dL * wMid * 0.8;
    vec3 tauL = kR * dThin * uHthin * chap(r / uHthin, muL) + vec3(kS * tauSL);
    vec3 Tl = exp(-min(tauL, vec3(40.0))) * shadow;
    vec3 Tv = exp(-tau);
    vec3 scat = kR * dThin * phaseR + alb * (kS * (dS + dL)) * phaseS;
    sum += Tv * Tl * scat * dt;
    // the lowest steam layers glow, lit from below by the magma ocean
    glowSum += Tv * (kS * dS) * exp(-(r - uRc) / dGlow) * dt;
    tau += ext * dt;
  }
  vec3 T = exp(-tau);
  float day = smoothstep(-0.3, 0.45, dot(normalize(ro + rd * tD), L));
  // a little multiply-scattered light inside the haze
  vec3 ms = (1.0 - T) * alb * min(uSteam, 1.0) * 0.13 * day;
  vec3 col = (sum * 9.0 + ms) * uLightColor;
  col += glowSum * uGlow * vec3(1.0, 0.14, 0.02) * (1.3 - 1.05 * day);
  float alpha = clamp(1.0 - (T.r + T.g + T.b) / 3.0, 0.0, 1.0) * uOpacity;
  gl_FragColor = vec4(toneMap(col) * uOpacity, alpha);
}
`;

export function makeSurfaceMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SPHERE_VERT,
    fragmentShader: SURFACE_FRAG,
    transparent: true,
    uniforms: {
      uSeed: { value: new THREE.Vector3() },
      uOcean: { value: 0.5 }, uOcean0: { value: 0.5 },
      uLand0: { value: new THREE.Color() }, uLand1: { value: new THREE.Color() }, uLand2: { value: new THREE.Color() },
      uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() },
      uIce: { value: 0 }, uHeat: { value: 0 }, uMagma: { value: 0 }, uMelt: { value: 0 }, uTime: { value: 0 },
      uLightDir: { value: new THREE.Vector3(-1, 0.4, 0.7).normalize() },
      uLightObj: { value: new THREE.Vector3(-1, 0.4, 0.7).normalize() },
      uLightColor: { value: new THREE.Color(1, 1, 1) },
      uHazeColor: { value: new THREE.Color(0.35, 0.55, 1.0) },
      uHaze: { value: 0.4 }, uOpacity: { value: 1 },
    },
  });
}

export function makeCloudMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SPHERE_VERT,
    fragmentShader: CLOUD_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      uSeed: { value: new THREE.Vector3() },
      uCover: { value: 0.4 }, uCloudTime: { value: 0 }, uSteam: { value: 0 }, uOpacity: { value: 1 },
      uLightDir: { value: new THREE.Vector3(-1, 0.4, 0.7).normalize() },
      uLightColor: { value: new THREE.Color(1, 1, 1) },
      uSteamTint: { value: new THREE.Color(1.0, 0.93, 0.84) },
    },
  });
}

export function makeAtmosphereMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SPHERE_VERT,
    fragmentShader: ATMO_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      uCenter: { value: new THREE.Vector3() },
      uRc: { value: 1 }, uRt: { value: 1 }, uRout: { value: 1.2 }, uHs: { value: 0.02 }, uHthin: { value: 0.02 },
      uDmax: { value: 4 }, uLayer: { value: 0 }, uHalo: { value: 0 }, uGlow: { value: 0 },
      uThin: { value: 1 }, uSteam: { value: 0 }, uOpacity: { value: 1 }, uTime: { value: 0 },
      uBetaR: { value: new THREE.Vector3(2.2, 5.0, 12.0) },
      uSteamAlbedo: { value: new THREE.Vector3(0.96, 0.955, 0.95) },
      uLightDir: { value: new THREE.Vector3(-1, 0.4, 0.7).normalize() },
      uLightColor: { value: new THREE.Color(1, 1, 1) },
      uSeed: { value: new THREE.Vector3() },
      uSpin: { value: new THREE.Matrix3() },
    },
  });
}
