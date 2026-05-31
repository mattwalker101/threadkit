# Project Status

## Current Slice

Slice 6 complete: Markdown Export Boundary.

Next slice: expand renderer and target coverage beyond the initial markdown
export tracer bullet.

## Current Goal

Build broader renderer and target coverage on top of the Slice 6 export
boundary.

Slice 6 added `threadkit export markdown --profile <name>` with optional
`--root`, `--out`, and `--format json` flags. The markdown renderer is pure and
returns file specs, while filesystem writes happen in the shared export writer.
The default output root is `dist/`, producing
`dist/markdown/<profile>.md`.

## Local Environment

Use `source ~/.nvm/nvm.sh && nvm use` before running `corepack pnpm ...`
commands from non-interactive agent shells. The repo is locked to Node 24 in
`.nvmrc` and `package.json#engines`, and CI runs on Node 24.x.
