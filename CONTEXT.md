# Medi-Cal Disenrollment Tracker

Mirrors LA County DPSS Medi-Cal enrollment data for young children (ages 0-5) into static, versioned JSON, and presents it as an interactive layered map focused on disenrollment trends.

## Language

### Data pipeline

**Report month**:
The month a DPSS figure describes (the "Report Month" dropdown value in the source dashboard), keyed as `YYYY-MM`. Distinct from the date the data was scraped; DPSS publishes with roughly a one-month lag.

**Raw capture**:
The minimally-touched bytes the scraper extracts from the DPSS Tableau embed for one report month and geography, committed under `data/raw/`. The audit-trail source that normalization reads from; never read from the live site downstream of the scraper.

**Tidy data**:
Normalized long-format rows (one row per month × geography × program × metric), one file per report month under `data/tidy/`. Contains Medi-Cal and CalFresh only.

**Derived file**:
Any file computed from tidy data rather than scraped: age 0-5 rollups, month-over-month deltas, community collations, and map-ready pivots. Medi-Cal only. Rewritten wholesale each month.

**Crosswalk**:
The committed static table of `(zip, community, overlap_fraction)` triples used to apportion zip-level counts across communities by area-weighted overlap. A one-time geographic artifact, regenerated only when boundary files change.

### Domain metrics

**Enrollment**:
The stock of persons enrolled in a program for a report month, as published by DPSS. A point-in-time count, not a flow.

**Disenrollment trend**:
The month-over-month decline in enrollment for a geography, derived by this pipeline as the delta between consecutive report months. DPSS publishes no explicit disenrollment flow; this is always a derived signal.
_Avoid_: disenrollment count, disenrollments (implies a published flow metric that does not exist)

**Age 0-5**:
The sum of DPSS's "Under 1", "1-2", and "3-5" age buckets. The subpopulation this project tracks.

**Marginal breakdown**:
A distribution (ethnicity, citizenship status) published for a geography's whole enrolled population. Never cross-tabulated with age — "undocumented 0-5-year-olds in zip X" does not exist in the source data.
_Avoid_: cross-tab, joint distribution

### Geography

**Geography level**:
One of the six spatial groupings data is presented at: zip, SPA, congressional district, state senate district, state assembly district, or community. Encoded as `geo_type` in data files.

**SPA (Service Planning Area)**:
One of LA County's eight health-service planning regions, published directly by DPSS.

**Community**:
One of the 270 features in the [la-geography](https://github.com/stiles/la-geography) comprehensive neighborhoods layer: LA City sub-neighborhoods, standalone cities, and unincorporated communities. Never present in DPSS source data; community figures are always apportioned estimates derived via the crosswalk. The UI's definition of "Communities" must cite the la-geography source.
_Avoid_: neighborhood (inaccurate for the 87 standalone cities in the layer)

**Unknown area**:
DPSS's residual bucket at every geography level for persons who could not be geocoded to an area, kept in data files as `geo_id: "unknown"`. It carries real published counts that countywide reconciliation needs; it has no geometry, is skipped by map rendering, and is exempt from crosswalk coverage.
