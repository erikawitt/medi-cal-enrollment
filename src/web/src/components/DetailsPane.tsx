import type { MapGeoFile } from "@medi-cal-disenrollment/shared";
import {
  formatCount,
  formatMonth,
  formatSignedCount,
  formatSignedPct,
} from "../data/format";
import { CITIZENSHIP_LABELS, ETHNICITY_LABELS } from "../data/metricLabels";
import { useAppDispatch, useAppState } from "../state/store";

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

  const trendValues = months.map((m) => byMonth?.[m]?.age_0_5 ?? null);
  const trendMax = Math.max(1, ...trendValues.filter((v): v is number => v !== null));

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
            <span className="micro-label">Month-Over-Month change</span>
            <b>{formatSignedCount(cell.age_0_5_mom_delta)}</b>
          </div>
        )}
        {cell && cell.age_0_5_mom_pct !== null && (
          <div className="pane-stat">
            <span className="micro-label">Month-Over-Month change %</span>
            <b>{formatSignedPct(cell.age_0_5_mom_pct)}</b>
          </div>
        )}
      </div>

      <div className="pane-section">
        <div className="trend-header">
          <span className="micro-label">Trend · Ages 0–5</span>
          <span className="micro-label">
            {months.length === 1 ? "1 month" : `${months.length} months`}
          </span>
        </div>
        <div className="trend-strip" aria-hidden="true">
          {trendValues.map((v, i) => (
            <div
              key={months[i]}
              className="trend-tick"
              data-active={month === months[i]}
              data-null={v === null}
              style={{ height: v !== null ? `${Math.max(6, (v / trendMax) * 100)}%` : "2px" }}
              title={months[i] ? formatMonth(months[i] as string) : undefined}
            />
          ))}
        </div>
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
