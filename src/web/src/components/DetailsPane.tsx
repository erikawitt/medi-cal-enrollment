import type { MapGeoFile } from "@medi-cal-disenrollment/shared";
import { useState } from "react";
import { DEFAULT_HUE, declineColorByLocalMax } from "../color/ramp";
import {
  formatCount,
  formatMonth,
  formatSignedCount,
  formatSignedPct,
} from "../data/format";
import { CITIZENSHIP_LABELS, ETHNICITY_LABELS } from "../data/metricLabels";
import { useAppDispatch, useAppState } from "../state/store";
import { MoM } from "./MoM";
import { Tooltip } from "./Tooltip";

/** Accessible summary mirroring the map tooltip rows for one month. */
function trendMonthAria(
  featureName: string,
  monthLabel: string,
  count: number | null,
  personsTotal: number | null,
): string {
  const ages =
    count !== null ? `Ages 0–5 ${formatCount(count)}` : "Ages 0–5 not published";
  const all =
    personsTotal !== null
      ? `All ages ${formatCount(personsTotal)}`
      : "All ages not published";
  return `${featureName}; ${monthLabel}; ${ages}; ${all}`;
}

const MARGINAL_NOTE =
  "Ethnicity and citizenship describe this geography's entire Medi-Cal population, not ages 0\u20135.";
const ESTIMATE_NOTE =
  "Community figures are estimates apportioned from zip-level data by area-weighted overlap.";

interface DetailsPaneProps {
  derived: MapGeoFile | null;
  month: string | null;
}

/**
 * Inset-left pane. Empty → hint; hovering → live preview; pinned → locked
 * with a PINNED chip and close affordance.
 */
