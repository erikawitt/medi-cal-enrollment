import { useMemo } from "react";
import type { FeatureRef } from "../state/store";
import { layerById, type LayerId } from "./layers";
import type { LayerData } from "./loadLayerData";

/** Which enrollment population drives the ranked decrease list. */
export type DecreasePopulation = "age_0_5" | "all_ages";

export interface TopDecreaseEntry {
  geoId: string;
  name: string;
  delta: number;
  featureRef: FeatureRef;
}

export interface TopDecreasesResult {
  entries: TopDecreaseEntry[];
  year: string | null;
}

function deltaField(population: DecreasePopulation): "age_0_5_mom_delta" | "persons_mom_delta" {
  return population === "age_0_5" ? "age_0_5_mom_delta" : "persons_mom_delta";
}

/**
 * Largest month-over-month absolute enrollment decreases for the active report
 * month, ranked for the sidebar list. Names come from boundary GeoJSON properties.
 */
export function useTopDecreases(
  layerId: LayerId,
  layerData: LayerData | null,
  month: string | null,
  population: DecreasePopulation,
  limit = 5,
): TopDecreasesResult {
  return useMemo(() => {
    if (!layerData || !month) return { entries: [], year: null };

    const { derived, boundaries } = layerData;
    const spec = layerById(layerId);
    const idProp = spec.boundaryIdProperty;
    const field = deltaField(population);

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
      const delta = cell?.[field];
      if (delta === null || delta === undefined || delta >= 0) continue;

      ranked.push({
        geoId,
        name: names.get(geoId) ?? geoId,
        delta,
        featureRef: {
          geoId,
          name: names.get(geoId) ?? geoId,
          props: propsById.get(geoId) ?? {},
        },
      });
    }

    ranked.sort((a, b) => a.delta - b.delta);

    const year = month.split("-")[0] ?? null;
    return { entries: ranked.slice(0, limit), year };
  }, [layerId, layerData, month, population, limit]);
}
