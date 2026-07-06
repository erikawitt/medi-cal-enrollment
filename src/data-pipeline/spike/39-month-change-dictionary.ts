/** Spike 39: what happens to the VizQL data dictionary across a Report Month
 * change? The v2 capture of a re-captured January 2026 SPA 1 reconstructed to
 * garbage, suggesting the month-change response resets or renumbers the
 * session's dataSegments rather than appending. Record the full body stream of
 * bootstrap -> month select (January 2026) -> geo select (SPA) -> area select
 * (SPA 2), and dump each response's segment keys + pool sizes.
 */
import { writeFileSync } from "node:fs";
import {
  launchEmbed,
  closeSharedBrowser,
  selectReportMonth,
  selectGeoType,
  parseSubAreaDomain,
  subAreaZone,
  GEO_TYPES,
} from "../src/embed.ts";
import { parseVizqlBody } from "../src/vizql.ts";

const OUT = new URL("./out/", import.meta.url).pathname;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const spa = GEO_TYPES.find((g) => g.geoType === "spa")!;

const stream: { phase: string; url: string; body: string }[] = [];

function segReport(phase: string, bodies: string[]) {
  for (const body of bodies) {
    for (const chunk of parseVizqlBody(body)) {
      const found: string[] = [];
      (function walk(o: unknown, depth = 0) {
        if (o == null || typeof o !== "object" || depth > 60) return;
        for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
          if (k === "dataSegments" && v != null && typeof v === "object") {
            for (const [key, seg] of Object.entries(v as Record<string, unknown>)) {
              if (seg == null) { found.push(`${key}:null`); continue; }
              const cols = (seg as { dataColumns?: { dataType: string; dataValues: unknown[] }[] }).dataColumns ?? [];
              found.push(`${key}:{${cols.map((c) => `${c.dataType}=${c.dataValues.length}`).join(",")}}`);
            }
          }
          walk(v, depth + 1);
        }
      })(chunk);
      if (found.length) console.log(`[39] ${phase}: segments ${found.join(" | ")}`);
    }
  }
}

const embed = await launchEmbed({ headless: true });
try {
  const drain = (phase: string) => {
    const bodies = embed.drainResponses();
    for (const body of bodies) stream.push({ phase, url: "", body });
    segReport(phase, bodies);
    return bodies;
  };

  await sleep(2000);
  drain("bootstrap");

  // Month selection inlined (selectReportMonth drains internally, which would
  // swallow the month-change response we want to inspect).
  {
    const { frame, page } = embed;
    await page.keyboard.press("Escape");
    await page.mouse.move(5, 5);
    await sleep(500);
    const combo = await frame.evaluate(() => {
      const el = document.querySelector(".tabComboBoxNameContainer") as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (!combo) throw new Error("no month combo");
    const fe = await frame.frameElement();
    const fb = (await fe.boundingBox())!;
    await page.mouse.click(fb.x + combo.x, fb.y + combo.y);
    await sleep(1500);
    drain("month-menu-open");
    const item = await frame.evaluate((label) => {
      const el = [...document.querySelectorAll(".tabMenuItemName")].find(
        (e) => (e as HTMLElement).innerText?.trim() === label,
      ) as HTMLElement | undefined;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, "January 2026");
    if (!item) throw new Error("January 2026 not offered");
    await page.mouse.click(fb.x + item.x, fb.y + item.y);
    await sleep(6000);
    drain("month-change");
  }

  const baseResp = await selectGeoType(embed, spa);
  for (const body of baseResp) stream.push({ phase: "geo-select", url: "", body });
  segReport("geo-select", baseResp);
  const domain = parseSubAreaDomain(baseResp.join("\n"), spa.pattern);
  console.log("[39] spa domain:", JSON.stringify(domain));

  // Click SPA 2 (second row of the sub-area list).
  const zone = await subAreaZone(embed);
  const el = await embed.frame.frameElement();
  const box = (await el.boundingBox())!;
  embed.drainResponses();
  await embed.page.mouse.click(box.x + zone.x + 18, box.y + zone.y + 30 + 45);
  await sleep(5000);
  drain("area-select");

  writeFileSync(`${OUT}/39-month-change-stream.json`, JSON.stringify(stream));
  console.log(`[39] wrote ${stream.length} bodies to out/39-month-change-stream.json`);
} finally {
  await embed.close();
  await closeSharedBrowser();
  process.exit(0);
}
