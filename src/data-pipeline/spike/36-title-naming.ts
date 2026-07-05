/** Spike 36: can captures be named by the re-rendered view TITLE (e.g.
 * "Congressional District 23") instead of checkbox tokens? Click down the CD
 * list with driver-style waits and log both signals per click.
 */
import { launchEmbed, closeSharedBrowser, selectReportMonth, selectGeoType, subAreaZone, selectedSubArea } from "../src/embed.ts";
import { extractRawCapture, captureHasData } from "../src/vizql.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pattern = /^(CD \d+|Unknown)$/;

const embed = await launchEmbed({ headless: true });
try {
  await selectReportMonth(embed, "January 2026");
  await selectGeoType(embed, "Congressional District");
  const zone = await subAreaZone(embed);
  const el = await embed.frame.frameElement();
  const box = (await el.boundingBox())!;

  for (let row = 0; row < 10; row++) {
    const fy = zone.y + 30 + row * 16;
    embed.drainResponses();
    await embed.page.mouse.click(box.x + zone.x + 18, box.y + fy);
    await sleep(1000);
    let bodies: string[] = [];
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      bodies = bodies.concat(embed.drainResponses());
      if (bodies.some((b) => b.length > 50_000)) {
        await sleep(300);
        bodies = bodies.concat(embed.drainResponses());
        break;
      }
      await sleep(300);
    }
    const joined = bodies.join("\n");
    const tokenName = selectedSubArea(joined, pattern);
    const titles = [...new Set([...joined.matchAll(/Congressional District (\d+|Unknown)\s+At-A-Glance/g)].map((m) => `CD ${m[1]}`))];
    const bare = [...new Set([...joined.matchAll(/"Congressional District (\d+|Unknown)"/g)].map((m) => `CD ${m[1]}`))];
    const frames = extractRawCapture(bodies);
    console.log(`[36] row${row} fy=${fy}: token=${tokenName} titles=${JSON.stringify(titles)} bare=${JSON.stringify(bare)} hasData=${captureHasData(frames)} sizes=${bodies.map((b) => b.length).join(",")}`);
  }
} finally {
  await embed.close();
  await closeSharedBrowser();
  process.exit(0);
}
