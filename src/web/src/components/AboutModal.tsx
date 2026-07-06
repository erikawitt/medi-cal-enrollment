import { useEffect, useRef } from "react";

const FOCUSABLE = 'button, a[href], input, [tabindex]:not([tabindex="-1"])';

interface AboutModalProps {
  onClose: () => void;
}

/**
 * About/methodology modal: data provenance, update cadence, boundary sources,
 * and dataset limitations. Focus-trapped; restores focus to the trigger on
 * close (the trigger is document.activeElement at mount).
 */
export function AboutModal({ onClose }: AboutModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    modalRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => previousFocus.current?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation(); // keep Esc from also unpinning the map feature
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const focusables = modalRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0] as HTMLElement;
    const last = focusables[focusables.length - 1] as HTMLElement;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="modal-header">
          <h2 id="about-title">
            <span className="crosshair-glyph">+</span> About
          </h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <h3>Data source</h3>
        <p>
          The{" "}
          <a
            href="https://myappse.dpss.lacounty.gov/pls/apexprod/f?p=AAGT:AAGT"
            target="_blank"
            rel="noreferrer"
          >
            data
          </a>{" "}
          for this project is derived from the County of Los Angeles&apos; Department of Public
          Social Services (DPSS) beginning in January 2026.
        </p>
        <h3>Update cadence</h3>
        <p>
          LA County enrollment data is reported on a monthly basis. This site will automatically
          update bi-monthly.
        </p>
        <h3>Community boundaries</h3>
        <p>
          Sourced from the{" "}
          <a href="https://github.com/stiles/la-geography" target="_blank" rel="noreferrer">
            la-geography
          </a>{" "}
          project, a countywide extension of the LA Times Mapping LA neighborhoods.
        </p>
        <h3>A Note on the Dataset</h3>
        <p className="honesty-note">
          This map groups ages under 1, 1-2, 3-5 into a single category for the purposes of
          understanding disenrollment trends among early childhood beneficiaries. Currently, the
          DPSS data does not disaggregate age by ethnicity nor citizenship status. The Ethnicity
          and Citizenship breakdown by region includes all persons enrolled in Medi-Cal and is
          intended to be corollary and to help assess potential disparities.
        </p>
      </div>
    </div>
  );
}
