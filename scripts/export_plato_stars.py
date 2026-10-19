#!/usr/bin/env python3
"""
export_plato_stars.py — Export the PLATO P4 and P5 stellar samples for the
"PLATO stellar samples" page of the website.

Stars are read from the processed tPIC sample files that the HZIED pipeline
uses as its stellar input (``data/processed/plato_P4_stars.parquet`` and
``plato_P5_stars.parquet``, written by ``setup_PLATO_data/setup_plato_data.py``):
the tPIC LOPS2 stars flagged as P4 / P5 (bits 3 / 2 of tPICsourceFlagNCAM_BOL,
Montalto et al. 2026) after the pipeline's stellar quality cuts.  Nothing is
simulated here and nothing in the HZIED repository is written.

Positions
---------
Heliocentric Cartesian coordinates in the Galactic frame, from the catalogue's
ICRS RA/Dec and its ``distance`` column (pc), via astropy:

    X = d cos b cos l   (towards the Galactic centre)
    Y = d cos b sin l   (towards Galactic rotation, l = 90°)
    Z = d sin b         (towards the North Galactic Pole)

The Sun is the origin.  (The PIC's own Glon/Glat columns are used as a check.)

Optional enrichment
-------------------
If the raw tPIC FITS file is present in ``<repo>/data/plato/`` it is joined
on PICid to add the uncertainties (edistance, eTeff, eMass, eRadius), the
parallax and the Gaia DR3 identifier.  If ``data/processed/gaia_flame_ages_*``
exist, the Gaia DR3 FLAME ages are added (already merged into the sample
parquets by ``download_gaia_flame_ages.py``).

Spectral class
--------------
The tPIC has no spectral types.  A spectral subclass is assigned from T_eff
alone, as the nearest dwarf entry of the Pecaut & Mamajek (2013) table
shipped with Bioverse (``bioverse/Data/Pecaut2013.dat``).  This is a
temperature class, not a measured spectral type; luminosity class is not
determined (P5 contains subgiants).

Output
------
``src/data/plato_stars.bin.gz`` — gzip-compressed little-endian columns
(struct of arrays), layout described in
``src/data/plato_stars_meta.json``.

Usage
-----
    python3 scripts/export_plato_stars.py --repo <path-to-HZIED-repository>
"""

import argparse
import datetime as _dt
import gzip
import json
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd

WEBSITE_DIR = Path(__file__).resolve().parent.parent
SAMPLE_BIT  = {'P5': 4, 'P4': 8}            # tPICsourceFlagNCAM_BOL bitmask
PIC_FITS    = 'data/plato/LOPS2PICtarget2.2.0.1-t-fg-c-scv2.fits'
FITS_NULL   = -2147483648

# Column encoding: name → (dtype, scale).  Stored value = round(x / scale);
# integer columns use the dtype's maximum as the missing-value marker.
COLUMNS = {
    'x':      ('<f4', 1.0),      # pc, Galactic X
    'y':      ('<f4', 1.0),      # pc, Galactic Y
    'z':      ('<f4', 1.0),      # pc, Galactic Z
    'd':      ('<u2', 0.02),     # pc, catalogue distance
    'e_d':    ('<f4', 1.0),      # pc
    'plx':    ('<u2', 0.004),    # mas
    'teff':   ('<u2', 1.0),      # K
    'e_teff': ('<u2', 1.0),      # K
    'mass':   ('<u2', 1e-4),     # M_sun
    'e_mass': ('<u2', 1e-4),
    'radius': ('<u2', 1e-4),     # R_sun
    'e_rad':  ('<u2', 1e-4),
    'vmag':   ('<u2', 1e-3),     # V (tPIC VmagCalculated)
    'pmag':   ('<u2', 1e-3),     # PLATO N-CAM magnitude
    'gmag':   ('<u2', 1e-3),     # Gaia G
    'age':    ('<u2', 1e-3),     # Gyr, Gaia DR3 FLAME
    'n_cam':  ('u1', 1.0),       # normal cameras observing the star (BOL)
    'sample': ('u1', 1.0),       # 4 = P5, 8 = P4
    'spt':    ('u1', 1.0),       # index into meta['spt_labels']
    'pic_id': ('<f8', 1.0),      # PICid (< 2^53, exact in float64)
    'gaia_id': ('<i8', 1.0),     # Gaia DR3 source_id (BigInt64 in the browser)
}


