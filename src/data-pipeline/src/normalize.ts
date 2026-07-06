/**
 * Normalize: data/raw/{YYYY-MM}/** -> data/tidy/{YYYY-MM}.json
 *
 * Turns each report month's raw captures (self-contained VizQL presModel
 * extracts, ADR 0003) into tidy long-format rows - one row per (report month,
 * geography, program, metric). Tidy keeps Medi-Cal and CalFresh only; all
 * other program columns are dropped here. Missing/suppressed cells are
 * omitted rows, not zeros (a published zero IS kept).
 *
 * Offline by contract: reads only committed files. Idempotent: running twice
 * over the same raw produces byte-identical tidy files (deterministic row
 * order and serialization; no timestamps).
 *
 * CLI: bun run normalize [--months=2026-01,...]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Metric, Program, ScrapedGeoType, TidyRow } from "@medi-cal-disenrollment/shared";
import { parseAreaCapture, reconstructWorksheet, type AreaCapture } from "./vizql";
import { DATA_RAW_DIR, readManifest } from "./capture";

export const DATA_TIDY_DIR = join(import.meta.dir, "..", "..", "..", "data", "tidy");

/** DPSS age-bucket labels -> canonical metric ids ("%all%" is skipped: it duplicates persons_total). */
const AGE_METRIC_BY_LABEL: Record<string, Metric> = {
  "Under 1": "age_under_1",
  "1-2": "age_1_2",
  "3-5": "age_3_5",
  "6-12": "age_6_12",
  "13-15": "age_13_15",
  "16-17": "age_16_17",
  "18": "age_18",
  "19": "age_19",
  "20": "age_20",
  "21-24": "age_21_24",
  "25-59": "age_25_59",
  "60-65": "age_60_65",
  "Over 65": "age_over_65",
};

/** DPSS ethnic-origin labels (whitespace-collapsed) -> canonical metric ids. */
const ETHNICITY_METRIC_BY_LABEL: Record<string, Metric> = {
  "American Indian/Alaska Native": "eth_aian",
  "Asian/Asian American": "eth_asian",
  "Black/African/African American": "eth_black_african_american",
  "Hispanic/Latino/a/x Chicano/a/x": "eth_hispanic_latino",
  "Native Hawaiian/Pacific Islander": "eth_nhpi",
  "White/European/European American": "eth_white",
  "Two or More Races/Ethnicities": "eth_two_or_more",
  "Other": "eth_other",
};

/** DPSS citizenship labels (trimmed) -> canonical metric ids. */
const CITIZENSHIP_METRIC_BY_LABEL: Record<string, Metric> = {
  "Citizen": "cit_citizen",
  "Documented Individual": "cit_documented",
  "Undocumented Individual": "cit_undocumented",
  "Other": "cit_other",
};

/** Worksheet names and the PROGRAM_CODE value, per program (Tableau's own spellings). */
const PROGRAM_SOURCES: Record<
  Program,
  {
    programCode: string;
    persons: string;
    cases: string;
    citizenship: string;
    personsEligible: string;
    avgBenefit: string;
    appsReceived: string;
  }
> = {
  "medi-cal": {
    programCode: "Medi-Cal",
    persons: "Persons by Med-Cal",
    cases: "Cases by Med-Cal",
    citizenship: "Citizenship Status by Med-Cal",
    personsEligible: "Medical_Persons Eligible",
    avgBenefit: "Avg Benefit Amount by Med-Cal",
    appsReceived: "Application Processing by Medi-Cal",
  },
  calfresh: {
    programCode: "CalFresh",
    persons: "Persons by CaFresh",
    cases: "Cases by CaFresh",
    citizenship: "Citizenship Status by CalFresh",
    personsEligible: "CalFresh_Persons Eligible",
    avgBenefit: "Avg Benefit Amount by CalFresh",
    appsReceived: "Application Processing by CalFresh",
  },
};

const collapseWhitespace = (s: string) => s.replace(/\s+/g, " ").trim();

/** One extracted observation, before geography/month context is attached. */
export interface CaptureMetric {
  program: Program;
  metric: Metric;
  value: number;
}

function countValue(v: string | number | null): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

