# Project Status

## Current Slice

Slice 5 complete: Inspection CLI.

Next slice: Slice 6, Export Pipeline.

## Current Goal

Build the export pipeline for the first target formats on top of the loaded and
validated library model.

Slice 5 added `threadkit list`, `threadkit show <skill-id>`, and
`threadkit validate` with human-readable output and `--format json` envelopes.
The validate command uses the Slice 4.5 `loadLibrary` validation behavior and
runs canonical validation only for the default repository root.

## Local Environment

Use `source ~/.nvm/nvm.sh && nvm use` before running `corepack pnpm ...`
commands from non-interactive agent shells. The repo is locked to Node 24 in
`.nvmrc` and `package.json#engines`, and CI runs on Node 24.x.
