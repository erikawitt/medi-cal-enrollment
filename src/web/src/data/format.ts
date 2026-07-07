import type { ReportMonth } from "@medi-cal-disenrollment/shared";

const numberFormat = new Intl.NumberFormat("en-US");

export function formatCount(n: number): string {
  return numberFormat.format(n);
}

const MONTH_NAMES = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
] as const;

/** `2026-01` → `JAN 2026`. */
export function formatMonth(month: ReportMonth): string {
  const [year, m] = month.split("-");
  const name = MONTH_NAMES[Number(m) - 1] ?? m;
  return `${name} ${year}`;
}

/** Signed percent with true minus (U+2212): −4.2%, +1.3%, 0.0%. */
export function formatSignedPct(pct: number): string {
  const abs = Math.abs(pct).toFixed(1);
  if (pct < 0) return `\u2212${abs}%`;
  if (pct > 0) return `+${abs}%`;
  return `${abs}%`;
}

/** Signed integer delta with true minus. */
export function formatSignedCount(n: number): string {
  const abs = numberFormat.format(Math.abs(n));
  if (n < 0) return `\u2212${abs}`;
  if (n > 0) return `+${abs}`;
  return abs;
}

/** `south-la` → `South LA`, `standalone-city` → `standalone city`. */
export function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((word) => (word === "la" ? "LA" : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

/** Compact boundary label for the top-decreases sidebar list only. */
export function abbreviateListBoundaryName(name: string): string {
  const match = name.match(/^(Congressional|Senate|Assembly) District (\d+)$/);
  if (!match) return name;
  const prefix = { Congressional: "CD", Senate: "SD", Assembly: "AD" }[match[1]!];
  return `${prefix} ${match[2]}`;
}