/**
 * Extract every Medi-Cal/CalFresh metric a capture publishes. Cells that are
 * absent, null, or malformed are omitted (never zero-filled).
 */
export function captureMetrics(capture: AreaCapture): CaptureMetric[] {
  const out: CaptureMetric[] = [];
  const push = (program: Program, metric: Metric, value: number | null) => {
    if (value !== null) out.push({ program, metric, value });
  };

  for (const [program, src] of Object.entries(PROGRAM_SOURCES) as [
    Program,
    (typeof PROGRAM_SOURCES)[Program],
  ][]) {
    // Single-value worksheets.
    const single = (name: string): string | number | null => {
      const ws = reconstructWorksheet(capture, name);
      if (!ws) return null;
      const col = ws.captions.findIndex((c) => c != null && c !== "");
      return ws.rows[0]?.[col === -1 ? 1 : col] ?? null;
    };
    push(program, "persons_total", countValue(single(src.persons)));
    push(program, "cases_total", countValue(single(src.cases)));
    push(program, "apps_received_monthly", countValue(single(src.appsReceived)));

    // Average benefit is currency: keep finite floats, drop null (DPSS
    // publishes no per-case benefit for Medi-Cal at some levels).
    const avg = single(src.avgBenefit);
    if (typeof avg === "number" && Number.isFinite(avg)) {
      push(program, "avg_benefit_per_case", avg);
    }

    // Persons 24 months back: the "2YearsPersons" row of the persons-eligible
    // worksheet (its "Persons" row duplicates persons_total).
    const eligible = reconstructWorksheet(capture, src.personsEligible);
    if (eligible) {
      const s = eligible.captions.indexOf("SUBCATEGORY");
      const v = eligible.captions.indexOf("SUM(TNUM1)");
      const row = eligible.rows.find((r) => r[s] === "2YearsPersons");
      if (row) push(program, "persons_24mo_prior", countValue(row[v] ?? null));
    }

    // Citizenship status (marginal breakdown).
    const cit = reconstructWorksheet(capture, src.citizenship);
    if (cit) {
      const s = cit.captions.indexOf("SUBCATEGORY");
      const v = cit.captions.indexOf("SUM(TNUM1)");
      for (const row of cit.rows) {
        const label = typeof row[s] === "string" ? (row[s] as string).trim() : null;
        const metric = label != null ? CITIZENSHIP_METRIC_BY_LABEL[label] : undefined;
        if (metric) push(program, metric, countValue(row[v] ?? null));
      }
    }
  }

  // Age and ethnicity live in shared by-program worksheets.
  for (const [name, table] of [
    ["Age og Eligible Persons by Program", AGE_METRIC_BY_LABEL],
    ["Etnic origin by Program", ETHNICITY_METRIC_BY_LABEL],
  ] as const) {
    const ws = reconstructWorksheet(capture, name);
    if (!ws) continue;
    const p = ws.captions.indexOf("PROGRAM_CODE");
    const s = ws.captions.indexOf("SUBCATEGORY");
    const v = ws.captions.indexOf("AGG(LookUp TNUM)");
    for (const row of ws.rows) {
      const program = (Object.entries(PROGRAM_SOURCES) as [Program, { programCode: string }][]).find(
        ([, src]) => src.programCode === row[p],
      )?.[0];
      if (!program) continue;
      const label = typeof row[s] === "string" ? collapseWhitespace(row[s] as string) : null;
      const metric = label != null ? table[label] : undefined;
      if (metric) push(program, metric, countValue(row[v] ?? null));
    }
  }

  return out;
}

/** Map a manifest geoId (DPSS's area name) to the contract's geo_id. */
export function toGeoId(geoType: ScrapedGeoType, geoId: string): string {
  if (geoId === "Unknown") return "unknown";
  switch (geoType) {
    case "zip":
      return geoId;
    case "spa":
      return `spa-${geoId.replace(/^SPA\s+/, "")}`;
    case "congressional_district":
      return `ca-${geoId.replace(/^CD\s+/, "")}`;
    case "senate_district":
      return `sd-${geoId.replace(/^SSD\s+/, "")}`;
    case "assembly_district":
      return `ad-${geoId.replace(/^SAD\s+/, "")}`;
  }
}

