# Install Lifecycle Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix ThreadKit project install and uninstall lifecycle issues found during real-project skill readiness testing.

**Architecture:** Add explicit install path semantics so directory-target installs and single-file target installs are handled differently. Keep renderers focused on export layout, and make install planning responsible for mapping rendered files into the selected install destination. Preserve managed-file safety: foreign files are never overwritten unless `--force` is explicitly used.

**Tech Stack:** TypeScript, Node 24, Vitest, Commander CLI, ThreadKit core install planner.

---

## Current Findings

- Codex project install fails in projects that already have `AGENTS.md` because `paths.project` is `./AGENTS.md`, but install planning treats it as a directory and appends `AGENTS.md`, producing `AGENTS.md/AGENTS.md`.
- Claude and OpenCode project installs produce duplicated-looking paths:
  - `.claude/skills/skills/<id>/SKILL.md`
  - `.opencode/command/command/<id>.md`
- Uninstall removes managed skill files but leaves `.threadkit/install-manifest.json` and empty managed directories.
- Running uninstall again with `--prune-empty-dirs` after file deletion reports files as `missing` and plans no directory cleanup.

## Intended Behavior

- Codex project install maps rendered `codex/AGENTS.md` to project `AGENTS.md`.
- Codex dry-run with an existing unmarked `AGENTS.md` reports `skip-foreign` and exits 1 without writing.
- Codex `--force --apply` overwrites a foreign `AGENTS.md`, backs it up, and records manifest metadata.
- Codex uninstall restores/removes only ThreadKit-managed `AGENTS.md` according to current managed-file rules.
- Claude installs to `.claude/skills/<id>/SKILL.md`.
- Antigravity installs to `.agents/skills/<id>/SKILL.md`.
- OpenCode installs to `.opencode/command/<id>.md`.
- Export layout remains unchanged:
  - `claude/skills/<id>/SKILL.md`
  - `antigravity/skills/<id>/SKILL.md`
  - `opencode/command/<id>.md`
  - `codex/AGENTS.md`
- `uninstall --apply --prune-empty-dirs` removes managed files, prunes empty managed directories, and removes the install manifest when no managed files remain.

## Task 1: Add Install Path Semantics To Targets

**Files:**

- Modify: `src/core/exportTargets.ts`
- Modify: `src/core/planTypes.ts`
- Test: `test/schema.test.ts` only if TypeScript target shape affects schema expectations

**Step 1: Write the failing type-level/behavioral tests indirectly**

Do not add a pure type test. The next tasks will add behavioral CLI tests that fail until this model exists.

**Step 2: Extend target metadata**

In `src/core/exportTargets.ts`, add install mapping metadata:

```ts
export interface ExportTarget {
  name: string;
  format: string;
  distSubdir: string;
  paths?: {
    user?: string;
    project?: string;
  };
  install?: {
    stripRelPathPrefix?: string;
    kind?: "directory" | "file";
  };
}
```

Configure targets:

```ts
claude: {
  name: "claude",
  format: "skill",
  distSubdir: "claude",
  paths: {
    user: "~/.claude/skills",
    project: "./.claude/skills"
  },
  install: {
    stripRelPathPrefix: "claude/skills"
  }
},
antigravity: {
  name: "antigravity",
  format: "skill",
  distSubdir: "antigravity",
  paths: {
    user: "~/.gemini/skills",
    project: "./.agents/skills"
  },
  install: {
    stripRelPathPrefix: "antigravity/skills"
  }
},
codex: {
  name: "codex",
  format: "agents-md",
  distSubdir: "codex",
  paths: {
    project: "./AGENTS.md"
  },
  install: {
    kind: "file",
    stripRelPathPrefix: "codex"
  }
},
opencode: {
  name: "opencode",
  format: "opencode-command",
  distSubdir: "opencode",
  paths: {
    user: "~/.config/opencode/command",
    project: "./.opencode/command"
  },
  install: {
    stripRelPathPrefix: "opencode/command"
  }
}
```

Leave Gemini as a directory target with default prefix stripping for now:

```ts
gemini: {
  name: "gemini",
  format: "gemini-toml",
  distSubdir: "gemini",
  paths: {
    user: "~/.gemini/commands",
    project: "./.gemini/commands"
  },
  install: {
    stripRelPathPrefix: "gemini/commands"
  }
}
```

