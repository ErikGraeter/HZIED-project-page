#!/usr/bin/env python3
"""
export_hzied_data.py — Export Bioverse/HZIED pipeline outputs for the website.

The website never runs Python.  This script reads planet populations that the
HZIED analysis pipeline has already generated (raw, pre-cut parquets in
``outputs/catalogs/``), re-applies the pipeline's own inflation model and
observable cuts *by calling the pipeline functions themselves*, and writes a
compact, frontend-friendly JSON file.

Nothing in the HZIED repository is modified: no cache is written and no
pipeline code is changed.  The repository is only imported.

What is exported
----------------
For every sample (generic Bioverse fiducial, PLATO P5, PLATO P4):

* a *superset* of planets that can pass the observable cuts for any choice of
  (S_thresh, wrr, f_rgh) offered on the website — stellar host properties,
  mass M, rocky radius R_orig, absorbed flux S_abs, and the per-planet uniform
  random number ``u`` that ``magma_ocean_agni_updated`` draws to decide which
  runaway-greenhouse planets carry a steam envelope (``u < f_rgh``);
* the reference result of the pipeline for the default parameters (R and the
  observable-cut mask), used by the website's unit tests to verify that the
  TypeScript re-implementation reproduces the pipeline exactly.

Plus the model tables used by ``magma_ocean_agni_updated``: AGNI+PALEOS steam
table (all wrr), PALEOS dry branch, Dorn & Lichtenberg (2021) correction rows.

Usage
-----
    python3 scripts/export_hzied_data.py --repo <path-to-HZIED-repo>
        [--catalogs-dir <extra dir with raw parquets>] [--out <json>]

If a raw parquet is not found in any catalogs dir the Bioverse Generator is
run through ``pipeline._generate_population`` (in memory, nothing cached).
"""

import argparse
import datetime as _dt
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd

WEBSITE_DIR = Path(__file__).resolve().parent.parent

# ── Export configuration ──────────────────────────────────────────────────────
# Shared injection parameters (Schlecker+2024 fiducial; PAPER_FIDUCIAL in src/constants.py)
S_THRESH_DEFAULT = 280.
WRR_DEFAULT      = 0.005
F_RGH_DEFAULT    = 0.8
SEED             = 8
INFLATION        = 'agni_updated'
USE_DL21         = True
M_MIN, M_MAX     = 0.5, 5.0
DEPTH_MIN_PPM    = 80
WRR_GRID         = [1e-4, 1e-3, 5e-3, 1e-2, 2e-2, 3e-2, 4e-2, 5e-2]

# Per-sample radius precision (pipeline _SIGMA_R)
SIGMA_R = {'generic': 0.02, 'P4': 0.04, 'P5': 0.03}

# Each entry: one or more pipeline samples (concatenated, each with its own
# seeded inflation draws, as in a multi-sample run) and the observable cuts.
SAMPLES = [
    dict(key='artificial', label='Artificial population', short='Artificial',
         description=('Simulated planets around nearby stars from the Gaia Catalogue of '
                      'Nearby Stars with Bergsten+2022 occurrence rates — the setup of '
                      'Schlecker et al. (2024). 0.5–5 M⊕, transit depth ≥ 80 ppm.'),
         parts=['generic'], mission_duration_yr=None, M_max=5.0, depth_min_ppm=80),
    dict(key='plato', label='PLATO targets (P4 + P5)', short='PLATO',
         description=('Simulated planets around real PLATO Input Catalogue stars: P4 M '
                      'dwarfs and P5 FGK dwarfs combined. Optimistic detection scenario: '
                      '5-yr mission, transit depth ≥ 60 ppm, 0.5–20 M⊕.'),
         parts=['P5', 'P4'], mission_duration_yr=5.0, M_max=20.0, depth_min_ppm=60),
]
ID_OFFSET = {'generic': 0, 'P5': 0, 'P4': 10_000_000}


def _git(repo, *args):
    try:
        return subprocess.check_output(['git', '-C', str(repo), *args],
                                       stderr=subprocess.DEVNULL, text=True).strip()
    except Exception:
        return None


def _round(a, sig=5):
    """Round an array to `sig` significant digits (keeps the JSON compact)."""
    a = np.asarray(a, dtype=float)
    out = np.zeros_like(a)
    nz = a != 0
    mag = np.floor(np.log10(np.abs(a[nz])))
    out[nz] = np.round(a[nz] / 10 ** mag * 10 ** (sig - 1)) / 10 ** (sig - 1) * 10 ** mag
    return [float(f'{x:.{sig}g}') for x in out]


