---
name: "Phase 2: Zip-to-community crosswalk"
overview: Fetch and commit the zip and community boundary GeoJSONs, then generate the static (zip, community, overlap_fraction) crosswalk via an area-weighted proportional-overlap spatial join in an equal-area projection. Fully independent of the DPSS scraper — can run in parallel with phase 1.
todos:
  - id: setup
    content: "Scaffold crosswalk-gen script in src/data-pipeline/ (create the workspace package if phase 1 hasn't)"
    status: completed
  - id: fetch-communities
    content: Fetch and commit la-geography communities GeoJSON to data/boundaries/
    status: completed
  - id: zip-layer-gate
    content: "Decision gate: evaluate LA County eGIS ZIP layer vs Census TIGER ZCTA; record choice"
    status: completed
  - id: fetch-zips
    content: Fetch and commit the chosen zip boundary layer to data/boundaries/
    status: completed
  - id: spatial-join
    content: Implement proportional-overlap spatial join (EPSG:3310, threshold, normalize)
    status: completed
  - id: commit-crosswalk
    content: Generate and commit data/crosswalk/zip-community.json with provenance metadata
    status: completed
---

# Phase 2: Zip-to-community crosswalk

> **Read `CONTEXT.md` at the repo root first** and use its language. In particular: the canonical term is **community**, never "neighborhood", even though the upstream source file is named `la_neighborhoods_comprehensive.geojson`.

## Goal

When this phase is done: `data/boundaries/` contains committed zip and community boundary GeoJSONs with documented provenance, and `data/crosswalk/zip-community.json` contains the static area-weighted crosswalk that later phases use to apportion zip-level enrollment counts across communities. This is a **one-time (or rarely-regenerated) geographic artifact** — it does not run in the monthly cron, and it depends only on the two boundary files, never on scraped DPSS data.

## Context (self-contained)

### Why a crosswalk exists

DPSS publishes enrollment data down to zip code, SPA, and congressional district — there is no "neighborhood" concept in the source. The product wants data grouped at a grain people recognize ("Silver Lake", "Hacienda Heights"), countywide. So zip-level counts must be collated up to a separate community boundary layer via a spatial join. The apportionment method is **decided — do not re-research it**: proportional overlap (area-weighted), not single-best-match, because many zips span multiple communities and best-match silently discards population.

### The community boundary source (decided — do not re-derive)

**The la-geography comprehensive neighborhoods layer.**

