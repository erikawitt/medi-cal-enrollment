import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  SessionDictionary,
  extractWorksheets,
  buildAreaCapture,
  reconstructWorksheet,
  parseVizqlBody,
  parseAreaCapture,
  captureHasData,
  type AreaCapture,
} from "../src/vizql";

/**
 * Fixtures: v2 self-contained captures built from real VizQL bodies the phase-1
 * spike recorded against the live embed (report month May 2026) — see
 * fixtures/generate-fixtures.ts. Reference values below come from an
 * independent source of truth: the figures printed on the DPSS dashboard,
 * pinned in docs/plans/phase-1-scraper.md.
 */
const countywide: AreaCapture = JSON.parse(
  readFileSync(new URL("./fixtures/countywide-2026-05.capture.json", import.meta.url), "utf8"),
);
const spa2: AreaCapture = JSON.parse(
  readFileSync(new URL("./fixtures/spa2-2026-05.capture.json", import.meta.url), "utf8"),
);

/** Read a single measure value from a one-row "<X> by Med-Cal" worksheet. */
function singleValue(c: AreaCapture, worksheet: string, caption: string): number {
  const ws = reconstructWorksheet(c, worksheet);
  if (!ws) throw new Error(`worksheet missing: ${worksheet}`);
  const col = ws.captions.indexOf(caption);
  return ws.rows[0]![col] as number;
}

/** Read one (program, bucket) value from a by-program worksheet. */
function byProgram(c: AreaCapture, worksheet: string, program: string, bucket: string): number {
  const ws = reconstructWorksheet(c, worksheet)!;
  const p = ws.captions.indexOf("PROGRAM_CODE");
  const s = ws.captions.indexOf("SUBCATEGORY");
  const v = ws.captions.indexOf("AGG(LookUp TNUM)");
  const row = ws.rows.find((r) => r[p] === program && r[s] === bucket);
  if (!row) throw new Error(`no ${program} ${bucket} row in ${worksheet}`);
  return row[v] as number;
}

