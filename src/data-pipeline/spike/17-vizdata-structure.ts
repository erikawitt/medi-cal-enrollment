/** Spike 17: dissect the Export Data worksheet vizData to design the parser. */
import { readFileSync, writeFileSync } from "node:fs";
const OUT = new URL("./out/", import.meta.url).pathname;
const stream: { url: string; body: string }[] = JSON.parse(readFileSync(`${OUT}/full-stream.json`, "utf8"));

// bootstrapSession body is "<len>;<json><len>;<json>"; commands are plain JSON.
function parseBody(body: string): any {
  const t = body.trimStart();
  if (t.startsWith("{")) return JSON.parse(t);
  // length-prefixed
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

// Use the bootstrap (first, largest) response.
const boot = stream.find((s) => s.url.includes("bootstrapSession"))!;
const chunks = parseBody(boot.body);
const secondary = Array.isArray(chunks) ? chunks.find((c: any) => c.secondaryInfo) : chunks;
const pmm = secondary.secondaryInfo.presModelMap;
console.log("[17] presModelMap keys:", Object.keys(pmm));

const vizPmm = pmm.vizData.presModelHolder.genPresModelMapPresModel.presModelMap;
console.log("[17] worksheets in vizData:", Object.keys(vizPmm));

const ed = vizPmm["Export Data"];
const vizModel = ed.presModelHolder.genVizDataPresModel;
const pcd = vizModel.paneColumnsData;
console.log("[17] vizDataColumns count:", pcd.vizDataColumns.length);
console.log(
  "[17] vizDataColumns:",
  pcd.vizDataColumns.map((c: any) => ({
    fieldCaption: c.fieldCaption,
    dataType: c.dataType,
    isAutoSelect: c.isAutoSelect,
    paneIndices: c.paneIndices,
    columnIndices: c.columnIndices,
  })),
);
console.log("[17] paneColumnsList count:", pcd.paneColumnsList.length);
const pane0 = pcd.paneColumnsList[0];
console.log(
  "[17] pane0 vizPaneColumns:",
  pane0.vizPaneColumns.map((v: any) => ({
    valueIndicesN: v.valueIndices?.length,
    aliasIndicesN: v.aliasIndices?.length,
    valueSample: v.valueIndices?.slice(0, 8),
    aliasSample: v.aliasIndices?.slice(0, 8),
  })),
);

// data dictionary
const dseg = pmm.dataDictionary.presModelHolder.genDataDictionaryPresModel.dataSegments;
const cols = dseg["0"].dataColumns;
console.log("[17] dataColumns:", cols.map((c: any) => ({ type: c.dataType, n: c.dataValues.length })));
writeFileSync(`${OUT}/export-data-vizmodel.json`, JSON.stringify({ vizDataColumns: pcd.vizDataColumns, paneColumnsList: pcd.paneColumnsList }, null, 2));
writeFileSync(`${OUT}/data-dictionary.json`, JSON.stringify(cols, null, 2));