- Repo: `https://github.com/stiles/la-geography`
- Direct GeoJSON (static, no auth, WGS84/EPSG:4326): `https://stilesdata.com/la-geography/la_neighborhoods_comprehensive.geojson`
- 270 features; `properties.type` values: `segment-of-a-city` (114 — LA City's LA Times-defined sub-neighborhoods), `standalone-city` (87 — e.g. Pasadena, Long Beach), `unincorporated-area` (69 — e.g. Hacienda Heights).
- Useful fields: `name`, `slug`, `city`, `region` (16 broader regions), `area_sqmi`. **`slug` is the canonical `geo_id` for communities** throughout this repo.
- Provenance: a community-maintained descendant of the LA Times Data Desk "Mapping LA" boundaries, extended countywide; its LA-City subset exactly matches the official `LA_Times_Neighborhoods` ArcGIS layer. Fine for choropleths; not compliance-grade.

### Zip boundary candidates (decision gate — verify, then pick one)

1. **LA County eGIS ZIP layer**: `https://public.gis.lacounty.gov/public/rest/services/LACounty_Dynamic/Administrative_Boundaries/MapServer/5/query?where=1=1&outFields=*&f=geojson` (candidate URL from research — verify field names, feature count, and coverage before relying on it; Esri REST may paginate results and cap features per request).
2. **Census TIGER ZCTA shapefiles** (e.g. `cb_2023` series or newer), clipped to the LA County boundary. Note ZCTAs are approximations of USPS zip codes, but so is any zip polygon layer.

Pick whichever has cleaner coverage/attributes for intersection against the communities layer; record the choice and rationale in the Decision log below. The zips appearing in DPSS data (phase 1's captures, if available) are a useful completeness check but not a blocker — this phase must not wait on phase 1.

### The algorithm (decided — implement as specified)

1. Load both layers; reproject both to **EPSG:3310 (California Albers, equal-area)** before any area/intersection math. Never compute area ratios in WGS84 degrees.
2. For every zip polygon, intersect against every community polygon it touches.
3. For each `(zip, community)` pair, `overlap_fraction = intersection_area / total_zip_area`. Drop pairs with `overlap_fraction < 0.01` (slivers from imperfectly-coincident independent sources).
4. Renormalize each zip's surviving fractions to sum to 1.0.
5. Emit one record per surviving `(zip, community, overlap_fraction)` triple.

Downstream usage (phase 3, for awareness only): `community_value = Σ over zips (zip_value × overlap_fraction)`. This assumes uniform population density within each zip — an approximation. Community sums will not perfectly reconcile to zip/countywide totals; that drift is expected, not a bug.

### Stack

Bun + TypeScript (repo-wide decision). Suggested libraries: `@turf/turf` for intersection/area, `proj4` for EPSG:4326 → EPSG:3310 reprojection (turf computes planar area on projected coordinates; alternatively use turf's geodesic `area()` on unprojected geometries consistently for both numerator and denominator — either is acceptable if applied consistently; record which you used). Code lives in `src/data-pipeline/` (create the workspace package with root `package.json` `"workspaces": ["src/*"]` if phase 1 hasn't run yet — check before scaffolding).

## Contract

**Consumes**: the two upstream boundary URLs above. Nothing from other phases.

**Produces**:

```
data/boundaries/communities.geojson        # la-geography layer, fetched once, committed verbatim
data/boundaries/zips.geojson               # chosen zip layer (clipped to LA County if TIGER)
data/crosswalk/zip-community.json          # the crosswalk artifact
```

`zip-community.json` shape:

```json
{
  "generated_at": "ISO-8601",
  "zip_source": "<url + retrieval date>",
  "community_source": "<url + retrieval date>",
  "method": "proportional-overlap, EPSG:3310, sliver threshold 0.01, renormalized",
  "entries": [
    { "zip": "90026", "community": "silver-lake", "overlap_fraction": 0.62 }
  ]
}
```

- `community` is the la-geography `slug`.
- Boundary GeoJSONs remain WGS84 (EPSG:4326) as committed — reprojection is internal to the join, and the web app (phase 5) needs 4326.

## Decision gates

- **Gate A — zip layer choice**: eGIS ZIP layer vs Census TIGER ZCTA (see candidates above). Evaluate coverage, feature count sanity (~300-500 zips for LA County), geometry validity, and attribute cleanliness.

### Decision log (fill in — part of the deliverable)

- **Gate A: LA County eGIS ZIP layer** (`LACounty_Dynamic/Administrative_Boundaries/MapServer/5`, resolved 2026-07-05). Verified live against the plan's concerns: layer is named "Zipcodes" with a clean `ZIPCODE` string field (all values 5-digit); 313 features / 309 unique zips — inside the expected ~300-500 range; no null geometries; `maxRecordCount` is 1000, so the full layer arrives in a single request with no pagination (`exceededTransferLimit` absent from the response). The service reprojects to WGS84 on request (`outSR=4326`) and is already scoped to LA County, so no clipping step is needed. Census TIGER ZCTA was rejected because it adds a shapefile download, format conversion, and a county-clip step for no accuracy gain (both layers are approximations of USPS zips). Quirk handled in code: four duplicate-`ZIPCODE` features (90802 ×2, 90803 ×4 — harbor/island fragments) are merged into one MultiPolygon per zip before the join.
- **Spot-check note — 90210 is not wholly inside Beverly Hills.** The acceptance criterion's example is geographically off: zip 90210 extends well north of the Beverly Hills city limit into the Santa Monica Mountains, so it correctly splits across beverly-crest (0.56), beverly-hills (0.38), sherman-oaks (0.04), and studio-city (0.01). The "wholly inside one city maps ≥ 0.99" check passes on genuinely contained zips instead: 90813 → long-beach 1.0, 91801 → alhambra 1.0, 91103 → pasadena 1.0. The split-zip check passes as specified: 90026 → echo-park 0.49 / silver-lake 0.27 / westlake 0.18 / elysian-park 0.06.
- **Two communities absent from the crosswalk by design.** `val-verde` and `desert-view-highlands` (both tiny unincorporated areas, < 0.5 sq mi) each overlap only one very large Antelope/Santa Clarita valley zip (91384 at 0.002, 93551 at 0.005 of the zip's area) — below the 0.01 sliver threshold, so they receive no entries. Accepting this: lowering the threshold to include them would admit genuine slivers countywide, and area-weighted apportionment would attribute a misleadingly tiny share of a huge rural zip to them anyway. 268 of 270 communities appear.
- **Area computation: proj4 reprojection to EPSG:3310 + planar shoelace area**, applied consistently to zip areas and intersection areas. Chosen over turf's geodesic `area()` because turf's `intersect()` is planar regardless — computing the intersections in an equal-area projection keeps the geometry math and the area math in the same space. Hole rings are subtracted; `Math.abs` per ring makes the result independent of winding order (which neither source guarantees).

## Acceptance criteria

- `bun run crosswalk` regenerates `data/crosswalk/zip-community.json` deterministically (same inputs → byte-identical output modulo `generated_at`).
- Every zip's `overlap_fraction`s sum to 1.0 within 1e-9.
- No entry has `overlap_fraction < 0.01`.
- Spot-checks pass: a zip wholly inside one city maps ≥ 0.99 to it (e.g. 90210 → beverly-hills); a known-split zip (e.g. 90026 across Silver Lake/Echo Park) maps to multiple communities with plausible fractions — verify against a map by eye.
- Zip count in the crosswalk is within the expected LA County range (~300-500); every community that geometrically overlaps inhabited zips appears at least once.
- Both boundary files committed with provenance (source URL + retrieval date) recorded in the crosswalk metadata.

## Out of scope

- **No DPSS data involvement** — this phase never reads `data/raw/` or `data/tidy/`.
- **Applying the crosswalk** to enrollment numbers (phase 3).
- **SPA, congressional-district, state-senate-district, and state-assembly-district boundaries** — phase 5 owns fetching those; this phase commits only zips and communities.
- **Population-weighted apportionment** — area-weighting is the decided method; do not "improve" it with census block weighting without a new decision.
- Monthly automation — the crosswalk is regenerated manually and only if a boundary source changes.
