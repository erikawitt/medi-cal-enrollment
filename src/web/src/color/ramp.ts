/**
 * Palette engine — pure functions only. The single monochromatic OKLCH ramp
 * (constant hue, varying lightness/chroma) that all data encoding derives
 * from, plus quantile-break scales for the two metric views.
 *
 * The MapLibre WebGL canvas is sRGB, so ramp colors are gamut-clamped to
 * sRGB and emitted as hex; only DOM UI (CSS oklch()) gets true P3.
 */

import { clampChroma, formatHex } from "culori";

/** Design-brief default hue (warm amber); matches :root --hue in styles.css. */
export const DEFAULT_HUE = 32;

/** The brief's 6 sequential stops: [lightness, chroma] at constant hue. */
const RAMP_STOPS: readonly [number, number][] = [
  [0.97, 0.015],
  [0.89, 0.06],
  [0.8, 0.11],
  [0.7, 0.17],
  [0.585, 0.22],
  [0.47, 0.24],
];

/** Neutral for zero-or-growth cells in the MoM change view. */
export const NEUTRAL_HEX = oklchToHex(0.96, 0, 0);
/** Neutral for cells missing from the derived file (paired with 0.35 opacity). */
export const MISSING_HEX = oklchToHex(0.93, 0, 0);
export const MISSING_OPACITY = 0.35;
export const FILL_OPACITY = 0.78;

export function oklchToHex(l: number, c: number, h: number): string {
  return formatHex(clampChroma({ mode: "oklch", l, c, h }, "oklch"));
}

/** The 6-stop ramp as sRGB hex for a given hue. */
export function rampHex(hue: number): string[] {
  return RAMP_STOPS.map(([l, c]) => oklchToHex(l, c, hue));
}

/** Decline severity stops (ramp stops 1→5; deeper = steeper decline). */
export function declineStops(hue: number): string[] {
  return rampHex(hue).slice(1);
}

/** Color a decline magnitude by linear position in [0, maxDecline] onto stops 1→5.
 *  For details-pane MoM strips (local series max). Map choropleth uses changeScale quantiles. */
export function declineColorByLocalMax(absDelta: number, maxDecline: number, hue: number): string {
  const stops = declineStops(hue);
  if (maxDecline <= 0) return stops[0] as string;
  const t = absDelta / maxDecline;
  const idx = Math.min(stops.length - 1, Math.floor(t * stops.length));
  return stops[idx] as string;
}

export interface LegendEntry {
  colorHex: string;
  label: string;
}

export interface ColorScale {
  /** geo_id → fill color hex for every feature with a cell this month. */
  colorByGeoId: Map<string, string>;
  legend: LegendEntry[];
  /** Ascending quantile break values (k−1 for k classes), for reference. */
  breaks: number[];
  /** True when the change view has no non-null deltas (single-month case). */
  isEmpty: boolean;
}

/**
 * Quantile breaks: k−1 cut points splitting sorted values into k classes of
 * roughly equal population.
 */
function quantileBreaks(sortedValues: number[], k: number): number[] {
  const breaks: number[] = [];
  for (let i = 1; i < k; i++) {
    const pos = (i * (sortedValues.length - 1)) / k;
    const lower = Math.floor(pos);
    const frac = pos - lower;
    const a = sortedValues[lower] ?? 0;
    const b = sortedValues[Math.min(lower + 1, sortedValues.length - 1)] ?? a;
    breaks.push(a + (b - a) * frac);
  }
  return breaks;
}

function classify(value: number, breaks: number[]): number {
  let i = 0;
  while (i < breaks.length && value > (breaks[i] as number)) i++;
  return i;
}

const compactFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/**
 * Enrollment view: quantile breaks over non-null `age_0_5` values, mapped
 * onto stops 0→5 (dark = more enrolled).
 */
export function enrollmentScale(valuesByGeoId: Map<string, number>, hue: number): ColorScale {
  const ramp = rampHex(hue);
  const values = [...valuesByGeoId.values()].sort((a, b) => a - b);
  if (values.length === 0) {
    return { colorByGeoId: new Map(), legend: [], breaks: [], isEmpty: true };
  }
  const breaks = quantileBreaks(values, ramp.length);
  const colorByGeoId = new Map<string, string>();
  for (const [geoId, value] of valuesByGeoId) {
    colorByGeoId.set(geoId, ramp[classify(value, breaks)] as string);
  }
  const min = values[0] as number;
  const max = values[values.length - 1] as number;
  const bounds = [min, ...breaks, max];
  const legend = ramp.map((colorHex, i) => ({
    colorHex,
    label: `${compactFormat.format(Math.round(bounds[i] as number))}\u2013${compactFormat.format(Math.round(bounds[i + 1] as number))}`,
  }));
  return { colorByGeoId, legend, breaks, isEmpty: false };
}

/**
 * MoM change view (monochromatic — no second hue): decline severity maps
 * onto stops 1→5 (deeper = steeper decline); zero-or-growth is neutral.
 * With one committed month every delta is null → `isEmpty` drives the
 * empty-state note and features render neutral.
 */
export function changeScale(pctByGeoId: Map<string, number>, hue: number): ColorScale {
  const stops = declineStops(hue);
  const declines = [...pctByGeoId.values()].filter((v) => v < 0);
  const colorByGeoId = new Map<string, string>();

  if (pctByGeoId.size === 0) {
    return { colorByGeoId, legend: [], breaks: [], isEmpty: true };
  }

  const magnitudes = declines.map((v) => Math.abs(v)).sort((a, b) => a - b);
  const breaks = magnitudes.length > 0 ? quantileBreaks(magnitudes, stops.length) : [];

  for (const [geoId, pct] of pctByGeoId) {
    if (pct >= 0) {
      colorByGeoId.set(geoId, NEUTRAL_HEX);
    } else {
      colorByGeoId.set(geoId, stops[classify(Math.abs(pct), breaks)] as string);
    }
  }

  const legend: LegendEntry[] = [{ colorHex: NEUTRAL_HEX, label: "no decline / growth" }];
  if (magnitudes.length > 0) {
    const min = magnitudes[0] as number;
    const max = magnitudes[magnitudes.length - 1] as number;
    const bounds = [min, ...breaks, max];
    stops.forEach((colorHex, i) => {
      legend.push({
        colorHex,
        label: `\u2212${(bounds[i] as number).toFixed(1)}% to \u2212${(bounds[i + 1] as number).toFixed(1)}%`,
      });
    });
  }
  return { colorByGeoId, legend, breaks, isEmpty: false };
}
