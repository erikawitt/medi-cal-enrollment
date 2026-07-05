---
name: "Phase 1: DPSS Tableau scraper (spike + generalize + backfill)"
overview: Build a Playwright scraper that extracts Medi-Cal/CalFresh enrollment tables from the DPSS At-A-Glance Tableau embed for every available report month at zip, SPA, and congressional-district granularity, committing raw captures under data/raw/. Starts with an empirical spike whose findings gate the full build.
todos:
  - id: setup
    content: "Scaffold src/data-pipeline/ workspace package (Bun + TypeScript + Playwright)"
    status: completed
  - id: spike
    content: "Spike: resolve decision gates A-D against one month x one SPA"
    status: completed
  - id: record-gates
    content: Record decision-gate answers in this file's Decision log
    status: completed
  - id: generalize
    content: Generalize scraper across geo types and report months, idempotent per (month, geo_type)
    status: completed
  - id: backfill
    content: Backfill all currently-published report months from January 2026 onward
    status: in_progress
  - id: manifest
    content: Write capture manifest per month recording extraction method and timestamps
    status: completed
---

# Phase 1: DPSS Tableau scraper

> **Read `CONTEXT.md` at the repo root first** and use its language (report month, raw capture, geography level, etc.) in all code, file names, and docs you produce.

## Goal

When this phase is done: `src/data-pipeline/` contains a Playwright-based scraper runnable via `bun run scrape`, and `data/raw/` contains committed raw captures for **every report month currently published by DPSS from January 2026 onward**, at each of five geography levels (zip, SPA, congressional district, state senate district, state assembly district). The scraper is idempotent — re-running it skips months already captured — and this plan file's Decision log records what the spike learned.

## Context (self-contained — do not assume access to any other document)

### The source

`https://myappse.dpss.lacounty.gov/pls/apexprod/f?p=AAGT:AAGT` is an Oracle APEX page whose only real function is to mint a short-lived Tableau Connected App JWT server-side (hidden field `P2_TOKEN`, scoped `tableau:views:embed`) and embed a Tableau Cloud workbook via the `<tableau-viz>` web component. No login is required — it is a public/anonymous embed.

- Tableau Cloud pod: `https://us-west-2b.online.tableau.com`
- Site: `dpssstatisticalreports`
- Workbook/view: `DPSSAt-A-Glance-External` / `AtAGlance`
- The JWT is minted fresh per APEX page load. **Load the APEX URL fresh each run; do not cache/reuse tokens.**

The workbook has three dashboards (confirmed via `tableauViz.workbook.publishedSheetsInfo`): `AtAGlance` (landing), `Table View` (**the scrape target — a flat data table**), and `Summary`.

Verified behaviors from prior research (an unauthenticated browser session):

- `await tableauVizEl.workbook.activateSheetAsync('Table View')` **works** — sheet switching via the public Tableau Embedding API v3 is permitted.
- `worksheet.getSummaryDataAsync(...)` and `workbook.getParametersAsync()` **throw `PermissionDeniedException` (HTTP 403)** — there is no clean "rows as JSON" call for anonymous viewers.
- `await tableauVizEl.displayDialogAsync('export-cross-tab')` **opens the export dialog successfully** — but whether the download completes end-to-end is unverified (decision gate B below).
- The `Table View` dashboard's worksheet is internally named `Export Data` (its sheet list is `["Export Data", "Footnote"]`), filtered by `Pass Date`, `DNAME Filter`, `Dashboard Name Filter`, `Select Month Filter Parameter`.

Manual reproduction: open the APEX URL, then in devtools console run `document.querySelector('tableau-viz')`, then the `activateSheetAsync` call above. The left sidebar shows an "Administrative Area" filter tree (Department, Supervisorial District, **Service Planning Area**, State Assembly District, State Senate District, **Congressional District**, District Offices, IHSS Offices, City, **Zip Code**) and a "Report Month" dropdown top-left (latest observed value: "May 2026", i.e. ~1 month publish lag).

### The table's shape

Rows are metric categories, columns are programs (CalWORKs, CalFresh, **Medi-Cal**, General Relief, CAPI, Refugee, IHSS, Unduplicated). Row groups:

- **Caseload Characteristics & Persons**: Cases, Persons, Persons 24 months back, Average Benefit Amount($) Per Case
- **Payments**: avg benefit / expenditures for last 12 months
- **Citizenship Status of Persons**: Citizen, Documented Individual, Undocumented Individual, Other
- **Application Processing**: Received Monthly
- **Ethnic Origin of Persons**: American Indian/Alaska Native, Asian/Asian American, Black/African/African American, Hispanic/Latino(a)/Chicano(a), Native Hawaiian/Pacific Islander, White/European/European American, Two or More Races/Ethnicities, Other
- **Age of Persons**: Under 1, 1-2, 3-5, 6-12, 13-15, 16-17, plus adult buckets (not fully captured in research — verify the full list during the spike)

