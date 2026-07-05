/** Spike 24: capture the exact tabdoc/select request for a sub-area mark, then
 * replay it via fetch (in page context) with a different objectId to confirm we
 * can drive per-area selection programmatically. */
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const APEX_URL = "https://myappse.dpss.lacounty.gov/pls/apexprod/f?p=AAGT:AAGT";
const USER_AGENT = "medi-cal-disenrollment-tracker/0.1 (research scraper; contact: github.com/erkie/medi-cal-disenrollment)";
const OUT = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const findings: Record<string, unknown> = {};
const log = (k: string, v: unknown) => { findings[k] = v; console.log(`[24] ${k}:`, JSON.stringify(v)?.slice(0, 1200)); };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1400, height: 1200 } });
const page = await context.newPage();

const selectReqs: { url: string; headers: Record<string, string>; post: string | null }[] = [];
page.on("request", (req) => {
  if (/\/commands\/tabdoc\/select\b/.test(req.url())) {
    selectReqs.push({ url: req.url(), headers: req.headers(), post: req.postData() });
  }
});

async function waitForInteractive(p: Page) {
  await p.waitForSelector("tableau-viz", { timeout: 60_000 });
  await p.evaluate(() => new Promise<void>((res, rej) => {
    const viz = document.querySelector("tableau-viz") as any;
    const t = setTimeout(() => rej(new Error("timeout")), 90_000);
    viz.addEventListener("firstinteractive", () => { clearTimeout(t); res(); });
    try { if (viz.workbook?.publishedSheetsInfo?.length) { clearTimeout(t); res(); } } catch {}
  }));
}
const SCALE = 1400 / 1024;
const P = (dx: number, dy: number) => ({ x: Math.round(dx * SCALE), y: Math.round(dy * SCALE) });

try {
  await page.goto(APEX_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitForInteractive(page);
  await page.waitForTimeout(3000);
  await page.mouse.click(P(194, 228).x, P(194, 228).y); // SPA type
  await page.waitForTimeout(4000);

  selectReqs.length = 0;
  // Click SPA 2 (known-working position from spike 18) and also SPA 4, capturing
  // the tabdoc/select payloads to learn the objectId scheme.
  await page.mouse.click(P(155, 462).x, P(155, 462).y); // SPA 2
  await page.waitForTimeout(3500);
  await page.mouse.click(P(155, 508).x, P(155, 508).y); // SPA 4
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${OUT}/24-spa.png` });
  log("select_requests", selectReqs.map((r) => r.post));
  writeFileSync(`${OUT}/select-request.json`, JSON.stringify(selectReqs, null, 2));
} finally {
  writeFileSync(`${OUT}/findings-24.json`, JSON.stringify(findings, null, 2));
  await browser.close();
}
