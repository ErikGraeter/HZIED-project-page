// Page-wide background starfield (2D canvas): deterministic positions, gentle
// twinkle, slight parallax on scroll, and a few small, faint background
// galaxies (procedural, purely decorative).  Static when reduced motion is
// requested.

import { useEffect, useRef } from 'react';
import { mulberry32 } from '../model/rng';

interface Galaxy { x: number; y: number; rot: number; incl: number; depth: number; a: number; sprite: HTMLCanvasElement }

/**
 * Face-on sprite of a small galaxy, rendered per pixel: a de Vaucouleurs bulge
 * (warm, old stars) on an exponential disk (bluer, young stars).  Spirals get
 * two clumpy logarithmic arms with a dust lane on their inner edge and a few
 * pinkish star-forming knots; ellipticals are a smooth Sérsic profile.
 */
function galaxySprite(rnd: () => number, R: number, spiral: boolean, dpr: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const S = Math.ceil(2 * R * dpr);
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  const px = img.data;
  const rd = 0.24, re = spiral ? 0.07 : 0.2;            // disk scale length, bulge radius (units of R)
  const pitch = (12 + 10 * rnd()) * Math.PI / 180;       // arm pitch angle
  const k = 1 / Math.tan(pitch);
  const phase0 = rnd() * Math.PI * 2;
  const seed = Math.floor(rnd() * 1e6);
  const hash = (x: number, y: number) => {
    let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  // smooth value noise for clumpy arms
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c2 = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * sx + (c2 - a) * sy + (a - b - c2 + d) * sx * sy;
  };
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const x = ((i + 0.5) / S) * 2 - 1, y = ((j + 0.5) / S) * 2 - 1;
      const r = Math.hypot(x, y);
      if (r >= 1) continue;
      const edge = 1 - Math.pow(r, 6);
      const bulge = Math.exp(-7.67 * (Math.pow(Math.max(r, 1e-4) / re, 0.25) - 1));
      // soft saturation keeps the bright centre from clipping into a hard edge
      let warm = spiral ? Math.min(6, bulge) * 0.09 : 1.1 * (1 - Math.exp(-0.25 * bulge));
      let blue = 0, pink = 0;
      if (spiral) {
        const disk = Math.exp(-r / rd);
        const th = Math.atan2(y, x);
        const ph = 2 * (th - k * Math.log(Math.max(r, 0.02))) + phase0;
        const arm = Math.pow(0.5 + 0.5 * Math.cos(ph), 3);
        const dust = Math.pow(0.5 + 0.5 * Math.cos(ph - 0.9), 6) * Math.min(1, r / 0.12) * (1 - r);
        const clump = 0.55 + 0.9 * noise(x * 14, y * 14);
        blue = disk * (0.25 + 1.6 * arm * clump) * (1 - 0.65 * dust);
        warm += disk * 0.35 * (1 - 0.65 * dust);
        if (arm > 0.55 && r > 0.18 && hash(i, j) > 0.985) pink = 0.9 * disk / 0.6;
      } else {
        warm += 0.25 * Math.exp(-r / 0.32);
      }
      const R_ = 255 * (warm * 1.0 + blue * 0.72 + pink * 1.0);
      const G_ = 255 * (warm * 0.86 + blue * 0.8 + pink * 0.62);
      const B_ = 255 * (warm * 0.66 + blue * 1.0 + pink * 0.78);
      const lum = Math.max(R_, G_, B_);
      const a = Math.min(1, lum / 255) * edge;
      const o = 4 * (j * S + i);
      const sc = lum > 0 ? 255 / Math.max(lum, 255) : 0;
      px[o] = Math.min(255, R_ * sc * (255 / Math.max(lum * sc, 1)));
      px[o + 1] = Math.min(255, G_ * sc * (255 / Math.max(lum * sc, 1)));
      px[o + 2] = Math.min(255, B_ * sc * (255 / Math.max(lum * sc, 1)));
      px[o + 3] = Math.round(255 * Math.min(1, Math.pow(a, 0.8)));
    }
  }
  g.putImageData(img, 0, 0);
  // a touch of softening, as through a telescope
  const soft = document.createElement('canvas');
  soft.width = soft.height = S;
  const sg = soft.getContext('2d')!;
  sg.filter = `blur(${(0.45 * dpr).toFixed(2)}px)`;
  sg.drawImage(c, 0, 0);
  return soft;
}

