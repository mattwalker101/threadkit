# Project Status

## Current Slice

Install lifecycle hardening is merged through PR 31.

The CLI now supports safe install, manifest-based uninstall, rollback from the
latest manifest or a named backup generation, backup generation listing, and
backup pruning, including opt-in orphan backup cleanup. The most recent slice
added a core lifecycle operations boundary so `src/cli/commands.ts` stays as
the CLI adapter for formatting, exit codes, and emission.

## Current Goal

Keep install lifecycle behavior safe and dry-run-first while continuing to
sharpen the core seams behind the CLI adapter.

The safety invariant remains: ThreadKit must not mutate unmarked foreign files.
Uninstall skips drifted generated files whose current hash no longer matches the
manifest. Rollback restores only from backup paths proven to be inside
`<baseDir>/.threadkit/backups/`, with force rollback limited to drifted managed
files.

## Local Environment

Use `source ~/.nvm/nvm.sh && nvm use` before running `corepack pnpm ...`
commands from non-interactive agent shells. The repo is locked to Node 24 in
`.nvmrc` and `package.json#engines`, and CI runs on Node 24.x.
