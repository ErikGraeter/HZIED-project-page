// Part 4 — HZIED detection significance versus the number of observed P5
// planets, for optimistic and pessimistic RV follow-up.  Median and 16–84 %
// band over repeated survey + noise realizations; null test (no inflation)
// for reference.  Click or drag to set the sample size shown above.

import { useEffect, useRef, useState } from 'react';
import { scaleLinear, scaleLog } from 'd3-scale';
import type { CurvePoint } from '../../model/rv';

export const SCEN_COLORS = { optimistic: '#199e70', pessimistic: '#9085e9' } as const;

interface Props {
  opt: CurvePoint[];
  pess: CurvePoint[];
  nul: CurvePoint[];
  nShow: number;
  setN: (n: number) => void;
  primaryN: number;
  maxRealization: number;
  poolN: number;
  n3: { optimistic: number | null; pessimistic: number | null };
  progress: number;
}

export function SignificanceFigure(p: Props) {
  // narrower coordinate system on small screens keeps the text readable
  const boxRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const ro = new ResizeObserver((e) => setNarrow(e[0].contentRect.width < 520));
    if (boxRef.current) ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, []);
  const W = narrow ? 400 : 600, H = narrow ? 340 : 380;
  const m = { l: 46, r: 18, t: 16, b: 44 };
  const x = scaleLog().domain([10, p.poolN]).range([m.l, W - m.r]).clamp(true);
  const all = [...p.opt, ...p.pess].flatMap((c) => [c.q84]).filter(Number.isFinite);
  const y = scaleLinear().domain([-1.5, Math.max(6, Math.ceil(Math.max(...all, 4) + 0.5))]).range([H - m.b, m.t]);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const toN = (clientX: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const xx = ((clientX - r.left) / r.width) * W;
    return Math.round(Math.max(10, Math.min(p.poolN, x.invert(xx))));
  };
  const path = (c: CurvePoint[], k: keyof CurvePoint) => c.filter((q) => Number.isFinite(q[k] as number))
    .map((q, i) => `${i ? 'L' : 'M'}${x(q.n).toFixed(1)},${y(q[k] as number).toFixed(1)}`).join('');
  const band = (c: CurvePoint[]) => {
    const ok = c.filter((q) => Number.isFinite(q.q16) && Number.isFinite(q.q84));
    if (ok.length < 2) return '';
    return ok.map((q, i) => `${i ? 'L' : 'M'}${x(q.n).toFixed(1)},${y(q.q84).toFixed(1)}`).join('')
      + [...ok].reverse().map((q) => `L${x(q.n).toFixed(1)},${y(q.q16).toFixed(1)}`).join('') + 'Z';
  };
  const near = (c: CurvePoint[], n: number) => c.reduce<CurvePoint | null>((a, q) => (!a || Math.abs(Math.log(q.n / n)) < Math.abs(Math.log(a.n / n)) ? q : a), null);
  const hN = hover ?? p.nShow;
  const ho = near(p.opt, hN), hp = near(p.pess, hN);
  const xt = (narrow ? [10, 30, 100, 300, 1000] : [10, 20, 50, 100, 200, 500, 1000]).filter((v) => v <= p.poolN);

  return (
    <figure className="figure card sig-card">
      <h4>Detection significance vs. number of P5 planets</h4>
      <p className="card-sub">One-sided Welch t-test of ρ_norm (cold &gt; hot) at 280 W m⁻², converted to Gaussian σ · median and 16–84 % of {p.opt[0]?.valid ? 'repeated' : ''} survey + noise realizations</p>
      <div className="chart-legend">
        <span><i className="lg-line" style={{ borderColor: SCEN_COLORS.optimistic }} />optimistic RV (σ_M/M fixed)</span>
        <span><i className="lg-line" style={{ borderColor: SCEN_COLORS.pessimistic }} />pessimistic RV (σ_K from σ_RV, N_RV)</span>
        <span><i className="lg-line" style={{ borderColor: 'rgba(233,237,244,0.5)', borderTopStyle: 'dotted' }} />null test: no steam inflation</span>
      </div>
      <div className="chart" ref={boxRef}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Detection significance in sigma versus number of observed planets for optimistic and pessimistic RV follow-up."
          onPointerMove={(e) => { setHover(toN(e.clientX)); if (e.buttons) p.setN(toN(e.clientX)); }}
          onPointerLeave={() => setHover(null)}
          onPointerDown={(e) => { (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId); p.setN(toN(e.clientX)); }}
          style={{ cursor: 'crosshair', touchAction: 'pan-y' }}>
          {/* forecast region: more planets than one P5 realization provides */}
          <rect x={x(p.maxRealization)} y={m.t} width={Math.max(0, W - m.r - x(p.maxRealization))} height={H - m.b - m.t} fill="rgba(255,255,255,0.025)" />
          <text className="lbl" x={x(p.maxRealization) + 6} y={m.t + 13} style={{ fontSize: 10.5 }}>{narrow ? 'forecast →' : 'forecast · pooled independent P5 realizations →'}</text>
          <g className="grid">{y.ticks(6).map((t) => <line key={t} x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} />)}</g>
          {[2, 3].map((s) => (
            <g key={s}>
              <line x1={m.l} x2={W - m.r} y1={y(s)} y2={y(s)} stroke={s === 3 ? 'rgba(255,190,140,0.75)' : 'rgba(255,190,140,0.4)'} strokeDasharray="6 5" />
              <text className="lbl" x={m.l + 6} y={y(s) - 5} style={{ fontSize: 10.5 }}>{s}σ</text>
            </g>
          ))}
          <line x1={x(p.primaryN)} x2={x(p.primaryN)} y1={m.t} y2={H - m.b} stroke="rgba(246,236,222,0.35)" strokeDasharray="2 4" />
          <text className="lbl" x={x(p.primaryN) - 5} y={H - m.b - 8} textAnchor="end" style={{ fontSize: 10.5 }}>predicted P5 sample ({p.primaryN})</text>
          {/* null test */}
          <path d={path(p.nul, 'q50')} fill="none" stroke="rgba(233,237,244,0.5)" strokeWidth="1.6" strokeDasharray="1.5 4" strokeLinecap="round" />
          {/* scenarios */}
          {([['pessimistic', p.pess], ['optimistic', p.opt]] as const).map(([k, c]) => (
            <g key={k}>
              <path d={band(c)} fill={SCEN_COLORS[k]} opacity={0.14} />
              <path d={path(c, 'q50')} fill="none" stroke={SCEN_COLORS[k]} strokeWidth="2.2" strokeLinejoin="round" />
            </g>
          ))}
          {/* 3σ crossings */}
          {(['optimistic', 'pessimistic'] as const).map((k) => {
            const n = p.n3[k];
            if (!n) return null;
            return (
              <g key={k}>
                <circle cx={x(n)} cy={y(3)} r="5" fill={SCEN_COLORS[k]} stroke="#0b1020" strokeWidth="2" />
                <text className="lbl-strong" x={x(n)} y={y(3) + (k === 'optimistic' ? 20 : -12)} textAnchor="middle" style={{ fontSize: 11 }}>N ≈ {n}</text>
              </g>
            );
          })}
          {/* current N */}
          <line x1={x(hN)} x2={x(hN)} y1={m.t} y2={H - m.b} stroke="rgba(255,255,255,0.45)" />
          {ho && Number.isFinite(ho.q50) && <circle cx={x(ho.n)} cy={y(ho.q50)} r="4" fill={SCEN_COLORS.optimistic} stroke="#0b1020" strokeWidth="2" />}
          {hp && Number.isFinite(hp.q50) && <circle cx={x(hp.n)} cy={y(hp.q50)} r="4" fill={SCEN_COLORS.pessimistic} stroke="#0b1020" strokeWidth="2" />}
          {ho && hp && (
            <g transform={`translate(${Math.max(m.l + 4, Math.min(W - m.r - 254, x(hN) + 262 > W - m.r ? x(hN) - 262 : x(hN) + 10))} ${m.t + 22})`}>
              <rect width="252" height="66" rx="8" fill="rgba(8,11,22,0.95)" stroke="rgba(255,255,255,0.14)" />
              <text className="lbl-strong" x="10" y="17">N = {ho.n}{ho.n > p.maxRealization ? ' (forecast)' : ''}</text>
              <rect x="10" y="27" width="8" height="8" rx="2" fill={SCEN_COLORS.optimistic} />
              <text className="lbl" x="24" y="35">optimistic</text>
              <text className="lbl" x="242" y="35" textAnchor="end" style={{ fontFamily: 'var(--mono)' }}>{fmtS(ho)}</text>
              <rect x="10" y="44" width="8" height="8" rx="2" fill={SCEN_COLORS.pessimistic} />
              <text className="lbl" x="24" y="52">pessimistic</text>
              <text className="lbl" x="242" y="52" textAnchor="end" style={{ fontFamily: 'var(--mono)' }}>{fmtS(hp)}</text>
            </g>
          )}
          <g className="axis">
            <line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} />
            {xt.map((t) => <text key={t} x={x(t)} y={H - m.b + 16} textAnchor="middle">{t}</text>)}
            {y.ticks(6).map((t) => <text key={t} x={m.l - 8} y={y(t) + 3} textAnchor="end">{t}</text>)}
          </g>
          <text className="lbl" x={(m.l + W - m.r) / 2} y={H - 6} textAnchor="middle">{narrow ? 'observed P5 planets N' : 'number of observed P5 planets N (click or drag to choose)'}</text>
          <text className="lbl" transform={`translate(12 ${(H - m.b + m.t) / 2}) rotate(-90)`} textAnchor="middle">detection significance [σ]</text>
          {p.progress < 1 && <text className="lbl" x={W - m.r - 4} y={H - m.b - 8} textAnchor="end" style={{ fontSize: 10.5 }}>simulating… {Math.round(100 * p.progress)} %</text>}
        </svg>
      </div>
    </figure>
  );
}

const fmtS = (c: CurvePoint) => (Number.isFinite(c.q50) ? `${c.q50.toFixed(1)}σ · P(≥3σ) ${Math.round(100 * c.pDetect3)}%` : '—');
