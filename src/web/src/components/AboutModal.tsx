import { useEffect, useRef } from "react";

const FOCUSABLE = 'button, a[href], input, [tabindex]:not([tabindex="-1"])';

interface AboutModalProps {
  onClose: () => void;
}

/**
 * Placeholder about/methodology modal: final copy comes later; the section
 * skeleton shows what it will hold. Focus-trapped; restores focus to the
 * trigger on close (the trigger is document.activeElement at mount).
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
        <p>About content forthcoming.</p>
        <h3>Data source</h3>
        <div className="skeleton-line" style={{ width: "82%" }} />
        <div className="skeleton-line" style={{ width: "64%" }} />
        <h3>Update cadence</h3>
        <div className="skeleton-line" style={{ width: "58%" }} />
        <h3>Community boundaries</h3>
        <p className="honesty-note">
          Community boundaries from the{" "}
          <a href="https://github.com/stiles/la-geography" target="_blank" rel="noreferrer">
            la-geography
          </a>{" "}
          project, a countywide extension of the LA Times Mapping LA neighborhoods.
        </p>
        <h3>Data-honesty notes</h3>
        <div className="skeleton-line" style={{ width: "90%" }} />
        <div className="skeleton-line" style={{ width: "86%" }} />
        <div className="skeleton-line" style={{ width: "71%" }} />
      </div>
    </div>
  );
}
