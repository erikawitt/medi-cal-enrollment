import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MapGeoFile, TidyMonthFile } from "@medi-cal-disenrollment/shared";
import { DATA_DERIVED_MAP_DIR } from "../src/derive";
import { DATA_TIDY_DIR, rawReportMonths } from "../src/normalize";

/**
 * Contract conformance of the COMMITTED data files: every derived map file and
 * tidy month file must parse against the src/shared types (typed reads below
 * are the compile-time half; the assertions are the runtime half). Skipped
 * until the pipeline has produced files.
 */
const GEO_TYPES = ["zip", "spa", "congressional_district", "senate_district", "assembly_district", "community"];

describe("committed derived map files conform to the shared contract", () => {
  for (const geoType of GEO_TYPES) {
    const path = join(DATA_DERIVED_MAP_DIR, `${geoType}.json`);
    test.skipIf(!existsSync(path))(`${geoType}.json`, () => {
      const file: MapGeoFile = JSON.parse(readFileSync(path, "utf8"));
      expect(file.geo_type).toBe(geoType as MapGeoFile["geo_type"]);
      expect(file.months.length).toBeGreaterThan(0);
      expect([...file.months].sort()).toEqual(file.months);
      const earliest = file.months[0]!;
      for (const [featureId, byMonth] of Object.entries(file.features)) {
        expect(featureId).not.toBe("");
        for (const [month, fm] of Object.entries(byMonth)) {
          expect(file.months).toContain(month);
          // Deltas are null for the earliest available month (contract).
          if (month === earliest) {
            expect(fm.age_0_5_mom_delta).toBeNull();
            expect(fm.persons_mom_delta).toBeNull();
          }
          // Map-ready values are integers (community apportionment rounded).
          if (fm.age_0_5 !== undefined) expect(Number.isInteger(fm.age_0_5)).toBe(true);
          if (fm.persons_total !== undefined) expect(Number.isInteger(fm.persons_total)).toBe(true);
          for (const v of Object.values(fm.ethnicity)) expect(Number.isInteger(v)).toBe(true);
          for (const v of Object.values(fm.citizenship)) expect(Number.isInteger(v)).toBe(true);
        }
      }
    });
  }
});

describe("committed tidy files conform to the shared contract", () => {
  for (const month of rawReportMonths()) {
    const path = join(DATA_TIDY_DIR, `${month}.json`);
    test.skipIf(!existsSync(path))(`${month}.json`, () => {
      const rows: TidyMonthFile = JSON.parse(readFileSync(path, "utf8"));
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.month).toBe(month);
        expect(["medi-cal", "calfresh"]).toContain(r.program);
        expect(typeof r.value).toBe("number");
        if (r.metric !== "avg_benefit_per_case") expect(Number.isInteger(r.value)).toBe(true);
        if (r.geo_type === "zip") expect(r.geo_id).toMatch(/^(\d{5}|unknown)$/);
        if (r.geo_type === "spa") expect(r.geo_id).toMatch(/^(spa-\d|unknown)$/);
      }
    });
  }
});
