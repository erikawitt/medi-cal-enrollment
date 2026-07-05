/**
 * Spike step 8 (gates A/C/D): understand the Administrative Area drill-down.
 *  - Click "Zip Code" in the Administrative Area tree (landing dashboard).
 *  - Observe the Sub Administrative Area control + how the viz reacts.
 *  - Capture VizQL command responses to see whether zip becomes a column
 *    (bulk, all zips at once) or a single-value filter (per-area).
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
const context = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1920, height: 1600 } });
const page = await context.newPage();

const cmds: { url: string; body: string }[] = [];
page.on("response", async (r) => {
  const u = r.url();
  if (!/commands|bootstrapSession/i.test(u)) return;
  try {
    const buf = await r.body();
    if (buf.length > 3000) cmds.push({ url: u, body: buf.toString("utf8") });
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

  // Find the "Zip Code" clickable label in the Administrative Area tree.
  const areaItems = await frame.evaluate(() => {
    const items: { text: string; x: number; y: number }[] = [];
    document.querySelectorAll("*").forEach((el) => {
      const direct = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent?.trim())
        .filter(Boolean)
        .join("");
      if (
        direct &&
        /^(Department|Supervisorial District|Service Planning Area|State Assembly District|State Senate District|Congressional District|District Offices|IHSS Offices|City|Zip Code)$/.test(
          direct,
        )
      ) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) items.push({ text: direct, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
      }
    });
    return items;
  });
  log("area_tree_items", areaItems);

  const zip = areaItems.find((i) => i.text === "Zip Code");
  const spa = areaItems.find((i) => i.text === "Service Planning Area");
  cmds.length = 0;

  if (spa) {
    await frame.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      el?.click();
    }, spa);
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${OUT}/09-spa-selected.png` });
    log("after_spa_click_cmds", cmds.map((c) => ({ url: c.url.slice(0, 70), size: c.body.length })));

    // Inspect the Sub Administrative Area control now.
    const subArea = await frame.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll("[class*='ParameterControl'], [class*='QuickFilter'], [class*='FilterBox'], select, [role='listbox']").forEach((el) => {
        const t = (el as HTMLElement).innerText?.trim();
        if (t) out.push(t.slice(0, 200));
      });
      return out.slice(0, 30);
    });
    log("sub_area_controls_after_spa", subArea);
  }

  // Now activate Table View and capture what geography granularity appears.
  cmds.length = 0;
  await page.evaluate(async () => {
    const viz = document.querySelector("tableau-viz") as any;
    await viz.workbook.activateSheetAsync("Table View");
  });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}/10-table-after-spa.png` });

  // Count distinct SPA names visible in the VizQL body (bulk indicator).
  const spaNames = ["Antelope Valley", "San Fernando", "San Gabriel", "Metro", "West", "South", "East", "South Bay"];
  const bulkCheck = cmds.map((c) => ({
    url: c.url.slice(0, 70),
    size: c.body.length,
    spaNameHits: spaNames.filter((n) => c.body.includes(n)).length,
  }));
  log("table_view_bulk_check", bulkCheck);

  // Save biggest body for inspection.
  const biggest = cmds.sort((a, b) => b.body.length - a.body.length)[0];
  if (biggest) {
    writeFileSync(`${OUT}/table-after-spa-body.json`, biggest.body);
    log("saved_body", { url: biggest.url.slice(0, 100), size: biggest.body.length });
  }
} finally {
  writeFileSync(`${OUT}/findings-08.json`, JSON.stringify(findings, null, 2));
  await browser.close();
}
