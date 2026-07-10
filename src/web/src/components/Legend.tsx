import type { ColorScale } from "../color/ramp";
import { METRIC_LABELS, useAppState } from "../state/store";
import { MoM } from "./MoM";

interface LegendProps {
  scale: ColorScale;
  /** True while the active layer's data is still in flight. */
  loading: boolean;
}

/** Bottom-left legend: swatches + break labels from the color engine. */
export function Legend({ scale, loading }: LegendProps) {
  const { metric } = useAppState();
  const title =
    metric === "age_0_5_mom_pct" ? (
      <>
        <MoM /> change
      </>
    ) : (
      METRIC_LABELS[metric]
    );

  return (
    <div className="panel legend">
      <div className="micro-label legend-title">{title}</div>
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
