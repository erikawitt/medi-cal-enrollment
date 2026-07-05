/**
 * Spike step 2:
 *  - dump full detail of each filter on the Export Data worksheet (gate A)
 *  - enumerate the Report Month dropdown + Administrative Area tree via DOM (gate A)
 *  - attempt the crosstab export end-to-end and capture the download (gate B)
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
  console.log(`[spike] ${key}:`, JSON.stringify(value)?.slice(0, 3000));
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: USER_AGENT,
  viewport: { width: 1920, height: 1400 },
});
const page = await context.newPage();

try {
  await page.goto(APEX_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("tableau-viz", { timeout: 60_000 });
  await page.evaluate(
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

  await page.evaluate(async () => {
    const viz = document.querySelector("tableau-viz") as any;
    await viz.workbook.activateSheetAsync("Table View");
  });
  await page.waitForTimeout(3000);

  // ---- Filter detail dump (gate A) ----
  const filterDetail = await page.evaluate(async () => {
    const viz = document.querySelector("tableau-viz") as any;
    const sheet = viz.workbook.activeSheet;
    const out: any[] = [];
    for (const ws of sheet.worksheets) {
      const filters = await ws.getFiltersAsync();
      for (const f of filters) {
        const d: any = {
          worksheet: ws.name,
          fieldName: f.fieldName,
          filterType: f.filterType,
        };
        try {
          d.appliedValues = f.appliedValues?.map((v: any) => v.value ?? v.formattedValue);
        } catch (e: any) {
          d.appliedValues = `ERR ${e?.message}`;
        }
        try {
          d.isAllSelected = f.isAllSelected;
        } catch {}
        try {
          const dom = await f.getDomainAsync?.("database");
          d.domain = dom?.values?.map((v: any) => v.value ?? v.formattedValue)?.slice(0, 60);
        } catch (e: any) {
          d.domain = `ERR ${e?.message?.slice(0, 200)}`;
        }
        out.push(d);
      }
    }
    return out;
  });
  log("filters", filterDetail);

  // ---- DOM: what does the Tableau iframe UI expose? ----
  const tabFrame = page.frames().find((f) => f.url().includes("online.tableau.com"));
  if (!tabFrame) throw new Error("no tableau iframe");

  // Dump the dropdown-style controls' visible text.
  const controlText = await tabFrame.evaluate(() => {
    const els = Array.from(
      document.querySelectorAll(
        ".tabComboBoxNameContainer, .QFSliderLabel, .tab-widget [role='combobox'], .CategoricalFilterBox",
      ),
    );
    return els.map((e) => (e as HTMLElement).innerText?.trim()).filter(Boolean);
  });
  log("dom_controls", controlText);

  // The Report Month dropdown: find candidate parameter/quick-filter zones.
  const zones = await tabFrame.evaluate(() => {
    const out: any[] = [];
    for (const z of Array.from(document.querySelectorAll("[class*='tabZone']"))) {
      const t = (z as HTMLElement).innerText?.trim();
      if (t && t.length < 200) out.push({ cls: z.className.slice(0, 80), text: t });
    }
    return out.slice(0, 60);
  });
  log("dom_zones", zones);

  // ---- Gate B: crosstab export end-to-end ----
  const downloadPromise = page.waitForEvent("download", { timeout: 60_000 }).catch((e) => e);

  await page.evaluate(async () => {
    const viz = document.querySelector("tableau-viz") as any;
    await viz.displayDialogAsync("export-cross-tab");
  });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/03-export-dialog.png` });

  // The export dialog lives inside the Tableau iframe. Inspect it.
  const dialogText = await tabFrame.evaluate(() => {
    const dlg = document.querySelector("[role='dialog']") as HTMLElement | null;
    return dlg?.innerText ?? null;
  });
  log("export_dialog_text", dialogText);

  // Select CSV format if offered, pick the Export Data sheet, click the export button.
  const clicked = await tabFrame.evaluate(() => {
    const dlg = document.querySelector("[role='dialog']") as HTMLElement | null;
    if (!dlg) return { dialog: false };
    const result: any = { dialog: true, actions: [] };
    // Choose CSV radio if present.
    for (const label of Array.from(dlg.querySelectorAll("label, [role='radio']"))) {
      const t = (label as HTMLElement).innerText?.trim().toLowerCase();
      if (t === "csv") {
        (label as HTMLElement).click();
        result.actions.push("clicked csv radio");
      }
    }
    // Select the Export Data sheet thumbnail if present.
    for (const el of Array.from(dlg.querySelectorAll("[data-tb-test-id], [role='option'], [role='listitem'], button"))) {
      const t = (el as HTMLElement).innerText?.trim();
      if (t === "Export Data") {
        (el as HTMLElement).click();
        result.actions.push("clicked Export Data sheet");
        break;
      }
    }
    return result;
  });
  log("export_dialog_interactions", clicked);
  await page.waitForTimeout(1000);

  const exportClicked = await tabFrame.evaluate(() => {
    const dlg = document.querySelector("[role='dialog']") as HTMLElement | null;
    if (!dlg) return false;
    const buttons = Array.from(dlg.querySelectorAll("button"));
    const btn = buttons.find((b) => /download|export/i.test(b.innerText));
    if (btn) {
      btn.click();
      return btn.innerText;
    }
    return false;
  });
  log("export_button_clicked", exportClicked);

  const dl = await downloadPromise;
  if (dl instanceof Error) {
    log("download", `FAILED: ${dl.message.slice(0, 300)}`);
  } else {
    const path = `${OUT}/gate-b-export${dl.suggestedFilename().match(/\.[a-z]+$/)?.[0] ?? ".bin"}`;
    await dl.saveAs(path);
    log("download", { suggestedFilename: dl.suggestedFilename(), savedTo: path });
  }
  await page.screenshot({ path: `${OUT}/04-after-export.png` });
} finally {
  writeFileSync(`${OUT}/findings-02.json`, JSON.stringify(findings, null, 2));
  await browser.close();
}
