# Install Lifecycle Follow-Ups Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden the install manifest lifecycle with schema versioning, explicit force rollback semantics, and empty directory pruning after uninstall.

**Architecture:** Keep lifecycle behavior in `src/core/installPlan.ts`, because that module already owns install, uninstall, rollback, manifest loading, path safety, and apply-time rechecks. Extend the manifest shape in a backward-compatible way, add opt-in force rollback through core and CLI APIs, and prune only empty directories that are descendants of installed file paths. Backup history and retention pruning are deliberately deferred because they need a separate retention policy.

**Tech Stack:** TypeScript, Node `fs/promises`, Commander, Vitest, existing ThreadKit core/CLI modules.

---

## Current Baseline

- `src/core/installPlan.ts` writes a single latest manifest at `<baseDir>/.threadkit/install-manifest.json`.
- Manifest entries already include `backupPath` for `overwrite` and `overwrite-foreign` installs.
- `buildRollbackPlan()` and `applyRollbackPlan()` restore only when the installed file still has a ThreadKit marker and still matches the manifest sha256.
- `buildUninstallPlan()` and `applyUninstallPlan()` delete only unchanged managed files.
- Uninstall intentionally leaves empty parent directories and the manifest in place.
- CLI options currently expose `install --force`, but not `rollback --force` or uninstall pruning options.

## Scope

- Add `schemaVersion: 1` to newly written manifests.
- Continue accepting existing manifests that omit `schemaVersion`.
- Reject manifests with unsupported future schema versions.
- Add explicit `force` rollback planning and apply semantics.
- Add uninstall directory pruning for empty directories created by installed file paths.
- Keep dry-run behavior side-effect free.

## Out Of Scope

- Backup retention policy, backup history indexes, or pruning old backups.
- Removing the install manifest after uninstall or rollback.
- Force uninstall deletion of drifted or foreign files.
- Rollback across more than the latest manifest.
- Transactional rollback or uninstall.

## Safety Rules

- Never trust manifest `path` during apply. Continue resolving from `baseDir` plus `relPath`.
- Never restore from a `backupPath` unless `resolveBackupPath()` proves it is inside `<baseDir>/.threadkit/backups`.
- Default rollback must keep current drift and foreign protections exactly as they are.
- Force rollback must be explicit and reported in both dry-run and apply results.
- Directory pruning must remove only empty directories under `baseDir`.
- Directory pruning must never remove `.threadkit`, backup directories, the base directory itself, or any directory containing non-pruned files.

## Task 1: Add Manifest Schema Version Loading

**Files:**
- Modify: `test/install-plan.test.ts`
- Modify: `src/core/installPlan.ts`

**Step 1: Write failing manifest schema tests**

In `test/install-plan.test.ts`, extend `describe("install manifest loading", ...)` with:

```ts
it("loads legacy install manifests without a schema version", async () => {
  const baseDir = await makeTempRoot();
  const manifest = {
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
        sha256: "a7937b64b8caa58f03721bb6bacf5c78cb235febe0e70b1b84cd99541461a08e",
        marker: true,
        existingIsForeign: false
      }
    ]
  };
  await writeManifest(baseDir, manifest);

  await expect(loadInstallManifest({ baseDir })).resolves.toEqual(manifest);
});

it("loads schema version 1 install manifests", async () => {
  const baseDir = await makeTempRoot();
  const manifest = {
    schemaVersion: 1,
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
        sha256: "a7937b64b8caa58f03721bb6bacf5c78cb235febe0e70b1b84cd99541461a08e",
        marker: true,
        existingIsForeign: false
      }
    ]
  };
  await writeManifest(baseDir, manifest);

  await expect(loadInstallManifest({ baseDir })).resolves.toEqual(manifest);
});

it("rejects unsupported install manifest schema versions", async () => {
  const baseDir = await makeTempRoot();
  await writeManifest(baseDir, {
    schemaVersion: 2,
    target: "claude",
    profile: "minimal",
    scope: "user",
    baseDir,
    installedAt: "2026-06-01T10-00-00-000Z",
    files: []
  });

  await expect(loadInstallManifest({ baseDir })).rejects.toMatchObject({
    code: "unsupported-install-manifest-version"
  });
});
```

