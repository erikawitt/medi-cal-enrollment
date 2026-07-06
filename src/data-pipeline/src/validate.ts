/**
 * Validate: cross-check tidy + derived data; machine-readable report on
 * stdout; non-zero exit on any fail-level check (phase 4 gates data PRs on
 * this and pastes the report into the PR description).
 *
 * Checks:
 *  1. CHHS cross-check (network): DPSS countywide Medi-Cal persons_total per
 *     report month (sum of SPA-level figures, incl. the residual "unknown"
 *     area) vs DHCS's independently-published LA County certified-eligibles
 *     total (CKAN datastore). The sources measure different populations -
 *     DPSS counts DPSS-administered Medi-Cal persons, DHCS counts all
 *     certified eligibles (incl. state-administered aid codes) - so DPSS runs
 *     ~20% below DHCS structurally. Thresholds (tuned against Jan 2026, see
 *     the phase-3 plan decision log): fail when the DPSS/DHCS ratio leaves
 *     [0.65, 1.05], warn when it leaves [0.72, 1.0].
 *  2. Internal consistency (offline): per geography level, the sum of
 *     area-level persons_total should approximate the countywide figure
 *     (warn; boundary/suppression effects make exactness impossible).
 *     Community totals get a wider tolerance (apportionment drift expected).
 *  3. Crosswalk coverage (offline): zips present in tidy but missing from the
 *     crosswalk are reported (warn).
 *  4. Swing detection (offline): any geography whose age_0_5 moves more than
 *     +/-30% month-over-month is flagged (warn - likely a scrape/parse
 *     artifact rather than reality).
 *
 * CLI: bun run validate [--offline]   (--offline skips the CHHS fetch)
 */
import { readFileSync } from "node:fs";
import type { MapGeoFile, ReportMonth, TidyRow } from "@medi-cal-disenrollment/shared";
import { readTidyMonths, previousMonth, DATA_DERIVED_MAP_DIR, CROSSWALK_PATH } from "./derive";
import type { CrosswalkFile } from "@medi-cal-disenrollment/shared";
import { join } from "node:path";

export type CheckLevel = "pass" | "warn" | "fail";

export interface Check {
  id: string;
  level: CheckLevel;
  message: string;
  data?: unknown;
}

export interface ValidationReport {
  ok: boolean;
  generated_at: string;
  months: ReportMonth[];
  checks: Check[];
}

/** DPSS/DHCS ratio bounds (see module doc + phase-3 plan decision log). */
export const CHHS_RATIO_FAIL: [number, number] = [0.65, 1.05];
export const CHHS_RATIO_WARN: [number, number] = [0.72, 1.0];

const CHHS_RESOURCE_ID = "cc08b60f-393f-4e37-9b3e-976d7a9f2a72"; // "By Age Group and Sex, Certified Eligibles"
const CHHS_API = "https://data.chhs.ca.gov/api/3/action/datastore_search";
const USER_AGENT =
  "medi-cal-disenrollment-tracker/0.1 (validation cross-check; +https://github.com/erkie/medi-cal-disenrollment)";

/** Countywide Medi-Cal persons_total per month = sum over SPA areas (incl. "unknown"). */
export function countywidePersons(rowsByMonth: Map<ReportMonth, TidyRow[]>): Map<ReportMonth, number> {
  const out = new Map<ReportMonth, number>();
  for (const [month, rows] of rowsByMonth) {
    let sum = 0;
    let seen = false;
    for (const r of rows) {
      if (r.geo_type === "spa" && r.program === "medi-cal" && r.metric === "persons_total") {
        sum += r.value;
        seen = true;
      }
    }
    if (seen) out.set(month, sum);
  }
  return out;
}

/** Fetch DHCS LA County total certified eligibles for one month; null if unpublished. */
export async function fetchChhsLaCountyTotal(month: ReportMonth): Promise<number | null> {
  const params = new URLSearchParams({
    resource_id: CHHS_RESOURCE_ID,
    filters: JSON.stringify({ County: "Los Angeles", "Month of Eligibility": month }),
    limit: "100",
  });
  const res = await fetch(`${CHHS_API}?${params}`, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`CHHS API ${res.status}`);
  const body = (await res.json()) as {
    success: boolean;
    result?: { records?: { Gender: string; "Total Eligibles": string }[] };
  };
  if (!body.success) throw new Error("CHHS API success=false");
  const records = body.result?.records ?? [];
  if (records.length === 0) return null;
  let sum = 0;
  for (const r of records) {
    if (r.Gender === "Total") continue; // avoid double counting
    sum += Number(r["Total Eligibles"].replace(/,/g, ""));
  }
  return sum;
}

