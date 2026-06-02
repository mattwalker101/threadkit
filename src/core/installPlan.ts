import { mkdir, readFile, readdir, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir as defaultHomedir } from "node:os";
import { dirname, join, isAbsolute, resolve, sep } from "node:path";
import { getExportTarget } from "./exportTargets.js";
import type { ExportScope, FileSpec, RenderResult } from "./renderTypes.js";

export type InstallScope = ExportScope;
export type InstallAction = "create" | "overwrite" | "unchanged" | "skip-foreign" | "overwrite-foreign";

export interface PlannedFile {
  path: string;
  relPath: string;
  action: InstallAction;
  marker: boolean;
  existingIsForeign: boolean;
  sha256: string;
}

export interface WritePlan {
  target: string;
  profile: string;
  scope: InstallScope;
  baseDir: string;
  files: PlannedFile[];
  warnings: string[];
}

export interface AppliedInstallFile extends PlannedFile {
  backupPath?: string;
}

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
  schemaVersion?: 1;
  target: string;
  profile: string;
  scope: InstallScope;
  baseDir: string;
  installedAt: string;
  files: InstallManifestFile[];
  manifestPath?: string;
}

export interface BackupGenerationFile extends InstallManifestFile {
  backupPath: string;
}

export interface BackupGeneration {
  id: string;
  target: string;
  profile: string;
  scope: InstallScope;
  baseDir: string;
  installedAt: string;
  backupDir: string;
  files: BackupGenerationFile[];
}

export interface BackupIndex {
  schemaVersion: 1;
  generations: BackupGeneration[];
}

export type UninstallAction = "delete" | "skip-drifted" | "skip-foreign" | "missing";
export type UninstallDirectoryAction = "prune" | "skip-nonempty";
export type RollbackAction =
  | "restore"
  | "force-restore"
  | "skip-current"
  | "skip-drifted"
  | "skip-foreign"
  | "missing"
  | "no-backup"
  | "missing-backup"
  | "unsafe-backup-path";

export interface PlannedUninstallFile {
  path: string;
  relPath: string;
  action: UninstallAction;
  marker: boolean;
  sha256: string;
}

export interface PlannedUninstallDirectory {
  path: string;
  relPath: string;
  action: UninstallDirectoryAction;
}

export interface UninstallPlan {
  target: string;
  profile: string;
  scope: InstallScope;
  baseDir: string;
  manifestPath: string;
  files: PlannedUninstallFile[];
  directories: PlannedUninstallDirectory[];
  warnings: string[];
}

export interface PlannedRollbackFile {
  path: string;
  relPath: string;
  action: RollbackAction;
  marker: boolean;
  sha256: string;
  installedSha256?: string;
  backupPath?: string;
}

export interface RollbackPlan {
  target: string;
  profile: string;
  scope: InstallScope;
  baseDir: string;
  manifestPath: string;
  files: PlannedRollbackFile[];
  warnings: string[];
}

export interface ApplyInstallPlanResult {
  manifestPath: string;
  files: AppliedInstallFile[];
}

export interface AppliedUninstallFile extends PlannedUninstallFile {
  deleted: boolean;
}

export interface AppliedUninstallDirectory extends PlannedUninstallDirectory {
  pruned: boolean;
}

export interface ApplyUninstallPlanResult {
  manifestPath: string;
  files: AppliedUninstallFile[];
  directories: AppliedUninstallDirectory[];
}

export interface AppliedRollbackFile extends PlannedRollbackFile {
  restored: boolean;
}

export interface ApplyRollbackPlanResult {
  manifestPath: string;
  files: AppliedRollbackFile[];
}

export type BackupPruneAction = "delete" | "unsafe-backup-dir";

export interface PlannedBackupPruneGeneration extends BackupGeneration {
  action: BackupPruneAction;
}

export interface BackupPrunePlan {
  index: BackupIndex;
  baseDir: string;
  target: string;
  scope: InstallScope;
  keep: number;
  dryRun: true;
  generations: PlannedBackupPruneGeneration[];
  retained: BackupGeneration[];
  warnings: string[];
}

export interface AppliedBackupPruneGeneration extends PlannedBackupPruneGeneration {
  deleted: boolean;
}