**Step 3: Run typecheck**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm check
```

Expected: fail until planner code consumes the new metadata without unused/typing problems, or pass if metadata is accepted immediately.

**Step 4: Commit**

Do not commit yet if behavior tests are still missing. This task is preparatory.

## Task 2: Fix Directory Install Path Mapping

**Files:**

- Modify: `src/core/buildPlans.ts`
- Modify: `src/core/applyPlans.ts` if `contentByRelPath` assumes the old prefix stripping
- Modify: `test/cli.test.ts:784-1065`
- Modify: `test/install-plan.test.ts:130-260`

**Step 1: Write failing tests for Claude and OpenCode install paths**

Update existing CLI expectations in `test/cli.test.ts`:

```ts
expect(output).toEqual({
  ok: true,
  root,
  target: "claude",
  profile: "minimal",
  scope: "project",
  baseDir: join(cwd, ".claude", "skills"),
  dryRun: true,
  files: [
    {
      path: join(cwd, ".claude", "skills", "handoff", "SKILL.md"),
      relPath: "handoff/SKILL.md",
      action: "create",
      marker: true,
      existingIsForeign: false,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
    }
  ],
  warnings: []
});
```

Update all old `.claude/skills/skills/handoff/SKILL.md` expectations to `.claude/skills/handoff/SKILL.md`.

Add or update an OpenCode CLI install test:

```ts
expect(JSON.parse(harness.stdout).files[0]).toMatchObject({
  path: join(cwd, ".opencode", "command", "handoff.md"),
  relPath: "handoff.md",
  action: "create"
});
```

**Step 2: Run focused tests and verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm vitest run test/cli.test.ts test/install-plan.test.ts
```

Expected: failures showing old nested paths.

**Step 3: Implement target-aware relpath mapping**

In `src/core/buildPlans.ts`, replace direct `stripTargetPrefix(args.target, file.relPath)` usage with helper logic that accepts target install metadata.

Add a helper near `buildPlan`:

```ts
function stripInstallPrefix(relPath: string, prefix?: string): string {
  if (!prefix) {
    return relPath;
  }

  const normalized = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return relPath.startsWith(normalized) ? relPath.slice(normalized.length) : relPath;
}
```

Then update `buildPlan` args:

```ts
export async function buildPlan(args: {
  target: string;
  profile: string;
  scope: InstallScope;
  baseDir: string;
  render: RenderResult;
  managedOnly: true;
  forceForeign?: boolean;
  stripRelPathPrefix?: string;
}): Promise<WritePlan> {
```

Use:

```ts
const relPath = stripInstallPrefix(file.relPath, args.stripRelPathPrefix ?? args.target);
```

Do not hard-code target names in `buildPlan`.

**Step 4: Pass install metadata from lifecycle operation**

In `src/core/lifecycleOperations.ts`, pass target install metadata into `buildPlan`:

```ts
const plan = await buildPlan({
  target: target.name,
  profile: args.profileName,
  scope: resolvedInstall.scope,
  baseDir: resolvedInstall.baseDir,
  render,
  managedOnly: true,
  forceForeign: args.force,
  stripRelPathPrefix: target.install?.stripRelPathPrefix
});
```

**Step 5: Update apply render lookup**

In `src/core/applyPlans.ts`, `contentByRelPath(args.plan.target, args.render)` may currently apply old target-prefix stripping. Update it to use `planned.relPath` compatible keys, or build lookup from rendered files using the same strip prefix stored on the plan.

Preferred minimal approach: add `sourceRelPath` to `PlannedFile` and manifest files only if needed. If current `contentByRelPath` can be changed to match stripped relpaths, keep the public plan smaller.

