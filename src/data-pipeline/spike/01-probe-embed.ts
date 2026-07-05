/**
 * Spike step 1: load the DPSS APEX page, wait for the Tableau embed, switch to
 * the "Table View" dashboard, and probe which Embedding API v3 calls are
 * permitted for anonymous viewers (decision gate A groundwork).
 *
 * Outputs screenshots + a JSON findings log under spike/out/.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const APEX_URL = "https://myappse.dpss.lacounty.gov/pls/apexprod/f?p=AAGT:AAGT";
const USER_AGENT =
  "medi-cal-disenrollment-tracker/0.1 (research scraper; contact: github.com/erkie/medi-cal-disenrollment)";
const OUT = new URL("./out/", import.meta.url).pathname;

mkdirSync(OUT, { recursive: true });

const findings: Record<string, unknown> = {};
const log = (key: string, value: unknown) => {
  findings[key] = value;
  console.log(`[spike] ${key}:`, JSON.stringify(value)?.slice(0, 2000));
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: USER_AGENT,
  viewport: { width: 1600, height: 1200 },
});
const page = await context.newPage();

try {
  await page.goto(APEX_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("tableau-viz", { timeout: 60_000 });

  // Wait for the viz to be interactive (the web component fires firstinteractive).
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const viz = document.querySelector("tableau-viz") as any;
        if (!viz) return reject(new Error("no tableau-viz element"));
        const t = setTimeout(() => reject(new Error("firstinteractive timeout")), 90_000);
        viz.addEventListener("firstinteractive", () => {
          clearTimeout(t);
          resolve();
        });
        // Already interactive? workbook property is populated once ready.
        try {
          if (viz.workbook?.publishedSheetsInfo?.length) {
            clearTimeout(t);
            resolve();
          }
        } catch {}
      }),
  );
  log("embed_interactive", true);

  const sheetsInfo = await page.evaluate(() => {
    const viz = document.querySelector("tableau-viz") as any;
    return viz.workbook.publishedSheetsInfo.map((s: any) => ({
      name: s.name,
      sheetType: s.sheetType,
      active: s.active,
    }));
  });
  log("publishedSheetsInfo", sheetsInfo);

  await page.evaluate(async () => {
    const viz = document.querySelector("tableau-viz") as any;
    await viz.workbook.activateSheetAsync("Table View");
  });
  await page.waitForTimeout(3000);
  log("activated_table_view", true);
  await page.screenshot({ path: `${OUT}/01-table-view.png`, fullPage: false });

  // Enumerate worksheets on the active dashboard.
  const worksheets = await page.evaluate(() => {
    const viz = document.querySelector("tableau-viz") as any;
    const sheet = viz.workbook.activeSheet;
    return {
      activeSheetName: sheet.name,
      sheetType: sheet.sheetType,
      worksheets: sheet.worksheets?.map((w: any) => w.name) ?? null,
    };
  });
  log("active_dashboard", worksheets);

  // Probe API permissions one call at a time; record error class/message.
  const probe = async (label: string, fn: string) => {
    const result = await page.evaluate(async (body) => {
      const viz = document.querySelector("tableau-viz") as any;
      const sheet = viz.workbook.activeSheet;
      const ws = sheet.worksheets?.find((w: any) => w.name === "Export Data");
      try {
        const f = new Function("viz", "ws", `return (async () => { ${body} })()`);
        const value = await f(viz, ws);
        return { ok: true, value: JSON.parse(JSON.stringify(value ?? null))?.toString?.() ?? value };
      } catch (e: any) {
        return { ok: false, error: `${e?.name ?? "Error"}: ${e?.message ?? e}` };
      }
    }, fn);
    log(`probe.${label}`, result);
    return result;
  };

  await probe(
    "getFiltersAsync",
    `const fs = await ws.getFiltersAsync();
     return fs.map(f => ({ fieldName: f.fieldName, filterType: f.filterType }));`,
  );

  await probe(
    "getParametersAsync",
    `const ps = await viz.workbook.getParametersAsync();
     return ps.map(p => p.name);`,
  );

  await probe(
    "applyFilterAsync_bogus_field",
    `await ws.applyFilterAsync("Nonexistent Field Xyz", ["foo"], "replace");
     return "applied";`,
  );

  await probe(
    "changeParameterValueAsync_guess",
    `const r = await viz.workbook.changeParameterValueAsync("Select Month Filter Parameter", "April 2026");
     return r?.name ?? "changed";`,
  );

  // Dump visible text of the embed's iframe UI (filter panel, month dropdown).
  const frames = page.frames().map((f) => ({ url: f.url().slice(0, 120) }));
  log("frames", frames);

  await page.screenshot({ path: `${OUT}/02-after-probes.png`, fullPage: false });
} finally {
  writeFileSync(`${OUT}/findings-01.json`, JSON.stringify(findings, null, 2));
  await browser.close();
}
