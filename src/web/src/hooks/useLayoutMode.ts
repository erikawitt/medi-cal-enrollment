import { useEffect, useState } from "react";

export const MOBILE_QUERY = "(max-width: 767px)";
export const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

export function useLayoutMode() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return { isMobile };
}

export function useFinePointer() {
  const [hasFinePointer, setHasFinePointer] = useState(
    () => typeof window !== "undefined" && window.matchMedia(FINE_POINTER_QUERY).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(FINE_POINTER_QUERY);
    const onChange = () => setHasFinePointer(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return hasFinePointer;
}
