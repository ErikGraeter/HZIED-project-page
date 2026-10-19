// "PLATO stellar samples" page: an interactive 3D map of the real P4 and P5
// target stars around the Sun, with sample / class selection, live summary
// statistics and a per-star card.  Data: src/data/plato_stars.* (exported by
// scripts/export_plato_stars.py); scene: src/stars/StarMapView.ts.

import { useEffect, useMemo, useRef, useState } from 'react';
import { CLASSES, fetchCatalog, starRecord, type SpClass, type StarCatalog, type StarMeta } from '../../stars/catalog';
import { computeStats, type SampleSel, type Selection } from '../../stars/stats';
import { CLASS_COLORS, SAMPLE_COLORS, StarMapView, type ColorMode } from '../../stars/StarMapView';
import { StatsPanel } from './StatsPanel';
import { StarCard } from './StarCard';
import { int } from './fmt';

const metaFile = import.meta.glob<StarMeta>('../../data/plato_stars_meta.json', { eager: true, import: 'default' });
const binFile = import.meta.glob<string>('../../data/plato_stars.bin.gz', { eager: true, query: '?url', import: 'default' });
const META = Object.values(metaFile)[0];
const BIN_URL = Object.values(binFile)[0];

const CLASS_NAME: Record<SpClass, string> = { M: 'M dwarfs', K: 'K', G: 'G', F: 'F' };
const ALL: Record<SpClass, boolean> = { M: true, K: true, G: true, F: true };

