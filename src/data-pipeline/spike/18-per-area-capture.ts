/**
 * Spike 18 (definitive): full flow load -> select SPA type -> select SPA 2 ->
 * Table View, saving EVERY vizql command/bootstrap response body in order.
 * Then we analyze offline which response carries the per-area Export Data.
 */
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const APEX_URL = "https://myappse.dpss.lacounty.gov/pls/apexprod/f?p=AAGT:AAGT";
const USER_AGENT =
  "medi-cal-disenrollment-tracker/0.1 (research scraper; contact: github.com/erkie/medi-cal-disenrollment)";
const OUT = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1400, height: 1200 } });
const page = await context.newPage();

const stream: { phase: string; url: string; body: string }[] = [];
let phase = "load";
page.on("response", async (r) => {
  const u = r.url();
  if (!/\/commands\/|bootstrapSession/i.test(u)) return;
  try {
    const b = await r.body();
    if (b.length > 400) stream.push({ phase, url: u.split("/").slice(-2).join("/").split("?")[0], body: b.toString("utf8") });
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

  phase = "select-spa-type";
  await page.mouse.click(P(194, 228).x, P(194, 228).y);
  await page.waitForTimeout(4000);

  phase = "select-spa2";
  await page.mouse.click(P(155, 462).x, P(155, 462).y); // SPA 2 row
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/20-spa2.png` });

  phase = "table-view";
  await page.mouse.click(P(218, 723).x, P(218, 723).y);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${OUT}/21-spa2-table.png`, fullPage: true });

  writeFileSync(`${OUT}/per-area-stream.json`, JSON.stringify(stream));
  console.log("[18] captured:", stream.map((s) => ({ phase: s.phase, tail: s.url.slice(0, 36), size: s.body.length })));
} finally {
  await browser.close();
}
