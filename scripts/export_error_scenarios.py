#!/usr/bin/env python3
"""
export_error_scenarios.py — Planets and per-planet measurement uncertainties
for the "Measurement errors" section of the website.

One fixed PLATO population (true values) is exported together with every
uncertainty the pipeline can assign to it.  The website draws the noise
realisations itself, so the same population can be "observed" many times.

Population (pipeline._load_population, nothing is written to the repository):
    samples P1 + P2 + P4 + P5, LOPS2, mission duration 2 yr, population seed 8 (GENERATOR_DEFAULTS; seed 42 is an atypical draw in which
    the R(P) gradient of the occurrence rates hides the step, see notebooks/hzied_ttest.ipynb),
    age_mode='sampled', AGNI (updated) inflation without DL21, wrr = 0.005,
    f_rgh = 1, S_thresh = 280 W m^-2, 0.5–5 M⊕, depth ≥ 50 ppm,
    non-grazing transits (pipeline default since 2026-11-17).

Per-planet uncertainties (fractions), all from src/measurement_uncertainties.py
and src/pipeline.py:
    sR_sample   σ_R/R per sample (SIGMA_R_SAMPLE: P1 1 %, P2 0.8 %, P4 4 %, P5 3 %)
    sR_opt      per-planet radius model 'optimistic'   (BOL noise, G = 1, σ_R★/R★ = 2 %)
    sR_nom      per-planet radius model 'nominal'      (BOL noise, G(k,b), σ_R★ from PIC)
    sR_cons     per-planet radius model 'conservative' (EOL noise, G(k,b), σ_R★/R★ = 2 %)
    sS_req      σ_S/S 'requirements'        (2 % R★, 1.5 % T_eff, 10 % M★ for every star)
    sS_pic      σ_S/S 'stellar_parameters'  (per-star PIC errors, independent)
    sM_rvopt    σ_M/M RV model 'optimistic'  (σ_RV = 0.5 m/s, N_RV = 1000)
    sM_rvpess   σ_M/M RV model 'pessimistic' (σ_RV = 1 m/s,   N_RV = 100)
Constant fractions (σ_R/R = 3 %, σ_S/S = 5 %, σ_M/M = 10 %) are applied in the browser.

Usage (in the bioverse-hzied conda environment):
    python scripts/export_error_scenarios.py --repo <path-to-HZIED-repository>
    → src/data/hzied_errors.json
"""

import argparse
import contextlib
import datetime as _dt
import io
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

WEBSITE_DIR = Path(__file__).resolve().parent.parent

SAMPLES        = ['P1', 'P2', 'P4', 'P5']
MISSION_YR     = 2.0
POP_SEED       = 8
AGE_MODE       = 'sampled'
S_THRESH       = 280.
WRR            = 0.005
F_RGH          = 1.0
INFLATION      = 'agni_updated'
USE_DL21       = False
M_MIN, M_MAX   = 0.5, 5.0
DEPTH_MIN_PPM  = 50


