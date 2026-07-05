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

/** Launch a headless browser and load the embed until it is interactive. */
export async function launchEmbed(opts: { headless?: boolean } = {}): Promise<Embed> {
  const browser = await chromium.launch({ headless: opts.headless ?? true });
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
      await browser.close();
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

/** Select a Report Month by its dropdown label (e.g. "March 2026"). */
export async function selectReportMonth(embed: Embed, monthLabel: string): Promise<void> {
  const { frame, page } = embed;
  const combo = await frame.evaluate(() => {
    const el = document.querySelector(".tabComboBoxNameContainer") as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!combo) throw new Error("Report Month combobox not found");
  const comboPt = await framePoint(embed, combo.x, combo.y);
  await page.mouse.click(comboPt.x, comboPt.y);
  await sleep(1000);

  const item = await frame.evaluate((label) => {
    const el = [...document.querySelectorAll(".tabMenuItemName")].find(
      (e) => (e as HTMLElement).innerText?.trim() === label,
    ) as HTMLElement | undefined;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, monthLabel);
  if (!item) {
    await page.keyboard.press("Escape");
    throw new Error(`Report Month not offered: ${monthLabel}`);
  }
  const itemPt = await framePoint(embed, item.x, item.y);
  await page.mouse.click(itemPt.x, itemPt.y);
  await sleep(POLITE_DELAY_MS);
  embed.drainResponses();
}

/**
 * Select a geography level in the Administrative Area list.
 * Returns the VizQL response bodies, which enumerate the geo type's sub-area domain.
 */
export async function selectGeoType(embed: Embed, label: string): Promise<string[]> {
  const idx = ADMIN_AREA_ITEMS.indexOf(label);
  if (idx < 0) throw new Error(`unknown Administrative Area label: ${label}`);
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
 * Which sub-area a select response reports as newly selected.
 *
 * Selecting a mark toggles exactly that area's checkbox, so the delta response
 * carries a single `"<name>|Checked"`/`"<name>|Unchecked"` token whose name
 * matches the geo type's convention. That token names the area we just captured
 * — robust even when a click lands a row off from where we aimed.
 */
export function selectedSubArea(responseText: string, pattern: RegExp): string | null {
  const hits = new Set<string>();
  for (const m of responseText.matchAll(/"([^"|]+)\|(?:Checked|Unchecked)"/g)) {
    if (pattern.test(m[1]!)) hits.add(m[1]!);
  }
  return hits.size === 1 ? [...hits][0]! : null;
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
 */
export async function* captureAllAreas(
  embed: Embed,
  pattern: RegExp,
  expectedCount: number,
  skip: (geoId: string) => boolean = () => false,
): AsyncGenerator<AreaCapture> {
  const zone = await subAreaZone(embed);
  const seen = new Set<string>();
  const PITCH = 16; // frame px ≈ one list row
  const LIST_TOP = 30; // px below the zone's painted title
  let staleScrolls = 0;

  // The list loads with its first area already selected; clicking an already-
  // selected mark yields no re-render, so that area would be missed. Prime by
  // selecting the second row first, capturing it, so every row (incl. the first)
  // is subsequently clickable.
  {
    const primeBodies = await clickSubAreaAt(embed, zone.x + 18, zone.y + LIST_TOP + PITCH);
    const primeName = selectedSubArea(primeBodies.join("\n"), pattern);
    if (primeName && !seen.has(primeName)) {
      seen.add(primeName);
      if (!skip(primeName)) yield { geoId: primeName, responses: primeBodies };
    }
  }

  while (seen.size < expectedCount && staleScrolls < 3) {
    const before = seen.size;
    for (let dy = LIST_TOP; dy <= zone.h - 6 && seen.size < expectedCount; dy += PITCH) {
      const bodies = await clickSubAreaAt(embed, zone.x + 18, zone.y + dy);
      const name = selectedSubArea(bodies.join("\n"), pattern);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      if (!skip(name)) yield { geoId: name, responses: bodies };
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
