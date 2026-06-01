# Manifest-Based Uninstall Design

## Context

PR 17 adds the first safe install mutation path: `threadkit install <target>
--profile <profile> --apply` writes generated files, backs up overwritten
files, and records the result in `<baseDir>/.threadkit/install-manifest.json`.
That PR is still draft, so this slice should stack on `codex/install-apply`
rather than start from `main`.

The next mutation should preserve the core safety invariant: ThreadKit must not
modify or delete unmarked foreign files unless the user explicitly asks for a
forceful operation. This slice should not introduce forceful uninstall behavior.

## Alternatives

### Recommended: Manifest-Based Uninstall

Add `threadkit uninstall <target> --scope <scope> --apply`, driven only by the
latest install manifest. The planner reads manifest entries, inspects the
current filesystem, and only plans deletion for files that still match the
manifest hash and still contain a ThreadKit marker. Drifted files and foreign
files are skipped.

This is the best next slice because it consumes the manifest introduced in PR
17, keeps rollback and pruning out of scope, and gives users a reversible-feeling
cleanup command without restoring old content or deleting directories.

### Rollback From Backups

Use manifest backup paths to restore overwritten files. This is valuable, but it
has more edge cases: missing backups, multiple installs, partial restores, and
interactions with files edited after install. It should come after uninstall has
established manifest loading and drift checks.

### Install Hardening

Improve install application semantics before adding a new command, for example
atomic writes or manifest schema validation. This is lower product value than
uninstall and does not prove the manifest can drive a second workflow.

## Selected Design

Build manifest-based uninstall as a stacked slice on `codex/install-apply`.
The command shape is:

```sh
threadkit uninstall <target> --scope <user|project> [--apply] [--format json]
```

The command resolves the same install base directory as `install`, reads
`<baseDir>/.threadkit/install-manifest.json`, validates that it belongs to the
requested target and scope, and produces a dry-run plan by default. The profile
comes from the manifest, not a CLI option.

Uninstall actions:

- `delete`: file exists, has a ThreadKit marker, and its current sha256 equals
  the manifest sha256.
- `skip-drifted`: file exists but its sha256 differs from the manifest.
- `skip-foreign`: file exists without a ThreadKit marker.
- `missing`: manifest entry no longer exists on disk.

`--apply` deletes only `delete` files. It never deletes `skip-drifted`,
`skip-foreign`, or `missing` entries, and it never restores backups. The manifest
is left in place in this slice, with an uninstall result object reporting what
was deleted and skipped.

## Error Handling

Missing manifest is a usage-level error with a stable code such as
`missing-install-manifest`.

Target or scope mismatch between the requested uninstall destination and the
manifest is a usage-level error. Base directory mismatch should also be rejected
after path normalization so an old manifest cannot be applied to a different
destination.

Malformed manifest JSON or entries missing required fields should fail before
any writes.

## Testing

Core tests should cover manifest loading, action classification, apply deletion,
and safety skips for drifted and foreign files. CLI tests should cover JSON and
text dry-run output, missing manifest errors, target/scope mismatch, and apply
behavior.

Full verification remains:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test
source ~/.nvm/nvm.sh && nvm use && corepack pnpm check
source ~/.nvm/nvm.sh && nvm use && corepack pnpm build
```
