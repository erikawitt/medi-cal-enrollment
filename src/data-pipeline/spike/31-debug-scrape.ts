/** Spike 31: debug the scrape path — month select then SPA capture. */
import { launchEmbed, listReportMonths, selectReportMonth, selectGeoType, parseSubAreaDomain, captureAllAreas, subAreaZone, GEO_TYPES } from "../src/embed.ts";

const spa = GEO_TYPES.find((g) => g.geoType === "spa")!;
const embed = await launchEmbed({ headless: true });
try {
  console.log("[31] months:", await listReportMonths(embed));
  console.time("selectMonth");
  await selectReportMonth(embed, "May 2026");
  console.timeEnd("selectMonth");
  await embed.page.screenshot({ path: new URL("./out/31-after-month.png", import.meta.url).pathname });

  console.time("selectGeo");
  const resp = await selectGeoType(embed, spa.label);
  console.timeEnd("selectGeo");
  const domain = parseSubAreaDomain(resp, spa.pattern);
  console.log("[31] SPA domain:", JSON.stringify(domain));
  console.log("[31] subAreaZone:", JSON.stringify(await subAreaZone(embed)));
  await embed.page.screenshot({ path: new URL("./out/31-after-geo.png", import.meta.url).pathname });

  let n = 0;
  for await (const cap of captureAllAreas(embed, spa.pattern, Math.min(3, domain.length))) {
    console.log("[31] captured", cap.geoId, "bytes", cap.responseText.length);
    if (++n >= 3) break;
  }
  console.log("[31] total captured", n);
} finally {
  await embed.close();
}
