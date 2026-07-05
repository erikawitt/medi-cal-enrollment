/** Spike 25: prove programmatic per-area selection. Select SPA type via mouse,
 * capture the session command URL, then fetch-replay tabdoc/select for a few
 * objectIds and confirm each returns that area's data + a readable area name. */
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { extractPresModel, reconstructWorksheet } from "../src/vizql.ts";

const APEX_URL = "https://myappse.dpss.lacounty.gov/pls/apexprod/f?p=AAGT:AAGT";
const USER_AGENT = "medi-cal-disenrollment-tracker/0.1 (research scraper; contact: github.com/erkie/medi-cal-disenrollment)";
const OUT = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const findings: Record<string, unknown> = {};
const log = (k: string, v: unknown) => { findings[k] = v; console.log(`[25] ${k}:`, JSON.stringify(v)?.slice(0, 1200)); };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1400, height: 1200 } });
const page = await context.newPage();

let commandBase = "";
page.on("request", (req) => {
  const m = req.url().match(/^(.*\/sessions\/[^/]+\/commands)\//);
  if (m) commandBase = m[1];
});

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

/** Replay tabdoc/select for a Sub Administrative Area objectId, return response text. */
async function selectSubArea(frame: any, base: string, objectId: number): Promise<string> {
  return frame.evaluate(
    async ({ base, objectId }) => {
      const fd = new FormData();
      fd.append("worksheet", "Sub Administrative Area");
      fd.append("dashboard", "AtAGlance");
      fd.append("selection", JSON.stringify({ objectIds: [objectId], selectionType: "tuples" }));
      fd.append("selectOptions", "select-options-simple");
      fd.append("zoneId", "1838");
      fd.append("zoneSelectionType", "replace");
      fd.append("telemetryCommandId", Math.random().toString(36).slice(2) + "$sel");
      const r = await fetch(`${base}/tabdoc/select`, { method: "POST", body: fd, credentials: "include" });
      const text = await r.text();
      return `STATUS ${r.status} CT ${r.headers.get("content-type")} LEN ${text.length}\n` + text;
    },
    { base, objectId },
  );
}

try {
  await page.goto(APEX_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitForInteractive(page);
  await page.waitForTimeout(3000);
  await page.mouse.click(P(194, 228).x, P(194, 228).y); // SPA type
  await page.waitForTimeout(4000);
  log("commandBase", commandBase);
  const frame = page.frames().find((f) => f.url().includes("online.tableau.com"))!;

  for (const objectId of [1, 3, 5]) {
    const raw = await selectSubArea(frame, commandBase, objectId);
    const nl = raw.indexOf("\n");
    const statusLine = raw.slice(0, nl);
    const body = raw.slice(nl + 1);
    const model = extractPresModel([body]);
    const persons = reconstructWorksheet(model, "Persons by Med-Cal");
    log(`objectId ${objectId}`, {
      statusLine,
      medCalPersons: persons?.rows?.[0],
    });
    writeFileSync(`${OUT}/replay-spa-${objectId}.json`, body.slice(0, 2_000_000));
    await page.waitForTimeout(1200);
  }
} finally {
  writeFileSync(`${OUT}/findings-25.json`, JSON.stringify(findings, null, 2));
  await browser.close();
}