def _find_raw(pipeline, sample, cfg, catalog_dirs):
    """Locate the raw (pre-cut) parquet the pipeline would use for this sample."""
    kw = {}
    if cfg['mission_duration_yr'] is not None and sample != 'generic':
        kw['mission_duration_yr'] = cfg['mission_duration_yr']
    canonical = pipeline._raw_pop_path(sample, S_THRESH_DEFAULT, SEED, **kw)
    for d in catalog_dirs:
        p = Path(d) / canonical.name
        if p.exists():
            return pd.read_parquet(p), str(p.name), str(d)
    print(f'[export] {canonical.name} not found — running the Bioverse Generator')
    gkw = dict(kw)
    df = pipeline._generate_population(sample, S_THRESH_DEFAULT, WRR_DEFAULT,
                                       F_RGH_DEFAULT, SEED, **gkw)
    return df, canonical.name + ' (regenerated in memory)', None


def _export_part(pipeline, sample, cfg, catalog_dirs, f_ratio_max):
    """Superset + reference result for one pipeline sample under cfg's cuts."""
    df_raw, raw_name, _ = _find_raw(pipeline, sample, cfg, catalog_dirs)
    df_raw = df_raw.reset_index(drop=True)
    n_raw = len(df_raw)
    M_max, depth_min = cfg['M_max'], cfg['depth_min_ppm'] * 1e-6

    # Reference: pipeline result at the default parameters
    df_ref = pipeline._reapply_inflation(df_raw, INFLATION, S_THRESH_DEFAULT,
                                         WRR_DEFAULT, F_RGH_DEFAULT, SEED, USE_DL21)
    obs_ref = pipeline._observable_cuts(df_ref, M_min=M_MIN, M_max=M_max, depth_min=depth_min)

    # Per-planet uniform draw used by magma_ocean_agni_updated: _reapply_inflation
    # seeds the global RNG and the inflation step's first random call is
    # np.random.uniform(0, 1, len(M)) over the full raw table.
    np.random.seed(SEED)
    u = np.random.uniform(0., 1., n_raw)
    hmo_check = (df_ref['S_abs'].values > S_THRESH_DEFAULT) & (u < F_RGH_DEFAULT)
    assert np.array_equal(hmo_check, df_ref['has_magmaocean'].values.astype(bool)), \
        'per-planet uniform draws do not reproduce has_magmaocean'

    # Superset: planets that can pass the cuts for any website setting
    M      = df_raw['M'].values
    R_orig = df_raw['R_orig'].values
    S_abs  = df_raw['S_abs'].values
    depth0 = (R_orig / (df_raw['R_st'].values * 109.2)) ** 2
    fmax   = np.maximum(1.0, f_ratio_max(M))
    keep = (
        (M >= M_MIN) & (M <= M_max)
        & (S_abs >= 10.) & (S_abs <= 2000.)
        & df_raw['transiting'].values.astype(bool)
        & (R_orig * fmax > 0.75)
        & (depth0 * fmax ** 2 >= depth_min)
    )
    assert set(obs_ref.index) <= set(np.where(keep)[0]), 'superset misses reference planets'
    sub = df_raw[keep]
    idx = np.where(keep)[0]
    spt = sub['SpT'].astype(str).values if 'SpT' in sub else np.array(['?'] * len(sub))
    cols = dict(
        id=[int(i) + ID_OFFSET[sample] for i in idx],
        M=sub['M'].values, R_orig=sub['R_orig'].values, S_abs=sub['S_abs'].values,
        R_st=sub['R_st'].values, u=u[keep], P=sub['P'].values, a=sub['a'].values,
        T_eff_st=sub['T_eff_st'].values, M_st=sub['M_st'].values, d=sub['d'].values,
        SpT=[str(x) for x in spt], src=[sample] * int(keep.sum()),
        sR=[SIGMA_R[sample]] * int(keep.sum()),
    )
    validation = dict(
        id=cols['id'],
        R_pipeline=[float(x) for x in df_ref['R'].values[keep]],
        pass_cuts=[bool(x) for x in np.isin(idx, obs_ref.index)],
    )
    return cols, validation, obs_ref, raw_name, n_raw


