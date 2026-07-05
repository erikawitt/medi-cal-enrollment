/**
 * Spike step 14: full per-area flow (select SPA type -> SPA 1 -> Table View),
 * logging EVERY vizql response, and identify which response carries the Export
 * Data table (contains SPA1 Medi-Cal Persons = 167866). Dump its dataDictionary.
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
  console.log(`[spike] ${key}:`, JSON.stringify(value)?.slice(0, 1500));
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1400, height: 1200 } });
const page = await context.newPage();

const allResp: { url: string; body: string }[] = [];
page.on("response", async (r) => {
  const u = r.url();
  if (!/vizql/i.test(u)) return;
  try {
    const b = await r.body();
    if (b.length > 1000) allResp.push({ url: u, body: b.toString("utf8") });
  } catch {}
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

const SCALE = 1400 / 1024;
const P = (dx: number, dy: number) => ({ x: Math.round(dx * SCALE), y: Math.round(dy * SCALE) });

try {
  await page.goto(APEX_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitForInteractive(page);
  await page.waitForTimeout(3000);

  await page.mouse.click(P(194, 228).x, P(194, 228).y); // Service Planning Area
  await page.waitForTimeout(3500);
  await page.mouse.click(P(155, 439).x, P(155, 439).y); // SPA 1 sub-area
  await page.waitForTimeout(3500);

  allResp.length = 0; // clear; capture only Table View flow
  await page.mouse.click(P(218, 723).x, P(218, 723).y); // Table View button
  await page.waitForTimeout(6000);

  const report = allResp.map((r, i) => ({
    i,
    tail: r.url.split("/").slice(-2).join("/").split("?")[0].slice(0, 40),
    size: r.body.length,
    has167866: r.body.includes("167866"),
    hasDD: r.body.includes("dataSegments"),
  }));
  log("responses", report);

  const match = allResp.find((r) => r.body.includes("167866"));
  if (match) {
    writeFileSync(`${OUT}/tableview-export-data.json`, match.body);
    log("matched", { url: match.url.slice(0, 120), size: match.body.length });
  } else {
    log("matched", "NONE contained 167866");
    // Save the biggest for inspection anyway.
    const big = allResp.sort((a, b) => b.body.length - a.body.length)[0];
    if (big) { writeFileSync(`${OUT}/tableview-biggest.json`, big.body); log("biggest_saved", { url: big.url.slice(0, 120), size: big.body.length }); }
  }
} finally {
  writeFileSync(`${OUT}/findings-14.json`, JSON.stringify(findings, null, 2));
  await browser.close();
}
