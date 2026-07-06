import { describe, expect, test } from "bun:test";
import { monthLabelToKey, geoIdToFileStem } from "../src/capture";
import { areaFromResponse, GEO_TYPES } from "../src/embed";

describe("areaFromResponse", () => {
  const cd = GEO_TYPES.find((g) => g.geoType === "congressional_district")!;
  const spa = GEO_TYPES.find((g) => g.geoType === "spa")!;
  const zip = GEO_TYPES.find((g) => g.geoType === "zip")!;

  test("names an area from its re-rendered view title", () => {
    expect(areaFromResponse('..."Congressional District 23"...', cd)).toBe("CD 23");
    expect(areaFromResponse('..."Service Planning Area 3"...', spa)).toBe("SPA 3");
    expect(areaFromResponse('..."Zip Code 90001"...', zip)).toBe("90001");
  });

  test("maps the Unknown title to the Unknown area", () => {
    expect(areaFromResponse('"Congressional District Unknown"', cd)).toBe("Unknown");
  });

  test("returns null when no title of the type appears (focus release / list-only render)", () => {
    expect(areaFromResponse('"Congressional District|Unchecked" "CD 26|Checked"', cd)).toBeNull();
  });

  test("returns null when multiple areas' titles appear (cross-area layout dump)", () => {
    expect(areaFromResponse('"Congressional District 23" "Congressional District 26"', cd)).toBeNull();
  });

  test("ignores titles of other geo types", () => {
    expect(areaFromResponse('"State Senate District 20" "Congressional District 27"', cd)).toBe("CD 27");
  });
});

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

