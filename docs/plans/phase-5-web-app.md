---
name: "Phase 5: Interactive map web app"
overview: Build the Bun + Vite + React + MapLibre static web app — six toggleable choropleth layers (zip, SPA, congressional district, state senate district, state assembly district, community), a report-month time slider, enrollment and disenrollment-trend views, and a detail panel with demographic marginals — deployed to GitHub Pages on merge to main.
todos:
  - id: scaffold
    content: Scaffold src/web/ workspace package (Vite + React, Bun runtime, imports src/shared types)
    status: pending
  - id: boundaries
    content: Fetch and commit SPA, congressional-, senate-, and assembly-district boundary GeoJSONs to data/boundaries/
    status: pending
  - id: map
    content: "MapLibre map: OpenFreeMap basemap (pinned style), six boundary layers with layer switcher"
    status: pending
  - id: choropleth
    content: "Choropleth views: age 0-5 enrollment and MoM change (disenrollment trend), with legend"
    status: pending
  - id: slider
    content: Report-month time slider driven by the months array in the derived files
    status: pending
  - id: panel
    content: Detail panel with ethnicity/citizenship marginals and required data-limitation notes
    status: pending
  - id: deploy
    content: GitHub Pages deploy workflow on merge to main; data copied into build output
    status: pending
---

# Phase 5: Interactive map web app

> **Read `CONTEXT.md` at the repo root first** and use its language everywhere, including UI copy: **community** (never "neighborhood"), **disenrollment trend** (a derived month-over-month decline, never a count of a published flow), **marginal breakdown** (never presented as a cross-tab).

## Goal

When this phase is done: a static React app in `src/web/` renders an LA County map with six toggleable choropleth layers, a time slider across available report months, two metric views (age 0-5 enrollment level, and month-over-month change — the disenrollment-trend view), and a per-geography detail panel; it deploys to GitHub Pages automatically on merge to `main` and loads near-instantly from committed static files, with no runtime backend and no API keys.

## Context (self-contained)

### What this app is for

End users (journalists, advocates, county staff) want to see where and how fast children aged 0-5 are losing Medi-Cal coverage in LA County, month by month from January 2026, and what demographic groups are most affected. The data pipeline (phases 1-4) has already mirrored DPSS data into committed JSON; this app **only reads static files** — it never queries DPSS, Tableau, or any live API.

### Decided stack and hosting (do not relitigate)

