import type { GeoType } from "@medi-cal-disenrollment/shared";

/**
 * The five boundary layers exposed in the UI. Zip data exists in derived
 * files but is deliberately unexposed.
 */
export type LayerId = Exclude<GeoType, "zip">;

export interface LayerSpec {
  id: LayerId;
  label: string;
  boundaryUrl: string;
  /** GeoJSON property holding the geo_id join key. */
  boundaryIdProperty: string;
  derivedUrl: string;
}

const base = import.meta.env.BASE_URL;

export const LAYERS: readonly LayerSpec[] = [
  {
    id: "community",
    label: "Communities",
    boundaryUrl: `${base}data/boundaries/communities.geojson`,
    boundaryIdProperty: "slug",
    derivedUrl: `${base}data/derived/map/community.json`,
  },
  {
    id: "spa",
    label: "Service Planning Areas",
    boundaryUrl: `${base}data/boundaries/spas.geojson`,
    boundaryIdProperty: "geo_id",
    derivedUrl: `${base}data/derived/map/spa.json`,
  },
  {
    id: "congressional_district",
    label: "Congressional districts",
    boundaryUrl: `${base}data/boundaries/congressional_districts.geojson`,
    boundaryIdProperty: "geo_id",
    derivedUrl: `${base}data/derived/map/congressional_district.json`,
  },
  {
    id: "senate_district",
    label: "State Senate districts",
    boundaryUrl: `${base}data/boundaries/senate_districts.geojson`,
    boundaryIdProperty: "geo_id",
    derivedUrl: `${base}data/derived/map/senate_district.json`,
  },
  {
    id: "assembly_district",
    label: "State Assembly districts",
    boundaryUrl: `${base}data/boundaries/assembly_districts.geojson`,
    boundaryIdProperty: "geo_id",
    derivedUrl: `${base}data/derived/map/assembly_district.json`,
  },
];

export function layerById(id: LayerId): LayerSpec {
  const spec = LAYERS.find((l) => l.id === id);
  if (!spec) throw new Error(`Unknown layer: ${id}`);
  return spec;
}
