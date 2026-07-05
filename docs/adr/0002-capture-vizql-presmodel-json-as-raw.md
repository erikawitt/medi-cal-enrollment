# Capture the VizQL presModel JSON as the raw scrape artifact

The phase-1 spike (see `docs/plans/phase-1-scraper.md` Decision log) established that the two
extraction paths the plan anticipated are both unavailable on the anonymous DPSS At-A-Glance
embed:

- **Crosstab export is blocked.** `displayDialogAsync('export-cross-tab')` and the native toolbar
  Download → Crosstab both raise a Tableau "Unexpected Error" and never produce a download — the
  anonymous embed lacks export permission (consistent with `getSummaryDataAsync` /
  `getParametersAsync` returning `PermissionDeniedException`).
- **The rendered values are not DOM text.** The Tableau viz paints numeric cells onto `<canvas>`;
  only the row/column *labels* exist as real DOM text. Scraping the visible HTML table (the
  fallback named in the plan) recovers the table's skeleton but none of its numbers.

## Decision

Capture the **VizQL presModel JSON** that the embed exchanges with Tableau Cloud as the raw
artifact. When the embed loads and when a geography is selected, Tableau returns a
`bootstrapSession` / `tabdoc/select` response containing:

- a **`dataDictionary`** — typed value pools (`cstring`, `integer`, `real`, `datetime`), where the
  real numbers (e.g. `3153672`) live exactly as served; and
- per-worksheet **`paneColumnsData`** — `vizDataColumns` (raw Tableau field captions like
  `PROGRAM_CODE`, `SUBCATEGORY`, `SUM(TNUM1)`) plus `vizPaneColumns` index tuples that map
  dictionary entries into rows.

We commit a **compact extract** of that presModel per area: the dictionary value pools plus each
data-bearing worksheet's raw captions and index tuples (~45 KB/area). We deliberately do **not**
commit the full multi-megabyte response, whose bulk is rendering geometry and image tiles with no
data value.

`{ext}` for raw captures is therefore **`.json`**.

## Why this is still a *raw* capture

The contract requires "minimally-touched bytes … no header renaming, no number de-formatting." The
committed extract preserves Tableau's own field captions verbatim, keeps the dictionary values as
served, and stores formatted display strings unchanged. It performs **no** metric naming, program
selection, or number parsing — the index-tuple → value reconstruction is a faithful, lossless
serialization of what Tableau sent, and all downstream meaning-making (mapping `SUM(TNUM1)` to a
metric, selecting Medi-Cal/CalFresh, parsing `"1,910,584"` to an integer) remains phase 3's job.

## Consequences

- The extractor depends on the shape of Tableau's presModel (`dataDictionary` + `paneColumnsData`).
  This is a stable, well-understood Tableau internal format, but it is an internal format — a major
  Tableau Cloud upgrade could change it. The spike scripts under `src/data-pipeline/spike/` document
  how the format was reverse-engineered so it can be re-derived if it drifts.
- Reconstruction is verified in the test suite against pinned May 2026 countywide reference values,
  so a format drift that breaks extraction fails loudly rather than silently producing garbage.
- Because geography is a single-value filter (per-area, gate D), each captured file is one
  `data/raw/{YYYY-MM}/{geo_type}/{geo_id}.json`.
