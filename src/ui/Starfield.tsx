// Page-wide background starfield (2D canvas): deterministic positions, gentle
// twinkle, slight parallax on scroll, and a few loose star clusters
// (purely decorative).  Static when reduced motion is requested.

import { useEffect, useRef } from 'react';
import { mulberry32 } from '../model/rng';

export function Starfield({ reducedMotion }: { reducedMotion: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const g = c.getContext('2d')!;
    let stars: { x: number; y: number; r: number; a: number; f: number; ph: number; tint: string; depth: number }[] = [];
    let w = 0, h = 0, dpr = 1, raf = 0;
    const tints = ['255,255,255', '255,236,214', '214,228,255', '255,220,200', '200,220,255'];
    const build = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      const rnd = mulberry32(42);
      const n = Math.round((w * h) / 520);
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
      // loose star clusters: Plummer-like concentration around a few centres
      const crnd = mulberry32(7);
      for (let k = 0; k < 5; k++) {
        const cx = crnd() * w, cy = crnd() * h * 1.4, rc = 14 + crnd() * 22;
        const depth = 0.03 + crnd() * 0.04, tint = tints[Math.floor(crnd() * tints.length)];
        const m = 45 + Math.floor(crnd() * 45);
        for (let q = 0; q < m; q++) {
          const rr = rc / Math.sqrt(Math.pow(Math.max(crnd(), 0.02), -2 / 3) - 1 + 1e-6);
          const ang = crnd() * Math.PI * 2;
          const bright = crnd() < 0.08;
          stars.push({
            x: cx + Math.min(rr, rc * 6) * Math.cos(ang), y: cy + Math.min(rr, rc * 6) * Math.sin(ang),
            r: bright ? 0.8 + crnd() * 0.6 : 0.35 + crnd() * 0.45,
            a: bright ? 0.8 + crnd() * 0.2 : 0.35 + crnd() * 0.4,
            f: 0.3 + crnd() * 1.4, ph: crnd() * Math.PI * 2,
            tint: crnd() < 0.7 ? tint : tints[Math.floor(crnd() * tints.length)], depth,
          });
        }
      }
    };
    const draw = (now: number) => {
      const t = now / 1000;
      const sy = window.scrollY;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
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