/** Evaluate one month's CHHS cross-check given both figures. */
export function chhsCheck(month: ReportMonth, dpss: number, chhs: number): Check {
  const ratio = dpss / chhs;
  const data = { month, dpss_persons_total: dpss, chhs_total_eligibles: chhs, ratio: Math.round(ratio * 1000) / 1000 };
  if (ratio < CHHS_RATIO_FAIL[0] || ratio > CHHS_RATIO_FAIL[1]) {
    return {
      id: `chhs-crosscheck:${month}`,
      level: "fail",
      message: `DPSS countywide persons_total is ${data.ratio}x the DHCS LA County total - outside [${CHHS_RATIO_FAIL}]`,
      data,
    };
  }
  if (ratio < CHHS_RATIO_WARN[0] || ratio > CHHS_RATIO_WARN[1]) {
    return {
      id: `chhs-crosscheck:${month}`,
      level: "warn",
      message: `DPSS countywide persons_total is ${data.ratio}x the DHCS LA County total - outside [${CHHS_RATIO_WARN}]`,
      data,
    };
  }
  return { id: `chhs-crosscheck:${month}`, level: "pass", message: `DPSS/DHCS ratio ${data.ratio}`, data };
}

/**
 * Per geography level: sum of area persons_total vs the countywide figure.
 * Warn-level only. Community uses a wider tolerance (apportionment drift).
 */
export function internalConsistencyChecks(
  rowsByMonth: Map<ReportMonth, TidyRow[]>,
  communityFile: MapGeoFile | null,
): Check[] {
  const countywide = countywidePersons(rowsByMonth);
  const checks: Check[] = [];
  const LEVELS: { geoType: TidyRow["geo_type"]; tolerance: number }[] = [
    { geoType: "zip", tolerance: 0.05 },
    { geoType: "congressional_district", tolerance: 0.05 },
    { geoType: "senate_district", tolerance: 0.05 },
    { geoType: "assembly_district", tolerance: 0.05 },
  ];
  for (const [month, rows] of rowsByMonth) {
    const county = countywide.get(month);
    if (county === undefined || county === 0) {
      checks.push({ id: `consistency:${month}`, level: "warn", message: "no SPA-level countywide figure" });
      continue;
    }
    for (const { geoType, tolerance } of LEVELS) {
      let sum = 0;
      let seen = false;
      for (const r of rows) {
        if (r.geo_type === geoType && r.program === "medi-cal" && r.metric === "persons_total") {
          sum += r.value;
          seen = true;
        }
      }
      if (!seen) {
        checks.push({ id: `consistency:${month}:${geoType}`, level: "warn", message: `no ${geoType} rows`, data: { month } });
        continue;
      }
      const rel = Math.abs(sum - county) / county;
      const data = { month, geo_type: geoType, level_sum: sum, countywide: county, rel_diff: Math.round(rel * 1000) / 1000 };
      checks.push({
        id: `consistency:${month}:${geoType}`,
        level: rel > tolerance ? "warn" : "pass",
        message: `${geoType} persons_total sums to ${data.rel_diff}x-off countywide`,
        data,
      });
    }
    // Community vs countywide: wider tolerance; read from the derived file.
    if (communityFile) {
      let sum = 0;
      for (const feature of Object.values(communityFile.features)) {
        const v = feature[month]?.persons_total;
        if (v !== undefined) sum += v;
      }
      const rel = Math.abs(sum - county) / county;
      const data = { month, geo_type: "community", level_sum: sum, countywide: county, rel_diff: Math.round(rel * 1000) / 1000 };
      checks.push({
        id: `consistency:${month}:community`,
        level: rel > 0.15 ? "warn" : "pass",
        message: `community collation sums to ${data.rel_diff}x-off countywide (apportionment drift expected)`,
        data,
      });
    }
  }
  return checks;
}

/** Zips in tidy but missing from the crosswalk (warn; excludes "unknown"). */
export function crosswalkCoverageChecks(
  rowsByMonth: Map<ReportMonth, TidyRow[]>,
  crosswalk: CrosswalkFile,
): Check[] {
  const covered = new Set(crosswalk.entries.map((e) => e.zip));
  const missing = new Set<string>();
  const present = new Set<string>();
  for (const rows of rowsByMonth.values()) {
    for (const r of rows) {
      if (r.geo_type !== "zip" || r.geo_id === "unknown") continue;
      present.add(r.geo_id);
      if (!covered.has(r.geo_id)) missing.add(r.geo_id);
    }
  }
  if (missing.size === 0) {
    return [{ id: "crosswalk-coverage", level: "pass", message: `all ${present.size} tidy zips are in the crosswalk` }];
  }
  return [
    {
      id: "crosswalk-coverage",
      level: "warn",
      message: `${missing.size} tidy zip(s) missing from the crosswalk - their figures reach no community`,
      data: { missing: [...missing].sort() },
    },
  ];
}