export interface ApplyBackupPrunePlanResult {
  indexPath: string;
  generations: AppliedBackupPruneGeneration[];
  retained: BackupGeneration[];
}

export class InstallPlanUsageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface ResolveInstallBaseDirArgs {
  targetName: string;
  scope?: string;
  cwd: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  homedir?: string;
}

export interface ResolvedInstallBaseDir {
  target: string;
  scope: InstallScope;
  baseDir: string;
}

function assertInstallScope(scope: string): asserts scope is InstallScope {
  if (scope !== "user" && scope !== "project") {
    throw new InstallPlanUsageError("unsupported-scope", `Install scope '${scope}' is not supported.`);
  }
}

function expandHome(pathValue: string, home: string): string {
  if (pathValue === "~") {
    return home;
  }

  if (pathValue.startsWith("~/")) {
    return resolve(home, pathValue.slice(2));
  }

  return pathValue;
}

function resolveInstallPath(pathValue: string, cwd: string, home: string): string {
  const expanded = expandHome(pathValue, home);
  return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
}

export function resolveInstallBaseDir(args: ResolveInstallBaseDirArgs): ResolvedInstallBaseDir {
  const target = getExportTarget(args.targetName);

  if (!target) {
    throw new InstallPlanUsageError(
      "unsupported-target",
      `Install target '${args.targetName}' is not supported.`
    );
  }

  const scope = args.scope ?? "user";
  assertInstallScope(scope);

  const envKey = `THREADKIT_${target.name.toUpperCase()}_DIR`;
  const override = args.env?.[envKey];
  const pathValue = override ?? target.paths?.[scope];

  if (!pathValue) {
    if (!target.paths) {
      throw new InstallPlanUsageError(
        "unsupported-install-path",
        `Install target '${target.name}' does not define install paths.`
      );
    }

    throw new InstallPlanUsageError(
      "unsupported-install-scope",
      `Install target '${target.name}' does not support scope '${scope}'.`
    );
  }

  return {
    target: target.name,
    scope,
    baseDir: resolveInstallPath(pathValue, args.cwd, args.homedir ?? defaultHomedir())
  };
}

function resolveInsideBaseDir(baseDir: string, relPath: string): string {
  const resolvedBaseDir = resolve(baseDir);
  const outputPath = resolve(resolvedBaseDir, relPath);
  const prefix = resolvedBaseDir.endsWith(sep) ? resolvedBaseDir : `${resolvedBaseDir}${sep}`;

  if (outputPath !== resolvedBaseDir && !outputPath.startsWith(prefix)) {
    throw new Error(`Install file path '${relPath}' escapes the base directory.`);
  }

  return outputPath;
}

function isInsideDirectory(baseDir: string, candidatePath: string): boolean {
  const resolvedBaseDir = resolve(baseDir);
  const resolvedCandidatePath = resolve(candidatePath);
  const prefix = resolvedBaseDir.endsWith(sep) ? resolvedBaseDir : `${resolvedBaseDir}${sep}`;
  return resolvedCandidatePath !== resolvedBaseDir && resolvedCandidatePath.startsWith(prefix);
}

function resolveBackupPath(baseDir: string, backupPath: string): string | undefined {
  const backupRoot = join(baseDir, ".threadkit", "backups");
  const resolvedBackupPath = isAbsolute(backupPath) ? resolve(backupPath) : resolve(baseDir, backupPath);

  if (!isInsideDirectory(backupRoot, resolvedBackupPath)) {
    return undefined;
  }

  return resolvedBackupPath;
}

async function contentForSpec(file: FileSpec): Promise<Buffer | string> {
  if (file.content !== undefined) {
    return file.content;
  }

  if (file.copySource !== undefined) {
    return readFile(file.copySource);
  }

  throw new Error(`Install file '${file.relPath}' must define content or copySource.`);
}

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function manifestPathForBaseDir(baseDir: string): string {
  return join(baseDir, ".threadkit", "install-manifest.json");
}

export function backupIndexPathForBaseDir(baseDir: string): string {
  return join(baseDir, ".threadkit", "backup-index.json");
}

