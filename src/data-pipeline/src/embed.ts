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
 * domain from the other cross-type tokens in the same response. `titlePrefix` +
 * `idPrefix` map the dashboard's re-rendered view title (e.g. "Congressional
 * District 23") to the sub-area value ("CD 23") — see `areaFromResponse`.
 */
export const GEO_TYPES = [
  { geoType: "spa", label: "Service Planning Area", pattern: /^(SPA \d+|Unknown)$/, titlePrefix: "Service Planning Area", idPrefix: "SPA " },
  { geoType: "congressional_district", label: "Congressional District", pattern: /^(CD \d+|Unknown)$/, titlePrefix: "Congressional District", idPrefix: "CD " },
  { geoType: "senate_district", label: "State Senate District", pattern: /^(SSD \d+|Unknown)$/, titlePrefix: "State Senate District", idPrefix: "SSD " },
  { geoType: "assembly_district", label: "State Assembly District", pattern: /^(SAD \d+|Unknown)$/, titlePrefix: "State Assembly District", idPrefix: "SAD " },
  { geoType: "zip", label: "Zip Code", pattern: /^(\d{5}|Unknown)$/, titlePrefix: "Zip Code", idPrefix: "" },
] as const;

export type GeoType = (typeof GEO_TYPES)[number]["geoType"];
export type GeoTypeSpec = (typeof GEO_TYPES)[number];

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
 *
 * Returns the VizQL response bodies, polled until they carry the geo type's
 * sub-area domain (the `"<name>|Checked"` token pool) — large types (zip: ~300
 * areas, multi-MB responses) stream in well after the click, so a fixed wait
 * misses them. The returned bodies also carry the type's DEFAULT area render:
 * the dashboard focuses the first list member (title + figures), which the
 * caller should capture directly — its row never needs clicking.
 */
export async function selectGeoType(
  embed: Embed,
  geo: Pick<GeoTypeSpec, "label" | "pattern">,
  timeoutMs = 25_000,
): Promise<string[]> {
  const idx = ADMIN_AREA_ITEMS.indexOf(geo.label);
  if (idx < 0) throw new Error(`unknown Administrative Area label: ${geo.label}`);
  await clearOverlays(embed);
  const rect = await zoneRect(embed.frame, "Administrative Area");
  // The title occupies the first painted row; the 10 items fill the remainder.
  const titleH = rect.h / (ADMIN_AREA_ITEMS.length + 1);
  const y = rect.y + titleH + (idx + 0.5) * ((rect.h - titleH) / ADMIN_AREA_ITEMS.length);
  const pt = await framePoint(embed, rect.x + 20, y);
  embed.drainResponses();
  await embed.page.mouse.click(pt.x, pt.y);
  await sleep(POLITE_DELAY_MS);

  // Poll until the sub-area token pool stabilizes: the pool streams in over
  // several responses, and an early response can carry just the default
  // area's own token — breaking on first sight would report a domain of 1.
  let collected: string[] = [];
  let lastSize = 0;
  let stablePolls = 0;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    collected = collected.concat(embed.drainResponses());
    const size = parseSubAreaDomain(collected.join("\n"), geo.pattern).length;
    if (size > 0 && size === lastSize) {
      if (++stablePolls >= 2) break;
    } else {
      stablePolls = 0;
    }
    lastSize = size;
    await sleep(1000);
  }
  return collected;
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
 * Which sub-area a response's re-rendered dashboard actually shows.
 *
 * The authoritative signal is the dashboard's view TITLE — the response of a
 * real area re-render carries exactly one `"<titlePrefix> <id>"` cstring (e.g.
 * "Congressional District 23" → "CD 23"), which names the area whose figures
 * the response holds. Checkbox `"<name>|Checked/Unchecked"` tokens are NOT
 * reliable: the list often re-renders without shipping its token pool (spikes
 * 35/36 saw title-and-figures responses with zero tokens), which stranded
 * first-row areas like CD 23. Returns null when zero or multiple titles of the
 * type appear (no re-render, or a cross-area layout dump).
 */
export function areaFromResponse(
  responseText: string,
  geo: Pick<GeoTypeSpec, "titlePrefix" | "idPrefix" | "pattern">,
): string | null {
  const ids = new Set<string>();
  const re = new RegExp(`"${geo.titlePrefix} ([A-Za-z0-9]+)\\s*"`, "g");
  for (const m of responseText.matchAll(re)) {
    const id = m[1] === "Unknown" ? "Unknown" : `${geo.idPrefix}${m[1]}`;
    if (geo.pattern.test(id)) ids.add(id);
  }
  return ids.size === 1 ? [...ids][0]! : null;
}

/**
 * Click a point in the sub-area list and wait for the selection re-render.
 * Selecting a mark triggers a large `tabdoc/select` response (hundreds of KB);
 * we poll until one arrives (or `timeoutMs` elapses, meaning the click missed a
 * mark) rather than guessing a fixed delay. Returns the captured response text.
 */
