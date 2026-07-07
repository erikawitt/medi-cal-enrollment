import { useState } from "react";
import { formatSignedPct } from "../data/format";
import { useTopDecreases } from "../data/useTopDecreases";
import { useLayerData } from "../data/useLayerData";
import { resolveMonthIndex, useAppDispatch, useAppState } from "../state/store";

/**
 * Collapsible sidebar list of the five largest MoM % decreases for the
 * active boundary layer and report month. Hover drives map outline +
 * details preview; click pins the selection.
 */
export function TopDecreaseList() {
  const { layerId, monthIndex, pinned } = useAppState();
  const dispatch = useAppDispatch();
  const layerData = useLayerData(layerId);
  const [open, setOpen] = useState(true);

  const derived = layerData?.derived ?? null;
  const months = derived?.months ?? [];
  const month = months[resolveMonthIndex(monthIndex, months)] ?? null;
  const { entries, year } = useTopDecreases(layerId, layerData, month);

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
                  aria-label={`${entry.name}, ${formatSignedPct(entry.pct)}`}
                  onMouseEnter={() =>
                    dispatch({ type: "setHovered", feature: entry.featureRef })
                  }
                  onMouseLeave={() => dispatch({ type: "setHovered", feature: null })}
                  onClick={() => dispatch({ type: "togglePinned", feature: entry.featureRef })}
                >
                  <span className="top-decrease-name">{entry.name}</span>
                  <span className="top-decrease-pct">{formatSignedPct(entry.pct)}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
