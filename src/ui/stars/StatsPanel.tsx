// Summary statistics of the stars currently shown on the map: counts,
// distances, class composition and three small stacked histograms.

import { CLASSES, SAMPLES, type SampleKey } from '../../stars/catalog';
import type { Hist, Selection, Stats } from '../../stars/stats';
import { CLASS_COLORS, SAMPLE_COLORS } from '../../stars/StarMapView';
import { int, pc } from './fmt';

const W = 264, H = 54;
/** Stacking order of the histograms, bottom → top. */
const STACK: SampleKey[] = ['P5', 'P4', 'P1', 'P2'];

function Histogram({ h, label, unit, median, fmt }: { h: Hist; label: string; unit: string; median: number | null; fmt: (x: number) => string }) {
  const n = h.edges.length - 1;
  const tot = h.counts.P4.map((_, k) => STACK.reduce((a, s) => a + h.counts[s][k], 0));
  const max = Math.max(1, ...tot);
  const bw = W / n;
  const x = (v: number) => ((v - h.edges[0]) / (h.edges[n] - h.edges[0])) * W;
  const ticks = [h.edges[0], h.edges[Math.round(n / 2)], h.edges[n]];
  return (
    <figure className="hist">
      <figcaption><span>{label}</span>{median !== null && <span className="med">median {fmt(median)} {unit}</span>}</figcaption>
      <svg viewBox={`0 -2 ${W} ${H + 16}`} role="img" aria-label={`${label} histogram`}>
        {tot.map((t, k) => {
          if (!t) return null;
          let y = H;
          return (
            <g key={k}>
              {STACK.map((s) => {
                const hs = (h.counts[s][k] / max) * H;
                if (hs <= 0) return null;
                y -= hs;
                return <rect key={s} x={k * bw + 0.5} width={Math.max(bw - 1, 0.6)} y={y} height={hs} fill={SAMPLE_COLORS[s]} opacity={s === 'P5' ? 0.82 : 0.88} />;
              })}
            </g>
          );
        })}
        {median !== null && <line x1={x(median)} x2={x(median)} y1={-2} y2={H} className="med-line" />}
        <line x1={0} x2={W} y1={H + 0.5} y2={H + 0.5} className="base" />
        {ticks.map((t, k) => (
          <text key={k} x={x(t)} y={H + 12} textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}>{fmt(t)}</text>
        ))}
      </svg>
    </figure>
  );
}

export function StatsPanel({ stats, sel }: { stats: Stats; sel: Selection }) {
  const s = stats;
  const on = SAMPLES.filter((k) => sel.samples[k]);
  // P2 ⊂ P1: with both chosen, the histograms split P1 into P2 and the rest
  const stacked = STACK.filter((k) => sel.samples[k]).reverse();
  const clsTotal = CLASSES.map((k) => (sel.classes[k] ? s.classCounts[k] : 0));
  const shown = clsTotal.reduce((a, b) => a + b, 0) || 1;
  return (
    <aside className="map-panel map-right" aria-live="polite">
      <div className="st-count">
        <span className="v">{int(s.n)}</span>
        <span className="k">stars shown</span>
      </div>
      {on.length > 1 && (
        <div className="st-split">
          {on.map((k) => <span key={k}><i className="sw" style={{ background: SAMPLE_COLORS[k] }} />{k} {int(s.bySample[k])}</span>)}
        </div>
      )}
      {s.d && (
        <dl className="st-dl">
          <dt>Median distance</dt><dd>{pc(s.d.median)} pc</dd>
          <dt>5–95 % of stars</dt><dd>{pc(s.d.q05)}–{pc(s.d.q95)} pc</dd>
          <dt>Nearest / farthest</dt><dd>{pc(s.d.min)} / {pc(s.d.max)} pc</dd>
          {s.massMedian !== null && <><dt>Median mass</dt><dd>{s.massMedian.toFixed(2)} M☉</dd></>}
        </dl>
      )}

      <div className="st-cls" aria-label="Spectral-class composition">
        <div className="st-sub">Spectral class (from T<sub>eff</sub>)</div>
        <div className="cls-bar">
          {[...CLASSES].reverse().map((k) => {
            const v = clsTotal[CLASSES.indexOf(k)];
            return v ? <span key={k} style={{ flexGrow: v, background: CLASS_COLORS[k] }} title={`${k}: ${int(v)}`} /> : null;
          })}
        </div>
        <div className="cls-nums">
          {[...CLASSES].reverse().map((k) => {
            const v = clsTotal[CLASSES.indexOf(k)];
            return <span key={k} className={v ? '' : 'off'}><b>{k}</b> {v ? (v / shown < 0.001 ? '<0.1 %' : `${((100 * v) / shown).toFixed(v / shown < 0.01 ? 1 : 0)} %`) : '–'}</span>;
          })}
        </div>
      </div>

      {s.n > 0 && (
        <>
          <Histogram h={s.hist.d} label="Distance" unit="pc" median={s.d?.median ?? null} fmt={(v) => `${Math.round(v)}`} />
          <Histogram h={s.hist.teff} label="Effective temperature" unit="K" median={s.teffMedian} fmt={(v) => `${Math.round(v)}`} />
          <Histogram h={s.hist.mass} label="Mass" unit="M☉" median={s.massMedian} fmt={(v) => v.toFixed(2)} />
        </>
      )}
      {stacked.length > 1 && (
        <p className="st-foot">Histograms are stacked, top to bottom: {stacked.map((k, j) => (
          <span key={k}>{j > 0 && ', '}<i className="sw" style={{ background: SAMPLE_COLORS[k] }} />{k === 'P1' && sel.samples.P2 ? 'P1 without P2' : k}</span>
        ))}. Bar heights are counts.</p>
      )}
    </aside>
  );
}
