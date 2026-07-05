/**
 * Spike step 11 (gates C/D): drive Administrative Area selection on the landing
 * dashboard via canvas coordinate clicks, then inspect the Table View to learn
 * whether geography is a single-value filter (per-area) or a column (bulk).
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
  console.log(`[spike] ${key}:`, JSON.stringify(value)?.slice(0, 2000));
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

// Locate a text label's viewport rect by scanning nested text elements (Tableau
// renders labels as absolutely-positioned divs even when values are canvas).
async function locate(frame: Frame, label: string) {
  return frame.evaluate((label) => {
    const hits: { x: number; y: number; w: number; h: number }[] = [];
    document.querySelectorAll("div, span, a").forEach((el) => {
      if ((el as HTMLElement).innerText?.trim() === label) {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width > 0 && r.height > 0) hits.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height });
      }
    });
    return hits;
  }, label);
}

try {
  await page.goto(APEX_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitForInteractive(page);
  await page.waitForTimeout(3000);
  const frame = page.frames().find((f) => f.url().includes("online.tableau.com"))!;
  const frameEl = await frame.frameElement();
  const box = await frameEl.boundingBox();
  log("iframe_box", box);

  for (const label of ["Zip Code", "Service Planning Area", "Congressional District", "Administrative Area"]) {
    log(`locate:${label}`, await locate(frame, label));
  }

  // Click "Service Planning Area" (few areas → fast to verify bulk vs per-area).
  const spaHits = await locate(frame, "Service Planning Area");
  if (spaHits.length && box) {
    cmds.length = 0;
    const h = spaHits[0]!;
    await page.mouse.click(box.x + h.x, box.y + h.y);
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${OUT}/14-after-spa-area-click.png` });
    log("cmds_after_area_click", cmds.map((c) => ({ url: c.url.slice(0, 60), size: c.body.length })));

    // What does Sub Administrative Area show now?
    for (const label of ["Sub Administrative Area"]) {
      log(`locate_after:${label}`, await locate(frame, label));
    }
    // Dump any newly-visible text labels (SPA names?).
    const labels = await frame.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll("div, span, a").forEach((el) => {
        const t = (el as HTMLElement).innerText?.trim();
        if (t && t.length > 1 && t.length < 40 && (el as HTMLElement).getBoundingClientRect().width > 0) out.push(t);
      });
      return Array.from(new Set(out)).slice(0, 120);
    });
    log("visible_labels_after_click", labels);
  }
} finally {
  writeFileSync(`${OUT}/findings-11.json`, JSON.stringify(findings, null, 2));
  await browser.close();
}
