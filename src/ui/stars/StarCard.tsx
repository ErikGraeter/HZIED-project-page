// Card with the catalogue properties of the selected star.  Only values that
// exist in the export are listed; nothing is filled in.

import type { StarRecord } from '../../stars/catalog';
import { CLASS_COLORS, SAMPLE_COLORS } from '../../stars/StarMapView';
import { pc, pmSig } from './fmt';

const SAMPLE_LABEL = { P4: 'P4 · M dwarfs', P5: 'P5 · FGK dwarfs and subgiants' } as const;

export function StarCard({ s, onClose, onFocus }: { s: StarRecord; onClose: () => void; onFocus: () => void }) {
  const rows: [string, string][] = [
    ['Distance', `${s.e_d !== null ? pmSig(s.d, s.e_d, 0, 2) : pc(s.d)} pc`],
  ];
  if (s.plx !== null) rows.push(['Parallax', `${s.plx.toFixed(3)} mas`]);
  rows.push(['T_eff', `${pmSig(s.teff, s.e_teff, 0, 0)} K`]);
  rows.push(['Mass', `${pmSig(s.mass, s.e_mass, 2, 3)} M☉`]);
  rows.push(['Radius', `${pmSig(s.radius, s.e_rad, 2, 3)} R☉`]);
  rows.push(['Luminosity', `${s.lum < 0.1 ? s.lum.toFixed(4) : s.lum.toFixed(2)} L☉`]);
  if (s.vmag !== null) rows.push(['V', s.vmag.toFixed(2)]);
  if (s.pmag !== null) rows.push(['PLATO mag', s.pmag.toFixed(2)]);
  if (s.gmag !== null) rows.push(['Gaia G', s.gmag.toFixed(2)]);
  if (s.n_cam !== null) rows.push(['Cameras (BOL)', `${s.n_cam} of 24`]);
  if (s.age !== null) rows.push(['Age (FLAME)', `${s.age.toFixed(1)} Gyr`]);
  rows.push(['RA, Dec', `${s.ra.toFixed(4)}°, ${s.dec.toFixed(4)}°`]);
  rows.push(['l, b', `${s.l.toFixed(3)}°, ${s.b.toFixed(3)}°`]);
  const cls = s.spt[0] as keyof typeof CLASS_COLORS;
  return (
    <div className="star-card" role="dialog" aria-label={`PIC ${s.pic}`}>
      <div className="sc-head">
        <div>
          <div className="sc-name">PIC {s.pic}</div>
          {s.gaia && <div className="sc-id">Gaia DR3 {s.gaia}</div>}
        </div>
        <button className="btn icon sc-x" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="sc-tags">
        {s.sample.map((k) => <span key={k}><i className="sw" style={{ background: SAMPLE_COLORS[k] }} />{SAMPLE_LABEL[k]}</span>)}
        <span><i className="sw" style={{ background: CLASS_COLORS[cls] }} />{s.spt} <small>from T<sub>eff</sub></small></span>
      </div>
      <dl>
        {rows.map(([k, v]) => <div key={k}><dt>{k === 'T_eff' ? <>T<sub>eff</sub></> : k}</dt><dd>{v}</dd></div>)}
      </dl>
      <div className="sc-foot">
        <button className="btn" onClick={onFocus}>Centre view on star</button>
        <span>L from R and T<sub>eff</sub></span>
      </div>
    </div>
  );
}
