/**
 * Parsing of Tableau VizQL responses from the DPSS At-A-Glance embed, and the
 * raw-capture format built from them.
 *
 * The anonymous embed exposes no data API (see docs/adr/0002). Instead we read
 * the `bootstrapSession` / `tabdoc/select` command responses the embed exchanges
 * with Tableau Cloud. Each response carries:
 *   - `dataSegments`: typed value pools (cstring / integer / real / datetime),
 *     delivered incrementally per session -- later responses only ship values not
 *     already in the session dictionary; and
 *   - per-worksheet `paneColumnsData` (under `secondaryInfo.presModelMap` in a
 *     bootstrap, under `zones.<id>.presModelHolder.visual.vizData` in a select
 *     response): raw Tableau field captions plus index tuples that map
 *     dictionary entries into rows.
 *
 * A raw capture (format v2, docs/adr/0003) is SELF-CONTAINED per area: each
 * data-bearing worksheet's raw captions and index tuples plus a sparse data
 * dictionary holding exactly the session-dictionary entries those tuples
 * reference, at their original indices. This module does NOT rename fields,
 * select programs, or parse numbers -- that is phase 3's job (normalize.ts).
 */

/**
 * A worksheet's compact extract: Tableau's own field captions and index tuples,
 * kept value-for-value as served (paneColumnsData minus rendering geometry).
 */
export interface PaneColumnsData {
  vizDataColumns: {
    fieldCaption?: string;
    userFriendlyFieldCaption?: string;
    dataType?: string;
    paneIndices?: number[];
    columnIndices?: number[];
  }[];
  paneColumnsList: {
    vizPaneColumns: { valueIndices?: number[]; aliasIndices?: number[] }[];
  }[];
}

/**
 * A self-contained raw capture for one (report month, geography) -- format v2.
 *
 * `dataDictionary` maps dataType -> (session dictionary index -> value), sparse:
 * it holds exactly the entries referenced by `worksheets`' index tuples, at the
 * indices Tableau served. Values are verbatim (formatted strings and raw
 * numbers alike).
 */
export interface AreaCapture {
  formatVersion: 2;
  /** Data-bearing worksheets, keyed by Tableau worksheet name, verbatim. */
  worksheets: Record<string, PaneColumnsData>;
  /** Sparse typed value pools: dataType -> { index -> value }. */
  dataDictionary: Record<string, Record<string, string | number>>;
}

/**
 * Parse a raw VizQL response body into zero or more JSON objects.
 *
 * `bootstrapSession` bodies are length-prefixed frames (`<len>;<json><len>;<json>`);
 * `commands/*` bodies are a single JSON object. Handles both.
 */
export function parseVizqlBody(body: string): unknown[] {
  const trimmed = body.trimStart();
  if (trimmed.startsWith("{")) {
    try {
      return [JSON.parse(trimmed)];
    } catch {
      return [];
    }
  }
  const objs: unknown[] = [];
  let i = 0;
  while (i < body.length) {
    const semi = body.indexOf(";", i);
    if (semi === -1) break;
    const len = Number(body.slice(i, semi));
    if (!Number.isFinite(len) || len <= 0) break;
    const chunk = body.slice(semi + 1, semi + 1 + len);
    try {
      objs.push(JSON.parse(chunk));
    } catch {
      // Skip a frame we can't parse rather than aborting the whole body.
    }
    i = semi + 1 + len;
  }
  return objs;
}

function deepFindAll(obj: unknown, key: string, out: unknown[] = [], depth = 0): unknown[] {
  if (obj == null || typeof obj !== "object" || depth > 60) return out;
  if (Array.isArray(obj)) {
    for (const v of obj) deepFindAll(v, key, out, depth + 1);
    return out;
  }
  const rec = obj as Record<string, unknown>;
  for (const k of Object.keys(rec)) {
    if (k === key) out.push(rec[k]);
    deepFindAll(rec[k], key, out, depth + 1);
  }
  return out;
}

interface SegmentColumns {
  dataColumns?: { dataType: string; dataValues: (string | number)[] }[];
}

/**
 * The current typed value pools of one embed session.
 *
 * Tableau streams the dictionary as numbered segments ("0", "1", ...). Each
 * response's `dataSegments` MUTATES the session state by key: a served segment
 * REPLACES any previous segment with that key, and an explicit `null` deletes
 * it (observed when a view reset re-serves segment 0 and nulls segment 1 -
 * spike 39). Index tuples in a response reference the concatenation of the
 * segments live at that moment, in numeric key order. Feed EVERY VizQL
 * response body of a session in arrival order, and resolve each capture
 * against the state at capture time.
 */
export class SessionDictionary {
  private segments = new Map<number, SegmentColumns>();
  private cache: Record<string, (string | number)[]> | null = null;

