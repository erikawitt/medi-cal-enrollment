/**
 * Spike step 6: capture VizQL traffic. Anonymous Tableau embeds return their
 * data model in the `bootstrapSession` response (and in command responses like
 * `set-parameter-value`, `categorical-filter`) as JSON containing a
 * `dataDictionary` of real values + `dataSegments`/`presModelMap` describing the
 * table. If we can parse that, we get all values without an export download.
 */
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const APEX_URL = "https://myappse.dpss.lacounty.gov/pls/apexprod/f?p=AAGT:AAGT";
const USER_AGENT =
  "medi-cal-disenrollment-tracker/0.1 (research scraper; contact: github.com/erkie/medi-cal-disenrollment)";
const OUT = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
mkdirSync(`${OUT}/vizql`, { recursive: true });

const findings: Record<string, unknown> = {};
const log = (key: string, value: unknown) => {
  findings[key] = value;
  console.log(`[spike] ${key}:`, JSON.stringify(value)?.slice(0, 1500));
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: USER_AGENT,
  viewport: { width: 1920, height: 1400 },
});
const page = await context.newPage();

const captured: { url: string; ct: string; size: number; file: string }[] = [];
let idx = 0;
page.on("response", async (r) => {
  const u = r.url();
  if (!/vizql|bootstrap|commands|sessions/i.test(u)) return;
  try {
    const ct = r.headers()["content-type"] ?? "";
    const buf = await r.body();
    if (buf.length < 500) return; // skip tiny image tiles
    const file = `${OUT}/vizql/${String(idx++).padStart(3, "0")}-${u.split("/").pop()?.split("?")[0]?.slice(0, 30) ?? "resp"}.txt`;
    // only keep textual bodies
    if (/json|javascript|text|octet/i.test(ct) || u.includes("bootstrap") || u.includes("commands")) {
      writeFileSync(file, buf);
      captured.push({ url: u.slice(0, 160), ct, size: buf.length, file });
    }
  } catch {}
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
  await page.waitForTimeout(6000);

  log(
    "captured",
    captured.map((c) => ({ url: c.url, ct: c.ct, size: c.size })),
  );
} finally {
  writeFileSync(`${OUT}/findings-06.json`, JSON.stringify(findings, null, 2));
  await browser.close();
}
