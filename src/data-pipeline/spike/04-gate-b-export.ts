/**
 * Spike step 4 (gate B): drive the crosstab export end-to-end and watch for a
 * download. Try both the Embedding-API dialog and the native viz toolbar path.
 * Screenshot every frame so we can see where (if anywhere) a dialog appears.
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
const context = await browser.newContext({
  userAgent: USER_AGENT,
  viewport: { width: 1920, height: 1400 },
  acceptDownloads: true,
});
const page = await context.newPage();

// Log all network responses that look like crosstab/export/csv.
const netHits: any[] = [];
page.on("response", (r) => {
  const u = r.url();
  if (/crosstab|export|\.csv|vud|downloadfile|tempfile/i.test(u)) {
    netHits.push({ status: r.status(), url: u.slice(0, 200) });
  }
});

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
  await page.waitForTimeout(4000);

  const downloadPromise = page
    .waitForEvent("download", { timeout: 45_000 })
    .then((d) => d)
    .catch((e) => e as Error);

  // Trigger the export dialog.
  const dlgResult = await page.evaluate(async () => {
    const viz = document.querySelector("tableau-viz") as any;
    try {
      await viz.displayDialogAsync("export-cross-tab");
      return "displayed";
    } catch (e: any) {
      return `ERR ${e?.name}: ${e?.message}`;
    }
  });
  log("displayDialogAsync", dlgResult);
  await page.waitForTimeout(3500);

  // Screenshot + scan EVERY frame for a dialog.
  const dialogScan: any[] = [];
  for (let i = 0; i < page.frames().length; i++) {
    const f = page.frames()[i]!;
    try {
      const info = await f.evaluate(() => {
        const dlg =
          document.querySelector("[role='dialog']") ||
          document.querySelector(".fcdOverlay, .export-crosstab-options-dialog, [class*='Dialog']");
        return dlg ? { found: true, text: (dlg as HTMLElement).innerText?.slice(0, 500) } : { found: false };
      });
      dialogScan.push({ frame: f.url().slice(0, 80), ...info });
    } catch (e: any) {
      dialogScan.push({ frame: f.url().slice(0, 80), error: e?.message?.slice(0, 80) });
    }
  }
  log("dialog_scan", dialogScan);
  await page.screenshot({ path: `${OUT}/06-export-attempt.png` });

  // If a dialog is found in some frame, interact with it.
  const dlgFrame = page.frames().find(async (f) => {
    try {
      return await f.evaluate(() => !!document.querySelector("[role='dialog']"));
    } catch {
      return false;
    }
  });

  // Try clicking a Download/Export button in any frame that has a dialog.
  for (const f of page.frames()) {
    try {
      const acted = await f.evaluate(() => {
        const dlg = document.querySelector("[role='dialog'], [class*='Dialog']") as HTMLElement | null;
        if (!dlg) return null;
        const actions: string[] = [];
        // Prefer CSV.
        dlg.querySelectorAll("*").forEach((el) => {
          const t = (el as HTMLElement).innerText?.trim();
          if (t === "CSV" && (el as HTMLElement).offsetHeight > 0) {
            (el as HTMLElement).click();
            actions.push("csv");
          }
        });
        const btns = Array.from(dlg.querySelectorAll("button, [role='button'], a"));
        const dl = btns.find((b) => /download|export/i.test((b as HTMLElement).innerText));
        if (dl) {
          (dl as HTMLElement).click();
          actions.push(`clicked:${(dl as HTMLElement).innerText.trim()}`);
        }
        return actions;
      });
      if (acted) log(`dialog_actions@${f.url().slice(0, 40)}`, acted);
    } catch {}
  }

  await page.waitForTimeout(3000);
  const dl = await downloadPromise;
  if (dl instanceof Error) {
    log("download", `FAILED: ${dl.message.slice(0, 200)}`);
  } else {
    const ext = dl.suggestedFilename().match(/\.[a-z]+$/)?.[0] ?? ".bin";
    const path = `${OUT}/gate-b-export${ext}`;
    await dl.saveAs(path);
    log("download", { suggestedFilename: dl.suggestedFilename(), savedTo: path });
  }

  log("net_hits", netHits);
  await page.screenshot({ path: `${OUT}/07-export-final.png` });
} finally {
  writeFileSync(`${OUT}/findings-04.json`, JSON.stringify(findings, null, 2));
  await browser.close();
}
