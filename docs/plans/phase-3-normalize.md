---
name: "Phase 3: Normalization, derived files, and validation"
overview: Transform committed raw DPSS captures into tidy per-month JSON (Medi-Cal + CalFresh), compute the derived Medi-Cal files (age 0-5 rollups, month-over-month deltas, community collation via the crosswalk, map-ready pivots per geography level), create the src/shared/ types package, and build the CHHS cross-validation script.
todos:
  - id: shared-pkg
    content: Create src/shared/ workspace package with data-file type definitions (types only, no logic)
    status: completed
  - id: normalize
    content: "Build normalize script: data/raw/{month} -> data/tidy/{month}.json"
    status: completed
  - id: derive
    content: "Build derive script: tidy -> data/derived/map/{geo_type}.json incl. community collation"
    status: completed
  - id: validate
    content: Build validation script (CHHS county cross-check + internal consistency + MoM swing flags)
    status: completed
  - id: fixtures
    content: Add raw-capture fixtures so normalize/derive are testable without a live scraper
    status: completed
---

# Phase 3: Normalization, derived files, and validation

> **Read `CONTEXT.md` at the repo root first** and use its language: report month, raw capture, tidy data, derived file, crosswalk, community (never "neighborhood"), disenrollment trend (always derived, never a published flow), marginal breakdown (never cross-tab).

## Goal

When this phase is done: `bun run normalize` turns every month under `data/raw/` into `data/tidy/{YYYY-MM}.json`; `bun run derive` rebuilds `data/derived/map/{geo_type}.json` for all six geography levels; `bun run validate` cross-checks the result and exits non-zero on failure; and `src/shared/` exports the TypeScript types that both this pipeline and the future web app (phase 5) compile against. All three scripts run offline — they read only committed files, never the network (except `validate`, which fetches CHHS).

## Context (self-contained)

### Inputs you inherit

