import { useEffect, useRef, useState } from "react";
import { useColorScale } from "./color/useColorScale";
import { BottomSheet } from "./components/BottomSheet";
import { BottomStrip } from "./components/BottomStrip";
import { ControlsCluster, ControlsPanel } from "./components/ControlsCluster";
import { DetailsPane } from "./components/DetailsPane";
import { Legend } from "./components/Legend";
import { MobileChrome } from "./components/MobileChrome";
import { Tooltip } from "./components/Tooltip";
import { useLayerData } from "./data/useLayerData";
import { useChromeInsets } from "./hooks/useChromeInsets";
import { useLayoutMode } from "./hooks/useLayoutMode";
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

type MobileSheet = "none" | "details" | "filters" | "legend";

function Shell() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { isMobile } = useLayoutMode();
  const chromeRef = useRef<HTMLElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const chromeInsets = useChromeInsets(chromeRef, dockRef);
  const [sheetBottomObstruction, setSheetBottomObstruction] = useState(0);
  const [mobileSheet, setMobileSheet] = useState<MobileSheet>("none");
  const prevPinnedRef = useRef(state.pinned);
  const prevIsMobileRef = useRef(isMobile);

  const layerData = useLayerData(state.layerId);
  const derived = layerData?.derived ?? null;

  const months = derived?.months ?? [];
  const month = months[resolveMonthIndex(state.monthIndex, months)] ?? null;
  const scale = useColorScale(derived, state.metric, month);
  const isChangeView = state.metric === "age_0_5_mom_pct";

  // Pin ↔ sheet state on mobile; reset ghost sheet when leaving mobile.
  useEffect(() => {
    if (!isMobile) {
      setMobileSheet("none");
      prevPinnedRef.current = state.pinned;
      prevIsMobileRef.current = isMobile;
      return;
    }

    const wasMobile = prevIsMobileRef.current;
    const wasPinned = prevPinnedRef.current;
    prevIsMobileRef.current = isMobile;
    prevPinnedRef.current = state.pinned;

    if (!wasMobile && state.pinned) {
      setMobileSheet("details");
      return;
    }

    if (!state.pinned && wasPinned) {
      setMobileSheet((s) => (s === "details" ? "none" : s));
    } else if (
      state.pinned &&
      (!wasPinned || state.pinned.geoId !== wasPinned.geoId)
    ) {
      setMobileSheet("details");
    }
  }, [isMobile, state.pinned]);

  // Esc: close sheet first (keep pin), then clear pin.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (mobileSheet !== "none") {
        setMobileSheet("none");
        return;
      }
      dispatch({ type: "clearPinned" });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch, mobileSheet]);

  const hoveredCell =
    state.hovered && month
      ? derived?.features[state.hovered.geoId]?.[month]
      : undefined;

  function toggleSheet(sheet: Exclude<MobileSheet, "none">) {
    setMobileSheet((s) => (s === sheet ? "none" : sheet));
  }

  function closeSheet() {
    setMobileSheet("none");
  }

  function openDetailsFromList() {
    setMobileSheet("details");
  }

  function openDetailsSheet() {
    setMobileSheet("details");
  }

  const shellClass = isMobile ? "app-shell layout-mobile" : "app-shell";
  const sheetOpen = isMobile && mobileSheet !== "none";

  return (
    <div className={shellClass} data-sheet-open={sheetOpen || undefined}>
      <div className="app-shell-main" {...(sheetOpen ? { inert: true } : {})}>
        <MapView
          layerData={layerData}
          scale={scale}
          isChangeView={isChangeView}
          chromeInsets={chromeInsets}
          sheetBottomObstruction={isMobile ? sheetBottomObstruction : 0}
          onPinnedRegionTap={isMobile ? openDetailsSheet : undefined}
        />
        {isChangeView && derived !== null && scale.isEmpty && (
          <div className="panel empty-state-note">
            Change requires two report months — one is published so far.
          </div>
        )}

        {isMobile && (
          <MobileChrome
            ref={chromeRef}
            onOpenFilters={() => toggleSheet("filters")}
            onOpenLegend={() => toggleSheet("legend")}
            onOpenDetails={openDetailsSheet}
            filtersOpen={mobileSheet === "filters"}
            legendOpen={mobileSheet === "legend"}
            detailsOpen={mobileSheet === "details"}
            hasPinned={state.pinned !== null}
          />
        )}

        <div className="left-stack">
          <DetailsPane derived={derived} month={month} />
          <Legend scale={scale} loading={layerData === null} />
        </div>
        <ControlsCluster />
        <BottomStrip ref={dockRef} months={months} />

        {!isMobile && state.hovered && (
          <Tooltip hovered={state.hovered} cell={hoveredCell} month={month} />
        )}
      </div>

      {isMobile && (
        <>
          <BottomSheet
            open={mobileSheet === "details"}
            onClose={closeSheet}
            title="Details"
            onSheetHeightChange={setSheetBottomObstruction}
          >
            <DetailsPane derived={derived} month={month} />
          </BottomSheet>
          <BottomSheet
            open={mobileSheet === "filters"}
            onClose={closeSheet}
            title="Filters"
            onSheetHeightChange={setSheetBottomObstruction}
          >
            <ControlsPanel showWordmark={false} onPinFromList={openDetailsFromList} />
          </BottomSheet>
          <BottomSheet
            open={mobileSheet === "legend"}
            onClose={closeSheet}
            title="Legend"
            onSheetHeightChange={setSheetBottomObstruction}
          >
            <Legend scale={scale} loading={layerData === null} />
          </BottomSheet>
        </>
      )}
    </div>
  );
}
