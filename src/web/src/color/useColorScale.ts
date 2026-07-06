import type { MapGeoFile } from "@medi-cal-disenrollment/shared";
import { useMemo } from "react";
import type { MetricId } from "../state/store";
import { changeScale, DEFAULT_HUE, enrollmentScale, type ColorScale } from "./ramp";

const EMPTY_SCALE: ColorScale = {
  colorByGeoId: new Map(),
  legend: [],
  breaks: [],
  isEmpty: true,
};

/**
 * The active choropleth scale for (derived file, metric, month).
 * Pure recomputation — no fetching, so metric/month changes are cheap.
 * The "unknown" geo_id (no geometry) is skipped.
 */
export function useColorScale(
  derived: MapGeoFile | null,
  metric: MetricId,
  month: string | null,
): ColorScale {
  return useMemo(() => {
    if (!derived || !month) return EMPTY_SCALE;
    const values = new Map<string, number>();
    for (const [geoId, byMonth] of Object.entries(derived.features)) {
      if (geoId === "unknown") continue;
      const cell = byMonth[month];
      if (!cell) continue;
      const value = metric === "age_0_5" ? cell.age_0_5 : cell.age_0_5_mom_pct;
      if (value !== undefined && value !== null) values.set(geoId, value);
    }
    return metric === "age_0_5"
      ? enrollmentScale(values, DEFAULT_HUE)
      : changeScale(values, DEFAULT_HUE);
  }, [derived, metric, month]);
}