def export_sample(pipeline, cfg, catalog_dirs, f_ratio_max):
    parts = [_export_part(pipeline, smp, cfg, catalog_dirs, f_ratio_max) for smp in cfg['parts']]
    cat = lambda key: [x for p in parts for x in list(p[0][key])]
    planets = {
        'id': cat('id'),
        'M': _round(cat('M'), 5), 'R_orig': _round(cat('R_orig'), 6),
        'S_abs': _round(cat('S_abs'), 6), 'R_st': _round(cat('R_st'), 6),
        'u': _round(cat('u'), 7), 'P': _round(cat('P'), 4), 'a': _round(cat('a'), 4),
        'T_eff_st': _round(cat('T_eff_st'), 4), 'M_st': _round(cat('M_st'), 3),
        'd': _round(cat('d'), 3), 'SpT': cat('SpT'),
    }
    if len(cfg['parts']) > 1:
        planets['src'] = cat('src')
        planets['sR'] = cat('sR')
    validation = {k: [x for p in parts for x in p[1][k]] for k in ('id', 'R_pipeline', 'pass_cuts')}
    obs_ref = pd.concat([p[2] for p in parts], ignore_index=True)
    hot = obs_ref['S_abs'] > S_THRESH_DEFAULT
    summary = dict(
        n_observable=int(len(obs_ref)), n_hot=int(hot.sum()), n_cold=int((~hot).sum()),
        n_inflated=int(obs_ref['has_magmaocean'].sum()),
        mean_R_hot=float(obs_ref['R'][hot].mean()) if hot.any() else None,
        mean_R_cold=float(obs_ref['R'][~hot].mean()) if (~hot).any() else None,
        mean_R_orig_hot=float(obs_ref['R_orig'][hot].mean()) if hot.any() else None,
        mean_R_orig_cold=float(obs_ref['R_orig'][~hot].mean()) if (~hot).any() else None,
    )
    meta = {k: cfg[k] for k in ('key', 'label', 'short', 'description', 'mission_duration_yr')}
    meta.update(
        sigma_R=float(np.mean([SIGMA_R[p] for p in cfg['parts']])),
        parts=cfg['parts'],
        raw_parquet=', '.join(p[3] for p in parts),
        n_raw=int(sum(p[4] for p in parts)),
        n_superset=len(planets['id']),
        cuts=dict(M_min=M_MIN, M_max=cfg['M_max'], R_min=0.75, S_min=10., S_max=2000.,
                  depth_min_ppm=cfg['depth_min_ppm'], transiting=True),
        summary_default=summary,
    )
    print(f'[export] {cfg["key"]:8s} superset={len(planets["id"]):,}  '
          f'observable(default)={len(obs_ref):,}  hot={summary["n_hot"]}  cold={summary["n_cold"]}')
    return dict(meta=meta, planets=planets), validation


# ── RV follow-up section: P5 realizations for the normalized-density test ─────
# Cuts as in the WP2 density studies (notebooks/wp2_stat_power.ipynb BASE_KW):
# 5-yr mission, transit depth ≥ 60 ppm, 0.5–5 M⊕; P5 radius precision 3 %.
RV_SAMPLE = 'P5'
RV_DURATION = 5.0
RV_M_MAX = 5.0
RV_DEPTH_PPM = 60
RV_SEEDS = (8, 13, 42, 100, 101, 102, 103, 104, 105, 106, 107)
RV_SEED_PRIMARY = 8
# The generator's rocky baseline is Zeng+2016 pure MgSiO3 (assign_mass), so the
# matching reference relation puts bare rocky planets at rho_norm = 1.
RV_REFERENCE_DEFAULT = 'mgsio3'
RV_REFERENCES = {'mgsio3': 'Pure rock, MgSiO₃ (Zeng+2016)', 'fe20_sil80': '20 % Fe / 80 % silicate',
                 'earthlike': 'Earth-like, 32.5 % Fe (Zeng+2016)'}


