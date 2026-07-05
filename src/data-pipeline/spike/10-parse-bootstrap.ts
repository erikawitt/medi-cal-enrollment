/**
 * Spike step 10: parse the captured AtAGlance bootstrapSession JSON and locate
 *   - the dataDictionary (raw values + formatted aliases)
 *   - the Export Data worksheet's presModel (columns / geography structure)
 * to resolve gates C/D and design the extractor.
 */
import { readFileSync, writeFileSync } from "node:fs";

const OUT = new URL("./out/", import.meta.url).pathname;
const raw = readFileSync(`${OUT}/best-vizql-body.json`, "utf8");

/** Tableau bootstrap = `<len>;<json><len>;<json>`. Split into JSON chunks. */
function splitBootstrap(s: string): any[] {
  const objs: any[] = [];
  let i = 0;
  while (i < s.length) {
    const semi = s.indexOf(";", i);
    if (semi === -1) break;
    const len = Number(s.slice(i, semi));
    if (!Number.isFinite(len)) break;
    const jsonStr = s.slice(semi + 1, semi + 1 + len);
    try {
      objs.push(JSON.parse(jsonStr));
    } catch (e) {
      objs.push({ __parseError: (e as Error).message, preview: jsonStr.slice(0, 200) });
    }
    i = semi + 1 + len;
  }
  return objs;
}

function findKey(obj: any, key: string, path = "$", out: string[] = [], max = 40): string[] {
  if (out.length >= max || obj == null || typeof obj !== "object") return out;
  for (const k of Object.keys(obj)) {
    if (k === key) out.push(`${path}.${k}`);
    findKey(obj[k], key, `${path}.${k}`, out, max);
  }
  return out;
}

function getPath(obj: any, path: string): any {
  const parts = path.replace(/^\$\.?/, "").split(".").filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

const chunks = splitBootstrap(raw);
console.log("[parse] chunk count:", chunks.length);
console.log("[parse] chunk top keys:", chunks.map((c) => Object.keys(c).slice(0, 6)));

// Locate dataDictionary and dataSegments paths.
for (let ci = 0; ci < chunks.length; ci++) {
  const dd = findKey(chunks[ci], "dataDictionary", `chunk[${ci}]`);
  const ds = findKey(chunks[ci], "dataSegments", `chunk[${ci}]`);
  const ws = findKey(chunks[ci], "worksheet", `chunk[${ci}]`, [], 60);
  if (dd.length) console.log(`[parse] chunk ${ci} dataDictionary paths:`, dd);
  if (ds.length) console.log(`[parse] chunk ${ci} dataSegments paths:`, ds);
  if (ws.length) console.log(`[parse] chunk ${ci} worksheet occurrences:`, ws.length);
}

// Inspect the dataDictionary contents (data types + counts).
for (let ci = 0; ci < chunks.length; ci++) {
  const ddPaths = findKey(chunks[ci], "dataSegments", `chunk[${ci}]`);
  for (const p of ddPaths) {
    const seg = getPath({ [`chunk[${ci}]`]: chunks[ci] }, p);
    if (seg && seg["0"]?.dataColumns) {
      const cols = seg["0"].dataColumns;
      console.log(
        `[parse] ${p} dataColumns:`,
        cols.map((c: any) => ({ type: c.dataType, n: c.dataValues?.length, sample: c.dataValues?.slice(0, 6) })),
      );
      writeFileSync(`${OUT}/datacolumns-dump.json`, JSON.stringify(cols, null, 2));
    }
  }
}