def _round(a, sig=5):
    a = np.asarray(a, dtype=float)
    out = []
    for v in a:
        out.append(None if not np.isfinite(v) else float(f'{v:.{sig}g}'))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--repo', required=True, type=Path, help='path to the HZIED repository')
    ap.add_argument('--pop-seed', type=int, default=POP_SEED, help='population seed (default 8)')
    ap.add_argument('--out', type=Path, default=WEBSITE_DIR / 'src' / 'data' / 'hzied_errors.json')
    args = ap.parse_args()
    repo = args.repo.resolve()
    pop_seed = args.pop_seed
    sys.path.insert(0, str(repo / 'src'))
    sys.path.insert(0, str(repo))

    import pipeline as pl
    from measurement_uncertainties import (
        SIGMA_R_SAMPLE, assign_instellation_uncertainty, assign_radius_uncertainty,
    )

    cols = {k: [] for k in ['sample', 'S_abs', 'R', 'R_orig', 'M', 'P', 'M_st', 'steam',
                            'sR_sample', 'sR_opt', 'sR_nom', 'sR_cons', 'sS_req', 'sS_pic',
                            'sM_rvopt', 'sM_rvpess']}
    counts = {}
    for s in SAMPLES:
        with contextlib.redirect_stdout(io.StringIO()):
            df, _, n_cold, n_hot = pl._load_population(
                s, S_THRESH, WRR, F_RGH, pop_seed, 500, INFLATION, USE_DL21, DEPTH_MIN_PPM, False,
                M_min=M_MIN, M_max=M_MAX, age_mode=AGE_MODE, mission_duration_yr=MISSION_YR,
                write_cache=False)
        counts[s] = dict(n=len(df), cold=int(n_cold), hot=int(n_hot))
        if df.empty:
            continue
        R = df['R'].values
        sr = {m: assign_radius_uncertainty(df, m, MISSION_YR)['sigma_R_abs'].values / R
              for m in ('optimistic', 'nominal', 'conservative')}
        keep = np.all([np.isfinite(v) for v in sr.values()], axis=0)   # N_tr = 0 → σ_R = ∞
        ss = {m: assign_instellation_uncertainty(df, m, MISSION_YR)['sigma_S_frac'].values
              for m in ('requirements', 'stellar_parameters')}
        sm = {m: pl._rv_sigma_M_frac(df, **pl.RV_SIGMA_M_MODELS[m]) for m in ('optimistic', 'pessimistic')}
        k = keep
        cols['sample'] += [s] * int(k.sum())
        cols['S_abs']  += _round(df['S_abs'].values[k])
        cols['R']      += _round(R[k])
        cols['R_orig'] += _round(df['R_orig'].values[k])
        cols['M']      += _round(df['M'].values[k])
        cols['P']      += _round(df['P'].values[k])
        cols['M_st']   += _round(df['M_st'].values[k])
        cols['steam']  += [int(v) for v in df['has_magmaocean'].values[k]]
        cols['sR_sample'] += [SIGMA_R_SAMPLE[s]] * int(k.sum())
        cols['sR_opt']  += _round(sr['optimistic'][k], 4)
        cols['sR_nom']  += _round(sr['nominal'][k], 4)
        cols['sR_cons'] += _round(sr['conservative'][k], 4)
        cols['sS_req']  += _round(ss['requirements'][k], 4)
        cols['sS_pic']  += _round(ss['stellar_parameters'][k], 4)
        cols['sM_rvopt']  += _round(sm['optimistic'][k], 4)
        cols['sM_rvpess'] += _round(sm['pessimistic'][k], 4)
        counts[s]['removed_no_transit'] = int((~k).sum())

    try:
        commit = subprocess.run(['git', '-C', str(repo), 'rev-parse', '--short', 'HEAD'],
                                capture_output=True, text=True, check=True).stdout.strip()
        dirty = bool(subprocess.run(['git', '-C', str(repo), 'status', '--porcelain'],
                                    capture_output=True, text=True).stdout.strip())
    except Exception:
        commit, dirty = None, None

    out = dict(
        schema=1,
        provenance=dict(
            generator='HZIED pipeline (_load_population, measurement_uncertainties) via scripts/export_error_scenarios.py',
            repo_commit=commit, repo_uncommitted_changes=dirty,
            export_date=_dt.date.today().isoformat(),
        ),
        config=dict(samples=SAMPLES, mission_duration_yr=MISSION_YR, population_seed=pop_seed,
                    age_mode=AGE_MODE, S_thresh=S_THRESH, wrr=WRR, f_rgh=F_RGH,
                    inflation=INFLATION, use_dl21=USE_DL21, M_min=M_MIN, M_max=M_MAX,
                    depth_min_ppm=DEPTH_MIN_PPM, exclude_grazing=True,
                    rv_models={k: v for k, v in pl.RV_SIGMA_M_MODELS.items()}),
        counts=counts,
        planets=cols,
    )
    args.out.write_text(json.dumps(out, separators=(',', ':')))
    n = len(cols['R'])
    print(f'wrote {args.out}  ({n} planets: ' + ', '.join(f'{s} {c["n"]}' for s, c in counts.items()) + ')')


if __name__ == '__main__':
    main()