async function clickSubAreaAt(embed: Embed, fx: number, fy: number, timeoutMs = 4500): Promise<string[]> {
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
 * area exactly once. The caller must have already selected the geo type — and
 * should capture the type's DEFAULT area (first list member) from the
 * geo-type-select response itself; this walk covers the rest by clicking.
 *
 * Rather than trust pixel-perfect row math, we click down the list at ~one row
 * pitch and identify each area from its response's re-rendered view title
 * (`areaFromResponse`), de-duplicating; when the visible rows are exhausted we
 * wheel-scroll and continue. Passes restart from the top of the list until
 * `alreadyDone` + captures cover `expectedCount` areas or progress stalls.
 *
 * Two phases:
 *  1. **Linear sweep** — click down the list at ~half-row pitch, scrolling
 *     viewport by viewport. Makes no assumption about list order; captures the
 *     bulk of the domain but can miss scattered rows (click landed on a row
 *     boundary, or on the currently-focused row, which releases focus).
 *  2. **Targeted recovery** — for each still-missing area, aim a click at its
 *     predicted row using its index in `domainOrdered` (the token order of the
 *     geo-type-select response, which matches the rendered list order). Every
 *     hit names the row we actually reached, which recalibrates the scroll
 *     offset and row height, so aim errors self-correct within a few clicks.
 *
 * `doneNames` seeds the walk with areas already captured on disk — they count
 * as seen without needing a click, so a resumed run stops as soon as the
 * missing areas are found. `isValid` guards against re-renders that carry a
 * title but no figures — those stay unseen and get re-clicked later.
 */
export async function* captureAllAreas(
  embed: Embed,
  geo: Pick<GeoTypeSpec, "titlePrefix" | "idPrefix" | "pattern">,
  domainOrdered: string[],
  expectedCount: number,
  doneNames: Iterable<string> = [],
  isValid: (responses: string[]) => boolean = () => true,
): AsyncGenerator<AreaCapture> {
  const zone = await subAreaZone(embed);
  const seen = new Set<string>(doneNames);
  const PITCH = 16; // frame px ≈ half a list row
  const LIST_TOP = 30; // px below the zone's painted title
  const viewport = zone.h - LIST_TOP;

  const wheelInList = async (dy: number) => {
    const center = await framePoint(embed, zone.x + zone.w / 2, zone.y + zone.h / 2);
    await embed.page.mouse.move(center.x, center.y);
    await embed.page.mouse.wheel(0, dy);
    await sleep(700);
  };
  const clickAndName = async (fy: number) => {
    const bodies = await clickSubAreaAt(embed, zone.x + 18, fy);
    return { bodies, name: areaFromResponse(bodies.join("\n"), geo) };
  };

  // Phase 1: linear sweep (no list-order assumption).
  const maxScrolls = Math.ceil((expectedCount * 2 * PITCH) / viewport) + 2;
  for (let s = 0; s <= maxScrolls && seen.size < expectedCount; s++) {
    for (let dy = LIST_TOP; dy <= zone.h - 6 && seen.size < expectedCount; dy += PITCH) {
      const { bodies, name } = await clickAndName(zone.y + dy);
      if (!name || seen.has(name) || !isValid(bodies)) continue;
      seen.add(name);
      yield { geoId: name, responses: bodies };
    }
    if (seen.size >= expectedCount) return;
    await wheelInList(viewport - PITCH);
  }

  // Phase 2: targeted recovery, assuming list order == domainOrdered.
  const indexOf = new Map(domainOrdered.map((n, i) => [n, i]));
  await wheelInList(-(domainOrdered.length + 10) * 40); // clamp to the top
  let scroll = 0; // estimated px of list hidden above the viewport
  let rowH = 30; // estimated row height; recalibrated from hit pairs below
  let lastHit: { index: number; fy: number; scroll: number } | null = null;

  for (let round = 0; round < 3 && seen.size < expectedCount; round++) {
    const before = seen.size;
    for (const target of domainOrdered) {
      if (seen.size >= expectedCount) break;
      if (seen.has(target)) continue;
      const ti = indexOf.get(target)!;
      for (let tries = 0; tries < 5; tries++) {
        // Predicted center of the target row, in zone coordinates.
        const yInZone = LIST_TOP + ti * rowH + rowH / 2 - scroll;
        if (yInZone < LIST_TOP + 2 || yInZone > zone.h - 6) {
          const delta = yInZone - (LIST_TOP + viewport / 2);
          await wheelInList(delta);
          scroll = Math.max(0, scroll + delta);
          lastHit = null; // scroll moved; old anchor no longer comparable
          continue;
        }
        const { bodies, name } = await clickAndName(zone.y + yInZone);
        if (!name) continue; // focus release or dead click — try again
        const hi = indexOf.get(name);
        if (hi !== undefined) {
          // Recalibrate from what we actually hit.
          if (lastHit && lastHit.scroll === scroll && hi !== lastHit.index) {
            const est = (yInZone - lastHit.fy) / (hi - lastHit.index);
            if (est > 10 && est < 60) rowH = est;
          }
          lastHit = { index: hi, fy: yInZone, scroll };
          scroll = LIST_TOP + hi * rowH + rowH / 2 - yInZone;
        }
        if (!seen.has(name) && isValid(bodies)) {
          seen.add(name);
          yield { geoId: name, responses: bodies };
        }
        if (name === target) break;
      }
    }
    if (seen.size === before) break; // no progress; stop rather than loop
  }
}
