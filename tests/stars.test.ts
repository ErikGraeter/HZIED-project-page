// PLATO stellar-sample export: decoding, sample membership, coordinates and
// statistics, checked against rows of the pipeline's sample parquets.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import metaJson from '../src/data/plato_stars_meta.json';
import ref from './plato_stars_reference.json';
import { BIT, CLASSES, anglesOf, decodeCatalog, icrsToGalactic, starRecord, type StarMeta } from '../src/stars/catalog';
import { computeStats } from '../src/stars/stats';

const meta = metaJson as unknown as StarMeta;
const raw = gunzipSync(readFileSync(new URL('../src/data/plato_stars.bin.gz', import.meta.url)));
const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
const cat = decodeCatalog(buf, meta);
const allClasses = { M: true, K: true, G: true, F: true };
const byPic = new Map<string, number>();
for (let i = 0; i < cat.n; i++) byPic.set(cat.picId(i), i);

describe('PLATO stellar samples', () => {
  it('contains every P4 and P5 star exactly once', () => {
    expect(cat.n).toBe(meta.samples.P4.n + meta.samples.P5.n - meta.n_in_both);
    expect(byPic.size).toBe(cat.n);
    let p4 = 0, p5 = 0;
    for (let i = 0; i < cat.n; i++) { if (cat.sample[i] & BIT.P4) p4++; if (cat.sample[i] & BIT.P5) p5++; }
    expect(p4).toBe(13102);
    expect(p5).toBe(158285);
  });

  it('reference rows: membership, distance and stellar parameters', () => {
    for (const key of ['P4', 'P5'] as const) {
      const r = ref[key];
      r.pic_id.forEach((pic, k) => {
        const i = byPic.get(pic);
        expect(i).toBeDefined();
        const s = starRecord(cat, i!);
        expect(s.sample).toEqual([key]);
        expect(Math.abs(s.d - r.d[k])).toBeLessThan(0.011);
        expect(Math.abs(s.teff - r.T_eff_st[k])).toBeLessThan(0.51);
        expect(Math.abs(s.mass - r.M_st[k])).toBeLessThan(6e-5);
        expect(Math.abs(s.radius - r.R_st[k])).toBeLessThan(6e-5);
      });
    }
  });

  it('positions are the ICRS → Galactic transform of RA, Dec and distance', () => {
    for (const key of ['P4', 'P5'] as const) {
      const r = ref[key];
      r.pic_id.forEach((pic, k) => {
        const i = byPic.get(pic)!;
        const g = icrsToGalactic(r.ra[k], r.dec[k], r.d[k]);
        for (let a = 0; a < 3; a++) expect(Math.abs(cat.xyz[3 * i + a] - g[a])).toBeLessThan(1e-3 * Math.max(1, r.d[k] / 100));
        const ang = anglesOf(cat.xyz[3 * i], cat.xyz[3 * i + 1], cat.xyz[3 * i + 2]);
        expect(Math.abs(((ang.ra - r.ra[k] + 540) % 360) - 180)).toBeLessThan(1e-4);
        expect(Math.abs(ang.dec - r.dec[k])).toBeLessThan(1e-4);
      });
    }
  });

  it('|position| equals the catalogue distance for every star', () => {
    let worst = 0;
    for (let i = 0; i < cat.n; i++) {
      const r = Math.hypot(cat.xyz[3 * i], cat.xyz[3 * i + 1], cat.xyz[3 * i + 2]);
      worst = Math.max(worst, Math.abs(r - cat.d[i]));
    }
    expect(worst).toBeLessThan(0.011);   // d is stored at 0.02 pc resolution
  });

  it('temperature classes follow T_eff', () => {
    for (let i = 0; i < cat.n; i += 97) {
      const t = cat.teff[i], c = CLASSES[cat.cls[i]];
      if (t < 3830) expect(c).toBe('M');
      if (t > 4000 && t < 5300) expect(c).toBe('K');
      if (t > 5350 && t < 5950) expect(c).toBe('G');
      if (t > 6050) expect(c).toBe('F');
    }
  });

  it('statistics: counts, class filter and medians', () => {
    const p4 = computeStats(cat, { sample: 'P4', classes: allClasses });
    const p5 = computeStats(cat, { sample: 'P5', classes: allClasses });
    const both = computeStats(cat, { sample: 'both', classes: allClasses });
    expect(p4.n).toBe(13102);
    expect(p5.n).toBe(158285);
    expect(both.n).toBe(171387);
    expect(Math.abs(p4.d!.median - meta.samples.P4.d_median)).toBeLessThan(0.02);
    expect(Math.abs(p5.d!.median - meta.samples.P5.d_median)).toBeLessThan(0.02);
    for (const s of [p4, p5, both]) {
      const sum = (h: Record<string, number[]>) => Object.values(h).flat().reduce((a, b) => a + b, 0);
      expect(sum(s.hist.d.counts)).toBe(s.n);
      expect(sum(s.hist.teff.counts)).toBe(s.n);
      expect(sum(s.hist.mass.counts)).toBe(s.n);
    }
    const onlyM = computeStats(cat, { sample: 'both', classes: { M: true, K: false, G: false, F: false } });
    expect(onlyM.n).toBe(both.classCounts.M.P4 + both.classCounts.M.P5);
    const total = CLASSES.reduce((a, k) => a + both.classCounts[k].P4 + both.classCounts[k].P5, 0);
    expect(total).toBe(both.n);
  });
});
