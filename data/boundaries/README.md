# Boundary files

Committed GeoJSON boundary layers, all WGS84 (EPSG:4326). Every feature carries a
`geo_id` property (the join key to `data/derived/map/*.json` feature keys) and a
`name` property (human display name), alongside selected source attributes.

## spas.geojson

- **Source**: LA County eGIS Administrative Boundaries FeatureServer, layer 23 (Service Planning Areas) — `https://public.gis.lacounty.gov/public/rest/services/LACounty_Dynamic/Administrative_Boundaries/FeatureServer/23/query?where=1=1&outFields=*&f=geojson`
- **Retrieved**: 2026-07-06
- **Features**: 8 (`spa-1` … `spa-8`)
- **Processing**: mapshaper — kept fields `SPA`, `SPA_NAME`, `SPA_NUM`; added `geo_id = "spa-" + SPA_NUM` and `name = "SPA " + SPA_NUM + " — " + SPA_NAME`; simplified with `-simplify 10% keep-shapes` + `-clean` (raw download was 4.4 MB; simplified output is ~0.3 MB); coordinates rounded to 5 decimal places (~1 m).
- **Property mapping**: `SPA_NUM` → `geo_id` (`spa-4`), `SPA_NUM` + `SPA_NAME` → `name` (`SPA 4 — Metro`).

## congressional_districts.geojson

- **Source**: US Census Bureau 2024 cartographic boundary file, 119th Congress, 1:500k — `https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_cd119_500k.zip`
- **Retrieved**: 2026-07-06
- **Features**: 17 LA-County-relevant California districts (`ca-23 ca-26 ca-27 ca-28 ca-29 ca-30 ca-31 ca-32 ca-34 ca-35 ca-36 ca-37 ca-38 ca-42 ca-43 ca-44 ca-45`)
- **Processing**: mapshaper — filtered to `STATEFP == "06"` and the 17 district numbers present in the derived data; added `geo_id = "ca-" + Number(CD119FP)` and `name = "Congressional District " + Number(CD119FP)`; reprojected NAD83 → WGS84; coordinates rounded to 5 decimal places. **No simplification needed** (0.21 MB as-is at 1:500k). Full district polygons are kept — geometry is not clipped to the LA County line.
- **Property mapping**: `CD119FP` → `geo_id` (`"27"` → `ca-27`), `CD119FP` → `name` (`Congressional District 27`).

## senate_districts.geojson

- **Source**: US Census Bureau 2024 cartographic boundary file, California state legislative districts upper chamber (2024 LSY), 1:500k — `https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_06_sldu_500k.zip`
- **Retrieved**: 2026-07-06
- **Features**: 13 (`sd-20 sd-22 sd-23 sd-24 sd-25 sd-26 sd-27 sd-28 sd-30 sd-33 sd-34 sd-35 sd-36`)
- **Processing**: mapshaper — filtered to the 13 district numbers present in the derived data; added `geo_id = "sd-" + Number(SLDUST)` and `name = "Senate District " + Number(SLDUST)`; reprojected NAD83 → WGS84; coordinates rounded to 5 decimal places. **No simplification needed** (0.18 MB as-is). Full district polygons kept, not clipped to the county line.
- **Property mapping**: `SLDUST` → `geo_id` (`"018"` → `sd-18`), `SLDUST` → `name` (`Senate District 18`).

## assembly_districts.geojson

- **Source**: US Census Bureau 2024 cartographic boundary file, California state legislative districts lower chamber (2024 LSY), 1:500k — `https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_06_sldl_500k.zip`
- **Retrieved**: 2026-07-06
- **Features**: 24 (`ad-34 ad-39 ad-40 ad-41 ad-42 ad-43 ad-44 ad-46 ad-48 ad-49 ad-51 ad-52 ad-53 ad-54 ad-55 ad-56 ad-57 ad-61 ad-62 ad-64 ad-65 ad-66 ad-67 ad-69`)
- **Processing**: mapshaper — filtered to the 24 district numbers present in the derived data; added `geo_id = "ad-" + Number(SLDLST)` and `name = "Assembly District " + Number(SLDLST)`; reprojected NAD83 → WGS84; coordinates rounded to 5 decimal places. **No simplification needed** (0.21 MB as-is). Full district polygons kept, not clipped to the county line.
- **Property mapping**: `SLDLST` → `geo_id` (`"051"` → `ad-51`), `SLDLST` → `name` (`Assembly District 51`).

## zips.geojson, communities.geojson

Committed by phase 2 (before this README existed); see phase 2 plan/commits for provenance.
