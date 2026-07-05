/**
 * Spike 16: capture the FULL vizql response stream from fresh load -> Table View
 * (countywide/Department default), then reconstruct the Export Data crosstab and
 * verify against known May 2026 reference values.
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

const stream: { url: string; body: string }[] = [];
page.on("response", async (r) => {
  const u = r.url();
  if (!/\/commands\/|bootstrapSession/i.test(u)) return;
  try {
    const b = await r.body();
    if (b.length > 500) stream.push({ url: u, body: b.toString("utf8") });
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

try {
  await page.goto(APEX_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitForInteractive(page);
  await page.waitForTimeout(3000);
  // Directly activate Table View (countywide default).
  await page.evaluate(async () => {
    const viz = document.querySelector("tableau-viz") as any;
    await viz.workbook.activateSheetAsync("Table View");
  });
  await page.waitForTimeout(6000);

  writeFileSync(`${OUT}/full-stream.json`, JSON.stringify(stream.map((s) => ({ url: s.url, body: s.body })), null, 0));
  console.log("[16] stream responses:", stream.length, stream.map((s) => ({ tail: s.url.split("/").slice(-2).join("/").split("?")[0].slice(0, 40), size: s.body.length })));
} finally {
  await browser.close();
}