function stripTargetPrefix(target: string, relPath: string): string {
  const prefix = `${target}/`;
  return relPath.startsWith(prefix) ? relPath.slice(prefix.length) : relPath;
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

function hasManagedMarker(content: Buffer): boolean {
  const text = content.toString("utf8");
  const firstLines = text.split(/\r?\n/, 15);
  return firstLines.some((line) => /\bthreadkit:generated\b/.test(line));
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
    const outputPath = resolveInsideBaseDir(args.baseDir, relPath);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInstallScope(value: unknown): value is InstallScope {
  return value === "user" || value === "project";
}

function isInstallAction(value: unknown): value is InstallAction {
  return (
    value === "create" ||
    value === "overwrite" ||
    value === "unchanged" ||
    value === "skip-foreign" ||
    value === "overwrite-foreign"
  );
}

function isInstallManifestSchemaVersion(value: unknown): value is InstallManifest["schemaVersion"] {
  return value === undefined || value === 1;
}

function isInstallManifestFile(value: unknown): value is InstallManifestFile {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.path === "string" &&
    typeof value.relPath === "string" &&
    isInstallAction(value.action) &&
    typeof value.sha256 === "string" &&
    typeof value.marker === "boolean" &&
    typeof value.existingIsForeign === "boolean" &&
    (value.backupPath === undefined || typeof value.backupPath === "string")
  );
}

function isBackupGenerationFile(value: unknown): value is BackupGenerationFile {
  return isInstallManifestFile(value) && typeof value.backupPath === "string";
}

function isBackupGeneration(value: unknown): value is BackupGeneration {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.target === "string" &&
    typeof value.profile === "string" &&
    isInstallScope(value.scope) &&
    typeof value.baseDir === "string" &&
    typeof value.installedAt === "string" &&
    typeof value.backupDir === "string" &&
    Array.isArray(value.files) &&
    value.files.every(isBackupGenerationFile)
  );
}

function isBackupIndex(value: unknown): value is BackupIndex {
  if (!isRecord(value)) {
    return false;
  }

  return value.schemaVersion === 1 && Array.isArray(value.generations) && value.generations.every(isBackupGeneration);
}

function newestGenerationsFirst(generations: BackupGeneration[]): BackupGeneration[] {
  return [...generations].sort((left, right) => right.installedAt.localeCompare(left.installedAt));
}

function isInstallManifest(value: unknown): value is InstallManifest {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isInstallManifestSchemaVersion(value.schemaVersion) &&
    typeof value.target === "string" &&
    typeof value.profile === "string" &&
    isInstallScope(value.scope) &&
    typeof value.baseDir === "string" &&
    typeof value.installedAt === "string" &&
    Array.isArray(value.files) &&
    value.files.every(isInstallManifestFile)
  );
}

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

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InstallPlanUsageError(
      "invalid-install-manifest",
      `Install manifest at '${manifestPath}' is not valid JSON.`
    );
  }

  if (isRecord(parsed) && !isInstallManifestSchemaVersion(parsed.schemaVersion)) {
    throw new InstallPlanUsageError(
      "unsupported-install-manifest-version",
      `Install manifest at '${manifestPath}' has unsupported schema version '${String(parsed.schemaVersion)}'.`
    );
  }

  if (!isInstallManifest(parsed)) {
    throw new InstallPlanUsageError(
      "invalid-install-manifest",
      `Install manifest at '${manifestPath}' has an invalid shape.`
    );
  }

  return parsed;
}

export async function loadBackupIndex(args: { baseDir: string }): Promise<BackupIndex> {
  const indexPath = backupIndexPathForBaseDir(args.baseDir);
  let raw: string;

  try {
    raw = await readFile(indexPath, "utf8");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return { schemaVersion: 1, generations: [] };
    }

    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InstallPlanUsageError("invalid-backup-index", `Backup index at '${indexPath}' is not valid JSON.`);
  }

  if (isRecord(parsed) && parsed.schemaVersion !== 1) {
    throw new InstallPlanUsageError(
      "unsupported-backup-index-version",
      `Backup index at '${indexPath}' has unsupported schema version '${String(parsed.schemaVersion)}'.`
    );
  }

  if (!isBackupIndex(parsed)) {
    throw new InstallPlanUsageError("invalid-backup-index", `Backup index at '${indexPath}' has an invalid shape.`);
  }

  return {
    schemaVersion: 1,
    generations: newestGenerationsFirst(parsed.generations)
  };
}

