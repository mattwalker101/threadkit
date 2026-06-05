import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { contentForSpec, resolveSafePathInside } from "./resolveSafePath.js";
import type { RenderResult } from "./renderTypes.js";
import { hasManagedMarker } from "./marker.js";
import {
  currentRollbackState,
  isSafeBackupDir,
  manifestPathForBaseDir,
  newestGenerationsFirst,
  resolveBackupPath,
  sha256,
  stripTargetPrefix
} from "./planHelpers.js";
import {
  InstallPlanUsageError,
  type BackupIndex,
  type BackupPrunePlan,
  type InstallAction,
  type InstallManifest,
  type InstallScope,
  type PlannedBackupPruneGeneration,
  type PlannedFile,
  type PlannedRollbackFile,
  type PlannedUninstallDirectory,
  type PlannedUninstallFile,
  type RollbackAction,
  type RollbackPlan,
  type UninstallAction,
  type UninstallPlan,
  type WritePlan
} from "./planTypes.js";

function assertManifestMatches(args: {
  manifest: InstallManifest;
  target: string;
  scope: InstallScope;
  baseDir: string;
}): void {
  if (args.manifest.target !== args.target) {
    throw new InstallPlanUsageError(
      "install-manifest-target-mismatch",
      "Install manifest target does not match uninstall target."
    );
  }

  if (args.manifest.scope !== args.scope) {
    throw new InstallPlanUsageError(
      "install-manifest-scope-mismatch",
      "Install manifest scope does not match uninstall scope."
    );
  }

  if (resolve(args.manifest.baseDir) !== resolve(args.baseDir)) {
    throw new InstallPlanUsageError(
      "install-manifest-base-dir-mismatch",
      "Install manifest base directory does not match uninstall destination."
    );
  }
}

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

async function planUninstallDirectories(args: {
  baseDir: string;
  files: PlannedUninstallFile[];
  pruneEmptyDirs?: boolean;
}): Promise<PlannedUninstallDirectory[]> {
  if (args.pruneEmptyDirs !== true) {
    return [];
  }

  const deleteRelPaths = new Set(args.files.filter((file) => file.action === "delete").map((file) => file.relPath));
  const candidateRelDirs: string[] = [];
  const seenRelDirs = new Set<string>();

  for (const file of args.files) {
    if (file.action !== "delete") {
      continue;
    }

    for (const relDir of ancestorRelDirs(file.relPath)) {
      if (relDir === ".threadkit" || relDir.startsWith(".threadkit/") || seenRelDirs.has(relDir)) {
        continue;
      }

      seenRelDirs.add(relDir);
      candidateRelDirs.push(relDir);
    }
  }

  const directories: PlannedUninstallDirectory[] = [];
  const pruneRelDirs = new Set<string>();

  for (const relDir of candidateRelDirs) {
    const directoryPath = resolveSafePathInside(args.baseDir, relDir);
    let entries: Array<{ name: string; isDirectory: () => boolean }>;

    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") {
        throw error;
      }

      continue;
    }

    const emptyAfterDeletes = entries.every((entry) => {
      const entryRelPath = `${relDir}/${entry.name}`;
      return deleteRelPaths.has(entryRelPath) || (entry.isDirectory() && pruneRelDirs.has(entryRelPath));
    });

    if (emptyAfterDeletes) {
      pruneRelDirs.add(relDir);
      directories.push({
        path: directoryPath,
        relPath: relDir,
        action: "prune"
      });
    }
  }

  return directories;
}

export async function buildPlan(args: {
  target: string;
  profile: string;
  scope: InstallScope;
  baseDir: string;
  render: RenderResult;
  managedOnly: true;
  forceForeign?: boolean;
}): Promise<WritePlan> {
  const files: PlannedFile[] = [];

  for (const file of args.render.files) {
    const relPath = stripTargetPrefix(args.target, file.relPath);
    const outputPath = resolveSafePathInside(args.baseDir, relPath);
    const content = await contentForSpec(file);
    const plannedHash = sha256(content);

    let action: InstallAction = "create";
    let existingIsForeign = false;

    try {
      const existing = await readFile(outputPath);
      if (args.managedOnly && !hasManagedMarker(existing)) {
        action = args.forceForeign === true ? "overwrite-foreign" : "skip-foreign";
        existingIsForeign = true;
      } else {
        action = sha256(existing) === plannedHash ? "unchanged" : "overwrite";
      }
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") {
        throw error;
      }
    }

    files.push({
      path: outputPath,
      relPath,
      action,
      marker: file.marker,
      existingIsForeign,
      sha256: plannedHash
    });
  }

  return {
    target: args.target,
    profile: args.profile,
    scope: args.scope,
    baseDir: resolve(args.baseDir),
    files,
    warnings: args.render.warnings
  };
}

