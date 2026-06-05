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
  sha256,
  stripTargetPrefix
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

function contentByRelPath(target: string, render: RenderResult): Map<string, FileSpec> {
  const files = new Map<string, FileSpec>();

  for (const file of render.files) {
    files.set(stripTargetPrefix(target, file.relPath), file);
  }

  return files;
}

export async function applyUninstallPlan(args: { plan: UninstallPlan }): Promise<ApplyUninstallPlanResult> {
  const files: AppliedUninstallFile[] = [];
  const directories: AppliedUninstallDirectory[] = [];

  for (const planned of args.plan.files) {
    const outputPath = resolveSafePathInside(args.plan.baseDir, planned.relPath);
    const applied: AppliedUninstallFile = { ...planned, path: outputPath, deleted: false };

    if (planned.action === "delete") {
      const current = await readCurrentManagedFileState({
        path: outputPath,
        fallbackMarker: planned.marker,
        fallbackSha256: planned.sha256
      });

      if (current.kind === "missing") {
        applied.action = "missing";
        files.push(applied);
        continue;
      }

      applied.marker = current.marker;
      applied.sha256 = current.sha256;

      if (!applied.marker) {
        applied.action = "skip-foreign";
      } else if (current.sha256 !== planned.sha256) {
        applied.action = "skip-drifted";
      } else {
        await unlink(outputPath);
        applied.deleted = true;
      }
    }

    files.push(applied);
  }

  for (const planned of args.plan.directories) {
    const directoryPath = resolveSafePathInside(args.plan.baseDir, planned.relPath);
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

  return {
    manifestPath: args.plan.manifestPath,
    files,
    directories
  };
}

export async function applyRollbackPlan(args: { plan: RollbackPlan; force?: boolean }): Promise<ApplyRollbackPlanResult> {
  const files: AppliedRollbackFile[] = [];

  for (const planned of args.plan.files) {
    const outputPath = resolveSafePathInside(args.plan.baseDir, planned.relPath);
    const applied: AppliedRollbackFile = { ...planned, path: outputPath, restored: false };

    if (planned.action === "restore" || planned.action === "force-restore") {
      const expectedSha256 = planned.action === "force-restore" ? planned.installedSha256 : planned.sha256;
      if (expectedSha256 === undefined) {
        applied.action = "skip-current";
        files.push(applied);
        continue;
      }

      if (planned.backupPath === undefined) {
        applied.action = "no-backup";
        files.push(applied);
        continue;
      }

      const backupPath = resolveBackupPath(args.plan.baseDir, planned.backupPath);

      if (backupPath === undefined) {
        applied.action = "unsafe-backup-path";
        delete applied.backupPath;
        files.push(applied);
        continue;
      }

      applied.backupPath = backupPath;

      let backup: Buffer;
      try {
        backup = await readFile(backupPath);
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        if (code !== "ENOENT") {
          throw error;
        }

        applied.action = "missing-backup";
        files.push(applied);
        continue;
      }

      const current = await currentRollbackState({
        outputPath,
        expectedSha256,
        fallbackMarker: planned.marker
      });
      if (planned.action === "force-restore") {
        applied.action =
          args.force === true && current.action === "skip-drifted" && current.marker
            ? "force-restore"
            : current.action === "restore"
              ? "skip-current"
              : current.action;
      } else {
        applied.action = current.action;
      }
      applied.marker = current.marker;
      applied.sha256 = current.sha256;

      if (applied.action === "restore" || applied.action === "force-restore") {
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, backup);
        applied.restored = true;
      }
    }

    files.push(applied);
  }

  return {
    manifestPath: args.plan.manifestPath,
    files
  };
}

export async function applyBackupPrunePlan(args: {
  plan: BackupPrunePlan;
}): Promise<ApplyBackupPrunePlanResult> {
  const generations: AppliedBackupPruneGeneration[] = [];
  const orphans: AppliedBackupPruneOrphan[] = [];
  const deletedIds = new Set<string>();

  for (const planned of args.plan.generations) {
    const applied: AppliedBackupPruneGeneration = { ...planned, deleted: false };

    if (planned.action === "delete" && isSafeBackupDir(args.plan.baseDir, planned.backupDir)) {
      await rm(planned.backupDir, { recursive: true, force: true });
      applied.deleted = true;
      deletedIds.add(planned.id);
    } else if (planned.action === "delete") {
      applied.action = "unsafe-backup-dir";
    }

    generations.push(applied);
  }

  for (const planned of args.plan.orphans) {
    const applied: AppliedBackupPruneOrphan = { ...planned, deleted: false };

    if (planned.action === "delete" && isSafeBackupDir(args.plan.baseDir, planned.path)) {
      await rm(planned.path, { recursive: true, force: true });
      applied.deleted = true;
    } else if (planned.action === "delete") {
      applied.action = "unsafe-backup-dir";
    }

    orphans.push(applied);
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
  let generationId = timestamp;
  let collisionSuffix = 0;
  while (existingIndex.generations.some((g) => g.id === generationId)) {
    collisionSuffix += 1;
    generationId = `${timestamp}-${collisionSuffix}`;
  }
  const renderFiles = contentByRelPath(args.plan.target, args.render);
  const appliedFiles: AppliedInstallFile[] = [];

  for (const planned of args.plan.files) {
    const applied: AppliedInstallFile = { ...planned };

    if (planned.action === "create" || planned.action === "overwrite" || planned.action === "overwrite-foreign") {
      const renderFile = renderFiles.get(planned.relPath);

      if (!renderFile) {
        throw new Error(`Install file '${planned.relPath}' was not found in the render result.`);
      }

      if (planned.action === "overwrite" || planned.action === "overwrite-foreign") {
        const existing = await readFile(planned.path);
        const backupPath = join(args.plan.baseDir, ".threadkit", "backups", generationId, planned.relPath);
        await mkdir(dirname(backupPath), { recursive: true });
        await writeFile(backupPath, existing);
        applied.backupPath = backupPath;
      }

      const content = await contentForSpec(renderFile);
      await mkdir(dirname(planned.path), { recursive: true });
      await writeFile(planned.path, content);
    }

    appliedFiles.push(applied);
  }

  const manifestPath = manifestPathForBaseDir(args.plan.baseDir);
  const manifest: InstallManifest = {
    schemaVersion: 1,
    target: args.plan.target,
    profile: args.plan.profile,
    scope: args.plan.scope,
    baseDir: args.plan.baseDir,
    installedAt: timestamp,
    files: appliedFiles.map((file) => ({
      path: file.path,
      relPath: file.relPath,
      action: file.action,
      sha256: file.sha256,
      marker: file.marker,
      existingIsForeign: file.existingIsForeign,
      ...(file.backupPath === undefined ? {} : { backupPath: file.backupPath })
    }))
  };

  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const backedUpFiles = manifest.files.filter((file): file is BackupGenerationFile => file.backupPath !== undefined);
  if (backedUpFiles.length > 0) {
    const backupDir = join(args.plan.baseDir, ".threadkit", "backups", generationId);
    await writeBackupIndex({
      baseDir: args.plan.baseDir,
      index: {
        schemaVersion: 1,
        generations: [
          ...existingIndex.generations,
          {
            id: generationId,
            target: args.plan.target,
            profile: args.plan.profile,
            scope: args.plan.scope,
            baseDir: args.plan.baseDir,
            installedAt: timestamp,
            backupDir,
            files: backedUpFiles
          }
        ]
      }
    });
  }

  return {
    manifestPath,
    files: appliedFiles
  };
}
