# Project Status

## Current Slice

Slice 4 complete: Core Skill Seeding.

Next slice: Slice 4.5, Library Validation Hardening.

## Current Goal

Insert validation hardening before the Inspection CLI slice so malformed
libraries fail consistently before list, show, and validate commands are built.

Slice 4.5 should cover empty skill bodies, profile reverse-index drift,
canonical target flag completeness, and exact canonical skill directory checks.

## Local Environment

Use `source ~/.nvm/nvm.sh && nvm use` before running `corepack pnpm ...`
commands from non-interactive agent shells. The repo is locked to Node 24 in
`.nvmrc` and `package.json#engines`, and CI runs on Node 24.x.
