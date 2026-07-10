import type { ReportMonth } from "@medi-cal-disenrollment/shared";
import { forwardRef } from "react";
import { formatMonth } from "../data/format";
import { useLayoutMode } from "../hooks/useLayoutMode";
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
 * Bottom-center strip: metric segmented toggle + report-month time slider.
 * With a single month the slider renders disabled and the month label alone
 * carries the state.
 */
export const BottomStrip = forwardRef<HTMLDivElement, BottomStripProps>(function BottomStrip(
  { months },
  ref,
) {
  const { metric, monthIndex } = useAppState();
  const dispatch = useAppDispatch();
  const { isMobile } = useLayoutMode();
  const idx = resolveMonthIndex(monthIndex, months);
  const month = months[idx];
  const singleMonth = months.length <= 1;
  const labels = isMobile ? METRIC_LABELS_SHORT : METRIC_LABELS;

  return (
    <div className="panel bottom-strip" ref={ref}>
      <div className="segmented" role="group" aria-label="Metric">
        {METRICS.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={metric === m}
            aria-label={METRIC_LABELS[m]}
            onClick={() => dispatch({ type: "setMetric", metric: m })}
          >
            {labels[m]}
          </button>
        ))}
      </div>
      <div className="time-control">
        <span className="micro-label">Report month</span>
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
});
