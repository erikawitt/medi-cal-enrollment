/**
 * Derive: data/tidy/*.json -> data/derived/map/{geo_type}.json
 *
 * Computes the Medi-Cal-only derived files from tidy data: age 0-5 rollups,
 * month-over-month deltas (the disenrollment-trend signal), the community
 * collation via the phase-2 crosswalk, and map-ready pivots - one file per
 * geography level spanning all report months, rewritten wholesale each run.
 *
 * Community figures are always apportioned estimates
 * (`community_value = sum(zip_value * overlap_fraction)`); apportionment
 * assumes uniform density within a zip, so community sums will not perfectly
 * reconcile with zip/countywide totals - expected drift, not a bug. Floats
 * are kept internally and rounded to integers only in the map-ready output.
 *
 * Offline by contract: reads only committed files.
 *
 * CLI: bun run derive
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CitizenshipMetric,
  CrosswalkFile,
  EthnicityMetric,
  GeoType,
  MapFeatureMonth,
  MapGeoFile,
  ReportMonth,
  TidyMonthFile,
  TidyRow,
} from "@medi-cal-disenrollment/shared";
import { DATA_TIDY_DIR } from "./normalize";

export const DATA_DERIVED_MAP_DIR = join(import.meta.dir, "..", "..", "..", "data", "derived", "map");
export const CROSSWALK_PATH = join(import.meta.dir, "..", "..", "..", "data", "crosswalk", "zip-community.json");

const ETHNICITY_METRICS: EthnicityMetric[] = [
  "eth_aian",
  "eth_asian",
  "eth_black_african_american",
  "eth_hispanic_latino",
  "eth_nhpi",
  "eth_white",
  "eth_two_or_more",
  "eth_other",
];
const CITIZENSHIP_METRICS: CitizenshipMetric[] = ["cit_citizen", "cit_documented", "cit_undocumented", "cit_other"];
const AGE_0_5_METRICS = ["age_under_1", "age_1_2", "age_3_5"] as const;

/** The Medi-Cal figures of one (geography, month), pre-delta. Floats allowed (community). */
interface FeatureMonthValues {
  age_0_5?: number;
  persons_total?: number;
  ethnicity: Partial<Record<EthnicityMetric, number>>;
  citizenship: Partial<Record<CitizenshipMetric, number>>;
}

/** metric -> value for one (geo, month, program=medi-cal). */
type MetricValues = Map<string, number>;

function featureValues(metrics: MetricValues): FeatureMonthValues {
  const out: FeatureMonthValues = { ethnicity: {}, citizenship: {} };
  // age_0_5 = under_1 + 1-2 + 3-5. Buckets DPSS suppressed are absent, not
  // zero; a partial sum would silently undercount, so the rollup requires all
  // three buckets (areas small enough to lose a bucket are also areas where a
  // partial figure would mislead most).
  if (AGE_0_5_METRICS.every((m) => metrics.has(m))) {
    out.age_0_5 = AGE_0_5_METRICS.reduce((a, m) => a + metrics.get(m)!, 0);
  }
  if (metrics.has("persons_total")) out.persons_total = metrics.get("persons_total")!;
  for (const m of ETHNICITY_METRICS) if (metrics.has(m)) out.ethnicity[m] = metrics.get(m)!;
  for (const m of CITIZENSHIP_METRICS) if (metrics.has(m)) out.citizenship[m] = metrics.get(m)!;
  return out;
}