**Step 2: Run focused tests and confirm failure**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/install-plan.test.ts
```

Expected: FAIL because schema version validation is not implemented.

**Step 3: Implement schema version validation**

In `src/core/installPlan.ts`, update `InstallManifest`:

```ts
export interface InstallManifest {
  schemaVersion?: 1;
  target: string;
  profile: string;
  scope: InstallScope;
  baseDir: string;
  installedAt: string;
  files: InstallManifestFile[];
}
```

Add a helper near manifest validation:

```ts
function isSupportedManifestSchemaVersion(value: unknown): value is undefined | 1 {
  return value === undefined || value === 1;
}
```

Update `isInstallManifest()` to require the version helper:

```ts
isSupportedManifestSchemaVersion(value.schemaVersion) &&
```

In `loadInstallManifest()`, after parsing and before shape validation failure, return a version-specific usage error for unsupported versions:

```ts
if (isRecord(parsed) && !isSupportedManifestSchemaVersion(parsed.schemaVersion)) {
  throw new InstallPlanUsageError(
    "unsupported-install-manifest-version",
    `Install manifest at '${manifestPath}' uses an unsupported schema version.`
  );
}
```

**Step 4: Run focused tests**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/install-plan.test.ts
```

Expected: PASS.

**Step 5: Commit**

```sh
git add src/core/installPlan.ts test/install-plan.test.ts
git commit -m "feat: version install manifests"
```

## Task 2: Write Schema Version 1 During Install

**Files:**
- Modify: `test/install-plan.test.ts`
- Modify: `test/cli.test.ts`
- Modify: `src/core/installPlan.ts`

**Step 1: Write failing install manifest tests**

In the existing `install application` manifest assertions in `test/install-plan.test.ts`, add:

```ts
schemaVersion: 1,
```

to the expected manifest object.

In `test/cli.test.ts`, update the install apply test that reads `output.manifestPath` and assert:

```ts
expect(JSON.parse(await readFile(output.manifestPath, "utf8"))).toMatchObject({
  schemaVersion: 1,
  target: "claude"
});
```

**Step 2: Run focused tests and confirm failure**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/install-plan.test.ts test/cli.test.ts
```

Expected: FAIL because new manifests omit `schemaVersion`.

**Step 3: Write the schema version**

In `applyInstallPlan()`, add `schemaVersion: 1` to the manifest object:

```ts
const manifest: InstallManifest = {
  schemaVersion: 1,
  target: args.plan.target,
  profile: args.plan.profile,
  scope: args.plan.scope,
  baseDir: args.plan.baseDir,
  installedAt: timestamp,
  files: appliedFiles.map(...)
};
```

**Step 4: Run focused tests**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/install-plan.test.ts test/cli.test.ts
```

Expected: PASS.

**Step 5: Commit**

```sh
git add src/core/installPlan.ts test/install-plan.test.ts test/cli.test.ts
git commit -m "feat: write install manifest schema version"
```

## Task 3: Add Core Force Rollback Semantics

**Files:**
- Modify: `test/install-plan.test.ts`
- Modify: `src/core/installPlan.ts`

**Step 1: Write failing force rollback planner tests**

Add tests under `describe("rollback planning", ...)`:

```ts
it("plans drifted managed files for force restore when force rollback is enabled", async () => {
  const baseDir = await makeTempRoot();
  const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
  const current = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nGenerated\n";
  const drifted = `${current}Edited\n`;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, drifted);
  const manifest = await loadInstallManifest({
    baseDir: await seedRollbackManifest({
      baseDir,
      outputPath,
      currentContent: current,
      originalContent: "Original\n"
    })
  });

  const plan = await buildRollbackPlan({ manifest, target: "claude", scope: "user", baseDir, force: true });

  expect(plan.files).toMatchObject([
    {
      relPath: "skills/handoff/SKILL.md",
      action: "force-restore",
      marker: true,
      sha256: sha256(drifted)
    }
  ]);
});

it("keeps foreign rollback files skipped even when force rollback is enabled", async () => {
  const baseDir = await makeTempRoot();
  const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
  const current = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nGenerated\n";
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, "Human edit after install\n");
  const manifest = await loadInstallManifest({
    baseDir: await seedRollbackManifest({
      baseDir,
      outputPath,
      currentContent: current,
      originalContent: "Original\n"
    })
  });

  const plan = await buildRollbackPlan({ manifest, target: "claude", scope: "user", baseDir, force: true });

  expect(plan.files).toMatchObject([{ action: "skip-foreign" }]);
});
```