Reference values for sanity-checking your extraction (Medi-Cal column, report month May 2026, Department/countywide level): Cases 1,910,584; Persons 3,153,672; Citizen 2,267,316; Documented 368,320; Undocumented 498,283; Other 19,753; Under 1 = 35,222; 1-2 = 72,285; 3-5 = 120,036.

These are **marginal distributions, not cross-tabs** — "undocumented 0-5-year-olds in zip X" does not exist in this source. Capture what is published; do not attempt to construct joints.

### Why scraping (and why it must be polite)

See `docs/adr/0001-scrape-dpss-tableau-embed-as-primary-source.md`. Key operational consequences: report months age out of the dropdown on an unknown schedule, so **backfill everything currently available in your first real run**; and this is a government site — add delays between interactions, use a descriptive User-Agent, never run continuously, and skip already-captured months.

## Contract

**Consumes**: nothing from this repo (first producer). The repo layout convention: pipeline code in `src/data-pipeline/`, Bun workspaces rooted at `"workspaces": ["src/*"]` (create the root `package.json` if absent).

**Produces**:

```
data/raw/{YYYY-MM}/{geo_type}/{geo_id}.{ext}     # one file per geography value, OR
data/raw/{YYYY-MM}/{geo_type}.{ext}              # one bulk file, if bulk export proves possible (gate C)
data/raw/{YYYY-MM}/manifest.json                 # capture timestamp, extraction method, geo counts, scraper version
```