  addBody(body: string): void {
    for (const chunk of parseVizqlBody(body)) {
      for (const segs of deepFindAll(chunk, "dataSegments")) {
        if (segs == null || typeof segs !== "object" || Array.isArray(segs)) continue;
        for (const [key, seg] of Object.entries(segs as Record<string, SegmentColumns | null>)) {
          const num = Number(key);
          if (!Number.isFinite(num)) continue;
          if (seg == null) {
            this.segments.delete(num);
          } else if (Array.isArray(seg.dataColumns)) {
            this.segments.set(num, seg);
          } else {
            continue;
          }
          this.cache = null;
        }
      }
    }
  }

  /** Concatenated pools by dataType, in numeric segment-key order. */
  pools(): Record<string, (string | number)[]> {
    if (this.cache) return this.cache;
    const pools: Record<string, (string | number)[]> = {};
    for (const key of [...this.segments.keys()].sort((a, b) => a - b)) {
      for (const col of this.segments.get(key)!.dataColumns ?? []) {
        (pools[col.dataType] ??= []).push(...col.dataValues);
      }
    }
    this.cache = pools;
    return pools;
  }
}

/** Keep only the caption/tuple fields of a served paneColumnsData (drop geometry). */
function compactPaneColumnsData(pcd: PaneColumnsData): PaneColumnsData {
  return {
    vizDataColumns: (pcd.vizDataColumns ?? []).map((c) => {
      const col: PaneColumnsData["vizDataColumns"][number] = {};
      if (c.fieldCaption != null) col.fieldCaption = c.fieldCaption;
      if (c.userFriendlyFieldCaption != null) col.userFriendlyFieldCaption = c.userFriendlyFieldCaption;
      if (c.dataType != null) col.dataType = c.dataType;
      if (c.paneIndices != null) col.paneIndices = c.paneIndices;
      if (c.columnIndices != null) col.columnIndices = c.columnIndices;
      return col;
    }),
    paneColumnsList: (pcd.paneColumnsList ?? []).map((p) => ({
      vizPaneColumns: (p.vizPaneColumns ?? []).map((vp) => {
        const out: { valueIndices?: number[]; aliasIndices?: number[] } = {};
        if (vp.valueIndices != null) out.valueIndices = vp.valueIndices;
        if (vp.aliasIndices != null) out.aliasIndices = vp.aliasIndices;
        return out;
      }),
    })),
  };
}

/**
 * Extract every data-bearing worksheet's captions + index tuples from VizQL
 * response bodies. Handles both response shapes:
 *  - bootstrap: `secondaryInfo.presModelMap.vizData.presModelHolder
 *      .genPresModelMapPresModel.presModelMap.<name>.presModelHolder
 *      .genVizDataPresModel.paneColumnsData`
 *  - select:    `...dashboardPresModel.zones.<id>.presModelHolder.visual
 *      .vizData.paneColumnsData` (worksheet name on the zone)
 * When a worksheet appears in several bodies, the later occurrence wins.
 */
export function extractWorksheets(bodies: string[]): Record<string, PaneColumnsData> {
  const out: Record<string, PaneColumnsData> = {};
  for (const body of bodies) {
    for (const chunk of parseVizqlBody(body)) {
      // Bootstrap shape: presModelMap keyed by worksheet name; each entry is
      // { presModelHolder: { genVizDataPresModel: { paneColumnsData } } }.
      for (const pmm of deepFindAll(chunk, "presModelMap")) {
        if (pmm == null || typeof pmm !== "object") continue;
        for (const [name, node] of Object.entries(pmm as Record<string, unknown>)) {
          const gen = (node as { presModelHolder?: { genVizDataPresModel?: { paneColumnsData?: PaneColumnsData } } })
            ?.presModelHolder?.genVizDataPresModel;
          if (gen?.paneColumnsData) out[name] = compactPaneColumnsData(gen.paneColumnsData);
        }
      }
      // Select shape: zones keyed by zone id, worksheet name on the zone.
      for (const zones of deepFindAll(chunk, "zones")) {
        if (zones == null || typeof zones !== "object" || Array.isArray(zones)) continue;
        for (const zone of Object.values(zones as Record<string, unknown>)) {
          if (zone == null || typeof zone !== "object") continue;
          const z = zone as {
            worksheet?: string;
            presModelHolder?: { visual?: { vizData?: { paneColumnsData?: PaneColumnsData } } };
          };
          const pcd = z.presModelHolder?.visual?.vizData?.paneColumnsData;
          if (z.worksheet && pcd) out[z.worksheet] = compactPaneColumnsData(pcd);
        }
      }
    }
  }
  return out;
}

