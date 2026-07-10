# Phase 5 design brief — "Instrument panel" direction

Design and UX direction for the Phase 5 web app. All UI work must follow this
brief. Language rules from `CONTEXT.md` apply to every string of UI copy:
**community** (never "neighborhood"), **disenrollment trend** (never
"disenrollments"), **marginal breakdown** (never "cross-tab").

## Concept

A fullscreen cartographic instrument, not a dashboard. The map is the page;
every control floats above it as a thin, technical overlay. Monochromatic:
one vivid hue carries all data encoding; everything else is near-white,
ink, and hairlines. The aesthetic register is survey plat / flight
instrument: dense, precise, quiet.

## Scope decisions (resolved with the user — do not relitigate)

- **Five boundary layers**: Community (default), SPA, Congressional District,
  State Assembly District, State Senate District. **No zip layer in the UI**
  (zip data still exists in derived files; simply unexposed).
- **Program toggle**: Medi-Cal / CalFresh segmented control. **CalFresh is
  rendered but disabled** (derived map files are Medi-Cal only until the
  pipeline exposes CalFresh). Disabled state carries the title/tooltip text
  "CalFresh map data not yet published by this pipeline".
- **Metric toggle**: "Enrollment 0–5" (`age_0_5`) and "MoM change"
  (`age_0_5_mom_pct`, the disenrollment-trend view).
- **Time slider**: over the derived file's `months` array, defaults to
  latest. Currently a single month exists; the control must render sanely
  with one stop and grow as months accrue.
- **Selection model**: hover previews (tooltip + details pane track the
  cursor); **click pins** a feature (details pane locks; hover still moves
  the tooltip only). Unpin via: clicking the pinned feature again, Esc, a
  close affordance in the pane, or clicking empty map.
- **Tooltip**: geography name, ages 0–5 enrolled, and total enrolled (both
  lines), plus the active report month.
- **Hue slider**: a small floating dev control for palette exploration (see
  Palette engine). Default hue = vivid red-orange.

## Palette — monochromatic OKLCH, P3, light UI

Single source of truth: a `--hue` CSS custom property on `:root` (default
**`32`**, vivid red-orange). Every color derives from it. UI colors are
authored as `oklch()` directly in CSS (P3-capable displays get P3):

```css
:root {
  --hue: 32;
  --bg:        oklch(0.985 0.004 var(--hue));  /* page / empty states  */
  --surface:   oklch(0.995 0.002 var(--hue) / 0.88); /* panels, +backdrop-blur */
  --ink:       oklch(0.24 0.02 var(--hue));    /* primary text          */
  --ink-2:     oklch(0.48 0.03 var(--hue));    /* secondary text        */
  --accent:    oklch(0.62 0.24 var(--hue));    /* THE palette anchor    */
  --hairline:  oklch(0.24 0.03 var(--hue) / 0.16);
  --hairline-strong: oklch(0.24 0.04 var(--hue) / 0.38);
}
```

**Choropleth ramp** (6 sequential stops, constant hue, computed in JS from
the same hue value using `culori`, gamut-clamped to sRGB for the MapLibre
canvas — the WebGL canvas is sRGB; only DOM UI gets true P3):

| stop | L     | C     |
|------|-------|-------|
| 0    | 0.97  | 0.015 |
| 1    | 0.89  | 0.06  |
| 2    | 0.80  | 0.11  |
| 3    | 0.70  | 0.17  |
| 4    | 0.585 | 0.22  |
| 5    | 0.47  | 0.24  |

- **Enrollment view**: quantile breaks over the active layer's non-null
  `age_0_5` values for the active month, mapped onto stops 0→5 (dark =
  more enrolled).
- **MoM change view** (monochromatic constraint — no second hue): decline
  severity maps onto stops 1→5 (deeper = steeper decline); zero-or-growth
  renders as a neutral `oklch(0.96 0 0)`. The legend must label this
  explicitly ("no decline / growth" as the neutral swatch). With a single
  committed month all deltas are null: show a centered empty-state note
  ("Change requires two report months — one is published so far.") and
  render features in the neutral tone.
- Missing data (feature with no cell for the month): `oklch(0.93 0 0)`
  with a hatched feel via lower fill opacity (0.35); tooltip says "not
  published".

**Palette engine + hue slider (dev tool)**: a compact floating control
(bottom-right), label `PALETTE`, a 0–360 range input driving `--hue` and
the JS ramp live, a readout of the anchor string (e.g. `oklch(0.62 0.24 32)`)
and a copy button. This is a temporary exploration tool: keep it isolated
in one component so it can be deleted cleanly later.

## Typography

- **Space Mono only**, self-hosted via `@fontsource/space-mono` (regular
  400, bold 700, italic 400). No runtime font CDN — the app makes no
  network requests beyond same-origin assets and OpenFreeMap tiles.
- Scale: 11px base UI, 10px micro-labels, 13px pane headings, 20px+ only
  for the big number in the details pane.
- Micro-labels (section headers, control group titles): uppercase,
  `letter-spacing: 0.08em`, `--ink-2`.
- Numbers: use `Intl.NumberFormat("en-US")`; percent deltas signed
  (`−4.2%`, true minus U+2212). Months render as `JAN 2026`.

## Surfaces and chrome

- Corners sharp: `border-radius: 0` everywhere.
- Panels: `--surface` + `backdrop-filter: blur(8px)` + 1px `--hairline-strong`
  border. No drop shadows heavier than `0 1px 0 var(--hairline)`.