def _git(repo, *args):
    try:
        return subprocess.check_output(['git', '-C', str(repo), *args], text=True,
                                       stderr=subprocess.DEVNULL).strip()
    except Exception:
        return None


def _encode(values, dtype, scale):
    """Quantize to the column dtype; NaN → dtype max (missing)."""
    dt = np.dtype(dtype)
    if dt.kind == 'f':
        return np.asarray(values, dtype=dt)
    if dt.kind == 'i' and dt.itemsize == 8:
        return np.asarray(values, dtype=dt)
    info = np.iinfo(dt)
    v = np.asarray(values, dtype=np.float64) / scale
    bad = ~np.isfinite(v)
    q = np.rint(np.where(bad, 0, v))
    if np.any((q < info.min) | (q >= info.max)):
        raise ValueError(f'value out of range for {dtype} at scale {scale}')
    out = q.astype(dt)
    out[bad] = info.max
    return out


def _read_pic(repo):
    """Raw tPIC columns needed for enrichment, indexed by PICid (or None)."""
    path = repo / PIC_FITS
    if not path.exists():
        return None
    from astropy.io import fits
    t = fits.open(path, memmap=True)[1].data
    cols = ['PICid', 'StarName', 'Plx', 'distance', 'edistance', 'eTeff', 'eMass', 'eRadius',
            'Glon', 'Glat', 'Gmag', 'tPICsourceFlagNCAM_BOL']
    df = pd.DataFrame({c: np.asarray(t[c]).astype(np.asarray(t[c]).dtype.newbyteorder('='))
                       if np.asarray(t[c]).dtype.kind != 'U' else np.asarray(t[c]) for c in cols})
    return df.set_index('PICid')


