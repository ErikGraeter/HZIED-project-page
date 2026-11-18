import { Suspense, lazy, useEffect, useMemo, useState, useSyncExternalStore, type MouseEvent } from 'react';
import { loadData } from '../data';
import { computeModel, defaultParams } from '../model/compute';
import type { ModelParams } from '../model/types';
import { Hero } from './Hero';
import { Sections } from './Sections';
import { Starfield } from './Starfield';

const data = loadData();
// the stellar-samples page (three.js scene + 7 MB catalogue) loads on first visit
const StarsPage = lazy(() => import('./stars/StarsPage'));

type Page = 'home' | 'samples';
const SAMPLES_HASH = '#samples';
const pageOf = (hash: string): Page => (hash.startsWith(SAMPLES_HASH) ? 'samples' : 'home');

const motionQuery = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
const subscribeMotion = (cb: () => void) => { motionQuery?.addEventListener('change', cb); return () => motionQuery?.removeEventListener('change', cb); };

export function App() {
  const reducedMotion = useSyncExternalStore(subscribeMotion, () => !!motionQuery?.matches, () => false);
  const [params, setParams] = useState<ModelParams>(() => {
    const p = defaultParams(data);
    const q = new URLSearchParams(window.location.search);
    const sample = q.get('sample');
    if (sample && data.samples.some((s) => s.meta.key === sample)) p.sample = sample;
    return p;
  });
  const model = useMemo(() => computeModel(data, params), [params]);
  // hash routing: #samples is the stellar-samples page, any other hash an anchor on Home
  const [page, setPage] = useState<Page>(() => pageOf(window.location.hash));
  useEffect(() => {
    const onHash = () => setPage(pageOf(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    const h = window.location.hash;
    if (page === 'samples') { window.scrollTo({ top: 0 }); document.title = 'PLATO stellar samples — HZIED'; return; }
    document.title = 'HZIED — Habitable Zone Inner Edge Discontinuity';
    // returning from the other page: jump to the requested section once Home is mounted
    const el = h.length > 1 ? document.getElementById(h.slice(1)) : null;
    if (el) requestAnimationFrame(() => el.scrollIntoView());
    else window.scrollTo({ top: 0 });
  }, [page]);
  const go = (p: Page) => (e: MouseEvent) => {
    e.preventDefault();
    if (p === page) { window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' }); return; }
    history.pushState(null, '', p === 'samples' ? SAMPLES_HASH : window.location.pathname + window.location.search);
    setPage(p);
  };
  return (
    <>
      <div className="backdrop" aria-hidden="true" />
      {page === 'home' && <Starfield reducedMotion={reducedMotion} />}
      <header className={`site-header page-${page}`}>
        <a className="brand" href="#top" onClick={go('home')}>
          <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="5.2" fill="#e86a30" />
            <circle cx="12" cy="12" r="8.4" fill="none" stroke="#f6ecde" strokeOpacity="0.55" strokeDasharray="2 2.4" />
            <path d="M12 1.5v21" stroke="#f6ecde" strokeOpacity="0.8" strokeDasharray="2 2" />
          </svg>
          HZIED
        </a>
        <nav className="tabs" aria-label="Pages">
          <a href="#top" aria-current={page === 'home' ? 'page' : undefined} onClick={go('home')}>Home</a>
          <a href={SAMPLES_HASH} aria-current={page === 'samples' ? 'page' : undefined} onClick={go('samples')}>PLATO stellar samples</a>
        </nav>
        {page === 'home' && (
          <nav className="nav" aria-label="Sections">
            <a href="#physics">Physics</a>
            <a href="#signature">Signature</a>
            <a href="#plato">PLATO</a>
            <a href="#rv">RV follow-up</a>
            <a href="#methods">Methods</a>
            <a href="#refs">References</a>
          </nav>
        )}
      </header>
      {page === 'home' ? (
        <>
          <Hero data={data} model={model} params={params} setParams={setParams} reducedMotion={reducedMotion} />
          <Sections data={data} model={model} reducedMotion={reducedMotion} />
        </>
      ) : (
        <Suspense fallback={<div className="map-loading page-loading" role="status"><p>Loading the star map</p></div>}>
          <StarsPage reducedMotion={reducedMotion} />
        </Suspense>
      )}
    </>
  );
}