**Step 6: Run focused tests and verify pass**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm vitest run test/cli.test.ts test/install-plan.test.ts
```

Expected: pass.

## Task 3: Fix Codex Single-File Project Installs

**Files:**

- Modify: `src/core/planTypes.ts`
- Modify: `src/core/planHelpers.ts`
- Modify: `src/core/buildPlans.ts`
- Modify: `src/core/lifecycleOperations.ts`
- Modify: `src/core/applyPlans.ts`
- Modify: `test/cli.test.ts`
- Modify: `test/install-plan.test.ts`

**Step 1: Write failing Codex dry-run test for foreign AGENTS.md**

Add to `test/cli.test.ts` near install tests:

```ts
it("classifies an existing foreign codex AGENTS.md without treating it as a directory", async () => {
  const root = await makeTempRoot();
  const cwd = await makeTempRoot();
  await writeValidCustomLibrary(root);
  await writeFile(join(cwd, "AGENTS.md"), "Human instructions\n");
  const harness = makeHarness(cwd);

  await harness.program.parseAsync([
    "node",
    "threadkit",
    "install",
    "codex",
    "--profile",
    "minimal",
    "--scope",
    "project",
    "--root",
    root,
    "--format",
    "json"
  ]);

  expect(harness.stderr).toBe("");
  expect(harness.exitCode).toBe(1);
  expect(JSON.parse(harness.stdout)).toMatchObject({
    ok: true,
    target: "codex",
    baseDir: cwd,
    dryRun: true,
    files: [
      {
        path: join(cwd, "AGENTS.md"),
        relPath: "AGENTS.md",
        action: "skip-foreign",
        existingIsForeign: true
      }
    ]
  });
  expect(await readFile(join(cwd, "AGENTS.md"), "utf8")).toBe("Human instructions\n");
});
```

**Step 2: Write failing Codex apply test for managed file creation**

```ts
it("applies a codex project install to AGENTS.md", async () => {
  const root = await makeTempRoot();
  const cwd = await makeTempRoot();
  await writeValidCustomLibrary(root);
  const harness = makeHarness(cwd);

  await harness.program.parseAsync([
    "node",
    "threadkit",
    "install",
    "codex",
    "--profile",
    "minimal",
    "--scope",
    "project",
    "--apply",
    "--root",
    root,
    "--format",
    "json"
  ]);

  const output = JSON.parse(harness.stdout);
  expect(harness.stderr).toBe("");
  expect(harness.exitCode).toBe(0);
  expect(await readFile(join(cwd, "AGENTS.md"), "utf8")).toContain(
    "<!-- threadkit:generated target=codex profile=minimal -->"
  );
  expect(output).toMatchObject({
    ok: true,
    target: "codex",
    baseDir: cwd,
    dryRun: false,
    manifestPath: join(cwd, ".threadkit", "install-manifest.json"),
    files: [{ action: "create", relPath: "AGENTS.md" }]
  });
});
```

**Step 3: Write failing Codex forced overwrite/backup test**

```ts
it("applies forced codex foreign overwrites with backup metadata", async () => {
  const root = await makeTempRoot();
  const cwd = await makeTempRoot();
  await writeValidCustomLibrary(root);
  await writeFile(join(cwd, "AGENTS.md"), "Human instructions\n");
  const harness = makeHarness(cwd);

  await harness.program.parseAsync([
    "node",
    "threadkit",
    "install",
    "codex",
    "--profile",
    "minimal",
    "--scope",
    "project",
    "--apply",
    "--force",
    "--root",
    root,
    "--format",
    "json"
  ]);

  const output = JSON.parse(harness.stdout);
  expect(harness.stderr).toBe("");
  expect(harness.exitCode).toBe(0);
  expect(output.files[0]).toMatchObject({
    relPath: "AGENTS.md",
    action: "overwrite-foreign",
    backupPath: expect.stringContaining(join(".threadkit", "backups"))
  });
  expect(await readFile(output.files[0].backupPath, "utf8")).toBe("Human instructions\n");
});
```

**Step 4: Run focused tests and verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm vitest run test/cli.test.ts
```

Expected: Codex tests fail with the current `AGENTS.md/AGENTS.md` behavior.

**Step 5: Implement file-target install base resolution**

Change `ResolvedInstallBaseDir` in `src/core/planTypes.ts`:

```ts
export interface ResolvedInstallBaseDir {
  target: string;
  scope: InstallScope;
  baseDir: string;
  installKind: "directory" | "file";
}
```

In `src/core/planHelpers.ts`, resolve file target paths to the containing directory:

```ts
const resolvedPath = resolveInstallPath(pathValue, args.cwd, args.homedir ?? defaultHomedir());
const installKind = target.install?.kind ?? "directory";

return {
  target: target.name,
  scope,
  baseDir: installKind === "file" ? dirname(resolvedPath) : resolvedPath,
  installKind
};
```

Import `dirname` from `node:path`.

**Step 6: Verify Codex plan maps to AGENTS.md**

The combination of:

- `baseDir = cwd`
- `stripRelPathPrefix = "codex"`
- rendered file `codex/AGENTS.md`

should produce:

- `relPath = "AGENTS.md"`
- `path = join(cwd, "AGENTS.md")`
- `manifestPath = join(cwd, ".threadkit", "install-manifest.json")`

