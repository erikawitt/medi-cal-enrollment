import { describe, expect, test } from "bun:test";
import type { CrosswalkFile, ReportMonth, TidyRow } from "@medi-cal-disenrollment/shared";
import { buildMapGeoFile, collectCommunity, collectScraped, previousMonth } from "../src/derive";

const row = (partial: Partial<TidyRow>): TidyRow => ({
  month: "2026-01",
  geo_type: "zip",
  geo_id: "90001",
  program: "medi-cal",
  metric: "persons_total",
  value: 0,
  ...partial,
});

/** Worked example: one zip split 25%/75% across two communities. */
const crosswalk: CrosswalkFile = {
  generated_at: "t",
  zip_source: "s",
  community_source: "s",
  method: "m",
  entries: [
    { zip: "90001", community: "florence", overlap_fraction: 0.25 },
    { zip: "90001", community: "watts", overlap_fraction: 0.75 },
    { zip: "90002", community: "watts", overlap_fraction: 1 },
  ],
};

function monthMap(rows: TidyRow[]): Map<ReportMonth, TidyRow[]> {
  const out = new Map<ReportMonth, TidyRow[]>();
  for (const r of rows) {
    if (!out.has(r.month)) out.set(r.month, []);
    out.get(r.month)!.push(r);
  }
  return out;
}

describe("previousMonth", () => {
  test("steps back one report month, across year boundaries", () => {
    expect(previousMonth("2026-02")).toBe("2026-01");
    expect(previousMonth("2026-01")).toBe("2025-12");
  });
});

describe("collectScraped + buildMapGeoFile", () => {
  test("age_0_5 is the sum of the three young-child buckets", () => {
    const rows = monthMap([
      row({ metric: "age_under_1", value: 100 }),
      row({ metric: "age_1_2", value: 200 }),
      row({ metric: "age_3_5", value: 300 }),
      row({ metric: "persons_total", value: 5000 }),
    ]);
    const file = buildMapGeoFile("zip", ["2026-01"], collectScraped(rows, "zip"), "t");
    expect(file.features["90001"]!["2026-01"]!.age_0_5).toBe(600);
    expect(file.features["90001"]!["2026-01"]!.persons_total).toBe(5000);
  });

  test("age_0_5 is omitted when any young-child bucket is unpublished (absent != zero)", () => {
    const rows = monthMap([
      row({ metric: "age_under_1", value: 100 }),
      row({ metric: "age_3_5", value: 300 }),
      row({ metric: "persons_total", value: 5000 }),
    ]);
    const file = buildMapGeoFile("zip", ["2026-01"], collectScraped(rows, "zip"), "t");
    expect(file.features["90001"]!["2026-01"]!.age_0_5).toBeUndefined();
  });

  test("CalFresh rows never reach derived files", () => {
    const rows = monthMap([row({ program: "calfresh", metric: "persons_total", value: 9999 })]);
    const file = buildMapGeoFile("zip", ["2026-01"], collectScraped(rows, "zip"), "t");
    expect(Object.keys(file.features)).toEqual([]);
  });

  test("marginal breakdowns are nested, never cross-tabulated", () => {
    const rows = monthMap([
      row({ metric: "eth_hispanic_latino", value: 900 }),
      row({ metric: "cit_citizen", value: 800 }),
    ]);
    const file = buildMapGeoFile("zip", ["2026-01"], collectScraped(rows, "zip"), "t");
    const fm = file.features["90001"]!["2026-01"]!;
    expect(fm.ethnicity).toEqual({ eth_hispanic_latino: 900 });
    expect(fm.citizenship).toEqual({ cit_citizen: 800 });
  });
});

describe("acceptance: countywide May 2026 age_0_5", () => {
  test("rolls the three pinned young-child buckets up to 227543", () => {
    // Bucket values are the DPSS dashboard reference figures (also asserted
    // from the raw fixture in normalize.test.ts); 227543 is the pinned
    // acceptance value from docs/plans/phase-3-normalize.md.
    const rows = monthMap([
      row({ month: "2026-05", geo_type: "spa", geo_id: "countywide", metric: "age_under_1", value: 35_222 }),
      row({ month: "2026-05", geo_type: "spa", geo_id: "countywide", metric: "age_1_2", value: 72_285 }),
      row({ month: "2026-05", geo_type: "spa", geo_id: "countywide", metric: "age_3_5", value: 120_036 }),
    ]);
    const file = buildMapGeoFile("spa", ["2026-05"], collectScraped(rows, "spa"), "t");
    expect(file.features["countywide"]!["2026-05"]!.age_0_5).toBe(227_543);
  });
});

