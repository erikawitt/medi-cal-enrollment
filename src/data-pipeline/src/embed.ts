/**
 * Driver for the DPSS At-A-Glance Tableau embed.
 *
 * The anonymous embed offers no data or filter API (docs/adr/0001, docs/adr/0002),
 * so we drive it the way a person would: load the APEX page fresh (which mints a
 * one-shot Tableau JWT), pick a Report Month from the parameter dropdown, pick a
 * geography level in the "Administrative Area" list, and step through each value
 * in the "Sub Administrative Area" list. Every selection makes the embed POST a
 * VizQL `tabdoc/select` command; we capture that response — it carries the
 * selected area's full presModel (see src/vizql.ts).
 *
 * Politeness (acceptance criteria): a descriptive User-Agent is set, and callers
 * pace interactions with `POLITE_DELAY_MS` between them.
 */
import { chromium, type Browser, type Frame, type Page } from "playwright";

export const APEX_URL = "https://myappse.dpss.lacounty.gov/pls/apexprod/f?p=AAGT:AAGT";
export const USER_AGENT =
  "medi-cal-disenrollment-tracker/0.1 (research scraper; +https://github.com/erkie/medi-cal-disenrollment)";
/** Minimum delay between embed interactions (acceptance criteria: ≥ 1s). */
export const POLITE_DELAY_MS = 1000;

/**
 * The five scraped geography levels, in the order we scrape them (cheapest
 * first). `label` is the "Administrative Area" list item; `pattern` matches the
 * type's sub-area values (each level names its areas with a clean convention,
 * e.g. "SPA 3", "CD 23", "90001"), which lets us isolate this type's sub-area
 * domain from the other cross-type tokens in the same response.
 */
export const GEO_TYPES = [
  { geoType: "spa", label: "Service Planning Area", pattern: /^(SPA \d+|Unknown)$/ },
  { geoType: "congressional_district", label: "Congressional District", pattern: /^(CD \d+|Unknown)$/ },
  { geoType: "senate_district", label: "State Senate District", pattern: /^(SSD \d+|Unknown)$/ },
  { geoType: "assembly_district", label: "State Assembly District", pattern: /^(SAD \d+|Unknown)$/ },
  { geoType: "zip", label: "Zip Code", pattern: /^(\d{5}|Unknown)$/ },
] as const;

export type GeoType = (typeof GEO_TYPES)[number]["geoType"];

/** Full "Administrative Area" list order (used to compute click positions). */
const ADMIN_AREA_ITEMS = [
  "Department",
  "Supervisorial District",
  "Service Planning Area",
  "State Assembly District",
  "State Senate District",
  "Congressional District",
  "District Offices",
  "IHSS Offices",
  "City",
  "Zip Code",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Embed {
  page: Page;
  frame: Frame;
  browser: Browser;
  /** Capture every VizQL command/bootstrap response body since the last drain. */
  drainResponses(): string[];
  close(): Promise<void>;
}

/**
 * One browser process shared across embed sessions. Under Bun, a second
 * `chromium.launch()` in the same process hangs indefinitely (the first
 * launch/close pair works, any relaunch stalls), so sessions must isolate via
 * fresh browser *contexts* — which still give a clean cookie jar and thus a
 * fresh one-shot Tableau JWT per APEX page load — over fresh processes.
 */
let sharedBrowser: Browser | null = null;

async function getSharedBrowser(headless: boolean): Promise<Browser> {
  if (sharedBrowser?.isConnected()) return sharedBrowser;
  sharedBrowser = await chromium.launch({ headless });
  return sharedBrowser;
}

/** Shut down the shared browser process (call once, at CLI exit). */
export async function closeSharedBrowser(): Promise<void> {
  await sharedBrowser?.close().catch(() => {});
  sharedBrowser = null;
}

/** Start a fresh embed session (new context) and load the embed until interactive. */
export async function launchEmbed(opts: { headless?: boolean } = {}): Promise<Embed> {
  const browser = await getSharedBrowser(opts.headless ?? true);
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1400, height: 1200 },
  });
  const page = await context.newPage();

  let buffer: string[] = [];
  page.on("response", async (r) => {
    const u = r.url();
    if (!/\/commands\/|bootstrapSession/i.test(u)) return;
    try {
      const body = await r.body();
      if (body.length > 400) buffer.push(body.toString("utf8"));
    } catch {
      // Ignore bodies we cannot read.
    }
  });

  await page.goto(APEX_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("tableau-viz", { timeout: 60_000 });
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const viz = document.querySelector("tableau-viz") as unknown as {
          workbook?: { publishedSheetsInfo?: unknown[] };
          addEventListener(type: string, fn: () => void): void;
        };
        if (!viz) return reject(new Error("no tableau-viz element"));
        const timer = setTimeout(() => reject(new Error("firstinteractive timeout")), 90_000);
        viz.addEventListener("firstinteractive", () => {
          clearTimeout(timer);
          resolve();
        });
        try {
          if (viz.workbook?.publishedSheetsInfo?.length) {
            clearTimeout(timer);
            resolve();
          }
        } catch {
          /* not ready yet */
        }
      }),
  );
  await sleep(2500);

  const frame = page.frames().find((f) => f.url().includes("online.tableau.com"));
  if (!frame) throw new Error("Tableau iframe not found");

  return {
    page,
    frame,
    browser,
    drainResponses() {
      const out = buffer;
      buffer = [];
      return out;
    },
    async close() {
      await context.close();
    },
  };
}

