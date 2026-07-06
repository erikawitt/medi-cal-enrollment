import { useEffect, useState } from "react";
import type { LayerId } from "./layers";
import { loadLayerData, type LayerData } from "./loadLayerData";

/**
 * The active layer's boundary + derived data, or null while loading.
 * Backed by the module-level cache: switching back to a seen layer is
 * instant and never refetches.
 */
export function useLayerData(layerId: LayerId): LayerData | null {
  const [data, setData] = useState<LayerData | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    loadLayerData(layerId).then(
      (d) => {
        if (!cancelled) setData(d);
      },
      (err) => {
        console.error(`Failed to load layer ${layerId}:`, err);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [layerId]);

  return data;
}