export async function buildUninstallPlan(args: {
  manifest: InstallManifest;
  target: string;
  scope: InstallScope;
  baseDir: string;
  pruneEmptyDirs?: boolean;
}): Promise<UninstallPlan> {
  assertManifestMatches(args);

  const files: PlannedUninstallFile[] = [];

  for (const file of args.manifest.files) {
    const outputPath = resolveSafePathInside(args.baseDir, file.relPath);
    let action: UninstallAction = "delete";
    let marker = file.marker;
    let currentHash = file.sha256;

    try {
      const existing = await readFile(outputPath);
      marker = hasManagedMarker(existing);
      currentHash = sha256(existing);

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

  const directories = await planUninstallDirectories({
    baseDir: args.baseDir,
    files,
    pruneEmptyDirs: args.pruneEmptyDirs
  });

  return {
    target: args.manifest.target,
    profile: args.manifest.profile,
    scope: args.manifest.scope,
    baseDir: resolve(args.baseDir),
    manifestPath: manifestPathForBaseDir(args.baseDir),
    files,
    directories,
    warnings: []
  };
}

export async function buildRollbackPlan(args: {
  manifest: InstallManifest;
  target: string;
  scope: InstallScope;
  baseDir: string;
  force?: boolean;
}): Promise<RollbackPlan> {
  assertManifestMatches(args);

  const files: PlannedRollbackFile[] = [];

  for (const file of args.manifest.files) {
    const outputPath = resolveSafePathInside(args.baseDir, file.relPath);
    let action: RollbackAction = "restore";
    let marker = file.marker;
    let currentHash = file.sha256;
    let backupPath: string | undefined;

    if (file.backupPath === undefined) {
      action = "no-backup";
    } else {
      backupPath = resolveBackupPath(args.baseDir, file.backupPath);

      if (backupPath === undefined) {
        action = "unsafe-backup-path";
      } else {
        try {
          await readFile(backupPath);
        } catch (error) {
          const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
          if (code !== "ENOENT") {
            throw error;
          }

          action = "missing-backup";
        }
      }
    }

    if (action === "restore") {
      const current = await currentRollbackState({
        outputPath,
        expectedSha256: file.sha256,
        fallbackMarker: file.marker
      });
      action = current.action;
      marker = current.marker;
      currentHash = current.sha256;

      if (args.force === true && action === "skip-drifted" && marker) {
        action = "force-restore";
      }
    }

    files.push({
      path: outputPath,
      relPath: file.relPath,
      action,
      marker,
      sha256: currentHash,
      ...(action === "force-restore" ? { installedSha256: file.sha256 } : {}),
      ...(backupPath === undefined ? {} : { backupPath })
    });
  }

  return {
    target: args.manifest.target,
    profile: args.manifest.profile,
    scope: args.manifest.scope,
    baseDir: resolve(args.baseDir),
    manifestPath: args.manifest.manifestPath ?? manifestPathForBaseDir(args.baseDir),
    files,
    warnings: []
  };
}

export function buildBackupPrunePlan(args: {
  index: BackupIndex;
  baseDir: string;
  target: string;
  scope: InstallScope;
  keep?: number;
}): BackupPrunePlan {
  const keep = args.keep ?? 10;
  const matching = newestGenerationsFirst(
    args.index.generations.filter(
      (generation) =>
        generation.target === args.target &&
        generation.scope === args.scope &&
        resolve(generation.baseDir) === resolve(args.baseDir)
    )
  );
  const retained = matching.slice(0, keep);
  const retainedIds = new Set(retained.map((generation) => generation.id));
  const generations = matching
    .filter((generation) => !retainedIds.has(generation.id))
    .map((generation): PlannedBackupPruneGeneration => ({
      ...generation,
      action: isSafeBackupDir(args.baseDir, generation.backupDir) ? "delete" : "unsafe-backup-dir"
    }));

  return {
    index: args.index,
    baseDir: resolve(args.baseDir),
    target: args.target,
    scope: args.scope,
    keep,
    dryRun: true,
    generations,
    retained,
    warnings: []
  };
}