describe("month-over-month deltas (the disenrollment trend)", () => {
  const twoMonths = monthMap([
    row({ month: "2026-01", metric: "age_under_1", value: 100 }),
    row({ month: "2026-01", metric: "age_1_2", value: 200 }),
    row({ month: "2026-01", metric: "age_3_5", value: 300 }),
    row({ month: "2026-01", metric: "persons_total", value: 5000 }),
    row({ month: "2026-02", metric: "age_under_1", value: 90 }),
    row({ month: "2026-02", metric: "age_1_2", value: 190 }),
    row({ month: "2026-02", metric: "age_3_5", value: 286 }),
    row({ month: "2026-02", metric: "persons_total", value: 4900 }),
  ]);

  test("deltas are null for the earliest available month", () => {
    const file = buildMapGeoFile("zip", ["2026-01", "2026-02"], collectScraped(twoMonths, "zip"), "t");
    const jan = file.features["90001"]!["2026-01"]!;
    expect(jan.age_0_5_mom_delta).toBeNull();
    expect(jan.age_0_5_mom_pct).toBeNull();
    expect(jan.persons_mom_delta).toBeNull();
  });

  test("consecutive months produce delta and one-decimal percent", () => {
    const file = buildMapGeoFile("zip", ["2026-01", "2026-02"], collectScraped(twoMonths, "zip"), "t");
    const feb = file.features["90001"]!["2026-02"]!;
    expect(feb.age_0_5_mom_delta).toBe(-34); // 566 - 600
    expect(feb.age_0_5_mom_pct).toBe(-5.7); // -34/600
    expect(feb.persons_mom_delta).toBe(-100);
    expect(feb.persons_mom_pct).toBe(-2);
  });

  test("a gap in the month sequence yields null deltas, never a spanning delta", () => {
    const gap = monthMap([
      row({ month: "2026-01", metric: "persons_total", value: 5000 }),
      row({ month: "2026-03", metric: "persons_total", value: 4000 }),
    ]);
    const file = buildMapGeoFile("zip", ["2026-01", "2026-03"], collectScraped(gap, "zip"), "t");
    expect(file.features["90001"]!["2026-03"]!.persons_mom_delta).toBeNull();
  });

  test("a single report month yields null deltas everywhere (contract: trend undefined)", () => {
    const single = monthMap([row({ month: "2026-01", metric: "persons_total", value: 5000 })]);
    const file = buildMapGeoFile("zip", ["2026-01"], collectScraped(single, "zip"), "t");
    expect(file.features["90001"]!["2026-01"]!.persons_mom_delta).toBeNull();
    expect(file.features["90001"]!["2026-01"]!.persons_mom_pct).toBeNull();
  });
});

describe("collectCommunity - apportionment via the crosswalk", () => {
  test("community value = sum of zip value x overlap fraction, rounded only in output", () => {
    const rows = monthMap([
      row({ geo_id: "90001", metric: "persons_total", value: 1001 }),
      row({ geo_id: "90002", metric: "persons_total", value: 500 }),
    ]);
    const file = buildMapGeoFile("community", ["2026-01"], collectCommunity(rows, crosswalk), "t");
    // florence: 1001 * 0.25 = 250.25 -> 250; watts: 1001 * 0.75 + 500 = 1250.75 -> 1251
    expect(file.features["florence"]!["2026-01"]!.persons_total).toBe(250);
    expect(file.features["watts"]!["2026-01"]!.persons_total).toBe(1251);
  });

  test("deltas are computed on internal floats, then rounded", () => {
    const rows = monthMap([
      row({ month: "2026-01", geo_id: "90001", metric: "persons_total", value: 1000 }),
      row({ month: "2026-02", geo_id: "90001", metric: "persons_total", value: 900 }),
    ]);
    const file = buildMapGeoFile("community", ["2026-01", "2026-02"], collectCommunity(rows, crosswalk), "t");
    // florence: 250 -> 225, delta -25 exactly (floats 250.0, 225.0)
    expect(file.features["florence"]!["2026-02"]!.persons_mom_delta).toBe(-25);
    expect(file.features["florence"]!["2026-02"]!.persons_mom_pct).toBe(-10);
  });

  test("zips absent from the crosswalk (incl. 'unknown') contribute nothing", () => {
    const rows = monthMap([
      row({ geo_id: "99999", metric: "persons_total", value: 100 }),
      row({ geo_id: "unknown", metric: "persons_total", value: 100 }),
    ]);
    const file = buildMapGeoFile("community", ["2026-01"], collectCommunity(rows, crosswalk), "t");
    expect(Object.keys(file.features)).toEqual([]);
  });

  test("avg_benefit_per_case is not apportioned (averages do not sum across areas)", () => {
    const rows = monthMap([
      row({ geo_id: "90001", metric: "avg_benefit_per_case", value: 300.5 }),
      row({ geo_id: "90001", metric: "persons_total", value: 100 }),
    ]);
    const values = collectCommunity(rows, crosswalk);
    const florence = values.get("florence")!.get("2026-01")!;
    expect(florence.persons_total).toBeCloseTo(25, 5);
  });
});
