/** Spike 15: parse the goto-sheet Table View response and dump its dataColumns. */
import { readFileSync, writeFileSync } from "node:fs";
const OUT = new URL("./out/", import.meta.url).pathname;
const raw = readFileSync(`${OUT}/tableview-biggest.json`, "utf8");

function findAll(obj: any, key: string, hits: any[] = [], depth = 0): any[] {
  if (obj == null || typeof obj !== "object" || depth > 40) return hits;
  for (const k of Object.keys(obj)) {
    if (k === key) hits.push(obj[k]);
    findAll(obj[k], key, hits, depth + 1);
  }
  return hits;
}

const json = JSON.parse(raw);
const segs = findAll(json, "dataSegments");
console.log("[15] dataSegments occurrences:", segs.length);
for (const seg of segs) {
  for (const segKey of Object.keys(seg ?? {})) {
    const cols = seg[segKey]?.dataColumns;
    if (cols) {
      console.log(
        "[15] dataColumns:",
        cols.map((c: any) => ({ type: c.dataType, n: c.dataValues?.length, sample: c.dataValues?.slice(0, 10) })),
      );
    }
  }
}
// Dump keys of presModelMap to understand structure.
const pmm = findAll(json, "presModelMap");
if (pmm.length) console.log("[15] presModelMap keys:", Object.keys(pmm[0]));
const vizData = findAll(json, "vizData");
console.log("[15] vizData occurrences:", vizData.length);
writeFileSync(`${OUT}/tableview-parsed-keys.json`, JSON.stringify({ presModelMapKeys: pmm.map((p) => Object.keys(p)) }, null, 2));
