/**
 * Filesystem layout + manifest for raw captures.
 *
 * Per docs/plans/phase-1-scraper.md and docs/adr/0002 + 0003, a raw capture is
 * a SELF-CONTAINED extract of the VizQL presModel for one report month ×
 * geography (worksheet captions + index tuples + the referenced dictionary
 * entries — see src/vizql.ts `AreaCapture`), written under:
 *
 *   data/raw/{YYYY-MM}/{geo_type}/{geo_id}.json # one file per geography value
 *   data/raw/{YYYY-MM}/manifest.json            # method, timestamps, geo counts
 *
 * Phase 3 reconstructs worksheet rows from each file in isolation.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseAreaCapture, type AreaCapture } from "./vizql";

export const SCRAPER_VERSION = "phase1-0.2.0";
export const EXTRACTION_METHOD = "vizql-presmodel-selfcontained-v2";

/** Repo-root data directory. This module lives at src/data-pipeline/src/. */
export const DATA_RAW_DIR = join(import.meta.dir, "..", "..", "..", "data", "raw");

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Convert a dropdown label ("May 2026") to a report-month key ("2026-05"). */
export function monthLabelToKey(label: string): string | null {
  const m = label.trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const idx = MONTH_NAMES.indexOf(m[1]!);
  if (idx < 0) return null;
  return `${m[2]}-${String(idx + 1).padStart(2, "0")}`;
}

export function monthDir(reportMonth: string): string {
  return join(DATA_RAW_DIR, reportMonth);
}
export function geoTypeDir(reportMonth: string, geoType: string): string {
  return join(monthDir(reportMonth), geoType);
}

/** Filesystem-safe file stem for a geography value (kept human-readable). */
export function geoIdToFileStem(geoId: string): string {
  return geoId.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "area";
}

export interface GeoTypeManifest {
  geoType: string;
  areaCount: number;
  /** Size of the sub-area domain the embed advertised (target for completeness). */
  domainCount?: number;
  /** Capture order — significant because per-area frames are session-cumulative deltas. */
  areas: { geoId: string; file: string; order: number }[];
}

export interface Manifest {
  reportMonth: string;
  extractionMethod: string;
  scraperVersion: string;
  capturedAt: string;
  source: string;
  geoTypes: GeoTypeManifest[];
}

/** Write one area's self-contained capture; returns the relative file name. */
export function writeArea(
  reportMonth: string,
  geoType: string,
  geoId: string,
  capture: AreaCapture,
): string {
  const dir = geoTypeDir(reportMonth, geoType);
  mkdirSync(dir, { recursive: true });
  const file = `${geoIdToFileStem(geoId)}.json`;
  writeFileSync(join(dir, file), JSON.stringify(capture));
  return file;
}

export function areaAlreadyCaptured(reportMonth: string, geoType: string, geoId: string): boolean {
  return existsSync(join(geoTypeDir(reportMonth, geoType), `${geoIdToFileStem(geoId)}.json`));
}

/**
 * Read an area's committed capture, or null when absent, unreadable, or in a
 * superseded format (pre-v2 files parse to null, so they read as not-captured
 * and the idempotent scraper recaptures them).
 */
export function readAreaCapture(
  reportMonth: string,
  geoType: string,
  geoId: string,
): AreaCapture | null {
  const p = join(geoTypeDir(reportMonth, geoType), `${geoIdToFileStem(geoId)}.json`);
  if (!existsSync(p)) return null;
  return parseAreaCapture(readFileSync(p, "utf8"));
}

export function readManifest(reportMonth: string): Manifest | null {
  const p = join(monthDir(reportMonth), "manifest.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Manifest;
  } catch {
    return null;
  }
}

/** Merge a geo type's results into the month manifest and persist it. */
export function upsertManifest(reportMonth: string, geoTypeManifest: GeoTypeManifest): Manifest {
  mkdirSync(monthDir(reportMonth), { recursive: true });
  const existing = readManifest(reportMonth);
  const manifest: Manifest = existing ?? {
    reportMonth,
    extractionMethod: EXTRACTION_METHOD,
    scraperVersion: SCRAPER_VERSION,
    capturedAt: new Date().toISOString(),
    source: "https://myappse.dpss.lacounty.gov/pls/apexprod/f?p=AAGT:AAGT",
    geoTypes: [],
  };
  manifest.geoTypes = manifest.geoTypes.filter((g) => g.geoType !== geoTypeManifest.geoType);
  manifest.geoTypes.push(geoTypeManifest);
  manifest.geoTypes.sort((a, b) => a.geoType.localeCompare(b.geoType));
  manifest.capturedAt = new Date().toISOString();
  writeFileSync(join(monthDir(reportMonth), "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

/** Report months already present under data/raw/ (for idempotency reporting). */
export function existingReportMonths(): string[] {
  if (!existsSync(DATA_RAW_DIR)) return [];
  return readdirSync(DATA_RAW_DIR).filter((d) => /^\d{4}-\d{2}$/.test(d));
}