**Step 7: Run focused tests and verify pass**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm vitest run test/cli.test.ts test/install-plan.test.ts
```

Expected: pass.

## Task 4: Fix Uninstall Manifest And Directory Cleanup

**Files:**

- Modify: `src/core/planTypes.ts`
- Modify: `src/core/buildPlans.ts`
- Modify: `src/core/applyPlans.ts`
- Modify: `test/cli.test.ts:1140-1345`
- Modify: `test/install-plan.test.ts`

**Step 1: Write failing uninstall cleanup test**

Add to `test/cli.test.ts` after `applies uninstall directory pruning`:

```ts
it("applies uninstall pruning and removes manifest metadata when all managed files are gone", async () => {
  const root = await makeTempRoot();
  const cwd = await makeTempRoot();
  await writeValidCustomLibrary(root);
  const install = makeHarness(cwd);
  await install.program.parseAsync([
    "node",
    "threadkit",
    "install",
    "claude",
    "--profile",
    "minimal",
    "--scope",
    "project",
    "--apply",
    "--root",
    root,
    "--format",
    "json"
  ]);
  const harness = makeHarness(cwd);

  await harness.program.parseAsync([
    "node",
    "threadkit",
    "uninstall",
    "claude",
    "--scope",
    "project",
    "--apply",
    "--prune-empty-dirs",
    "--format",
    "json"
  ]);

  expect(harness.stderr).toBe("");
  expect(harness.exitCode).toBe(0);
  await expect(stat(join(cwd, ".claude", "skills", ".threadkit", "install-manifest.json"))).rejects.toThrow();
  await expect(stat(join(cwd, ".claude", "skills", ".threadkit"))).rejects.toThrow();
  await expect(stat(join(cwd, ".claude", "skills", "handoff"))).rejects.toThrow();
});
```

Also add a Codex uninstall test:

```ts
it("uninstalls managed codex AGENTS.md and removes project manifest with pruning", async () => {
  const root = await makeTempRoot();
  const cwd = await makeTempRoot();
  await writeValidCustomLibrary(root);
  const install = makeHarness(cwd);
  await install.program.parseAsync([
    "node",
    "threadkit",
    "install",
    "codex",
    "--profile",
    "minimal",
    "--scope",
    "project",
    "--apply",
    "--root",
    root,
    "--format",
    "json"
  ]);
  const harness = makeHarness(cwd);

  await harness.program.parseAsync([
    "node",
    "threadkit",
    "uninstall",
    "codex",
    "--scope",
    "project",
    "--apply",
    "--prune-empty-dirs",
    "--format",
    "json"
  ]);

  expect(harness.stderr).toBe("");
  expect(harness.exitCode).toBe(0);
  await expect(stat(join(cwd, "AGENTS.md"))).rejects.toThrow();
  await expect(stat(join(cwd, ".threadkit", "install-manifest.json"))).rejects.toThrow();
});
```

**Step 2: Run focused tests and verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm vitest run test/cli.test.ts
```

Expected: manifest files and/or directories still exist.

**Step 3: Extend plan result for manifest cleanup**

In `src/core/planTypes.ts`, add:

```ts
export interface PlannedUninstallManifest {
  path: string;
  action: "delete" | "keep";
}
```

Add to `UninstallPlan`:

```ts
manifest: PlannedUninstallManifest;
```

Add to `ApplyUninstallPlanResult`:

```ts
manifest: PlannedUninstallManifest & { deleted: boolean };
```

**Step 4: Plan manifest deletion when safe**

In `buildUninstallPlan`, after files and directories are planned:

```ts
const unsafeFileActions = files.some((file) => file.action === "skip-drifted" || file.action === "skip-foreign");
const manifestAction = args.pruneEmptyDirs === true && !unsafeFileActions ? "delete" : "keep";
```

Include:

```ts
manifest: {
  path: manifestPathForBaseDir(args.baseDir),
  action: manifestAction
}
```

Keep default uninstall conservative: manifest deletion only occurs with `--prune-empty-dirs`.

**Step 5: Apply manifest deletion before directory pruning**

In `src/core/applyPlans.ts`, update `applyUninstallPlan`:

```ts
const manifest = {
  ...args.plan.manifest,
  deleted: false
};

if (args.plan.manifest.action === "delete") {
  try {
    await unlink(args.plan.manifest.path);
    manifest.deleted = true;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") {
      throw error;
    }
  }
}
```

Make sure this happens after file deletion and before directory pruning, so `.threadkit` can become empty.

**Step 6: Improve directory pruning candidates**

Today `planUninstallDirectories` only considers ancestors of files with action `delete`. That is fine during a single uninstall apply, but it cannot clean residual empty directories after files are already missing.

Update candidate collection to include ancestors for `delete` and `missing` files when `pruneEmptyDirs` is true:

```ts
if (file.action !== "delete" && file.action !== "missing") {
  continue;
}
```

Update `emptyAfterDeletes` to treat missing files as absent:

```ts
const removableRelPaths = new Set(
  args.files
    .filter((file) => file.action === "delete" || file.action === "missing")
    .map((file) => file.relPath)
);
```

