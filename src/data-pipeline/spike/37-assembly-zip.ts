/** Spike 37: why do the State Assembly District and Zip Code geo types come
 * back with an empty sub-area domain (no "<name>|Checked" tokens)? Dump what
 * their geo-type-select responses actually contain, plus screenshots.
 */
import { launchEmbed, closeSharedBrowser, selectGeoType, subAreaZone } from "../src/embed.ts";

const OUT = new URL("./out/", import.meta.url).pathname;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const embed = await launchEmbed({ headless: true });
try {
  for (const label of ["State Assembly District", "Zip Code"]) {
    const resp = (await selectGeoType(embed, label)).join("\n");
    await sleep(3000);
    const late = embed.drainResponses().join("\n");
    const all = resp + "\n" + late;
    const tokens = [...new Set([...all.matchAll(/"([^"|]{2,30})\|(Checked|Unchecked)"/g)].map((m) => `${m[1]}|${m[2]}`))];
    const titles = [...new Set([...all.matchAll(/"((?:State Assembly District|Zip Code|SAD|Congressional District)[^"]{0,20})"/g)].map((m) => m[1]))];
    const zipish = [...new Set([...all.matchAll(/"(9\d{4})[^"]*"/g)].map((m) => m[1]))];
    console.log(`[37] ${label}: respLen=${all.length} tokens(${tokens.length})=${JSON.stringify(tokens.slice(0, 20))}`);
    console.log(`[37] ${label}: titles=${JSON.stringify(titles.slice(0, 10))} zipish(${zipish.length})=${JSON.stringify(zipish.slice(0, 10))}`);
    const zone = await subAreaZone(embed).catch(() => null);
    console.log(`[37] ${label}: subAreaZone=${JSON.stringify(zone)}`);
    await embed.page.screenshot({ path: `${OUT}/37-${label.replace(/ /g, "_")}.png` });
  }
} finally {
  await embed.close();
  await closeSharedBrowser();
  process.exit(0);
}
