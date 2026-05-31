# Inspection CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build Slice 5 by adding `threadkit list`, `threadkit show <skill-id>`, and `threadkit validate` with human and JSON output.

**Architecture:** Keep `src/cli/index.ts` as thin Commander wiring. Add a small CLI command layer that loads libraries through `loadLibrary`, normalizes command results, renders human or JSON output, and sets stable exit codes. Validation behavior must delegate to the Slice 4.5 loader contract.

**Tech Stack:** TypeScript ESM, Commander 14, existing core loaders, Node `path`/`fs` utilities, Vitest.

---

## Slice 5 Acceptance Criteria

- `threadkit validate` validates the effective library root through `loadLibrary`.
- `threadkit validate --format json` emits `{ ok, root, errors, warnings }`.
- `threadkit list` displays loaded skills deterministically.
- `threadkit list --format json` emits stable skill summary objects.
- `threadkit show <skill-id>` displays a single loaded skill.
- `threadkit show <skill-id> --format json` emits a stable skill object including `body`.
- `threadkit show <missing-id> --format json` emits a usage fault and exits `2`.
- Validation failures exit `1`.
- Success exits `0`.
- `validate` runs canonical validation only for the default repository root.
- Custom `--root` values validate structurally without canonical bundled-skill checks.
- `corepack pnpm check`, `corepack pnpm test`, and `corepack pnpm build` pass under Node 24.

## Implementation Notes

Run commands from `/Users/matt/Workspace/active/threadkit`.

Use this prefix from non-interactive shells:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm ...
```

Do not duplicate structural validation rules in CLI code. The CLI should call
`loadLibrary(root, { canonical })` and normalize thrown errors for output.

The default root is `process.cwd()`. For Slice 5, canonical validation is true
only when `--root` is omitted and `process.cwd()` appears to be the threadkit
repo root by containing `package.json`, `skills/`, and `profiles/`.

## Proposed CLI Internals

Create `src/cli/commands.ts` with small exported helpers:

```ts
export type OutputFormat = "text" | "json";

export interface CommandContext {
  cwd: string;
  write: (value: string) => void;
  writeError: (value: string) => void;
  setExitCode: (code: number) => void;
}

export interface RootOptions {
  root?: string;
  format?: string;
}

export async function runValidate(options: RootOptions, context: CommandContext): Promise<void>;
export async function runList(options: RootOptions, context: CommandContext): Promise<void>;
export async function runShow(skillId: string, options: RootOptions, context: CommandContext): Promise<void>;
```

`createProgram()` should build the default `CommandContext` using `process.cwd`,
`process.stdout.write`, `process.stderr.write`, and `process.exitCode`.

In tests, pass a custom context so assertions can inspect stdout, stderr, and
exit code without spawning a process.

## Task 1: Add CLI Test Harness And Validate JSON Success

**Files:**
- Modify: `test/cli.test.ts`
- Modify: `src/cli/index.ts`
- Create: `src/cli/commands.ts`

**Step 1: Write the failing test**

Replace or extend `test/cli.test.ts` with a harness that captures output:

```ts
import { describe, expect, it } from "vitest";
import { createProgram } from "../src/cli/index.js";

function makeHarness() {
  let stdout = "";
  let stderr = "";
  let exitCode: number | undefined;

  const program = createProgram({
    cwd: process.cwd(),
    write: (value) => {
      stdout += value;
    },
    writeError: (value) => {
      stderr += value;
    },
    setExitCode: (code) => {
      exitCode = code;
    }
  });

  program.exitOverride();
  program.configureOutput({
    writeOut: (value) => {
      stdout += value;
    },
    writeErr: (value) => {
      stderr += value;
    }
  });

  return {
    program,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    get exitCode() {
      return exitCode;
    }
  };
}

