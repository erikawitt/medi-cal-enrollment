import { describe, expect, test } from "bun:test";
import type { CrosswalkFile, MapGeoFile, ReportMonth, TidyRow } from "@medi-cal-disenrollment/shared";
import {
  chhsCheck,
  countywidePersons,
  crosswalkCoverageChecks,
  internalConsistencyChecks,
  swingChecks,
  buildReport,
} from "../src/validate";

const row = (partial: Partial<TidyRow>): TidyRow => ({
  month: "2026-01",
  geo_type: "spa",
  geo_id: "spa-1",
  program: "medi-cal",
  metric: "persons_total",
  value: 0,
  ...partial,
});

function monthMap(rows: TidyRow[]): Map<ReportMonth, TidyRow[]> {
  const out = new Map<ReportMonth, TidyRow[]>();
  for (const r of rows) {
    if (!out.has(r.month)) out.set(r.month, []);
    out.get(r.month)!.push(r);
  }
  return out;
}

describe("countywidePersons", () => {
  test("sums SPA-level Medi-Cal persons_total including the unknown area", () => {
    const rows = monthMap([
      row({ geo_id: "spa-1", value: 100 }),
      row({ geo_id: "spa-2", value: 200 }),
      row({ geo_id: "unknown", value: 5 }),
      row({ geo_id: "spa-1", program: "calfresh", value: 999 }), // ignored
      row({ geo_id: "90001", geo_type: "zip", value: 999 }), // ignored
    ]);
    expect(countywidePersons(rows).get("2026-01")).toBe(305);
  });
});

describe("chhsCheck", () => {
  // DPSS structurally runs ~0.8x of DHCS's LA County certified-eligibles
  // total (different administered populations; see decision log).
  test("passes at the observed structural ratio", () => {
    expect(chhsCheck("2026-01", 3_200_000, 3_984_337).level).toBe("pass");
  });

  test("warns when the ratio drifts outside the warn band", () => {
    expect(chhsCheck("2026-01", 2_800_000, 3_984_337).level).toBe("warn"); // 0.70
  });

  test("fails on order-of-magnitude breakage", () => {
    expect(chhsCheck("2026-01", 320_000, 3_984_337).level).toBe("fail");
    expect(chhsCheck("2026-01", 6_000_000, 3_984_337).level).toBe("fail");
  });
});

describe("internalConsistencyChecks", () => {
  const rows = monthMap([
    row({ geo_id: "spa-1", value: 600 }),
    row({ geo_id: "spa-2", value: 400 }),
    row({ geo_type: "zip", geo_id: "90001", value: 980 }), // 2% off countywide
    row({ geo_type: "congressional_district", geo_id: "ca-23", value: 800 }), // 20% off
    row({ geo_type: "senate_district", geo_id: "sd-20", value: 1000 }),
    row({ geo_type: "assembly_district", geo_id: "ad-34", value: 1000 }),
  ]);

  test("passes levels within tolerance and warns on those outside", () => {
    const checks = internalConsistencyChecks(rows, null);
    const byId = Object.fromEntries(checks.map((c) => [c.id, c.level]));
    expect(byId["consistency:2026-01:zip"]).toBe("pass");
    expect(byId["consistency:2026-01:congressional_district"]).toBe("warn");
  });

  test("community totals use the derived file and a wider tolerance", () => {
    const community: MapGeoFile = {
      geo_type: "community",
      generated_at: "t",
      months: ["2026-01"],
      features: {
        florence: { "2026-01": { persons_total: 900, age_0_5_mom_delta: null, age_0_5_mom_pct: null, persons_mom_delta: null, persons_mom_pct: null, ethnicity: {}, citizenship: {} } },
      },
    };
    const checks = internalConsistencyChecks(rows, community);
    const c = checks.find((c) => c.id === "consistency:2026-01:community")!;
    expect(c.level).toBe("pass"); // 10% off, within the 15% community tolerance
  });
});

describe("crosswalkCoverageChecks", () => {
  const crosswalk: CrosswalkFile = {
    generated_at: "t",
    zip_source: "s",
    community_source: "s",
    method: "m",
    entries: [{ zip: "90001", community: "florence", overlap_fraction: 1 }],
  };

  test("passes when every tidy zip is covered ('unknown' is exempt)", () => {
    const rows = monthMap([
      row({ geo_type: "zip", geo_id: "90001" }),
      row({ geo_type: "zip", geo_id: "unknown" }),
    ]);
    expect(crosswalkCoverageChecks(rows, crosswalk)[0]!.level).toBe("pass");
  });

  test("warns and lists zips whose figures reach no community", () => {
    const rows = monthMap([row({ geo_type: "zip", geo_id: "99999" })]);
    const check = crosswalkCoverageChecks(rows, crosswalk)[0]!;
    expect(check.level).toBe("warn");
    expect((check.data as { missing: string[] }).missing).toEqual(["99999"]);
  });
});

describe("swingChecks", () => {
  const file = (pct: number | null): MapGeoFile => ({
    geo_type: "zip",
    generated_at: "t",
    months: ["2026-01", "2026-02"],
    features: {
      "90001": {
        "2026-02": { age_0_5: 100, age_0_5_mom_delta: -50, age_0_5_mom_pct: pct, persons_mom_delta: null, persons_mom_pct: null, ethnicity: {}, citizenship: {} },
      },
    },
  });

  test("flags month-over-month swings beyond +/-30%", () => {
    const checks = swingChecks([file(-33.3)]);
    expect(checks[0]!.level).toBe("warn");
  });

  test("ignores swings within the band and null deltas (single month)", () => {
    expect(swingChecks([file(-29.9)])[0]!.level).toBe("pass");
    expect(swingChecks([file(null)])[0]!.level).toBe("pass");
  });
});

describe("buildReport", () => {
  test("ok is false exactly when a fail-level check exists", () => {
    expect(buildReport(["2026-01"], [{ id: "x", level: "warn", message: "" }]).ok).toBe(true);
    expect(buildReport(["2026-01"], [{ id: "x", level: "fail", message: "" }]).ok).toBe(false);
  });
});
