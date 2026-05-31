# Project Status

## Current Slice

Slice 4.5 complete: Library Validation Hardening.

Next slice: Slice 5, Inspection CLI.

## Current Goal

Build the Inspection CLI on top of the hardened library validation contract.

Slice 5 should add list, show, and validate commands with human and
machine-readable output. The validate command should use the Slice 4.5
loadLibrary validation behavior rather than defining separate CLI-only rules.

## Local Environment

Use `source ~/.nvm/nvm.sh && nvm use` before running `corepack pnpm ...`
commands from non-interactive agent shells. The repo is locked to Node 24 in
`.nvmrc` and `package.json#engines`, and CI runs on Node 24.x.
