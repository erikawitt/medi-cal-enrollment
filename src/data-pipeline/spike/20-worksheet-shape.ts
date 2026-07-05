/** Spike 20: dump the shape of representative AtAGlance worksheets so we can
 * design the crosstab reconstruction (and confirm per-area data is captured in
 * the tabdoc/select response). */
import { readFileSync, writeFileSync } from "node:fs";
const OUT = new URL("./out/", import.meta.url).pathname;
const stream: { phase: string; url: string; body: string }[] = JSON.parse(readFileSync(`${OUT}/per-area-stream.json`, "utf8"));

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
  for (const k of Object.keys(obj)) {
    const r = deepFind(obj[k], key, depth + 1);
    if (r !== undefined) return r;
  }
  return undefined;
}

// Use the initial bootstrap (countywide/Department) for a validatable check.
const boot = stream.find((s) => s.url.includes("sessions/") && s.body.length > 1_000_000)!;
const chunks = parseBody(boot.body);
const sec = chunks.find((c) => deepFind(c, "presModelMap"));
const pmm = deepFind(sec, "presModelMap");
console.log("[20] top presModelMap keys:", Object.keys(pmm));

const dict = deepFind(pmm.dataDictionary, "dataSegments");
const dcols = dict["0"].dataColumns;
const byType: Record<string, any[]> = {};
for (const c of dcols) byType[c.dataType] = c.dataValues;
console.log("[20] dict types + counts:", Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, v.length])));

const vizPmm = deepFind(pmm.vizData, "presModelMap");
const wsNames = Object.keys(vizPmm);
console.log("[20] worksheet count:", wsNames.length);

for (const ws of ["Persons by Med-Cal", "Age og Eligible Persons by Program", "Citizenship Status by Med-Cal"]) {
  const node = vizPmm[ws];
  if (!node) { console.log(`[20] MISSING ${ws}`); continue; }
  const gv = deepFind(node, "genVizDataPresModel");
  const pcd = gv?.paneColumnsData;
  if (!pcd) { console.log(`[20] ${ws}: no paneColumnsData`); continue; }
  const cols = pcd.vizDataColumns.map((c: any) => ({ fc: c.fieldCaption, dt: c.dataType, pi: c.paneIndices, ci: c.columnIndices }));
  console.log(`[20] === ${ws} vizDataColumns ===`);
  console.log(JSON.stringify(cols));
  const pane = pcd.paneColumnsList[0];
  console.log(`[20] ${ws} pane0 vizPaneColumns:`, pane.vizPaneColumns.map((v: any) => ({ vN: v.valueIndices?.length, aN: v.aliasIndices?.length })));
  if (ws === "Persons by Med-Cal") writeFileSync(`${OUT}/ws-persons-medcal.json`, JSON.stringify({ pcd, byType }, null, 0));
}
