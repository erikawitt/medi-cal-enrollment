// Regenerates data/crosswalk/zip-community.json from the committed boundary
// files. Run manually (bun run crosswalk) and only when a boundary source
// changes — this is not part of the monthly cron.
import { buildCrosswalkEntries } from "./build-crosswalk";

const repoRoot = new URL("../../../", import.meta.url).pathname;
const zipsPath = `${repoRoot}data/boundaries/zips.geojson`;
const communitiesPath = `${repoRoot}data/boundaries/communities.geojson`;
const outputPath = `${repoRoot}data/crosswalk/zip-community.json`;

const ZIP_SOURCE =
  "https://public.gis.lacounty.gov/public/rest/services/LACounty_Dynamic/Administrative_Boundaries/MapServer/5/query?where=1%3D1&outFields=ZIPCODE&outSR=4326&f=geojson (LA County eGIS Zipcodes layer, retrieved 2026-07-05)";
const COMMUNITY_SOURCE =
  "https://stilesdata.com/la-geography/la_neighborhoods_comprehensive.geojson (la-geography comprehensive neighborhoods layer, retrieved 2026-07-05)";

const zips = await Bun.file(zipsPath).json();
const communities = await Bun.file(communitiesPath).json();

const entries = buildCrosswalkEntries(zips, communities);

const crosswalk = {
  generated_at: new Date().toISOString(),
  zip_source: ZIP_SOURCE,
  community_source: COMMUNITY_SOURCE,
  method: "proportional-overlap, EPSG:3310, sliver threshold 0.01, renormalized",
  // Full double precision: keeps each zip's fractions summing to 1 within
  // 1e-9 and is byte-deterministic for identical inputs.
  entries,
};

await Bun.write(outputPath, JSON.stringify(crosswalk, null, 2) + "\n");

const zipCount = new Set(entries.map((e) => e.zip)).size;
const communityCount = new Set(entries.map((e) => e.community)).size;
console.log(
  `Wrote ${entries.length} entries (${zipCount} zips, ${communityCount} communities) to ${outputPath}`,
);
