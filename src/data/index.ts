// Data entry point.  The pipeline export is bundled at build time when it
// exists; otherwise the deterministic synthetic fallback is used.

import type { HziedData } from '../model/types';
import { syntheticData } from './synthetic';

const exported = import.meta.glob<HziedData>('./hzied_data.json', { eager: true, import: 'default' });

export function loadData(): HziedData {
  const d = Object.values(exported)[0];
  if (d && d.samples?.length) return d;
  return syntheticData();
}
