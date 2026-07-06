import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import type { AreaCapture } from "../src/vizql";
import { captureMetrics, normalizeMonth, toGeoId, serializeTidy } from "../src/normalize";
import type { TidyRow } from "@medi-cal-disenrollment/shared";

const countywide: AreaCapture = JSON.parse(
  readFileSync(new URL("./fixtures/countywide-2026-05.capture.json", import.meta.url), "utf8"),
);
const spa2: AreaCapture = JSON.parse(
  readFileSync(new URL("./fixtures/spa2-2026-05.capture.json", import.meta.url), "utf8"),
);

function metric(capture: AreaCapture, program: string, name: string): number | undefined {
  return captureMetrics(capture).find((m) => m.program === program && m.metric === name)?.value;
}

describe("captureMetrics - May 2026 countywide reference values (DPSS dashboard)", () => {
  test("Medi-Cal caseload", () => {
    expect(metric(countywide, "medi-cal", "persons_total")).toBe(3_153_672);
    expect(metric(countywide, "medi-cal", "cases_total")).toBe(1_910_584);
  });

  test("Medi-Cal age 0-5 buckets", () => {
    expect(metric(countywide, "medi-cal", "age_under_1")).toBe(35_222);
    expect(metric(countywide, "medi-cal", "age_1_2")).toBe(72_285);
    expect(metric(countywide, "medi-cal", "age_3_5")).toBe(120_036);
  });

  test("Medi-Cal citizenship marginal breakdown", () => {
    expect(metric(countywide, "medi-cal", "cit_citizen")).toBe(2_267_316);
    expect(metric(countywide, "medi-cal", "cit_documented")).toBe(368_320);
    expect(metric(countywide, "medi-cal", "cit_undocumented")).toBe(498_283);
    expect(metric(countywide, "medi-cal", "cit_other")).toBe(19_753);
  });

  test("persons 24 months back comes from the 2YearsPersons row", () => {
    expect(metric(countywide, "medi-cal", "persons_24mo_prior")).toBe(3_531_035);
    expect(metric(countywide, "calfresh", "persons_24mo_prior")).toBe(1_609_483);
  });

  test("Medi-Cal has no published avg benefit; CalFresh's is a float", () => {
    expect(metric(countywide, "medi-cal", "avg_benefit_per_case")).toBeUndefined();
    expect(metric(countywide, "calfresh", "avg_benefit_per_case")).toBeCloseTo(308.81, 1);
  });

  test("only Medi-Cal and CalFresh appear (all other programs dropped)", () => {
    const programs = new Set(captureMetrics(countywide).map((m) => m.program));
    expect([...programs].sort()).toEqual(["calfresh", "medi-cal"]);
  });

  test("published zeros are kept as zeros, not dropped", () => {
    // Zero and absent mean different things: a served 0 must become a row.
    const zeroCapture: AreaCapture = {
      formatVersion: 2,
      worksheets: {
        "Persons by Med-Cal": {
          vizDataColumns: [{ fieldCaption: "SUM(TNUM1)", dataType: "real", paneIndices: [0], columnIndices: [0] }],
          paneColumnsList: [{ vizPaneColumns: [{ valueIndices: [0] }] }],
        },
      },
      dataDictionary: { real: { "0": 0 } },
    };
    expect(captureMetrics(zeroCapture)).toEqual([
      { program: "medi-cal", metric: "persons_total", value: 0 },
    ]);
  });
});

describe("captureMetrics - internal reconciliation on a sub-county area (SPA 2)", () => {
  test("age buckets sum to persons_total for both programs", () => {
    for (const program of ["medi-cal", "calfresh"] as const) {
      const ms = captureMetrics(spa2).filter((m) => m.program === program);
      const persons = ms.find((m) => m.metric === "persons_total")!.value;
      const ageSum = ms.filter((m) => m.metric.startsWith("age_")).reduce((a, m) => a + m.value, 0);
      expect(ageSum).toBe(persons);
    }
  });

  test("citizenship sums to persons_total", () => {
    const ms = captureMetrics(spa2).filter((m) => m.program === "medi-cal");
    const persons = ms.find((m) => m.metric === "persons_total")!.value;
    const citSum = ms.filter((m) => m.metric.startsWith("cit_")).reduce((a, m) => a + m.value, 0);
    expect(citSum).toBe(persons);
  });

  test("ethnicity sums to persons_total", () => {
    const ms = captureMetrics(spa2).filter((m) => m.program === "medi-cal");
    const persons = ms.find((m) => m.metric === "persons_total")!.value;
    const ethSum = ms.filter((m) => m.metric.startsWith("eth_")).reduce((a, m) => a + m.value, 0);
    expect(ethSum).toBe(persons);
  });
});

describe("toGeoId", () => {
  test("maps DPSS area names to contract geo_ids", () => {
    expect(toGeoId("zip", "90001")).toBe("90001");
    expect(toGeoId("spa", "SPA 2")).toBe("spa-2");
    expect(toGeoId("congressional_district", "CD 23")).toBe("ca-23");
    expect(toGeoId("senate_district", "SSD 20")).toBe("sd-20");
    expect(toGeoId("assembly_district", "SAD 34")).toBe("ad-34");
    expect(toGeoId("spa", "Unknown")).toBe("unknown");
  });
});

describe("acceptance: normalize is byte-idempotent over committed raw", () => {
  const rawMonthDir = new URL("../../../data/raw/2026-01/", import.meta.url).pathname;
  test.skipIf(!existsSync(rawMonthDir))("normalizing 2026-01 twice yields identical bytes", () => {
    const a = normalizeMonth("2026-01", rawMonthDir);
    const b = normalizeMonth("2026-01", rawMonthDir);
    expect(serializeTidy(a.rows)).toBe(serializeTidy(b.rows));
    expect(a.report.skipped).toEqual(b.report.skipped);
  });
});

describe("serializeTidy", () => {
  test("deterministic: same rows always produce identical bytes", () => {
    const rows: TidyRow[] = [
      { month: "2026-01", geo_type: "spa", geo_id: "spa-1", program: "medi-cal", metric: "persons_total", value: 175474 },
    ];
    expect(serializeTidy(rows)).toBe(serializeTidy(rows));
    expect(serializeTidy(rows)).toContain('"geo_id":"spa-1"');
    expect(JSON.parse(serializeTidy(rows))).toEqual(rows);
  });
});