export const SCRAPED_GEO_TYPES: ScrapedGeoType[] = [
  "zip",
  "spa",
  "congressional_district",
  "senate_district",
  "assembly_district",
];

export interface NormalizeReport {
  month: string;
  rows: number;
  areas: number;
  /** Area files that were absent or failed to parse as v2 captures. */
  skipped: { geoType: string; geoId: string; reason: string }[];
}

/** Normalize one report month's raw captures into tidy rows. */
export function normalizeMonth(month: string, rawMonthDir: string): { rows: TidyRow[]; report: NormalizeReport } {
  const report: NormalizeReport = { month, rows: 0, areas: 0, skipped: [] };
  const rows: TidyRow[] = [];

  const manifest = readManifest(month);
  for (const geoType of SCRAPED_GEO_TYPES) {
    const entry = manifest?.geoTypes.find((g) => g.geoType === geoType);
    if (!entry) {
      report.skipped.push({ geoType, geoId: "*", reason: "geo type missing from manifest" });
      continue;
    }
    for (const area of entry.areas) {
      const path = join(rawMonthDir, geoType, area.file);
      if (!existsSync(path)) {
        report.skipped.push({ geoType, geoId: area.geoId, reason: "file missing" });
        continue;
      }
      const capture = parseAreaCapture(readFileSync(path, "utf8"));
      if (!capture) {
        report.skipped.push({ geoType, geoId: area.geoId, reason: "not a v2 capture" });
        continue;
      }
      const geoId = toGeoId(geoType, area.geoId);
      const metrics = captureMetrics(capture);
      if (metrics.length === 0) {
        report.skipped.push({ geoType, geoId: area.geoId, reason: "no Medi-Cal/CalFresh metrics" });
        continue;
      }
      report.areas++;
      for (const m of metrics) {
        rows.push({ month, geo_type: geoType, geo_id: geoId, program: m.program, metric: m.metric, value: m.value });
      }
    }
  }

  rows.sort(
    (a, b) =>
      a.geo_type.localeCompare(b.geo_type) ||
      a.geo_id.localeCompare(b.geo_id) ||
      a.program.localeCompare(b.program) ||
      a.metric.localeCompare(b.metric),
  );
  report.rows = rows.length;
  return { rows, report };
}

/** Deterministic serialization: one row per line, stable key order. */
export function serializeTidy(rows: TidyRow[]): string {
  const lines = rows.map((r) =>
    JSON.stringify({
      month: r.month,
      geo_type: r.geo_type,
      geo_id: r.geo_id,
      program: r.program,
      metric: r.metric,
      value: r.value,
    }),
  );
  return `[\n${lines.join(",\n")}\n]\n`;
}

/** Report months on disk under data/raw (sorted ascending). */
export function rawReportMonths(): string[] {
  if (!existsSync(DATA_RAW_DIR)) return [];
  return readdirSync(DATA_RAW_DIR)
    .filter((d) => /^\d{4}-\d{2}$/.test(d))
    .sort();
}

if (import.meta.main) {
  const monthsArg = process.argv
    .find((a) => a.startsWith("--months="))
    ?.split("=")[1]
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const months = monthsArg ?? rawReportMonths();
  if (months.length === 0) {
    console.error("[normalize] no report months under data/raw/");
    process.exit(1);
  }
  mkdirSync(DATA_TIDY_DIR, { recursive: true });
  let failed = false;
  for (const month of months) {
    const rawMonthDir = join(DATA_RAW_DIR, month);
    if (!existsSync(rawMonthDir)) {
      console.error(`[normalize] ${month}: no raw captures on disk, skipping`);
      failed = true;
      continue;
    }
    const { rows, report } = normalizeMonth(month, rawMonthDir);
    writeFileSync(join(DATA_TIDY_DIR, `${month}.json`), serializeTidy(rows));
    console.log(
      `[normalize] ${month}: ${report.areas} areas -> ${report.rows} tidy rows` +
        (report.skipped.length ? `; skipped ${report.skipped.length}: ${JSON.stringify(report.skipped.slice(0, 10))}` : ""),
    );
  }
  process.exit(failed ? 1 : 0);
}
