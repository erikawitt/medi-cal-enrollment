/** Spike 23: after selecting a geo type, can we read the Sub Administrative Area
 * list items (names + positions) from the DOM, and does replaying tabdoc/select
 * via fetch return a specific area's data? */
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const APEX_URL = "https://myappse.dpss.lacounty.gov/pls/apexprod/f?p=AAGT:AAGT";
const USER_AGENT = "medi-cal-disenrollment-tracker/0.1 (research scraper; contact: github.com/erkie/medi-cal-disenrollment)";
const OUT = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const findings: Record<string, unknown> = {};
const log = (k: string, v: unknown) => { findings[k] = v; console.log(`[23] ${k}:`, JSON.stringify(v)?.slice(0, 2000)); };

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
  await page.mouse.click(P(194, 228).x, P(194, 228).y); // Service Planning Area
  await page.waitForTimeout(4000);
  const frame = page.frames().find((f) => f.url().includes("online.tableau.com"))!;

  // Look for SPA labels as DOM text.
  const labels = await frame.evaluate(() => {
    const out: { text: string; x: number; y: number; w: number; h: number; tag: string }[] = [];
    document.querySelectorAll("div, span, a, text, tspan").forEach((el) => {
      const t = (el as HTMLElement).innerText?.trim() ?? el.textContent?.trim();
      if (t && /^(SPA \d|Unknown|Sub Administrative Area)$/.test(t)) {
        const r = (el as HTMLElement).getBoundingClientRect?.() ?? { left: 0, top: 0, width: 0, height: 0 };
        out.push({ text: t, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), tag: el.tagName });
      }
    });
    return out;
  });
  log("spa_dom_labels", labels);

  // Also check the SVG/canvas marks: Tableau sometimes puts mark text in <text> within worksheet SVG.
  const svgTexts = await frame.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll("svg text, .tab-vizHeader, .tabComboBox").forEach((el) => {
      const t = (el as HTMLElement).textContent?.trim();
      if (t && t.length < 30) out.push(t);
    });
    return out.slice(0, 40);
  });
  log("svg_texts", svgTexts);
} finally {
  writeFileSync(`${OUT}/findings-23.json`, JSON.stringify(findings, null, 2));
  await browser.close();
}
