import { forwardRef } from "react";

interface MobileChromeProps {
  onOpenFilters: () => void;
  onOpenLegend: () => void;
  onOpenDetails: () => void;
  filtersOpen: boolean;
  legendOpen: boolean;
  detailsOpen: boolean;
  hasPinned: boolean;
}

/** Fixed top bar on mobile: Filters, Details, wordmark, Legend. */
export const MobileChrome = forwardRef<HTMLElement, MobileChromeProps>(function MobileChrome(
  {
    onOpenFilters,
    onOpenLegend,
    onOpenDetails,
    filtersOpen,
    legendOpen,
    detailsOpen,
    hasPinned,
  },
  ref,
) {
  return (
    <header className="mobile-chrome" ref={ref}>
      <button
        type="button"
        className="chrome-btn"
        aria-pressed={filtersOpen}
        onClick={onOpenFilters}
      >
        Filters
      </button>
      <button
        type="button"
        className={`chrome-btn${hasPinned ? " chrome-btn--has-pin" : ""}`}
        aria-pressed={detailsOpen}
        disabled={!hasPinned}
        onClick={onOpenDetails}
      >
        Details
      </button>
      <div className="chrome-wordmark">
        <span className="crosshair-glyph">+</span> Medi-Cal
      </div>
      <button
        type="button"
        className="chrome-btn"
        aria-pressed={legendOpen}
        onClick={onOpenLegend}
      >
        Legend
      </button>
    </header>
  );
});