- **Bun** as runtime/package manager, **Vite** as bundler, **React**, **MapLibre GL JS** (no API key, no vendor lock-in). Workspace package at `src/web/` (root `package.json` has `"workspaces": ["src/*"]`).
- **Basemap: OpenFreeMap** (`https://tiles.openfreemap.org`) — free vector tiles, no key, no usage caps. Use a light/muted style so choropleths dominate visually, and **pin the style JSON in the repo** (commit a copy rather than hot-linking the style, so upstream style changes can't silently restyle the app; tile requests still go to OpenFreeMap).
- **Hosting: GitHub Pages**, deployed by a workflow on push to `main`. Merging a data PR (phase 4) therefore automatically redeploys the site with fresh data — that coupling is intentional. Mind the base-path: Pages serves project sites under `/<repo-name>/`, so set Vite's `base` accordingly.

### Data files you consume (produced by phases 2-3; schemas in `src/shared/`)

- `data/derived/map/{zip|spa|congressional_district|senate_district|assembly_district|community}.json` — Medi-Cal-only, all months, keyed by `geo_id` then month; per cell: `age_0_5`, `persons_total`, `age_0_5_mom_delta`, `age_0_5_mom_pct`, `persons_mom_delta`, `persons_mom_pct`, `ethnicity{...}`, `citizenship{...}`. Top-level `months` array drives the slider. Deltas are null for the earliest month.
- `data/boundaries/zips.geojson` and `data/boundaries/communities.geojson` — already committed by phase 2 (**precondition — verify they exist; do not refetch**). Community features carry la-geography properties: `name`, `slug` (= the `geo_id` used in derived files), `type` (`segment-of-a-city` | `standalone-city` | `unincorporated-area`), `region`.
- Import data-file types from the `src/shared/` workspace package (created in phase 3). Do not redeclare them.

At build time, copy `data/derived/map/` and `data/boundaries/` into the Vite output (a small build script or `vite-plugin-static-copy`); the app fetches them as same-origin static assets.

### Boundary layers this phase must fetch and commit (your task, not a precondition)

- **SPA (Service Planning Areas)**: LA County eGIS — `https://public.gis.lacounty.gov/public/rest/services/LACounty_Dynamic/Administrative_Boundaries/FeatureServer/23/query?where=1=1&outFields=*&f=geojson` (fields include `SPA`, `SPA_NAME`, `SPA_NUM`). Commit as `data/boundaries/spas.geojson`. Map features to `geo_id`s `spa-1`…`spa-8`.
- **Congressional districts**: Census Bureau cartographic boundary files (`cb_*_us_cd118` or the current congress), filtered to California and clipped/filtered to districts intersecting LA County; or an LA County eGIS CD layer if one exists in the same REST catalog. Commit as `data/boundaries/congressional_districts.geojson`. Map to `geo_id`s like `ca-27` (lowercase), matching the derived files.
- **State senate districts**: Census cartographic boundary files for state legislative districts, upper chamber (`cb_*_06_sldu_500k`), filtered to districts intersecting LA County; or an LA County eGIS layer if available. Commit as `data/boundaries/senate_districts.geojson`. Map to `geo_id`s like `sd-18`.
- **State assembly districts**: same as above, lower chamber (`cb_*_06_sldl_500k`). Commit as `data/boundaries/assembly_districts.geojson`. Map to `geo_id`s like `ad-51`.
- Record source URLs + retrieval dates in a `data/boundaries/README.md` (append; phase 2 may have started it).
- All committed GeoJSON stays WGS84 (EPSG:4326). If any boundary file is large (>2-3 MB), simplify geometry (e.g. `mapshaper -simplify`) — record the tolerance used.

### Required UI copy (data-honesty notes — not optional)

1. **Communities definition**: wherever the community layer is introduced (layer switcher tooltip/about panel), define "Communities" and **cite the la-geography source with a link to `https://github.com/stiles/la-geography`** (e.g. "Community boundaries from the la-geography project, a countywide extension of the LA Times Mapping LA neighborhoods"). Per-feature, show its `type` honestly in the detail panel ("Long Beach — standalone city").
2. **Community figures are estimates**: apportioned from zip-level data by area-weighted overlap, assuming uniform population density within a zip; totals won't exactly reconcile with zip/countywide counts. Show a brief note wherever community numbers appear.
3. **Marginals, not cross-tabs**: the ethnicity and citizenship breakdowns describe a geography's *entire* Medi-Cal population, not the 0-5 subpopulation. The detail panel must say so explicitly.
4. **Mixed-status family data is not available** from any public source (requires a confidential DPSS research request); note this in the about/methodology section.
5. **Disenrollment trend is derived**: DPSS publishes enrollment stock, not disenrollment flow; the change view shows month-over-month differences computed by this project.

## Contract

**Consumes**: `data/derived/map/*.json`, `data/boundaries/zips.geojson`, `data/boundaries/communities.geojson`, types from `src/shared/`.

**Produces**:

```
src/web/                                       # Vite + React + MapLibre app
data/boundaries/spas.geojson                   # fetched + committed by this phase
data/boundaries/congressional_districts.geojson
data/boundaries/senate_districts.geojson
data/boundaries/assembly_districts.geojson
.github/workflows/deploy-site.yml              # Pages deploy on push to main
```

### Feature spec

- **Layer switcher**: exactly one of Communities / Zip codes / SPAs / Congressional districts / State Senate districts / State Assembly districts active at a time; Communities is the default layer.
- **Metric toggle**: "Enrollment (ages 0-5)" (choropleth of `age_0_5`) and "Change from prior month" (choropleth of `age_0_5_mom_pct`, diverging scale centered at 0, decline in the alarming hue). Sensible scale breaks (quantiles or explicit) and a legend.
- **Time slider**: across the `months` array of the loaded layer file; defaults to the latest month. In change view, the earliest month shows an empty-state explanation (deltas are null).
- **Hover**: tooltip with geography name and current metric value.
- **Click → detail panel**: name (+ community `type` and `region` where applicable), `age_0_5` and `persons_total` for the selected month, a small MoM trend line or bar strip across all months, ethnicity and citizenship marginal breakdowns (bar lists), plus the required honesty notes (items 2-3 above).
- **About/methodology section**: data source (DPSS At-A-Glance), update cadence, the la-geography citation, and honesty notes 1-5.
- **Performance**: lazy-load per-layer files on first activation; the default view (communities layer, latest month) should render with exactly two data fetches (one derived file + one boundary file) plus basemap tiles.

## Decision gates

- **Gate A — legislative district sources**: for each of congressional, state senate, and state assembly districts: Census `cb` file vs LA County eGIS layer — pick whichever yields clean LA-County-relevant districts with usable district-number attributes; record choices and processing steps per layer.
- **Gate B — geometry sizes**: check committed boundary file sizes; decide and record simplification tolerances if needed.

### Decision log (fill in — part of the deliverable)

- Gate A: _unresolved_
- Gate B: _unresolved_

## Acceptance criteria

- `bun run dev` in `src/web/` serves the app locally; `bun run build` produces a static bundle containing the copied data files; no network requests at runtime except same-origin assets and OpenFreeMap tiles; no API keys anywhere.
- All six layers render and switch correctly; every feature in each boundary file joins to a `geo_id` in the corresponding derived file (log joinless features to console in dev; there should be near-zero, allowing for genuinely dataless areas like uninhabited zips).
- Time slider and metric toggle update the choropleth without refetching layer data.
- Detail panel shows marginals with the marginal-not-crosstab note verbatim visible; community panel shows the estimate note and the feature's `type`.
- The la-geography citation link appears in both the layer-switcher context and the about section.
- Merging to `main` deploys to GitHub Pages via the workflow; the deployed site works under the repo base path.
- TypeScript compiles with derived-file access typed via `src/shared/` imports.

## Out of scope

- **No data pipeline changes** — if a derived file is missing a field you need, stop and flag it against phase 3 rather than computing it client-side from tidy data.
- **No CalFresh UI** — Medi-Cal only (CalFresh exists in tidy data as insurance, deliberately unexposed).
- **No cross-tab estimation** — never derive or display age × ethnicity/citizenship joints.
- **No PMTiles/self-hosted basemap** — OpenFreeMap is the decided basemap; swap only if it's actually unavailable, and record an ADR if so.
- **No auth, no analytics backend, no server rendering.**
