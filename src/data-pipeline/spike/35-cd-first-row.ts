/** Spike 35: why is CD 23 (first row of the Congressional District sub-area
 * list) never captured? Click the top rows repeatedly and log exactly what
 * each click returns, with a screenshot of the list state.
 */
import { launchEmbed, closeSharedBrowser, selectReportMonth, selectGeoType, subAreaZone, selectedSubArea } from "../src/embed.ts";
import { extractRawCapture, captureHasData } from "../src/vizql.ts";

const OUT = new URL("./out/", import.meta.url).pathname;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pattern = /^(CD \d+|Unknown)$/;

const embed = await launchEmbed({ headless: true });
try {
  await selectReportMonth(embed, "January 2026");
  await selectGeoType(embed, "Congressional District");
  const zone = await subAreaZone(embed);
  console.log("[35] zone:", JSON.stringify(zone));
  const el = await embed.frame.frameElement();
  const box = (await el.boundingBox())!;
  await embed.page.screenshot({ path: `${OUT}/35-initial.png` });

  for (let pass = 1; pass <= 2; pass++) {
    for (let row = 0; row < 6; row++) {
      const fy = zone.y + 30 + row * 16;
      embed.drainResponses();
      await embed.page.mouse.click(box.x + zone.x + 18, box.y + fy);
      await sleep(2500);
      const bodies = embed.drainResponses();
      const name = selectedSubArea(bodies.join("\n"), pattern);
      const tokens = [...new Set([...bodies.join("\n").matchAll(/"([^"|]+)\|(Checked|Unchecked)"/g)].map((m) => `${m[1]}|${m[2]}`))];
      const hasData = captureHasData(extractRawCapture(bodies));
      console.log(`[35] pass${pass} row${row} fy=${fy}: name=${name} hasData=${hasData} nBodies=${bodies.length} sizes=${bodies.map((b) => b.length).join(",")} tokens=${JSON.stringify(tokens.slice(0, 10))}`);
    }
    await embed.page.screenshot({ path: `${OUT}/35-pass${pass}.png` });
  }
} finally {
  await embed.close();
  await closeSharedBrowser();
  process.exit(0);
}