/**
 * Flag geographies whose age_0_5 swings more than +/-30% month-over-month.
 * A move from a prior value of 0 has no percentage (derive emits a null pct
 * with a non-null delta) but is an extreme swing by definition - flagged too.
 */
export function swingChecks(mapFiles: MapGeoFile[], thresholdPct = 30): Check[] {
  const flagged: { geo_type: string; geo_id: string; month: string; pct: number | null; delta?: number }[] = [];
  for (const file of mapFiles) {
    for (const [geoId, byMonth] of Object.entries(file.features)) {
      for (const [month, fm] of Object.entries(byMonth)) {
        if (fm.age_0_5_mom_pct !== null && Math.abs(fm.age_0_5_mom_pct) > thresholdPct) {
          flagged.push({ geo_type: file.geo_type, geo_id: geoId, month, pct: fm.age_0_5_mom_pct });
        } else if (fm.age_0_5_mom_pct === null && fm.age_0_5_mom_delta !== null && fm.age_0_5_mom_delta !== 0) {
          flagged.push({ geo_type: file.geo_type, geo_id: geoId, month, pct: null, delta: fm.age_0_5_mom_delta });
        }
      }
    }
  }
  if (flagged.length === 0) {
    return [{ id: "swing-detection", level: "pass", message: `no geography moved age_0_5 more than +/-${thresholdPct}% month-over-month` }];
  }
  return [
    {
      id: "swing-detection",
      level: "warn",
      message: `${flagged.length} geography-month(s) moved age_0_5 more than +/-${thresholdPct}% - possible scrape/parse artifacts`,
      data: { flagged },
    },
  ];
}

export function buildReport(months: ReportMonth[], checks: Check[]): ValidationReport {
  return {
    ok: !checks.some((c) => c.level === "fail"),
    generated_at: new Date().toISOString(),
    months,
    checks,
  };
}

if (import.meta.main) {
  const offline = process.argv.includes("--offline");
  const rowsByMonth = readTidyMonths();
  const months = [...rowsByMonth.keys()].sort();
  const checks: Check[] = [];

  if (months.length === 0) {
    checks.push({ id: "tidy-present", level: "fail", message: "no tidy months under data/tidy/ - run normalize first" });
  }

  const mapFiles: MapGeoFile[] = [];
  for (const geoType of ["zip", "spa", "congressional_district", "senate_district", "assembly_district", "community"]) {
    try {
      mapFiles.push(JSON.parse(readFileSync(join(DATA_DERIVED_MAP_DIR, `${geoType}.json`), "utf8")) as MapGeoFile);
    } catch {
      checks.push({ id: `derived-present:${geoType}`, level: "fail", message: `data/derived/map/${geoType}.json missing or unreadable - run derive first` });
    }
  }
  const communityFile = mapFiles.find((f) => f.geo_type === "community") ?? null;

  if (months.length > 0) {
    // 1. CHHS cross-check.
    if (offline) {
      checks.push({ id: "chhs-crosscheck", level: "warn", message: "skipped (--offline)" });
    } else {
      const county = countywidePersons(rowsByMonth);
      for (const month of months) {
        const dpss = county.get(month);
        if (dpss === undefined) {
          checks.push({ id: `chhs-crosscheck:${month}`, level: "warn", message: "no DPSS countywide figure to compare" });
          continue;
        }
        try {
          const chhs = await fetchChhsLaCountyTotal(month);
          if (chhs === null) {
            checks.push({ id: `chhs-crosscheck:${month}`, level: "warn", message: "month not yet published by CHHS", data: { month, dpss_persons_total: dpss } });
          } else {
            checks.push(chhsCheck(month, dpss, chhs));
          }
        } catch (err) {
          checks.push({ id: `chhs-crosscheck:${month}`, level: "warn", message: `CHHS fetch failed: ${(err as Error).message}` });
        }
      }
    }

    // 2-4. Offline checks.
    checks.push(...internalConsistencyChecks(rowsByMonth, communityFile));
    const crosswalk = JSON.parse(readFileSync(CROSSWALK_PATH, "utf8")) as CrosswalkFile;
    checks.push(...crosswalkCoverageChecks(rowsByMonth, crosswalk));
    checks.push(...swingChecks(mapFiles));
  }

  const report = buildReport(months, checks);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}
