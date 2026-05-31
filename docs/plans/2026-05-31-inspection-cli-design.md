# Inspection CLI Design

## Goal

Build Slice 5 by adding the first operational CLI commands for inspecting and
validating a threadkit library:

- `threadkit list`
- `threadkit show <skill-id>`
- `threadkit validate`

These commands should support both human-readable terminal output and stable
machine-readable JSON output through `--format json`.

## Context

Slice 4.5 hardened `loadLibrary` so it is the canonical structural validation
boundary for loaded libraries. Slice 5 should reuse that behavior directly
rather than creating CLI-only validation rules.

The current CLI entry point, `src/cli/index.ts`, only creates the base Commander
program. The implementation should keep that file thin and move command behavior
into small CLI helpers so command output, exit codes, and error normalization are
testable without spawning a separate process.

## Recommended Approach

Use thin Commander wiring backed by command handlers and output helpers.

`createProgram()` should register the public commands and configure output
capture cleanly for tests. Command handlers should call `loadLibrary`, shape the
command result, render either text or JSON, and set the intended exit code.

This keeps the Slice 5 surface small while leaving room for later `audit`,
`export`, `install`, and `uninstall` commands to reuse the same output protocol.

## Root And Canonical Validation

All commands default `--root` to `process.cwd()`.

`validate` should call:

```ts
loadLibrary(root, { canonical })
```

Canonical validation should be enabled only when all of these are true:

- `--root` was omitted.
- The effective root is `process.cwd()`.
- The root appears to be the threadkit repository root.

For Slice 5, "appears to be the threadkit repository root" can be a pragmatic
local check: the directory contains `package.json`, `skills/`, and `profiles/`.

Custom `--root` values should use non-canonical validation. This lets fixture and
external libraries validate structurally without requiring the bundled canonical
skill set or complete canonical target flags.

Do not add a public `--canonical` flag in Slice 5. It is useful later, but the
current requirement is to define the default behavior.

## Output Protocol

`--format json` should produce parseable single-object JSON and avoid extra text.
The stable Slice 5 shapes are:

```ts
type CliError = {
  code: string;
  message: string;
};

type ValidateJson = {
  ok: boolean;
  root: string;
  errors: CliError[];
  warnings: [];
};

type ListJson = {
  ok: true;
  root: string;
  skills: Array<{
    id: string;
    name: string;
    summary: string;
    profiles: string[];
    status: string;
  }>;
};

type ShowJson = {
  ok: true;
  root: string;
  skill: {
    id: string;
    name: string;
    version: string;
    status: string;
    summary: string;
    category: string;
    triggers: string[];
    profiles: string[];
    targets: Record<string, { enabled: boolean } | undefined>;
    safety: {
      allow_shell_commands: boolean;
      allow_network: boolean;
      allow_file_writes: boolean;
      includes_scripts: boolean;
    };
    tags: string[];
    body: string;
  };
};
```

Human output should be compact and stable:

- `list`: one skill per line with id, name, and summary.
- `show`: useful metadata followed by the body.
- `validate`: a success line on pass; clear error lines on failure.

Rich terminal tables, colors, pagination, and quiet/verbose behavior are out of
scope for Slice 5.

## Error Handling And Exit Codes

Use the v3 plan exit code contract:

- `0`: success.
- `1`: operational or structural validation failure.
- `2`: usage fault.

Validation errors thrown by `loadLibrary` should be normalized to:

```json
{ "code": "validation-error", "message": "..." }
```

Unknown skill ids in `show <skill-id>` should be treated as usage faults and
normalized to:

```json
{ "code": "unknown-skill", "message": "Skill '<id>' was not found." }
```

Commander syntax errors and unknown flags can use Commander defaults for this
slice as long as command-level tests cover the expected behavior for implemented
commands.

## Testing Strategy

Use TDD with vertical CLI behavior slices.

Start with the smallest tracer bullet: `threadkit validate --format json`
returns a success envelope for the repository root. Then add tests for:

- `validate --format json --root <temp>` success against a non-canonical custom
  library.
- `validate --format json --root <temp>` failure normalizes loader errors and
  sets exit code `1`.
- `list --format json` returns deterministic skill summaries.
- `show <skill-id> --format json` returns the requested skill.
- `show <missing-id> --format json` returns an unknown-skill usage fault and
  exit code `2`.
- Human output smoke tests for `validate`, `list`, and `show`.

Tests should exercise `createProgram()` directly with captured output and should
avoid process spawning unless a later slice needs full binary integration tests.
