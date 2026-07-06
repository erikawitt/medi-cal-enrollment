# Raw captures must be self-contained: captions + index tuples + referenced dictionary entries

Supersedes the capture *layout* half of ADR 0002 (the decision to capture the VizQL presModel
JSON, and everything about why, stands).

## The defect

The first-generation extractor (`extractRawCapture`, format now retired) committed only the
`dataSegments` value pools of each area's `tabdoc/select` response — the raw numbers, without the
per-worksheet `paneColumnsData` index tuples that ADR 0002 said would accompany them. That made
the committed files **unreconstructable in general**:

- Tableau's data dictionary is **session-cumulative**: a select response ships only the values not
  already served earlier in that embed session, and its index tuples (which were being discarded)
  reference the concatenated session dictionary. A value that repeats an earlier one (very common
  for small-geography counts — zip-level cells collide constantly) simply never appears in the
  area's own file.
- Without the tuples there is no faithful mapping from pool position to (worksheet, row, column).
  Constraint-based alignment (exact-sum verification of age/ethnicity/citizenship runs against
  program totals) was prototyped during phase 3 and recovered Medi-Cal `persons_total` for ~95% of
  areas but full age breakdowns for only ~16-35% of zips — and anything less than exact recovery
  risks silently misassigning figures about children's healthcare.

Root cause: the select-response tuples live under
`zones.<id>.presModelHolder.visual.vizData.paneColumnsData`, not under the `presModelMap` key the
extractor searched, so the extractor silently kept only the pools.

## Decision

A raw capture is one **self-contained** JSON per (report month, geography), `formatVersion: 2`:

```jsonc
{
  "formatVersion": 2,
  "worksheets": {              // every data-bearing worksheet, keyed by Tableau's name
    "Persons by Med-Cal": {    // captions + index tuples exactly as served
      "vizDataColumns": [{ "fieldCaption": "SUM(TNUM1)", "dataType": "real", ... }],
      "paneColumnsList": [{ "vizPaneColumns": [{ "valueIndices": [...], "aliasIndices": [...] }] }]
    }, ...
  },
  "dataDictionary": {          // sparse: exactly the entries the tuples reference,
    "real": { "461": 664193, ... },   // at their original session-dictionary indices
    "cstring": { "8": "Medi-Cal", ... }
  }
}
```

- The scraper maintains the session dictionary (all `dataSegments` of every VizQL response in the
  session, concatenated in segment-key order) and, per area, stores the slice of it that the
  area's worksheets reference. Cross-response dedup therefore no longer loses values.
- `paneColumnsData` is trimmed to captions + tuples (`fieldCaption`, `userFriendlyFieldCaption`,
  `dataType`, `paneIndices`, `columnIndices`, `valueIndices`, `aliasIndices`) — the remainder of
  the served structure is rendering geometry with no data content (same rationale as ADR 0002's
  "compact extract"). Values, captions, and formatted strings stay verbatim; ~45 KB/area.
- `_base.json` is retired: with self-contained files there is no shared layout to hoard, and the
  sub-area domain lives in the month manifest.
- Capture validity = the headline `Persons by Med-Cal` / `Persons by CaFresh` worksheets
  reconstruct to a number (replaces the old "≥10 real values" heuristic, which misjudged sparse
  areas).

## Why this is still a *raw* capture

Identical reasoning to ADR 0002: no header renaming, no number parsing, no program selection, no
metric naming. The capture is a lossless slice of what Tableau served, reorganized only so that
each file stands alone. All meaning-making stays in phase 3's normalize step.

## Consequences

- **All first-generation captures are invalidated** (report months 2026-01 … 2026-05, all five
  geography levels). They are deleted in one commit — git history preserves them — and report
  months are recaptured from the live embed with the v2 scraper. Per the single-month development
  focus, 2026-01 is recaptured immediately; the other months re-run post-phase-5 with one
  idempotent `bun run scrape` (v1 files parse as not-captured, so the scraper recaptures them).
- Phase 3's normalize reads each area file in isolation (`reconstructWorksheet`); no session
  replay, no capture-order sensitivity, no constraint-solver reconstruction logic.
- Reconstruction is pinned in tests against the May 2026 countywide reference values from the
  DPSS dashboard, via fixtures generated from real captured VizQL bodies.
