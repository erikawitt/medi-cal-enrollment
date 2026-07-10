import { useState } from "react";
import { formatSignedCount } from "../data/format";
import { useTopDecreases, type DecreasePopulation } from "../data/useTopDecreases";
import { useLayerData } from "../data/useLayerData";
import { useFinePointer } from "../hooks/useLayoutMode";
import { resolveMonthIndex, useAppDispatch, useAppState } from "../state/store";

/**
 * Collapsible sidebar list of the five largest MoM absolute enrollment
 * decreases for the active boundary layer and report month. Hover drives map
 * outline + details preview; click pins the selection.
 */
interface TopDecreaseListProps {
  onPinFromList?: () => void;
}

export function TopDecreaseList({ onPinFromList }: TopDecreaseListProps) {
  const { layerId, monthIndex, pinned } = useAppState();
  const dispatch = useAppDispatch();
  const layerData = useLayerData(layerId);
  const hasFinePointer = useFinePointer();
  const [open, setOpen] = useState(true);
  const [population, setPopulation] = useState<DecreasePopulation>("age_0_5");

  const derived = layerData?.derived ?? null;
  const months = derived?.months ?? [];
  const month = months[resolveMonthIndex(monthIndex, months)] ?? null;
  const { entries, year } = useTopDecreases(layerId, layerData, month, population);

  const title = year ? `Largest decreases · ${year}` : "Largest decreases";

  return (
    <div className="controls-group">
      <button
        type="button"
        className="section-disclosure"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="micro-label">{title}</span>
        <span className="section-disclosure-icon" aria-hidden="true">
          {open ? "−" : "+"}
        </span>
      </button>
      {open && (
        <>
          <div className="segmented" role="group" aria-label="Decrease population">
            <button
              type="button"
              aria-pressed={population === "age_0_5"}
              onClick={() => setPopulation("age_0_5")}
            >
              Ages 0–5
            </button>
            <button
              type="button"
              aria-pressed={population === "all_ages"}
              onClick={() => setPopulation("all_ages")}
            >
              All ages
            </button>
          </div>
          <ul className="layer-list top-decrease-list">
            {entries.length === 0 ? (
              <li className="top-decrease-empty">
                No month-over-month decreases for this report month.
              </li>
            ) : (
              entries.map((entry) => (
                <li key={entry.geoId}>
                  <button
                    type="button"
                    className="layer-option top-decrease-row"
                    data-active={pinned?.geoId === entry.geoId}
                    aria-label={`${entry.name}, ${formatSignedCount(entry.delta)}`}
                    {...(hasFinePointer
                      ? {
                          onMouseEnter: () =>
                            dispatch({ type: "setHovered", feature: entry.featureRef }),
                          onMouseLeave: () => dispatch({ type: "setHovered", feature: null }),
                        }
                      : {})}
                    onClick={() => {
                      const willPin = pinned?.geoId !== entry.geoId;
                      dispatch({ type: "togglePinned", feature: entry.featureRef });
                      if (!hasFinePointer && willPin) onPinFromList?.();
                    }}
                  >
                    <span className="top-decrease-name">{entry.name}</span>
                    <span className="top-decrease-value">{formatSignedCount(entry.delta)}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </>
      )}
    </div>
  );
}