describe("threadkit CLI", () => {
  it("exposes the program name and version", () => {
    const { program } = makeHarness();

    expect(program.name()).toBe("threadkit");
    expect(program.version()).toBe("0.1.0");
  });

  it("validates the repository library as JSON", async () => {
    const harness = makeHarness();

    await harness.program.parseAsync(["node", "threadkit", "validate", "--format", "json"]);

    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(0);
    expect(JSON.parse(harness.stdout)).toMatchObject({
      ok: true,
      root: process.cwd(),
      errors: [],
      warnings: []
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/cli.test.ts
```

Expected: FAIL because `createProgram` does not accept a context and `validate`
is not registered.

**Step 3: Implement minimal command context and validate handler**

In `src/cli/commands.ts`:

```ts
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadLibrary } from "../core/index.js";

export type OutputFormat = "text" | "json";

export interface CommandContext {
  cwd: string;
  write: (value: string) => void;
  writeError: (value: string) => void;
  setExitCode: (code: number) => void;
}

export interface RootOptions {
  root?: string;
  format?: string;
}

interface CliError {
  code: string;
  message: string;
}

function getFormat(format: string | undefined): OutputFormat {
  return format === "json" ? "json" : "text";
}

function getRoot(options: RootOptions, context: CommandContext): string {
  return resolve(context.cwd, options.root ?? ".");
}

function isDefaultRepoRoot(root: string, options: RootOptions, context: CommandContext): boolean {
  if (options.root !== undefined || root !== resolve(context.cwd)) {
    return false;
  }

  return (
    existsSync(resolve(root, "package.json")) &&
    existsSync(resolve(root, "skills")) &&
    existsSync(resolve(root, "profiles"))
  );
}

function normalizeError(error: unknown): CliError {
  return {
    code: "validation-error",
    message: error instanceof Error ? error.message : String(error)
  };
}

function writeJson(context: CommandContext, value: unknown): void {
  context.write(`${JSON.stringify(value, null, 2)}\n`);
}

export async function runValidate(options: RootOptions, context: CommandContext): Promise<void> {
  const root = getRoot(options, context);
  const format = getFormat(options.format);

  try {
    await loadLibrary(root, { canonical: isDefaultRepoRoot(root, options, context) });
    context.setExitCode(0);

    if (format === "json") {
      writeJson(context, { ok: true, root, errors: [], warnings: [] });
      return;
    }

    context.write(`Library is valid: ${root}\n`);
  } catch (error) {
    const normalized = normalizeError(error);
    context.setExitCode(1);

    if (format === "json") {
      writeJson(context, { ok: false, root, errors: [normalized], warnings: [] });
      return;
    }

    context.writeError(`Validation failed: ${normalized.message}\n`);
  }
}
```

In `src/cli/index.ts`, change `createProgram` to accept an optional context and
register `validate`:

```ts
import { runValidate, type CommandContext } from "./commands.js";

export function createProgram(context: CommandContext = {
  cwd: process.cwd(),
  write: (value) => process.stdout.write(value),
  writeError: (value) => process.stderr.write(value),
  setExitCode: (code) => {
    process.exitCode = code;
  }
}): Command {
  // existing setup

  program
    .command("validate")
    .description("Validate a threadkit library.")
    .option("--root <path>", "Source library root.")
    .option("--format <format>", "Output format: text or json.")
    .action((options) => runValidate(options, context));

  return program;
}
```

**Step 4: Run test to verify it passes**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/cli.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/cli/index.ts src/cli/commands.ts test/cli.test.ts
git commit -m "feat: add validate json command"
```

## Task 2: Add Validate Failure And Custom Root Behavior

**Files:**
- Modify: `test/cli.test.ts`
- Modify: `src/cli/commands.ts`

**Step 1: Write the failing tests**

Add temp-library helpers to `test/cli.test.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
```

Add helper fixtures:

```ts
async function makeTempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "threadkit-cli-"));
}

const validSkillYml = `id: handoff
name: Handoff
version: 0.1.0
status: draft
summary: Creates a handoff document.
category: coordination
triggers:
  - create a handoff
  - write a handoff document
profiles:
  - minimal
targets:
  markdown:
    enabled: true
safety:
  allow_shell_commands: false
  allow_network: false
  allow_file_writes: true
  includes_scripts: false
tags: []
`;

const validProfileYml = `name: minimal
description: Smallest useful baseline.
skills:
  - handoff
`;

async function writeValidCustomLibrary(root: string): Promise<void> {
  await mkdir(join(root, "skills", "handoff"), { recursive: true });
  await mkdir(join(root, "profiles"), { recursive: true });
  await writeFile(join(root, "skills", "handoff", "skill.yml"), validSkillYml);
  await writeFile(join(root, "skills", "handoff", "body.md"), "# Handoff\n");
  await writeFile(join(root, "profiles", "minimal.yml"), validProfileYml);
}
```

Add tests:

```ts
it("validates a custom root without canonical bundled-skill checks", async () => {
  const root = await makeTempRoot();
  await writeValidCustomLibrary(root);
  const harness = makeHarness();

  await harness.program.parseAsync(["node", "threadkit", "validate", "--root", root, "--format", "json"]);

  expect(harness.exitCode).toBe(0);
  expect(JSON.parse(harness.stdout)).toMatchObject({
    ok: true,
    root,
    errors: [],
    warnings: []
  });
});

it("reports validation failures as JSON and exits 1", async () => {
  const root = await makeTempRoot();
  await writeValidCustomLibrary(root);
  await writeFile(join(root, "skills", "handoff", "body.md"), " \n");
  const harness = makeHarness();

  await harness.program.parseAsync(["node", "threadkit", "validate", "--root", root, "--format", "json"]);

  expect(harness.stderr).toBe("");
  expect(harness.exitCode).toBe(1);
  expect(JSON.parse(harness.stdout)).toMatchObject({
    ok: false,
    root,
    errors: [
      {
        code: "validation-error",
        message: "Skill 'handoff' has an empty body.md."
      }
    ],
    warnings: []
  });
});
```

**Step 2: Run tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/cli.test.ts
```

Expected: PASS if Task 1 already implemented root and failure handling. If it
fails, adjust only the minimal root resolution or error normalization needed.

**Step 3: Run type check**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm check
```

Expected: PASS.

**Step 4: Commit**

```bash
git add src/cli/commands.ts test/cli.test.ts
git commit -m "test: cover validate root behavior"
```

## Task 3: Add `list --format json`

**Files:**
- Modify: `test/cli.test.ts`
- Modify: `src/cli/commands.ts`
- Modify: `src/cli/index.ts`

**Step 1: Write the failing test**

Add:

```ts
it("lists skill summaries as JSON", async () => {
  const root = await makeTempRoot();
  await writeValidCustomLibrary(root);
  const harness = makeHarness();

  await harness.program.parseAsync(["node", "threadkit", "list", "--root", root, "--format", "json"]);

  expect(harness.stderr).toBe("");
  expect(harness.exitCode).toBe(0);
  expect(JSON.parse(harness.stdout)).toEqual({
    ok: true,
    root,
    skills: [
      {
        id: "handoff",
        name: "Handoff",
        summary: "Creates a handoff document.",
        profiles: ["minimal"],
        status: "draft"
      }
    ]
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/cli.test.ts
```

Expected: FAIL because `list` is unknown.

**Step 3: Implement `runList`**

In `src/cli/commands.ts`:

```ts
export async function runList(options: RootOptions, context: CommandContext): Promise<void> {
  const root = getRoot(options, context);
  const format = getFormat(options.format);

  try {
    const library = await loadLibrary(root);
    context.setExitCode(0);

    const skills = library.skills.map((skill) => ({
      id: skill.id,
      name: skill.metadata.name,
      summary: skill.metadata.summary,
      profiles: skill.metadata.profiles,
      status: skill.metadata.status
    }));

    if (format === "json") {
      writeJson(context, { ok: true, root, skills });
      return;
    }

    for (const skill of skills) {
      context.write(`${skill.id}\t${skill.name}\t${skill.summary}\n`);
    }
  } catch (error) {
    const normalized = normalizeError(error);
    context.setExitCode(1);

    if (format === "json") {
      writeJson(context, { ok: false, root, errors: [normalized], warnings: [] });
      return;
    }

    context.writeError(`List failed: ${normalized.message}\n`);
  }
}
```

Register it in `src/cli/index.ts`:

```ts
import { runList, runValidate, type CommandContext } from "./commands.js";

program
  .command("list")
  .description("List skills in a threadkit library.")
  .option("--root <path>", "Source library root.")
  .option("--format <format>", "Output format: text or json.")
  .action((options) => runList(options, context));
```

**Step 4: Run test to verify it passes**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/cli.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/cli/index.ts src/cli/commands.ts test/cli.test.ts
git commit -m "feat: add list json command"
```

## Task 4: Add `show <skill-id> --format json`

**Files:**
- Modify: `test/cli.test.ts`
- Modify: `src/cli/commands.ts`
- Modify: `src/cli/index.ts`

**Step 1: Write the failing test**

Add:

```ts
it("shows a skill as JSON", async () => {
  const root = await makeTempRoot();
  await writeValidCustomLibrary(root);
  const harness = makeHarness();

  await harness.program.parseAsync(["node", "threadkit", "show", "handoff", "--root", root, "--format", "json"]);

  expect(harness.stderr).toBe("");
  expect(harness.exitCode).toBe(0);
  expect(JSON.parse(harness.stdout)).toMatchObject({
    ok: true,
    root,
    skill: {
      id: "handoff",
      name: "Handoff",
      version: "0.1.0",
      status: "draft",
      summary: "Creates a handoff document.",
      category: "coordination",
      triggers: ["create a handoff", "write a handoff document"],
      profiles: ["minimal"],
      targets: {
        markdown: { enabled: true }
      },
      safety: {
        allow_shell_commands: false,
        allow_network: false,
        allow_file_writes: true,
        includes_scripts: false
      },
      tags: [],
      body: "# Handoff\n"
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/cli.test.ts
```

Expected: FAIL because `show` is unknown.

**Step 3: Implement `runShow` success behavior**

In `src/cli/commands.ts`:

```ts
function toSkillJson(skill: LoadedSkill) {
  return {
    id: skill.id,
    name: skill.metadata.name,
    version: skill.metadata.version,
    status: skill.metadata.status,
    summary: skill.metadata.summary,
    category: skill.metadata.category,
    triggers: skill.metadata.triggers,
    profiles: skill.metadata.profiles,
    targets: skill.metadata.targets,
    safety: skill.metadata.safety,
    tags: skill.metadata.tags,
    body: skill.body
  };
}

export async function runShow(
  skillId: string,
  options: RootOptions,
  context: CommandContext
): Promise<void> {
  const root = getRoot(options, context);
  const format = getFormat(options.format);

  try {
    const library = await loadLibrary(root);
    const skill = library.skills.find((candidate) => candidate.id === skillId);

    if (!skill) {
      // Unknown-skill behavior is added in Task 5.
      throw new Error(`Skill '${skillId}' was not found.`);
    }

    context.setExitCode(0);

    if (format === "json") {
      writeJson(context, { ok: true, root, skill: toSkillJson(skill) });
      return;
    }

    context.write(`${skill.metadata.name} (${skill.id})\n\n${skill.body}`);
  } catch (error) {
    const normalized = normalizeError(error);
    context.setExitCode(1);

    if (format === "json") {
      writeJson(context, { ok: false, root, errors: [normalized], warnings: [] });
      return;
    }

    context.writeError(`Show failed: ${normalized.message}\n`);
  }
}
```

Import `LoadedSkill`:

```ts
import { loadLibrary, type LoadedSkill } from "../core/index.js";
```

Register it in `src/cli/index.ts`:

```ts
import { runList, runShow, runValidate, type CommandContext } from "./commands.js";

program
  .command("show")
  .description("Show a skill from a threadkit library.")
  .argument("<skill-id>", "Skill id.")
  .option("--root <path>", "Source library root.")
  .option("--format <format>", "Output format: text or json.")
  .action((skillId, options) => runShow(skillId, options, context));
```

**Step 4: Run test to verify it passes**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/cli.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/cli/index.ts src/cli/commands.ts test/cli.test.ts
git commit -m "feat: add show json command"
```

## Task 5: Add Unknown Skill Usage Fault

**Files:**
- Modify: `test/cli.test.ts`
- Modify: `src/cli/commands.ts`

**Step 1: Write the failing test**

Add:

```ts
it("reports a missing skill as a JSON usage fault", async () => {
  const root = await makeTempRoot();
  await writeValidCustomLibrary(root);
  const harness = makeHarness();

  await harness.program.parseAsync(["node", "threadkit", "show", "missing-skill", "--root", root, "--format", "json"]);

  expect(harness.stderr).toBe("");
  expect(harness.exitCode).toBe(2);
  expect(JSON.parse(harness.stdout)).toEqual({
    ok: false,
    root,
    errors: [
      {
        code: "unknown-skill",
        message: "Skill 'missing-skill' was not found."
      }
    ],
    warnings: []
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/cli.test.ts
```

Expected: FAIL because missing skills currently use `validation-error` and exit
`1`.

**Step 3: Implement usage fault handling**

In `src/cli/commands.ts`, add:

```ts
class CliUsageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function normalizeError(error: unknown): CliError {
  if (error instanceof CliUsageError) {
    return {
      code: error.code,
      message: error.message
    };
  }

  return {
    code: "validation-error",
    message: error instanceof Error ? error.message : String(error)
  };
}
```

In `runShow`, replace the missing-skill throw:

```ts
throw new CliUsageError("unknown-skill", `Skill '${skillId}' was not found.`);
```

In the `runShow` catch block:

```ts
const isUsageError = error instanceof CliUsageError;
context.setExitCode(isUsageError ? 2 : 1);
```

**Step 4: Run test to verify it passes**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/cli.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/cli/commands.ts test/cli.test.ts
git commit -m "feat: report missing skills as usage faults"
```

## Task 6: Add Human Output Smoke Tests

**Files:**
- Modify: `test/cli.test.ts`
- Modify: `src/cli/commands.ts`

**Step 1: Write tests for human output**

Add:

```ts
it("validates with human-readable output", async () => {
  const root = await makeTempRoot();
  await writeValidCustomLibrary(root);
  const harness = makeHarness();

  await harness.program.parseAsync(["node", "threadkit", "validate", "--root", root]);

  expect(harness.stderr).toBe("");
  expect(harness.exitCode).toBe(0);
  expect(harness.stdout).toBe(`Library is valid: ${root}\n`);
});

it("lists skills with human-readable output", async () => {
  const root = await makeTempRoot();
  await writeValidCustomLibrary(root);
  const harness = makeHarness();

  await harness.program.parseAsync(["node", "threadkit", "list", "--root", root]);

  expect(harness.stderr).toBe("");
  expect(harness.exitCode).toBe(0);
  expect(harness.stdout).toBe("handoff\tHandoff\tCreates a handoff document.\n");
});

it("shows a skill with human-readable output", async () => {
  const root = await makeTempRoot();
  await writeValidCustomLibrary(root);
  const harness = makeHarness();

  await harness.program.parseAsync(["node", "threadkit", "show", "handoff", "--root", root]);

  expect(harness.stderr).toBe("");
  expect(harness.exitCode).toBe(0);
  expect(harness.stdout).toBe("Handoff (handoff)\n\n# Handoff\n");
});
```

**Step 2: Run tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/cli.test.ts
```

Expected: PASS if previous tasks already implemented the proposed human output.
If a test fails, adjust only the minimal text formatting needed.

**Step 3: Commit**

```bash
git add src/cli/commands.ts test/cli.test.ts
git commit -m "test: cover inspection cli text output"
```

## Task 7: Validate Full Project And Update Status

**Files:**
- Modify: `PROJECT_STATUS.md`

**Step 1: Run full verification**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test
source ~/.nvm/nvm.sh && nvm use && corepack pnpm check
source ~/.nvm/nvm.sh && nvm use && corepack pnpm build
```

Expected: all pass.

**Step 2: Update project status**

Update `PROJECT_STATUS.md`:

```md
## Current Slice

Slice 5 complete: Inspection CLI.

Next slice: Slice 6, Export Pipeline.

## Current Goal

Build the export pipeline for the first target formats on top of the loaded and
validated library model.
```

Also mention that Slice 5 added `list`, `show`, and `validate` with JSON output
and default-repo canonical validation.

**Step 3: Commit**

```bash
git add PROJECT_STATUS.md
git commit -m "docs: update status after inspection cli"
```

## Final Verification

Run one final clean check:

```bash
git status --short
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test
source ~/.nvm/nvm.sh && nvm use && corepack pnpm check
source ~/.nvm/nvm.sh && nvm use && corepack pnpm build
```

Expected:

- `git status --short` is clean.
- All pnpm commands pass.

## Execution Options

Plan complete and saved to `docs/plans/2026-05-31-inspection-cli.md`.

1. **Subagent-Driven (this session)** - Dispatch a fresh subagent per task,
   review between tasks, and iterate quickly.
2. **Parallel Session (separate)** - Open a new session with
   `superpowers:executing-plans` and execute the plan with checkpoints.
