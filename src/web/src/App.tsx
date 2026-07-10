import { useEffect } from "react";
import { useColorScale } from "./color/useColorScale";
import { BottomStrip } from "./components/BottomStrip";
import { ControlsCluster } from "./components/ControlsCluster";
import { DetailsPane } from "./components/DetailsPane";
import { Legend } from "./components/Legend";
import { Tooltip } from "./components/Tooltip";
import { useLayerData } from "./data/useLayerData";
import { MapView } from "./map/MapView";
import {
  AppStateProvider,
  resolveMonthIndex,
  useAppDispatch,
  useAppState,
} from "./state/store";

export function App() {
  return (
    <AppStateProvider>
      <Shell />
    </AppStateProvider>
  );
}

function Shell() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const layerData = useLayerData(state.layerId);
  const derived = layerData?.derived ?? null;

  const months = derived?.months ?? [];
  const month = months[resolveMonthIndex(state.monthIndex, months)] ?? null;
  const scale = useColorScale(derived, state.metric, month);
  const isChangeView = state.metric === "age_0_5_mom_pct";

  // Esc unpins (the About modal intercepts Esc for itself first).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") dispatch({ type: "clearPinned" });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch]);

  const hoveredCell =
    state.hovered && month
      ? derived?.features[state.hovered.geoId]?.[month]
      : undefined;

  return (
    <div className="app-shell">
      <MapView layerData={layerData} scale={scale} isChangeView={isChangeView} />
      {isChangeView && derived !== null && scale.isEmpty && (
        <div className="panel empty-state-note">
          Change requires two report months — one is published so far.
        </div>
      )}
      <div className="left-stack">
        <div className="details-slot">
          <DetailsPane derived={derived} month={month} />
        </div>
        <Legend scale={scale} loading={layerData === null} />
      </div>
      <ControlsCluster />
      <BottomStrip months={months} />
      {state.hovered && <Tooltip hovered={state.hovered} cell={hoveredCell} month={month} />}
    </div>
  );
}