/** Page-coordinate helper: convert a frame-relative point to a page point. */
async function framePoint(embed: Embed, fx: number, fy: number): Promise<{ x: number; y: number }> {
  const el = await embed.frame.frameElement();
  const box = await el.boundingBox();
  if (!box) throw new Error("iframe has no bounding box");
  return { x: box.x + fx, y: box.y + fy };
}

/** Rect of a left-rail viz zone whose painted text starts with `title`. */
async function zoneRect(
  frame: Frame,
  title: string,
): Promise<{ x: number; y: number; w: number; h: number }> {
  const rect = await frame.evaluate((title) => {
    let best: { x: number; y: number; w: number; h: number } | null = null;
    document.querySelectorAll("[class*='tabZone-viz']").forEach((z) => {
      const el = z as HTMLElement;
      const r = el.getBoundingClientRect();
      const text = el.innerText?.trim() ?? "";
      if (r.left < 320 && r.width > 100 && r.height > 100 && text.startsWith(title)) {
        if (!best || r.height > best.h) best = { x: r.left, y: r.top, w: r.width, h: r.height };
      }
    });
    return best;
  }, title);
  if (!rect) throw new Error(`viz zone not found: ${title}`);
  return rect;
}

/** List the Report Month values currently offered by the dropdown, latest first. */
export async function listReportMonths(embed: Embed): Promise<string[]> {
  const { frame } = embed;
  const combo = await frame.evaluate(() => {
    const el = document.querySelector(".tabComboBoxNameContainer") as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!combo) throw new Error("Report Month combobox not found");
  const pt = await framePoint(embed, combo.x, combo.y);
  await embed.page.mouse.click(pt.x, pt.y);
  await sleep(1200);

  const months = await frame.evaluate(() => {
    const seen = new Set<string>();
    document.querySelectorAll(".tabMenuItemName").forEach((el) => {
      const t = (el as HTMLElement).innerText?.trim();
      if (t && /^[A-Z][a-z]+ \d{4}$/.test(t)) seen.add(t);
    });
    return [...seen];
  });
  await embed.page.keyboard.press("Escape");
  await sleep(500);
  return months;
}

/** Move the pointer to a neutral spot and dismiss any open menu/tooltip. */
async function clearOverlays(embed: Embed): Promise<void> {
  await embed.page.keyboard.press("Escape");
  await embed.page.mouse.move(5, 5);
  await sleep(500);
}

/**
 * Select a Report Month by its dropdown label (e.g. "March 2026").
 * Bounded retries: embed tooltips/menus occasionally swallow a click.
 */
export async function selectReportMonth(embed: Embed, monthLabel: string, attempts = 3): Promise<void> {
  const { frame, page } = embed;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await clearOverlays(embed);
    const combo = await frame.evaluate(() => {
      const el = document.querySelector(".tabComboBoxNameContainer") as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (!combo) throw new Error("Report Month combobox not found");
    const comboPt = await framePoint(embed, combo.x, combo.y);
    await page.mouse.click(comboPt.x, comboPt.y);
    await sleep(1000 + attempt * 500);

    const item = await frame.evaluate((label) => {
      const el = [...document.querySelectorAll(".tabMenuItemName")].find(
        (e) => (e as HTMLElement).innerText?.trim() === label,
      ) as HTMLElement | undefined;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, monthLabel);
    if (item) {
      const itemPt = await framePoint(embed, item.x, item.y);
      await page.mouse.click(itemPt.x, itemPt.y);
      // Month changes re-render every zone; give the embed time to settle.
      await sleep(POLITE_DELAY_MS + 3000);
      embed.drainResponses();
      return;
    }
    await embed.page
      .screenshot({ path: `/tmp/dpss-month-fail-${attempt}.png` })
      .catch(() => {});
    await clearOverlays(embed);
    await sleep(attempt * 1000); // backoff before retrying
  }
  throw new Error(`Report Month not offered: ${monthLabel}`);
}

/**
 * Select a geography level in the Administrative Area list.
 * Returns the VizQL response bodies, which enumerate the geo type's sub-area domain.
 */
export async function selectGeoType(embed: Embed, label: string): Promise<string[]> {
  const idx = ADMIN_AREA_ITEMS.indexOf(label);
  if (idx < 0) throw new Error(`unknown Administrative Area label: ${label}`);
  await clearOverlays(embed);
  const rect = await zoneRect(embed.frame, "Administrative Area");
  // The title occupies the first painted row; the 10 items fill the remainder.
  const titleH = rect.h / (ADMIN_AREA_ITEMS.length + 1);
  const y = rect.y + titleH + (idx + 0.5) * ((rect.h - titleH) / ADMIN_AREA_ITEMS.length);
  const pt = await framePoint(embed, rect.x + 20, y);
  embed.drainResponses();
  await embed.page.mouse.click(pt.x, pt.y);
  // The geo-type selection triggers two responses: the Administrative Area
  // filter update, then (a beat later) the Sub Administrative Area list render
  // that carries this type's sub-area domain. Wait for both to settle.
  await sleep(4500);
  return embed.drainResponses();
}

/**
 * The ordered list of sub-area values for a geo type, read off the geo-type-select
 * response. Tableau ships every domain member as a `"<name>|Checked"` /
 * `"<name>|Unchecked"` token; the response also contains the cross-type list and
 * each type's default value, so we keep only tokens matching this type's naming
 * convention (`pattern`). Order follows first appearance (Tableau's list order).
 */
export function parseSubAreaDomain(responseText: string, pattern: RegExp): string[] {
  const seen = new Set<string>();
  for (const m of responseText.matchAll(/"([^"|]+)\|(?:Checked|Unchecked)"/g)) {
    const name = m[1];
    if (name && pattern.test(name)) seen.add(name);
  }
  return [...seen];
}

/** Geometry of the Sub Administrative Area list zone (frame coords). */
export async function subAreaZone(embed: Embed) {
  return zoneRect(embed.frame, "Sub Administrative Area");
}

/**
 * Which sub-area a select response reports as newly focused.
 *
 * The sub-area list loads with every member Checked (the unfiltered default).
 * Clicking a mark UNchecks it, and that focuses the view on that area — the
 * re-render carries the area's figures and its view title (e.g. "Service
 * Planning Area 3"), verified against committed captures. So the newly-focused
 * area is named by the response's single pattern-matching `"<name>|Unchecked"`
 * token (a previously-focused area may re-Check in the same delta; a lone
 * `Checked` token is a toggle back to the unfiltered default and names
 * nothing). Robust even when a click lands a row off from where we aimed.
 */
export function selectedSubArea(responseText: string, pattern: RegExp): string | null {
  const unchecked = new Set<string>();
  for (const m of responseText.matchAll(/"([^"|]+)\|(Checked|Unchecked)"/g)) {
    if (m[2] === "Unchecked" && pattern.test(m[1]!)) unchecked.add(m[1]!);
  }
  return unchecked.size === 1 ? [...unchecked][0]! : null;
}

/**
 * Click a point in the sub-area list and wait for the selection re-render.
 * Selecting a mark triggers a large `tabdoc/select` response (hundreds of KB);
 * we poll until one arrives (or `timeoutMs` elapses, meaning the click missed a
 * mark) rather than guessing a fixed delay. Returns the captured response text.
 */
async function clickSubAreaAt(embed: Embed, fx: number, fy: number, timeoutMs = 7000): Promise<string[]> {
  const pt = await framePoint(embed, fx, fy);
  embed.drainResponses();
  await embed.page.mouse.click(pt.x, pt.y);
  await sleep(POLITE_DELAY_MS);
  let collected: string[] = [];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    collected = collected.concat(embed.drainResponses());
    // A real selection re-render is large; small responses are incidental.
    if (collected.some((b) => b.length > 50_000)) {
      await sleep(300); // let any trailing frames settle
      collected = collected.concat(embed.drainResponses());
      break;
    }
    await sleep(300);
  }
  return collected;
}

