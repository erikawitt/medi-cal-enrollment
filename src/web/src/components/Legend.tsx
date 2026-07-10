import type { ColorScale } from "../color/ramp";
import { METRIC_LABELS, useAppState } from "../state/store";

interface LegendProps {
  scale: ColorScale;
  /** True while the active layer's data is still in flight. */
  loading: boolean;
}

/** Legend swatches + break labels (desktop dock left; mobile legend sheet). */
export function Legend({ scale, loading }: LegendProps) {
  const { metric } = useAppState();

  return (
    <div className="panel legend">
      <div className="micro-label legend-title">{METRIC_LABELS[metric]}</div>
      {loading ? (
        <div className="legend-empty">Loading…</div>
      ) : scale.legend.length === 0 ? (
        <div className="legend-empty">
          {metric === "age_0_5_mom_pct"
            ? "No disenrollment-trend data for this month yet."
            : "No published values for this month."}
        </div>
      ) : (
        <div className="legend-rows">
          {scale.legend.map((entry) => (
            <div className="legend-row" key={entry.label + entry.colorHex}>
              <span className="legend-swatch" style={{ background: entry.colorHex }} />
              <span>{entry.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
