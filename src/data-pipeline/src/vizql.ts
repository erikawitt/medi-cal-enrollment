/**
 * Parsing of Tableau VizQL responses from the DPSS At-A-Glance embed.
 *
 * The anonymous embed exposes no data API (see docs/adr/0002). Instead we read
 * the `bootstrapSession` / `tabdoc/select` command responses the embed exchanges
 * with Tableau Cloud. Each response carries:
 *   - a `dataDictionary` of typed value pools (cstring / integer / real / datetime), and
 *   - per-worksheet `paneColumnsData` describing how dictionary entries index into rows.
 *
 * This module turns those raw responses into a compact, faithful `PresModel` (the
 * committed raw capture) and reconstructs individual worksheets on demand. It does
 * NOT rename fields, select programs, or parse numbers — that is phase 3's job.
 */

/** A worksheet's data, reduced to raw captions + dictionary index tuples. */
export interface WorksheetModel {
  columns: {
    /** Raw Tableau field caption, e.g. "PROGRAM_CODE", "SUM(TNUM1)". Null for the tuple-id column. */
    caption: string | null;
    /** Dictionary pool this column reads from. Null for the tuple-id column. */
    dataType: string | null;
    paneIndices: number[];
    columnIndices: number[];
  }[];
  panes: {
    vizPaneColumns: { valueIndices: number[]; aliasIndices: number[] }[];
  }[];
}

/** A compact, faithful extract of a VizQL presModel — this is the raw capture shape. */
export interface PresModel {
  /** Typed value pools, keyed by Tableau dataType (cstring | integer | real | datetime). */
  dataDictionary: Record<string, (string | number)[]>;
  /** Data-bearing worksheets, keyed by their Tableau worksheet name. */
  worksheets: Record<string, WorksheetModel>;
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

function deepFind(obj: unknown, key: string, depth = 0): unknown {
  if (obj == null || typeof obj !== "object" || depth > 60) return undefined;
  const rec = obj as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(rec, key)) return rec[key];
  for (const k of Object.keys(rec)) {
    const found = deepFind(rec[k], key, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Extract a compact `PresModel` from one or more VizQL response bodies.
 *
 * Tableau delivers the data dictionary once per session and then references it
 * from later responses, so callers pass the ordered set of bodies exchanged
 * while a given geography was displayed; later dictionary/worksheet data
 * supersedes earlier data of the same name.
 */
export function extractPresModel(bodies: string[]): PresModel {
  let dataDictionary: Record<string, (string | number)[]> = {};
  const worksheets: Record<string, WorksheetModel> = {};

  for (const body of bodies) {
    for (const chunk of parseVizqlBody(body)) {
      const presModelMap = deepFind(chunk, "presModelMap") as Record<string, unknown> | undefined;
      if (!presModelMap) continue;

      const segments = deepFind(presModelMap.dataDictionary ?? {}, "dataSegments") as
        | Record<string, { dataColumns?: { dataType: string; dataValues: (string | number)[] }[] }>
        | undefined;
      const dataColumns = segments?.["0"]?.dataColumns;
      if (dataColumns) {
        const next: Record<string, (string | number)[]> = {};
        for (const dc of dataColumns) next[dc.dataType] = dc.dataValues;
        dataDictionary = next;
      }

      const vizPresModelMap = deepFind(presModelMap.vizData ?? {}, "presModelMap") as
        | Record<string, unknown>
        | undefined;
      if (vizPresModelMap) {
        for (const [name, node] of Object.entries(vizPresModelMap)) {
          const gen = deepFind(node, "genVizDataPresModel") as
            | { paneColumnsData?: PaneColumnsData }
            | undefined;
          const pcd = gen?.paneColumnsData;
          if (!pcd) continue;
          worksheets[name] = {
            columns: pcd.vizDataColumns.map((c) => ({
              caption: c.fieldCaption ?? c.userFriendlyFieldCaption ?? null,
              dataType: c.dataType ?? null,
              paneIndices: c.paneIndices ?? [],
              columnIndices: c.columnIndices ?? [],
            })),
            panes: pcd.paneColumnsList.map((p) => ({
              vizPaneColumns: p.vizPaneColumns.map((vp) => ({
                valueIndices: vp.valueIndices ?? [],
                aliasIndices: vp.aliasIndices ?? [],
              })),
            })),
          };
        }
      }
    }
  }

  return { dataDictionary, worksheets };
}

interface PaneColumnsData {
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

/** A reconstructed worksheet: raw column captions plus one array per row. */
export interface Worksheet {
  captions: (string | null)[];
  rows: (string | number | null)[][];
}

/**
 * Reconstruct a worksheet's rows from a `PresModel`.
 *
 * For each column, `aliasIndices` (falling back to `valueIndices`) index into the
 * dictionary pool for the column's dataType. A negative alias index `-i` is
 * Tableau's indirection: it means "take `valueIndices[-i - 1]` then look that up
 * in the dictionary". Values are returned exactly as they sit in the dictionary
 * (formatted strings and raw numbers alike) — no parsing or renaming.
 */
export function reconstructWorksheet(model: PresModel, worksheetName: string): Worksheet | null {
  const ws = model.worksheets[worksheetName];
  if (!ws) return null;

  const columnValues: (string | number | null)[][] = [];
  const captions: (string | null)[] = [];

  for (const col of ws.columns) {
    captions.push(col.caption);
    const paneIndex = col.paneIndices[0] ?? 0;
    const colIndex = col.columnIndices[0] ?? 0;
    const vpc = ws.panes[paneIndex]?.vizPaneColumns[colIndex];
    if (!vpc || col.dataType == null) {
      columnValues.push([]);
      continue;
    }
    const pool = model.dataDictionary[col.dataType] ?? [];
    const indices = vpc.aliasIndices.length ? vpc.aliasIndices : vpc.valueIndices;
    columnValues.push(
      indices.map((idx) => {
        if (idx >= 0) return pool[idx] ?? null;
        const viaValue = vpc.valueIndices[-idx - 1];
        return viaValue == null ? null : pool[viaValue] ?? null;
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

/** List the data-bearing worksheet names present in a `PresModel`. */
export function worksheetNames(model: PresModel): string[] {
  return Object.keys(model.worksheets);
}
