/**
 * Phase-1 scraper CLI: `bun run scrape`.
 *
 * Captures the DPSS At-A-Glance embed's raw VizQL presModel for every published
 * report month from January 2026 onward, at each of the five geography levels
 * (zip, SPA, congressional / state senate / state assembly district), into
 * data/raw/. Idempotent by (report month, geo_type): a re-run skips work already
 * on disk. Polite: descriptive User-Agent, ≥ 1s between interactions, bounded
 * retries. See docs/plans/phase-1-scraper.md.
 *
 * Flags:
 *   --months=2026-05,2026-04   limit to specific report-month keys
 *   --geo=spa,zip              limit to specific geo types
 *   --min-month=2026-01        earliest report month to capture (default 2026-01)
 *   --max-areas=N              cap areas per geo type (smoke tests)
 *   --headed                   run with a visible browser
 */
import {
  launchEmbed,
  listReportMonths,
  selectReportMonth,
  selectGeoType,
  parseSubAreaDomain,
  captureAllAreas,
  GEO_TYPES,
  type GeoType,
} from "./embed";
import { extractRawCapture } from "./vizql";
import {
  monthLabelToKey,
  writeBase,
  writeArea,
  areaAlreadyCaptured,
  geoTypeComplete,
  upsertManifest,
  readManifest,
  existingReportMonths,
  type GeoTypeManifest,
} from "./capture";

interface Args {
  months?: string[];
  geo?: GeoType[];
  minMonth: string;
  maxAreas?: number;
  headed: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  return {
    months: get("months")?.split(",").map((s) => s.trim()).filter(Boolean),
    geo: get("geo")?.split(",").map((s) => s.trim() as GeoType).filter(Boolean),
    minMonth: get("min-month") ?? "2026-01",
    maxAreas: get("max-areas") ? Number(get("max-areas")) : undefined,
    headed: argv.includes("--headed"),
  };
}

const log = (msg: string) => console.log(`[scrape] ${new Date().toISOString()} ${msg}`);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const geoTypes = args.geo
    ? GEO_TYPES.filter((g) => args.geo!.includes(g.geoType))
    : [...GEO_TYPES];

  log(`existing report months on disk: ${existingReportMonths().join(", ") || "(none)"}`);

  // Enumerate published months once, with a short-lived session.
  const labelByKey = new Map<string, string>();
  {
    const embed = await launchEmbed({ headless: !args.headed });
    try {
      for (const label of await listReportMonths(embed)) {
        const key = monthLabelToKey(label);
        if (key) labelByKey.set(key, label);
      }
    } finally {
      await embed.close();
    }
  }
  let keys = [...labelByKey.keys()].filter((k) => k >= args.minMonth).sort().reverse();
  if (args.months) keys = keys.filter((k) => args.months!.includes(k));
  log(`report months to capture (>= ${args.minMonth}): ${keys.join(", ") || "(none)"}`);

  let exitCode = 0;
  for (const monthKey of keys) {
    const label = labelByKey.get(monthKey)!;
    for (const geo of geoTypes) {
      // Fresh embed session per (month, geo_type): the embed accumulates state
      // (tooltips, scroll, session staleness) that makes long sessions flaky.
      // One bounded retry with another fresh session on failure.
      let ok = false;
      for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
        try {
          ok = await captureMonthGeoType(monthKey, label, geo, args);
        } catch (err) {
          log(`${monthKey}/${geo.geoType}: attempt ${attempt} failed: ${(err as Error).message}`);
        }
      }
      if (!ok) {
        log(`${monthKey}/${geo.geoType}: INCOMPLETE after retries`);
        exitCode = 1;
      }
    }
  }
  log("done");
  process.exit(exitCode);
}

/** Capture one (report month, geo type) in a fresh embed session. Returns true when complete. */
async function captureMonthGeoType(
  monthKey: string,
  monthLabel: string,
  geo: (typeof GEO_TYPES)[number],
  args: Args,
): Promise<boolean> {
  // Idempotency pre-check from the manifest (avoids a session when done).
  const prior = readManifest(monthKey)?.geoTypes.find((g) => g.geoType === geo.geoType);
  if (prior?.domainCount && prior.areaCount >= prior.domainCount) {
    log(`${monthKey}/${geo.geoType}: already complete (${prior.areaCount} areas), skipping`);
    return true;
  }

  const embed = await launchEmbed({ headless: !args.headed });
  try {
    await selectReportMonth(embed, monthLabel);
    const baseResp = await selectGeoType(embed, geo.label);
    const domain = parseSubAreaDomain(baseResp.join("\n"), geo.pattern);
    if (domain.length === 0) throw new Error("empty sub-area domain");

    if (geoTypeComplete(monthKey, geo.geoType, domain.length)) {
      log(`${monthKey}/${geo.geoType}: already complete (${domain.length} areas), skipping`);
      return true;
    }
    writeBase(monthKey, geo.geoType, extractRawCapture(baseResp));

    const expected = args.maxAreas ? Math.min(args.maxAreas, domain.length) : domain.length;
    const priorAreas = prior?.areas ?? [];
    const areas: GeoTypeManifest["areas"] = [...priorAreas];
    let order = areas.length;
    for await (const cap of captureAllAreas(embed, geo.pattern, expected, (id) =>
      areaAlreadyCaptured(monthKey, geo.geoType, id),
    )) {
      const file = writeArea(monthKey, geo.geoType, cap.geoId, extractRawCapture(cap.responses));
      areas.push({ geoId: cap.geoId, file, order: order++ });
      if (order % 25 === 0) log(`${monthKey}/${geo.geoType}: captured ${order}/${expected}`);
      if (args.maxAreas && areas.length >= args.maxAreas) break;
    }
    upsertManifest(monthKey, {
      geoType: geo.geoType,
      areaCount: areas.length,
      domainCount: domain.length,
      areas,
    });
    log(`${monthKey}/${geo.geoType}: wrote ${areas.length}/${domain.length} area captures`);
    return areas.length >= expected;
  } finally {
    await embed.close();
  }
}

await main();
