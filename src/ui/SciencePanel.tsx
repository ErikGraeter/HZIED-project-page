// Expandable scientific control panel.  Every control changes the model
// inputs; the population, inflation, evidence and storyboard are recomputed
// (src/model/compute.ts), so the 3D view and the plot stay consistent.

import type { HziedData, ModelParams } from '../model/types';
import type { ModelState } from '../model/compute';
import { defaultParams } from '../model/compute';
import { signed } from './format';
import { verdict } from '../model/evidence';

interface Props {
  open: boolean;
  data: HziedData;
  model: ModelState;
  params: ModelParams;
  setParams: (p: ModelParams) => void;
}

const wrrLabel = (w: number) => `${(w * 100).toFixed(w < 0.001 ? 2 : w < 0.01 ? 1 : 0)} %`;

export function SciencePanel({ open, data, model, params, setParams }: Props) {
  const set = (patch: Partial<ModelParams>) => setParams({ ...params, ...patch });
  const nMax = model.nObservable;
  const N = Math.min(params.N, nMax);
  const grid = data.provenance.wrr_grid;
  const v = verdict(model.fit.lnK);
  const nHot = model.planets.filter((p) => p.S_abs > params.S_thresh).length;
  const nInfl = model.planets.filter((p) => p.S_abs > params.S_thresh && p.steam).length;

  return (
    <div className={`science${open ? ' open' : ''}`} id="science-panel" aria-hidden={!open}>
      <div className="science-grid">
        <div className="field">
          <label htmlFor="f-sample">Planet sample</label>
          <select id="f-sample" className="select" value={params.sample} tabIndex={open ? 0 : -1}
            onChange={(e) => set({ sample: e.target.value, N: 100000 })}>
            {data.samples.map((s) => <option key={s.meta.key} value={s.meta.key}>{s.meta.label}</option>)}
          </select>
          <div className="hint">{model.sample.meta.description}</div>
        </div>
        <div className="field">
          <label htmlFor="f-sth">Runaway greenhouse threshold <b>{Math.round(params.S_thresh)} W m⁻²</b></label>
          <input id="f-sth" type="range" min={150} max={600} step={5} value={params.S_thresh} tabIndex={open ? 0 : -1}
            onChange={(e) => set({ S_thresh: Number(e.target.value) })} />
          <div className="hint">Injected S_thresh: which planets can host a steam envelope, and where H1 places the step.</div>
        </div>
        <div className="field">
          <label htmlFor="f-wrr">Water-to-rock ratio <b>{wrrLabel(params.wrr)}</b></label>
          <input id="f-wrr" type="range" min={0} max={grid.length - 1} step={1} value={Math.max(0, grid.findIndex((w) => Math.abs(w - params.wrr) < 1e-9))}
            tabIndex={open ? 0 : -1} onChange={(e) => set({ wrr: grid[Number(e.target.value)] })} />
          <div className="hint">Water inventory of the steam planets (AGNI+PALEOS grid). Includes the Dorn & Lichtenberg (2021) correction for water stored in the magma ocean.</div>
        </div>
        <div className="field">
          <label htmlFor="f-frgh">Inflated fraction of hot planets <b>f_rgh = {params.f_rgh.toFixed(2)}</b></label>
          <input id="f-frgh" type="range" min={0} max={1} step={0.05} value={params.f_rgh} tabIndex={open ? 0 : -1}
            onChange={(e) => set({ f_rgh: Number(e.target.value) })} />
          <div className="hint">Fraction of planets above the threshold that carry a steam envelope. f_rgh = 0 is a null test.</div>
        </div>
        <div className="field">
          <label htmlFor="f-n">Observed planets <b>N = {N}</b></label>
          <input id="f-n" type="range" min={10} max={Math.max(10, nMax)} step={1} value={N} tabIndex={open ? 0 : -1}
            onChange={(e) => set({ N: Number(e.target.value) })} />
          <div className="hint">First N planets in a fixed, seeded survey-arrival order ({nMax} pass the observable cuts).</div>
        </div>
        <div className="field">
          <label htmlFor="f-env">3D envelope thickness <b>×{params.envelopeScale.toFixed(1)}</b></label>
          <input id="f-env" type="range" min={1} max={5} step={0.5} value={params.envelopeScale} tabIndex={open ? 0 : -1}
            onChange={(e) => set({ envelopeScale: Number(e.target.value) })} />
          <div className="hint">Visual exaggeration of the steam envelope in the 3D view only (default ×3 so the inflation is easy to see; ×1 = model radius). The plot always shows model values.</div>
          <label className="check" style={{ marginTop: 10, justifyContent: 'flex-start' }}>
            <input type="checkbox" checked={params.noise} tabIndex={open ? 0 : -1} onChange={(e) => set({ noise: e.target.checked })} />
            Add radius noise (σ_R = {(model.sample.meta.sigma_R * 100).toFixed(0)} %)
          </label>
        </div>
      </div>
      <div className="science-foot">
        <span>
          {model.planets.length} planets · {nHot} hot ({nInfl} with steam envelope) · {model.planets.length - nHot} cold ·
          toy ln K = {signed(model.fit.lnK, 1)} ({v.label}) · best-fit S_thresh ≈ {Math.round(model.fit.best.S)} W m⁻²
        </span>
        <button className="btn" tabIndex={open ? 0 : -1} onClick={() => setParams({ ...defaultParams(data), sample: params.sample })}>Reset to fiducial</button>
      </div>
    </div>
  );
}
