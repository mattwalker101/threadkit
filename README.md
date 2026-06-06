# threadkit

The thread that ties your agentic skills together.

`threadkit` is a file-first, portable skill library and exporter for AI coding CLIs.
It stores, validates, renders, and optionally installs skills. It does not execute
skills or orchestrate agents.

When a skill includes optional `assets/` or `scripts/` directories, ThreadKit
copies regular files from those payload directories into exported target output.
Payload files are treated as managed files during install, uninstall, rollback,
and backup planning. Missing directories, empty directories, and symlinks are
ignored.

## Commands

All commands default to dry-run (plan-only) unless `--apply` is specified. Use
`--format json` on any command for machine-readable output.

### Library

```
threadkit list [--root <path>]                   List skills in a library
threadkit show <skill-id> [--root <path>]        Show a skill body
threadkit validate [--root <path>]               Validate a library
threadkit audit [--root <path>] [--strict]       Quality warnings; --strict exits 1 on warnings
threadkit export <target> --profile <name>       Export a profile to --out (default: dist/)
```

Audit warnings for script and asset payloads indicate payloads that will be
copied for enabled export targets, and script payloads should be reflected in
`safety.includes_scripts`.

### Install lifecycle

```
threadkit install <target> --profile <name> [--scope user|project] [--force] [--apply]
```

Plans (or applies) a profile install. Without `--apply`, prints the per-file action plan.
`--force` overwrites foreign (unmanaged) files. Backs up any overwritten files to
`<baseDir>/.threadkit/backups/<generation-id>/`.

```
threadkit uninstall <target> [--scope user|project] [--prune-empty-dirs] [--apply]
```

Removes only ThreadKit-managed files that match the install manifest hash. Skips
drifted or foreign files.

```
threadkit rollback <target> [--scope user|project] [--force] [--apply]
threadkit rollback <target> --generation <id>   [--scope user|project] [--force] [--apply]
```

Restores backed-up files. Without `--generation`, restores from the latest install
manifest. With `--generation <id>`, restores from a named indexed backup generation
(use `threadkit backups list` to find IDs). `--force` restores over drifted managed files.

### Backup history

```
threadkit backups list <target> [--scope user|project] [--format json]
```

Lists indexed backup generations for a target, newest first. Each row:
`<id>  <installedAt>  <profile>  <backupDir>`

```
threadkit backups prune <target> [--scope user|project] [--keep <n>] [--orphans] [--apply]
```

Dry-runs (or applies) pruning of old backup generations. Keeps the `--keep` newest
(default 10). Only deletes directories confirmed to be inside
`<baseDir>/.threadkit/backups/`. Updates the backup index after indexed
generation deletion.

Pass `--orphans` to also scan direct child directories of
`<baseDir>/.threadkit/backups/` that are not referenced by the backup index.
Orphans are reported in dry-run output and deleted only with `--apply`; orphan
deletion does not update the backup index.

## Development

Use the repository Node version before running pnpm commands. The project is
locked to Node 24 via `.nvmrc` and `package.json#engines`; using newer Node
versions can produce engine warnings and drift from CI.

```bash
source ~/.nvm/nvm.sh
nvm install
nvm use
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm test
```

If your interactive shell already loads nvm, the `source ~/.nvm/nvm.sh` line is
optional. Non-interactive agent shells should include it before `nvm use`.
