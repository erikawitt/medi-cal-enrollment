/**
 * Spike step 5: characterize the rendered Table View DOM so we can scrape it
 * (gate B fallback). Extract text marks with their pixel positions, then
 * reconstruct rows/columns by clustering on x/y. Dump raw + reconstructed.
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
  console.log(`[spike] ${key}:`, JSON.stringify(value)?.slice(0, 2500));
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: USER_AGENT,
  viewport: { width: 1920, height: 2200 },
});
const page = await context.newPage();

async function waitForInteractive(p: Page) {
  await p.waitForSelector("tableau-viz", { timeout: 60_000 });
  await p.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const viz = document.querySelector("tableau-viz") as any;
        const t = setTimeout(() => reject(new Error("firstinteractive timeout")), 90_000);
        viz.addEventListener("firstinteractive", () => {
          clearTimeout(t);
          resolve();
        });
        try {
          if (viz.workbook?.publishedSheetsInfo?.length) {
            clearTimeout(t);
            resolve();
          }
        } catch {}
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
  await page.waitForTimeout(5000);

  const frame = page.frames().find((f) => f.url().includes("online.tableau.com"))!;

  // Extract text marks with positions inside the Export Data worksheet.
  const marks = await frame.evaluate(() => {
    // Tableau text marks render as spans/divs inside .tab-worksheet or canvas overlays.
    // Grab every element with visible text and no child text-bearing element.
    const results: { x: number; y: number; w: number; text: string; cls: string }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    const seen = new Set<Element>();
    let node = walker.currentNode as Element | null;
    while (node) {
      const el = node as HTMLElement;
      const direct = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent?.trim())
        .filter(Boolean)
        .join(" ");
      if (direct && direct.length > 0 && direct.length < 60) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.top >= 0 && !seen.has(el)) {
          seen.add(el);
          results.push({
            x: Math.round(r.left),
            y: Math.round(r.top),
            w: Math.round(r.width),
            text: direct,
            cls: el.className.toString().slice(0, 40),
          });
        }
      }
      node = walker.nextNode() as Element | null;
    }
    return results;
  });
  log("mark_count", marks.length);

  // Cluster into rows by y (tolerance), sort columns by x.
  marks.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: { y: number; cells: { x: number; text: string }[] }[] = [];
  for (const m of marks) {
    let row = rows.find((r) => Math.abs(r.y - m.y) <= 6);
    if (!row) {
      row = { y: m.y, cells: [] };
      rows.push(row);
    }
    row.cells.push({ x: m.x, text: m.text });
  }
  for (const r of rows) r.cells.sort((a, b) => a.x - b.x);
  const tableText = rows
    .map((r) => r.cells.map((c) => c.text).join("\t"))
    .filter((line) => line.trim().length > 0);
  writeFileSync(`${OUT}/table-reconstructed.tsv`, tableText.join("\n"));
  log("reconstructed_rows", tableText.length);
  log("sample_rows", tableText.slice(0, 40));

  // Also grab the container's full innerText for a simpler fallback.
  const fullText = await frame.evaluate(() => document.body.innerText);
  writeFileSync(`${OUT}/table-innertext.txt`, fullText);
  log("innertext_len", fullText.length);

  await page.screenshot({ path: `${OUT}/08-table-full.png`, fullPage: true });
} finally {
  writeFileSync(`${OUT}/findings-05.json`, JSON.stringify(findings, null, 2));
  await browser.close();
}
