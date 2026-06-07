import { mkdir, readFile, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { contentForSpec, resolveSafePathInside } from "./resolveSafePath.js";
import type { RenderResult, FileSpec } from "./renderTypes.js";
import {
  currentRollbackState,
  isSafeBackupDir,
  manifestPathForBaseDir,
  readCurrentManagedFileState,
  resolveBackupPath,
  sha256
} from "./planHelpers.js";
import { loadBackupIndex, writeBackupIndex } from "./manifestIO.js";
import {
  InstallPlanUsageError,
  type AppliedBackupPruneGeneration,
  type AppliedBackupPruneOrphan,
  type AppliedInstallFile,
  type AppliedRollbackFile,
  type AppliedUninstallDirectory,
  type AppliedUninstallFile,
  type ApplyBackupPrunePlanResult,
  type ApplyInstallPlanResult,
  type ApplyRollbackPlanResult,
  type ApplyUninstallPlanResult,
  type BackupGenerationFile,
  type BackupIndex,
  type BackupPrunePlan,
  type InstallManifest,
  type InstallScope,
  type RollbackPlan,
  type UninstallPlan,
  type WritePlan
} from "./planTypes.js";

function timestampForPath(timestamp: string | Date | undefined): string {
  if (timestamp instanceof Date) {
    return timestamp.toISOString().replace(/[:.]/g, "-");
  }

  if (timestamp !== undefined) {
    return timestamp;
  }

  return new Date().toISOString().replace(/[:.]/g, "-");
}

function stripInstallPrefix(relPath: string, prefix?: string): string {
  if (!prefix) {
    return relPath;
  }

  const normalized = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return relPath.startsWith(normalized) ? relPath.slice(normalized.length) : relPath;
}

function contentByRelPath(target: string, render: RenderResult, stripRelPathPrefix?: string): Map<string, FileSpec> {
  const files = new Map<string, FileSpec>();

  for (const file of render.files) {
    files.set(stripInstallPrefix(file.relPath, stripRelPathPrefix ?? target), file);
  }

  return files;
}

type UninstallPlanWithOptionalManifest = Omit<UninstallPlan, "manifest"> & {
  manifest?: UninstallPlan["manifest"];
};

type PlannedUninstallFileForApply = UninstallPlan["files"][number];
type PlannedUninstallDirectoryForApply = UninstallPlan["directories"][number];
type PlannedRollbackFileForApply = RollbackPlan["files"][number];
type PlannedBackupPruneGenerationForApply = BackupPrunePlan["generations"][number];
type PlannedBackupPruneOrphanForApply = BackupPrunePlan["orphans"][number];
type PlannedInstallFileForApply = WritePlan["files"][number];

async function applyUninstallFile(args: {
  baseDir: string;
  planned: PlannedUninstallFileForApply;
}): Promise<AppliedUninstallFile> {
  const outputPath = resolveSafePathInside(args.baseDir, args.planned.relPath);
  const applied: AppliedUninstallFile = { ...args.planned, path: outputPath, deleted: false };

  if (args.planned.action !== "delete") {
    return applied;
  }

  const current = await readCurrentManagedFileState({
    path: outputPath,
    fallbackMarker: args.planned.marker,
    fallbackSha256: args.planned.sha256
  });

  if (current.kind === "missing") {
    applied.action = "missing";
    return applied;
  }

  applied.marker = current.marker;
  applied.sha256 = current.sha256;

  if (!applied.marker) {
    applied.action = "skip-foreign";
  } else if (current.sha256 !== args.planned.sha256) {
    applied.action = "skip-drifted";
  } else {
    await unlink(outputPath);
    applied.deleted = true;
  }

  return applied;
}

async function applyUninstallManifest(
  plannedManifest: UninstallPlan["manifest"]
): Promise<ApplyUninstallPlanResult["manifest"]> {
  const manifest = {
    ...plannedManifest,
    deleted: false
  };

  if (plannedManifest.action !== "delete") {
    return manifest;
  }

  try {
    await unlink(plannedManifest.path);
    manifest.deleted = true;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  return manifest;
}

async function applyUninstallDirectory(args: {
  baseDir: string;
  planned: PlannedUninstallDirectoryForApply;
}): Promise<AppliedUninstallDirectory> {
  const directoryPath = resolveSafePathInside(args.baseDir, args.planned.relPath);
  const applied: AppliedUninstallDirectory = { ...args.planned, path: directoryPath, pruned: false };

  if (args.planned.action !== "prune") {
    return applied;
  }

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

  return applied;
}

export async function applyUninstallPlan(args: {
  plan: UninstallPlan | UninstallPlanWithOptionalManifest;
}): Promise<ApplyUninstallPlanResult> {
  const files: AppliedUninstallFile[] = [];
  const directories: AppliedUninstallDirectory[] = [];
  const plannedManifest = args.plan.manifest ?? {
    path: args.plan.manifestPath,
    action: "keep" as const
  };

  for (const planned of args.plan.files) {
    files.push(await applyUninstallFile({ baseDir: args.plan.baseDir, planned }));
  }

  const manifest = await applyUninstallManifest(plannedManifest);

  for (const planned of args.plan.directories) {
    directories.push(await applyUninstallDirectory({ baseDir: args.plan.baseDir, planned }));
  }

  return {
    manifestPath: args.plan.manifestPath,
    manifest,
    files,
    directories
  };
}

function rollbackExpectedSha256(planned: PlannedRollbackFileForApply): string | undefined {
  return planned.action === "force-restore" ? planned.installedSha256 : planned.sha256;
}

async function readRollbackBackup(args: {
  baseDir: string;
  planned: PlannedRollbackFileForApply;
  applied: AppliedRollbackFile;
}): Promise<Buffer | undefined> {
  if (args.planned.backupPath === undefined) {
    args.applied.action = "no-backup";
    return undefined;
  }

  const backupPath = resolveBackupPath(args.baseDir, args.planned.backupPath);

  if (backupPath === undefined) {
    args.applied.action = "unsafe-backup-path";
    delete args.applied.backupPath;
    return undefined;
  }

  args.applied.backupPath = backupPath;

  try {
    return await readFile(backupPath);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") {
      throw error;
    }

    args.applied.action = "missing-backup";
    return undefined;
  }
}

function rollbackActionAfterCurrentState(args: {
  planned: PlannedRollbackFileForApply;
  current: Awaited<ReturnType<typeof currentRollbackState>>;
  force?: boolean;
}): AppliedRollbackFile["action"] {
  if (args.planned.action !== "force-restore") {
    return args.current.action;
  }

  if (args.force === true && args.current.action === "skip-drifted" && args.current.marker) {
    return "force-restore";
  }

  return args.current.action === "restore" ? "skip-current" : args.current.action;
}

async function applyRollbackFile(args: {
  baseDir: string;
  planned: PlannedRollbackFileForApply;
  force?: boolean;
}): Promise<AppliedRollbackFile> {
  const outputPath = resolveSafePathInside(args.baseDir, args.planned.relPath);
  const applied: AppliedRollbackFile = { ...args.planned, path: outputPath, restored: false };

  if (args.planned.action !== "restore" && args.planned.action !== "force-restore") {
    return applied;
  }

  const expectedSha256 = rollbackExpectedSha256(args.planned);
  if (expectedSha256 === undefined) {
    applied.action = "skip-current";
    return applied;
  }

  const backup = await readRollbackBackup({ baseDir: args.baseDir, planned: args.planned, applied });
  if (backup === undefined) {
    return applied;
  }

  const current = await currentRollbackState({
    outputPath,
    expectedSha256,
    fallbackMarker: args.planned.marker
  });
  applied.action = rollbackActionAfterCurrentState({ planned: args.planned, current, force: args.force });
  applied.marker = current.marker;
  applied.sha256 = current.sha256;

  if (applied.action === "restore" || applied.action === "force-restore") {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, backup);
    applied.restored = true;
  }

  return applied;
}

