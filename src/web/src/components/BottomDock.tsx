import type { ReportMonth } from "@medi-cal-disenrollment/shared";
import { forwardRef, useEffect, useRef } from "react";
import type { ColorScale } from "../color/ramp";
import { BottomStrip } from "./BottomStrip";
import { Legend } from "./Legend";

interface BottomDockProps {
  months: readonly ReportMonth[];
  scale: ColorScale;
  loading: boolean;
}

/**
 * Shared bottom dock: legend (bottom-left) | metric/time strip (centered) |
 * attribution host (right). Equal side columns keep the strip centered
 * without moving the legend from its original corner. On mobile the legend
 * side is hidden (legend lives in a sheet) and the dock becomes the fixed
 * bottom chrome measured via dockRef.
 */
export const BottomDock = forwardRef<HTMLDivElement, BottomDockProps>(
  function BottomDock({ months, scale, loading }, ref) {
    const innerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      const dock = innerRef.current;
      if (!dock) return;
      const shell = dock.closest(".app-shell");
      if (!(shell instanceof HTMLElement)) return;

      const syncHeight = () => {
        shell.style.setProperty("--bottom-dock-height", `${dock.offsetHeight}px`);
      };
      syncHeight();

      const ro = new ResizeObserver(syncHeight);
      ro.observe(dock);
      return () => {
        ro.disconnect();
        shell.style.removeProperty("--bottom-dock-height");
      };
    }, [scale, loading]);

    function setRefs(node: HTMLDivElement | null) {
      innerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    }

    return (
      <div className="bottom-dock" ref={setRefs}>
        <div className="bottom-dock-side bottom-dock-side--start">
          <Legend scale={scale} loading={loading} />
        </div>
        <div className="bottom-dock-center">
          <BottomStrip months={months} />
        </div>
        <div
          className="bottom-dock-side bottom-dock-side--end"
          data-attribution-host
        />
      </div>
    );
  },
);
