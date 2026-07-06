# Medi-Cal Enrollment Tracker

Mirrors LA County DPSS Medi-Cal enrollment data for young children (ages 0–5) into static, versioned JSON, and presents it as an interactive layered map focused on **enrollment trends**.

**Live site:** [https://erikawitt.github.io/medi-cal-enrollment/](https://erikawitt.github.io/medi-cal-enrollment/)

## Intent

This project tracks **enrollment** for **age 0–5** across LA County geographies and intends to surface **disenrollment trends** — month-over-month declines in enrollment derived from consecutive **report months** - resulting from the implementation of [H.R.1](https://www.chcf.org/resource/hr1-work-requirement-affect-californians-medi-cal-policy-at-a-glance/). 

DPSS publishes point-in-time counts of persons enrolled in Medi-Cal (and other DPSS-administered programs), not a disenrollment flow; the trend is always a derived signal.

## What you can explore

- **Enrollment (age 0–5)** — number of enrolled persons for a selected **report month**
- **Enrollment trend** — month-over-month change in that enrollment (MoM delta / percent)
- **Geography levels** — community (default), SPA, congressional district, state assembly district, state senate district
- **Marginal breakdown** — ethnicity and citizenship distributions for a geography’s whole enrolled population (never cross-tabulated with age in the source data). Currently, the DPSS data does not disaggregate age by ethnicity nor citizenship status. The Ethnicity and Citizenship breakdown by region includes all persons enrolled in Medi-Cal and is intended to be corollary and to help assess potential disparities.



## Data sources & limitations


| Source                                                                                      | Use                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [LA County DPSS Medi-Cal At-A-Glance dashboard](https://dpss.lacounty.gov/) (Tableau embed) | Primary — only published source with age 0–5 counts (grouping ages under 1, 1-2, 3-5 into a single category for the purposes of understanding disenrollment trends among early childhood beneficiaries) at zip / SPA / district granularity |
| [CHHS/DHCS open data](https://data.chhs.ca.gov/)                                            | Validation cross-check; coarser geography and age buckets                                                                                                                                                                                   |
| [la-geography](https://github.com/stiles/la-geography)                                      | Community boundary definitions (270 features; includes cities and unincorporated areas)                                                                                                                                                     |


Important constraints (see ADRs in `docs/adr/`):

- **Community** figures are apportioned estimates, not published by DPSS.
- **Unknown area** (`geo_id: "unknown"`) carries real counts but has no map geometry.
- **Marginal breakdown** applies to total enrollment, not age 0–5 specifically.
- Scraper fragility is the main operational risk; raw captures are committed to preserve history.



## How it works

```
DPSS Tableau embed  →  raw capture  →  tidy data  →  derived files  →  web map
     (scrape)           data/raw/       data/tidy/     data/derived/      src/web/
```


| Stage     | Output                                       | Role                                                                    |
| --------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| Scrape    | **Raw capture** per report month × geography | Audit-trail source; downstream steps never read the live site           |
| Normalize | **Tidy data** (`data/tidy/`)                 | Long-format rows: month × geography × program × metric                  |
| Derive    | **Derived files** (`data/derived/`)          | Age 0–5 rollups, MoM deltas, community collations, map-ready pivots     |
| Crosswalk | `data/crosswalk/`                            | Apportions zip-level counts to **communities** by area-weighted overlap |
| Web       | `src/web/`                                   | MapLibre choropleth over committed boundaries (`data/boundaries/`)      |


**Report month** — the month a DPSS figure describes (`YYYY-MM`), distinct from when data was scraped. DPSS publishes with roughly a one-month lag.

See `[CONTEXT.md](./CONTEXT.md)` for the full ubiquitous language glossary.

## Repository layout

```
├── data/
│   ├── raw/          # raw captures (committed)
│   ├── tidy/         # normalized rows
│   ├── derived/      # rollups, deltas, map pivots
│   ├── crosswalk/    # zip ↔ community apportionment
│   └── boundaries/   # GeoJSON layers (geo_id join keys)
├── docs/
│   ├── adr/          # architectural decisions
│   └── plans/        # phased implementation notes
├── src/
│   ├── data-pipeline/  # scrape, normalize, derive, validate
│   ├── shared/         # shared types
│   └── web/            # Vite + React + MapLibre app
└── CONTEXT.md          # domain language reference
```



## Getting started

**Prerequisites:** [Bun](https://bun.sh) 

```bash
# install workspace dependencies
bun install

# run the map locally
bun run web

# data pipeline (requires Playwright browsers for scrape)
bun run scrape
bun run normalize
bun run derive
bun run validate
```



## Contributing

Monthly data updates are intended to land via reviewed PRs that add raw captures and regenerate derived files.

## License

MIT — see `[LICENSE](https://github.com/erikawitt/medi-cal-disenrollment/blob/main/LICENSE)`.

## Acknowledgments

Co-maintained with [Tony Ketcham](https://github.com/tonyketcham).