- `{YYYY-MM}` is the **report month** (the dashboard's "Report Month" value), not the scrape date.
- `geo_type` ∈ `zip` | `spa` | `congressional_district` | `senate_district` | `assembly_district`. (A sixth level, `community`, exists downstream but is derived by later phases — it is never scraped; DPSS has no community/neighborhood concept.)
- `{ext}` is whatever the winning extraction path yields (`.csv` from crosstab export, or `.json`/`.html` from DOM scraping) — raw captures are minimally-touched bytes, not normalized. Choose one and record it in the Decision log; downstream (phase 3) reads only these files, so the manifest must say which format/method each month used.
- Keep raw faithful: no header renaming, no number de-formatting (`1,910,584` stays as served).

## Decision gates — resolve empirically during the spike, record answers below

- **Gate A — filter control**: Can the "Administrative Area" geography selection and "Report Month" be set via the Tableau Embedding JS API (filter/parameter calls were *not* confirmed blocked — only data-read calls were), or does everything require simulated DOM clicks inside the iframe?
- **Gate B — export path**: Does the crosstab export complete end-to-end (dialog → worksheet selection → download event capturable by Playwright → parseable file), or does it hit a permission wall past the dialog? If it fails, fall back to scraping the rendered HTML table (values are confirmed visible as plain text; handle scrolling/pagination).
- **Gate C — bulk vs per-area**: Can one export include geography as a table column (all zips at once), or must the scraper filter to one geography value per export? This decides between ~5 exports/month and ~450+ exports/month (zip level is roughly 300-500 areas; the legislative levels add little — LA County intersects only on the order of 15 state senate and 25 assembly districts. A per-area loop is an estimated 30-90+ minutes/month — acceptable if unavoidable, but check bulk first).
- **Gate D — filter semantics**: When a single geography value is selected, does the table show only that area's rows, or does geography become a column across all rows? (Determines per-area vs per-month file granularity in `data/raw/`.)

### Decision log (filled in during the spike)

Spike ran against report month **May 2026** at the Department (countywide) and Service
Planning Area levels, using headless Chromium via Playwright against the live APEX page.
Full spike scripts are preserved under `src/data-pipeline/spike/` for auditability.

- **Gate A — filter control: DOM/embed interaction, NOT the Embedding JS API.**
  The Embedding API v3 exposes sheet switching (`activateSheetAsync('Table View')` works) but
  parameter/filter *writes* are effectively unavailable to anonymous viewers:
  `getParametersAsync()` → `PermissionDeniedException` (403), and
  `changeParameterValueAsync('Select Month Filter Parameter', …)` → `invalid-parameter`
  (the parameter is not resolvable through the public API). Geography is instead a pair of
  **filter-action worksheets** inside the embed — "Administrative Area" (the geo *type*) and
  "Sub Administrative Area" (the specific value). Selecting an item is a mark selection that
  fires a VizQL `tabdoc/select` command (observed payload:
  `worksheet="Administrative Area Filter"`, `selection={"objectIds":[N],"selectionType":"tuples"}`).
  "Report Month" is a Tableau parameter-control dropdown (top-left) driven the same way — via
  in-embed interaction, not the JS API. **Conclusion: drive selection by interacting with the
  embed (clicking the rendered list marks); the JS API is used only for `activateSheetAsync`.**

- **Gate B — export path: crosstab export FAILS; captured VizQL presModel JSON is the fallback.**
  Both `tableauViz.displayDialogAsync('export-cross-tab')` and the native toolbar
  Download → Crosstab surface a Tableau **"Unexpected Error"** inside the viz iframe and never
  emit a download event (Playwright `waitForEvent('download')` times out). This matches the ADR
  note that data-access paths are permission-gated for the anonymous embed. The plan's suggested
  DOM-text fallback also does **not** apply as written: the table's numeric values are
  **canvas-painted, not DOM text** (a scan for formatted numbers like `1,910,584` in the DOM
  returns zero hits; only row/column *labels* are real DOM text). **Working extraction path
  (chosen): capture the VizQL `bootstrapSession` / `tabdoc/select` response JSON, which contains
  a `dataDictionary` (typed value pools) plus per-worksheet `paneColumnsData` (index tuples) that
  reconstruct every published value.** We commit a compact, faithful extract of that presModel
  (dictionary values + raw Tableau field captions + index tuples, ~45 KB/area, formatted value
  strings preserved verbatim). Raw **`{ext}` = `.json`**. See ADR 0002 for the format decision.

- **Gate C — bulk vs per-area: PER-AREA.** There is no mode that emits all zips at once. The embed
  shows exactly one selected geography value at a time (pick a type in "Administrative Area", then
  one value in "Sub Administrative Area"); the view re-renders for that single area. So capture is
  one export per (report month × geo value): SPA = 8, plus the legislative/congressional levels
  (tens each), plus zip (hundreds). Zip-level backfill is the long pole (tens of minutes/month).

- **Gate D — filter semantics: SINGLE-VALUE filter; geography is NOT a column.** Selecting one
  sub-area (e.g. "SPA 1") re-renders the whole dashboard/table for that area only (confirmed:
  SPA 1 Medi-Cal Persons = 167,866 vs. countywide 3,153,672); geography never appears as a table
  column. **Therefore per-area files: `data/raw/{YYYY-MM}/{geo_type}/{geo_id}.json`.**

**Validation:** the captured May 2026 countywide (Department) presModel reconstructs to the exact
reference values — Medi-Cal Cases 1,910,584; Persons 3,153,672; Citizen 2,267,316; Documented
368,320; Undocumented 498,283; Other 19,753; Under 1 = 35,222; 1-2 = 72,285; 3-5 = 120,036.
These are pinned as fixtures in the test suite.

**Dropdown depth (observed 2026-07-05):** the Report Month dropdown currently offers **80 months,
August 2019 through May 2026** — far deeper than feared when the "months age out on an unknown
schedule" risk was written down. The aging-out risk is therefore low on a months timescale, but
backfill still runs **oldest-first** within scope as cheap insurance. Scope stays ≥ 2026-01 per
this plan's Goal; pre-2026 months exist upstream if the project ever wants them.

**Capture validity (found during the 2026-05 partial):** clicking an already-selected sub-area
mark **toggles it off** — the VizQL delta carries only the `"<name>|Unchecked"` checkbox token and
no figures. Three of the first 32 committed area files (CD 23, SSD 25, SSD 34) were such
toggle-only captures. The scraper now gates every capture on `captureHasData` (a non-trivial
`real` value pool present, threshold 10 — a normal area re-render ships ~190 real values, the
sparse "Unknown" area ~26, a toggle ~0), leaves invalid clicks unseen so a later pass re-selects
and recaptures them, and treats only valid-on-disk files as already captured. `extractRawCapture`
also now keeps **every** `dataSegments` occurrence in a multi-delta response (`deepFindAll`)
instead of the first, so no served figures are dropped.

**Watch item (from Out of scope):** no native DPSS disenrollment dashboard has appeared; the
At-A-Glance embed remains the only source. No change to the ADR is warranted at this time.

## Acceptance criteria

- `bun run scrape` (in `src/data-pipeline/`) captures all available report months ≥ 2026-01 for all five geography levels into `data/raw/`, then exits 0.
- Re-running immediately afterward performs no new captures (idempotency by month+geo_type) and exits 0.
- Countywide Medi-Cal values extracted for May 2026 match the reference values listed in Context above (if May 2026 is still published).
- Every `data/raw/{month}/` directory contains a `manifest.json` recording extraction method, capture timestamp, and per-geo-type file counts.
- All four decision gates have recorded answers in this file.
- Politeness: ≥ 1s delay between Tableau interactions, descriptive User-Agent set, no retry storms (bounded retries with backoff).

## Out of scope

- **No normalization** — no header mapping, metric naming, or number parsing beyond what extraction itself requires (phase 3 owns tidy data).
- **No crosswalk or boundary work** (phase 2).
- **No GitHub Action / cron wiring** (phase 4) — this phase produces a locally-runnable CLI only.
- **No CalWORKs/GR/CAPI/etc. filtering** — raw keeps whatever the export yields, even non-target programs; downstream phases select Medi-Cal and CalFresh.
- If DPSS has shipped a native disenrollment dashboard since research (watch item from an ~April 2026 Board of Supervisors motion), note it in the Decision log and stop for human input rather than scraping a moving target.
