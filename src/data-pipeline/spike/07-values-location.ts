/**
 * Spike step 7: definitively locate the numeric cell values.
 *  (a) Search the Table View DOM for any element whose text is a formatted
 *      number like "1,910,584" (are values DOM text or canvas-painted?).
 *  (b) Trigger a fresh bootstrap by re-activating the sheet and capture the
 *      VizQL command response, then locate the reference values inside its
 *      dataDictionary and record the JSON path so we can parse it downstream.
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
  console.log(`[spike] ${key}:`, JSON.stringify(value)?.slice(0, 2000));
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1920, height: 2000 } });
const page = await context.newPage();

// Capture VizQL command responses (the ones that carry data).
const cmdBodies: { url: string; body: string }[] = [];
page.on("response", async (r) => {
  const u = r.url();
  if (!/commands|bootstrapSession|ensure-layout|render/i.test(u)) return;
  try {
    const buf = await r.body();
    if (buf.length > 5000) cmdBodies.push({ url: u, body: buf.toString("utf8") });
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
  await page.evaluate(async () => {
    const viz = document.querySelector("tableau-viz") as any;
    await viz.workbook.activateSheetAsync("Table View");
  });
  await page.waitForTimeout(6000);

  const frame = page.frames().find((f) => f.url().includes("online.tableau.com"))!;

  // (a) Is "1,910,584" (or any big formatted number) present as DOM text?
  const domNumbers = await frame.evaluate(() => {
    const re = /^\$?[\d]{1,3}(,\d{3})+(\.\d+)?$/;
    const hits: { tag: string; cls: string; text: string }[] = [];
    document.querySelectorAll("*").forEach((el) => {
      const direct = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent?.trim())
        .filter(Boolean)
        .join("");
      if (direct && re.test(direct)) {
        hits.push({ tag: el.tagName, cls: (el.className || "").toString().slice(0, 30), text: direct });
      }
    });
    return { count: hits.length, sample: hits.slice(0, 20) };
  });
  log("dom_numeric_values", domNumbers);

  const canvasCount = await frame.evaluate(() => document.querySelectorAll("canvas").length);
  log("canvas_count", canvasCount);

  // (b) Find reference values in captured VizQL bodies.
  const REFS = ["1910584", "3153672", "2267316", "498283", "120036"];
  const bodyReport = cmdBodies.map((b) => {
    const hits: Record<string, number> = {};
    for (const ref of REFS) hits[ref] = (b.body.match(new RegExp(ref, "g")) || []).length;
    return { url: b.url.slice(0, 90), size: b.body.length, refHits: hits };
  });
  log("vizql_bodies", bodyReport);

  // Save the richest body (most ref hits) for structural inspection.
  let best: { url: string; body: string } | null = null;
  let bestScore = 0;
  for (const b of cmdBodies) {
    const score = REFS.reduce((acc, ref) => acc + (b.body.includes(ref) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = b; }
  }
  if (best) {
    writeFileSync(`${OUT}/best-vizql-body.json`, best.body);
    log("best_body", { url: best.url.slice(0, 120), size: best.body.length, refScore: bestScore });
  }
} finally {
  writeFileSync(`${OUT}/findings-07.json`, JSON.stringify(findings, null, 2));
  await browser.close();
}
