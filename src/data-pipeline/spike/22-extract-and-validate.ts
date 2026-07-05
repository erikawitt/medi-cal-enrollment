/** Spike 22: prototype the compact presModel extractor + reconstruction, and
 * validate countywide May 2026 Medi-Cal reference values (incl. age 0-5). */
import { readFileSync, writeFileSync } from "node:fs";
const OUT = new URL("./out/", import.meta.url).pathname;
const stream: { url: string; body: string }[] = JSON.parse(readFileSync(`${OUT}/full-stream.json`, "utf8"));

function parseBody(body: string): any[] {
  const t = body.trimStart();
  if (t.startsWith("{")) { try { return [JSON.parse(t)]; } catch { return []; } }
  const objs: any[] = []; let i = 0;
  while (i < body.length) {
    const semi = body.indexOf(";", i); if (semi === -1) break;
    const len = Number(body.slice(i, semi)); if (!Number.isFinite(len)) break;
    try { objs.push(JSON.parse(body.slice(semi + 1, semi + 1 + len))); } catch {}
    i = semi + 1 + len;
  }
  return objs;
}
function deepFind(obj: any, key: string, depth = 0): any {
  if (obj == null || typeof obj !== "object" || depth > 60) return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  for (const k of Object.keys(obj)) { const r = deepFind(obj[k], key, depth + 1); if (r !== undefined) return r; }
  return undefined;
}

// Extract compact presModel: dict + per-worksheet columns/panes (indices only).
function extract(bodies: string[]) {
  let byType: Record<string, any[]> = {};
  const worksheets: Record<string, any> = {};
  for (const body of bodies) {
    for (const c of parseBody(body)) {
      const pmm = deepFind(c, "presModelMap");
      if (!pmm) continue;
      const seg = deepFind(pmm.dataDictionary ?? {}, "dataSegments");
      if (seg?.["0"]?.dataColumns) { byType = {}; for (const dc of seg["0"].dataColumns) byType[dc.dataType] = dc.dataValues; }
      const vizPmm = deepFind(pmm.vizData ?? {}, "presModelMap");
      if (vizPmm) {
        for (const [name, node] of Object.entries<any>(vizPmm)) {
          const gv = deepFind(node, "genVizDataPresModel");
          const pcd = gv?.paneColumnsData;
          if (!pcd) continue;
          worksheets[name] = {
            columns: pcd.vizDataColumns.map((v: any) => ({ caption: v.fieldCaption ?? v.userFriendlyFieldCaption ?? null, dataType: v.dataType ?? null, paneIndices: v.paneIndices, columnIndices: v.columnIndices })),
            panes: pcd.paneColumnsList.map((p: any) => ({ vizPaneColumns: p.vizPaneColumns.map((vp: any) => ({ valueIndices: vp.valueIndices, aliasIndices: vp.aliasIndices })) })),
          };
        }
      }
    }
  }
  return { dataDictionary: byType, worksheets };
}

// Reconstruct one worksheet to a list of column arrays.
function reconstruct(model: any, wsName: string): { captions: string[]; rows: any[][] } | null {
  const ws = model.worksheets[wsName];
  if (!ws) return null;
  const dict = model.dataDictionary;
  const cols: any[][] = [];
  const captions: string[] = [];
  for (const col of ws.columns) {
    const pane = col.paneIndices?.[0] ?? 0;
    const ci = col.columnIndices?.[0] ?? 0;
    const vpc = ws.panes[pane]?.vizPaneColumns[ci];
    if (!vpc) { cols.push([]); captions.push(col.caption); continue; }
    const idxs = (vpc.aliasIndices?.length ? vpc.aliasIndices : vpc.valueIndices) as number[];
    const pool = dict[col.dataType] ?? [];
    const vals = idxs.map((i) => (i >= 0 ? pool[i] : dict[col.dataType]?.[vpc.valueIndices[-i - 1]]));
    cols.push(vals);
    captions.push(col.caption);
  }
  const n = Math.max(0, ...cols.map((c) => c.length));
  const rows: any[][] = [];
  for (let r = 0; r < n; r++) rows.push(cols.map((c) => c[r] ?? null));
  return { captions, rows };
}

const model = extract(stream.map((s) => s.body));
const compact = JSON.stringify(model);
console.log("[22] worksheets extracted:", Object.keys(model.worksheets).length);
console.log("[22] compact size KB:", Math.round(compact.length / 1024));
writeFileSync(`${OUT}/compact-model-countywide.json`, compact);

// Validate: Persons by Med-Cal
const pm = reconstruct(model, "Persons by Med-Cal");
console.log("[22] Persons by Med-Cal:", JSON.stringify(pm));

// Validate age: "Age og Eligible Persons by Program"
const age = reconstruct(model, "Age og Eligible Persons by Program");
if (age) {
  const medcalAges = age.rows.filter((r) => String(r[age.captions.indexOf("PROGRAM_CODE")]).match(/MEDI|MC|Medi/i));
  console.log("[22] age captions:", age.captions);
  console.log("[22] age rows (first 20):", JSON.stringify(age.rows.slice(0, 20)));
}
