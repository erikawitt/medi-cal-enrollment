/**
 * Spike step 12 (gates A/C/D): click Administrative Area list items by canvas
 * coordinate, capture the exact VizQL command (URL + POST body) that fires, and
 * observe whether the Table View becomes per-area or shows geography as a column.
 */
import { chromium, type Frame, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const APEX_URL = "https://myappse.dpss.lacounty.gov/pls/apexprod/f?p=AAGT:AAGT";
const USER_AGENT =
  "medi-cal-disenrollment-tracker/0.1 (research scraper; contact: github.com/erkie/medi-cal-disenrollment)";
const OUT = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const findings: Record<string, unknown> = {};
const log = (key: string, value: unknown) => {
  findings[key] = value;
  console.log(`[spike] ${key}:`, JSON.stringify(value)?.slice(0, 1800));
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1400, height: 1200 } });
const page = await context.newPage();

const reqLog: any[] = [];
page.on("request", (req) => {
  const u = req.url();
  if (/\/commands\//i.test(u)) {
    reqLog.push({ url: u.slice(0, 160), method: req.method(), post: req.postData()?.slice(0, 500) ?? null });
  }
});
const respLog: { url: string; body: string }[] = [];
page.on("response", async (r) => {
  const u = r.url();
  if (!/\/commands\/|bootstrapSession/i.test(u)) return;
  try {
    const b = await r.body();
    if (b.length > 2000) respLog.push({ url: u, body: b.toString("utf8") });
  } catch {}
});

async function waitForInteractive(p: Page) {
  await p.waitForSelector("tableau-viz", { timeout: 60_000 });
  await p.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const viz = document.querySelector("tableau-viz") as any;
        const t = setTimeout(() => reject(new Error("firstinteractive timeout")), 90_000);
        viz.addEventListener("firstinteractive", () => { clearTimeout(t); resolve(); });
        try { if (viz.workbook?.publishedSheetsInfo?.length) { clearTimeout(t); resolve(); } } catch {}
      }),
  );
}

try {
  await page.goto(APEX_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitForInteractive(page);
  await page.waitForTimeout(3000);
  const frame = page.frames().find((f) => f.url().includes("online.tableau.com"))!;
  const frameEl = await frame.frameElement();
  const box = (await frameEl.boundingBox())!;

  // Locate the Administrative Area viz zone rect (frame coords).
  const zoneRect = await frame.evaluate(() => {
    // The zone whose descendant text === "Administrative Area", pick the tall viz zone.
    let best: any = null;
    document.querySelectorAll("[class*='tabZone']").forEach((z) => {
      const t = (z as HTMLElement).innerText?.trim();
      const r = (z as HTMLElement).getBoundingClientRect();
      if (r.height > 200 && r.width > 100 && r.left < 300) {
        if (!best || r.height > best.h) best = { x: r.left, y: r.top, w: r.width, h: r.height, text: t?.slice(0, 40) };
      }
    });
    return best;
  });
  log("area_zone_rect", zoneRect);
  await page.screenshot({ path: `${OUT}/15-before-click.png` });

  // The list of 10 items is stacked in the zone below the title. Compute rows.
  const items = ["Department","Supervisorial District","Service Planning Area","State Assembly District","State Senate District","Congressional District","District Offices","IHSS Offices","City","Zip Code"];
  // Click "Service Planning Area" (index 2).
  const target = "Service Planning Area";
  const idxT = items.indexOf(target);

  if (zoneRect) {
    // Items begin a bit below zone top (title occupies first ~30px handled separately).
    const listTop = zoneRect.y + 8;
    const rowH = (zoneRect.h - 8) / items.length;
    const fx = zoneRect.x + 20;
    const fy = listTop + (idxT + 0.5) * rowH;
    log("click_target", { target, pageX: box.x + fx, pageY: box.y + fy });
    reqLog.length = 0;
    respLog.length = 0;
    await page.mouse.click(box.x + fx, box.y + fy);
    await page.waitForTimeout(4500);
    await page.screenshot({ path: `${OUT}/16-after-area-click.png` });
    log("commands_after_click", reqLog);
    // SPA names to check for bulk (geography-as-column) behavior.
    const spaNames = ["Antelope","San Fernando","San Gabriel","Metro","West","South","East","South Bay"];
    log("resp_spa_scan", respLog.map((r) => ({ url: r.url.slice(0, 60), size: r.body.length, hits: spaNames.filter((n) => r.body.includes(n)).length })));
    if (respLog.length) writeFileSync(`${OUT}/area-click-resp.json`, respLog[respLog.length - 1]!.body);
  }
} finally {
  writeFileSync(`${OUT}/findings-12.json`, JSON.stringify(findings, null, 2));
  await browser.close();
}
