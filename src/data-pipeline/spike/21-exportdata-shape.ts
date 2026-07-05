/** Spike 21: reconstruct the Export Data crosstab from full-stream.json
 * (countywide) and validate against known May 2026 Medi-Cal reference values. */
import { readFileSync, writeFileSync } from "node:fs";
const OUT = new URL("./out/", import.meta.url).pathname;
const stream: { url: string; body: string }[] = JSON.parse(readFileSync(`${OUT}/full-stream.json`, "utf8"));

function parseBody(body: string): any[] {
  const t = body.trimStart();
  if (t.startsWith("{")) { try { return [JSON.parse(t)]; } catch { return []; } }
  const objs: any[] = [];
  let i = 0;
  while (i < body.length) {
    const semi = body.indexOf(";", i);
    if (semi === -1) break;
    const len = Number(body.slice(i, semi));
    if (!Number.isFinite(len)) break;
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

// Merge dict + presModelMap across all responses (session-cumulative).
let dictSegments: any = null;
let exportViz: any = null;
for (const resp of stream) {
  for (const c of parseBody(resp.body)) {
    const pmm = deepFind(c, "presModelMap");
    if (!pmm) continue;
    const seg = deepFind(pmm.dataDictionary ?? {}, "dataSegments");
    if (seg && seg["0"]?.dataColumns) dictSegments = seg;
    const vizPmm = deepFind(pmm.vizData ?? {}, "presModelMap");
    if (vizPmm && vizPmm["Export Data"]) {
      const gv = deepFind(vizPmm["Export Data"], "genVizDataPresModel");
      if (gv?.paneColumnsData) exportViz = gv.paneColumnsData;
    }
  }
}
console.log("[21] have dict:", !!dictSegments, "have exportViz:", !!exportViz);
if (!exportViz) { console.log("[21] Export Data viz not found in stream"); process.exit(1); }

const byType: Record<string, any[]> = {};
for (const c of dictSegments["0"].dataColumns) byType[c.dataType] = c.dataValues;

console.log("[21] Export Data vizDataColumns:");
for (const c of exportViz.vizDataColumns) console.log("  ", JSON.stringify({ fc: c.fieldCaption, dt: c.dataType, pi: c.paneIndices, ci: c.columnIndices }));
console.log("[21] panes:", exportViz.paneColumnsList.length);
exportViz.paneColumnsList.forEach((p: any, pi: number) => {
  console.log(`  pane ${pi} vizPaneColumns:`, p.vizPaneColumns.map((v: any) => ({ v: v.valueIndices.length, a: v.aliasIndices.length })));
});
writeFileSync(`${OUT}/exportdata-full.json`, JSON.stringify({ paneColumnsData: exportViz, byType }, null, 0));
