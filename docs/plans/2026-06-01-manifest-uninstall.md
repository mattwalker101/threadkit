# Manifest-Based Uninstall Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a safe `threadkit uninstall` command that reads the install manifest from PR 17 and deletes only unchanged ThreadKit-managed files.

**Architecture:** Stack this work on `codex/install-apply`. Add manifest reader and uninstall planning/apply functions beside the install planner, reuse base directory resolution, and keep the CLI dry-run-first like `install`. The uninstall path must never delete drifted files or unmarked foreign files.

**Tech Stack:** TypeScript, Node `fs/promises`, Commander, Vitest, existing ThreadKit core/CLI modules.

---

## Safety Rules

- Delete only files listed in `<baseDir>/.threadkit/install-manifest.json`.
- Delete only when current file content has a `threadkit:generated` marker and sha256 equals the manifest sha256.
- Treat any hash mismatch as `skip-drifted`.
- Treat any missing marker as `skip-foreign`.
- Do not restore backups in this slice.
- Do not prune directories in this slice.
- Do not remove the install manifest in this slice.
- Do not add `--force` to uninstall in this slice.

## Task 1: Add Core Uninstall Types And Manifest Loading Tests

**Files:**
- Modify: `test/install-plan.test.ts`
- Modify: `src/core/installPlan.ts`
- Verify exports through: `src/core/index.ts`

**Step 1: Write failing tests for manifest loading**

In `test/install-plan.test.ts`, extend the core imports:

```ts
import {
  applyInstallPlan,
  buildPlan,
  buildUninstallPlan,
  loadInstallManifest,
  resolveInstallBaseDir,
  type InstallScope
} from "../src/core/index.js";
```

Add a helper near the existing helpers:

```ts
async function writeManifest(baseDir: string, manifest: unknown): Promise<string> {
  const manifestPath = join(baseDir, ".threadkit", "install-manifest.json");
  await mkdir(join(baseDir, ".threadkit"), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}
```

Add tests:

```ts
describe("install manifest loading", () => {
  it("loads a valid install manifest from the base directory", async () => {
    const baseDir = await makeTempRoot();
    await writeManifest(baseDir, {
      target: "claude",
      profile: "minimal",
      scope: "user",
      baseDir,
      installedAt: "2026-06-01T10-00-00-000Z",
      files: [
        {
          path: join(baseDir, "skills", "handoff", "SKILL.md"),
          relPath: "skills/handoff/SKILL.md",
          action: "create",
          sha256: "a".repeat(64),
          marker: true,
          existingIsForeign: false
        }
      ]
    });

    await expect(loadInstallManifest({ baseDir })).resolves.toMatchObject({
      target: "claude",
      profile: "minimal",
      scope: "user",
      baseDir,
      files: [{ relPath: "skills/handoff/SKILL.md", sha256: "a".repeat(64) }]
    });
  });

  it("reports a usage error when the install manifest is missing", async () => {
    const baseDir = await makeTempRoot();

    await expect(loadInstallManifest({ baseDir })).rejects.toMatchObject({
      code: "missing-install-manifest"
    });
  });
});
```

**Step 2: Run focused test to verify failure**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/install-plan.test.ts
```

Expected: FAIL because `loadInstallManifest` and `buildUninstallPlan` are not exported.

**Step 3: Add core manifest types and loader**

In `src/core/installPlan.ts`, add types near the install apply result types:

```ts
export interface InstallManifestFile {
  path: string;
  relPath: string;
  action: InstallAction;
  sha256: string;
  marker: boolean;
  existingIsForeign: boolean;
  backupPath?: string;
}

