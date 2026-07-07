/**
 * Single application store: React context + reducer, no external state lib.
 * Every piece of interactive state lives here; components dispatch actions
 * and read slices via useAppState/useAppDispatch.
 */

import type { Program } from "@medi-cal-disenrollment/shared";
import {
  createContext,
  useContext,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import type { LayerId } from "../data/layers";

export type MetricId = "age_0_5" | "age_0_5_mom_pct";

export const METRIC_LABELS: Record<MetricId, string> = {
  age_0_5: "Medi-Cal Enrollment Ages 0-5",
  age_0_5_mom_pct: "Month-Over-Month change",
};

/** A feature the cursor is over (hovered) or that a click locked (pinned). */
export interface FeatureRef {
  geoId: string;
  name: string;
  /** The boundary feature's GeoJSON properties (community type/region etc). */
  props: Record<string, unknown>;
}

export interface AppState {
  layerId: LayerId;
  program: Program;
  metric: MetricId;
  /** Index into the active derived file's months array; −1 = latest. */
  monthIndex: number;
  hovered: FeatureRef | null;
  pinned: FeatureRef | null;
}

const initialState: AppState = {
  layerId: "community",
  program: "medi-cal",
  metric: "age_0_5",
  monthIndex: -1,
  hovered: null,
  pinned: null,
};

export type AppAction =
  | { type: "setLayer"; layerId: LayerId }
  | { type: "setProgram"; program: Program }
  | { type: "setMetric"; metric: MetricId }
  | { type: "setMonthIndex"; monthIndex: number }
  | { type: "setHovered"; feature: FeatureRef | null }
  | { type: "togglePinned"; feature: FeatureRef }
  | { type: "clearPinned" };

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "setLayer":
      if (action.layerId === state.layerId) return state;
      // Selections don't survive a layer change; month resets to latest.
      return { ...state, layerId: action.layerId, monthIndex: -1, hovered: null, pinned: null };
    case "setProgram":
      return { ...state, program: action.program };
    case "setMetric":
      return { ...state, metric: action.metric };
    case "setMonthIndex":
      return { ...state, monthIndex: action.monthIndex };
    case "setHovered": {
      const prev = state.hovered;
      if (prev === action.feature || (prev && action.feature && prev.geoId === action.feature.geoId))
        return state;
      return { ...state, hovered: action.feature };
    }
    case "togglePinned":
      if (state.pinned?.geoId === action.feature.geoId) return { ...state, pinned: null };
      return { ...state, pinned: action.feature };
    case "clearPinned":
      if (!state.pinned) return state;
      return { ...state, pinned: null };
  }
}

const StateContext = createContext<AppState>(initialState);
const DispatchContext = createContext<Dispatch<AppAction>>(() => {});

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </StateContext.Provider>
  );
}

export function useAppState(): AppState {
  return useContext(StateContext);
}

export function useAppDispatch(): Dispatch<AppAction> {
  return useContext(DispatchContext);
}

/** Resolve monthIndex (−1 = latest) against a months array. */
export function resolveMonthIndex(monthIndex: number, months: readonly string[]): number {
  if (monthIndex < 0 || monthIndex >= months.length) return months.length - 1;
  return monthIndex;
}
