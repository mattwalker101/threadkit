# Project Status

## Current Slice

Slice 7 complete: Export Target Expansion.

Next slice: continue renderer coverage beyond the shared `skill` format, likely
the Codex `agents-md` renderer and target.

## Current Goal

Build additional pure renderers on top of the expanded target routing boundary.

Slice 7 added renderer routing by target format and shared `skill` exports for
`claude` and `antigravity`. Exports remain staged-only under `dist/` or `--out`;
install safety, manifests, backups, pruning, and foreign-file detection remain
out of scope.

## Local Environment

Use `source ~/.nvm/nvm.sh && nvm use` before running `corepack pnpm ...`
commands from non-interactive agent shells. The repo is locked to Node 24 in
`.nvmrc` and `package.json#engines`, and CI runs on Node 24.x.
