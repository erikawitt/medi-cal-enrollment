/**
 * Spike step 13 (gates A/C/D): click the Administrative Area list using measured
 * PAGE coordinates (viewport 1400x1200), then inspect Sub Administrative Area
 * and the Table View to resolve bulk-vs-per-area and filter semantics.
 */
import { chromium, type Page } from "playwright";
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
  if (/\/commands\//i.test(req.url())) reqLog.push({ url: req.url().split("/commands/")[1]?.slice(0, 60), post: req.postData()?.slice(0, 300) ?? null });
});
const respLog: { url: string; body: string }[] = [];
page.on("response", async (r) => {
  if (!/\/commands\/|bootstrapSession/i.test(r.url())) return;
  try { const b = await r.body(); if (b.length > 2000) respLog.push({ url: r.url(), body: b.toString("utf8") }); } catch {}
});

async function waitForInteractive(p: Page) {
  await p.waitForSelector("tableau-viz", { timeout: 60_000 });
  await p.evaluate(
    () => new Promise<void>((resolve, reject) => {
      const viz = document.querySelector("tableau-viz") as any;
      const t = setTimeout(() => reject(new Error("firstinteractive timeout")), 90_000);
      viz.addEventListener("firstinteractive", () => { clearTimeout(t); resolve(); });
      try { if (viz.workbook?.publishedSheetsInfo?.length) { clearTimeout(t); resolve(); } } catch {}
    }),
  );
}

// Measured from 15-before-click.png (1024-wide render of the 1400 viewport) * 1.367.
const SCALE = 1400 / 1024;
const P = (dx: number, dy: number) => ({ x: Math.round(dx * SCALE), y: Math.round(dy * SCALE) });
const COORDS = {
  servicePlanningArea: P(194, 228),
  zipCode: P(161, 388),
  subAreaDropdown: P(218, 430),
  tableViewBtn: P(218, 723),
};

try {
  await page.goto(APEX_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitForInteractive(page);
  await page.waitForTimeout(3000);

  // Click Service Planning Area.
  reqLog.length = 0; respLog.length = 0;
  log("clicking", { ...COORDS.servicePlanningArea, what: "Service Planning Area" });
  await page.mouse.click(COORDS.servicePlanningArea.x, COORDS.servicePlanningArea.y);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/17-spa-clicked.png` });
  log("cmds_after_spa", reqLog);

  // Open Sub Administrative Area dropdown to see options.
  await page.mouse.click(COORDS.subAreaDropdown.x, COORDS.subAreaDropdown.y);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/18-subarea-dropdown.png` });
  // Grab dropdown option text from anywhere in the frame.
  const frame = page.frames().find((f) => f.url().includes("online.tableau.com"))!;
  const options = await frame.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll("[class*='FICheckRadio'], [class*='facetOverflow'], [class*='CFElement'], [role='option'], .tabMenuItemName").forEach((el) => {
      const t = (el as HTMLElement).innerText?.trim();
      if (t) out.push(t.slice(0, 40));
    });
    return Array.from(new Set(out)).slice(0, 60);
  });
  log("subarea_options", options);

  // Close dropdown, go to Table View.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  reqLog.length = 0; respLog.length = 0;
  await page.mouse.click(COORDS.tableViewBtn.x, COORDS.tableViewBtn.y);
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}/19-tableview-spa.png`, fullPage: true });
  log("cmds_after_tableview", reqLog);

  const spaNames = ["Antelope","San Fernando","San Gabriel","Metro","West","South","East","South Bay"];
  log("resp_scan", respLog.map((r) => ({ url: r.url.split("/v/")[1]?.slice(0, 40), size: r.body.length, spaHits: spaNames.filter((n) => r.body.includes(n)).length })));
  const biggest = respLog.sort((a, b) => b.body.length - a.body.length)[0];
  if (biggest) writeFileSync(`${OUT}/tableview-spa-body.json`, biggest.body);
} finally {
  writeFileSync(`${OUT}/findings-13.json`, JSON.stringify(findings, null, 2));
  await browser.close();
}