export function DetailsPane({ derived, month }: DetailsPaneProps) {
  const { layerId, hovered, pinned } = useAppState();
  const dispatch = useAppDispatch();
  const feature = pinned ?? hovered;
  /** Strip column under the cursor — drives the shared map Tooltip for that month. */
  const [stripHoverMonth, setStripHoverMonth] = useState<string | null>(null);

  if (!feature) {
    return (
      <div className="panel details-pane">
        <div className="micro-label">Details</div>
        <div className="details-empty">Hover a region — click to pin.</div>
      </div>
    );
  }

  const byMonth = derived?.features[feature.geoId];
  const cell = month ? byMonth?.[month] : undefined;
  const months = derived?.months ?? [];
  const isCommunity = layerId === "community";

  /** Strip shows at most the latest 12 report months. */
  const stripMonths = months.length > 12 ? months.slice(-12) : months;
  const trendMonths = stripMonths.map((m) => ({
    month: m,
    count: byMonth?.[m]?.age_0_5 ?? null,
    personsTotal: byMonth?.[m]?.persons_total ?? null,
    delta: byMonth?.[m]?.age_0_5_mom_delta ?? null,
  }));
  const trendMagnitudes = trendMonths
    .map(({ delta }) => (delta === null ? null : Math.abs(delta)))
    .filter((v): v is number => v !== null);
  const trendMax = Math.max(1, ...trendMagnitudes);
  const maxDecline = Math.max(0, ...trendMonths.map(({ delta }) => (delta !== null && delta < 0 ? -delta : 0)));
  const trendSummary = trendMonths
    .map(({ month: m, count, personsTotal }) =>
      trendMonthAria(feature.name, formatMonth(m), count, personsTotal),
    )
    .join("; ");
  const stripHoverCell = stripHoverMonth ? byMonth?.[stripHoverMonth] : undefined;

  return (
    <div className="panel details-pane">
      <div className="pane-header">
        <div>
          <h1 className="pane-title">{feature.name}</h1>
        </div>
        {pinned ? (
          <span className="pinned-chip">
            <span className="micro-label">Pinned</span>
            <button
              type="button"
              className="pane-close"
              aria-label="Unpin"
              onClick={() => dispatch({ type: "clearPinned" })}
            >
              ✕
            </button>
          </span>
        ) : (
          <span className="micro-label">Hover</span>
        )}
      </div>

      <div className="big-number">
        {cell?.age_0_5 !== undefined ? formatCount(cell.age_0_5) : "\u2014"}
      </div>
      <div className="micro-label big-number-label">
        Ages 0–5 enrolled{month ? ` · ${formatMonth(month)}` : ""}
      </div>

      <div className="pane-stats">
        <div className="pane-stat">
          <span className="micro-label">All ages</span>
          <b>{cell?.persons_total !== undefined ? formatCount(cell.persons_total) : "not published"}</b>
        </div>
        {cell && cell.age_0_5_mom_delta !== null && (
          <div className="pane-stat">
            <span className="micro-label">
              <MoM /> change
            </span>
            <b>{formatSignedCount(cell.age_0_5_mom_delta)}</b>
          </div>
        )}
        {cell && cell.age_0_5_mom_pct !== null && (
          <div className="pane-stat">
            <span className="micro-label">
              <MoM /> change %
            </span>
            <b>{formatSignedPct(cell.age_0_5_mom_pct)}</b>
          </div>
        )}
      </div>

      <div className="pane-section">
        <div className="trend-header">
          <span className="micro-label">
            <MoM /> change · Ages 0–5
          </span>
          <span className="micro-label">
            {stripMonths.length === 1 ? "1 month" : `${stripMonths.length} months`}
          </span>
        </div>
        <div
          className="trend-strip"
          role="img"
          aria-label={trendSummary || "No month-over-month change data yet"}
          onMouseLeave={() => setStripHoverMonth(null)}
        >
          {trendMonths.map(({ month: m, delta }) => {
            const isFlat = delta === null || delta === 0;
            const barHeight = !isFlat
              ? `${Math.max(6, (Math.abs(delta) / trendMax) * 100)}%`
              : undefined;

            return (
              <div
                key={m}
                className="trend-col"
                data-active={month === m}
                data-null={delta === null}
                onMouseEnter={() => setStripHoverMonth(m)}
              >
                {isFlat ? (
                  <div className="trend-tick trend-tick--flat" />
                ) : (
                  <>
                    <div className="trend-half trend-half--up">
                      {delta > 0 && (
                        <div
                          className="trend-tick trend-tick--growth"
                          style={{ height: barHeight }}
                        />
                      )}
                    </div>
                    <div className="trend-half trend-half--down">
                      {delta < 0 && (
                        <div
                          className="trend-tick trend-tick--decline"
                          style={{
                            height: barHeight,
                            background: declineColorByLocalMax(-delta, maxDecline, DEFAULT_HUE),
                          }}
                        />
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
        {stripHoverMonth && (
          <Tooltip hovered={feature} cell={stripHoverCell} month={stripHoverMonth} />
        )}
      </div>

      <MarginalBars title="Ethnicity marginal breakdown" entries={ETHNICITY_LABELS} values={cell?.ethnicity} />
      <MarginalBars
        title="Citizenship marginal breakdown"
        entries={CITIZENSHIP_LABELS}
        values={cell?.citizenship}
      />

      <div className="pane-section">
        <p className="honesty-note">{MARGINAL_NOTE}</p>
        {isCommunity && <p className="honesty-note">{ESTIMATE_NOTE}</p>}
      </div>
    </div>
  );
}

interface MarginalBarsProps {
  title: string;
  entries: readonly [string, string][];
  values: Partial<Record<string, number>> | undefined;
}

function MarginalBars({ title, entries, values }: MarginalBarsProps) {
  const present = entries
    .map(([key, label]) => ({ label, count: values?.[key] }))
    .filter((e): e is { label: string; count: number } => e.count !== undefined);

  return (
    <div className="pane-section">
      <div className="micro-label">{title}</div>
      {present.length === 0 ? (
        <p className="honesty-note">not published</p>
      ) : (
        <div className="bar-list">
          {present.map(({ label, count }) => {
            const max = Math.max(1, ...present.map((e) => e.count));
            return (
              <div className="bar-row" key={label}>
                <span className="bar-label">{label}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${(count / max) * 100}%`, display: "block" }} />
                </span>
                <span className="bar-count">{formatCount(count)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
