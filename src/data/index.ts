// Data entry point.  The pipeline export is bundled at build time when it
// exists; otherwise the deterministic synthetic fallback is used.

import type { HziedData } from '../model/types';
import type { ErrorsData } from '../model/errors';
import { syntheticData } from './synthetic';

const exported = import.meta.glob<HziedData>('./hzied_data.json', { eager: true, import: 'default' });

export function loadData(): HziedData {
  const d = Object.values(exported)[0];
  if (d && d.samples?.length) return d;
  return syntheticData();
}

const errorsExport = import.meta.glob<ErrorsData>('./hzied_errors.json', { eager: true, import: 'default' });

/** Population + per-planet uncertainties for the measurement-error section (null if not exported). */
export function loadErrors(): ErrorsData | null {
  const d = Object.values(errorsExport)[0];
  return d && d.planets?.R?.length ? d : null;
}