/** All dictionary indices a worksheet's tuples may reference, by dataType. */
function referencedIndices(ws: PaneColumnsData): Map<string, Set<number>> {
  const refs = new Map<string, Set<number>>();
  for (const col of ws.vizDataColumns) {
    const dt = col.dataType;
    if (dt == null) continue;
    const set = refs.get(dt) ?? new Set<number>();
    refs.set(dt, set);
    const paneIndices = col.paneIndices ?? [];
    const columnIndices = col.columnIndices ?? [];
    for (let i = 0; i < Math.max(paneIndices.length, 1); i++) {
      const pane = ws.paneColumnsList[paneIndices[i] ?? 0];
      const vpc = pane?.vizPaneColumns[columnIndices[i] ?? 0];
      if (!vpc) continue;
      for (const idx of vpc.valueIndices ?? []) {
        if (idx >= 0) set.add(idx);
      }
      for (const idx of vpc.aliasIndices ?? []) {
        if (idx >= 0) set.add(idx);
      }
    }
  }
  return refs;
}

/**
 * Build a self-contained area capture: the given worksheets verbatim plus the
 * session-dictionary entries they reference (sparse, original indices).
 */
export function buildAreaCapture(
  worksheets: Record<string, PaneColumnsData>,
  session: SessionDictionary,
): AreaCapture {
  const pools = session.pools();
  const dict: Record<string, Record<string, string | number>> = {};
  for (const ws of Object.values(worksheets)) {
    for (const [dataType, indices] of referencedIndices(ws)) {
      const pool = pools[dataType];
      if (!pool) continue;
      const sparse = (dict[dataType] ??= {});
      for (const idx of indices) {
        if (idx < pool.length) sparse[String(idx)] = pool[idx]!;
      }
    }
  }
  return { formatVersion: 2, worksheets, dataDictionary: dict };
}

/** Convenience: extract worksheets from bodies and build the capture. */
export function extractAreaCapture(bodies: string[], session: SessionDictionary): AreaCapture {
  return buildAreaCapture(extractWorksheets(bodies), session);
}

/** A reconstructed worksheet: raw column captions plus one array per row. */
export interface Worksheet {
  captions: (string | null)[];
  rows: (string | number | null)[][];
}

/**
 * Reconstruct a worksheet's rows from a self-contained capture.
 *
 * For each column, `aliasIndices` (falling back to `valueIndices`) index into
 * the sparse dictionary for the column's dataType. A negative alias index `-i`
 * is Tableau's indirection: "take `valueIndices[-i - 1]`, then look that up in
 * the dictionary". Values are returned exactly as they sit in the dictionary --
 * no parsing or renaming.
 */
export function reconstructWorksheet(capture: AreaCapture, worksheetName: string): Worksheet | null {
  const ws = capture.worksheets[worksheetName];
  if (!ws) return null;

  const captions: (string | null)[] = [];
  const columnValues: (string | number | null)[][] = [];
  for (const col of ws.vizDataColumns) {
    captions.push(col.fieldCaption ?? col.userFriendlyFieldCaption ?? null);
    const dt = col.dataType;
    const pane = ws.paneColumnsList[col.paneIndices?.[0] ?? 0];
    const vpc = pane?.vizPaneColumns[col.columnIndices?.[0] ?? 0];
    if (dt == null || !vpc) {
      columnValues.push([]);
      continue;
    }
    const sparse = capture.dataDictionary[dt] ?? {};
    const valueIndices = vpc.valueIndices ?? [];
    const aliasIndices = vpc.aliasIndices ?? [];
    const indices = aliasIndices.length ? aliasIndices : valueIndices;
    columnValues.push(
      indices.map((idx) => {
        const ref = idx >= 0 ? idx : valueIndices[-idx - 1];
        return ref == null ? null : sparse[String(ref)] ?? null;
      }),
    );
  }

  const rowCount = columnValues.reduce((max, c) => Math.max(max, c.length), 0);
  const rows: (string | number | null)[][] = [];
  for (let r = 0; r < rowCount; r++) {
    rows.push(columnValues.map((c) => c[r] ?? null));
  }
  return { captions, rows };
}

/**
 * Whether a capture actually carries a geography's published figures: the
 * headline "Persons by <program>" single-value worksheets must resolve to a
 * number. Focus-release clicks and checkbox-only deltas produce captures
 * without resolvable worksheets; those are invalid and get re-captured.
 */
export function captureHasData(capture: AreaCapture): boolean {
  for (const name of ["Persons by Med-Cal", "Persons by CaFresh"]) {
    const ws = reconstructWorksheet(capture, name);
    const v = ws?.rows[0]?.find((x) => typeof x === "number");
    if (typeof v === "number") return true;
  }
  return false;
}

/** Parse a committed capture file's contents; null if not a v2 capture. */
export function parseAreaCapture(json: string): AreaCapture | null {
  try {
    const obj = JSON.parse(json) as AreaCapture;
    if (obj?.formatVersion !== 2 || typeof obj.worksheets !== "object") return null;
    return obj;
  } catch {
    return null;
  }
}