export default function StarsPage({ reducedMotion }: { reducedMotion: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<StarMapView | null>(null);
  const [cat, setCat] = useState<StarCatalog | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Selection>({ sample: 'both', classes: ALL });
  const [mode, setMode] = useState<ColorMode>('sample');
  const [grid, setGrid] = useState(true);
  const [galaxy, setGalaxy] = useState(true);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const [picked, setPicked] = useState(-1);
  const [intro, setIntro] = useState(true);
  const still = useMemo(() => new URLSearchParams(window.location.search).get('still') === '1', []);
  const calm = reducedMotion || still;

  // ── load the catalogue ──
  useEffect(() => {
    if (!META || !BIN_URL) { setError('The stellar catalogue has not been exported (scripts/export_plato_stars.py).'); return; }
    let alive = true;
    fetchCatalog(BIN_URL, META, (f) => alive && setProgress(f))
      .then((c) => alive && setCat(c))
      .catch((e: Error) => alive && setError(`Could not load the stellar catalogue: ${e.message}`));
    return () => { alive = false; };
  }, []);

  // ── create the 3D view once the data are there ──
  const selRef = useRef(sel);
  selRef.current = sel;
  useEffect(() => {
    if (!cat || !canvasRef.current || !labelRef.current) return;
    let v: StarMapView;
    try {
      v = new StarMapView(canvasRef.current, labelRef.current, cat, {
        reducedMotion: calm,
        onHover: (i, x, y) => setHover(i >= 0 ? { i, x, y } : null),
        onSelect: (i) => setPicked(i),
      });
    } catch (e) {
      setError(`WebGL is not available in this browser (${(e as Error).message}).`);
      return;
    }
    viewRef.current = v;
    v.setSelection(selRef.current, { frame: false, intro: true });
    v.start();
    const stopIntro = () => setIntro(false);
    const t = window.setTimeout(stopIntro, calm ? 0 : 11000);
    canvasRef.current.addEventListener('pointerdown', stopIntro, { once: true });
    canvasRef.current.addEventListener('wheel', stopIntro, { once: true, passive: true });
    return () => { window.clearTimeout(t); v.dispose(); viewRef.current = null; };
  }, [cat, calm]);

  const prevSample = useRef<SampleSel>(sel.sample);
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const changed = prevSample.current !== sel.sample;
    prevSample.current = sel.sample;
    v.setSelection(sel, { frame: changed });
  }, [sel]);
  useEffect(() => { viewRef.current?.setColorMode(mode); }, [mode, cat]);
  useEffect(() => { viewRef.current?.setGrid(grid); }, [grid, cat]);
  useEffect(() => { viewRef.current?.setGalaxy(galaxy); }, [galaxy, cat]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { viewRef.current?.select(-1); setPicked(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const stats = useMemo(() => (cat ? computeStats(cat, sel) : null), [cat, sel]);
  const record = useMemo(() => (cat && picked >= 0 ? starRecord(cat, picked) : null), [cat, picked]);
  const hoverRec = useMemo(() => (cat && hover && hover.i !== picked ? starRecord(cat, hover.i) : null), [cat, hover, picked]);

  const setSample = (s: SampleSel) => setSel((p) => ({ ...p, sample: s }));
  const toggleClass = (k: SpClass) => setSel((p) => {
    const next = { ...p.classes, [k]: !p.classes[k] };
    return { ...p, classes: CLASSES.some((c) => next[c]) ? next : p.classes };
  });
  const onlyClass = (k: SpClass) => setSel((p) => ({ ...p, classes: { M: false, K: false, G: false, F: false, [k]: true } }));

  const m = META;
  return (
    <div className="samples-page">
      <section className="map-stage" aria-label="3D map of the PLATO P4 and P5 stellar samples">
        <div className="map-view">
          <canvas ref={canvasRef} className="map-canvas" />
          <div ref={labelRef} className="map-labels" aria-hidden="true" />

          {!cat && (
            <div className="map-loading" role="status">
              {error ? <p>{error}</p> : (
                <>
                  <p>Loading {m ? int(m.n) : ''} stars</p>
                  <div className="map-progress"><span style={{ transform: `scaleX(${progress || 0.04})` }} /></div>
                </>
              )}
            </div>
          )}
          {cat && error && <div className="map-loading" role="alert"><p>{error}</p></div>}

          {hoverRec && hover && (
            <div className="map-tip" style={{ transform: `translate(${hover.x + 14}px, ${hover.y - 10}px)` }}>
              <b>PIC {hoverRec.pic}</b>
              <span>{hoverRec.sample.join(' + ')} · {hoverRec.spt} · {hoverRec.d < 100 ? hoverRec.d.toFixed(1) : Math.round(hoverRec.d)} pc</span>
            </div>
          )}
        </div>

        <aside className="map-panel map-left">
          <p className="map-kicker">PLATO Input Catalogue · LOPS2 field</p>
          <h1>The P4 and P5 stellar samples</h1>
          <p className="map-intro">
            Each point is a catalogued target star, placed at its distance in Galactic coordinates
            with the Sun at the origin. P5 contains FGK dwarfs and subgiants down to V&nbsp;=&nbsp;13; P4 contains
            M&nbsp;dwarfs down to V&nbsp;=&nbsp;16. These stars host the simulated planets used in the thesis.
          </p>

          <div className="ctl">
            <span className="ctl-k">Sample</span>
            <div className="seg" role="group" aria-label="Sample">
              {(['P4', 'P5', 'both'] as SampleSel[]).map((s) => (
                <button key={s} aria-pressed={sel.sample === s} onClick={() => setSample(s)}>
                  {s !== 'both' && <i className="sw" style={{ background: SAMPLE_COLORS[s] }} />}
                  {s === 'both' ? 'Both' : s}
                </button>
              ))}
            </div>
          </div>

          <div className="ctl">
            <span className="ctl-k">Colour by</span>
            <div className="seg" role="group" aria-label="Colour by">
              <button aria-pressed={mode === 'sample'} onClick={() => setMode('sample')}>Sample</button>
              <button aria-pressed={mode === 'class'} onClick={() => setMode('class')}>Spectral class</button>
            </div>
          </div>

          <div className="ctl">
            <span className="ctl-k">Spectral class <small>from T<sub>eff</sub></small></span>
            <div className="cls-filter" role="group" aria-label="Spectral class filter">
              {[...CLASSES].reverse().map((k) => {
                const c = stats?.classCounts[k];
                const nk = c ? (sel.sample === 'P4' ? c.P4 : sel.sample === 'P5' ? c.P5 : c.P4 + c.P5) : 0;
                return (
                  <button key={k} className="cls" aria-pressed={sel.classes[k]} disabled={!nk && !sel.classes[k]}
                    onClick={() => toggleClass(k)} onDoubleClick={() => onlyClass(k)}
                    title={`${CLASS_NAME[k]} — click to toggle, double-click to show only this class`}>
                    <i className="sw" style={{ background: CLASS_COLORS[k] }} />
                    <b>{k}</b>
                    <span>{int(nk)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="ctl-row">
            <button className="btn" onClick={() => viewRef.current?.resetView()}>Reset view</button>
            <button className="btn" onClick={() => { setGalaxy(true); viewRef.current?.galaxyView(); }} title="Zoom out to the Milky Way context, seen from above">Milky Way view</button>
            <button className="btn" aria-pressed={galaxy} onClick={() => setGalaxy((g) => !g)}>{galaxy ? 'Hide Galactic disk' : 'Show Galactic disk'}</button>
            <label className="check"><input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> Reference grid</label>
          </div>
        </aside>

        {stats && <StatsPanel stats={stats} sel={sel} />}

        {record && <StarCard s={record} onClose={() => { viewRef.current?.select(-1); setPicked(-1); }}
          onFocus={() => viewRef.current?.focus(record.index)} />}

        <div className="map-legend">
          {mode === 'sample'
            ? (['P4', 'P5'] as const).map((k) => <span key={k}><i className="dot" style={{ background: SAMPLE_COLORS[k] }} />{k === 'P4' ? 'P4 · M dwarfs' : 'P5 · FGK dwarfs and subgiants'}</span>)
            : [...CLASSES].reverse().map((k) => <span key={k}><i className="dot" style={{ background: CLASS_COLORS[k] }} />{k}</span>)}
          <span><i className="dot sun" />Sun</span>
          <span className="note">Positions to scale · point size grows weakly with luminosity</span>
          <span className={`hint${intro && cat ? ' on' : ''}`}>Drag to rotate · scroll to zoom · right-drag to pan · click a star</span>
        </div>
      </section>

      <main>
        <section className="section map-notes" aria-labelledby="sample-data">
          <div className="section-head">
            <div className="section-num">Data &amp; method</div>
            <div>
              <h2 id="sample-data">Catalogue, coordinates and caveats</h2>
              <p className="lede">Every point is a catalogued star at its measured position, and none of them is simulated. The thesis places its simulated planets around these stars.</p>
            </div>
          </div>
          {m && <Notes m={m} />}
        </section>
      </main>
    </div>
  );
}

function Notes({ m }: { m: StarMeta }) {
  const P4 = m.samples.P4, P5 = m.samples.P5;
  const pct = (x?: number, d = 1) => (x === undefined ? '—' : `${(100 * x).toFixed(d)} %`);
  return (
    <div className="cols-3 notes">
      <div className="prose">
        <h3>Where the stars come from</h3>
        <p>The samples are taken from the PLATO Input Catalogue of targets (tPIC, version 2.2.0.1) for the first long-pointing field, LOPS2 (Montalto et al. 2026). Sample membership is the catalogue's own flag. On top of it, the stars pass the quality cuts that the HZIED pipeline applies before it draws planets:</p>
        <p><strong>P5</strong>: 3850–6550 K, M ≤ 1.5 M☉, R ≤ 2.5 R☉ — {int(P5.n)} of {int(P5.n_flagged)} flagged stars.<br />
          <strong>P4</strong>: 2300–4200 K, M ≤ 0.65 M☉, R ≤ 0.85 R☉ — {int(P4.n)} of {int(P4.n_flagged)} flagged stars.</p>
        <p>No star is flagged as both P4 and P5{m.n_in_both ? ` (except ${m.n_in_both}, drawn once)` : ''}. Masses, radii and temperatures are the catalogue values; luminosities are derived from them as in the pipeline, L = R²(T<sub>eff</sub>/5778 K)⁴.</p>
      </div>
      <div className="prose">
        <h3>How the positions are computed</h3>
        <p>RA, Dec and the tPIC distance are converted to heliocentric Cartesian coordinates in the Galactic frame: X towards the Galactic centre, Y in the direction of rotation, Z towards the north Galactic pole. The map's horizontal plane is the Galactic plane, and the rings mark 50 to 1000 pc from the Sun.</p>
        <p>The tPIC distances are based on Gaia DR3 parallaxes; the median ratio of distance to inverse parallax is {(P5.d_plx_ratio_median ?? NaN).toFixed(3)} (P5) and {(P4.d_plx_ratio_median ?? NaN).toFixed(3)} (P4). Median distance uncertainties are {pct(P5.rel_e_d_median)} and {pct(P4.rel_e_d_median)}, much smaller than the structure visible on the map.</p>
        <p>As a check, the computed Galactic longitudes and latitudes agree with the catalogue's own to better than 10⁻⁵ degrees for every star. Real structure shows up as well: the compact clump at about 410 pc, circled on the map, is the open cluster NGC 2516, with roughly five times the field density of sample stars within 1° of its centre at its distance.</p>
      </div>
      <div className="prose">
        <h3>Limits of the picture</h3>
        <p>The cone is the shape of one PLATO pointing, not of the solar neighbourhood: outside the field the sky is not empty, it is just not in these samples. Both cones end where the magnitude limits end. The most luminous P5 stars, F-type subgiants, stay brighter than V&nbsp;=&nbsp;13 out to {(P5.d_max / 1000).toFixed(1)} kpc, while even early M dwarfs drop below V&nbsp;=&nbsp;16 by about {Math.round(P4.d_max / 10) * 10} pc.</p>
        <p>The spectral classes are not measured. They are assigned from T<sub>eff</sub> using the Pecaut &amp; Mamajek (2013) dwarf sequence. With T<sub>eff</sub> uncertainties of about 200 K, a star near a class boundary (K/M at about 3850 K) could belong to either class. P5 contains subgiants, for which the dwarf class only labels the temperature.</p>
        <p>Point sizes and the glow are for readability. The faint background band follows the Galactic plane and brightens towards the Galactic centre, as the Milky Way does on the sky.</p>
        <p>The Galactic disk is context, not data. It is drawn as haze in the same Galactic frame as the stars: the Sun 8.15 kpc from the centre (Reid et al. 2019) and 21 pc above the midplane (Bennett &amp; Bovy 2019), four logarithmic spiral arms with a 12.8° pitch (Vallée 2008), the Local arm just outside the Sun, and a central bar. Arm positions are approximate to a few hundred parsecs; the button above hides the layer.</p>
      </div>
    </div>
  );
}
