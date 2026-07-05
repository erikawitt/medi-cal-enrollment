import { describe, expect, test } from "bun:test";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import { buildCrosswalkEntries } from "./build-crosswalk";

// Small lon/lat rectangles near downtown LA. EPSG:3310 is equal-area, so
// area ratios of these fixtures survive reprojection exactly.
function rect(
  west: number,
  south: number,
  east: number,
  north: number,
  properties: Record<string, string>,
): Feature<Polygon> {
  return {
    type: "Feature",
    properties,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    },
  };
}

function fc(features: Feature<Polygon>[]): FeatureCollection<Polygon> {
  return { type: "FeatureCollection", features };
}

const zip = (w: number, s: number, e: number, n: number, code: string) =>
  rect(w, s, e, n, { ZIPCODE: code });
const community = (w: number, s: number, e: number, n: number, slug: string) =>
  rect(w, s, e, n, { slug });

describe("buildCrosswalkEntries", () => {
  test("zip wholly inside one community maps to it with fraction 1.0", () => {
    const zips = fc([zip(-118.05, 34.05, -118.0, 34.1, "90001")]);
    const communities = fc([community(-118.1, 34.0, -117.95, 34.15, "vernon")]);

    const entries = buildCrosswalkEntries(zips, communities);

    expect(entries).toEqual([
      { zip: "90001", community: "vernon", overlap_fraction: 1.0 },
    ]);
  });

  test("zip split across two communities gets proportional fractions summing to 1", () => {
    // Zip spans lon -118.10..-118.00; communities split it at -118.06 (40/60).
    const zips = fc([zip(-118.1, 34.0, -118.0, 34.05, "90026")]);
    const communities = fc([
      community(-118.2, 33.9, -118.06, 34.1, "echo-park"),
      community(-118.06, 33.9, -117.9, 34.1, "silver-lake"),
    ]);

    const entries = buildCrosswalkEntries(zips, communities);

    expect(entries).toHaveLength(2);
    const bySlug = Object.fromEntries(
      entries.map((e) => [e.community, e.overlap_fraction]),
    );
    expect(bySlug["echo-park"]).toBeCloseTo(0.4, 3);
    expect(bySlug["silver-lake"]).toBeCloseTo(0.6, 3);
    const sum = entries.reduce((acc, e) => acc + e.overlap_fraction, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  test("overlaps under the 0.01 sliver threshold are dropped and the rest renormalized", () => {
    // Community boundary at -118.0005 leaves a 0.5% sliver in "sliver-town".
    const zips = fc([zip(-118.1, 34.0, -118.0, 34.05, "91234")]);
    const communities = fc([
      community(-118.2, 33.9, -118.0005, 34.1, "main-town"),
      community(-118.0005, 33.9, -117.9, 34.1, "sliver-town"),
    ]);

    const entries = buildCrosswalkEntries(zips, communities);

    expect(entries).toEqual([
      { zip: "91234", community: "main-town", overlap_fraction: 1.0 },
    ]);
  });

  test("multiple features sharing a ZIPCODE are treated as one zip", () => {
    // Two disjoint halves of the same zip (like eGIS 90803), each wholly
    // inside a different community. Total zip area splits 50/50.
    const zips = fc([
      zip(-118.1, 34.0, -118.05, 34.05, "90803"),
      zip(-118.05, 34.0, -118.0, 34.05, "90803"),
    ]);
    const communities = fc([
      community(-118.2, 33.9, -118.05, 34.1, "long-beach"),
      community(-118.05, 33.9, -117.9, 34.1, "seal-beach"),
    ]);

    const entries = buildCrosswalkEntries(zips, communities);

    expect(entries).toHaveLength(2);
    const bySlug = Object.fromEntries(
      entries.map((e) => [e.community, e.overlap_fraction]),
    );
    expect(bySlug["long-beach"]).toBeCloseTo(0.5, 3);
    expect(bySlug["seal-beach"]).toBeCloseTo(0.5, 3);
  });

  test("zip with no community overlap produces no entries", () => {
    const zips = fc([zip(-118.1, 34.0, -118.0, 34.05, "93590")]);
    const communities = fc([community(-117.5, 33.5, -117.4, 33.6, "far-away")]);

    const entries = buildCrosswalkEntries(zips, communities);

    expect(entries).toEqual([]);
  });

  test("entries are sorted by zip then community for deterministic output", () => {
    const zips = fc([
      zip(-118.1, 34.0, -118.0, 34.05, "90002"),
      zip(-118.1, 34.05, -118.0, 34.1, "90001"),
    ]);
    const communities = fc([
      community(-118.2, 33.9, -118.05, 34.2, "b-town"),
      community(-118.05, 33.9, -117.9, 34.2, "a-town"),
    ]);

    const entries = buildCrosswalkEntries(zips, communities);

    expect(entries.map((e) => `${e.zip}:${e.community}`)).toEqual([
      "90001:a-town",
      "90001:b-town",
      "90002:a-town",
      "90002:b-town",
    ]);
  });
});
