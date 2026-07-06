/**
 * Schema authority for the project's committed data files (types only, no
 * logic). Uses the language of CONTEXT.md: report month, tidy data, derived
 * file, crosswalk, disenrollment trend, marginal breakdown, community.
 *
 * Contract invariants (all consumers may rely on these):
 *  - Additional report months slot in with ZERO schema change: tidy gains one
 *    file, derived map files gain entries in `months` and per-feature keys.
 *  - Missing/suppressed cells are OMITTED, never emitted as zero - zero and
 *    absent mean different things.
 *  - Marginal breakdowns (age, ethnicity, citizenship) are never
 *    cross-tabulated with each other; the schema cannot express a joint.
 *  - The disenrollment trend is exactly the month-over-month deltas in map
 *    files. Deltas are null for the earliest available month and across gaps
 *    in the month sequence - with a single report month committed, every
 *    delta is null. DPSS publishes no disenrollment flow; do not invent one.
 */

/** A report month key, `YYYY-MM` - the month a DPSS figure describes. */
export type ReportMonth = string;

/**
 * The six geography levels. The five scraped levels appear in tidy data;
 * `community` exists only in derived files (community figures are always
 * apportioned estimates via the crosswalk, never scraped).
 */
export type GeoType =
  | "zip"
  | "spa"
  | "congressional_district"
  | "senate_district"
  | "assembly_district"
  | "community";

export type ScrapedGeoType = Exclude<GeoType, "community">;

/** Programs kept in tidy data. Derived files are Medi-Cal only. */
export type Program = "medi-cal" | "calfresh";

/** DPSS age buckets (Age of Persons - a marginal breakdown). */
export type AgeMetric =
  | "age_under_1"
  | "age_1_2"
  | "age_3_5"
  | "age_6_12"
  | "age_13_15"
  | "age_16_17"
  | "age_18"
  | "age_19"
  | "age_20"
  | "age_21_24"
  | "age_25_59"
  | "age_60_65"
  | "age_over_65";

/** Ethnic origin of persons (marginal breakdown). */
export type EthnicityMetric =
  | "eth_aian"
  | "eth_asian"
  | "eth_black_african_american"
  | "eth_hispanic_latino"
  | "eth_nhpi"
  | "eth_white"
  | "eth_two_or_more"
  | "eth_other";

/** Citizenship status of persons (marginal breakdown). */
export type CitizenshipMetric = "cit_citizen" | "cit_documented" | "cit_undocumented" | "cit_other";

/** Caseload and application-processing metrics. */
export type CaseloadMetric =
  | "cases_total"
  | "persons_total"
  | "persons_24mo_prior"
  | "avg_benefit_per_case"
  | "apps_received_monthly";

export type Metric = CaseloadMetric | AgeMetric | EthnicityMetric | CitizenshipMetric;

/**
 * One tidy row: one (report month, geography, program, metric) observation.
 *
 * `geo_id` conventions: zip = 5-digit string; SPA = `spa-1`..`spa-8`;
 * congressional district = `ca-27` style; state senate district = `sd-18`
 * style; state assembly district = `ad-51` style (all lowercase, no
 * zero-padding). DPSS's residual "Unknown" area is kept as `unknown` - it
 * carries real published counts that countywide reconciliation needs; map
 * consumers skip it (no geometry exists for it).
 *
 * `value` is an integer except for `avg_benefit_per_case` (currency, float).
 */
export interface TidyRow {
  month: ReportMonth;
  geo_type: ScrapedGeoType;
  geo_id: string;
  program: Program;
  metric: Metric;
  value: number;
}

/** `data/tidy/{YYYY-MM}.json` - every tidy row of one report month. */
export type TidyMonthFile = TidyRow[];

/**
 * Per-month figures for one geography feature in a derived map file.
 * Medi-Cal only. `age_0_5 = age_under_1 + age_1_2 + age_3_5` (the project's
 * core subpopulation).
 *
 * `*_mom_delta` / `*_mom_pct` compare consecutive report months - the
 * disenrollment-trend signal. Null when the previous report month is absent
 * (earliest month, or a gap), or when the previous value is unpublished.
 * `*_mom_pct` is percent, one decimal.
 */
export interface MapFeatureMonth {
  age_0_5?: number;
  persons_total?: number;
  age_0_5_mom_delta: number | null;
  age_0_5_mom_pct: number | null;
  persons_mom_delta: number | null;
  persons_mom_pct: number | null;
  /** Ethnic-origin marginal breakdown (never cross-tabulated with age). */
  ethnicity: Partial<Record<EthnicityMetric, number>>;
  /** Citizenship-status marginal breakdown (never cross-tabulated with age). */
  citizenship: Partial<Record<CitizenshipMetric, number>>;
}

/**
 * `data/derived/map/{geo_type}.json` - one file per geography level, all
 * report months, shaped for direct map consumption and rewritten wholesale
 * each run.
 *
 * For `geo_type: "community"`, feature keys are la-geography community slugs
 * and every figure is an apportioned estimate (crosswalk-weighted zip sums,
 * rounded to integers in this file only). Community sums will not perfectly
 * reconcile with zip or countywide totals - expected apportionment drift,
 * not a bug.
 */
export interface MapGeoFile {
  geo_type: GeoType;
  generated_at: string;
  /** Report months present, ascending. */
  months: ReportMonth[];
  features: Record<string, Record<ReportMonth, MapFeatureMonth>>;
}

/** One `(zip, community, overlap_fraction)` triple of the crosswalk. */
export interface CrosswalkEntry {
  zip: string;
  /** la-geography comprehensive-neighborhoods layer slug. */
  community: string;
  /** Area fraction of the zip that overlaps the community; sums to 1 per zip. */
  overlap_fraction: number;
}

/** `data/crosswalk/zip-community.json` - phase 2's static artifact. */
export interface CrosswalkFile {
  generated_at: string;
  zip_source: string;
  community_source: string;
  method: string;
  entries: CrosswalkEntry[];
}
