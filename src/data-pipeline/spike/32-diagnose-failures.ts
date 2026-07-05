/** Spike 32: reproduce the two intermittent failures —
 * (a) SPA/assembly domain parsing empty after month selection,
 * (b) April 2026 month item not found after a capture session.
 */
import { launchEmbed, listReportMonths, selectReportMonth, selectGeoType, parseSubAreaDomain, GEO_TYPES } from "../src/embed.ts";

const OUT = new URL("./out/", import.meta.url).pathname;
const embed = await launchEmbed({ headless: true });
try {
  await selectReportMonth(embed, "May 2026");
  await embed.page.screenshot({ path: `${OUT}/32-after-month.png` });

  for (const g of GEO_TYPES.filter((x) => x.geoType === "spa" || x.geoType === "assembly_district")) {
    const resp = await selectGeoType(embed, g.label);
    const domain = parseSubAreaDomain(resp.join("\n"), g.pattern);
    const allToks = [...new Set([...resp.join("\n").matchAll(/"([^"|]+)\|(?:Checked|Unchecked)"/g)].map((m) => m[1]))];
    console.log(`[32] ${g.geoType}: domain=${domain.length}`, JSON.stringify(domain.slice(0, 5)), "allTokens:", JSON.stringify(allToks.slice(0, 15)));
    await embed.page.screenshot({ path: `${OUT}/32-${g.geoType}.png` });
  }

  // Now try switching month to April 2026.
  try {
    await selectReportMonth(embed, "April 2026");
    console.log("[32] April 2026 selected OK");
    await embed.page.screenshot({ path: `${OUT}/32-april.png` });
  } catch (e) {
    console.log("[32] April select FAILED:", (e as Error).message);
  }
} finally {
  await embed.close();
}
