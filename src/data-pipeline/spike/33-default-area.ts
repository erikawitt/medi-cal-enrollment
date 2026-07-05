/** Spike 33: why is the default-selected sub-area (e.g. SPA 3) never captured?
 * Hypothesis: the first click toggles it OFF (no figures in the delta), and
 * subsequent clicks on the same row should re-select it — find out what those
 * re-clicks actually return.
 */
import { launchEmbed, closeSharedBrowser, selectReportMonth, selectGeoType, subAreaZone, selectedSubArea } from "../src/embed.ts";
import { extractRawCapture, captureHasData } from "../src/vizql.ts";

const OUT = new URL("./out/", import.meta.url).pathname;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const embed = await launchEmbed({ headless: true });
try {
  await selectReportMonth(embed, "January 2026");
  await selectGeoType(embed, "Service Planning Area");
  const zone = await subAreaZone(embed);
  const el = await embed.frame.frameElement();
  const box = (await el.boundingBox())!;

  // SPA rows: title ~30px, then ~16px pitch. SPA 3 should be the 3rd row.
  // Click each row position 1..9 once, then all again, logging what comes back.
  const pattern = /^(SPA \d+|Unknown)$/;
  for (let pass = 1; pass <= 3; pass++) {
    for (let row = 0; row < 9; row++) {
      const fy = zone.y + 30 + row * 16;
      embed.drainResponses();
      await embed.page.mouse.click(box.x + zone.x + 18, box.y + fy);
      await sleep(2500);
      const bodies = embed.drainResponses();
      const name = selectedSubArea(bodies.join("\n"), pattern);
      const tokens = [...bodies.join("\n").matchAll(/"([^"|]+)\|(Checked|Unchecked)"/g)].map((m) => `${m[1]}|${m[2]}`);
      const frames = extractRawCapture(bodies);
      console.log(`[33] pass${pass} row${row}: name=${name} hasData=${captureHasData(frames)} bodies=${bodies.length} sizes=${bodies.map((b) => b.length).join(",")} tokens=${JSON.stringify([...new Set(tokens)])}`);
    }
    await embed.page.screenshot({ path: `${OUT}/33-pass${pass}.png` });
  }
} finally {
  await embed.close();
  await closeSharedBrowser();
  process.exit(0);
}
