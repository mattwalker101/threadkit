# Repowise Health Refactor Pause

**Date:** 2026-06-07

**Goal:** Reduce the refactoring targets surfaced by jcodemunch/repowise health checks while preserving ThreadKit install lifecycle behavior.

## Current Status

Work is paused with uncommitted changes on `main`.

Modified files:

- `src/core/applyPlans.ts`
- `src/core/buildPlans.ts`
- `test/install-plan.test.ts`

Completed slices:

1. Added characterization coverage for nested uninstall directory pruning.
2. Refactored `src/core/applyPlans.ts` into same-file private helpers.
3. Refactored `src/core/buildPlans.ts` into same-file private helpers.

Next slice:

4. Refactor `src/cli/index.ts` so `createProgram` is mostly command registration over smaller command descriptor helpers.

## What Changed

### `test/install-plan.test.ts`

Added a characterization test for nested uninstall directory pruning:

- A deleted nested managed file should prune `skills/handoff/nested`.
- It should also prune `skills/handoff`.
- It should not prune `skills` when `skills/shared/notes.md` remains.
- It should still plan `.threadkit` pruning when the manifest is removable.

### `src/core/applyPlans.ts`

No public API changes.

Extracted private helpers for:

- uninstall file application
- uninstall manifest deletion
- uninstall directory pruning
- rollback backup resolution
- rollback apply-time action selection
- per-file rollback application
- backup-prune generation/orphan application
- install backup generation id selection
- per-file install application
- install manifest construction
- backup-index generation writing

Observed jcodemunch risk after this slice:

- `applyUninstallPlan`: cyclomatic complexity 26 -> 5
- `applyRollbackPlan`: 21 -> 2
- `applyInstallPlan`: 12 -> 3
- `applyBackupPrunePlan`: 11 -> 4

### `src/core/buildPlans.ts`

No public API changes.

Extracted private helpers for:

- removable uninstall paths
- candidate uninstall directories
- safe directory-entry reads
- empty-after-delete checks
- per-render-file install planning
- per-manifest-file uninstall planning
- uninstall manifest action selection
- rollback backup status
- rollback current-state action selection
- per-manifest-file rollback planning

The jcodemunch refresh for this file could not be run because the tool call hit the session usage limit. Verify health again when usage is available.

## Verification

Last successful commands:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm check
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test
git diff --check
```

Last observed results:

- TypeScript check passed.
- Vitest passed: 15 test files, 231 tests.
- `git diff --check` passed.

## Current Git State

At pause time:

- Branch: `main`
- Worktree: `/Users/matt/Workspace/active/threadkit`
- Extra worktrees: none
- Local branches: only `main`
- Uncommitted changes: yes

Recommended before resuming:

```bash
git status --short --branch
source ~/.nvm/nvm.sh && nvm use && corepack pnpm check && corepack pnpm test
```

Recommended before integrating:

```bash
git switch -c refactor/repowise-health-slices
git add src/core/applyPlans.ts src/core/buildPlans.ts test/install-plan.test.ts docs/plans/2026-06-07-repowise-health-refactor-pause.md
git commit -m "refactor: reduce install lifecycle planning complexity"
```

## Open Items

- Re-run jcodemunch `index_file` / `get_file_risk` for `src/core/buildPlans.ts` after tool usage resets.
- Re-run repo health/hotspots after indexing.
- Continue with `src/cli/index.ts::createProgram`.
- Then consider `src/cli/commands.ts`, `src/core/auditLibrary.ts`, and `src/core/planHelpers.ts` in that order.

## Suggested Skills

- `superpowers:test-driven-development` for each refactor slice.
- `superpowers:verification-before-completion` before claiming completion.
- `handoff` if pausing again.

## Next Action

Start with `src/cli/index.ts::createProgram`. Keep the same conservative pattern used so far: preserve the public CLI behavior, extract same-file helpers first, run `test/cli.test.ts`, then run full `check` and `test`.
