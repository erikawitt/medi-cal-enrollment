import { useMemo } from "react";
import type { FeatureRef } from "../state/store";
import { layerById, type LayerId } from "./layers";
import type { LayerData } from "./loadLayerData";

export interface TopDecreaseEntry {
  geoId: string;
  name: string;
  pct: number;
  featureRef: FeatureRef;
}

export interface TopDecreasesResult {
  entries: TopDecreaseEntry[];
  year: string | null;
}

/**
 * Largest month-over-month % decreases for the active report month, ranked
 * for the sidebar list. Names come from boundary GeoJSON properties.
 */
export function useTopDecreases(
  layerId: LayerId,
  layerData: LayerData | null,
  month: string | null,
  limit = 5,
): TopDecreasesResult {
  return useMemo(() => {
    if (!layerData || !month) return { entries: [], year: null };

    const { derived, boundaries } = layerData;
    const spec = layerById(layerId);
    const idProp = spec.boundaryIdProperty;

    const names = new Map<string, string>();
    const propsById = new Map<string, Record<string, unknown>>();
    for (const feature of boundaries.features) {
      const props = feature.properties ?? {};
      const geoId = props[idProp];
      if (typeof geoId !== "string") continue;
      const name = typeof props.name === "string" ? props.name : geoId;
      names.set(geoId, name);
      propsById.set(geoId, props as Record<string, unknown>);
    }

    const ranked: TopDecreaseEntry[] = [];
    for (const [geoId, byMonth] of Object.entries(derived.features)) {
      if (geoId === "unknown") continue;
      const cell = byMonth[month];
      const pct = cell?.age_0_5_mom_pct;
      if (pct === null || pct === undefined || pct >= 0) continue;

      ranked.push({
        geoId,
        name: names.get(geoId) ?? geoId,
        pct,
        featureRef: {
          geoId,
          name: names.get(geoId) ?? geoId,
          props: propsById.get(geoId) ?? {},
        },
      });
    }

    ranked.sort((a, b) => a.pct - b.pct);

    const year = month.split("-")[0] ?? null;
    return { entries: ranked.slice(0, limit), year };
  }, [layerId, layerData, month, limit]);
}
