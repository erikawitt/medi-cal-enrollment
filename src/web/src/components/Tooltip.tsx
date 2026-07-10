import type { MapFeatureMonth } from "@medi-cal-disenrollment/shared";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { formatCount, formatMonth, formatSignedCount, formatSignedPct } from "../data/format";
import type { FeatureRef } from "../state/store";
import { MoM } from "./MoM";

const OFFSET = 12;

/**
 * Last known cursor position, tracked at module level so a freshly mounted
 * tooltip can seed its position instead of flashing at the stashed
 * off-screen coordinates until the next mousemove.
 */
const lastMouse = { x: -9999, y: -9999 };
window.addEventListener("mousemove", (e) => {
  lastMouse.x = e.clientX;
  lastMouse.y = e.clientY;
});

interface TooltipProps {
  hovered: FeatureRef;
  cell: MapFeatureMonth | undefined;
  month: string | null;
}

function momChangeValue(cell: MapFeatureMonth): string {
  const delta = cell.age_0_5_mom_delta;
  const pct = cell.age_0_5_mom_pct;
  if (delta === null || pct === null) return "no prior month";
  return `${formatSignedCount(delta)} (${formatSignedPct(pct)})`;
}

/**
 * Cursor-anchored tooltip (offset 12/12; flips near the right/bottom
 * viewport edges). Positioned imperatively from window mousemove so it never
 * re-renders per pixel. Portaled to document.body so `position: fixed` is
 * always viewport-relative — panel ancestors use `backdrop-filter`, which
 * would otherwise become the fixed containing block and skew the offset.
 */
export function Tooltip({ hovered, cell, month }: TooltipProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    function place(x: number, y: number) {
      if (!el) return;
      const { offsetWidth: w, offsetHeight: h } = el;
      let left = x + OFFSET;
      let top = y + OFFSET;
      if (left + w > window.innerWidth - 4) left = x - OFFSET - w;
      if (top + h > window.innerHeight - 4) top = y - OFFSET - h;
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    }
    function onMove(e: MouseEvent) {
      place(e.clientX, e.clientY);
    }
    place(lastMouse.x, lastMouse.y);
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  return createPortal(
    <div className="tooltip" ref={ref} style={{ left: -9999, top: -9999 }}>
      <div className="tooltip-name">{hovered.name}</div>
      {cell ? (
        <>
          <div className="tooltip-row">
            <span>Ages 0–5</span>
            <b>{cell.age_0_5 !== undefined ? formatCount(cell.age_0_5) : "not published"}</b>
          </div>
          <div className="tooltip-row">
            <span>All ages</span>
            <b>
              {cell.persons_total !== undefined
                ? formatCount(cell.persons_total)
                : "not published"}
            </b>
          </div>
          <div className="tooltip-row">
            <span>
              <MoM /> change
            </span>
            <b>{momChangeValue(cell)}</b>
          </div>
        </>
      ) : (
        <div className="tooltip-row">
          <span>not published</span>
        </div>
      )}
      {month && <div className="tooltip-row tooltip-month">{formatMonth(month)}</div>}
    </div>,
    document.body,
  );
}
