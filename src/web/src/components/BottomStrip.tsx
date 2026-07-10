import type { ReportMonth } from "@medi-cal-disenrollment/shared";
import { formatMonth } from "../data/format";
import {
  METRIC_LABELS,
  METRIC_LABELS_SHORT,
  resolveMonthIndex,
  useAppDispatch,
  useAppState,
  type MetricId,
} from "../state/store";

const METRICS: readonly MetricId[] = ["age_0_5", "age_0_5_mom_pct"];

interface BottomStripProps {
  months: readonly ReportMonth[];
}

/**
 * Metric segmented toggle + report-month time slider.
 * Lives inside the shared bottom dock. Short labels are shown via CSS as the
 * dock reflows before the mobile breakpoint.
 */
export function BottomStrip({ months }: BottomStripProps) {
  const { metric, monthIndex } = useAppState();
  const dispatch = useAppDispatch();
  const idx = resolveMonthIndex(monthIndex, months);
  const month = months[idx];
  const singleMonth = months.length <= 1;

  return (
    <div className="panel bottom-strip">
      <div className="segmented" role="group" aria-label="Metric">
        {METRICS.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={metric === m}
            aria-label={METRIC_LABELS[m]}
            onClick={() => dispatch({ type: "setMetric", metric: m })}
          >
            <span className="metric-label metric-label--full">{METRIC_LABELS[m]}</span>
            <span className="metric-label metric-label--short">{METRIC_LABELS_SHORT[m]}</span>
          </button>
        ))}
      </div>
      <div className="time-control">
        <span className="micro-label time-control-label">Report month</span>
        <input
          type="range"
          min={0}
          max={Math.max(0, months.length - 1)}
          step={1}
          value={idx < 0 ? 0 : idx}
          disabled={singleMonth}
          aria-label="Report month"
          onChange={(e) => dispatch({ type: "setMonthIndex", monthIndex: Number(e.target.value) })}
        />
        <span className="month-label">{month ? formatMonth(month) : "\u2014"}</span>
      </div>
    </div>
  );
}
