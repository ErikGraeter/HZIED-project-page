import { useMemo } from 'react';
import type { HziedData } from '../model/types';
import { computeModel, defaultParams, type ModelState } from '../model/compute';
import { inflationFactor } from '../model/inflation';
import { EvidenceVsN, InflationCurves, OlrSchematic, RadiusDistributions } from './Charts';
import { signed } from './format';
import { RvSection } from './rv/RvSection';

interface Props { data: HziedData; model: ModelState; reducedMotion: boolean }

function SectionHead({ num, title, lede, id }: { num: string; title: string; lede: string; id: string }) {
  return (
    <div className="section-head">
      <div className="section-num">{num}</div>
      <div>
        <h2 id={id}>{title}</h2>
        <p className="lede">{lede}</p>
      </div>
    </div>
  );
}

export function Sections({ data, model, reducedMotion }: Props) {
  const fid = { ...data.provenance.defaults, envelope: defaultParams(data).envelopeScale };
  const infl1 = 100 * (inflationFactor(1, fid.wrr, data.tables) - 1);
  const infl05 = 100 * (inflationFactor(0.5, fid.wrr, data.tables) - 1);
  const infl3 = 100 * (inflationFactor(3, fid.wrr, data.tables) - 1);
  const evCurves = useMemo(() => data.samples.map((s) => {
    const mm = computeModel(data, { ...defaultParams(data), sample: s.meta.key });
    const bySrc = mm.planets.reduce<Record<string, number>>((a, p) => { a[p.src] = (a[p.src] ?? 0) + 1; return a; }, {});
    return { label: `${s.meta.label.replace(' (P4 + P5)', '')} (${mm.planets.length})`, seq: mm.seq, fit: mm.fit, n: mm.planets.length, bySrc };
  }), [data]);
  const hot = model.planets.filter((p) => p.S_abs > model.params.S_thresh);
  const cold = model.planets.length - hot.length;
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(v.length, 1);
  const dRock = mean(hot.map((p) => p.R_orig));
  const dTr = mean(hot.map((p) => p.R));
  const prov = data.provenance;

  return (
    <main>
      {/* ── 1. Physics ───────────────────────────────────────────────────── */}
      <section className="section" aria-labelledby="physics">
        <SectionHead num="01 — PHYSICS" id="physics" title="Runaway greenhouse, inflated planets"
          lede="A rocky planet that absorbs more starlight than its water atmosphere can radiate away loses its oceans to a hot steam envelope — and looks bigger in transit." />
        <div className="cols">
          <div className="prose">
            <h3>A ceiling on cooling</h3>
            <p>Water vapour is a greenhouse gas whose abundance rises with temperature. On a planet with oceans, warming adds vapour, which traps more heat. Below a critical absorbed flux the planet still finds an equilibrium. But the thermal emission of a water-saturated atmosphere is capped: it levels off near <strong>≈ 280 W m⁻²</strong> almost independently of surface temperature (Nakajima et al. 1992; Goldblatt et al. 2013).</p>
            <p>A planet that absorbs more than that cannot balance its energy budget. The oceans evaporate completely, the surface heats beyond ~1500 K and can melt into a <strong>magma ocean</strong> beneath a thick steam atmosphere. This runaway greenhouse limit is the <strong>inner edge of the habitable zone</strong> (Kasting et al. 1993; Kopparapu et al. 2013).</p>
            <h3>Steam makes planets look larger</h3>
            <p>Once the whole water inventory is airborne, the atmosphere is hot and extended. In transit, a planet appears as large as the level at which its atmosphere becomes opaque to starlight — far above the rocky surface. Turbet et al. (2019, 2020) showed that this <strong>runaway greenhouse radius inflation</strong> makes water-rich planets measurably larger than temperate planets of the same mass.</p>
            <p>The thesis models the effect with AGNI radiative-transfer steam tables over a PALEOS rocky interior (Boer, Nicholls & Lichtenberg 2025) and the Dorn & Lichtenberg (2021) correction for water stored in the magma. For the fiducial water-to-rock ratio of {(fid.wrr * 100).toFixed(1)} %, the transit radius grows by <strong>{infl05.toFixed(1)}&nbsp;%</strong> at 0.5&nbsp;M⊕, <strong>{infl1.toFixed(1)}&nbsp;%</strong> at 1&nbsp;M⊕ and <strong>{infl3.toFixed(1)}&nbsp;%</strong> at 3&nbsp;M⊕.</p>
          </div>
          <div style={{ display: 'grid', gap: 18 }}>
            <OlrSchematic />
            <InflationCurves data={data} fiducial={fid.wrr} />
          </div>
        </div>
      </section>

      {/* ── 2. Statistical signature ─────────────────────────────────────── */}
      <section className="section" aria-labelledby="signature">
        <SectionHead num="02 — SIGNATURE" id="signature" title="From single planets to a population step"
          lede="A 5–15 % radius change is smaller than the natural spread of rocky planets. No single planet proves anything — but many planets do." />
        <div className="cols">
          <RadiusDistributions planets={model.planets} S_thresh={model.params.S_thresh} />
          <div className="prose">
            <p>Rocky planets of 0.5–5 M⊕ span roughly 0.8–1.7 R⊕ simply because their masses differ. At the fiducial water content a steam envelope adds only about 0.05–0.15 R⊕, so an inflated planet hides inside this spread. What changes is the <strong>distribution</strong>: on the hot side of the threshold a fraction <em>f</em><sub>rgh</sub> of the planets is lifted, so the mean radius jumps where the absorbed flux crosses the runaway limit.</p>
            <p>In the population shown above ({model.sample.meta.label}, {model.planets.length} planets), the hot-side mean rocky radius is <strong>{dRock.toFixed(3)} R⊕</strong>; with steam envelopes the same planets average <strong>{dTr.toFixed(3)} R⊕</strong>. The {cold} cold-side planets keep their rocky radii. Plotted against absorbed flux, this produces the step that Schlecker et al. (2024) called the <strong>Habitable Zone Inner Edge Discontinuity</strong>.</p>
            <p>Not every hot planet inflates — some formed dry or lost their water — and the step competes with selection effects and with any intrinsic radius–flux trend of the population. That is why the HZIED is a statistical test rather than a single measurement: a model with a step at the threshold has to beat a model without one, given the data.</p>
            <div className="stat-row">
              <div className="stat"><div className="k">Hot planets with steam</div><div className="v">{hot.filter((p) => p.steam).length}<small>/ {hot.length}</small></div></div>
              <div className="stat"><div className="k">Mean radius shift (hot)</div><div className="v">{signed(dTr - dRock, 3)}<small>R⊕</small></div></div>
              <div className="stat"><div className="k">Toy ln K</div><div className="v">{signed(model.fit.lnK, 1)}</div></div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 3. PLATO ─────────────────────────────────────────────────────── */}
      <section className="section" aria-labelledby="plato">
        <SectionHead num="03 — PLATO" id="plato" title="Testing the HZIED with PLATO"
          lede="ESA's PLATO mission will find small planets around bright stars, measure their radii to a few per cent and enable mass measurements — the sample this test needs." />
        <div className="cols">
          <div className="prose">
            <p><strong>PLATO</strong> (PLAnetary Transits and Oscillations of stars) monitors large fields of bright stars with 26 cameras for years at a time. Its long baselines reach small planets on temperate orbits, and bright hosts allow precise stellar parameters, ages from asteroseismology, and radial-velocity follow-up for masses (Rauer et al. 2014, 2016).</p>
            <p>The thesis replaces the artificial nearby-star population of Schlecker et al. (2024) with real stars from the <strong>PLATO Input Catalogue</strong> — the P4 M dwarfs and the P5 FGK dwarfs, analysed together — and asks how many planets PLATO must deliver before the HZIED is detected, or ruled out. In the most optimistic detection scenario on this page (5-yr mission, transits down to 60 ppm, 0.5–20 M⊕) the two samples together yield about {evCurves[1]?.n ?? 200} small planets.</p>
            <p>Because PLATO's sample grows during the mission, the analysis is <strong>sequential</strong>: the evidence is updated as planets arrive, and the cold side — temperate planets on long orbits, the hardest to find — is the bottleneck. The figure shows how a toy version of this evidence grows with sample size for both populations on this page.</p>
          </div>
          <EvidenceVsN curves={evCurves} />
        </div>
        <div className="cols" style={{ marginTop: 22 }}>
          {data.samples.map((s, k) => {
            const ev = evCurves[k];
            const sm = s.meta.summary_default;
            return (
              <div className="card" key={s.meta.key}>
                <h4>{s.meta.label}</h4>
                <p className="card-sub">{s.meta.description}</p>
                <div className="stat-row">
                  <div className="stat"><div className="k">Planets</div><div className="v">{sm.n_observable || ev.n}</div></div>
                  <div className="stat"><div className="k">Hot / cold</div><div className="v">{sm.n_hot}<small>/ {sm.n_cold}</small></div></div>
                  <div className="stat"><div className="k">Toy ln K</div><div className="v">{signed(ev.fit.lnK, 1)}</div></div>
                </div>
                <p className="card-sub" style={{ marginTop: 10, marginBottom: 0 }}>
                  {Object.keys(ev.bySrc).length > 1
                    ? `P5 FGK dwarfs: ${ev.bySrc.P5 ?? 0} planets · P4 M dwarfs: ${ev.bySrc.P4 ?? 0} planets · radius precision 3 % / 4 %.`
                    : `Radius precision ${(s.meta.sigma_R * 100).toFixed(0)} %.`}
                  {' '}Best-fit threshold {Math.round(ev.fit.best.S)} W m⁻² (68 %: {Math.round(ev.fit.sQ[0])}–{Math.round(ev.fit.sQ[2])}).
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── 4. RV follow-up → normalized density → required sample size ──── */}
      <RvSection data={data} reducedMotion={reducedMotion} />

      {/* ── 5. Methods ───────────────────────────────────────────────────── */}
      <section className="section" aria-labelledby="methods">
        <SectionHead num="05 — METHODS" id="methods" title="Research & methodology"
          lede="Population synthesis with Bioverse, a physical inflation model, realistic survey selection, and Bayesian hypothesis testing." />
        <div className="pipeline">
          <div className="pipe-step"><div className="n">01 · GENERATOR</div><h4>Stars → planets</h4><p>Host stars from Gaia (GCNS) or the PLATO Input Catalogue; planets from Bergsten et al. (2022) occurrence rates; masses and rocky radii from Zeng et al. (2016). <code>create_planets_bergsten</code></p></div>
          <div className="pipe-step"><div className="n">02 · PHYSICS</div><h4>Runaway inflation</h4><p>Planets with S_abs &gt; S_thresh are runaway candidates; a fraction f_rgh gets a steam envelope from the AGNI+PALEOS tables with the DL21 correction. <code>magma_ocean_agni_updated</code></p></div>
          <div className="pipe-step"><div className="n">03 · SURVEY</div><h4>Observable sample</h4><p>Transiting planets, transit depth ≥ 80 ppm, 0.5–5 M⊕, R &gt; 0.75 R⊕, three transits within the mission; PLATO radius precision. <code>_observable_cuts</code></p></div>
          <div className="pipe-step"><div className="n">04 · HYPOTHESIS</div><h4>Bayesian test</h4><p>The Schlecker et al. (2024) step model against a no-step null, compared with nested sampling (dynesty); sequential testing as the sample grows. <code>magma_ocean_hypo</code></p></div>
        </div>
        <div className="cols" style={{ marginTop: 26 }}>
          <div className="prose">
            <h3>What is real on this page</h3>
            <p>The planets are Bioverse output. A Python exporter runs the thesis pipeline's own inflation and selection functions on populations it generated and writes them to the website, together with the model tables. The browser re-implements the inflation step so the controls work live; a unit test checks it against the pipeline (identical planet sets, radii agree to better than 2 × 10⁻⁵).</p>
            <p>The Bayesian comparison on this page is a <strong>toy model</strong>, computed live from the planets you see: H0 has one mean radius; H1 is a step in mean radius at a free threshold, with S_thresh ~ U(10, 1000) W m⁻² as in the pipeline's H1, uniform priors on both means and a log-uniform intrinsic scatter. The evidence is integrated exactly and the 50 red lines are draws from this posterior, as in the thesis Fig. 5 — but it is not the thesis inference, which fits the Schlecker et al. (2024) step model with nested sampling.</p>
          </div>
          <div className="table-scroll">
            <table className="prov">
              <thead><tr><th>Element</th><th>Source</th></tr></thead>
              <tbody>
                <tr><td>Planet masses, rocky radii, absorbed flux, host stars</td><td><span className="tag real">model output</span> Bioverse populations ({data.samples.map((s) => s.meta.raw_parquet).join(', ')})</td></tr>
                <tr><td>Steam-inflated transit radii, inflated subset</td><td><span className="tag real">model output</span> pipeline inflation model and its seeded draws, verified in the browser port</td></tr>
                <tr><td>Survey arrival order, N subsample, radius noise</td><td><span className="tag toy">illustrative</span> seeded in the browser (seed {fid.seed})</td></tr>
                <tr><td>ln K, posterior draws, best fit, verdicts</td><td><span className="tag toy">toy model</span> computed live; not thesis results</td></tr>
                <tr><td>3D terrain, oceans, clouds, colours</td><td><span className="tag vis">visual</span> procedural; planets drawn to scale; the steam envelope is drawn ×{fid.envelope ?? 3} thicker by default (labelled), the plot shows model radii</td></tr>
                <tr><td>Outgoing-radiation figure</td><td><span className="tag vis">visual</span> schematic after Goldblatt et al. (2013)</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── References ───────────────────────────────────────────────────── */}
      <section className="section" aria-labelledby="refs">
        <SectionHead num="06 — REFERENCES" id="refs" title="References" lede="Key papers behind the model and the test." />
        <ul className="refs">
          <li className="key"><span className="au">Schlecker, M., Apai, D., Lichtenberg, T., et al. 2024</span>, <span className="ti">Bioverse: The Habitable Zone Inner Edge Discontinuity as an Imprint of Runaway Greenhouse Climates on Exoplanet Demographics</span>, PSJ 5, 3. <a href="https://doi.org/10.3847/PSJ/ad0d10">doi</a></li>
          <li className="key"><span className="au">Turbet, M., Ehrenreich, D., Lovis, C., Bolmont, E., Fauchez, T. 2019</span>, <span className="ti">The runaway greenhouse radius inflation effect</span>, A&A 628, A12. <a href="https://doi.org/10.1051/0004-6361/201935585">doi</a></li>
          <li className="key"><span className="au">Turbet, M., Bolmont, E., Ehrenreich, D., et al. 2020</span>, <span className="ti">Revised mass–radius relationships for water-rich rocky planets more irradiated than the runaway greenhouse limit</span>, A&A 638, A41. <a href="https://doi.org/10.1051/0004-6361/201937151">doi</a></li>
          <li><span className="au">Bixel, A., & Apai, D. 2021</span>, Bioverse simulation framework, AJ 161, 228.</li>
          <li><span className="au">Boer, P., Nicholls, H., & Lichtenberg, T. 2025</span>, <span className="ti">Steam atmospheres of rocky exoplanets from 2 to 20 Earth masses with AGNI radiative transfer over a PALEOS rocky interior</span>, ApJ 987, 172.</li>
          <li><span className="au">Dorn, C., & Lichtenberg, T. 2021</span>, <span className="ti">Hidden water in magma ocean exoplanets</span>, ApJL 922, L4. <a href="https://doi.org/10.3847/2041-8213/ac33af">doi</a></li>
          <li><span className="au">Bergsten, G. J., Pascucci, I., Mulders, G. D., et al. 2022</span>, <span className="ti">The demographics of Kepler's Earths and super-Earths into the habitable zone</span>, AJ 164, 190. <a href="https://doi.org/10.3847/1538-3881/ac8fea">doi</a></li>
          <li><span className="au">Zeng, L., Sasselov, D. D., & Jacobsen, S. B. 2016</span>, <span className="ti">Mass–radius relation for rocky planets based on PREM</span>, ApJ 819, 127. <a href="https://doi.org/10.3847/0004-637X/819/2/127">doi</a></li>
          <li><span className="au">Kopparapu, R. K., Ramirez, R., Kasting, J. F., et al. 2013</span>, <span className="ti">Habitable zones around main-sequence stars: new estimates</span>, ApJ 765, 131. <a href="https://doi.org/10.1088/0004-637X/765/2/131">doi</a></li>
          <li><span className="au">Kasting, J. F., Whitmire, D. P., & Reynolds, R. T. 1993</span>, <span className="ti">Habitable zones around main sequence stars</span>, Icarus 101, 108.</li>
          <li><span className="au">Goldblatt, C., Robinson, T. D., Zahnle, K. J., & Crisp, D. 2013</span>, <span className="ti">Low simulated radiation limit for runaway greenhouse climates</span>, Nature Geoscience 6, 661.</li>
          <li><span className="au">Nakajima, S., Hayashi, Y.-Y., & Abe, Y. 1992</span>, <span className="ti">A study on the "runaway greenhouse effect" with a one-dimensional radiative–convective equilibrium model</span>, J. Atmos. Sci. 49, 2256.</li>
          <li><span className="au">Rauer, H., Catala, C., Aerts, C., et al. 2014</span>, <span className="ti">The PLATO 2.0 mission</span>, Exp. Astron. 38, 249.</li>
          <li><span className="au">Rauer, H., Aerts, C., Cabrera, J., & the PLATO Team 2016</span>, <span className="ti">The PLATO mission</span>, Astron. Nachr. 337, 961. <a href="https://doi.org/10.1002/asna.201612408">doi</a></li>
          <li><span className="au">Gaia Collaboration, Smart, R. L., et al. 2021</span>, <span className="ti">Gaia Early Data Release 3: The Gaia Catalogue of Nearby Stars</span>, A&A 649, A6.</li>
          <li><span className="au">Pepe, F., Cristiani, S., Rebolo, R., et al. 2021</span>, <span className="ti">ESPRESSO at VLT: on-sky performance and first results</span>, A&A 645, A96.</li>
          <li><span className="au">Agol, E., Dorn, C., Grimm, S. L., et al. 2021</span>, <span className="ti">Refining the transit-timing and photometric analysis of TRAPPIST-1: masses, radii, densities, dynamics, and ephemerides</span>, PSJ 2, 1.</li>
          <li><span className="au">Lovis, C., & Fischer, D. A. 2010</span>, <span className="ti">Radial velocity techniques for exoplanets</span>, in Exoplanets, ed. S. Seager (Univ. of Arizona Press), 27.</li>
          <li><span className="au">Speagle, J. S. 2020</span>, <span className="ti">dynesty: a dynamic nested sampling package for estimating Bayesian posteriors and evidences</span>, MNRAS 493, 3132.</li>
        </ul>
      </section>

      <footer className="site-footer">
        <span>HZIED research homepage · data export {prov.export_date}{prov.repo_commit ? <> · pipeline commit <code>{prov.repo_commit}</code>{prov.repo_uncommitted_changes ? ' (with uncommitted changes)' : ''}</> : null}</span>
        <span>Fiducial: S_thresh = {fid.S_thresh} W m⁻² · wrr = {(fid.wrr * 100).toFixed(1)} % · f_rgh = {fid.f_rgh} · seed {fid.seed}</span>
      </footer>
    </main>
  );
}
