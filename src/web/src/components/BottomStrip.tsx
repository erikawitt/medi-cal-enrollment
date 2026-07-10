import type { ReportMonth } from "@medi-cal-disenrollment/shared";
import { formatMonth } from "../data/format";
import {
  METRIC_LABELS,
  resolveMonthIndex,
  useAppDispatch,
  useAppState,
  type MetricId,
} from "../state/store";
import { MoM } from "./MoM";

const METRICS: readonly MetricId[] = ["age_0_5", "age_0_5_mom_pct"];

function metricLabel(m: MetricId) {
  if (m === "age_0_5_mom_pct")
    return (
      <>
        <MoM /> change
      </>
    );
  return METRIC_LABELS[m];
}

interface BottomStripProps {
  months: readonly ReportMonth[];
}

/**
 * Bottom-center strip: metric segmented toggle + report-month time slider.
 * With a single month the slider renders disabled and the month label alone
 * carries the state.
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
            onClick={() => dispatch({ type: "setMetric", metric: m })}
          >
            {metricLabel(m)}
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
}
