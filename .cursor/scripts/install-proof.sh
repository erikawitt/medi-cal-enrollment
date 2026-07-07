#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

if ! command -v bun >/dev/null 2>&1; then
  echo "[proof install] Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

echo "[proof install] Installing workspace dependencies..."
bun install

if [[ ! -f packages/proof/dist/run_dag.js ]]; then
  echo "[proof install] Building @flatbread/proof..."
  bun run proof:build
else
  echo "[proof install] @flatbread/proof already built; skipping."
fi

echo "[proof install] Proof CLI and DAG runner skill are ready."
