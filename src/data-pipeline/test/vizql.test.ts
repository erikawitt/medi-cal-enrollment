import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  extractPresModel,
  parseVizqlBody,
  reconstructWorksheet,
  worksheetNames,
  type PresModel,
} from "../src/vizql";

/**
 * Fixture: a compact presModel extracted from the real May 2026 countywide
 * (Department-level) bootstrapSession response. Reference values below come from
 * an independent source of truth — the figures printed on the DPSS dashboard and
 * pinned in docs/plans/phase-1-scraper.md — not from the parser itself.
 */
const model: PresModel = JSON.parse(
  readFileSync(new URL("./fixtures/countywide-2026-05.presmodel.json", import.meta.url), "utf8"),
);

/** Read a single measure value from a one-row "<X> by Med-Cal" worksheet. */
function singleValue(m: PresModel, worksheet: string, caption: string): number {
  const ws = reconstructWorksheet(m, worksheet);
  if (!ws) throw new Error(`worksheet missing: ${worksheet}`);
  const col = ws.captions.indexOf(caption);
  return ws.rows[0]![col] as number;
}

/** Read a Medi-Cal age-bucket value from the age-by-program worksheet. */
function medCalAge(m: PresModel, bucket: string): number {
  const ws = reconstructWorksheet(m, "Age og Eligible Persons by Program")!;
  const p = ws.captions.indexOf("PROGRAM_CODE");
  const s = ws.captions.indexOf("SUBCATEGORY");
  const v = ws.captions.indexOf("AGG(LookUp TNUM)");
  const row = ws.rows.find((r) => r[p] === "Medi-Cal" && r[s] === bucket);
  if (!row) throw new Error(`no Medi-Cal ${bucket} row`);
  return row[v] as number;
}

/** Read a Medi-Cal citizenship value from the citizenship-by-program worksheet. */
function medCalCitizenship(m: PresModel, status: string): number {
  const ws = reconstructWorksheet(m, "Citizenship Status by Med-Cal")!;
  const s = ws.captions.indexOf("SUBCATEGORY");
  const v = ws.captions.indexOf("SUM(TNUM1)");
  const row = ws.rows.find((r) => r[s] === status);
  if (!row) throw new Error(`no citizenship ${status} row`);
  return row[v] as number;
}

describe("parseVizqlBody", () => {
  test("parses a plain single-object command body", () => {
    expect(parseVizqlBody('{"a":1}')).toEqual([{ a: 1 }]);
  });

  test("parses length-prefixed bootstrap frames", () => {
    const body = `7;{"a":1}9;{"b":[2]}`;
    expect(parseVizqlBody(body)).toEqual([{ a: 1 }, { b: [2] }]);
  });

  test("returns empty for unparseable input rather than throwing", () => {
    expect(parseVizqlBody("not json")).toEqual([]);
  });
});

describe("extractPresModel", () => {
  test("captures the dictionary value pools by dataType", () => {
    expect(Object.keys(model.dataDictionary).sort()).toEqual(["cstring", "datetime", "integer", "real"]);
    expect(model.dataDictionary.real!.length).toBeGreaterThan(100);
  });

  test("captures the data-bearing worksheets", () => {
    expect(worksheetNames(model)).toContain("Persons by Med-Cal");
    expect(worksheetNames(model)).toContain("Age og Eligible Persons by Program");
  });
});

describe("reconstructWorksheet — May 2026 countywide Medi-Cal reference values", () => {
  test("caseload: Cases and Persons", () => {
    expect(singleValue(model, "Cases by Med-Cal", "SUM(TNUM1)")).toBe(1_910_584);
    expect(singleValue(model, "Persons by Med-Cal", "SUM(TNUM1)")).toBe(3_153_672);
  });

  test("citizenship status of persons", () => {
    expect(medCalCitizenship(model, "Citizen")).toBe(2_267_316);
    expect(medCalCitizenship(model, "Documented Individual")).toBe(368_320);
    expect(medCalCitizenship(model, "Undocumented Individual")).toBe(498_283);
    expect(medCalCitizenship(model, "Other")).toBe(19_753);
  });

  test("age 0-5 buckets (the subpopulation this project tracks)", () => {
    expect(medCalAge(model, "Under 1")).toBe(35_222);
    expect(medCalAge(model, "1-2")).toBe(72_285);
    expect(medCalAge(model, "3-5")).toBe(120_036);
  });

  test("returns null for an unknown worksheet", () => {
    expect(reconstructWorksheet(model, "No Such Worksheet")).toBeNull();
  });
});
