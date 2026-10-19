// Number formatting for the stellar-samples page.

/** Integer with a thin space as thousands separator (13 102). */
export const int = (x: number | undefined | null) =>
  x === undefined || x === null || !Number.isFinite(x) ? '—' : Math.round(x).toLocaleString('en-US').replace(/,/g, ' ');

/** Value ± uncertainty with a shared number of decimals. */
export function pm(v: number, e: number | null, d: number): string {
  return e === null ? v.toFixed(d) : `${v.toFixed(d)} ± ${e.toFixed(d)}`;
}

/** Distance in pc with precision matched to its size. */
export const pc = (d: number) => (d < 10 ? d.toFixed(2) : d < 100 ? d.toFixed(1) : Math.round(d).toString());

/** Value ± uncertainty, with the uncertainty to two significant digits (at most `maxD` decimals). */
export function pmSig(v: number, e: number | null, minD = 0, maxD = 4): string {
  if (e === null || !(e > 0)) return v.toFixed(minD);
  const d = Math.min(maxD, Math.max(minD, 1 - Math.floor(Math.log10(e))));
  return `${v.toFixed(d)} ± ${e.toFixed(d)}`;
}
