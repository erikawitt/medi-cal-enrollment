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
  const embed = await launchEmbed({ headless: !args.headed });
  let exitCode = 0;
  try {
    const monthLabels = await listReportMonths(embed);
    const labelByKey = new Map<string, string>();
    for (const label of monthLabels) {
      const key = monthLabelToKey(label);
      if (key) labelByKey.set(key, label);
    }
    let keys = [...labelByKey.keys()].filter((k) => k >= args.minMonth).sort().reverse();
    if (args.months) keys = keys.filter((k) => args.months!.includes(k));
    log(`report months to capture (>= ${args.minMonth}): ${keys.join(", ") || "(none)"}`);

    for (const monthKey of keys) {
      const label = labelByKey.get(monthKey)!;
      log(`=== report month ${monthKey} (${label}) ===`);
      await selectReportMonth(embed, label);

      for (const geo of geoTypes) {
        // Idempotency: skip a fully-captured (month, geo_type).
        const baseRespPeek = await selectGeoType(embed, geo.label);
        const domain = parseSubAreaDomain(baseRespPeek.join("\n"), geo.pattern);
        if (geoTypeComplete(monthKey, geo.geoType, domain.length)) {
          log(`${monthKey}/${geo.geoType}: already complete (${domain.length} areas), skipping`);
          continue;
        }
        writeBase(monthKey, geo.geoType, extractRawCapture(baseRespPeek));
        const expected = args.maxAreas ? Math.min(args.maxAreas, domain.length) : domain.length;
        const priorAreas = readManifest(monthKey)?.geoTypes.find((g) => g.geoType === geo.geoType)?.areas ?? [];
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
        upsertManifest(monthKey, { geoType: geo.geoType, areaCount: areas.length, areas });
        log(`${monthKey}/${geo.geoType}: wrote ${areas.length} area captures`);
      }
    }
    log("done");
  } catch (err) {
    exitCode = 1;
    console.error("[scrape] fatal:", err);
  } finally {
    await embed.close();
  }
  process.exit(exitCode);
}

await main();
