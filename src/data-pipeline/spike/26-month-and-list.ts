/** Spike 26: (a) open the Report Month dropdown and read the month options;
 * (b) after selecting SPA type, read the Sub Administrative Area zone geometry +
 * enumerate item marks (names) so the driver can click them by position. */
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const APEX_URL = "https://myappse.dpss.lacounty.gov/pls/apexprod/f?p=AAGT:AAGT";
const USER_AGENT = "medi-cal-disenrollment-tracker/0.1 (research scraper; contact: github.com/erkie/medi-cal-disenrollment)";
const OUT = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const findings: Record<string, unknown> = {};
const log = (k: string, v: unknown) => { findings[k] = v; console.log(`[26] ${k}:`, JSON.stringify(v)?.slice(0, 2500)); };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1400, height: 1200 } });
const page = await context.newPage();
async function waitForInteractive(p: Page) {
  await p.waitForSelector("tableau-viz", { timeout: 60_000 });
  await p.evaluate(() => new Promise<void>((res, rej) => {
    const viz = document.querySelector("tableau-viz") as any;
    const t = setTimeout(() => rej(new Error("timeout")), 90_000);
    viz.addEventListener("firstinteractive", () => { clearTimeout(t); res(); });
    try { if (viz.workbook?.publishedSheetsInfo?.length) { clearTimeout(t); res(); } } catch {}
  }));
}
const SCALE = 1400 / 1024;
const P = (dx: number, dy: number) => ({ x: Math.round(dx * SCALE), y: Math.round(dy * SCALE) });

try {
  await page.goto(APEX_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitForInteractive(page);
  await page.waitForTimeout(3000);
  const frame = page.frames().find((f) => f.url().includes("online.tableau.com"))!;

  // (a) Report Month parameter control: find the combobox + open it.
  const combo = await frame.evaluate(() => {
    const el = document.querySelector(".tabComboBoxNameContainer, [class*='ParameterControl'] [class*='ComboBox']") as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { text: el.innerText, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  log("month_combo", combo);
  const frameEl = await frame.frameElement();
  const box = (await frameEl.boundingBox())!;
  if (combo) {
    await page.mouse.click(box.x + combo.x, box.y + combo.y);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/26-month-menu.png` });
    // The menu renders as .tabMenuItemName items (often in a top-level layer of the frame).
    const months = await frame.evaluate(() => {
      const out: { text: string; y: number }[] = [];
      document.querySelectorAll(".tabMenuItemName, [class*='FIItem'], [role='menuitem'], [role='option']").forEach((el) => {
        const t = (el as HTMLElement).innerText?.trim();
        const r = (el as HTMLElement).getBoundingClientRect();
        if (t) out.push({ text: t, y: Math.round(r.top) });
      });
      return out;
    });
    log("month_options", months);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  // (b) select SPA type, inspect Sub Administrative Area zone.
  await page.mouse.click(P(194, 228).x, P(194, 228).y);
  await page.waitForTimeout(4000);
  const zones = await frame.evaluate(() => {
    const out: any[] = [];
    document.querySelectorAll("[class*='tabZone']").forEach((z) => {
      const r = (z as HTMLElement).getBoundingClientRect();
      const t = (z as HTMLElement).innerText?.trim() ?? "";
      if (r.left < 320 && r.width > 100 && r.height > 40) out.push({ cls: (z as HTMLElement).className.toString().slice(0, 50), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), text: t.slice(0, 60) });
    });
    return out;
  });
  log("left_zones", zones);
} finally {
  writeFileSync(`${OUT}/findings-26.json`, JSON.stringify(findings, null, 2));
  await browser.close();
}