Also include `.threadkit` as a pruning candidate when manifest action is `delete`, but do not recurse into backup directories unless backup pruning owns them.

**Step 7: Run focused tests and verify pass**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm vitest run test/cli.test.ts test/install-plan.test.ts
```

Expected: pass.

## Task 5: Update Output Formatting For New Uninstall Manifest Field

**Files:**

- Modify: `src/cli/output.ts`
- Modify: `test/cli.test.ts`

**Step 1: Update JSON output expectations**

Where uninstall JSON currently expects:

```ts
directories: [],
warnings: []
```

add:

```ts
manifest: {
  path: join(cwd, ".claude", "skills", ".threadkit", "install-manifest.json"),
  action: "keep"
}
```

For pruning applies, expect:

```ts
manifest: {
  path: join(cwd, ".claude", "skills", ".threadkit", "install-manifest.json"),
  action: "delete",
  deleted: true
}
```

**Step 2: Keep text output readable**

In `src/cli/output.ts`, include manifest actions only when not `keep`:

```ts
if (plan.manifest.action === "delete") {
  rows.push(`delete\t${plan.manifest.path}\n`);
}
```

For applied output:

```ts
if (applied.manifest.action === "delete") {
  rows.push(`${applied.manifest.deleted ? "deleted" : "missing"}\t${applied.manifest.path}\n`);
}
```

**Step 3: Run CLI tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm vitest run test/cli.test.ts
```

Expected: pass.

## Task 6: Real-Project Regression Smoke

**Files:**

- No source changes expected
- Update: `docs/skill-reviews/debugging-loop-2026-06-06.md` only if adding a note that cleanup items were resolved
- Optional create: `docs/skill-reviews/install-lifecycle-2026-06-06.md`

**Step 1: Build CLI**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm build
```

Expected: pass.

**Step 2: Dry-run Codex install in `bolt-voice-prompter`**

Run:

```bash
node /Users/matt/Workspace/active/threadkit/dist/cli/index.js install codex \
  --root /Users/matt/Workspace/active/threadkit \
  --profile minimal \
  --scope project \
  --format json
```

from:

```bash
/Users/matt/Workspace/labs/bolt-voice-prompter
```

Expected:

- Exit 1 because `AGENTS.md` is foreign.
- No `ENOTDIR`.
- File path is `/Users/matt/Workspace/labs/bolt-voice-prompter/AGENTS.md`.
- Action is `skip-foreign`.

**Step 3: Do not apply Codex in the real project unless explicitly approved**

This is a smoke test. Do not use `--force --apply` in the lab repo unless the user specifically asks.

**Step 4: Dry-run non-Codex installs**

Run dry-runs for Claude, Antigravity, and OpenCode in the lab repo.

Expected paths:

- `.claude/skills/debugging-loop/SKILL.md`
- `.agents/skills/debugging-loop/SKILL.md`
- `.opencode/command/debugging-loop.md`

No duplicated `skills/skills` or `command/command`.

## Task 7: Full Verification

**Files:**

- No source changes expected

**Step 1: Run complete verification**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && corepack pnpm check
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test
node dist/cli/index.js validate
node dist/cli/index.js audit --strict
```

Expected:

- Typecheck passes.
- 15 Vitest files pass.
- 223 or more tests pass, depending on new tests added.
- Validate passes.
- Strict audit passes.

**Step 2: Review diff**

Run:

```bash
git diff --stat
git diff -- src/core test docs/plans
```

Expected:

- Changes are scoped to install metadata, install/uninstall planning/apply logic, CLI output, tests, and this plan.
- No skill body changes unless documenting resolved follow-ups.

**Step 3: Commit**

Commit once tests pass:

```bash
git add src/core src/cli test docs/plans
git commit -m "Harden project install lifecycle"
```

## Open Questions

- Should default uninstall delete its manifest when all files are removed, or should that remain tied to `--prune-empty-dirs`? This plan chooses the conservative `--prune-empty-dirs` behavior.
- Should backup indexes and backup directories be pruned by uninstall, or only by existing backup prune commands? This plan leaves backups to backup pruning.
- Should Codex support merging into an existing foreign `AGENTS.md` instead of treating it as overwrite-only? This plan preserves current managed-file safety semantics: skip unless `--force`.

## Execution Options

Plan complete and saved to `docs/plans/2026-06-06-install-lifecycle-hardening.md`.

1. **Subagent-Driven (this session)** - use `superpowers:subagent-driven-development`, dispatch fresh subagent per task, review between tasks.
2. **Parallel Session (separate)** - open a new session in this branch with `superpowers:executing-plans`, batch execution with checkpoints.