export function Starfield({ reducedMotion }: { reducedMotion: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const g = c.getContext('2d')!;
    let stars: { x: number; y: number; r: number; a: number; f: number; ph: number; tint: string; depth: number }[] = [];
    let galaxies: Galaxy[] = [];
    let w = 0, h = 0, dpr = 1, raf = 0;
    const tints = ['255,255,255', '255,236,214', '214,228,255', '255,220,200', '200,220,255'];
    const build = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      const rnd = mulberry32(42);
      const n = Math.round((w * h) / 700);
      stars = Array.from({ length: n }, () => {
        const bright = rnd() < 0.06;
        return {
          x: rnd() * w, y: rnd() * h * 1.4,
          r: bright ? 0.9 + rnd() * 0.9 : 0.35 + rnd() * 0.6,
          a: bright ? 0.8 + rnd() * 0.2 : 0.3 + rnd() * 0.45,
          f: 0.3 + rnd() * 1.4, ph: rnd() * Math.PI * 2,
          tint: tints[Math.floor(rnd() * tints.length)],
          depth: 0.02 + rnd() * 0.08,
        };
      });
      // four small galaxies (three spirals, one elliptical)
      const grnd = mulberry32(7);
      const slots = [[0.945, 0.15], [0.035, 0.52], [0.955, 0.92], [0.04, 1.22]];   // side margins, clear of the text column
      galaxies = slots.map(([fx, fy], k) => {
        const spiral = k !== 1;
        const R = (spiral ? 24 : 14) + grnd() * 12;
        return {
          x: w * fx, y: h * fy, rot: grnd() * Math.PI,
          incl: spiral ? 0.35 + 0.4 * grnd() : 0.6 + 0.3 * grnd(),
          depth: 0.012, a: 0.6 + 0.2 * grnd(),
          sprite: galaxySprite(grnd, R, spiral, dpr),
        };
      });
    };
    const draw = (now: number) => {
      const t = now / 1000;
      const sy = window.scrollY;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      for (const q of galaxies) {
        const y = ((q.y - sy * q.depth) % (h * 1.4) + h * 1.4) % (h * 1.4);
        const R = q.sprite.width / dpr / 2;
        if (y > h + R) continue;
        g.save();
        g.globalAlpha = q.a;
        g.translate(q.x, y); g.rotate(q.rot); g.scale(1, q.incl);
        g.drawImage(q.sprite, -R, -R, 2 * R, 2 * R);
        g.restore();
      }
      for (const s of stars) {
        const y = ((s.y - sy * s.depth) % (h * 1.4) + h * 1.4) % (h * 1.4);
        if (y > h + 2) continue;
        const tw = reducedMotion ? 1 : 0.75 + 0.25 * Math.sin(t * s.f + s.ph);
        g.fillStyle = `rgba(${s.tint},${(s.a * tw).toFixed(3)})`;
        g.beginPath(); g.arc(s.x, y, s.r, 0, Math.PI * 2); g.fill();
        if (s.r > 1.2) {
          g.fillStyle = `rgba(${s.tint},${(0.06 * tw).toFixed(3)})`;
          g.beginPath(); g.arc(s.x, y, s.r * 4, 0, Math.PI * 2); g.fill();
        }
      }
    };
    let last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 50) return;     // ~20 fps is plenty for a twinkle
      last = now;
      draw(now);
    };
    build();
    draw(0);
    const onResize = () => { build(); draw(performance.now()); };
    window.addEventListener('resize', onResize);
    const onScroll = () => { if (reducedMotion) draw(0); };
    window.addEventListener('scroll', onScroll, { passive: true });
    if (!reducedMotion) raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); window.removeEventListener('scroll', onScroll); };
  }, [reducedMotion]);
  return <canvas className="starfield" ref={ref} aria-hidden="true" />;
}
