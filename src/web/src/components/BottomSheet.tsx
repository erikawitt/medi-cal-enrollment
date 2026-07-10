import { useEffect, useRef } from "react";

const FOCUSABLE = 'button, a[href], input, [tabindex]:not([tabindex="-1"])';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  onSheetHeightChange?: (height: number) => void;
}

/**
 * Mobile bottom sheet: backdrop dismiss, focus trap (mirrors AboutModal),
 * restores focus to the trigger on close.
 */
export function BottomSheet({ open, onClose, title, children, onSheetHeightChange }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!open) {
      if (wasOpenRef.current) onSheetHeightChange?.(0);
      wasOpenRef.current = false;
      return;
    }
    wasOpenRef.current = true;
    const sheet = sheetRef.current;
    if (!sheet) return;

    const report = () => onSheetHeightChange?.(sheet.getBoundingClientRect().height);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(sheet);
    return () => {
      ro.disconnect();
      onSheetHeightChange?.(0);
    };
  }, [open, onSheetHeightChange]);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    sheetRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => previousFocus.current?.focus();
  }, [open]);

  if (!open) return null;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Tab") return;
    const focusables = sheetRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
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

  const titleId = `sheet-title-${title.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-header">
          <h2 id={titleId} className="sheet-title">
            {title}
          </h2>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
