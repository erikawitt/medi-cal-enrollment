/**
 * Parse-check every data/derived/map/*.json file. Used by validate-data.yml
 * before running the full validation suite.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const mapDir = join(import.meta.dir, "..", "..", "data", "derived", "map");
const GEO_TYPES = new Set([
  "zip",
  "spa",
  "congressional_district",
  "senate_district",
  "assembly_district",
  "community",
]);

let failed = false;

for (const file of readdirSync(mapDir).filter((f) => f.endsWith(".json")).sort()) {
  const path = join(mapDir, file);
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as {
      geo_type?: string;
      months?: unknown;
      features?: unknown;
    };
    if (!data.geo_type || !GEO_TYPES.has(data.geo_type)) {
      console.error(`${file}: missing or invalid geo_type`);
      failed = true;
      continue;
    }
    if (!Array.isArray(data.months) || data.months.length === 0) {
      console.error(`${file}: months must be a non-empty array`);
      failed = true;
      continue;
    }
    if (!data.features || typeof data.features !== "object") {
      console.error(`${file}: features must be an object`);
      failed = true;
      continue;
    }
    console.log(`${file}: ok (${Object.keys(data.features).length} features, ${data.months.length} month(s))`);
  } catch (err) {
    console.error(`${file}: ${(err as Error).message}`);
    failed = true;
  }
}

if (failed) process.exit(1);