export async function applyRollbackPlan(args: { plan: RollbackPlan; force?: boolean }): Promise<ApplyRollbackPlanResult> {
  const files: AppliedRollbackFile[] = [];

  for (const planned of args.plan.files) {
    files.push(await applyRollbackFile({ baseDir: args.plan.baseDir, planned, force: args.force }));
  }

  return {
    manifestPath: args.plan.manifestPath,
    files
  };
}

async function applyBackupPruneGeneration(args: {
  baseDir: string;
  planned: PlannedBackupPruneGenerationForApply;
}): Promise<AppliedBackupPruneGeneration> {
  const applied: AppliedBackupPruneGeneration = { ...args.planned, deleted: false };

  if (args.planned.action !== "delete") {
    return applied;
  }

  if (!isSafeBackupDir(args.baseDir, args.planned.backupDir)) {
    applied.action = "unsafe-backup-dir";
    return applied;
  }

  await rm(args.planned.backupDir, { recursive: true, force: true });
  applied.deleted = true;
  return applied;
}

async function applyBackupPruneOrphan(args: {
  baseDir: string;
  planned: PlannedBackupPruneOrphanForApply;
}): Promise<AppliedBackupPruneOrphan> {
  const applied: AppliedBackupPruneOrphan = { ...args.planned, deleted: false };

  if (args.planned.action !== "delete") {
    return applied;
  }

  if (!isSafeBackupDir(args.baseDir, args.planned.path)) {
    applied.action = "unsafe-backup-dir";
    return applied;
  }

  await rm(args.planned.path, { recursive: true, force: true });
  applied.deleted = true;
  return applied;
}

