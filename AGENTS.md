# Agent skills

## Proof (DAG task runner)

This repo vendors [Flatbread Proof](https://github.com/FlatbreadLabs/flatbread/tree/main/packages/proof) (`@flatbread/proof`) for decomposing work into dependency graphs and running Cursor SDK subagents in parallel.

- **Skill:** `.cursor/skills/proof/SKILL.md` (also mirrored at `.agents/skills/proof/SKILL.md`)
- **Package:** `packages/proof`
- **Build:** `bun run proof:build` (runs automatically in cloud agent `install` via `.cursor/scripts/install-proof.sh`)
- **Run a DAG:** `bun run proof --dag <path> --canvas-path <path>`
- **Init canvas only:** `bun run proof --init-only --dag <path> --canvas-path <path>`
- **Secrets:** set `CURSOR_API_KEY` in the cloud agent environment before running full DAGs

Legacy `dag-task-runner` skill name redirects to `proof` at `.cursor/skills/dag-task-runner/SKILL.md`.
