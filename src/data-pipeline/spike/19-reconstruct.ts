/** Spike 19: locate Export Data across the per-area stream and reconstruct it. */
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
  if (obj == null || typeof obj !== "object" || depth > 50) return undefined;
  if (key in obj) return obj[key];
  for (const k of Object.keys(obj)) {
    const r = deepFind(obj[k], key, depth + 1);
    if (r !== undefined) return r;
  }
  return undefined;
}

for (const resp of stream) {
  const chunks = parseBody(resp.body);
  for (const c of chunks) {
    const pmm = deepFind(c, "presModelMap");
    if (!pmm) continue;
    const vizPmm = deepFind(pmm.vizData ?? {}, "presModelMap");
    if (vizPmm && vizPmm["Export Data"]) {
      const genViz = deepFind(vizPmm["Export Data"], "genVizDataPresModel");
      const hasPane = !!genViz?.paneColumnsData;
      console.log(`[19] ${resp.phase}/${resp.url.slice(0,30)}: Export Data present, paneColumnsData=${hasPane}`);
      if (hasPane) {
        const dd = deepFind(pmm.dataDictionary ?? {}, "dataSegments");
        writeFileSync(`${OUT}/exportdata-viz.json`, JSON.stringify(genViz.paneColumnsData));
        writeFileSync(`${OUT}/exportdata-dict.json`, JSON.stringify(dd));
        console.log(`[19]   saved paneColumnsData + dict from ${resp.phase}`);
      }
    }
  }
}
