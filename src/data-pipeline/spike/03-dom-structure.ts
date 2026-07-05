/**
 * Spike step 3: map the frame tree, find where the Tableau UI actually renders,
 * dump the AtAGlance landing controls (Report Month dropdown, Administrative
 * Area tree), and locate the rendered table DOM on Table View.
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
  console.log(`[spike] ${key}:`, JSON.stringify(value)?.slice(0, 4000));
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: USER_AGENT,
  viewport: { width: 1920, height: 1400 },
});
const page = await context.newPage();

const frameTree = (f: Frame, depth = 0): any => ({
  url: f.url().slice(0, 150),
  name: f.name()?.slice(0, 60),
  children: f.childFrames().map((c) => frameTree(c, depth + 1)),
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
  await page.waitForTimeout(2000);

  log("frame_tree", frameTree(page.mainFrame()));

  // For every frame, report counts of interesting selectors.
  const frameReports: any[] = [];
  for (const f of page.frames()) {
    try {
      const report = await f.evaluate(() => {
        const q = (sel: string) => document.querySelectorAll(sel).length;
        return {
          tabZones: q("[class*='tabZone']"),
          comboBoxes: q(".tabComboBoxNameContainer, [role='combobox']"),
          dialogs: q("[role='dialog']"),
          tables: q("table"),
          canvases: q("canvas"),
          bodyTextSample: document.body?.innerText?.slice(0, 400) ?? null,
        };
      });
      frameReports.push({ url: f.url().slice(0, 100), ...report });
    } catch (e: any) {
      frameReports.push({ url: f.url().slice(0, 100), error: e?.message?.slice(0, 100) });
    }
  }
  log("frame_reports", frameReports);

  await page.screenshot({ path: `${OUT}/05-landing.png` });

  // Find the frame with actual Tableau UI.
  let uiFrame: Frame | null = null;
  for (const f of page.frames()) {
    try {
      const n = await f.evaluate(() => document.querySelectorAll("[class*='tabZone']").length);
      if (n > 0) {
        uiFrame = f;
        break;
      }
    } catch {}
  }
  if (!uiFrame) {
    // Fall back: frame whose body mentions Report Month.
    for (const f of page.frames()) {
      try {
        const t = await f.evaluate(() => document.body?.innerText ?? "");
        if (/report month/i.test(t)) {
          uiFrame = f;
          break;
        }
      } catch {}
    }
  }
  log("ui_frame", uiFrame ? uiFrame.url().slice(0, 150) : null);

  if (uiFrame) {
    const controls = await uiFrame.evaluate(() => {
      const out: any[] = [];
      for (const z of Array.from(document.querySelectorAll("[class*='tabZone'], [class*='ParameterControl'], [class*='QuickFilter']"))) {
        const el = z as HTMLElement;
        const t = el.innerText?.trim();
        if (t && t.length < 300) {
          out.push({
            cls: el.className.toString().slice(0, 100),
            testId: el.getAttribute("data-tb-test-id"),
            text: t.slice(0, 150),
          });
        }
      }
      return out.slice(0, 80);
    });
    log("ui_controls", controls);
  }
} finally {
  writeFileSync(`${OUT}/findings-03.json`, JSON.stringify(findings, null, 2));
  await browser.close();
}
