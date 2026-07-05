/**
 * Spike step 9 (gate B, take 2): drive the NATIVE Tableau toolbar
 * Download -> Crosstab -> (select Export Data sheet, CSV) -> Download,
 * and capture the resulting download event / tempfile response.
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
  console.log(`[spike] ${key}:`, JSON.stringify(value)?.slice(0, 1500));
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1920, height: 1400 }, acceptDownloads: true });
const page = await context.newPage();

const tempfileHits: string[] = [];
page.on("response", (r) => {
  const u = r.url();
  if (/export-crosstab|tempfile|generate-crosstab|crosstab/i.test(u)) tempfileHits.push(`${r.status()} ${u.slice(0, 140)}`);
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

async function clickByText(frame: Frame, texts: string[], within?: string): Promise<string | null> {
  return frame.evaluate(
    ({ texts, within }) => {
      const root = within ? document.querySelector(within) ?? document : document;
      const els = Array.from(root.querySelectorAll("button, a, [role='menuitem'], [role='button'], [role='radio'], label, div, span"));
      for (const el of els) {
        const h = el as HTMLElement;
        const t = h.innerText?.trim();
        if (t && texts.some((x) => t === x || t.toLowerCase() === x.toLowerCase()) && h.offsetHeight > 0) {
          h.click();
          return t;
        }
      }
      return null;
    },
    { texts, within },
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

  // 1) Click toolbar "Download".
  const dl1 = await clickByText(frame, ["Download"]);
  log("clicked_download_toolbar", dl1);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/11-download-menu.png` });

  // 2) Click "Crosstab" in the menu.
  const dl2 = await clickByText(frame, ["Crosstab", "Cross Tab", "Crosstab (CSV)"]);
  log("clicked_crosstab", dl2);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/12-crosstab-dialog.png` });

  // Dump dialog text across frames.
  for (const f of page.frames()) {
    try {
      const txt = await f.evaluate(() => {
        const d = document.querySelector("[role='dialog'], [class*='dialog'], [class*='Dialog']") as HTMLElement | null;
        return d?.innerText?.slice(0, 600) ?? null;
      });
      if (txt) log(`dialog@${f.url().slice(0, 40)}`, txt);
    } catch {}
  }

  // 3) In dialog: select Export Data sheet thumbnail if shown, choose CSV, click Download.
  const selSheet = await clickByText(frame, ["Export Data"], "[role='dialog']");
  log("selected_sheet", selSheet);
  await page.waitForTimeout(800);
  const selCsv = await clickByText(frame, ["CSV"], "[role='dialog']");
  log("selected_csv", selCsv);
  await page.waitForTimeout(800);

  const downloadPromise = page.waitForEvent("download", { timeout: 45_000 }).then((d) => d).catch((e) => e as Error);
  const finalBtn = await clickByText(frame, ["Download"], "[role='dialog']");
  log("final_download_button", finalBtn);

  const dl = await downloadPromise;
  if (dl instanceof Error) {
    log("download", `FAILED: ${dl.message.slice(0, 150)}`);
  } else {
    const ext = dl.suggestedFilename().match(/\.[a-z]+$/)?.[0] ?? ".csv";
    const path = `${OUT}/gate-b-crosstab${ext}`;
    await dl.saveAs(path);
    log("download", { suggestedFilename: dl.suggestedFilename(), savedTo: path });
  }
  log("tempfile_hits", tempfileHits);
  await page.screenshot({ path: `${OUT}/13-export-done.png` });
} finally {
  writeFileSync(`${OUT}/findings-09.json`, JSON.stringify(findings, null, 2));
  await browser.close();
}
