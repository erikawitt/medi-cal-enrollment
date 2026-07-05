---
name: "Phase 1: DPSS Tableau scraper (spike + generalize + backfill)"
overview: Build a Playwright scraper that extracts Medi-Cal/CalFresh enrollment tables from the DPSS At-A-Glance Tableau embed for every available report month at zip, SPA, and congressional-district granularity, committing raw captures under data/raw/. Starts with an empirical spike whose findings gate the full build.
todos:
  - id: setup
    content: "Scaffold src/data-pipeline/ workspace package (Bun + TypeScript + Playwright)"
    status: pending
  - id: spike
    content: "Spike: resolve decision gates A-D against one month x one SPA"
    status: pending
  - id: record-gates
    content: Record decision-gate answers in this file's Decision log
    status: pending
  - id: generalize
    content: Generalize scraper across geo types and report months, idempotent per (month, geo_type)
    status: pending
  - id: backfill
    content: Backfill all currently-published report months from January 2026 onward
    status: pending
  - id: manifest
    content: Write capture manifest per month recording extraction method and timestamps
    status: pending
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

### Decision log (fill in during the spike — this section is part of the deliverable)

- Gate A: _unresolved_
- Gate B: _unresolved_
- Gate C: _unresolved_
- Gate D: _unresolved_

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
