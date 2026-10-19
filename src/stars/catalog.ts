// PLATO P4/P5 stellar catalogue: decoding of the exported binary columns
// (scripts/export_plato_stars.py), coordinate helpers and per-star records.
// Pure functions — no DOM, so the unit tests can run them in Node.

export type Dtype = 'f4' | 'f8' | 'i2' | 'i8' | 'u1' | 'u2';
export interface Column { offset: number; dtype: Dtype; scale: number }

export interface SampleSummary {
  n: number; d_median: number; d_min: number; d_max: number; teff_median: number;
  /** Only when the raw tPIC was available to the exporter. */
  n_flagged?: number; rel_e_d_median?: number; d_plx_ratio_median?: number;
}

export interface StarMeta {
  n: number;
  raw_bytes: number;
  layout: Record<string, Column>;
  samples: Record<'P4' | 'P5', SampleSummary>;
  n_in_both: number;
  spt_labels: string[];
  spt_teff: number[];
  sample_centroid: { l: number; b: number };
  frame: string;
  checks: Record<string, number | boolean>;
  has_uncertainties: boolean;
  has_flame_ages: boolean;
  provenance: { catalogue: string; files: string[]; export_date: string; repo_commit: string | null; repo_data_uncommitted?: boolean };
}

/** Sample bits of tPICsourceFlagNCAM_BOL (Montalto et al. 2026). */
export const BIT = { P5: 4, P4: 8 } as const;
export type SampleKey = keyof typeof BIT;

/** Main spectral classes present in the samples, cool → hot. */
export const CLASSES = ['M', 'K', 'G', 'F'] as const;
export type SpClass = (typeof CLASSES)[number];

export interface StarCatalog {
  meta: StarMeta;
  n: number;
  /** Heliocentric Galactic X, Y, Z (pc), interleaved. */
  xyz: Float32Array;
  d: Float32Array;
  teff: Float32Array;
  mass: Float32Array;
  radius: Float32Array;
  /** Sample bits (4 = P5, 8 = P4). */
  sample: Uint8Array;
  /** Index into meta.spt_labels. */
  spt: Uint8Array;
  /** Index into CLASSES. */
  cls: Uint8Array;
  /** Remaining columns, decoded on demand for the star card. */
  raw: (name: string, i: number) => number | null;
  picId: (i: number) => string;
  gaiaId: (i: number) => string | null;
}

const MISSING: Partial<Record<Dtype, number>> = { u1: 255, u2: 65535, i2: 32767 };

function view(buf: ArrayBuffer, c: Column, n: number) {
  switch (c.dtype) {
    case 'f4': return new Float32Array(buf, c.offset, n);
    case 'f8': return new Float64Array(buf, c.offset, n);
    case 'i2': return new Int16Array(buf, c.offset, n);
    case 'i8': return new BigInt64Array(buf, c.offset, n);
    case 'u1': return new Uint8Array(buf, c.offset, n);
    case 'u2': return new Uint16Array(buf, c.offset, n);
  }
}

/** Decode the uncompressed export (layout from the meta JSON). */
export function decodeCatalog(buf: ArrayBuffer, meta: StarMeta): StarCatalog {
  const n = meta.n;
  if (buf.byteLength !== meta.raw_bytes) throw new Error(`star catalogue: expected ${meta.raw_bytes} bytes, got ${buf.byteLength}`);
  const cols: Record<string, ReturnType<typeof view>> = {};
  for (const [k, c] of Object.entries(meta.layout)) cols[k] = view(buf, c, n);
  const num = (name: string, i: number): number | null => {
    const c = meta.layout[name], a = cols[name];
    if (!c || !a || c.dtype === 'i8') return null;
    const v = (a as Float32Array)[i];
    if (MISSING[c.dtype] === v || !Number.isFinite(v)) return null;
    return v * c.scale;
  };
  const scaled = (name: string) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = num(name, i) ?? NaN;
    return out;
  };
  const xyz = new Float32Array(3 * n);
  const X = cols.x as Float32Array, Y = cols.y as Float32Array, Z = cols.z as Float32Array;
  for (let i = 0; i < n; i++) { xyz[3 * i] = X[i]; xyz[3 * i + 1] = Y[i]; xyz[3 * i + 2] = Z[i]; }
  const spt = cols.spt as Uint8Array;
  const clsOfLabel = meta.spt_labels.map((s) => CLASSES.indexOf(s[0] as SpClass));
  const cls = new Uint8Array(n);
  for (let i = 0; i < n; i++) cls[i] = clsOfLabel[spt[i]];
  const pic = cols.pic_id as Float64Array, gaia = cols.gaia_id as BigInt64Array | undefined;
  return {
    meta, n, xyz, cls,
    d: scaled('d'), teff: scaled('teff'), mass: scaled('mass'), radius: scaled('radius'),
    sample: cols.sample as Uint8Array, spt,
    raw: num,
    picId: (i) => pic[i].toFixed(0),
    gaiaId: (i) => (gaia && gaia[i] > 0n ? gaia[i].toString() : null),
  };
}

