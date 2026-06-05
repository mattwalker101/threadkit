import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir as defaultHomedir } from "node:os";
import { dirname, join, isAbsolute, resolve } from "node:path";
import { getExportTarget } from "./exportTargets.js";
import { hasManagedMarker } from "./marker.js";
import { isInsideDirectory } from "./resolveSafePath.js";
import type { ExportScope, FileSpec } from "./renderTypes.js";

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

export function manifestPathForBaseDir(baseDir: string): string {
  return join(baseDir, ".threadkit", "install-manifest.json");
}

export function backupIndexPathForBaseDir(baseDir: string): string {
  return join(baseDir, ".threadkit", "backup-index.json");
}

// --- Cross-cutting helpers (used by both buildPlans and applyPlans) ---

export function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function resolveBackupPath(baseDir: string, backupPath: string): string | undefined {
  const backupRoot = join(baseDir, ".threadkit", "backups");
  const resolvedBackupPath = isAbsolute(backupPath) ? resolve(backupPath) : resolve(baseDir, backupPath);

  if (!isInsideDirectory(backupRoot, resolvedBackupPath)) {
    return undefined;
  }

  return resolvedBackupPath;
}

export function stripTargetPrefix(target: string, relPath: string): string {
  const prefix = `${target}/`;
  return relPath.startsWith(prefix) ? relPath.slice(prefix.length) : relPath;
}

export function isSafeBackupDir(baseDir: string, backupDir: string): boolean {
  return isInsideDirectory(join(baseDir, ".threadkit", "backups"), backupDir);
}

export async function currentRollbackState(args: {
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
    return { action: "skip-foreign", marker, sha256: currentHash };
  }

  if (currentHash !== args.expectedSha256) {
    return { action: "skip-drifted", marker, sha256: currentHash };
  }

  return { action: "restore", marker, sha256: currentHash };
}

// --- Type guards (internal to manifest I/O) ---

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

export function newestGenerationsFirst(generations: BackupGeneration[]): BackupGeneration[] {
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

// --- Manifest I/O ---

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