- **Phase 1** committed raw captures under `data/raw/{YYYY-MM}/{geo_type}/...` (geo types: zip, SPA, congressional district, state senate district, state assembly district) plus a per-month `manifest.json` recording the extraction method/format. The raw format (CSV from Tableau crosstab export, or scraped HTML/JSON) was decided empirically — **read phase 1's Decision log in `docs/plans/phase-1-scraper.md` before writing the parser.** Raw is faithful to the source: numbers may contain thousands separators (`1,910,584`), headers are DPSS's own labels, and footnote rows/sheets may be present (the Tableau dashboard's sheet list included a `Footnote` worksheet — filter such rows out).
- **Phase 2** committed `data/crosswalk/zip-community.json`: entries of `{ zip, community, overlap_fraction }` where `community` is a la-geography slug and each zip's fractions sum to 1.0.

### The source table's semantics

The DPSS table publishes, per report month × geography × program, these row groups (programs are columns: CalWORKs, CalFresh, Medi-Cal, General Relief, CAPI, Refugee, IHSS, Unduplicated):

- Caseload: Cases, Persons, Persons 24 months back, Average Benefit Amount($) Per Case
- Payments: avg benefit / expenditures, last 12 months
- Citizenship Status of Persons: Citizen, Documented Individual, Undocumented Individual, Other
- Application Processing: Received Monthly
- Ethnic Origin of Persons: American Indian/Alaska Native; Asian/Asian American; Black/African/African American; Hispanic/Latino(a)/Chicano(a); Native Hawaiian/Pacific Islander; White/European/European American; Two or More Races/Ethnicities; Other
- Age of Persons: Under 1, 1-2, 3-5, 6-12, 13-15, 16-17, plus adult buckets (verify the full list against actual raw captures)

**Critical semantic constraint**: these are marginal distributions. Never emit or imply a joint (e.g. age × citizenship) breakdown — the schema below deliberately cannot express one.

### Decided policies (do not relitigate)

- Tidy keeps **Medi-Cal and CalFresh only**; all other program columns in raw are dropped at normalization.
- Derived files are **Medi-Cal only**.
- Tidy is partitioned **one file per report month** (append-friendly for the monthly cron); derived map files are partitioned **one per geography level spanning all months** (read-optimized for the map) and rewritten wholesale each run.
- Community figures are always derived via the crosswalk (`community_value = Σ zip_value × overlap_fraction`), never scraped. Apportionment assumes uniform density within a zip; community sums will not perfectly reconcile with zip/countywide totals — **expected drift, not a bug**. Round apportioned values to integers only in map-ready output; keep floats internally.

## Contract

**Consumes**: `data/raw/**` (per phase 1's recorded format), `data/crosswalk/zip-community.json` (phase 2).

**Produces**:

`src/shared/` — a Bun workspace package (types only, no logic) exporting at minimum: `TidyRow`, `TidyMonthFile`, `MapGeoFile`, `CrosswalkFile`, and the enums/unions for `geo_type`, `program`, and `metric`. This package is the single schema authority; phase 5 imports it.

`data/tidy/{YYYY-MM}.json` — array of tidy rows:

```json
{ "month": "2026-05", "geo_type": "zip", "geo_id": "90001", "program": "medi-cal", "metric": "age_3_5", "value": 1234 }
```

- `geo_type` ∈ `zip` | `spa` | `congressional_district` | `senate_district` | `assembly_district` (tidy holds scraped levels only; community rows exist only in derived files).
- `geo_id`: zip = 5-digit string; SPA = `spa-1`…`spa-8`; congressional district = `ca-27`-style lowercase; state senate district = `sd-18`-style; state assembly district = `ad-51`-style (lowercase, no zero-padding).
- `program` ∈ `medi-cal` | `calfresh`.
- Canonical `metric` ids — map DPSS labels to exactly these (extend the age list to whatever adult buckets raw actually contains, using the same style):
  - `cases_total`, `persons_total`, `persons_24mo_prior`, `avg_benefit_per_case`
  - `apps_received_monthly`
  - `age_under_1`, `age_1_2`, `age_3_5`, `age_6_12`, `age_13_15`, `age_16_17`, …
  - `eth_aian`, `eth_asian`, `eth_black_african_american`, `eth_hispanic_latino`, `eth_nhpi`, `eth_white`, `eth_two_or_more`, `eth_other`
  - `cit_citizen`, `cit_documented`, `cit_undocumented`, `cit_other`
- Values are integers (strip separators); currency metrics may be floats. Missing/suppressed cells are omitted rows, not zeros — zero and absent mean different things.

`data/derived/map/{geo_type}.json` for `zip`, `spa`, `congressional_district`, `senate_district`, `assembly_district`, `community` — Medi-Cal only, all months, shaped for direct map consumption:

```json
{
  "geo_type": "community",
  "generated_at": "ISO-8601",
  "months": ["2026-01", "2026-02"],
  "features": {
    "silver-lake": {
      "2026-02": {
        "age_0_5": 1520,
        "persons_total": 20140,
        "age_0_5_mom_delta": -34,
        "age_0_5_mom_pct": -2.2,
        "persons_mom_delta": -210,
        "persons_mom_pct": -1.0,
        "ethnicity": { "eth_hispanic_latino": 9800, "...": 0 },
        "citizenship": { "cit_citizen": 14200, "...": 0 }
      }
    }
  }
}
```

- `age_0_5 = age_under_1 + age_1_2 + age_3_5` (the project's core subpopulation).
- `*_mom_delta` / `*_mom_pct` compare consecutive **report months**; null for the earliest month and across gaps (if a month is missing, do not compute a delta spanning the gap).
- The disenrollment-trend signal is exactly these deltas — no other "disenrollment" figure exists or should be invented.

## Validation (`bun run validate`)

1. **CHHS cross-check**: fetch DHCS's independently-published LA County Medi-Cal totals from the CHHS open-data portal (CKAN API, dataset "Medi-Cal Certified Eligible Counts, by Month of Eligibility, Zip Code, and Sex" at `https://data.chhs.ca.gov/dataset/medi-cal-certified-eligible-counts-by-month-of-eligibility-zip-code-and-sex`, or the county-level demographics dataset) and compare against scraped countywide `persons_total` per month. These sources measure slightly different things — this is an order-of-magnitude check: **fail** if deviation > 15%, warn if > 5% (tune thresholds against real data and record what you chose in this file).
2. **Internal consistency**: per geography level, the sum of zip-level `persons_total` should approximate the countywide figure (warn-level; boundary/suppression effects make exactness impossible). Community totals vs countywide: warn-only, wider tolerance (apportionment drift is expected).
3. **Swing detection**: flag (warn, don't fail) any geography whose `age_0_5` moves more than ±30% month-over-month — likely a scrape/parse artifact rather than reality.
4. Non-zero exit on any fail-level check; machine-readable report to stdout (phase 4 puts it in a PR description).

## Acceptance criteria

- `bun run normalize` is idempotent: running twice over the same raw produces byte-identical tidy files.
- Normalizing the May 2026 countywide capture (if present in raw) yields Medi-Cal `persons_total` = 3153672, `cases_total` = 1910584, `age_under_1` = 35222, `age_1_2` = 72285, `age_3_5` = 120036, `cit_undocumented` = 498283.
- Derived `age_0_5` for countywide May 2026 = 227543 (sum of the three buckets above).
- For every zip present in both tidy data and the crosswalk, its value is fully apportioned (fractions sum to 1); zips in tidy but missing from the crosswalk are reported by `validate` (warn).
- `data/derived/map/*.json` parse against the `src/shared/` types (compile-time test), and deltas are null for the first available month.
- Normalize/derive run with the network disabled; unit tests run from committed fixtures under `src/data-pipeline/fixtures/`, not live scrapes.

## Decision log (filled during implementation, 2026-07-06)

- **Raw capture format defect found and fixed at the source (ADR 0003).** The v1 raw captures
  committed by phase 1 held only session-cumulative value pools without index tuples and were not
  faithfully reconstructable per area (constraint-solver prototypes recovered full age breakdowns
  for only ~16-35% of zips). Rather than tolerate that downstream, the extraction was rewritten to
  emit self-contained captures (worksheet captions + tuples + referenced dictionary entries), all
  v1 captures were invalidated, and 2026-01 was recaptured in v2 from the live embed. No
  reconstruction logic exists in normalize. This was a scraper defect, not a DPSS publication
  artifact. The in-flight 2026-05 zip walk was stopped mid-run because its output was v1-format.
- **Single-month scope (owner directive):** 2026-01 is the canonical development month; the
  2026-02...2026-05 recapture is deferred to post-phase-5 (one idempotent `bun run scrape`).
  Acceptance criteria that reference the May 2026 countywide capture are met via committed
  fixtures generated from real captured VizQL bodies (`test/fixtures/*.capture.json`) - the
  Department level is not scraped monthly, so "if present in raw" is vacuous, as anticipated.
- **Countywide figure = SPA-level sum.** No Department-level capture exists per month; the SPA
  partition (8 SPAs + the residual "Unknown" area) sums to the countywide figure and is used
  wherever the plan says "countywide" (CHHS cross-check, internal consistency).
- **DPSS's residual "Unknown" area is kept in tidy and derived files as `geo_id: "unknown"`.**
  It carries real published counts that countywide reconciliation needs; map consumers skip it
  (no geometry). It is exempt from crosswalk coverage (not a real zip).
- **`age_0_5` requires all three young-child buckets.** DPSS suppresses/omits empty cells;
  absent is not zero, and a partial rollup would silently undercount. If any of `age_under_1`,
  `age_1_2`, `age_3_5` is unpublished for an area-month, `age_0_5` is omitted there.
- **CHHS cross-check thresholds retuned against real data.** The plan's 5%/15% deviation bands
  assumed the sources measure near-identical stocks. They do not: DPSS publishes
  DPSS-administered Medi-Cal persons, DHCS publishes all certified eligibles for LA County
  (dataset "Medi-Cal Certified Eligibles with Demographics by Month", resource
  `cc08b60f-...`, filtered to County=Los Angeles). Observed Jan 2026: DPSS 3.19M vs DHCS 3.98M -
  a structural ~0.80 ratio. Chosen bands on the DPSS/DHCS ratio: warn outside [0.72, 1.0], fail
  outside [0.65, 1.05] (order-of-magnitude protection that still catches a >10% relative drift
  from the structural baseline in either direction).
- **`avg_benefit_per_case` is not apportioned to communities** (averages don't sum across areas)
  and DPSS publishes no Medi-Cal per-case benefit at most levels - the metric appears in tidy
  only where actually published.
- **Deterministic tidy serialization** (sorted rows, one JSON object per line) makes normalize
  byte-idempotent; derived map files carry `generated_at` and are rewritten wholesale by design,
  so idempotency there means content-identical modulo that timestamp.

## Out of scope

- **No scraping** — if a month's raw is missing or malformed, report and skip; never fetch from DPSS.
- **No CalFresh derived files** — CalFresh stops at tidy (captured as cheap insurance for future questions; the product is Medi-Cal).
- **No crosswalk regeneration** — consume phase 2's artifact as-is.
- **No GitHub Action wiring** (phase 4) and no web code (phase 5).
- **No joint distributions** — never combine age × ethnicity/citizenship, even where arithmetic would allow an estimate.
