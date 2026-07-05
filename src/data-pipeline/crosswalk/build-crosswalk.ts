import { intersect } from "@turf/turf";
import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
  Position,
} from "geojson";
import proj4 from "proj4";

export interface CrosswalkEntry {
  zip: string;
  community: string;
  overlap_fraction: number;
}

const SLIVER_THRESHOLD = 0.01;

// EPSG:3310 — NAD83 / California Albers, equal-area, meters.
const EPSG_3310 =
  "+proj=aea +lat_0=0 +lon_0=-120 +lat_1=34 +lat_2=40.5 +x_0=0 +y_0=4000000 +datum=NAD83 +units=m +no_defs";
const toCalAlbers = proj4("EPSG:4326", EPSG_3310);

type PolyGeom = Polygon | MultiPolygon;

/** View any Polygon/MultiPolygon as a list of single-polygon coordinate arrays. */
function polygonsOf(geom: PolyGeom): Position[][][] {
  return geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
}

function reprojectPositions(ring: Position[]): Position[] {
  return ring.map((p) => toCalAlbers.forward([p[0]!, p[1]!]));
}

function reprojectGeometry(geom: PolyGeom): PolyGeom {
  if (geom.type === "Polygon") {
    return { type: "Polygon", coordinates: geom.coordinates.map(reprojectPositions) };
  }
  return {
    type: "MultiPolygon",
    coordinates: geom.coordinates.map((poly) => poly.map(reprojectPositions)),
  };
}

/** Planar shoelace area in the units of the coordinate system (m² for EPSG:3310). */
function ringArea(ring: Position[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[i + 1]!;
    sum += x1! * y2! - x2! * y1!;
  }
  return sum / 2;
}

function planarArea(geom: PolyGeom): number {
  let total = 0;
  for (const poly of polygonsOf(geom)) {
    // Exterior ring minus holes; use absolute values so winding order
    // (which the sources do not guarantee) cannot flip signs.
    const [exterior, ...holes] = poly;
    if (!exterior) continue;
    total += Math.abs(ringArea(exterior));
    for (const hole of holes) total -= Math.abs(ringArea(hole));
  }
  return total;
}

interface Bbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function bboxOf(geom: PolyGeom): Bbox {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const poly of polygonsOf(geom)) {
    for (const [x, y] of poly[0] ?? []) {
      if (x! < minX) minX = x!;
      if (x! > maxX) maxX = x!;
      if (y! < minY) minY = y!;
      if (y! > maxY) maxY = y!;
    }
  }
  return { minX, minY, maxX, maxY };
}

function bboxesDisjoint(a: Bbox, b: Bbox): boolean {
  return a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY;
}

function asFeature(geom: PolyGeom): Feature<PolyGeom> {
  return { type: "Feature", properties: {}, geometry: geom };
}

/** Merge all features sharing a zip code into one MultiPolygon geometry. */
function mergeByZip(
  zips: FeatureCollection<PolyGeom>,
): Map<string, MultiPolygon> {
  const merged = new Map<string, MultiPolygon>();
  for (const feature of zips.features) {
    const zip = feature.properties?.["ZIPCODE"];
    if (typeof zip !== "string" || !feature.geometry) continue;
    const polys = polygonsOf(feature.geometry);
    const existing = merged.get(zip);
    if (existing) {
      existing.coordinates.push(...polys);
    } else {
      merged.set(zip, { type: "MultiPolygon", coordinates: [...polys] });
    }
  }
  return merged;
}

/**
 * Area-weighted proportional-overlap spatial join between zip and community
 * polygons (both WGS84 on input). Internally reprojects to EPSG:3310 and
 * computes planar areas; drops overlaps below SLIVER_THRESHOLD of the zip's
 * area and renormalizes each zip's surviving fractions to sum to 1.
 */
export function buildCrosswalkEntries(
  zips: FeatureCollection<PolyGeom>,
  communities: FeatureCollection<PolyGeom>,
): CrosswalkEntry[] {
  const projectedCommunities = communities.features
    .filter((f) => f.geometry && typeof f.properties?.["slug"] === "string")
    .map((f) => {
      const geometry = reprojectGeometry(f.geometry);
      return {
        slug: f.properties!["slug"] as string,
        geometry,
        bbox: bboxOf(geometry),
      };
    });

  const entries: CrosswalkEntry[] = [];

  for (const [zip, rawGeometry] of mergeByZip(zips)) {
    const zipGeometry = reprojectGeometry(rawGeometry) as MultiPolygon;
    const zipArea = planarArea(zipGeometry);
    if (zipArea <= 0) continue;
    const zipBbox = bboxOf(zipGeometry);
    const zipFeature = asFeature(zipGeometry);

    const overlaps: { community: string; fraction: number }[] = [];
    for (const community of projectedCommunities) {
      if (bboxesDisjoint(zipBbox, community.bbox)) continue;
      const intersection = intersect({
        type: "FeatureCollection",
        features: [zipFeature, asFeature(community.geometry)],
      });
      if (!intersection) continue;
      const fraction = planarArea(intersection.geometry) / zipArea;
      if (fraction >= SLIVER_THRESHOLD) {
        overlaps.push({ community: community.slug, fraction });
      }
    }

    const total = overlaps.reduce((sum, o) => sum + o.fraction, 0);
    if (total <= 0) continue;
    for (const { community, fraction } of overlaps) {
      entries.push({ zip, community, overlap_fraction: fraction / total });
    }
  }

  entries.sort(
    (a, b) => a.zip.localeCompare(b.zip) || a.community.localeCompare(b.community),
  );
  return entries;
}
