# Lifecycle Operations Extraction Design

## Context

`src/cli/commands.ts` currently owns both CLI adapter behavior and install
lifecycle orchestration. The lifecycle commands resolve install destinations,
load manifests or backup indexes, build core plans, optionally apply those
plans, and then format command output. This makes the CLI adapter the place
where lifecycle behavior grows, even though the core already owns the planning
and apply primitives.

## Goal

Extract lifecycle orchestration into a core-facing module while preserving the
current CLI contract. The CLI should continue to parse options, choose output
formats, set exit codes, and emit formatted output. The extracted module should
own the sequencing for install, uninstall, rollback, backup listing, and backup
pruning.

## Design

Create `src/core/lifecycleOperations.ts` with small async functions for the
lifecycle workflows:

- `planOrApplyInstallOperation`
- `planOrApplyUninstallOperation`
- `planOrApplyRollbackOperation`
- `listBackupGenerationsOperation`
- `planOrApplyBackupPruneOperation`

Each function accepts already-parsed primitive inputs such as `targetName`,
`scope`, `cwd`, `root`, `profileName`, `apply`, `force`, `keep`, and
`includeOrphans`. The functions return structured discriminated results that
contain the same plans, applied results, generations, and metadata the CLI
currently formats.

The module should throw existing `InstallPlanUsageError` instances for
core-level usage failures. Missing profile, unsupported target, and unsupported
renderer should move out of the CLI into this operation module because they are
part of resolving a lifecycle operation, not output formatting. Backup prune
`--keep` parsing stays in the CLI because it is option syntax validation.

## Boundaries

Do not change output shape, exit-code policy, command names, option names, or
plan/apply semantics. Do not extract validation, audit, list, show, or export in
this slice. Do not introduce a command framework or new error taxonomy.

## Testing

Existing CLI tests remain the primary regression suite. Add focused operation
tests only where they prove the new boundary directly: install dry-run/apply
branching and backup prune dry-run/apply branching. Run the full TypeScript
check and test suite after extraction.
