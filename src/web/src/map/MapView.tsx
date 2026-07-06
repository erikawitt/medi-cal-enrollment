import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-csp-worker.js?url";
import { useEffect, useRef, useState } from "react";
import {
  FILL_OPACITY,
  MISSING_HEX,
  MISSING_OPACITY,
  NEUTRAL_HEX,
  oklchToHex,
  type ColorScale,
} from "../color/ramp";
import { layerById } from "../data/layers";
import type { LayerData } from "../data/loadLayerData";
import {
  useAppDispatch,
  useAppState,
  type FeatureRef,
} from "../state/store";

// MapLibre normally spins up its worker by serializing internal functions
// via .toString() into a blob. Vite's production bundler (rolldown) can
// tree-shake or rename a helper those functions rely on, so the worker
// throws a silent "<x> is not defined" (visible only via the map's "error"
// event) and GeoJSON sources never render — reproduces in prod builds only,
// not `vite dev`. Pointing at the package's prebuilt CSP worker sidesteps
// the string-eval path entirely. See maplibre-gl-js issue #7339.
maplibregl.setWorkerUrl(maplibreWorkerUrl);

const LA_COUNTY_BOUNDS: [[number, number], [number, number]] = [
  [-118.95, 33.6],
  [-117.6, 34.9],
];

const SOURCE_ID = "active-boundaries";
const FILL_LAYER_ID = "choropleth-fill";
const LINE_LAYER_ID = "choropleth-line";

/**
 * Feature border / hover / pinned outline colors. The WebGL canvas can't
 * read CSS custom properties, so --ink and --accent are re-derived from the
 * hue here (same OKLCH definitions as the brief's :root block).
 */
function lineColorExpression(hue: number): unknown {
  return [
    "case",
    ["boolean", ["feature-state", "pinned"], false],
    oklchToHex(0.62, 0.24, hue), // --accent
    ["boolean", ["feature-state", "hover"], false],
    oklchToHex(0.24, 0.02, hue), // --ink
    "rgba(255,255,255,0.5)",
  ];
}

const LINE_WIDTH_EXPRESSION = [
  "case",
  ["boolean", ["feature-state", "pinned"], false],
  2.5,
  ["boolean", ["feature-state", "hover"], false],
  1.5,
  0.75,
] as unknown as number;

/** Id of the basemap's first symbol layer — data layers insert beneath labels. */
function firstSymbolLayerId(map: maplibregl.Map): string | undefined {
  return map.getStyle().layers.find((l) => l.type === "symbol")?.id;
}

function featureRef(feature: maplibregl.MapGeoJSONFeature, idProp: string): FeatureRef | null {
  const props = feature.properties ?? {};
  const geoId = props[idProp];
  if (typeof geoId !== "string") return null;
  const name = typeof props.name === "string" ? props.name : geoId;
  return { geoId, name, props };
}

interface MapViewProps {
  layerData: LayerData | null;
  scale: ColorScale;
  isChangeView: boolean;
  hue: number;
}

