---
name: "Phase 4: Monthly cron GitHub Action"
overview: Wire the phase 1 scraper and phase 3 normalize/derive/validate scripts into a GitHub Actions workflow that checks for new DPSS report months a few times early each month, and opens a data PR (never pushes to main) with validation running as a required CI check on that PR.
todos:
  - id: cron-workflow
    content: "Build .github/workflows/data-update.yml: cron + workflow_dispatch, scrape -> normalize -> derive -> open PR"
    status: completed
  - id: pr-summary
    content: Generate PR description from the validation report (totals, deltas, CHHS check, row counts)
    status: completed
  - id: validate-ci
    content: "Build .github/workflows/validate-data.yml: required check on PRs touching data/"
    status: completed
  - id: no-op-path
    content: Ensure no-new-month runs exit cleanly without commits, PRs, or failures
    status: completed
  - id: docs
    content: Document required repo settings (branch protection, Actions PR permission) in the workflow file header
    status: completed
---

# Phase 4: Monthly cron GitHub Action

> **Read `CONTEXT.md` at the repo root first** and use its language (report month, raw capture, tidy data, derived file).

## Goal

When this phase is done: a scheduled GitHub Actions workflow checks whether DPSS has published a new report month, and if so scrapes it, normalizes/derives, and opens a pull request containing the new `data/` files with an auto-generated summary; a second workflow runs the validation script as a **required status check** on any PR touching `data/`. Nothing is ever pushed directly to `main` by automation. A human merges the PR; merging is what makes new data live (the phase 5 site deploys from `main`).

## Context (self-contained)

### What you're orchestrating (built by earlier phases — read their plan files for details)

All commands run in `src/data-pipeline/` (Bun workspace; install with `bun install` at repo root):

- `bun run scrape` (phase 1) — Playwright + headless Chromium against the DPSS Tableau embed (`https://myappse.dpss.lacounty.gov/pls/apexprod/f?p=AAGT:AAGT`). Idempotent: skips report months already captured under `data/raw/`; captures any newly-published months. Requires Playwright browsers installed (`bunx playwright install --with-deps chromium`).
- `bun run normalize` and `bun run derive` (phase 3) — offline transforms: `data/raw/` → `data/tidy/{month}.json` → `data/derived/map/{geo_type}.json`.
- `bun run validate` (phase 3) — cross-checks countywide totals against the CHHS open-data API, runs internal consistency and swing checks; non-zero exit on failure; machine-readable report on stdout.

### Timing realities

- DPSS publishes with roughly a **one-month lag** and on an unknown day of the month. Decided schedule: run on the **1st, 5th, and 10th of each month** (e.g. `cron: "0 14 1,5,10 * *"` — mid-morning Pacific), each run checking for new months and doing nothing if none. Also expose `workflow_dispatch` for manual runs.
- Report months age out of the DPSS dropdown on an unknown schedule — a missed month may become unrecoverable, which is why three attempts per month and loud failure alerts matter.

### Decided policies (do not relitigate)

- **PR, not direct push** — the scraper is the fragile end of the system (anonymous Tableau embed, UI-dependent extraction); a subtle extraction corruption could pass the coarse CHHS check. Twelve human reviews a year is cheap; bad data live on a public map about children's healthcare is not.
- **Validation as a required CI check on the PR** — the merge gate is the status check itself, not trust in the cron job that opened the PR.

## Contract

**Consumes**: the `src/data-pipeline/` scripts above; repo write access for the Actions token.

**Produces**:

```
.github/workflows/data-update.yml      # cron + manual dispatch: scrape, transform, open PR
.github/workflows/validate-data.yml    # PR check: runs bun run validate on PRs touching data/**
```

`data-update.yml` behavior:

1. Checkout, setup Bun, `bun install`, install Playwright Chromium.
2. `bun run scrape`. If no new report month was captured (detect via git status on `data/raw/`), log and exit 0 — no commit, no PR, no failure.
3. `bun run normalize && bun run derive`.
4. `bun run validate`. On failure: **do not open a PR**; fail the job loudly (failed-workflow notification is the alert channel).
5. Create branch `data/{YYYY-MM}` (the new report month), commit only `data/**` changes, open a PR titled `Data: {Month YYYY} report month`.
6. PR description generated from the validation report: new month(s) captured; countywide Medi-Cal `persons_total` and `age_0_5` vs prior month (absolute + %); CHHS cross-check result; per-geo-type row counts; any warnings (swing detections, crosswalk-missing zips); extraction method used (from the raw manifest).
7. Concurrency guard (`concurrency: data-update`) so overlapping runs can't race; if a `data/{month}` branch/PR already exists, update it rather than duplicating.

`validate-data.yml` behavior: triggers on `pull_request` paths `data/**`; runs `bun run validate` (and a types/parse check of derived files); intended to be marked as a required status check.

Alerting: rely on GitHub's failed-workflow notifications; no external alerting service.

## Decision gates

- **Gate A — PR creation mechanism**: `gh pr create` with the built-in `GITHUB_TOKEN` (requires "Allow GitHub Actions to create and approve pull requests" in repo settings) vs `peter-evans/create-pull-request`. Either is fine; pick one, record it, and document the required repo setting in the workflow header comment.
- **Gate B — CI runtime cost**: if the scrape step (potentially 30-90+ min at zip granularity, per phase 1's findings) approaches GitHub's 6-hour job limit or is flaky in CI, record mitigations chosen (job timeout ~120 min, retry-on-dispatch guidance).

### Decision log (fill in — part of the deliverable)

- **Gate A:** `gh pr create` / `gh pr edit` with the built-in `GITHUB_TOKEN`. Requires repo setting **Settings → Actions → General → Workflow permissions → "Allow GitHub Actions to create and approve pull requests"**. Documented in `.github/workflows/data-update.yml` header.
- **Gate B:** `timeout-minutes: 120` on the scrape job; `concurrency: data-update` with `cancel-in-progress: false` so overlapping scheduled runs don't clobber an in-flight scrape. If a scheduled run fails or times out, re-run manually via **workflow_dispatch** (documented in workflow header). Zip-level scrape may take 30–90+ min; 120 min is a hard ceiling with manual retry as the mitigation.

## Acceptance criteria

- A `workflow_dispatch` run with no new upstream month completes green with no commits and no PR.
- A run that captures a new month opens exactly one PR containing only `data/**` changes, with the summary description populated from the validation report.
- The validate workflow triggers on a hand-made PR that edits a `data/tidy/` file, and fails if a countywide total is corrupted (test by deliberately mangling a value on a scratch branch).
- Validation failure in the cron path produces a failed workflow run and no PR.
- Repo-settings prerequisites (branch protection on `main` with the validate check required; Actions PR-creation permission) are documented in a header comment in `data-update.yml`.
- No workflow step ever pushes to `main`.

## Out of scope

- **Building or modifying** the scraper/normalize/derive/validate scripts themselves (phases 1 and 3) — orchestration only. If a script's interface doesn't fit (e.g. no machine-readable validate output), fix it minimally and note it in the relevant phase's plan file.
- **Crosswalk regeneration** (phase 2's artifact is static — the cron never touches it).
- **Site deployment** — phase 5 owns the Pages deploy workflow; this phase's PRs merging to `main` is the handoff point.
- **External alerting/monitoring services.**