def export_rv_block(pipeline, catalog_dirs):
    """P5 planets of several independent population realizations (seeds)."""
    from mr_reference import get_reference_curve, rho_ref_for_planets
    from scipy import stats

    cfg = dict(mission_duration_yr=RV_DURATION)
    cols = {k: [] for k in ('M', 'R', 'R_orig', 'S_abs', 'P', 'M_st', 'T_eff_st', 'steam', 'seed')}
    per_seed = {}
    for seed in RV_SEEDS:
        kw = dict(mission_duration_yr=RV_DURATION)
        canonical = pipeline._raw_pop_path(RV_SAMPLE, S_THRESH_DEFAULT, seed, **kw)
        df_raw = None
        for d in catalog_dirs:
            pth = Path(d) / canonical.name
            if pth.exists():
                df_raw = pd.read_parquet(pth)
                break
        if df_raw is None:
            print(f'[export] {canonical.name} not found — running the Bioverse Generator')
            df_raw = pipeline._generate_population(RV_SAMPLE, S_THRESH_DEFAULT, WRR_DEFAULT,
                                                   F_RGH_DEFAULT, seed, **kw)
        df_raw = df_raw.reset_index(drop=True)
        ref = pipeline._reapply_inflation(df_raw, INFLATION, S_THRESH_DEFAULT, WRR_DEFAULT,
                                          F_RGH_DEFAULT, seed, USE_DL21)
        obs = pipeline._observable_cuts(ref, M_min=M_MIN, M_max=RV_M_MAX,
                                        depth_min=RV_DEPTH_PPM * 1e-6)
        per_seed[seed] = obs
        for k, v in (('M', obs['M']), ('R', obs['R']), ('R_orig', obs['R_orig']),
                     ('S_abs', obs['S_abs']), ('P', obs['P']), ('M_st', obs['M_st']),
                     ('T_eff_st', obs['T_eff_st'])):
            cols[k] += list(v.values)
        cols['steam'] += [bool(x) for x in (obs['has_magmaocean'].values & (obs['R'].values > obs['R_orig'].values))]
        cols['seed'] += [int(seed)] * len(obs)
        print(f'[export] rv  P5 seed {seed:3d}: {len(obs)} planets '
              f'({int((obs.S_abs > S_THRESH_DEFAULT).sum())} hot / {int((obs.S_abs <= S_THRESH_DEFAULT).sum())} cold)')

    curves = {}
    for comp, label in RV_REFERENCES.items():
        cM, cR = get_reference_curve(comp)
        curves[comp] = dict(M=_round(cM, 7), R=_round(cR, 7), label=label)
    planets = {k: (_round(v, 6) if k not in ('steam', 'seed') else v) for k, v in cols.items()}

    # ── validation against the pipeline's own functions (primary seed) ───────
    obs = per_seed[RV_SEED_PRIMARY].reset_index(drop=True)
    M_ref, R_ref, rho_ref = rho_ref_for_planets(obs['M'].values, obs['R'].values, RV_REFERENCE_DEFAULT)
    sig_pess = pipeline._rv_sigma_M_frac(obs, 1.0, 100, eccentricity=0.0)
    rng = np.random.default_rng(12345)
    zM = rng.normal(size=len(obs))
    zR = rng.normal(size=len(obs))
    M_obs = np.clip(obs['M'].values * (1 + 0.10 * zM), M_MIN, None)
    R_obs = obs['R'].values * (1 + 0.03 * zR)
    _, _, rho_ref_obs = rho_ref_for_planets(M_obs, R_obs, RV_REFERENCE_DEFAULT)
    rho_norm_obs = (5.513 * M_obs / R_obs ** 3) / rho_ref_obs
    keep = M_obs <= RV_M_MAX
    hot = obs['S_abs'].values > S_THRESH_DEFAULT
    tt = stats.ttest_ind(rho_norm_obs[keep & ~hot], rho_norm_obs[keep & hot],
                         equal_var=False, alternative='greater')
    validation = dict(
        seed=RV_SEED_PRIMARY, composition=RV_REFERENCE_DEFAULT, M_ref=[float(x) for x in M_ref], R_ref=[float(x) for x in R_ref],
        rho_ref=[float(x) for x in rho_ref], sigma_M_frac_pess=[float(x) for x in sig_pess],
        zM=[float(x) for x in zM], zR=[float(x) for x in zR],
        rho_norm_obs=[float(x) for x in rho_norm_obs], keep=[bool(x) for x in keep],
        t=float(tt.statistic), p=float(tt.pvalue),
    )
    block = dict(
        sample=RV_SAMPLE, mission_duration_yr=RV_DURATION, M_min=M_MIN, M_max=RV_M_MAX,
        depth_min_ppm=RV_DEPTH_PPM, sigma_R=SIGMA_R[RV_SAMPLE], seeds=list(RV_SEEDS),
        primary_seed=RV_SEED_PRIMARY, S_thresh=S_THRESH_DEFAULT,
        rho_earth=5.513, k_prefactor_mps=float(pipeline.RV_K_PREFACTOR_MPS),
        defaults=dict(optimistic_sigma_M_frac=0.10, sigma_RV_mps=1.0, N_RV=100, e=0.0),
        curves=curves, reference_default=RV_REFERENCE_DEFAULT,
        planets=planets,
    )
    return block, validation


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--repo', required=True, help='path to the HZIED repository root')
    ap.add_argument('--catalogs-dir', action='append', default=[],
                    help='additional directory with raw population parquets (repeatable)')
    ap.add_argument('--out', default=str(WEBSITE_DIR / 'src' / 'data' / 'hzied_data.json'))
    ap.add_argument('--validation-out',
                    default=str(WEBSITE_DIR / 'src' / 'data' / 'hzied_validation.json'))
    args = ap.parse_args()

    repo = Path(args.repo).expanduser().resolve()
    sys.path.insert(0, str(repo / 'src'))
    sys.path.insert(0, str(repo))
    import pipeline                         # noqa: E402  (HZIED src/pipeline.py)
    from constants import CATALOGS_DIR      # noqa: E402
    from scipy.interpolate import interp1d  # noqa: E402

    data_dir = repo / 'bioverse' / 'Data'
    steam = pd.read_csv(data_dir / 'steam_table_AGNI_bioverse_grid.dat', comment='#')
    dry   = pd.read_csv(data_dir / 'rocky_dry_branch_PALEOS_bioverse_grid.dat', comment='#')
    dl21  = pd.read_csv(data_dir / 'deltaR_DornLichtenberg21_Fig3b.csv', comment='#')

    # ── Model tables, exactly as magma_ocean_agni_updated reads them ─────────
    dry_mass = dry['mass'].values
    tables = dict(
        dry=dict(mass=_round(dry_mass, 6), radius=_round(dry['radius'], 7)),
        steam={}, dl21={},
        dl21_mass=[float(m) for m in dl21.columns[1:]],
    )
    ratios = []
    for w in WRR_GRID:
        sel = steam[np.isclose(steam['wrr'], w, rtol=1e-3)].sort_values('mass')
        tables['steam'][f'{w:g}'] = dict(mass=_round(sel['mass'], 6),
                                          radius=_round(sel['radius'], 7))
        best = int((dl21['wrr'] - w).abs().argsort().iloc[0])
        row  = dl21.iloc[best, 1:]
        tables['dl21'][f'{w:g}'] = [float(x) for x in row.values]
        f_st = interp1d(sel['mass'].values, sel['radius'].values, fill_value='extrapolate')
        f_dr = interp1d(dry_mass, dry['radius'].values, fill_value='extrapolate')
        f_dl = interp1d(row.index.to_numpy(dtype=float), row.values,
                        bounds_error=False, fill_value=0.0)
        ratios.append((f_st, f_dr, f_dl))

    def f_ratio_max(M):
        M = np.asarray(M, dtype=float)
        out = np.ones_like(M)
        for f_st, f_dr, f_dl in ratios:
            out = np.maximum(out, f_st(M) / f_dr(M) * (1. + f_dl(M)))
        return out

    catalog_dirs = [str(CATALOGS_DIR)] + args.catalogs_dir
    samples, validation = [], {}
    for cfg in SAMPLES:
        s, v = export_sample(pipeline, cfg, catalog_dirs, f_ratio_max)
        samples.append(s)
        validation[cfg['key']] = v

    rv_block, rv_validation = export_rv_block(pipeline, catalog_dirs)
    validation['rv'] = rv_validation

    commit = _git(repo, 'rev-parse', '--short', 'HEAD')
    dirty  = bool(_git(repo, 'status', '--porcelain', '--', 'src', 'bioverse'))
    out = dict(
        schema=1,
        provenance=dict(
            generator='HZIED pipeline (src/pipeline.py) via scripts/export_hzied_data.py',
            repo_commit=commit, repo_uncommitted_changes=dirty,
            export_date=_dt.date.today().isoformat(),
            inflation_model=('magma_ocean_agni_updated: R = R_orig x R_steam/R_dry (AGNI+PALEOS, '
                             'Boer, Nicholls & Lichtenberg 2025) x (1 + dR_DL21) '
                             '(Dorn & Lichtenberg 2021)'),
            observable_cuts=dict(M_min=M_MIN, M_max=M_MAX, R_min=0.75, S_min=10., S_max=2000.,
                                 depth_min_ppm=DEPTH_MIN_PPM, transiting=True),
            observable_cuts_note='defaults; each sample carries its own cuts in meta.cuts',
            defaults=dict(S_thresh=S_THRESH_DEFAULT, wrr=WRR_DEFAULT, f_rgh=F_RGH_DEFAULT,
                          seed=SEED, use_dl21=USE_DL21),
            wrr_grid=WRR_GRID,
        ),
        tables=tables,
        samples=samples,
        rv=rv_block,
    )
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, 'w') as fh:
        json.dump(out, fh, separators=(',', ':'), ensure_ascii=False)
    with open(args.validation_out, 'w') as fh:
        json.dump(dict(defaults=out['provenance']['defaults'], samples=validation), fh,
                  separators=(',', ':'))
    print(f'[export] wrote {args.out} ({Path(args.out).stat().st_size / 1e6:.2f} MB)')
    print(f'[export] wrote {args.validation_out}')


if __name__ == '__main__':
    main()
