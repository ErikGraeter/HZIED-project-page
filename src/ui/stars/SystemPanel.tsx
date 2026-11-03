// Panel of the stellar view: the real host star and its three illustrative planets.

import type { StellarSystem } from '../../stars/system';
import { ENVELOPE_SCALE, KIND_COLORS, fmtAU } from '../../stars/SystemView';
import { pc } from './fmt';

export function SystemPanel({ sys, onBack }: { sys: StellarSystem; onBack: () => void }) {
  const days = (P: number) => (P < 100 ? `${P.toFixed(1)} d` : `${Math.round(P)} d`);
  return (
    <aside className="map-panel map-right sys-panel" aria-label={`Stellar view of PIC ${sys.pic}`}>
      <p className="map-kicker">Stellar view</p>
      <h2>PIC {sys.pic}</h2>
      <p className="sys-star">
        {sys.spt} · {Math.round(sys.teff)} K · {sys.mass.toFixed(2)} M☉ · {sys.lum < 0.1 ? sys.lum.toFixed(3) : sys.lum.toFixed(2)} L☉ · {pc(sys.d)} pc
      </p>
      <p className="sys-intro">
        The camera sits inside the sample at this star's catalogue position. Every other point is a star of the chosen samples where
        it appears from here; the Sun is labelled. Drag to look around.
      </p>

      <ul className="sys-planets">
        {sys.planets.map((p) => (
          <li key={p.kind}>
            <i className="sw" style={{ background: KIND_COLORS[p.kind] }} />
            <b>{p.label}</b>
            <span>S<sub>abs</sub> {p.S_abs} W m⁻² · {fmtAU(p.a)} · {days(p.P)}</span>
            <span>
              {p.M.toFixed(1)} M⊕ · R {p.R.toFixed(2)} R⊕
              {p.kind === 'steam' && <> (rock {p.R_orig.toFixed(2)}, +{(100 * (p.R / p.R_orig - 1)).toFixed(0)} %)</>}
            </span>
          </li>
        ))}
        <li className="thr">
          <i className="sw ring" />
          <b>Runaway threshold</b>
          <span>S<sub>abs</sub> = {sys.S_thresh} W m⁻² at {fmtAU(sys.aThresh)}; shaded inside</span>
        </li>
      </ul>

      <p className="st-foot">
        The star is real; the planets are illustrative. They sit at chosen absorbed fluxes, S<sub>abs</sub> = 238 W m⁻² · L/a²,
        with periods from Kepler's third law (animation sped up). Rocky radii follow the model's dry branch; the steam
        planet's transit radius comes from the AGNI steam table (wrr = {sys.wrr}). Orbits are to scale. The star (×8) and the
        planets are enlarged, and the envelope is drawn ×{ENVELOPE_SCALE} thicker.
      </p>
      <button className="btn" onClick={onBack}>Back to the map</button>
    </aside>
  );
}