/** Read a citizenship value from a citizenship-by-program worksheet. */
function citizenship(c: AreaCapture, worksheet: string, status: string): number {
  const ws = reconstructWorksheet(c, worksheet)!;
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

describe("v2 capture shape", () => {
  test("captures are self-contained: worksheets plus the referenced dictionary entries", () => {
    for (const c of [countywide, spa2]) {
      expect(c.formatVersion).toBe(2);
      expect(Object.keys(c.worksheets).length).toBeGreaterThan(40);
      expect(Object.keys(c.dataDictionary)).toContain("real");
      expect(Object.keys(c.dataDictionary)).toContain("cstring");
    }
  });

  test("parseAreaCapture accepts v2 files and rejects the old frame-array format", () => {
    expect(parseAreaCapture(JSON.stringify(countywide))?.formatVersion).toBe(2);
    expect(parseAreaCapture(JSON.stringify([{ dataSegments: {} }]))).toBeNull();
    expect(parseAreaCapture("not json")).toBeNull();
  });

  test("captureHasData accepts real captures and rejects empty ones", () => {
    expect(captureHasData(countywide)).toBe(true);
    expect(captureHasData(spa2)).toBe(true);
    expect(captureHasData({ formatVersion: 2, worksheets: {}, dataDictionary: {} })).toBe(false);
  });

  test("captureHasData requires the Medi-Cal headline specifically (CalFresh alone is not enough)", () => {
    const calfreshOnly: AreaCapture = {
      formatVersion: 2,
      worksheets: {
        "Persons by CaFresh": {
          vizDataColumns: [{ fieldCaption: "SUM(TNUM1)", dataType: "real", paneIndices: [0], columnIndices: [0] }],
          paneColumnsList: [{ vizPaneColumns: [{ valueIndices: [0] }] }],
        },
      },
      dataDictionary: { real: { "0": 123 } },
    };
    expect(captureHasData(calfreshOnly)).toBe(false);
  });
});

describe("May 2026 countywide Medi-Cal reference values (DPSS dashboard)", () => {
  test("caseload: Cases and Persons", () => {
    expect(singleValue(countywide, "Cases by Med-Cal", "SUM(TNUM1)")).toBe(1_910_584);
    expect(singleValue(countywide, "Persons by Med-Cal", "SUM(TNUM1)")).toBe(3_153_672);
  });

  test("citizenship status of persons (marginal breakdown)", () => {
    expect(citizenship(countywide, "Citizenship Status by Med-Cal", "Citizen")).toBe(2_267_316);
    expect(citizenship(countywide, "Citizenship Status by Med-Cal", "Documented Individual")).toBe(368_320);
    expect(citizenship(countywide, "Citizenship Status by Med-Cal", "Undocumented Individual")).toBe(498_283);
    expect(citizenship(countywide, "Citizenship Status by Med-Cal", "Other")).toBe(19_753);
  });

  test("age 0-5 buckets (the subpopulation this project tracks)", () => {
    expect(byProgram(countywide, "Age og Eligible Persons by Program", "Medi-Cal", "Under 1")).toBe(35_222);
    expect(byProgram(countywide, "Age og Eligible Persons by Program", "Medi-Cal", "1-2")).toBe(72_285);
    expect(byProgram(countywide, "Age og Eligible Persons by Program", "Medi-Cal", "3-5")).toBe(120_036);
  });

  test("returns null for an unknown worksheet", () => {
    expect(reconstructWorksheet(countywide, "No Such Worksheet")).toBeNull();
  });
});

describe("SPA 2 capture (session-cumulative select delta)", () => {
  test("resolves values shipped in earlier session segments, not just its own delta", () => {
    // SPA 2's marginal breakdowns internally reconcile: buckets sum to the
    // program total. This fails if cross-segment dictionary references break.
    const persons = singleValue(spa2, "Persons by Med-Cal", "SUM(TNUM1)");
    expect(persons).toBeGreaterThan(100_000);
    const ws = reconstructWorksheet(spa2, "Citizenship Status by Med-Cal")!;
    const v = ws.captions.indexOf("SUM(TNUM1)");
    const total = ws.rows.reduce((acc, r) => acc + (r[v] as number), 0);
    expect(total).toBe(persons);
  });

  test("age buckets for Medi-Cal and CalFresh sum to their persons totals", () => {
    for (const [program, personsWs] of [
      ["Medi-Cal", "Persons by Med-Cal"],
      ["CalFresh", "Persons by CaFresh"],
    ] as const) {
      const persons = singleValue(spa2, personsWs, "SUM(TNUM1)");
      const ws = reconstructWorksheet(spa2, "Age og Eligible Persons by Program")!;
      const p = ws.captions.indexOf("PROGRAM_CODE");
      const s = ws.captions.indexOf("SUBCATEGORY");
      const v = ws.captions.indexOf("AGG(LookUp TNUM)");
      const sum = ws.rows
        .filter((r) => r[p] === program && r[s] !== "%all%")
        .reduce((acc, r) => acc + (r[v] as number), 0);
      expect(sum).toBe(persons);
    }
  });
});

describe("SessionDictionary + extraction", () => {
  test("segments mutate by key: re-served keys replace, null deletes (spike 39)", () => {
    const seg = (key: string, values: number[] | null) =>
      JSON.stringify({
        dataDictionary: {
          dataSegments: {
            [key]: values === null ? null : { dataColumns: [{ dataType: "real", dataValues: values }] },
          },
        },
      });
    const d = new SessionDictionary();
    d.addBody(seg("0", [1, 2]));
    d.addBody(seg("1", [3]));
    expect(d.pools().real).toEqual([1, 2, 3]);
    d.addBody(seg("0", [7, 8, 9])); // view reset: segment 0 re-served with new content
    d.addBody(seg("1", null)); // and segment 1 deleted
    expect(d.pools().real).toEqual([7, 8, 9]);
    d.addBody(seg("1", [4])); // later delta reuses the freed key
    expect(d.pools().real).toEqual([7, 8, 9, 4]);
  });

  test("buildAreaCapture keeps only referenced dictionary entries, at original indices", () => {
    const d = new SessionDictionary();
    d.addBody(
      JSON.stringify({
        dataDictionary: {
          dataSegments: {
            "0": { dataColumns: [{ dataType: "real", dataValues: [10, 20, 30, 40] }] },
          },
        },
      }),
    );
    const worksheets = {
      "Persons by Med-Cal": {
        vizDataColumns: [{ fieldCaption: "SUM(TNUM1)", dataType: "real", paneIndices: [0], columnIndices: [0] }],
        paneColumnsList: [{ vizPaneColumns: [{ valueIndices: [2], aliasIndices: [] }] }],
      },
    };
    const cap = buildAreaCapture(worksheets, d);
    expect(cap.dataDictionary.real).toEqual({ "2": 30 });
    expect(reconstructWorksheet(cap, "Persons by Med-Cal")!.rows[0]![0]).toBe(30);
    expect(captureHasData(cap)).toBe(true);
  });

  test("extractWorksheets reads the select-response zones shape", () => {
    const body = JSON.stringify({
      vqlCmdResponse: {
        layoutStatus: {
          applicationPresModel: {
            workbookPresModel: {
              dashboardPresModel: {
                zones: {
                  "7": {
                    worksheet: "Persons by Med-Cal",
                    presModelHolder: {
                      visual: {
                        vizData: {
                          paneColumnsData: {
                            vizDataColumns: [{ fieldCaption: "SUM(TNUM1)", dataType: "real" }],
                            paneColumnsList: [{ vizPaneColumns: [{ valueIndices: [0], aliasIndices: [] }] }],
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const ws = extractWorksheets([body]);
    expect(Object.keys(ws)).toEqual(["Persons by Med-Cal"]);
  });
});
