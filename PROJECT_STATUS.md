# Project Status

## Current Slice

Slice 9 planned: Manifest-Based Uninstall.

This slice stacks on PR 17's install apply work. It reads
`.threadkit/install-manifest.json` and removes only unchanged ThreadKit-managed
files from the selected target/scope.

## Current Goal

Add safe uninstall planning and application without rollback, backup restore,
directory pruning, or forceful deletion.

The safety invariant remains: ThreadKit must not mutate unmarked foreign files.
Uninstall also skips drifted generated files whose current hash no longer
matches the manifest.

## Known gaps (intentionally deferred)

Orphan backup directories — directories written to `<baseDir>/.threadkit/backups/`
during a failed install before the index is updated — are not detected or cleaned up.
They must be removed manually.

## Local Environment

Use `source ~/.nvm/nvm.sh && nvm use` before running `corepack pnpm ...`
commands from non-interactive agent shells. The repo is locked to Node 24 in
`.nvmrc` and `package.json#engines`, and CI runs on Node 24.x.
