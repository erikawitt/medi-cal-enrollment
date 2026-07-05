import { describe, expect, test } from "bun:test";
import { monthLabelToKey, geoIdToFileStem } from "../src/capture";
import { extractRawCapture, captureHasData, type RawCaptureFrame } from "../src/vizql";

describe("monthLabelToKey", () => {
  test("maps a dropdown label to a report-month key", () => {
    expect(monthLabelToKey("May 2026")).toBe("2026-05");
    expect(monthLabelToKey("January 2026")).toBe("2026-01");
    expect(monthLabelToKey("December 2025")).toBe("2025-12");
  });

  test("rejects malformed labels", () => {
    expect(monthLabelToKey("Mayish 2026")).toBeNull();
    expect(monthLabelToKey("2026-05")).toBeNull();
  });
});

describe("geoIdToFileStem", () => {
  test("keeps zips intact and makes spaced labels filesystem-safe", () => {
    expect(geoIdToFileStem("90001")).toBe("90001");
    expect(geoIdToFileStem("SPA 2")).toBe("SPA_2");
    expect(geoIdToFileStem("CD 23")).toBe("CD_23");
    expect(geoIdToFileStem("Unknown")).toBe("Unknown");
  });
});

describe("extractRawCapture", () => {
  test("keeps dataSegments and presModelMap verbatim, drops geometry-only responses", () => {
    const bodies = [
      // A command-style delta carrying a data dictionary segment.
      JSON.stringify({
        vqlCmdResponse: {
          layoutStatus: {
            applicationPresModel: {
              dataDictionary: { dataSegments: { "2": { dataColumns: [{ dataType: "real", dataValues: [664193] }] } } },
              renderGeometry: { tiles: [1, 2, 3] },
            },
          },
        },
      }),
      // A geometry-only response with nothing data-bearing.
      JSON.stringify({ vqlCmdResponse: { layoutStatus: { some: "geometry" } } }),
    ];
    const frames = extractRawCapture(bodies);
    expect(frames).toHaveLength(1);
    expect(JSON.stringify(frames[0]!.dataSegments)).toContain("664193");
  });

  test("handles length-prefixed bootstrap frames", () => {
    const boot = { secondaryInfo: { presModelMap: { dataDictionary: {}, vizData: {} } } };
    const json = JSON.stringify(boot);
    const frames = extractRawCapture([`${json.length};${json}`]);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.presModelMap).toBeDefined();
  });

  test("keeps every dataSegments occurrence in a multi-delta response", () => {
    const body = JSON.stringify({
      vqlCmdResponse: {
        cmdResultList: [
          { commandReturn: { underlyingDataTable: { dataDictionary: { dataSegments: { "1": { dataColumns: [{ dataType: "cstring", dataValues: ["SSD 33|Checked"] }] } } } } } },
          { commandReturn: { underlyingDataTable: { dataDictionary: { dataSegments: { "2": { dataColumns: [{ dataType: "real", dataValues: [167866, 55123] }] } } } } } },
        ],
      },
    });
    const frames = extractRawCapture([body]);
    expect(frames).toHaveLength(2);
    const all = JSON.stringify(frames);
    expect(all).toContain("SSD 33|Checked");
    expect(all).toContain("167866");
  });
});

describe("captureHasData", () => {
  test("accepts frames carrying a real-value pool", () => {
    const frames: RawCaptureFrame[] = [
      { dataSegments: { "1": { dataColumns: [{ dataType: "real", dataValues: Array.from({ length: 26 }, (_, i) => i) }, { dataType: "cstring", dataValues: ["a"] }] } } },
    ];
    expect(captureHasData(frames)).toBe(true);
  });

  test("rejects checkbox-toggle-only responses (no figures)", () => {
    const frames: RawCaptureFrame[] = [
      { dataSegments: { "1": { dataColumns: [{ dataType: "cstring", dataValues: ["CD 23|Unchecked"] }] } } },
    ];
    expect(captureHasData(frames)).toBe(false);
  });

  test("rejects an empty capture", () => {
    expect(captureHasData([])).toBe(false);
  });
});
