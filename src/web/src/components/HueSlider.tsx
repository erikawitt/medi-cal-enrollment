import { useEffect } from "react";
import { useAppDispatch, useAppState } from "../state/store";

/**
 * Dev palette-exploration tool (bottom-right). Drives the single --hue
 * custom property on :root — all CSS colors and the JS map ramp follow
 * live. Deliberately isolated so it can be deleted cleanly later.
 */
export function HueSlider() {
  const { hue } = useAppState();
  const dispatch = useAppDispatch();
  const anchor = `oklch(0.62 0.24 ${hue})`;

  useEffect(() => {
    document.documentElement.style.setProperty("--hue", String(hue));
  }, [hue]);

  return (
    <div className="panel hue-slider">
      <label className="micro-label" htmlFor="hue-range">
        Palette
      </label>
      <input
        id="hue-range"
        type="range"
        min={0}
        max={360}
        step={1}
        value={hue}
        onChange={(e) => dispatch({ type: "setHue", hue: Number(e.target.value) })}
      />
      <div className="hue-readout">
        <code>{anchor}</code>
        <button
          type="button"
          className="hue-copy"
          onClick={() => void navigator.clipboard.writeText(anchor)}
        >
          Copy
        </button>
      </div>
    </div>
  );
}
