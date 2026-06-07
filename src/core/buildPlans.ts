import { readdirSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { contentForSpec, resolveSafePathInside } from "./resolveSafePath.js";
import type { RenderResult } from "./renderTypes.js";
import { matchingBackupGenerations } from "./backupGenerations.js";
import {
  currentRollbackState,
  isSafeBackupDir,
  manifestPathForBaseDir,
  readCurrentManagedFileState,
  resolveBackupPath,
  sha256
} from "./planHelpers.js";
import {
  InstallPlanUsageError,
  type BackupIndex,
  type BackupPrunePlan,
  type InstallAction,
  type InstallManifest,
  type InstallScope,
  type PlannedBackupPruneGeneration,
  type PlannedBackupPruneOrphan,
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

function stripInstallPrefix(relPath: string, prefix?: string): string {
  if (!prefix) {
    return relPath;
  }

  const normalized = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return relPath.startsWith(normalized) ? relPath.slice(normalized.length) : relPath;
}

type DirectoryEntry = { name: string; isDirectory: () => boolean };

function removableUninstallRelPaths(args: { files: PlannedUninstallFile[]; removeManifest?: boolean }): Set<string> {
  const removableRelPaths = new Set(
    args.files
      .filter((file) => file.action === "delete" || file.action === "missing")
      .map((file) => file.relPath)
  );

  if (args.removeManifest === true) {
    removableRelPaths.add(".threadkit/install-manifest.json");
  }

  return removableRelPaths;
}

function candidateUninstallRelDirs(args: { files: PlannedUninstallFile[]; removeManifest?: boolean }): string[] {
  const candidateRelDirs: string[] = [];
  const seenRelDirs = new Set<string>();

  for (const file of args.files) {
    if (file.action !== "delete" && file.action !== "missing") {
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

  if (args.removeManifest === true) {
    candidateRelDirs.push(".threadkit");
  }

  return candidateRelDirs;
}

async function readDirectoryEntriesIfPresent(directoryPath: string): Promise<DirectoryEntry[] | undefined> {
  try {
    return await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") {
      throw error;
    }

    return undefined;
  }
}

function emptyAfterUninstallDeletes(args: {
  relDir: string;
  entries: DirectoryEntry[];
  removableRelPaths: Set<string>;
  pruneRelDirs: Set<string>;
}): boolean {
  return args.entries.every((entry) => {
    const entryRelPath = `${args.relDir}/${entry.name}`;
    return args.removableRelPaths.has(entryRelPath) || (entry.isDirectory() && args.pruneRelDirs.has(entryRelPath));
  });
}

async function planInstallFile(args: {
  baseDir: string;
  target: string;
  managedOnly: true;
  forceForeign?: boolean;
  stripRelPathPrefix?: string;
  file: RenderResult["files"][number];
}): Promise<PlannedFile> {
  const relPath = stripInstallPrefix(args.file.relPath, args.stripRelPathPrefix ?? args.target);
  const outputPath = resolveSafePathInside(args.baseDir, relPath);
  const content = await contentForSpec(args.file);
  const plannedHash = sha256(content);

  let action: InstallAction = "create";
  let existingIsForeign = false;

  const current = await readCurrentManagedFileState({
    path: outputPath,
    fallbackMarker: args.file.marker,
    fallbackSha256: plannedHash
  });

  if (current.kind === "present" && args.managedOnly && !current.marker) {
    action = args.forceForeign === true ? "overwrite-foreign" : "skip-foreign";
    existingIsForeign = true;
  } else if (current.kind === "present") {
    action = current.sha256 === plannedHash ? "unchanged" : "overwrite";
  }

  return {
    path: outputPath,
    relPath,
    action,
    marker: args.file.marker,
    existingIsForeign,
    sha256: plannedHash
  };
}

async function planUninstallDirectories(args: {
  baseDir: string;
  files: PlannedUninstallFile[];
  pruneEmptyDirs?: boolean;
  removeManifest?: boolean;
}): Promise<PlannedUninstallDirectory[]> {
  if (args.pruneEmptyDirs !== true) {
    return [];
  }

  const removableRelPaths = removableUninstallRelPaths(args);
  const candidateRelDirs = candidateUninstallRelDirs(args);
  const directories: PlannedUninstallDirectory[] = [];
  const pruneRelDirs = new Set<string>();

  for (const relDir of candidateRelDirs) {
    const directoryPath = resolveSafePathInside(args.baseDir, relDir);
    const entries = await readDirectoryEntriesIfPresent(directoryPath);
    if (entries === undefined) {
      continue;
    }

    if (emptyAfterUninstallDeletes({ relDir, entries, removableRelPaths, pruneRelDirs })) {
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
  stripRelPathPrefix?: string;
}): Promise<WritePlan> {
  const files: PlannedFile[] = [];

  for (const file of args.render.files) {
    files.push(
      await planInstallFile({
        baseDir: args.baseDir,
        target: args.target,
        managedOnly: args.managedOnly,
        forceForeign: args.forceForeign,
        stripRelPathPrefix: args.stripRelPathPrefix,
        file
      })
    );
  }

  return {
    target: args.target,
    profile: args.profile,
    scope: args.scope,
    baseDir: resolve(args.baseDir),
    ...(args.stripRelPathPrefix === undefined ? {} : { stripRelPathPrefix: args.stripRelPathPrefix }),
    files,
    warnings: args.render.warnings
  };
}

async function planUninstallFile(args: {
  baseDir: string;
  file: InstalledManifestFile;
}): Promise<PlannedUninstallFile> {
  const outputPath = resolveSafePathInside(args.baseDir, args.file.relPath);
  let action: UninstallAction = "delete";

  const current = await readCurrentManagedFileState({
    path: outputPath,
    fallbackMarker: args.file.marker,
    fallbackSha256: args.file.sha256
  });
  const marker = current.marker;
  const currentHash = current.sha256;

  if (current.kind === "missing") {
    action = "missing";
  } else if (!marker) {
    action = "skip-foreign";
  } else if (currentHash !== args.file.sha256) {
    action = "skip-drifted";
  }

  return {
    path: outputPath,
    relPath: args.file.relPath,
    action,
    marker,
    sha256: currentHash
  };
}

function uninstallManifestAction(args: { files: PlannedUninstallFile[]; pruneEmptyDirs?: boolean }): UninstallPlan["manifest"]["action"] {
  const unsafeFileActions = args.files.some((file) => file.action === "skip-drifted" || file.action === "skip-foreign");
  return args.pruneEmptyDirs === true && !unsafeFileActions ? "delete" : "keep";
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
    files.push(await planUninstallFile({ baseDir: args.baseDir, file }));
  }

  const manifestAction = uninstallManifestAction({ files, pruneEmptyDirs: args.pruneEmptyDirs });
  const manifestPath = manifestPathForBaseDir(args.baseDir);
  const directories = await planUninstallDirectories({
    baseDir: args.baseDir,
    files,
    pruneEmptyDirs: args.pruneEmptyDirs,
    removeManifest: manifestAction === "delete"
  });

  return {
    target: args.manifest.target,
    profile: args.manifest.profile,
    scope: args.manifest.scope,
    baseDir: resolve(args.baseDir),
    manifestPath,
    manifest: {
      path: manifestPath,
      action: manifestAction
    },
    files,
    directories,
    warnings: []
  };
}

type InstalledManifestFile = InstallManifest["files"][number];

async function rollbackBackupStatus(args: {
  baseDir: string;
  file: InstalledManifestFile;
}): Promise<{ action: RollbackAction; backupPath?: string }> {
  if (args.file.backupPath === undefined) {
    return { action: "no-backup" };
  }

  const backupPath = resolveBackupPath(args.baseDir, args.file.backupPath);

  if (backupPath === undefined) {
    return { action: "unsafe-backup-path" };
  }

  try {
    await readFile(backupPath);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") {
      throw error;
    }

    return { action: "missing-backup", backupPath };
  }

  return { action: "restore", backupPath };
}

async function rollbackFileState(args: {
  outputPath: string;
  file: InstalledManifestFile;
  force?: boolean;
}): Promise<{
  action: RollbackAction;
  marker: boolean;
  sha256: string;
}> {
  const current = await currentRollbackState({
    outputPath: args.outputPath,
    expectedSha256: args.file.sha256,
    fallbackMarker: args.file.marker
  });
  let action: RollbackAction = current.action;

  if (args.force === true && action === "skip-drifted" && current.marker) {
    action = "force-restore";
  }

  return {
    action,
    marker: current.marker,
    sha256: current.sha256
  };
}

async function planRollbackFile(args: {
  baseDir: string;
  file: InstalledManifestFile;
  force?: boolean;
}): Promise<PlannedRollbackFile> {
  const outputPath = resolveSafePathInside(args.baseDir, args.file.relPath);
  let marker = args.file.marker;
  let currentHash = args.file.sha256;
  const backup = await rollbackBackupStatus({ baseDir: args.baseDir, file: args.file });
  let action = backup.action;

  if (action === "restore") {
    const current = await rollbackFileState({ outputPath, file: args.file, force: args.force });
    action = current.action;
    marker = current.marker;
    currentHash = current.sha256;
  }

  return {
    path: outputPath,
    relPath: args.file.relPath,
    action,
    marker,
    sha256: currentHash,
    ...(action === "force-restore" ? { installedSha256: args.file.sha256 } : {}),
    ...(backup.backupPath === undefined ? {} : { backupPath: backup.backupPath })
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
    files.push(await planRollbackFile({ baseDir: args.baseDir, file, force: args.force }));
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
  includeOrphans?: boolean;
}): BackupPrunePlan {
  const keep = args.keep ?? 10;
  const baseDir = resolve(args.baseDir);
  const matching = matchingBackupGenerations(args.index, {
    target: args.target,
    scope: args.scope,
    baseDir
  });
  const retained = matching.slice(0, keep);
  const retainedIds = new Set(retained.map((generation) => generation.id));
  const generations = matching
    .filter((generation) => !retainedIds.has(generation.id))
    .map((generation): PlannedBackupPruneGeneration => ({
      ...generation,
      action: isSafeBackupDir(baseDir, generation.backupDir) ? "delete" : "unsafe-backup-dir"
    }));
  const orphans = args.includeOrphans === true ? planOrphanBackupDirs(args.index, baseDir) : [];

  return {
    index: args.index,
    baseDir,
    target: args.target,
    scope: args.scope,
    keep,
    dryRun: true,
    generations,
    orphans,
    retained,
    warnings: []
  };
}

function planOrphanBackupDirs(index: BackupIndex, baseDir: string): PlannedBackupPruneOrphan[] {
  const backupRoot = join(baseDir, ".threadkit", "backups");
  let entries;

  try {
    entries = readdirSync(backupRoot, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const referenced = new Set(
    index.generations
      .filter((generation) => isSafeBackupDir(baseDir, generation.backupDir))
      .map((generation) => resolve(generation.backupDir))
  );

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry): PlannedBackupPruneOrphan => {
      const path = resolve(backupRoot, entry.name);

      return {
        path,
        relPath: relative(backupRoot, path),
        action: isSafeBackupDir(baseDir, path) ? "delete" : "unsafe-backup-dir"
      };
    })
    .filter((orphan) => !referenced.has(orphan.path));
}
