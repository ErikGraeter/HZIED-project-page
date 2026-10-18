import { useMemo, useState, useSyncExternalStore } from 'react';
import { loadData } from '../data';
import { computeModel, defaultParams } from '../model/compute';
import type { ModelParams } from '../model/types';
import { Hero } from './Hero';
import { Sections } from './Sections';
import { Starfield } from './Starfield';

const data = loadData();

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
  return (
    <>
      <div className="backdrop" aria-hidden="true" />
      <Starfield reducedMotion={reducedMotion} />
      <header className="site-header">
        <a className="brand" href="#top" style={{ color: 'var(--ink)', textDecoration: 'none' }}>
          <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="5.2" fill="#e86a30" />
            <circle cx="12" cy="12" r="8.4" fill="none" stroke="#f6ecde" strokeOpacity="0.55" strokeDasharray="2 2.4" />
            <path d="M12 1.5v21" stroke="#f6ecde" strokeOpacity="0.8" strokeDasharray="2 2" />
          </svg>
          HZIED
        </a>
        <nav className="nav" aria-label="Sections">
          <a href="#physics">Physics</a>
          <a href="#signature">Signature</a>
          <a href="#plato">PLATO</a>
          <a href="#rv">RV follow-up</a>
          <a href="#methods">Methods</a>
          <a href="#refs">References</a>
        </nav>
      </header>
      <Hero data={data} model={model} params={params} setParams={setParams} reducedMotion={reducedMotion} />
      <Sections data={data} model={model} reducedMotion={reducedMotion} />
    </>
  );
}
