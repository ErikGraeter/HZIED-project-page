// PLATO stellar-sample export: decoding, sample membership, coordinates and
// statistics, checked against rows of the pipeline's sample parquets.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import metaJson from '../src/data/plato_stars_meta.json';
import ref from './plato_stars_reference.json';
import { BIT, CLASSES, anglesOf, decodeCatalog, icrsToGalactic, starRecord, type StarMeta } from '../src/stars/catalog';
import { computeStats, shownAs } from '../src/stars/stats';

const meta = metaJson as unknown as StarMeta;
const raw = gunzipSync(readFileSync(new URL('../src/data/plato_stars.bin.gz', import.meta.url)));
const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
const cat = decodeCatalog(buf, meta);
const allClasses = { M: true, K: true, G: true, F: true };
const only = (...k: ('P1' | 'P2' | 'P4' | 'P5')[]) => ({ P1: k.includes('P1'), P2: k.includes('P2'), P4: k.includes('P4'), P5: k.includes('P5') });
const byPic = new Map<string, number>();
for (let i = 0; i < cat.n; i++) byPic.set(cat.picId(i), i);

describe('PLATO stellar samples', () => {
  it('contains every P1, P2, P4 and P5 star exactly once', () => {
    // P2 ⊂ P1; P1, P4 and P5 are disjoint in the catalogue flags
    expect(meta.overlaps).toEqual({ 'P1&P2': 605, 'P1&P5': 0, 'P2&P5': 0, 'P1&P4': 0, 'P4&P5': 0 });
    expect(cat.n).toBe(meta.samples.P4.n + meta.samples.P5.n + meta.samples.P1.n);
    expect(byPic.size).toBe(cat.n);
    const cnt = { P1: 0, P2: 0, P4: 0, P5: 0 };
    let p2NotP1 = 0;
    for (let i = 0; i < cat.n; i++) {
      for (const k of ['P1', 'P2', 'P4', 'P5'] as const) if (cat.sample[i] & BIT[k]) cnt[k]++;
      if (cat.sample[i] & BIT.P2 && !(cat.sample[i] & BIT.P1)) p2NotP1++;
    }
    expect(cnt).toEqual({ P1: 9665, P2: 605, P4: 13102, P5: 158285 });
    expect(p2NotP1).toBe(0);
  });

  it('reference rows: membership, distance and stellar parameters', () => {
    for (const key of ['P4', 'P5', 'P1', 'P2'] as const) {
      const r = ref[key];
      r.pic_id.forEach((pic, k) => {
        const i = byPic.get(pic);
        expect(i).toBeDefined();
        const s = starRecord(cat, i!);
        expect(s.sample).toEqual(key === 'P2' ? ['P1', 'P2'] : [key]);
        expect(Math.abs(s.d - r.d[k])).toBeLessThan(0.011);
        expect(Math.abs(s.teff - r.T_eff_st[k])).toBeLessThan(0.51);
        expect(Math.abs(s.mass - r.M_st[k])).toBeLessThan(6e-5);
        expect(Math.abs(s.radius - r.R_st[k])).toBeLessThan(6e-5);
      });
    }
  });

  it('positions are the ICRS → Galactic transform of RA, Dec and distance', () => {
    for (const key of ['P4', 'P5', 'P1', 'P2'] as const) {
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
    const st = (...k: Parameters<typeof only>) => computeStats(cat, { samples: only(...k), classes: allClasses });
    const p4 = st('P4'), p5 = st('P5'), p1 = st('P1'), p2 = st('P2');
    const both = st('P4', 'P5'), bright = st('P1', 'P2'), all = st('P1', 'P2', 'P4', 'P5');
    expect(p4.n).toBe(13102);
    expect(p5.n).toBe(158285);
    expect(p1.n).toBe(9665);
    expect(p2.n).toBe(605);
    expect(both.n).toBe(171387);
    expect(bright.n).toBe(9665);                      // P2 ⊂ P1: no star counted twice
    expect(all.n).toBe(181052);
    expect(bright.bySample).toEqual({ P1: 9665, P2: 605, P4: 0, P5: 0 });
    for (const [s, k] of [[p4, 'P4'], [p5, 'P5'], [p1, 'P1'], [p2, 'P2']] as const) {
      expect(Math.abs(s.d!.median - meta.samples[k].d_median)).toBeLessThan(0.02);
    }
    for (const s of [p4, p5, p1, p2, both, bright, all]) {
      const sum = (h: Record<string, number[]>) => Object.values(h).flat().reduce((a, b) => a + b, 0);
      expect(sum(s.hist.d.counts)).toBe(s.n);
      expect(sum(s.hist.teff.counts)).toBe(s.n);
      expect(sum(s.hist.mass.counts)).toBe(s.n);
    }
    const onlyM = computeStats(cat, { samples: only('P4', 'P5'), classes: { M: true, K: false, G: false, F: false } });
    expect(onlyM.n).toBe(both.classCounts.M);
    for (const s of [both, all]) expect(CLASSES.reduce((a, k) => a + s.classCounts[k], 0)).toBe(s.n);
  });

  it('P2 stars are drawn as P2 when P2 is chosen, otherwise as P1', () => {
    const s = BIT.P1 | BIT.P2;
    expect(shownAs(s, only('P1', 'P2'))).toEqual(['P2']);
    expect(shownAs(s, only('P1'))).toEqual(['P1']);
    expect(shownAs(s, only('P2'))).toEqual(['P2']);
    expect(shownAs(s, only('P4', 'P5'))).toEqual([]);
    expect(shownAs(BIT.P1, only('P2'))).toEqual([]);
  });

  it('NGC 2516 marker sits on the cluster (RA 119.5°, Dec −60.8°, ≈ 410 pc)', () => {
    const cl = meta.clusters?.find((c) => c.name === 'NGC 2516');
    expect(cl).toBeDefined();
    const a = anglesOf(cl!.x, cl!.y, cl!.z);
    expect(Math.abs(a.ra - 119.53)).toBeLessThan(1.0);
    expect(Math.abs(a.dec + 60.75)).toBeLessThan(0.6);
    expect(Math.abs(cl!.d - 410)).toBeLessThan(20);
    expect(cl!.n_selected).toBeGreaterThan(3 * cl!.n_expected_field);
  });
});