**Step 2: Run focused tests and confirm failure**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/install-plan.test.ts
```

Expected: FAIL because `force` is not a build option and `force-restore` is not a rollback action.

**Step 3: Add the action and planner option**

In `src/core/installPlan.ts`, extend `RollbackAction`:

```ts
  | "force-restore"
```

Update `buildRollbackPlan()` args:

```ts
export async function buildRollbackPlan(args: {
  manifest: InstallManifest;
  target: string;
  scope: InstallScope;
  baseDir: string;
  force?: boolean;
}): Promise<RollbackPlan> {
```

After `currentRollbackState()` returns, map only drifted managed files to force restore:

```ts
if (args.force === true && current.action === "skip-drifted" && current.marker) {
  action = "force-restore";
} else {
  action = current.action;
}
```

Do not force missing files, foreign files, missing backups, unsafe backups, or entries with no backup.

**Step 4: Run focused tests**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/install-plan.test.ts
```

Expected: PASS.

**Step 5: Commit**

```sh
git add src/core/installPlan.ts test/install-plan.test.ts
git commit -m "feat: plan force rollback restores"
```

## Task 4: Apply Force Rollback Safely

**Files:**
- Modify: `test/install-plan.test.ts`
- Modify: `src/core/installPlan.ts`

**Step 1: Write failing apply tests**

Add tests under `describe("rollback application", ...)`:

```ts
it("force restores drifted managed files after rechecking apply-time state", async () => {
  const baseDir = await makeTempRoot();
  const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
  const current = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nGenerated\n";
  const drifted = `${current}Edited\n`;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, drifted);
  const manifest = await loadInstallManifest({
    baseDir: await seedRollbackManifest({
      baseDir,
      outputPath,
      currentContent: current,
      originalContent: "Original\n"
    })
  });
  const plan = await buildRollbackPlan({ manifest, target: "claude", scope: "user", baseDir, force: true });

  const result = await applyRollbackPlan({ plan, force: true });

  expect(await readFile(outputPath, "utf8")).toBe("Original\n");
  expect(result.files).toMatchObject([
    { relPath: "skills/handoff/SKILL.md", action: "force-restore", restored: true }
  ]);
});

it("does not force restore a file that became foreign after planning", async () => {
  const baseDir = await makeTempRoot();
  const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
  const current = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nGenerated\n";
  const drifted = `${current}Edited\n`;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, drifted);
  const manifest = await loadInstallManifest({
    baseDir: await seedRollbackManifest({
      baseDir,
      outputPath,
      currentContent: current,
      originalContent: "Original\n"
    })
  });
  const plan = await buildRollbackPlan({ manifest, target: "claude", scope: "user", baseDir, force: true });
  await writeFile(outputPath, "Human edit after plan\n");

  const result = await applyRollbackPlan({ plan, force: true });

  expect(await readFile(outputPath, "utf8")).toBe("Human edit after plan\n");
  expect(result.files).toMatchObject([{ action: "skip-foreign", restored: false }]);
});
```

**Step 2: Run focused tests and confirm failure**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/install-plan.test.ts
```

Expected: FAIL because `applyRollbackPlan()` ignores `force-restore`.

**Step 3: Implement force apply**

Update the signature:

```ts
export async function applyRollbackPlan(args: {
  plan: RollbackPlan;
  force?: boolean;
}): Promise<ApplyRollbackPlanResult> {
```

Treat `restore` and `force-restore` as restorable actions:

```ts
if (planned.action === "restore" || planned.action === "force-restore") {
```

After rechecking current state, preserve force restore only when the apply-time file is still marked managed:

```ts
const desiredAction =
  args.force === true && planned.action === "force-restore" && current.action === "skip-drifted" && current.marker
    ? "force-restore"
    : current.action;

applied.action = desiredAction;
```

Write the backup when:

```ts
if (applied.action === "restore" || applied.action === "force-restore") {
```

**Step 4: Run focused tests**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/install-plan.test.ts
```

Expected: PASS.

**Step 5: Commit**

```sh
git add src/core/installPlan.ts test/install-plan.test.ts
git commit -m "feat: apply force rollback restores"
```

## Task 5: Expose `rollback --force` In The CLI

**Files:**
- Modify: `test/cli.test.ts`
- Modify: `src/cli/commands.ts`
- Modify: `src/cli/index.ts`

**Step 1: Write failing CLI tests**

Add tests near the existing rollback CLI tests:

```ts
it("dry-runs force rollback for drifted managed files", async () => {
  const root = await makeTempRoot();
  const cwd = await makeTempRoot();
  const outputPath = join(cwd, ".claude", "skills", "skills", "handoff", "SKILL.md");
  await writeValidCustomLibrary(root);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nOld\n");
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
  await writeFile(outputPath, "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nUser edit\n");
  const harness = makeHarness(cwd);

  await harness.program.parseAsync([
    "node",
    "threadkit",
    "rollback",
    "claude",
    "--scope",
    "project",
    "--force",
    "--format",
    "json"
  ]);

  expect(harness.exitCode).toBe(0);
  expect(JSON.parse(harness.stdout)).toMatchObject({
    ok: true,
    dryRun: true,
    force: true,
    files: [{ action: "force-restore", relPath: "skills/handoff/SKILL.md" }]
  });
});

it("applies force rollback for drifted managed files", async () => {
  const root = await makeTempRoot();
  const cwd = await makeTempRoot();
  const outputPath = join(cwd, ".claude", "skills", "skills", "handoff", "SKILL.md");
  const original = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nOld\n";
  await writeValidCustomLibrary(root);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, original);
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
  await writeFile(outputPath, "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nUser edit\n");
  const harness = makeHarness(cwd);

  await harness.program.parseAsync([
    "node",
    "threadkit",
    "rollback",
    "claude",
    "--scope",
    "project",
    "--apply",
    "--force",
    "--format",
    "json"
  ]);

  expect(harness.exitCode).toBe(0);
  expect(await readFile(outputPath, "utf8")).toBe(original);
  expect(JSON.parse(harness.stdout)).toMatchObject({
    ok: true,
    dryRun: false,
    force: true,
    restored: 1,
    files: [{ action: "force-restore", restored: true }]
  });
});
```

**Step 2: Run focused CLI tests and confirm failure**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/cli.test.ts
```

Expected: FAIL because `rollback` does not accept `--force`.

**Step 3: Add CLI option and plumbing**

In `src/cli/commands.ts`, update `RollbackOptions`:

```ts
export interface RollbackOptions {
  scope?: string;
  format?: string;
  apply?: boolean;
  force?: boolean;
}
```

Pass force into core:

```ts
const plan = await buildRollbackPlan({
  manifest,
  target: resolvedInstall.target,
  scope: resolvedInstall.scope,
  baseDir: resolvedInstall.baseDir,
  force: options.force === true
});
```

Pass force into apply:

```ts
const applied = await applyRollbackPlan({ plan, force: options.force === true });
```

Include `force: options.force === true` in rollback JSON dry-run and apply output.

In `src/cli/index.ts`, add:

```ts
.option("--force", "Restore over drifted ThreadKit-managed files.")
```

to the `rollback` command.

**Step 4: Run focused CLI tests**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/cli.test.ts
```

Expected: PASS.

**Step 5: Commit**

```sh
git add src/cli/commands.ts src/cli/index.ts test/cli.test.ts
git commit -m "feat: add rollback force flag"
```

## Task 6: Plan Empty Directory Pruning During Uninstall

**Files:**
- Modify: `test/install-plan.test.ts`
- Modify: `src/core/installPlan.ts`

**Step 1: Write failing directory pruning planner tests**

Add this test under `describe("uninstall planning", ...)`:

```ts
it("plans empty parent directories for pruning after deletions", async () => {
  const baseDir = await makeTempRoot();
  const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
  const content = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nBody\n";
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content);
  const manifest = await loadInstallManifest({
    baseDir: await seedInstalledManifest(baseDir, outputPath, content)
  });

  const plan = await buildUninstallPlan({ manifest, target: "claude", scope: "user", baseDir, pruneEmptyDirs: true });

  expect(plan.directories).toEqual([
    {
      path: join(baseDir, "skills", "handoff"),
      relPath: "skills/handoff",
      action: "prune"
    },
    {
      path: join(baseDir, "skills"),
      relPath: "skills",
      action: "prune"
    }
  ]);
});

it("does not plan directory pruning when sibling files remain", async () => {
  const baseDir = await makeTempRoot();
  const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
  const siblingPath = join(baseDir, "skills", "handoff", "notes.md");
  const content = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nBody\n";
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content);
  await writeFile(siblingPath, "Human note\n");
  const manifest = await loadInstallManifest({
    baseDir: await seedInstalledManifest(baseDir, outputPath, content)
  });

  const plan = await buildUninstallPlan({ manifest, target: "claude", scope: "user", baseDir, pruneEmptyDirs: true });

  expect(plan.directories).toEqual([]);
});
```

**Step 2: Run focused tests and confirm failure**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/install-plan.test.ts
```

Expected: FAIL because uninstall plans do not include directories.

**Step 3: Add directory plan types**

In `src/core/installPlan.ts`, add:

```ts
export type UninstallDirectoryAction = "prune" | "skip-nonempty";

export interface PlannedUninstallDirectory {
  path: string;
  relPath: string;
  action: UninstallDirectoryAction;
}
```

Extend `UninstallPlan`:

```ts
directories: PlannedUninstallDirectory[];
```

Update all existing test plan literals to include `directories: []`.

**Step 4: Implement prune planning**

Add helpers near path utilities:

```ts
function relDirFromFileRelPath(relPath: string): string | undefined {
  const directory = dirname(relPath);
  return directory === "." ? undefined : directory;
}

function ancestorRelDirs(relPath: string): string[] {
  const dirs: string[] = [];
  let current = relDirFromFileRelPath(relPath);

  while (current !== undefined && current !== ".") {
    dirs.push(current);
    const parent = dirname(current);
    current = parent === current || parent === "." ? undefined : parent;
  }

  return dirs;
}
```

In `buildUninstallPlan()`, accept `pruneEmptyDirs?: boolean` and build directory candidates only from files whose action is `delete`.

Use `readdir()` from `node:fs/promises` to inspect candidate directories. Treat files planned for delete as absent while checking emptiness:

```ts
const deleteRelPaths = new Set(files.filter((file) => file.action === "delete").map((file) => file.relPath));
```

For each ancestor directory from deepest to shallowest:

- Resolve with `resolveInsideBaseDir(args.baseDir, relDir)`.
- Skip `".threadkit"` paths and the base directory.
- Read entries.
- A directory can be planned as `prune` only when every entry is either a delete-planned file or a directory already planned for prune.
- Do not include `skip-nonempty` entries in the returned plan unless a later CLI UX explicitly needs them.

Return:

```ts
directories,
```

from the uninstall plan.

**Step 5: Run focused tests**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/install-plan.test.ts
```

Expected: PASS.

**Step 6: Commit**

```sh
git add src/core/installPlan.ts test/install-plan.test.ts
git commit -m "feat: plan uninstall directory pruning"
```

## Task 7: Apply Empty Directory Pruning During Uninstall

**Files:**
- Modify: `test/install-plan.test.ts`
- Modify: `src/core/installPlan.ts`

**Step 1: Write failing apply tests**

Add tests under `describe("uninstall application", ...)`:

```ts
it("prunes empty directories after deleting managed files", async () => {
  const baseDir = await makeTempRoot();
  const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
  const content = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nBody\n";
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content);
  const manifest = await loadInstallManifest({
    baseDir: await seedInstalledManifest(baseDir, outputPath, content)
  });
  const plan = await buildUninstallPlan({ manifest, target: "claude", scope: "user", baseDir, pruneEmptyDirs: true });

  const result = await applyUninstallPlan({ plan });

  await expect(stat(join(baseDir, "skills", "handoff"))).rejects.toThrow();
  await expect(stat(join(baseDir, "skills"))).rejects.toThrow();
  expect(result.directories).toMatchObject([
    { relPath: "skills/handoff", action: "prune", pruned: true },
    { relPath: "skills", action: "prune", pruned: true }
  ]);
});

it("does not prune a directory that became nonempty after planning", async () => {
  const baseDir = await makeTempRoot();
  const outputPath = join(baseDir, "skills", "handoff", "SKILL.md");
  const latePath = join(baseDir, "skills", "handoff", "late.md");
  const content = "<!-- threadkit:generated target=claude profile=minimal skill=handoff -->\nBody\n";
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content);
  const manifest = await loadInstallManifest({
    baseDir: await seedInstalledManifest(baseDir, outputPath, content)
  });
  const plan = await buildUninstallPlan({ manifest, target: "claude", scope: "user", baseDir, pruneEmptyDirs: true });
  await writeFile(latePath, "Human file\n");

  const result = await applyUninstallPlan({ plan });

  expect(await readFile(latePath, "utf8")).toBe("Human file\n");
  expect(result.directories).toMatchObject([
    { relPath: "skills/handoff", action: "skip-nonempty", pruned: false },
    { relPath: "skills", action: "skip-nonempty", pruned: false }
  ]);
});
```

**Step 2: Run focused tests and confirm failure**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/install-plan.test.ts
```

Expected: FAIL because apply results do not include directory pruning.

**Step 3: Implement apply-time pruning**

In `src/core/installPlan.ts`, import `rmdir`:

```ts
import { mkdir, readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
```

Add:

```ts
export interface AppliedUninstallDirectory extends PlannedUninstallDirectory {
  pruned: boolean;
}
```

Extend `ApplyUninstallPlanResult`:

```ts
directories: AppliedUninstallDirectory[];
```

In `applyUninstallPlan()`, after file deletes are attempted, iterate `args.plan.directories` in listed order:

```ts
const directories: AppliedUninstallDirectory[] = [];

for (const planned of args.plan.directories) {
  const directoryPath = resolveInsideBaseDir(args.plan.baseDir, planned.relPath);
  const applied: AppliedUninstallDirectory = { ...planned, path: directoryPath, pruned: false };

  if (planned.action === "prune") {
    try {
      await rmdir(directoryPath);
      applied.pruned = true;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === "ENOTEMPTY" || code === "EEXIST") {
        applied.action = "skip-nonempty";
      } else if (code !== "ENOENT") {
        throw error;
      }
    }
  }

  directories.push(applied);
}
```

Return `directories` with the existing files result.

**Step 4: Run focused tests**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/install-plan.test.ts
```

Expected: PASS.

**Step 5: Commit**

```sh
git add src/core/installPlan.ts test/install-plan.test.ts
git commit -m "feat: prune uninstall directories"
```

## Task 8: Expose Uninstall Directory Pruning In CLI Output

**Files:**
- Modify: `test/cli.test.ts`
- Modify: `src/cli/commands.ts`
- Modify: `src/cli/index.ts`

**Step 1: Write failing CLI tests**

Add tests near existing uninstall CLI tests:

```ts
it("dry-runs uninstall directory pruning as JSON", async () => {
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
    "--prune-empty-dirs",
    "--format",
    "json"
  ]);

  expect(harness.exitCode).toBe(0);
  expect(JSON.parse(harness.stdout)).toMatchObject({
    ok: true,
    dryRun: true,
    pruneEmptyDirs: true,
    directories: [{ relPath: "skills/handoff", action: "prune" }]
  });
});

it("applies uninstall directory pruning", async () => {
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

  expect(harness.exitCode).toBe(0);
  await expect(stat(join(cwd, ".claude", "skills", "skills", "handoff"))).rejects.toThrow();
  expect(JSON.parse(harness.stdout)).toMatchObject({
    ok: true,
    dryRun: false,
    pruneEmptyDirs: true,
    directories: [{ relPath: "skills/handoff", action: "prune", pruned: true }]
  });
});
```

**Step 2: Run focused CLI tests and confirm failure**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/cli.test.ts
```

Expected: FAIL because `uninstall` does not accept `--prune-empty-dirs`.

**Step 3: Add CLI option and JSON/text output**

In `src/cli/commands.ts`, update `UninstallOptions`:

```ts
export interface UninstallOptions {
  scope?: string;
  format?: string;
  apply?: boolean;
  pruneEmptyDirs?: boolean;
}
```

Pass the option into `buildUninstallPlan()`:

```ts
pruneEmptyDirs: options.pruneEmptyDirs === true
```

Include in JSON output:

```ts
pruneEmptyDirs: options.pruneEmptyDirs === true,
directories: plan.directories,
```

and for apply:

```ts
directories: applied.directories,
```

In text output, print directory rows after file rows:

```ts
for (const directory of plan.directories) {
  context.write(`${directory.action}\t${directory.path}\n`);
}
```

and equivalent for applied directories.

In `src/cli/index.ts`, add:

```ts
.option("--prune-empty-dirs", "Remove empty directories left after uninstalling managed files.")
```

to the `uninstall` command.

**Step 4: Run focused CLI tests**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test -- test/cli.test.ts
```

Expected: PASS.

**Step 5: Commit**

```sh
git add src/cli/commands.ts src/cli/index.ts test/cli.test.ts
git commit -m "feat: expose uninstall directory pruning"
```

## Task 9: Update Documentation And Verify

**Files:**
- Inspect: `README.md`
- Modify only if existing CLI docs mention install lifecycle commands.

**Step 1: Check whether README documents uninstall or rollback**

Run:

```sh
rg -n "install|uninstall|rollback|manifest|force|prune" README.md docs
```

Expected: Either README needs a small CLI update, or the project currently keeps CLI docs in tests/plans only.

**Step 2: Add minimal user-facing docs if needed**

If README has command documentation, add concise bullets for:

```md
- `threadkit rollback <target> --force` restores over drifted ThreadKit-managed files, but still skips foreign files.
- `threadkit uninstall <target> --prune-empty-dirs` removes empty directories left behind by deleted managed files.
```

Do not document backup retention or manifest history in this slice.

**Step 3: Run full verification**

Run:

```sh
source ~/.nvm/nvm.sh && nvm use && corepack pnpm test
source ~/.nvm/nvm.sh && nvm use && corepack pnpm check
source ~/.nvm/nvm.sh && nvm use && corepack pnpm build
```

Expected: all commands pass.

**Step 4: Commit docs if changed**

If docs changed:

```sh
git add README.md
git commit -m "docs: document install lifecycle follow-ups"
```

If docs did not change, skip this commit.

## Final Review Checklist

- `schemaVersion: 1` is present in newly written manifests.
- Legacy manifests without `schemaVersion` still load.
- Unsupported manifest versions fail with `unsupported-install-manifest-version`.
- Default rollback behavior is unchanged for drifted and foreign files.
- `rollback --force` restores only drifted managed files with valid backups.
- `rollback --force` still skips foreign files, missing files, missing backups, unsafe backup paths, and entries with no backup.
- `uninstall --prune-empty-dirs` prunes only empty directories below `baseDir`.
- Directory pruning is rechecked at apply time.
- `.threadkit` and backup directories are never pruned.
- JSON outputs include the new explicit flags and result arrays.
- Text output remains tab-delimited action/path rows.
- Full test, typecheck, and build verification pass.

## Later Slice: Backup History And Pruning

Handle backup history separately after this lifecycle hardening lands. That slice should first define product policy:

- How many backup generations should be retained?
- Is retention count-based, age-based, or both?
- Should rollback target a named generation or only latest?
- Should backup pruning happen automatically after install or via an explicit command?
- Should manifests archive per install, or should a separate backup index own history?

Do not start backup pruning by deleting old timestamped directories without answering those questions.
