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
  closeSharedBrowser,
  listReportMonths,
  selectReportMonth,
  selectGeoType,
  parseSubAreaDomain,
  captureAllAreas,
  areaFromResponse,
  GEO_TYPES,
  type GeoType,
} from "./embed";
import { extractRawCapture, captureHasData } from "./vizql";
import { statSync } from "node:fs";
import { join } from "node:path";
import {
  monthLabelToKey,
  writeBase,
  writeArea,
  readAreaCapture,
  geoIdToFileStem,
  geoTypeDir,
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
  // Oldest first: report months age out of the dropdown on an unknown schedule,
  // so the oldest published month is always the most at risk of disappearing.
  let keys = [...labelByKey.keys()].filter((k) => k >= args.minMonth).sort();
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
  await closeSharedBrowser();
  process.exit(exitCode);
}

/** An area counts as captured only when its on-disk frames carry real figures. */
function areaValidOnDisk(monthKey: string, geoType: string, geoId: string): boolean {
  const frames = readAreaCapture(monthKey, geoType, geoId);
  return frames !== null && captureHasData(frames);
}

/** Capture one (report month, geo type) in a fresh embed session. Returns true when complete. */
async function captureMonthGeoType(
  monthKey: string,
  monthLabel: string,
  geo: (typeof GEO_TYPES)[number],
  args: Args,
): Promise<boolean> {
  // Idempotency pre-check from the manifest (avoids a session when done).
  // Trust it only when every listed area's file really carries figures.
  const prior = readManifest(monthKey)?.geoTypes.find((g) => g.geoType === geo.geoType);
  if (
    prior?.domainCount &&
    prior.areas.length >= prior.domainCount &&
    prior.areas.every((a) => areaValidOnDisk(monthKey, geo.geoType, a.geoId))
  ) {
    log(`${monthKey}/${geo.geoType}: already complete (${prior.areas.length} areas), skipping`);
    return true;
  }

  const embed = await launchEmbed({ headless: !args.headed });
  try {
    await selectReportMonth(embed, monthLabel);
    const baseResp = await selectGeoType(embed, geo);
    const domain = parseSubAreaDomain(baseResp.join("\n"), geo.pattern);
    if (domain.length === 0) throw new Error("empty sub-area domain");
    // A domain smaller than previously observed means the token pool hadn't
    // finished streaming — treating it as authoritative would mark the geo
    // type complete after a handful of areas. Fail the attempt instead.
    if (prior?.domainCount && domain.length < prior.domainCount) {
      throw new Error(
        `sub-area domain shrank: got ${domain.length}, manifest says ${prior.domainCount}`,
      );
    }

    const validOnDisk = (id: string) => areaValidOnDisk(monthKey, geo.geoType, id);
    if (domain.every(validOnDisk)) {
      log(`${monthKey}/${geo.geoType}: already complete (${domain.length} areas), skipping`);
      // Manifest may predate the validity check; refresh it from disk state.
      upsertManifest(monthKey, buildGeoManifest(monthKey, geo.geoType, domain, prior));
      return true;
    }
    writeBase(monthKey, geo.geoType, extractRawCapture(baseResp));

    // The geo-type selection itself renders the type's default (first) area —
    // capture it from the base response; its list row never needs a click.
    const baseFrames = extractRawCapture(baseResp);
    const defaultArea = areaFromResponse(baseResp.join("\n"), geo);
    if (defaultArea && !validOnDisk(defaultArea) && captureHasData(baseFrames)) {
      writeArea(monthKey, geo.geoType, defaultArea, baseFrames);
      log(`${monthKey}/${geo.geoType}: captured default area ${defaultArea}`);
    }

    const expected = args.maxAreas ? Math.min(args.maxAreas, domain.length) : domain.length;
    let captured = domain.filter(validOnDisk).length;
    for await (const cap of captureAllAreas(
      embed,
      geo,
      domain,
      expected,
      domain.filter(validOnDisk),
      (responses) => captureHasData(extractRawCapture(responses)),
    )) {
      writeArea(monthKey, geo.geoType, cap.geoId, extractRawCapture(cap.responses));
      captured++;
      if (captured % 25 === 0) log(`${monthKey}/${geo.geoType}: captured ${captured}/${expected}`);
      if (args.maxAreas && captured >= args.maxAreas) break;
    }
    const manifest = buildGeoManifest(monthKey, geo.geoType, domain, prior);
    upsertManifest(monthKey, manifest);
    log(`${monthKey}/${geo.geoType}: ${manifest.areaCount}/${domain.length} valid area captures`);
    return manifest.areaCount >= expected;
  } finally {
    await embed.close();
  }
}

/**
 * Manifest entry for a geo type, derived from what is actually valid on disk.
 * `order` is the capture order (file mtime rank) — significant because
 * per-area frames are session-cumulative deltas (see capture.ts).
 */
function buildGeoManifest(
  monthKey: string,
  geoType: string,
  domain: string[],
  prior: GeoTypeManifest | undefined,
): GeoTypeManifest {
  // Keep any previously-recorded areas that are not in today's domain but are
  // valid on disk (defensive: domain drift between runs).
  const names = [...domain];
  for (const a of prior?.areas ?? []) {
    if (!names.includes(a.geoId)) names.push(a.geoId);
  }
  const valid = names
    .filter((geoId) => areaValidOnDisk(monthKey, geoType, geoId))
    .map((geoId) => {
      const file = `${geoIdToFileStem(geoId)}.json`;
      const mtime = statSync(join(geoTypeDir(monthKey, geoType), file)).mtimeMs;
      return { geoId, file, mtime };
    })
    .sort((a, b) => a.mtime - b.mtime);
  return {
    geoType,
    areaCount: valid.length,
    domainCount: domain.length,
    areas: valid.map(({ geoId, file }, order) => ({ geoId, file, order })),
  };
}

await main();
