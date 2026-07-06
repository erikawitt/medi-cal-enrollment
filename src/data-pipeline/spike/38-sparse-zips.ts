/** Spike 38: the same ~12 zips (90071, 90095, 91125, ... — tiny-population
 * areas) fail capture in every month. Hypothesis: their re-renders carry so few
 * numeric values that `captureHasData`'s threshold rejects them. Target-click a
 * few and report exactly what their responses hold.
 */
import { launchEmbed, closeSharedBrowser, selectGeoType, subAreaZone, parseSubAreaDomain, areaFromResponse, GEO_TYPES } from "../src/embed.ts";
import { extractRawCapture } from "../src/vizql.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const zipSpec = GEO_TYPES.find((g) => g.geoType === "zip")!;
const TARGETS = ["90071", "90095", "91125"];

const embed = await launchEmbed({ headless: true });
try {
  const base = await selectGeoType(embed, zipSpec);
  const domain = parseSubAreaDomain(base.join("\n"), zipSpec.pattern);
  console.log("[38] domain:", domain.length);
  const zone = await subAreaZone(embed);
  const el = await embed.frame.frameElement();
  const box = (await el.boundingBox())!;
  const LIST_TOP = 30;
  const viewport = zone.h - LIST_TOP;

  let rowH = 30;
  let scroll = 0;
  const wheel = async (dy: number) => {
    await embed.page.mouse.move(box.x + zone.x + zone.w / 2, box.y + zone.y + zone.h / 2);
    await embed.page.mouse.wheel(0, dy);
    await sleep(700);
  };
  await wheel(-99999);

  for (const target of TARGETS) {
    const ti = domain.indexOf(target);
    for (let tries = 0; tries < 8; tries++) {
      const yInZone = LIST_TOP + ti * rowH + rowH / 2 - scroll;
      if (yInZone < LIST_TOP + 2 || yInZone > zone.h - 6) {
        const delta = yInZone - (LIST_TOP + viewport / 2);
        await wheel(delta);
        scroll = Math.max(0, scroll + delta);
        continue;
      }
      embed.drainResponses();
      await embed.page.mouse.click(box.x + zone.x + 18, box.y + zone.y + yInZone);
      await sleep(1000);
      let bodies: string[] = [];
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) {
        bodies = bodies.concat(embed.drainResponses());
        if (bodies.some((b) => b.length > 50_000)) { await sleep(300); bodies = bodies.concat(embed.drainResponses()); break; }
        await sleep(300);
      }
      const name = areaFromResponse(bodies.join("\n"), zipSpec);
      if (name) {
        const hi = domain.indexOf(name);
        if (hi >= 0) scroll = LIST_TOP + hi * rowH + rowH / 2 - yInZone;
        if (name === target) {
          const frames = extractRawCapture(bodies);
          let realCounts: number[] = [];
          for (const fr of frames) {
            const s = JSON.stringify(fr);
            for (const m of s.matchAll(/"dataType":"real","dataValues":\[([^\]]*)\]/g)) {
              realCounts.push(m[1] ? m[1].split(",").length : 0);
            }
          }
          console.log(`[38] ${target}: HIT — frames=${frames.length} realPools=${JSON.stringify(realCounts)} bodySizes=${bodies.map((b) => b.length).join(",")}`);
          console.log(`[38] ${target}: frame sample:`, JSON.stringify(frames).slice(0, 600));
          break;
        }
      }
      console.log(`[38] ${target}: try ${tries} clicked -> ${name ?? "null"}`);
    }
  }
} finally {
  await embed.close();
  await closeSharedBrowser();
  process.exit(0);
}