// ── Coordinates ─────────────────────────────────────────────────────────────
// ICRS → Galactic rotation (Hipparcos definition, as used by astropy's
// Galactic frame; ESA 1997 Vol. 1, Sect. 1.5.3).  Rows: Galactic X, Y, Z.
export const ICRS_TO_GAL = [
  [-0.0548755604162154, -0.8734370902348850, -0.4838350155487132],
  [+0.4941094278755837, -0.4448296299600112, +0.7469822444972189],
  [-0.8676661490190047, -0.1980763734312015, +0.4559837761750669],
];

const DEG = Math.PI / 180;

export function icrsToGalactic(raDeg: number, decDeg: number, d: number): [number, number, number] {
  const ra = raDeg * DEG, dec = decDeg * DEG;
  const e = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
  const M = ICRS_TO_GAL;
  return [0, 1, 2].map((r) => d * (M[r][0] * e[0] + M[r][1] * e[1] + M[r][2] * e[2])) as [number, number, number];
}

/** Galactic (l, b) and ICRS (RA, Dec) of a heliocentric Galactic position, degrees. */
export function anglesOf(x: number, y: number, z: number) {
  const r = Math.hypot(x, y, z);
  const l = ((Math.atan2(y, x) / DEG) % 360 + 360) % 360;
  const b = Math.asin(z / r) / DEG;
  const M = ICRS_TO_GAL;            // inverse = transpose
  const ex = M[0][0] * x + M[1][0] * y + M[2][0] * z;
  const ey = M[0][1] * x + M[1][1] * y + M[2][1] * z;
  const ez = M[0][2] * x + M[1][2] * y + M[2][2] * z;
  const ra = ((Math.atan2(ey, ex) / DEG) % 360 + 360) % 360;
  const dec = Math.asin(ez / r) / DEG;
  return { l, b, ra, dec };
}

// ── Per-star record for the info card ──────────────────────────────────────
export interface StarRecord {
  index: number;
  pic: string;
  gaia: string | null;
  sample: SampleKey[];
  spt: string;
  d: number; e_d: number | null; plx: number | null;
  teff: number; e_teff: number | null;
  mass: number; e_mass: number | null;
  radius: number; e_rad: number | null;
  /** Derived as in the pipeline: L = R² (T_eff / 5778 K)⁴. */
  lum: number;
  vmag: number | null; pmag: number | null; gmag: number | null;
  age: number | null; n_cam: number | null;
  l: number; b: number; ra: number; dec: number;
}

export function starRecord(c: StarCatalog, i: number): StarRecord {
  const s = c.sample[i];
  const x = c.xyz[3 * i], y = c.xyz[3 * i + 1], z = c.xyz[3 * i + 2];
  const nCam = c.raw('n_cam', i);
  return {
    index: i, pic: c.picId(i), gaia: c.gaiaId(i),
    sample: (['P4', 'P5'] as SampleKey[]).filter((k) => s & BIT[k]),
    spt: c.meta.spt_labels[c.spt[i]],
    d: c.d[i], e_d: c.raw('e_d', i), plx: c.raw('plx', i),
    teff: c.teff[i], e_teff: c.raw('e_teff', i),
    mass: c.mass[i], e_mass: c.raw('e_mass', i),
    radius: c.radius[i], e_rad: c.raw('e_rad', i),
    lum: c.radius[i] ** 2 * (c.teff[i] / 5778) ** 4,
    vmag: c.raw('vmag', i), pmag: c.raw('pmag', i), gmag: c.raw('gmag', i),
    age: c.raw('age', i), n_cam: nCam && nCam > 0 ? nCam : null,
    ...anglesOf(x, y, z),
  };
}

// ── Loading in the browser ─────────────────────────────────────────────────
/** Fetch and decompress the gzip export.  Works for http(s) and inlined data: URLs. */
export async function fetchCatalog(url: string, meta: StarMeta, onProgress?: (f: number) => void): Promise<StarCatalog> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`star catalogue: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let bytes: Uint8Array;
  if (res.body && total && onProgress) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length; onProgress(Math.min(got / total, 1));
    }
    bytes = new Uint8Array(got);
    let o = 0;
    for (const ch of chunks) { bytes.set(ch, o); o += ch.length; }
  } else {
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  // a server may already have removed the gzip layer (Content-Encoding)
  let buf: ArrayBuffer;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    buf = await new Response(stream).arrayBuffer();
  } else {
    buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }
  return decodeCatalog(buf, meta);
}
