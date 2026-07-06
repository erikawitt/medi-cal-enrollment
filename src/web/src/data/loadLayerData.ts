import type { MapGeoFile } from "@medi-cal-disenrollment/shared";
import type { FeatureCollection } from "geojson";
import type { LayerId } from "./layers";
import { layerById } from "./layers";

export interface LayerData {
  boundaries: FeatureCollection;
  derived: MapGeoFile;
}

const cache = new Map<LayerId, Promise<LayerData>>();

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed (${res.status}): ${url}`);
  return res.json() as Promise<T>;
}

/**
 * Fetch a layer's boundary geojson and derived map file, exactly once per
 * layer per session (cached in memory; metric/month/hue changes never
 * refetch).
 */
export function loadLayerData(layerId: LayerId): Promise<LayerData> {
  let promise = cache.get(layerId);
  if (!promise) {
    const spec = layerById(layerId);
    promise = Promise.all([
      fetchJson<FeatureCollection>(spec.boundaryUrl),
      fetchJson<MapGeoFile>(spec.derivedUrl),
    ]).then(([boundaries, derived]) => {
      if (import.meta.env.DEV) warnJoinlessFeatures(layerId, boundaries, derived);
      return { boundaries, derived };
    });
    promise.catch(() => cache.delete(layerId));
    cache.set(layerId, promise);
  }
  return promise;
}

function warnJoinlessFeatures(
  layerId: LayerId,
  boundaries: FeatureCollection,
  derived: MapGeoFile,
): void {
  const idProp = layerById(layerId).boundaryIdProperty;
  const joinless = boundaries.features
    .map((f) => f.properties?.[idProp] as string | undefined)
    .filter((id) => id !== undefined && !(id in derived.features));
  if (joinless.length > 0) {
    console.warn(
      `[${layerId}] ${joinless.length} boundary feature(s) with no derived entry:`,
      joinless,
    );
  }
}
