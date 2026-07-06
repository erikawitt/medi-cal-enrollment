/**
 * Regenerate the committed test fixtures from real VizQL bodies captured by the
 * phase-1 spike (`spike/out/per-area-stream.json`, git-ignored, ~20 MB).
 *
 * The fixtures are v2 self-contained area captures for report month May 2026:
 *   - countywide-2026-05.capture.json  (Department level, from the bootstrap)
 *   - spa2-2026-05.capture.json        (SPA 2, from a tabdoc/select delta —
 *     exercises the session-cumulative dictionary path)
 *
 * Expected values asserted in the test suite come from the DPSS dashboard
 * itself (pinned in docs/plans/phase-1-scraper.md), not from this code.
 *
 * Run: bun test/fixtures/generate-fixtures.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SessionDictionary, extractWorksheets, buildAreaCapture } from "../../src/vizql";

const streamPath = join(import.meta.dir, "..", "..", "spike", "out", "per-area-stream.json");
const stream: { phase: string; url: string; body: string }[] = JSON.parse(
  readFileSync(streamPath, "utf8"),
);

// Segments mutate by key as the session progresses (see SessionDictionary), so
// each capture is resolved against the session state at its capture time.
const session = new SessionDictionary();

const bootstrapBodies = stream.filter((e) => e.phase === "load").map((e) => e.body);
for (const b of bootstrapBodies) session.addBody(b);
const countywide = buildAreaCapture(extractWorksheets(bootstrapBodies), session);
writeFileSync(
  join(import.meta.dir, "countywide-2026-05.capture.json"),
  JSON.stringify(countywide),
);

const spa2Bodies: string[] = [];
for (const e of stream) {
  if (e.phase === "load") continue;
  session.addBody(e.body);
  if (e.phase === "select-spa2" && e.url.includes("tabdoc/select")) spa2Bodies.push(e.body);
  if (spa2Bodies.length) break; // state at SPA 2 capture time
}
const spa2 = buildAreaCapture(extractWorksheets(spa2Bodies), session);
writeFileSync(join(import.meta.dir, "spa2-2026-05.capture.json"), JSON.stringify(spa2));

console.log(
  `countywide: ${Object.keys(countywide.worksheets).length} worksheets; ` +
    `spa2: ${Object.keys(spa2.worksheets).length} worksheets`,
);
