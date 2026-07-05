# Phase-1 spike scripts (throwaway, kept for auditability)

These one-off scripts reverse-engineered the DPSS At-A-Glance Tableau embed to
resolve the phase-1 decision gates (see `docs/plans/phase-1-scraper.md`). They are
**not** part of the shipped pipeline (`../src/`) and are excluded from typecheck.
They talk to the live site and write scratch output to `out/` (git-ignored).

Roughly in order of discovery:

- `01`–`04` — load the embed, probe the Embedding JS API and the crosstab export
  dialog (Gate A groundwork, Gate B: export fails).
- `05`–`07` — establish that table values are canvas-painted (not DOM text) and
  that the VizQL `bootstrapSession` carries the real values in a `dataDictionary`.
- `08`–`13` — reverse-engineer geography control: the Administrative Area /
  Sub Administrative Area filter-action worksheets and their `tabdoc/select`
  commands (Gates A, C, D).
- `14`–`22` — work out the presModel reconstruction (dictionary segments +
  `paneColumnsData` index tuples) and validate against the May 2026 reference
  values, including age 0-5.
- `23`–`31` — build up and calibrate the actual embed driver (month dropdown,
  sub-area enumeration, click geometry) that became `../src/embed.ts`.
- `32`–`33` — diagnose backfill failures: month re-selection flake, and the
  sub-area checkbox semantics (list loads all-Checked; **Unchecking** a mark is
  what focuses the view on that area — see the plan's Decision log).

The shipped, tested code lives in `../src/vizql.ts`, `../src/embed.ts`,
`../src/capture.ts`, and `../src/scrape.ts`.