export async function applyBackupPrunePlan(args: {
  plan: BackupPrunePlan;
}): Promise<ApplyBackupPrunePlanResult> {
  const generations: AppliedBackupPruneGeneration[] = [];
  const orphans: AppliedBackupPruneOrphan[] = [];
  const deletedIds = new Set<string>();

  for (const planned of args.plan.generations) {
    const applied = await applyBackupPruneGeneration({ baseDir: args.plan.baseDir, planned });
    if (applied.deleted) {
      deletedIds.add(planned.id);
    }
    generations.push(applied);
  }

  for (const planned of args.plan.orphans) {
    orphans.push(await applyBackupPruneOrphan({ baseDir: args.plan.baseDir, planned }));
  }

  const index: BackupIndex = {
    schemaVersion: 1,
    generations: args.plan.index.generations.filter((generation) => !deletedIds.has(generation.id))
  };
  const indexPath = await writeBackupIndex({ baseDir: args.plan.baseDir, index });

  return {
    indexPath,
    generations,
    orphans,
    retained: args.plan.retained
  };
}

function uniqueBackupGenerationId(existingIndex: BackupIndex, timestamp: string): string {
  let generationId = timestamp;
  let collisionSuffix = 0;
  while (existingIndex.generations.some((g) => g.id === generationId)) {
    collisionSuffix += 1;
    generationId = `${timestamp}-${collisionSuffix}`;
  }
  return generationId;
}

async function applyInstallFile(args: {
  plan: WritePlan;
  renderFiles: Map<string, FileSpec>;
  generationId: string;
  planned: PlannedInstallFileForApply;
}): Promise<AppliedInstallFile> {
  const applied: AppliedInstallFile = { ...args.planned };

  if (
    args.planned.action !== "create" &&
    args.planned.action !== "overwrite" &&
    args.planned.action !== "overwrite-foreign"
  ) {
    return applied;
  }

  const renderFile = args.renderFiles.get(args.planned.relPath);

  if (!renderFile) {
    throw new Error(`Install file '${args.planned.relPath}' was not found in the render result.`);
  }

  if (args.planned.action === "overwrite" || args.planned.action === "overwrite-foreign") {
    const existing = await readFile(args.planned.path);
    const backupPath = join(args.plan.baseDir, ".threadkit", "backups", args.generationId, args.planned.relPath);
    await mkdir(dirname(backupPath), { recursive: true });
    await writeFile(backupPath, existing);
    applied.backupPath = backupPath;
  }

  const content = await contentForSpec(renderFile);
  await mkdir(dirname(args.planned.path), { recursive: true });
  await writeFile(args.planned.path, content);

  return applied;
}

function installManifestForAppliedFiles(args: {
  plan: WritePlan;
  timestamp: string;
  appliedFiles: AppliedInstallFile[];
}): InstallManifest {
  return {
    schemaVersion: 1,
    target: args.plan.target,
    profile: args.plan.profile,
    scope: args.plan.scope,
    baseDir: args.plan.baseDir,
    installedAt: args.timestamp,
    files: args.appliedFiles.map((file) => ({
      path: file.path,
      relPath: file.relPath,
      action: file.action,
      sha256: file.sha256,
      marker: file.marker,
      existingIsForeign: file.existingIsForeign,
      ...(file.backupPath === undefined ? {} : { backupPath: file.backupPath })
    }))
  };
}

async function writeBackupGenerationIfNeeded(args: {
  plan: WritePlan;
  existingIndex: BackupIndex;
  generationId: string;
  timestamp: string;
  manifest: InstallManifest;
}): Promise<void> {
  const backedUpFiles = args.manifest.files.filter((file): file is BackupGenerationFile => file.backupPath !== undefined);
  if (backedUpFiles.length === 0) {
    return;
  }

  const backupDir = join(args.plan.baseDir, ".threadkit", "backups", args.generationId);
  await writeBackupIndex({
    baseDir: args.plan.baseDir,
    index: {
      schemaVersion: 1,
      generations: [
        ...args.existingIndex.generations,
        {
          id: args.generationId,
          target: args.plan.target,
          profile: args.plan.profile,
          scope: args.plan.scope,
          baseDir: args.plan.baseDir,
          installedAt: args.timestamp,
          backupDir,
          files: backedUpFiles
        }
      ]
    }
  });
}

export async function applyInstallPlan(args: {
  plan: WritePlan;
  render: RenderResult;
  timestamp?: string | Date;
}): Promise<ApplyInstallPlanResult> {
  if (args.plan.files.some((file) => file.action === "skip-foreign")) {
    throw new InstallPlanUsageError("blocked-foreign-files", "Install plan contains foreign files.");
  }

  const timestamp = timestampForPath(args.timestamp);
  const existingIndex = await loadBackupIndex({ baseDir: args.plan.baseDir });
  const generationId = uniqueBackupGenerationId(existingIndex, timestamp);
  const renderFiles = contentByRelPath(args.plan.target, args.render, args.plan.stripRelPathPrefix);
  const appliedFiles: AppliedInstallFile[] = [];

  for (const planned of args.plan.files) {
    appliedFiles.push(await applyInstallFile({ plan: args.plan, renderFiles, generationId, planned }));
  }

  const manifestPath = manifestPathForBaseDir(args.plan.baseDir);
  const manifest = installManifestForAppliedFiles({ plan: args.plan, timestamp, appliedFiles });

  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeBackupGenerationIfNeeded({ plan: args.plan, existingIndex, generationId, timestamp, manifest });

  return {
    manifestPath,
    files: appliedFiles
  };
}