- Hairline dividers between control groups; 4px spacing grid (padding in
  multiples of 4, typically 8/12).
- Interactive states: hover = background `oklch(0.24 0.02 var(--hue) / 0.05)`;
  active/selected = 2px inset left border in `--accent` + bold text. Focus
  visible: 1px solid `--accent` outline, offset 1.
- One decorative flourish allowed: a small crosshair "+" glyph in panel
  corners or the app wordmark block. Nothing else ornamental.

## Layout (fullscreen map, floating overlays)

```
┌──────────────────────────────────────────────────────────┐
│ [details pane]                        [controls cluster] │
│  inset left,                           top-right:        │
│  top-left,                             ─ wordmark row +  │
│  320px wide,                             ABOUT trigger   │
│  max-height ~80vh                      ─ program toggle  │
│                                        ─ layer radios    │
│                                                          │
│                                        [palette dev tool]│
│ [legend]        [metric toggle · time slider]  bottom-rt │
│  bottom-left     bottom-center                           │
└──────────────────────────────────────────────────────────┘
```

- **Controls cluster (top-right)**: one panel, three stacked groups
  separated by hairlines. Header row: app wordmark ("MEDI-CAL / 0–5
  TRACKER" style block) inline with the `ABOUT` trigger (text button).
  Then the program segmented control (MEDI-CAL active, CALFRESH disabled).
  Then the layer radio list — exactly one active; Community default. The
  Community row carries a one-line footnote with the la-geography citation
  link (`https://github.com/stiles/la-geography`) — required copy.
- **About modal**: centered overlay, `min(560px, 90vw)`, dimmed backdrop
  `oklch(0.24 0.02 var(--hue) / 0.35)`. Dismiss: ✕ button, Esc, backdrop
  click. Content is a **placeholder** ("About content forthcoming") plus
  the section skeleton it will eventually hold (data source, cadence,
  la-geography citation, honesty notes) as headings — the user will supply
  final copy later. Focus-trapped; restores focus to trigger on close.
- **Tooltip**: anchored to cursor (offset 12,12; flips near right/bottom
  edges), pointer-events none. Contents: name (bold), `AGES 0–5 · <n>`,
  `ALL AGES · <n>`, `MoM CHANGE · <signed count> (<signed %>)` (or
  "no prior month"), month micro-label. Spell the abbreviation **MoM**
  (never all-caps "MOM") even inside uppercase micro-label chrome.
- **Details pane (inset left)**: floating panel. States: empty (hint text
  "Hover a region — click to pin"), hover-tracking, pinned (shows a `PINNED`
  chip + ✕). Contents top to bottom:
  1. Geography name; for communities the `type` rendered honestly
     ("Long Beach — standalone city") plus `region`.
  2. Big number: ages 0–5 enrolled for the active month; beneath it total
     enrolled, and MoM delta/pct when non-null.
  3. Trend strip: diverging month-over-month delta ticks for
     `age_0_5_mom_delta` across the latest 12 report months (or fewer if
     less data), centered on a zero baseline
     (growth up in muted ink, decline down colored with ramp stops 1→5 by
     local-max magnitude — not the map's layer-wide quantile breaks;
     flat/null on the baseline). Label: "MoM change · Ages 0–5".
     Hovering a column shows the same cursor-anchored map tooltip (name,
     ages 0–5, all ages, MoM change, that column's report month).
  4. Ethnicity marginal breakdown — horizontal bars in `--accent`, counts
     right-aligned.
  5. Citizenship marginal breakdown — same treatment.
  6. Honesty notes (10px, `--ink-2`): always — "Ethnicity and citizenship
     describe this geography's entire Medi-Cal population, not ages 0–5.";
     for communities additionally — "Community figures are estimates
     apportioned from zip-level data by area-weighted overlap."
- **Legend (bottom-left)**: swatch row with break labels; in change view
  includes the neutral "no decline / growth" swatch. Title = active metric.
- **Bottom-center strip**: metric segmented toggle + time slider (month
  tick labels; disabled appearance when only one month).

## Map treatment

- Basemap: OpenFreeMap **light/positron-style**, style JSON pinned in the
  repo; desaturate/quiet it if needed so the mono ramp dominates. Labels
  above choropleth fills, roads below.
- Fill opacity 0.78; feature borders 0.75px `oklch(1 0 0 / 0.5)`.
- Hover: feature outline 1.5px `--ink`. Pinned: outline 2.5px `--accent`.
  Use MapLibre feature-state, not layer re-filtering.
- Initial view: LA County framed with the details pane inset accounted for
  (`fitBounds` with left padding ≈ 360px).
- The `unknown` geo_id has no geometry — skip silently in joins.
- Cursor: pointer over features, default crosshair on empty map is welcome.

## Motion

Minimal and fast: 120ms ease-out opacity/transform for tooltip and panel
appearance; 200ms for the modal. No springs, no slides longer than 8px.
Respect `prefers-reduced-motion` (disable transforms, keep opacity).

## Accessibility

- All controls keyboard-operable; radios/segments are real inputs or
  ARIA-correct equivalents; modal focus-trapped with `aria-modal`.
- Contrast: `--ink` on `--bg` well above 7:1; never set text in the accent
  below stop-4 darkness on light surfaces.
- The map is supplementary to the data panes; tooltip content is mirrored
  by the details pane, which is real DOM text.
