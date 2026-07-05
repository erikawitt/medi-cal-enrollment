# Scrape the DPSS Tableau embed as the primary data source

Official APIs exist for Medi-Cal enrollment data (CHHS/DHCS CKAN datasets on data.chhs.ca.gov), but none of them provide the granularity this project exists to track: age 0-5 counts at zip / SPA / congressional-district level. Only the DPSS "At-A-Glance" dashboard — an anonymous-embed Tableau Cloud workbook behind an Oracle APEX page — publishes that combination, and it exposes no data API (its `getSummaryDataAsync` / `getParametersAsync` calls are permission-denied for anonymous viewers). We therefore scrape the rendered Tableau embed with a headless browser as the primary source, and use the CHHS county-level API only as a validation cross-check and coarse fallback.

## Considered options

- **CHHS/DHCS open-data APIs as primary** — stable, documented, but zip-level data has no age breakdown at all, and age data is county-level only with a 0-18 bucket. Would make the project's core question (where are 0-5-year-olds losing coverage?) unanswerable.
- **Confidential microdata request to DPSS MRS** — could provide cross-tabs and mixed-status data, but is a manual, slow, approval-gated process incompatible with an automated monthly pipeline.
- **Scrape the Tableau embed (chosen)** — fragile by nature (UI-dependent extraction, anonymous JWT embed), but the only automatable path to the required granularity.

## Consequences

- The scraper is the system's fragility concentration point; every downstream design (committed raw captures, PR-gated data updates, CHHS validation) exists partly to contain that fragility.
- Report months age out of the dashboard's dropdown on an unknown schedule, so history capture is time-sensitive and irreversible — a strong reason to backfill early and commit everything.
- If DPSS ships a native disenrollment dashboard (per the ~April 2026 Board of Supervisors motion re: H.R.1 tracking), re-evaluate this decision before extending the scraper.