export function MapView({ layerData, scale, isChangeView, hue }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const { layerId, hovered, pinned } = useAppState();
  const dispatch = useAppDispatch();

  // Refs so stable map event handlers always see current values.
  const stateRef = useRef({ idProp: "", hoveredId: null as string | null, pinnedId: null as string | null });
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  stateRef.current.idProp = layerById(layerId).boundaryIdProperty;

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: `${import.meta.env.BASE_URL}basemap/style.json`,
      bounds: LA_COUNTY_BOUNDS,
      fitBoundsOptions: { padding: { left: 360, top: 24, right: 24, bottom: 24 } },
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.on("load", () => setMapReady(true));

    let rafId = 0;
    map.on("mousemove", (e) => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!map.getLayer(FILL_LAYER_ID)) return;
        const features = map.queryRenderedFeatures(e.point, { layers: [FILL_LAYER_ID] });
        const ref = features[0] ? featureRef(features[0], stateRef.current.idProp) : null;
        map.getCanvas().style.cursor = ref ? "pointer" : "";
        dispatchRef.current({ type: "setHovered", feature: ref });
      });
    });
    // DOM mouseleave on the container is more reliable than MapLibre's
    // mouseout for canvas→overlay-panel transitions: it fires whenever the
    // pointer enters any floating panel, so hovered state (and the tooltip)
    // never linger over UI chrome.
    const container = containerRef.current;
    const onMouseLeave = () => {
      cancelAnimationFrame(rafId);
      dispatchRef.current({ type: "setHovered", feature: null });
    };
    container.addEventListener("mouseleave", onMouseLeave);
    map.on("click", (e) => {
      if (!map.getLayer(FILL_LAYER_ID)) return;
      const features = map.queryRenderedFeatures(e.point, { layers: [FILL_LAYER_ID] });
      const ref = features[0] ? featureRef(features[0], stateRef.current.idProp) : null;
      if (ref) dispatchRef.current({ type: "togglePinned", feature: ref });
      else dispatchRef.current({ type: "clearPinned" });
    });

    return () => {
      cancelAnimationFrame(rafId);
      container.removeEventListener("mouseleave", onMouseLeave);
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  // (Re)build the boundary source + fill/line layers when the layer's data
  // arrives. promoteId lifts the join key into the feature id so
  // feature-state hover/pin works.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !layerData) return;
    const idProp = layerById(layerId).boundaryIdProperty;

    if (map.getLayer(FILL_LAYER_ID)) map.removeLayer(FILL_LAYER_ID);
    if (map.getLayer(LINE_LAYER_ID)) map.removeLayer(LINE_LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);

    map.addSource(SOURCE_ID, {
      type: "geojson",
      data: layerData.boundaries,
      promoteId: idProp,
    });

    const beforeId = firstSymbolLayerId(map);
    map.addLayer(
      {
        id: FILL_LAYER_ID,
        type: "fill",
        source: SOURCE_ID,
        paint: { "fill-color": MISSING_HEX, "fill-opacity": MISSING_OPACITY },
      },
      beforeId,
    );
    map.addLayer(
      {
        id: LINE_LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        paint: {
          "line-color": lineColorExpression(hue) as string,
          "line-width": LINE_WIDTH_EXPRESSION,
        },
      },
      beforeId,
    );
    // hue intentionally omitted: hue-only changes are handled by the paint
    // effects below without rebuilding the source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, layerData, layerId]);

  // Outline colors follow the hue live.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.getLayer(LINE_LAYER_ID)) return;
    map.setPaintProperty(LINE_LAYER_ID, "line-color", lineColorExpression(hue));
  }, [mapReady, layerData, hue]);

  // Choropleth paint: recomputed colors pushed as a match expression —
  // no refetch on metric/month/hue changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !layerData || !map.getLayer(FILL_LAYER_ID)) return;
    const idProp = layerById(layerId).boundaryIdProperty;

    if (scale.colorByGeoId.size === 0) {
      // Change view with all-null deltas: every feature in the neutral tone.
      const color = isChangeView && scale.isEmpty ? NEUTRAL_HEX : MISSING_HEX;
      const opacity = isChangeView && scale.isEmpty ? FILL_OPACITY : MISSING_OPACITY;
      map.setPaintProperty(FILL_LAYER_ID, "fill-color", color);
      map.setPaintProperty(FILL_LAYER_ID, "fill-opacity", opacity);
      return;
    }

    const colorPairs: unknown[] = [];
    const opacityPairs: unknown[] = [];
    for (const [geoId, hex] of scale.colorByGeoId) {
      colorPairs.push(geoId, hex);
      opacityPairs.push(geoId, FILL_OPACITY);
    }
    map.setPaintProperty(FILL_LAYER_ID, "fill-color", [
      "match",
      ["get", idProp],
      ...colorPairs,
      MISSING_HEX,
    ]);
    map.setPaintProperty(FILL_LAYER_ID, "fill-opacity", [
      "match",
      ["get", idProp],
      ...opacityPairs,
      MISSING_OPACITY,
    ]);
  }, [mapReady, layerData, layerId, scale, isChangeView]);

  // Hover/pin outlines via feature-state on the promoted id.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.getSource(SOURCE_ID)) return;
    const s = stateRef.current;
    const hoveredId = hovered?.geoId ?? null;
    const pinnedId = pinned?.geoId ?? null;
    if (s.hoveredId !== hoveredId) {
      if (s.hoveredId !== null)
        map.setFeatureState({ source: SOURCE_ID, id: s.hoveredId }, { hover: false });
      if (hoveredId !== null)
        map.setFeatureState({ source: SOURCE_ID, id: hoveredId }, { hover: true });
      s.hoveredId = hoveredId;
    }
    if (s.pinnedId !== pinnedId) {
      if (s.pinnedId !== null)
        map.setFeatureState({ source: SOURCE_ID, id: s.pinnedId }, { pinned: false });
      if (pinnedId !== null)
        map.setFeatureState({ source: SOURCE_ID, id: pinnedId }, { pinned: true });
      s.pinnedId = pinnedId;
    }
  }, [mapReady, hovered, pinned, layerData]);

  return <div ref={containerRef} className="map-canvas" data-testid="map" />;
}
