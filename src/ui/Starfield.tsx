// Page-wide background starfield (2D canvas): deterministic positions, gentle
// twinkle, slight parallax on scroll, and a few small, faint background
// galaxies (procedural, purely decorative).  Static when reduced motion is
// requested.

import { useEffect, useRef } from 'react';
import { mulberry32 } from '../model/rng';

interface Galaxy { x: number; y: number; rot: number; incl: number; depth: number; a: number; sprite: HTMLCanvasElement }

/** Face-on sprite of a small galaxy: a warm bulge, and for spirals two dusty blue arms. */
function galaxySprite(rnd: () => number, R: number, spiral: boolean, dpr: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const S = Math.ceil(2 * R * dpr);
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  const o = R;
  const disk = g.createRadialGradient(o, o, 0, o, o, R);
  disk.addColorStop(0, spiral ? 'rgba(200,214,255,0.22)' : 'rgba(255,232,205,0.42)');
  disk.addColorStop(spiral ? 0.55 : 0.4, spiral ? 'rgba(170,190,255,0.07)' : 'rgba(255,225,195,0.10)');
  disk.addColorStop(1, 'rgba(170,190,255,0)');
  g.fillStyle = disk; g.fillRect(0, 0, 2 * R, 2 * R);
  if (spiral) {
    // two logarithmic arms of scattered points, fading outwards
    const pitch = 0.28 + 0.1 * rnd();
    for (let arm = 0; arm < 2; arm++) {
      for (let k = 0; k < 260; k++) {
        const u = k / 260;
        const th = arm * Math.PI + u * 3.4 * Math.PI;
        const r = R * 0.12 * Math.exp(pitch * th / Math.PI * 1.6);
        if (r > R * 0.95) break;
        const j = R * 0.06 * (rnd() + rnd() - 1);
        const x = o + (r + j) * Math.cos(th), y = o + (r + j) * Math.sin(th);
        g.fillStyle = `rgba(${rnd() < 0.15 ? '255,215,225' : '205,220,255'},${(0.5 * (1 - r / R)).toFixed(3)})`;
        g.beginPath(); g.arc(x, y, 0.35 + 0.5 * rnd(), 0, Math.PI * 2); g.fill();
      }
    }
  }
  const core = g.createRadialGradient(o, o, 0, o, o, R * (spiral ? 0.22 : 0.35));
  core.addColorStop(0, 'rgba(255,240,220,0.95)');
  core.addColorStop(1, 'rgba(255,225,190,0)');
  g.fillStyle = core; g.beginPath(); g.arc(o, o, R * (spiral ? 0.22 : 0.35), 0, Math.PI * 2); g.fill();
  return c;
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
        const R = (spiral ? 22 : 13) + grnd() * 12;
        return {
          x: w * fx, y: h * fy, rot: grnd() * Math.PI,
          incl: spiral ? 0.35 + 0.4 * grnd() : 0.6 + 0.3 * grnd(),
          depth: 0.012, a: 0.75 + 0.25 * grnd(),
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