def _spt_table(repo):
    """Pecaut & Mamajek (2013) dwarf subclasses and T_eff, ascending in T_eff."""
    tab = np.genfromtxt(repo / 'bioverse' / 'Data' / 'Pecaut2013.dat', dtype=None,
                        encoding=None, names=True)
    order = np.argsort(tab['Teff'])
    return [str(s) for s in tab['SpT'][order]], np.asarray(tab['Teff'][order], dtype=float)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--repo', required=True, help='path to the HZIED repository root')
    ap.add_argument('--out-dir', default=str(WEBSITE_DIR / 'src' / 'data'))
    args = ap.parse_args()
    repo = Path(args.repo).resolve()
    out_dir = Path(args.out_dir)

    from astropy.coordinates import SkyCoord
    import astropy.units as u

    parts = []
    for key in ['P4', 'P5']:
        f_ages = repo / 'data' / 'processed' / f'gaia_flame_ages_{key.lower()}.parquet'
        f_main = repo / 'data' / 'processed' / f'plato_{key}_stars.parquet'
        df = pd.read_parquet(f_main)
        if f_ages.exists():
            ages = pd.read_parquet(f_ages)[['pic_id', 'source_id', 'age_flame']]
            df = df.drop(columns=[c for c in ['age_flame'] if c in df.columns]) \
                   .merge(ages, on='pic_id', how='left', validate='one_to_one')
        df['key'] = key
        bad = (df['plato_sample_flag'].astype(int) & SAMPLE_BIT[key]) == 0
        if bad.any():
            raise ValueError(f'{key}: {bad.sum()} stars without the {key} sample bit')
        parts.append(df)
        print(f'{key}: {len(df):,} stars from {f_main.relative_to(repo)}')
    stars = pd.concat(parts, ignore_index=True)

    # A star flagged as both P4 and P5 would appear once with both bits set.
    dup = stars['pic_id'].duplicated(keep=False)
    if dup.any():
        flags = stars.groupby('pic_id')['plato_sample_flag'].agg(lambda s: int(np.bitwise_or.reduce(s.astype(int))))
        stars = stars.drop_duplicates('pic_id').copy()
        stars['plato_sample_flag'] = stars['pic_id'].map(flags)
    n_both = int(dup.sum() // 2)
    sample_bits = (stars['plato_sample_flag'].astype(int) & (SAMPLE_BIT['P4'] | SAMPLE_BIT['P5'])).values

    # ── Heliocentric Galactic Cartesian positions ──────────────────────────
    c = SkyCoord(ra=stars['ra'].values * u.deg, dec=stars['dec'].values * u.deg,
                 distance=stars['d'].values.astype(float) * u.pc, frame='icrs')
    g = c.galactic
    xyz = g.cartesian.xyz.to_value(u.pc)
    l, b = g.l.deg, g.b.deg

    # ── Enrichment from the raw tPIC ──────────────────────────────────────
    pic = _read_pic(repo)
    checks = {}
    nan = np.full(len(stars), np.nan)
    e_d, plx, e_teff, e_mass, e_rad, gmag = nan.copy(), nan.copy(), nan.copy(), nan.copy(), nan.copy(), nan.copy()
    gaia = stars['source_id'].values.astype(np.int64) if 'source_id' in stars else np.zeros(len(stars), np.int64)
    if pic is not None:
        r = pic.reindex(stars['pic_id'].values)
        if r['distance'].isna().any():
            raise ValueError('stars missing from the tPIC FITS file')
        checks['max_abs_distance_diff_pc'] = float(np.max(np.abs(r['distance'].values - stars['d'].values)))
        dl = (r['Glon'].values - l + 180.) % 360. - 180.
        checks['max_abs_glon_diff_deg'] = float(np.max(np.abs(dl * np.cos(np.radians(b)))))
        checks['max_abs_glat_diff_deg'] = float(np.max(np.abs(r['Glat'].values - b)))
        fl = r['tPICsourceFlagNCAM_BOL'].replace(FITS_NULL, 0).astype(int).values
        checks['sample_bits_match_fits'] = bool(np.all((fl & 12) == sample_bits))
        e_d, plx = r['edistance'].to_numpy(float, copy=True), r['Plx'].to_numpy(float, copy=True)
        e_teff, e_mass, e_rad, gmag = (r[k].to_numpy(float, copy=True) for k in ('eTeff', 'eMass', 'eRadius', 'Gmag'))
        from_name = pd.to_numeric(r['StarName'].astype(str).str.replace('Gaia DR3 ', '', regex=False),
                                  errors='coerce')
        if 'source_id' in stars:
            checks['gaia_id_matches_flame_file'] = bool(np.all(from_name.values == gaia))
        else:
            gaia = from_name.fillna(0).astype(np.int64).values
        # the PIC uncertainties use FITS null sentinels / negatives for missing
        for a in (e_d, e_teff, e_mass, e_rad):
            a[(a <= 0) | (a > 1e6)] = np.nan
        print(f'joined raw tPIC: {checks}')
    else:
        print('raw tPIC FITS not found — exporting without uncertainties and parallaxes')

    # ── Temperature class (Pecaut & Mamajek 2013, nearest dwarf entry) ────
    spt_labels, spt_teff = _spt_table(repo)
    teff = stars['T_eff_st'].values
    mid = 0.5 * (spt_teff[1:] + spt_teff[:-1])
    spt_idx = np.searchsorted(mid, teff)
    used = np.unique(spt_idx)
    remap = {int(k): i for i, k in enumerate(used)}
    spt = np.array([remap[int(k)] for k in spt_idx], dtype=np.uint8)
    labels = [spt_labels[k] for k in used]
    label_teff = [float(spt_teff[k]) for k in used]

    age = stars['age_flame'].values.astype(float) if 'age_flame' in stars else nan.copy()
    values = {
        'x': xyz[0], 'y': xyz[1], 'z': xyz[2], 'd': stars['d'].values, 'e_d': e_d, 'plx': plx,
        'teff': teff, 'e_teff': e_teff, 'mass': stars['M_st'].values, 'e_mass': e_mass,
        'radius': stars['R_st'].values, 'e_rad': e_rad, 'vmag': stars['plato_v_mag'].values,
        'pmag': stars['plato_mag'].values, 'gmag': gmag, 'age': age,
        'n_cam': stars['plato_n_cam'].astype(float).fillna(0).values,
        'sample': sample_bits, 'spt': spt, 'pic_id': stars['pic_id'].values.astype(np.float64),
        'gaia_id': gaia,
    }
    if np.any(stars['pic_id'].values >= 2 ** 53):
        raise ValueError('PICid does not fit exactly into float64')

    # ── Pack columns, 8-byte aligned ───────────────────────────────────────
    blob, layout, off = bytearray(), {}, 0
    for name, (dtype, scale) in COLUMNS.items():
        arr = _encode(values[name], dtype, scale)
        pad = (-off) % 8
        blob += b'\0' * pad
        off += pad
        layout[name] = dict(offset=off, dtype=dtype.lstrip('<'), scale=scale)
        blob += arr.tobytes()
        off += arr.nbytes
    out_bin = out_dir / 'plato_stars.bin.gz'
    out_bin.write_bytes(gzip.compress(bytes(blob), compresslevel=9, mtime=0))

    # ── Metadata (small, bundled with the page code) ──────────────────────
    def summary(m, key):
        d = stars['d'].values[m]
        out = dict(n=int(m.sum()), d_median=float(np.median(d)), d_min=float(d.min()),
                   d_max=float(d.max()), teff_median=float(np.median(teff[m])))
        if pic is not None:
            # flagged in the tPIC before the pipeline's quality cuts
            fl = pic['tPICsourceFlagNCAM_BOL'].replace(FITS_NULL, 0).astype(int)
            out['n_flagged'] = int(((fl & SAMPLE_BIT[key]) != 0).sum())
            out['rel_e_d_median'] = float(np.nanmedian(e_d[m] / d))
            out['d_plx_ratio_median'] = float(np.nanmedian(d * plx[m] / 1000.))
        return out
    unit = xyz / np.linalg.norm(xyz, axis=0)
    centre = unit.mean(axis=1)
    centre /= np.linalg.norm(centre)
    meta = dict(
        n=int(len(stars)), layout=layout, raw_bytes=len(blob),
        samples={k: summary((sample_bits & bit) != 0, k) for k, bit in SAMPLE_BIT.items()},
        n_in_both=n_both,
        spt_labels=labels, spt_teff=label_teff,
        sample_centroid=dict(l=float(np.degrees(np.arctan2(centre[1], centre[0])) % 360.),
                             b=float(np.degrees(np.arcsin(centre[2])))),
        frame='Galactic, heliocentric; X → Galactic centre, Y → l = 90°, Z → NGP; pc',
        checks=checks,
        has_uncertainties=pic is not None,
        has_flame_ages=bool(np.isfinite(age).any()),
        provenance=dict(
            catalogue='PLATO Input Catalogue, targets (tPIC) for LOPS2, version 2.2.0.1 (Montalto et al. 2026)',
            files=[f'data/processed/plato_{k}_stars.parquet' for k in ['P4', 'P5']]
                  + ([PIC_FITS + ' (uncertainties, parallax, Gaia DR3 ID)'] if pic is not None else []),
            export_date=_dt.date.today().isoformat(),
            repo_commit=_git(repo, 'rev-parse', '--short', 'HEAD'),
            repo_data_uncommitted=bool(_git(repo, 'status', '--porcelain', '--',
                                            'data/processed/plato_P4_stars.parquet',
                                            'data/processed/plato_P5_stars.parquet')),
        ),
    )
    (out_dir / 'plato_stars_meta.json').write_text(json.dumps(meta, indent=1))
    print(f'wrote {out_bin.name}: {len(stars):,} stars, {len(blob)/1e6:.1f} MB raw, '
          f'{out_bin.stat().st_size/1e6:.1f} MB gzip')
    print(f'P4 ∩ P5: {n_both}; temperature classes: {labels[0]} … {labels[-1]}')


if __name__ == '__main__':
    main()
