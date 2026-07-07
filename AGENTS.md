# AGENTS.md

## Cursor Cloud specific instructions

This is a **Bun** monorepo (workspaces under `src/*`): `web` (Vite + React + MapLibre choropleth), `data-pipeline` (scrape → normalize → derive → validate), and `shared` (types only). Standard commands live in the root `package.json` and each workspace `package.json`; see `README.md` for the pipeline overview.

- **Runtime:** Bun is the package manager and runner (there is a `bun.lock`, no `node_modules` committed). The update script runs `bun install`; do not use npm/pnpm/yarn.
- **Run the web app:** `bun run web` (Vite dev server on `http://localhost:5173/`). A dev-only Vite middleware (`serveRepoData` in `src/web/vite.config.ts`) serves the committed `data/` directory at `/data`, so the app reads the same JSON the production bundle copies in — no pipeline run is required to view the map, because `data/derived/map/*.json` and `data/boundaries/*.geojson` are committed.
- **Tests:** `cd src/data-pipeline && bun test` (also `bun run --filter @medi-cal-disenrollment/data-pipeline test`). These are the only automated tests; they are offline and read committed raw captures.
- **Typecheck + build:** `cd src/web && bun run build` runs `tsc --noEmit` then `vite build`. There is no separate lint step; typecheck is the lint gate. The >500 kB chunk-size warning at the end of the build is expected/benign.
- **Data pipeline gotcha:** `bun run normalize|derive|validate` operate on committed data and run offline. `bun run scrape` is the only step that needs network + Playwright browsers (`bunx playwright install chromium`); it is not required for local dev or for running the app.