export interface InstallManifest {
  target: string;
  profile: string;
  scope: InstallScope;
  baseDir: string;
  installedAt: string;
  files: InstallManifestFile[];
}
```

Add helpers near `sha256()` and `timestampForPath()`:

```ts
function manifestPathForBaseDir(baseDir: string): string {
  return join(baseDir, ".threadkit", "install-manifest.json");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

Add `loadInstallManifest` before `applyInstallPlan`:

```ts
export async function loadInstallManifest(args: { baseDir: string }): Promise<InstallManifest> {
  const manifestPath = manifestPathForBaseDir(args.baseDir);
  let raw: string;

  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      throw new InstallPlanUsageError(
        "missing-install-manifest",
        `Install manifest was not found at '${manifestPath}'.`
      );
    }
    throw error;
  }

  const parsed: unknown = JSON.parse(raw);

  if (!isObject(parsed) || !Array.isArray(parsed.files)) {
    throw new InstallPlanUsageError("invalid-install-manifest", "Install manifest is invalid.");
  }

  return parsed as InstallManifest;
}
```

Refactor `applyInstallPlan()` to call `manifestPathForBaseDir(args.plan.baseDir)` instead of duplicating the manifest path string.

**Step 4: Run focused test**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/install-plan.test.ts
```

Expected: PASS for manifest loading tests, or continue fixing only validation issues needed by these tests.

**Step 5: Commit**

```sh
git add src/core/installPlan.ts test/install-plan.test.ts
git commit -m "feat: load install manifests"
```

## Task 2: Add Uninstall Planner

**Files:**
- Modify: `test/install-plan.test.ts`
- Modify: `src/core/installPlan.ts`

**Step 1: Write failing planner tests**

Add tests under a new `describe("uninstall planning", () => { ... })` block:

```ts
it("plans managed unchanged manifest files for deletion", async () => {
  const baseDir = await makeTempRoot();
  const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
  const content = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nBody\n";
  await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
  await writeFile(outputPath, content);
  const manifest = await loadInstallManifest({
    baseDir: await seedInstalledManifest(baseDir, outputPath, content)
  });

  const plan = await buildUninstallPlan({ manifest, target: "claude", scope: "user", baseDir });

  expect(plan.files).toMatchObject([
    {
      path: outputPath,
      relPath: "skills/handoff/SKILL.md",
      action: "delete",
      marker: true,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
    }
  ]);
});
```

Use a local helper instead of duplicating manifest setup:

```ts
async function seedInstalledManifest(baseDir: string, outputPath: string, content: string): Promise<string> {
  await writeManifest(baseDir, {
    target: "claude",
    profile: "minimal",
    scope: "user",
    baseDir,
    installedAt: "2026-06-01T10-00-00-000Z",
    files: [
      {
        path: outputPath,
        relPath: "skills/handoff/SKILL.md",
        action: "create",
        sha256: createHash("sha256").update(content).digest("hex"),
        marker: true,
        existingIsForeign: false
      }
    ]
  });
  return baseDir;
}
```

Add `createHash` to the test imports from `node:crypto`.

Add focused tests for:

```ts
it("plans missing manifest files as missing", async () => { ... });
it("plans edited managed files as skip-drifted", async () => { ... });
it("plans unmarked files as skip-foreign", async () => { ... });
it("rejects target, scope, or base directory mismatches", async () => { ... });
```

**Step 2: Run focused test to verify failure**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/install-plan.test.ts
```

Expected: FAIL because `buildUninstallPlan` does not exist.

**Step 3: Implement planner**

In `src/core/installPlan.ts`, add:

```ts
export type UninstallAction = "delete" | "skip-drifted" | "skip-foreign" | "missing";

export interface PlannedUninstallFile {
  path: string;
  relPath: string;
  action: UninstallAction;
  marker: boolean;
  sha256: string;
}

export interface UninstallPlan {
  target: string;
  profile: string;
  scope: InstallScope;
  baseDir: string;
  manifestPath: string;
  files: PlannedUninstallFile[];
  warnings: string[];
}
```

Add validation inside `loadInstallManifest()` or `buildUninstallPlan()`:

```ts
function assertManifestMatches(args: {
  manifest: InstallManifest;
  target: string;
  scope: InstallScope;
  baseDir: string;
}): void {
  if (args.manifest.target !== args.target) {
    throw new InstallPlanUsageError("install-manifest-target-mismatch", "Install manifest target does not match uninstall target.");
  }
  if (args.manifest.scope !== args.scope) {
    throw new InstallPlanUsageError("install-manifest-scope-mismatch", "Install manifest scope does not match uninstall scope.");
  }
  if (resolve(args.manifest.baseDir) !== resolve(args.baseDir)) {
    throw new InstallPlanUsageError("install-manifest-base-dir-mismatch", "Install manifest base directory does not match uninstall destination.");
  }
}
```

Add planner:

```ts
export async function buildUninstallPlan(args: {
  manifest: InstallManifest;
  target: string;
  scope: InstallScope;
  baseDir: string;
}): Promise<UninstallPlan> {
  assertManifestMatches(args);

  const files: PlannedUninstallFile[] = [];

  for (const file of args.manifest.files) {
    const outputPath = resolveInsideBaseDir(args.baseDir, file.relPath);
    let action: UninstallAction = "delete";
    let currentHash = file.sha256;
    let marker = file.marker;

    try {
      const existing = await readFile(outputPath);
      currentHash = sha256(existing);
      marker = hasManagedMarker(existing);
      if (!marker) {
        action = "skip-foreign";
      } else if (currentHash !== file.sha256) {
        action = "skip-drifted";
      }
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") {
        throw error;
      }
      action = "missing";
    }

    files.push({
      path: outputPath,
      relPath: file.relPath,
      action,
      marker,
      sha256: currentHash
    });
  }

  return {
    target: args.manifest.target,
    profile: args.manifest.profile,
    scope: args.manifest.scope,
    baseDir: resolve(args.baseDir),
    manifestPath: manifestPathForBaseDir(args.baseDir),
    files,
    warnings: []
  };
}
```

**Step 4: Run focused test**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/install-plan.test.ts
```

Expected: PASS.

**Step 5: Commit**

```sh
git add src/core/installPlan.ts test/install-plan.test.ts
git commit -m "feat: plan manifest uninstall"
```

## Task 3: Add Uninstall Apply

**Files:**
- Modify: `test/install-plan.test.ts`
- Modify: `src/core/installPlan.ts`

**Step 1: Write failing apply tests**

Add `describe("uninstall application", () => { ... })` with tests:

```ts
it("deletes only files planned for deletion", async () => {
  const baseDir = await makeTempRoot();
  const deletePath = join(baseDir, "skills", "handoff", "SKILL.md");
  const driftedPath = join(baseDir, "skills", "changed", "SKILL.md");
  const content = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nBody\n";
  await mkdir(join(baseDir, "skills", "handoff"), { recursive: true });
  await mkdir(join(baseDir, "skills", "changed"), { recursive: true });
  await writeFile(deletePath, content);
  await writeFile(driftedPath, `${content}Edited\n`);

  const plan = {
    target: "claude",
    profile: "minimal",
    scope: "user" satisfies InstallScope,
    baseDir,
    manifestPath: join(baseDir, ".threadkit", "install-manifest.json"),
    warnings: [],
    files: [
      { path: deletePath, relPath: "skills/handoff/SKILL.md", action: "delete", marker: true, sha256: "x" },
      { path: driftedPath, relPath: "skills/changed/SKILL.md", action: "skip-drifted", marker: true, sha256: "y" }
    ]
  };

  const result = await applyUninstallPlan({ plan });

  await expect(stat(deletePath)).rejects.toThrow();
  expect(await readFile(driftedPath, "utf8")).toContain("Edited");
  expect(result.files).toMatchObject([
    { relPath: "skills/handoff/SKILL.md", action: "delete", deleted: true },
    { relPath: "skills/changed/SKILL.md", action: "skip-drifted", deleted: false }
  ]);
});
```

Add `applyUninstallPlan` to imports.

**Step 2: Run focused test to verify failure**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/install-plan.test.ts
```

Expected: FAIL because `applyUninstallPlan` does not exist.

**Step 3: Implement apply**

Add `unlink` to the import from `node:fs/promises`.

Add result types:

```ts
export interface AppliedUninstallFile extends PlannedUninstallFile {
  deleted: boolean;
}

export interface ApplyUninstallPlanResult {
  manifestPath: string;
  files: AppliedUninstallFile[];
}
```

Add:

```ts
export async function applyUninstallPlan(args: { plan: UninstallPlan }): Promise<ApplyUninstallPlanResult> {
  const files: AppliedUninstallFile[] = [];

  for (const planned of args.plan.files) {
    const applied: AppliedUninstallFile = { ...planned, deleted: false };

    if (planned.action === "delete") {
      await unlink(planned.path);
      applied.deleted = true;
    }

    files.push(applied);
  }

  return {
    manifestPath: args.plan.manifestPath,
    files
  };
}
```

**Step 4: Run focused test**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/install-plan.test.ts
```

Expected: PASS.

**Step 5: Commit**

```sh
git add src/core/installPlan.ts test/install-plan.test.ts
git commit -m "feat: apply manifest uninstall"
```

## Task 4: Wire CLI Command

**Files:**
- Modify: `src/cli/index.ts`
- Modify: `src/cli/commands.ts`
- Modify: `test/cli.test.ts`

**Step 1: Write failing CLI tests**

In `test/cli.test.ts`, add uninstall tests near the install tests:

```ts
it("dry-runs uninstall from the install manifest as JSON", async () => { ... });
it("applies uninstall and deletes only unchanged managed files", async () => { ... });
it("reports missing uninstall manifest as a usage error", async () => { ... });
it("refuses uninstall when manifest target does not match", async () => { ... });
```

Expected JSON dry-run shape:

```ts
{
  ok: true,
  target: "claude",
  profile: "minimal",
  scope: "project",
  baseDir: join(cwd, ".claude", "skills"),
  dryRun: true,
  manifestPath: join(cwd, ".claude", "skills", ".threadkit", "install-manifest.json"),
  files: [{ relPath: "skills/handoff/SKILL.md", action: "delete" }],
  warnings: []
}
```

Expected apply shape:

```ts
{
  ok: true,
  dryRun: false,
  files: [{ relPath: "skills/handoff/SKILL.md", action: "delete", deleted: true }]
}
```

**Step 2: Run CLI tests to verify failure**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/cli.test.ts
```

Expected: FAIL because `uninstall` is not a command.

**Step 3: Add CLI options and command**

In `src/cli/commands.ts`, import:

```ts
applyUninstallPlan,
buildUninstallPlan,
loadInstallManifest,
```

Add:

```ts
export interface UninstallOptions extends RootOptions {
  scope?: string;
  apply?: boolean;
}
```

Implement `runUninstall(targetName, options, context)` by mirroring `runInstall`:

- Resolve `format`.
- Resolve install base with `resolveInstallBaseDir({ targetName, scope: options.scope, cwd: context.cwd, env: process.env })`.
- Load manifest from `resolvedInstall.baseDir`.
- Build uninstall plan with target/scope/baseDir.
- If `options.apply !== true`, return dry-run output and exit `0`.
- If applying, call `applyUninstallPlan`, output applied files, and exit `0`.
- In the catch block, return `{ ok: false, target, errors, warnings: [] }` for JSON and set exit `2` for usage errors.

In `src/cli/index.ts`, add:

```ts
program
  .command("uninstall")
  .description("Plan removal of files from the latest threadkit install manifest.")
  .argument("<target>", "Install target.")
  .option("--scope <scope>", "Install scope: user or project.")
  .option("--format <format>", "Output format: text or json.")
  .option("--apply", "Apply the uninstall plan.")
  .action((target, options) => runUninstall(target, options, context));
```

**Step 4: Run CLI tests**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/cli.test.ts
```

Expected: PASS.

**Step 5: Commit**

```sh
git add src/cli/index.ts src/cli/commands.ts test/cli.test.ts
git commit -m "feat: add uninstall command"
```

## Task 5: Update Status Docs

**Files:**
- Modify: `PROJECT_STATUS.md`

**Step 1: Update current slice**

Replace the current slice text with:

```md
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
```

Keep the Local Environment section intact.

**Step 2: Commit**

```sh
git add PROJECT_STATUS.md
git commit -m "docs: update project status for uninstall"
```

## Task 6: Full Verification

**Files:**
- No edits expected.

**Step 1: Run full test suite**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test
```

Expected: PASS.

**Step 2: Run typecheck**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm check
```

Expected: PASS.

**Step 3: Run build**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm build
```

Expected: PASS.

**Step 4: Check branch state**

Run:

```sh
git status --short --branch
```

Expected: clean worktree on `codex/manifest-uninstall`.

## Follow-Up Slices

- Rollback from backup paths in the install manifest.
- Directory pruning for empty generated directories after uninstall.
- Manifest history instead of a single latest install manifest.
- Optional forceful uninstall, only if the product explicitly needs it and with separate safety design.