export interface AreaCapture {
  geoId: string;
  /** The ordered VizQL response bodies captured for this area's selection. */
  responses: string[];
}

/**
 * Walk the Sub Administrative Area list top-to-bottom, capturing each distinct
 * area exactly once. The caller must have already selected the geo type. Rather
 * than trust pixel-perfect row math, we click down the list at ~one row pitch
 * and identify the area from the response (`selectedSubArea`), de-duplicating;
 * when the visible rows are exhausted we wheel-scroll and continue, stopping when
 * `expectedCount` areas are captured or progress stalls.
 *
 * `skip` lets an idempotent re-run avoid re-capturing areas already on disk while
 * still stepping through the list to reach the uncaptured ones.
 *
 * `isValid` guards against partial deltas that carry checkbox state but no
 * figures. Invalid captures are not marked as seen, so a later pass re-clicks
 * the row and recaptures the area.
 */
export async function* captureAllAreas(
  embed: Embed,
  pattern: RegExp,
  expectedCount: number,
  skip: (geoId: string) => boolean = () => false,
  isValid: (responses: string[]) => boolean = () => true,
): AsyncGenerator<AreaCapture> {
  const zone = await subAreaZone(embed);
  const seen = new Set<string>();
  const PITCH = 16; // frame px ≈ one list row
  const LIST_TOP = 30; // px below the zone's painted title
  let staleScrolls = 0;

  // Prime with the second row: the first click of a session sometimes lands
  // before the viz accepts input, and starting one row in gives the walk a
  // known-good response to calibrate on.
  {
    const primeBodies = await clickSubAreaAt(embed, zone.x + 18, zone.y + LIST_TOP + PITCH);
    const primeName = selectedSubArea(primeBodies.join("\n"), pattern);
    if (primeName && !seen.has(primeName)) {
      if (skip(primeName)) {
        seen.add(primeName);
      } else if (isValid(primeBodies)) {
        seen.add(primeName);
        yield { geoId: primeName, responses: primeBodies };
      }
    }
  }

  while (seen.size < expectedCount && staleScrolls < 3) {
    const before = seen.size;
    for (let dy = LIST_TOP; dy <= zone.h - 6 && seen.size < expectedCount; dy += PITCH) {
      const bodies = await clickSubAreaAt(embed, zone.x + 18, zone.y + dy);
      const name = selectedSubArea(bodies.join("\n"), pattern);
      if (!name || seen.has(name)) continue;
      if (skip(name)) {
        seen.add(name);
        continue;
      }
      // A delta can carry checkbox state without figures (e.g. a click on the
      // currently-focused row releasing focus). Leave the area unseen so a
      // later pass re-clicks it and captures real data.
      if (!isValid(bodies)) continue;
      seen.add(name);
      yield { geoId: name, responses: bodies };
    }
    if (seen.size < expectedCount) {
      const center = await framePoint(embed, zone.x + zone.w / 2, zone.y + zone.h / 2);
      await embed.page.mouse.move(center.x, center.y);
      await embed.page.mouse.wheel(0, zone.h - 40);
      await sleep(700);
      staleScrolls = seen.size === before ? staleScrolls + 1 : 0;
    }
  }
}