export async function writeBackupIndex(args: { baseDir: string; index: BackupIndex }): Promise<string> {
  const indexPath = backupIndexPathForBaseDir(args.baseDir);
  const index: BackupIndex = {
    schemaVersion: 1,
    generations: newestGenerationsFirst(args.index.generations)
  };
  await mkdir(dirname(indexPath), { recursive: true });
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  return indexPath;
}

export function backupGenerationToRollbackManifest(generation: BackupGeneration): InstallManifest {
  return {
    schemaVersion: 1,
    target: generation.target,
    profile: generation.profile,
    scope: generation.scope,
    baseDir: generation.baseDir,
    installedAt: generation.installedAt,
    manifestPath: backupIndexPathForBaseDir(generation.baseDir),
    files: generation.files.map((file) => ({ ...file }))
  };
}

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
    const directoryPath = resolveInsideBaseDir(args.baseDir, relDir);
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
    const outputPath = resolveInsideBaseDir(args.baseDir, file.relPath);
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

export async function applyUninstallPlan(args: { plan: UninstallPlan }): Promise<ApplyUninstallPlanResult> {
  const files: AppliedUninstallFile[] = [];
  const directories: AppliedUninstallDirectory[] = [];

  for (const planned of args.plan.files) {
    const outputPath = resolveInsideBaseDir(args.plan.baseDir, planned.relPath);
    const applied: AppliedUninstallFile = { ...planned, path: outputPath, deleted: false };

    if (planned.action === "delete") {
      let existing: Buffer;

      try {
        existing = await readFile(outputPath);
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        if (code !== "ENOENT") {
          throw error;
        }

        applied.action = "missing";
        files.push(applied);
        continue;
      }

      const currentHash = sha256(existing);
      applied.marker = hasManagedMarker(existing);
      applied.sha256 = currentHash;

      if (!applied.marker) {
        applied.action = "skip-foreign";
      } else if (currentHash !== planned.sha256) {
        applied.action = "skip-drifted";
      } else {
        await unlink(outputPath);
        applied.deleted = true;
      }
    }

    files.push(applied);
  }

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

  return {
    manifestPath: args.plan.manifestPath,
    files,
    directories
  };
}

async function currentRollbackState(args: {
  outputPath: string;
  expectedSha256: string;
  fallbackMarker: boolean;
}): Promise<{ action: "restore" | "skip-drifted" | "skip-foreign" | "missing"; marker: boolean; sha256: string }> {
  let existing: Buffer;

  try {
    existing = await readFile(args.outputPath);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") {
      throw error;
    }

    return {
      action: "missing",
      marker: args.fallbackMarker,
      sha256: args.expectedSha256
    };
  }

  const marker = hasManagedMarker(existing);
  const currentHash = sha256(existing);

  if (!marker) {
    return {
      action: "skip-foreign",
      marker,
      sha256: currentHash
    };
  }

  if (currentHash !== args.expectedSha256) {
    return {
      action: "skip-drifted",
      marker,
      sha256: currentHash
    };
  }

  return {
    action: "restore",
    marker,
    sha256: currentHash
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
    const outputPath = resolveInsideBaseDir(args.baseDir, file.relPath);
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

function isSafeBackupDir(baseDir: string, backupDir: string): boolean {
  return isInsideDirectory(join(baseDir, ".threadkit", "backups"), backupDir);
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

export async function applyBackupPrunePlan(args: {
  plan: BackupPrunePlan;
}): Promise<ApplyBackupPrunePlanResult> {
  const generations: AppliedBackupPruneGeneration[] = [];
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

  const index: BackupIndex = {
    schemaVersion: 1,
    generations: args.plan.index.generations.filter((generation) => !deletedIds.has(generation.id))
  };
  const indexPath = await writeBackupIndex({ baseDir: args.plan.baseDir, index });

  return {
    indexPath,
    generations,
    retained: args.plan.retained
  };
}

export async function applyRollbackPlan(args: { plan: RollbackPlan; force?: boolean }): Promise<ApplyRollbackPlanResult> {
  const files: AppliedRollbackFile[] = [];

  for (const planned of args.plan.files) {
    const outputPath = resolveInsideBaseDir(args.plan.baseDir, planned.relPath);
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
