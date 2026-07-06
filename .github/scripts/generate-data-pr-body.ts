/**
 * Build the markdown body for an automated data PR from the validation report
 * and on-disk data artifacts. Invoked by .github/workflows/data-update.yml.
 *
 * Usage: bun run .github/scripts/generate-data-pr-body.ts <report.json> <months>
 *   months — comma-separated new report-month keys (e.g. 2026-02 or 2026-01,2026-02)
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type CheckLevel = "pass" | "warn" | "fail";

interface Check {
  id: string;
  level: CheckLevel;
  message: string;
  data?: Record<string, unknown>;
}

interface ValidationReport {
  ok: boolean;
  generated_at: string;
  months: string[];
  checks: Check[];
}

interface MapGeoFile {
  geo_type: string;
  features: Record<string, Record<string, { persons_total?: number; age_0_5?: number }>>;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function countywideFromSpa(spa: MapGeoFile, month: string): { persons_total: number; age_0_5: number } {
  let persons_total = 0;
  let age_0_5 = 0;
  for (const byMonth of Object.values(spa.features)) {
    const row = byMonth[month];
    if (row) {
      persons_total += row.persons_total ?? 0;
      age_0_5 += row.age_0_5 ?? 0;
    }
  }
  return { persons_total, age_0_5 };
}

function fmtDelta(cur: number, prev: number): string {
  const delta = cur - prev;
  const pct = prev === 0 ? "n/a" : `${((delta / prev) * 100).toFixed(1)}%`;
  return `${delta >= 0 ? "+" : ""}${delta.toLocaleString("en-US")} (${pct})`;
}

function main(): void {
  const [reportPath, monthsArg] = process.argv.slice(2);
  if (!reportPath || !monthsArg) {
    console.error("usage: generate-data-pr-body.ts <report.json> <months>");
    process.exit(1);
  }

  const report = JSON.parse(readFileSync(reportPath, "utf8")) as ValidationReport;
  const newMonths = monthsArg.split(",").filter(Boolean).sort();
  const repoRoot = join(import.meta.dir, "..", "..");
  const spa = JSON.parse(readFileSync(join(repoRoot, "data/derived/map/spa.json"), "utf8")) as MapGeoFile;

  const lines: string[] = [];
  lines.push("## Summary");
  lines.push("");
  lines.push(`Automated data update capturing **${newMonths.map(monthLabel).join(", ")}** report month(s).`);
  lines.push("");

  lines.push("## Countywide Medi-Cal (SPA sum, incl. unknown)");
  lines.push("");
  lines.push("| Report month | persons_total | age_0_5 | MoM persons_total | MoM age_0_5 |");
  lines.push("|---|---:|---:|---|---|");
  for (const month of newMonths) {
    const cur = countywideFromSpa(spa, month);
    const priorKey = previousMonth(month);
    const prior = countywideFromSpa(spa, priorKey);
    const hasPrior = Object.values(spa.features).some((f) => f[priorKey]?.persons_total !== undefined);
    lines.push(
      `| ${monthLabel(month)} | ${cur.persons_total.toLocaleString("en-US")} | ${cur.age_0_5.toLocaleString("en-US")} | ${hasPrior ? fmtDelta(cur.persons_total, prior.persons_total) : "—"} | ${hasPrior ? fmtDelta(cur.age_0_5, prior.age_0_5) : "—"} |`,
    );
  }
  lines.push("");

  lines.push("## CHHS cross-check");
  lines.push("");
  const chhs = report.checks.filter((c) => c.id.startsWith("chhs-crosscheck:"));
  if (chhs.length === 0) {
    lines.push("_No CHHS checks in report._");
  } else {
    for (const c of chhs) {
      const icon = c.level === "pass" ? "✅" : c.level === "warn" ? "⚠️" : "❌";
      lines.push(`- ${icon} ${c.message}`);
    }
  }
  lines.push("");

  lines.push("## Derived map row counts");
  lines.push("");
  const mapDir = join(repoRoot, "data/derived/map");
  for (const file of readdirSync(mapDir).filter((f) => f.endsWith(".json")).sort()) {
    const map = JSON.parse(readFileSync(join(mapDir, file), "utf8")) as MapGeoFile;
    lines.push(`- **${map.geo_type}**: ${Object.keys(map.features).length.toLocaleString("en-US")} features`);
  }
  lines.push("");

  const warnings = report.checks.filter((c) => c.level === "warn");
  if (warnings.length > 0) {
    lines.push("## Warnings");
    lines.push("");
    for (const c of warnings) {
      lines.push(`- ${c.message}`);
    }
    lines.push("");
  }

  lines.push("## Extraction");
  lines.push("");
  for (const month of newMonths) {
    const manifest = JSON.parse(
      readFileSync(join(repoRoot, "data/raw", month, "manifest.json"), "utf8"),
    ) as { extractionMethod: string; scraperVersion: string; capturedAt: string };
    lines.push(
      `- **${monthLabel(month)}**: \`${manifest.extractionMethod}\` (scraper ${manifest.scraperVersion}, captured ${manifest.capturedAt})`,
    );
  }
  lines.push("");
  lines.push("---");
  lines.push("_Opened by the [Data update](.github/workflows/data-update.yml) workflow. Merge after **Validate data** passes._");

  console.log(lines.join("\n"));
}

main();
