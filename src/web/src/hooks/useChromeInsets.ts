import { useEffect, useState, type RefObject } from "react";
import { useLayoutMode } from "./useLayoutMode";

export const DESKTOP_CHROME_INSETS = { left: 360, top: 24, right: 24, bottom: 24 } as const;
const MOBILE_SIDE_INSET = 16;

export interface ChromeInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const MOBILE_FALLBACK: ChromeInsets = {
  top: 44,
  bottom: 96,
  left: MOBILE_SIDE_INSET,
  right: MOBILE_SIDE_INSET,
};

function setChromeCssVars(top: number, bottom: number) {
  document.documentElement.style.setProperty("--chrome-top", `${top}px`);
  document.documentElement.style.setProperty("--chrome-bottom", `${bottom}px`);
}

/**
 * Measured map padding insets from chrome + dock. Desktop returns fixed
 * constants; mobile observes `.mobile-chrome` and `.bottom-strip` heights.
 */
export function useChromeInsets(
  chromeRef: RefObject<HTMLElement | null>,
  dockRef: RefObject<HTMLElement | null>,
): ChromeInsets {
  const { isMobile } = useLayoutMode();
  const [insets, setInsets] = useState<ChromeInsets>(() =>
    isMobile ? MOBILE_FALLBACK : { ...DESKTOP_CHROME_INSETS },
  );

  useEffect(() => {
    if (!isMobile) {
      setInsets({ ...DESKTOP_CHROME_INSETS });
      setChromeCssVars(DESKTOP_CHROME_INSETS.top, DESKTOP_CHROME_INSETS.bottom);
      return;
    }

    const chromeEl = chromeRef.current;
    const dockEl = dockRef.current;
    if (!chromeEl || !dockEl) return;

    const update = () => {
      const top = chromeEl.getBoundingClientRect().height;
      const bottom = dockEl.getBoundingClientRect().height;
      setInsets({ top, bottom, left: MOBILE_SIDE_INSET, right: MOBILE_SIDE_INSET });
      setChromeCssVars(top, bottom);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(chromeEl);
    ro.observe(dockEl);
    return () => ro.disconnect();
  }, [isMobile, chromeRef, dockRef]);

  return insets;
}