/** Previous report month key (2026-01 -> 2025-12). */
export function previousMonth(month: ReportMonth): ReportMonth {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Assemble one geography level's map file from per-month feature values.
 * Deltas compare consecutive report months only: null for the earliest month,
 * across gaps, and when either endpoint is unpublished.
 */
export function buildMapGeoFile(
  geoType: GeoType,
  months: ReportMonth[],
  values: Map<string, Map<ReportMonth, FeatureMonthValues>>,
  generatedAt: string,
): MapGeoFile {
  const roundOpt = (x: number | undefined) => (x === undefined ? undefined : Math.round(x));
  const features: MapGeoFile["features"] = {};
  for (const [featureId, byMonth] of [...values.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const feature: Record<ReportMonth, MapFeatureMonth> = {};
    for (const month of months) {
      const cur = byMonth.get(month);
      if (!cur) continue;
      const prev = byMonth.get(previousMonth(month));
      const delta = (field: "age_0_5" | "persons_total"): { d: number | null; p: number | null } => {
        const a = prev?.[field];
        const b = cur[field];
        if (a === undefined || b === undefined) return { d: null, p: null };
        return { d: Math.round(b - a), p: a === 0 ? null : round1(((b - a) / a) * 100) };
      };
      const age = delta("age_0_5");
      const persons = delta("persons_total");
      const rounded: MapFeatureMonth = {
        age_0_5_mom_delta: age.d,
        age_0_5_mom_pct: age.p,
        persons_mom_delta: persons.d,
        persons_mom_pct: persons.p,
        ethnicity: Object.fromEntries(
          Object.entries(cur.ethnicity).map(([k, v]) => [k, Math.round(v)]),
        ) as MapFeatureMonth["ethnicity"],
        citizenship: Object.fromEntries(
          Object.entries(cur.citizenship).map(([k, v]) => [k, Math.round(v)]),
        ) as MapFeatureMonth["citizenship"],
      };
      const a05 = roundOpt(cur.age_0_5);
      if (a05 !== undefined) rounded.age_0_5 = a05;
      const pt = roundOpt(cur.persons_total);
      if (pt !== undefined) rounded.persons_total = pt;
      feature[month] = rounded;
    }
    if (Object.keys(feature).length) features[featureId] = feature;
  }
  return { geo_type: geoType, generated_at: generatedAt, months, features };
}

/** Medi-Cal metric values per (geo_id, month) for one scraped geo type. */
export function collectScraped(
  rowsByMonth: Map<ReportMonth, TidyRow[]>,
  geoType: GeoType,
): Map<string, Map<ReportMonth, FeatureMonthValues>> {
  const out = new Map<string, Map<ReportMonth, FeatureMonthValues>>();
  for (const [month, rows] of rowsByMonth) {
    const byGeo = new Map<string, MetricValues>();
    for (const r of rows) {
      if (r.geo_type !== geoType || r.program !== "medi-cal") continue;
      let m = byGeo.get(r.geo_id);
      if (!m) byGeo.set(r.geo_id, (m = new Map()));
      m.set(r.metric, r.value);
    }
    for (const [geoId, metrics] of byGeo) {
      let byMonth = out.get(geoId);
      if (!byMonth) out.set(geoId, (byMonth = new Map()));
      byMonth.set(month, featureValues(metrics));
    }
  }
  return out;
}

/**
 * Community collation: apportion each month's zip-level Medi-Cal metrics
 * across communities by crosswalk overlap fraction, then roll up. Only zips
 * present in tidy contribute; zips missing from the crosswalk are surfaced by
 * `bun run validate` (warn), not here.
 */
export function collectCommunity(
  rowsByMonth: Map<ReportMonth, TidyRow[]>,
  crosswalk: CrosswalkFile,
): Map<string, Map<ReportMonth, FeatureMonthValues>> {
  const entriesByZip = new Map<string, { community: string; overlap_fraction: number }[]>();
  for (const e of crosswalk.entries) {
    let list = entriesByZip.get(e.zip);
    if (!list) entriesByZip.set(e.zip, (list = []));
    list.push(e);
  }

  const out = new Map<string, Map<ReportMonth, FeatureMonthValues>>();
  for (const [month, rows] of rowsByMonth) {
    // community -> metric -> apportioned float sum
    const acc = new Map<string, MetricValues>();
    for (const r of rows) {
      if (r.geo_type !== "zip" || r.program !== "medi-cal") continue;
      // Apportion additive counts only - averages/currency don't sum across areas.
      if (r.metric === "avg_benefit_per_case") continue;
      for (const e of entriesByZip.get(r.geo_id) ?? []) {
        let m = acc.get(e.community);
        if (!m) acc.set(e.community, (m = new Map()));
        m.set(r.metric, (m.get(r.metric) ?? 0) + r.value * e.overlap_fraction);
      }
    }
    for (const [community, metrics] of acc) {
      let byMonth = out.get(community);
      if (!byMonth) out.set(community, (byMonth = new Map()));
      byMonth.set(month, featureValues(metrics));
    }
  }
  return out;
}

/** Read every committed tidy month file. */
export function readTidyMonths(dir: string = DATA_TIDY_DIR): Map<ReportMonth, TidyRow[]> {
  const out = new Map<ReportMonth, TidyRow[]>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).sort()) {
    const m = f.match(/^(\d{4}-\d{2})\.json$/);
    if (!m) continue;
    out.set(m[1]!, JSON.parse(readFileSync(join(dir, f), "utf8")) as TidyMonthFile);
  }
  return out;
}

const MAP_GEO_TYPES: GeoType[] = [
  "zip",
  "spa",
  "congressional_district",
  "senate_district",
  "assembly_district",
  "community",
];

if (import.meta.main) {
  const rowsByMonth = readTidyMonths();
  if (rowsByMonth.size === 0) {
    console.error("[derive] no tidy months under data/tidy/ - run normalize first");
    process.exit(1);
  }
  const crosswalk = JSON.parse(readFileSync(CROSSWALK_PATH, "utf8")) as CrosswalkFile;
  const months = [...rowsByMonth.keys()].sort();
  const generatedAt = new Date().toISOString();
  mkdirSync(DATA_DERIVED_MAP_DIR, { recursive: true });
  for (const geoType of MAP_GEO_TYPES) {
    const values =
      geoType === "community" ? collectCommunity(rowsByMonth, crosswalk) : collectScraped(rowsByMonth, geoType);
    const file = buildMapGeoFile(geoType, months, values, generatedAt);
    writeFileSync(join(DATA_DERIVED_MAP_DIR, `${geoType}.json`), JSON.stringify(file, null, 1) + "\n");
    console.log(`[derive] ${geoType}: ${Object.keys(file.features).length} features x ${months.length} months`);
  }
}
